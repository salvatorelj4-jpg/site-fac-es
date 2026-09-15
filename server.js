require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ==========================================
// ENVIRONMENT VALIDATION
// ==========================================
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_DEV';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, 'database.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(DATA_DIR, 'uploads');
const OBC_DATA_ROOT = path.join(DATA_DIR, 'oblivion-control');
const OBC_BRIDGE_TOKEN = process.env.OBC_BRIDGE_TOKEN || '';
if (NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('CHANGE_ME'))) {
    throw new Error('FATAL ERROR: JWT_SECRET must be securely set in production.');
}
if (NODE_ENV === 'production' && Buffer.byteLength(OBC_BRIDGE_TOKEN, 'utf8') < 32) {
    throw new Error('FATAL ERROR: OBC_BRIDGE_TOKEN must be at least 32 bytes in production.');
}

// ==========================================
// DB INITIALIZATION & PROMISES
// ==========================================
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OBC_DATA_ROOT, { recursive: true });

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) console.error('Database connection error:', err);
    else console.log('Connected to SQLite database.');
});

const dbRun = (query, params = []) => new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
        if (err) reject(err); else resolve(this);
    });
});
const dbGet = (query, params = []) => new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
        if (err) reject(err); else resolve(row);
    });
});
const dbAll = (query, params = []) => new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
        if (err) reject(err); else resolve(rows);
    });
});

const tableExists = async (tableName) => {
    const row = await dbGet(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName]);
    return !!row;
};

const getTableColumns = async (tableName) => {
    const rows = await dbAll(`PRAGMA table_info(${tableName})`);
    return rows.map(r => r.name);
};

const ensureColumn = async (tableName, columnName, definition) => {
    const exists = await tableExists(tableName);
    if (!exists) return false;
    const cols = await getTableColumns(tableName);
    if (!cols.includes(columnName)) {
        await dbRun(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
        return true;
    }
    return false;
};

// ==========================================
// DATABASE SCHEMA & SEEDING
// ==========================================
async function initDb() {
    db.serialize(async () => {
        try {
            // New tables
            await dbRun(`CREATE TABLE IF NOT EXISTS factions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                slug TEXT UNIQUE NOT NULL,
                active INTEGER DEFAULT 1,
                theme_config TEXT DEFAULT '{}',
                public_form_enabled INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                faction_id INTEGER REFERENCES factions(id),
                role TEXT NOT NULL DEFAULT 'operator',
                active INTEGER DEFAULT 1,
                last_login_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                capability TEXT NOT NULL,
                UNIQUE(role, capability)
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS user_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                capability TEXT NOT NULL,
                effect TEXT NOT NULL DEFAULT 'allow',
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, capability)
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS quests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                faction_id INTEGER REFERENCES factions(id),
                quest_giver TEXT DEFAULT '',
                description TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'DRAFT',
                repeatable INTEGER NOT NULL DEFAULT 0,
                cooldown_hours INTEGER NOT NULL DEFAULT 0,
                prerequisite_quest_id INTEGER REFERENCES quests(id),
                requirements_json TEXT NOT NULL DEFAULT '[]',
                rewards_json TEXT NOT NULL DEFAULT '{}',
                image TEXT DEFAULT '',
                created_by INTEGER REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS quest_progress (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quest_id INTEGER NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
                person_id INTEGER NOT NULL REFERENCES stalkers(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'NOT_STARTED',
                progress_json TEXT NOT NULL DEFAULT '{}',
                accepted_at DATETIME,
                completed_at DATETIME,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(quest_id, person_id)
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS traders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                trader_type TEXT NOT NULL DEFAULT 'TRADER',
                faction_id INTEGER REFERENCES factions(id),
                location TEXT DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                buy_categories_json TEXT NOT NULL DEFAULT '[]',
                sell_categories_json TEXT NOT NULL DEFAULT '[]',
                quest_ids_json TEXT NOT NULL DEFAULT '[]',
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS server_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '',
                updated_by INTEGER,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                faction_id INTEGER,
                action TEXT NOT NULL,
                entity TEXT,
                entity_id INTEGER,
                metadata TEXT DEFAULT '{}',
                ip_address TEXT,
                user_agent TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS admin_reset_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                faction_id INTEGER,
                reset_mode TEXT NOT NULL,
                scope TEXT NOT NULL,
                backup_file TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS mercenary_contracts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                public_code TEXT UNIQUE NOT NULL,
                client_name TEXT NOT NULL,
                contact TEXT,
                discord TEXT,
                mission_type TEXT,
                location TEXT,
                objective TEXT,
                description TEXT,
                target TEXT,
                operator_estimate INTEGER,
                risk_level TEXT,
                desired_date TEXT,
                reward TEXT,
                additional_info TEXT,
                status TEXT DEFAULT 'NEW',
                honeypot TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS contract_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contract_id INTEGER NOT NULL REFERENCES mercenary_contracts(id),
                user_id INTEGER NOT NULL REFERENCES users(id),
                message TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS faction_modules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faction_id INTEGER NOT NULL REFERENCES factions(id),
                module_code TEXT NOT NULL,
                enabled INTEGER DEFAULT 1,
                UNIQUE(faction_id, module_code)
            )`);

            await dbRun(`
                CREATE TABLE IF NOT EXISTS faction_bank_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    faction_id INTEGER NOT NULL REFERENCES factions(id),
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    reason TEXT NOT NULL,
                    transaction_date DATETIME NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            await dbRun(`
                CREATE TABLE IF NOT EXISTS faction_general_bank_transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    faction_id INTEGER NOT NULL REFERENCES factions(id),
                    user_id INTEGER NOT NULL REFERENCES users(id),
                    type TEXT NOT NULL,
                    amount REAL NOT NULL,
                    reason TEXT NOT NULL,
                    transaction_date TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Generic faction-specific RP records
            await dbRun(`CREATE TABLE IF NOT EXISTS faction_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faction_id INTEGER NOT NULL REFERENCES factions(id),
                module_code TEXT NOT NULL,
                title TEXT NOT NULL,
                category TEXT,
                status TEXT DEFAULT 'ativo',
                location TEXT,
                subject TEXT,
                description TEXT,
                extra_json TEXT DEFAULT '{}',
                created_by INTEGER REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Ecologist RP experiments: fictional mutant/artifact research
            await dbRun(`CREATE TABLE IF NOT EXISTS rp_experiments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faction_id INTEGER NOT NULL DEFAULT 2 REFERENCES factions(id),
                title TEXT NOT NULL,
                experiment_type TEXT NOT NULL,
                subject TEXT NOT NULL,
                hypothesis TEXT,
                risk_level TEXT DEFAULT 'baixo',
                status TEXT DEFAULT 'planejado',
                procedure_summary TEXT,
                expected_result TEXT,
                observed_result TEXT,
                rp_effects TEXT,
                notes TEXT,
                created_by INTEGER REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Preserve existing tables
            const existingTables = ['stalkers', 'historico', 'itens', 'missoes', 'relatorios', 'pesquisas', 'configuracoes'];
            for (const table of existingTables) {
                await dbRun(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
                try {
                    await dbRun(`ALTER TABLE ${table} ADD COLUMN faction_id INTEGER DEFAULT 2`);
                } catch (e) { /* Ignore if column exists */ }
            }

            // Legacy compatibility migration: old databases used slightly different schemas.
            // These adjustments let the new faction-specific STALKER pages work on top of the
            // user's existing production database without destroying earlier data.
            await ensureColumn('itens', 'nome', 'TEXT');
            await ensureColumn('itens', 'tipo', "TEXT DEFAULT 'Item'");
            await ensureColumn('itens', 'quantidade', 'INTEGER DEFAULT 1');
            await ensureColumn('itens', 'valor_base', 'REAL DEFAULT 0');
            await ensureColumn('itens', 'foto', "TEXT DEFAULT ''");
            await ensureColumn('itens', 'faction_id', 'INTEGER DEFAULT 2');

            const itensCols = await getTableColumns('itens');
            if (itensCols.includes('categoria')) {
                await dbRun(`UPDATE itens SET tipo = COALESCE(NULLIF(tipo,''), categoria, 'Item')`);
            }
            if (itensCols.includes('preco_base')) {
                await dbRun(`UPDATE itens SET valor_base = COALESCE(valor_base, preco_base, 0)`);
            }
            await dbRun(`UPDATE itens SET quantidade = COALESCE(NULLIF(quantidade, 0), 1)`);

            await ensureColumn('missoes', 'titulo', 'TEXT');
            await ensureColumn('missoes', 'descricao', 'TEXT');
            await ensureColumn('missoes', 'recompensa', 'REAL DEFAULT 0');
            await ensureColumn('missoes', 'status', "TEXT DEFAULT 'pendente'");
            await ensureColumn('missoes', 'faction_id', 'INTEGER DEFAULT 2');
            await ensureColumn('missoes', 'stalker_id', 'INTEGER');
            await ensureColumn('missoes', 'foto', "TEXT DEFAULT ''");
            await ensureColumn('relatorios', 'foto', "TEXT DEFAULT ''");
            await ensureColumn('rp_experiments', 'foto', "TEXT DEFAULT ''");


            const missoesCols = await getTableColumns('missoes');
            if (missoesCols.includes('recompensa_ru')) {
                await dbRun(`UPDATE missoes SET recompensa = COALESCE(recompensa, recompensa_ru, 0)`);
            } else if (missoesCols.includes('recompensa_rep')) {
                await dbRun(`UPDATE missoes SET recompensa = COALESCE(recompensa, recompensa_rep, 0)`);
            }
            await dbRun(`UPDATE missoes SET status = COALESCE(NULLIF(status,''), 'pendente')`);

            await ensureColumn('relatorios', 'numero', 'TEXT');
            await ensureColumn('relatorios', 'autor', 'TEXT');
            await ensureColumn('relatorios', 'membros', 'TEXT');
            await ensureColumn('relatorios', 'objetivo', 'TEXT');
            await ensureColumn('relatorios', 'col1', 'TEXT');
            await ensureColumn('relatorios', 'col2', 'TEXT');
            await ensureColumn('relatorios', 'col3', 'TEXT');
            await ensureColumn('relatorios', 'faction_id', 'INTEGER DEFAULT 2');

            await ensureColumn('stalkers', 'nome', 'TEXT');
            await ensureColumn('stalkers', 'codinome', 'TEXT');
            await ensureColumn('stalkers', 'faccao', 'TEXT');
            await ensureColumn('stalkers', 'foto', 'TEXT');
            await ensureColumn('stalkers', 'reputacao', 'INTEGER DEFAULT 0');
            await ensureColumn('stalkers', 'rumores', 'TEXT');
            await ensureColumn('stalkers', 'ultimo_checkin', 'TEXT');
            await ensureColumn('stalkers', 'area_atuacao', 'TEXT');
            await ensureColumn('stalkers', 'status_lista_negra', 'INTEGER DEFAULT 0');
            await ensureColumn('stalkers', 'motivo_lista_negra', 'TEXT');
            await ensureColumn('stalkers', 'faction_id', 'INTEGER DEFAULT 2');
            await ensureColumn('stalkers', 'saldo_ru', 'REAL DEFAULT 0');

            await dbRun(`CREATE TABLE IF NOT EXISTS commerce_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                faction_id INTEGER NOT NULL REFERENCES factions(id),
                module_code TEXT NOT NULL,
                person_id INTEGER NOT NULL REFERENCES stalkers(id),
                operation_type TEXT NOT NULL,
                merchandise TEXT NOT NULL,
                quantity REAL DEFAULT 1,
                money_delta REAL DEFAULT 0,
                reputation_delta INTEGER DEFAULT 0,
                person_balance_after REAL DEFAULT 0,
                person_reputation_after INTEGER DEFAULT 0,
                bank_transaction_id INTEGER,
                notes TEXT DEFAULT '',
                created_by INTEGER REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS trade_catalog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL DEFAULT 'GERAL',
                buy_price REAL NOT NULL DEFAULT 0,
                sell_price REAL NOT NULL DEFAULT 0,
                reputation_reward INTEGER NOT NULL DEFAULT 0,
                stock REAL NOT NULL DEFAULT 0,
                track_stock INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                photo TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                channels_json TEXT NOT NULL DEFAULT '["ALL"]',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);


            // Oblivion Control administrative control-plane.
            // This is configuration/draft state only: it never claims Qonzer/Workshop application.
            await dbRun(`CREATE TABLE IF NOT EXISTS oblivion_traders (
                trader_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                entity_classname TEXT NOT NULL,
                faction_code TEXT DEFAULT '',
                location_label TEXT DEFAULT '',
                currency TEXT NOT NULL DEFAULT 'RUB',
                catalog_override_enabled INTEGER NOT NULL DEFAULT 0,
                overlay_mode TEXT NOT NULL DEFAULT 'selective',
                source_of_truth TEXT NOT NULL DEFAULT 'THIRD_PARTY_STATIC',
                validation_status TEXT NOT NULL DEFAULT 'READY_STATIC',
                notes TEXT DEFAULT '',
                updated_by INTEGER REFERENCES users(id),
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS oblivion_trader_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trader_id TEXT NOT NULL REFERENCES oblivion_traders(trader_id) ON DELETE CASCADE,
                item_name TEXT NOT NULL,
                classname TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'GERAL',
                enabled INTEGER NOT NULL DEFAULT 1,
                buy_enabled INTEGER NOT NULL DEFAULT 0,
                sell_enabled INTEGER NOT NULL DEFAULT 1,
                buy_price REAL NOT NULL DEFAULT 0,
                sell_price REAL NOT NULL DEFAULT 0,
                stock_mode TEXT NOT NULL DEFAULT 'infinite',
                stock INTEGER NOT NULL DEFAULT -1,
                reputation_required INTEGER NOT NULL DEFAULT 0,
                max_quantity INTEGER NOT NULL DEFAULT 1,
                source_of_truth TEXT NOT NULL DEFAULT 'OBLIVIONCONTROL_CONFIG',
                photo TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                created_by INTEGER REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(trader_id, classname)
            )`);

            await dbRun(`CREATE TABLE IF NOT EXISTS oblivion_releases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                release_code TEXT UNIQUE NOT NULL,
                status TEXT NOT NULL DEFAULT 'DRAFT',
                payload_json TEXT NOT NULL DEFAULT '{}',
                notes TEXT DEFAULT '',
                created_by INTEGER REFERENCES users(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                approved_at DATETIME
            )`);

            const oblivionTraderSeeds = [
                ['skad','Skad','OG_SkadBorodaVisual','','Skad','RUB','VALIDATED_LOCAL'],
                ['yanov','Yanov','OG_YanovTraderVisual','','Yanov','RUB','VALIDATED_LOCAL'],
                ['bandit','Bandit Trader','OG_BanditTraderVisual','bandits','Base dos Bandidos','RUB','VALIDATED_LOCAL'],
                ['duty','Duty Trader','OG_DutyTraderVisual','duty','Base Duty','RUB','VALIDATED_LOCAL'],
                ['merc','Trader Mercenário (Rublos)','OG_MercTradeVisual','mercenaries','Base Mercenária','RUB','OWNER_RISK_ACCEPTED_NOT_LIVE_TESTED'],
                ['merc_barter','Bazar Mercenário (Pregos)','OG_MercBarterNPC','mercenaries','3 bazares • identidade individual pendente','NAILS','READY_STATIC_IDENTITY_AMBIGUOUS']
            ];
            for (const t of oblivionTraderSeeds) {
                await dbRun(`INSERT OR IGNORE INTO oblivion_traders
                    (trader_id,name,entity_classname,faction_code,location_label,currency,validation_status)
                    VALUES (?,?,?,?,?,?,?)`, t);
            }

            // V27.3: normalize Merc labels even on existing databases created by older UI versions.
            await dbRun(`UPDATE oblivion_traders SET name = ?, location_label = ? WHERE trader_id = 'merc'`,
                ['Trader Mercenário (Rublos)', 'Base Mercenária']);
            await dbRun(`UPDATE oblivion_traders SET name = ?, location_label = ? WHERE trader_id = 'merc_barter'`,
                ['Bazar Mercenário (Pregos)', '3 bazares • identidade individual pendente']);

            // Seed the read-only V1.6 reference catalog only when this control-plane is new.
            // Rows imported from THIRD_PARTY_STATIC are panel references; editing one promotes it
            // to OBLIVIONCONTROL_CONFIG and still requires a release + bridge to reach DayZ.
            const obcCatalogCount = await dbGet(`SELECT COUNT(*) count FROM oblivion_trader_rules`);
            const obcCatalogSeedPath = path.join(__dirname, 'data', 'oblivion-v16-catalog.json');
            if (Number(obcCatalogCount?.count || 0) === 0 && fs.existsSync(obcCatalogSeedPath)) {
                try {
                    const seedDoc = JSON.parse(fs.readFileSync(obcCatalogSeedPath, 'utf8'));
                    const offers = Array.isArray(seedDoc.offers) ? seedDoc.offers : [];
                    for (const offer of offers) {
                        await dbRun(`INSERT OR IGNORE INTO oblivion_trader_rules
                            (trader_id,item_name,classname,category,enabled,buy_enabled,sell_enabled,buy_price,sell_price,stock_mode,stock,reputation_required,max_quantity,source_of_truth,photo,notes)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
                                String(offer.traderId || '').toLowerCase(),
                                String(offer.itemName || offer.classname || ''),
                                String(offer.classname || ''),
                                String(offer.category || 'GERAL'),
                                offer.enabled === false ? 0 : 1,
                                offer.buyEnabled ? 1 : 0,
                                offer.sellEnabled ? 1 : 0,
                                Number(offer.buyPrice || 0),
                                Number(offer.sellPrice || 0),
                                'infinite', -1, 0, 1,
                                'THIRD_PARTY_STATIC', '',
                                String(offer.notes || 'Referência V1.6 importada em modo somente leitura.')
                            ]);
                    }
                    console.log(`Oblivion V1.6 reference catalog seeded: ${offers.length} offers.`);
                } catch (catalogSeedError) {
                    console.warn('Oblivion reference catalog seed skipped:', catalogSeedError.message);
                }
            }

            const obcSettings = [
                ['obc.release_candidate','V1.6 RC1.2'],
                ['obc.bridge_status','NOT_CONNECTED'],
                ['obc.qonzer_status','NOT_INSTALLED'],
                ['obc.workshop_status','NOT_PUBLISHED'],
                ['obc.prices_active','false'],
                ['obc.catalog_overrides_default','false']
            ];
            for (const [key,value] of obcSettings) {
                await dbRun(`INSERT OR IGNORE INTO server_settings(key,value) VALUES (?,?)`,[key,value]);
            }

            const mutantTradeSeeds = [
                ['Tentáculos de Bloodsucker','PARTES DE MUTANTES',3500,5000,30,12],
                ['Garra de Chimera','PARTES DE MUTANTES',5200,7500,45,8],
                ['Pé de Snork','PARTES DE MUTANTES',900,1500,12,30],
                ['Mão de Burer','PARTES DE MUTANTES',2800,4200,28,12],
                ['Tecido Neural de Controller','PARTES DE MUTANTES',6500,9000,55,6],
                ['Olho de Pseudogigante','PARTES DE MUTANTES',8000,11500,70,5],
                ['Cauda de Pseudocão','PARTES DE MUTANTES',1400,2200,15,25],
                ['Material Psi de Psi-Dog','PARTES DE MUTANTES',4200,6200,38,10],
                ['Casco de Javali Mutante','PARTES DE MUTANTES',700,1200,8,35],
                ['Olho de Flesh','PARTES DE MUTANTES',500,900,6,40]
            ];
            for (const item of mutantTradeSeeds) {
                await dbRun(`INSERT OR IGNORE INTO trade_catalog
                    (name,category,buy_price,sell_price,reputation_reward,stock,track_stock,active,channels_json)
                    VALUES (?,?,?,?,?,?,1,1,'["ALL"]')`, item);
            }



            // Seed Factions
            const factions = [
                { id: 1, code: 'duty', name: 'Duty', slug: 'duty', theme: {primaryColor:'#c0392b',secondaryColor:'#2c3e50',accentColor:'#e74c3c',bgColor:'#1a0a0a',cardColor:'rgba(44,10,10,0.85)',borderColor:'rgba(192,57,43,0.3)'} },
                { id: 2, code: 'ecologists', name: 'Ecologistas', slug: 'ecologists', theme: {primaryColor:'#00b4d8',secondaryColor:'#14213d',accentColor:'#00b4d8',bgColor:'#0b111a',cardColor:'rgba(26,36,50,0.85)',borderColor:'rgba(0,180,216,0.2)'} },
                { id: 3, code: 'bandits', name: 'Bandidos', slug: 'bandits', theme: {primaryColor:'#d4a017',secondaryColor:'#1a1a1a',accentColor:'#d4a017',bgColor:'#0d0d0d',cardColor:'rgba(20,20,20,0.9)',borderColor:'rgba(212,160,23,0.25)'} },
                { id: 4, code: 'freedom', name: 'Freedom', slug: 'freedom', theme: {primaryColor:'#27ae60',secondaryColor:'#1a2e1a',accentColor:'#2ecc71',bgColor:'#0a1a0a',cardColor:'rgba(15,30,15,0.85)',borderColor:'rgba(39,174,96,0.25)'} },
                { id: 5, code: 'mercenaries', name: 'Mercenários', slug: 'mercenaries', theme: {primaryColor:'#2c3e50',secondaryColor:'#1a2530',accentColor:'#3498db',bgColor:'#0a1015',cardColor:'rgba(15,25,35,0.9)',borderColor:'rgba(52,152,219,0.2)'}, public: 1 }
            ];
            for (const f of factions) {
                await dbRun(`INSERT OR IGNORE INTO factions (id, code, name, slug, theme_config, public_form_enabled) VALUES (?, ?, ?, ?, ?, ?)`,
                    [f.id, f.code, f.name, f.slug, JSON.stringify(f.theme), f.public || 0]);
            }

            // Seed Permissions
            const roles = {
                super_admin: ['oblivion:read', 'oblivion:manage', 'oblivion:publish', 'releases:manage', 'faction:manage', 'users:manage', 'contracts:read', 'contracts:create', 'contracts:update', 'contracts:assign', 'audit:read', 'operations:read', 'operations:manage', 'research:read', 'research:manage', 'members:read', 'members:manage', 'items:read', 'items:manage', 'missions:read', 'missions:manage', 'reports:read', 'reports:manage', 'stalkers:read', 'stalkers:manage', 'config:manage', 'modules:manage'],
                faction_admin: ['users:manage', 'operations:read', 'operations:manage', 'research:read', 'research:manage', 'members:read', 'members:manage', 'items:read', 'items:manage', 'missions:read', 'missions:manage', 'reports:read', 'reports:manage', 'stalkers:read', 'stalkers:manage', 'contracts:read', 'contracts:create', 'contracts:update', 'contracts:assign', 'config:manage', 'audit:read'],
                commander: ['operations:read', 'operations:manage', 'members:read', 'items:read', 'items:manage', 'missions:read', 'missions:manage', 'reports:read', 'reports:manage', 'stalkers:read', 'stalkers:manage', 'contracts:read', 'contracts:create', 'contracts:update', 'contracts:assign', 'research:read'],
                operator: ['operations:read', 'members:read', 'items:read', 'missions:read', 'reports:read', 'reports:manage', 'stalkers:read', 'stalkers:manage', 'research:read', 'research:manage', 'contracts:read'],
                viewer: ['operations:read', 'members:read', 'items:read', 'missions:read', 'reports:read', 'stalkers:read', 'research:read', 'contracts:read']
            };
            for (const [role, caps] of Object.entries(roles)) {
                for (const cap of caps) {
                    await dbRun(`INSERT OR IGNORE INTO permissions (role, capability) VALUES (?, ?)`, [role, cap]);
                }
            }

            // Seed Modules
            const modules = {
                1: ['members', 'missions', 'arsenal', 'reports', 'intelligence', 'logs'],
                2: ['research', 'artifacts', 'expeditions', 'anomalies', 'personnel', 'commerce', 'inventory', 'missions', 'reports', 'logs'],
                3: ['members', 'business', 'territories', 'intel', 'cash', 'records'],
                4: ['members', 'posts', 'missions', 'supplies', 'intel', 'communications'],
                5: ['contracts', 'operators', 'clients', 'operations', 'intelligence', 'archive']
            };
            for (const [fid, mods] of Object.entries(modules)) {
                for (const m of mods) {
                    await dbRun(`INSERT OR IGNORE INTO faction_modules (faction_id, module_code) VALUES (?, ?)`, [fid, m]);
                }
            }

            // Migrate legacy users when the new users table is still empty
            const userCount = await dbGet(`SELECT COUNT(*) as count FROM users`);
            if (userCount.count === 0) {
                try {
                    const oldUsers = await dbAll(`SELECT * FROM usuarios`);
                    for (const u of oldUsers) {
                        const role = u.role === 'admin' ? 'faction_admin' : 'operator';
                        await dbRun(
                            `INSERT OR IGNORE INTO users (username, password_hash, name, faction_id, role, active)
                             VALUES (?, ?, ?, 2, ?, 1)`,
                            [u.usuario, u.senha, u.nome, role]
                        );
                    }
                } catch (e) {
                    console.log('No old usuarios table to migrate.');
                }
            }

            // Environment-controlled super admin.
            // ADMIN_USERNAME + ADMIN_PASSWORD are the source of truth on every startup.
            const adminUser = (process.env.ADMIN_USERNAME || '').trim();
            const adminPass = process.env.ADMIN_PASSWORD || '';

            if (adminUser && adminPass) {
                const hash = await bcrypt.hash(adminPass, 10);

                // Prefer an exact username match. If none exists, reuse a case-insensitive
                // match so Salvatore/salvatore do not become duplicate accounts.
                let existingAdmin = await dbGet(
                    `SELECT id, username FROM users WHERE username = ?`,
                    [adminUser]
                );
                if (!existingAdmin) {
                    existingAdmin = await dbGet(
                        `SELECT id, username FROM users WHERE username = ? COLLATE NOCASE ORDER BY id ASC LIMIT 1`,
                        [adminUser]
                    );
                }

                let environmentAdminId;

                if (existingAdmin) {
                    await dbRun(
                        `UPDATE users
                         SET username = ?,
                             password_hash = ?,
                             name = ?,
                             faction_id = NULL,
                             role = 'super_admin',
                             active = 1,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?`,
                        [adminUser, hash, 'System Administrator', existingAdmin.id]
                    );
                    environmentAdminId = existingAdmin.id;

                    console.log(`Environment admin synchronized: ${adminUser}`);
                } else {
                    const createdAdmin = await dbRun(
                        `INSERT INTO users (
                            username,
                            password_hash,
                            name,
                            faction_id,
                            role,
                            active
                        ) VALUES (?, ?, ?, NULL, 'super_admin', 1)`,
                        [adminUser, hash, 'System Administrator']
                    );
                    environmentAdminId = createdAdmin.lastID;

                    console.log(`Environment admin created: ${adminUser}`);
                }

                // Remove duplicate accounts that differ only by uppercase/lowercase.
                await dbRun(
                    `DELETE FROM users WHERE username = ? COLLATE NOCASE AND id <> ?`,
                    [adminUser, environmentAdminId]
                );

                // Remove the old default @admin account when another environment admin is used.
                if (adminUser.toLowerCase() !== 'admin') {
                    await dbRun(
                        `DELETE FROM users WHERE username = 'admin' COLLATE NOCASE AND id <> ?`,
                        [environmentAdminId]
                    );
                }
            } else if (NODE_ENV === 'production') {
                console.warn(
                    'ADMIN_USERNAME/ADMIN_PASSWORD are not both set; environment admin sync skipped.'
                );
            } else if (userCount.count === 0) {
                const hash = await bcrypt.hash('admin123', 10);
                await dbRun(
                    `INSERT INTO users (
                        username,
                        password_hash,
                        name,
                        faction_id,
                        role,
                        active
                    ) VALUES ('admin', ?, 'System Administrator', NULL, 'super_admin', 1)`,
                    [hash]
                );

                console.warn('Development admin created with default credentials.');
            }

            console.log('Database initialized.');
        } catch (err) {
            console.error('Database Init Error:', err);
        }
    });
}
initDb();

// ==========================================
// SERVICES
// ==========================================
async function auditLog({ userId, factionId, action, entity, entityId, metadata = {}, ipAddress, userAgent }) {
    const safeMeta = { ...metadata };
    Object.keys(safeMeta).forEach(k => {
        if (/(password|secret|token|hash|cookie)/i.test(k)) safeMeta[k] = '[REDACTED]';
    });
    try {
        await dbRun(`INSERT INTO audit_log (user_id, faction_id, action, entity, entity_id, metadata, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId || null, factionId || null, action, entity || null, entityId || null, JSON.stringify(safeMeta), ipAddress, userAgent]);
    } catch (e) {
        console.error('Audit log failed', e);
    }
}

async function sendDiscordNotification({ title, description, color, fields }) {
    if (!process.env.DISCORD_AUDIT_WEBHOOK_URL) return;
    try {
        const safeFields = (fields || []).map(f => {
            if (/(password|secret|token)/i.test(f.name)) return { ...f, value: '[REDACTED]' };
            return f;
        });
        await fetch(process.env.DISCORD_AUDIT_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{ title, description, color, fields: safeFields }]
            })
        });
    } catch (e) {
        console.error('Discord notification failed', e);
    }
}

// ==========================================
// APP SETUP & MIDDLEWARE
// ==========================================
const app = express();

// Wispbyte and most production hosts run behind a reverse proxy.
// Trust only the first proxy hop so rate limiting and client IPs work correctly.
if (NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || (NODE_ENV === 'development' && origin.includes('localhost'))) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));

// V27.3: admin UI assets must not be served stale during rollout.
app.use((req, res, next) => {
    if (/^\/admin(?:-[a-z-]+)?\.(?:html|css|js)$/.test(req.path) || req.path === '/admin-ui-version.json') {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});
app.get('/api/admin/ui-version-public', (req, res) => res.json({ ui: '27.2', redesign: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const generalLimiter = rateLimit({ windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || 900000), max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || 1000) });
const loginLimiter = rateLimit({ windowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 900000), max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || 10) });
const publicFormLimiter = rateLimit({ windowMs: parseInt(process.env.PUBLIC_FORM_RATE_LIMIT_WINDOW_MS || 3600000), max: parseInt(process.env.PUBLIC_FORM_RATE_LIMIT_MAX_ATTEMPTS || 5) });
app.use(generalLimiter);

const storage = multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({
    storage,
    limits: { fileSize: (process.env.MAX_UPLOAD_SIZE_MB || 5) * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
        const allowedExts = ['.jpeg', '.jpg', '.png', '.gif', '.webp'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(file.mimetype) && allowedExts.includes(ext)) cb(null, true);
        else cb(new Error('Invalid file type'));
    }
});

// ==========================================
// AUTH MIDDLEWARE
// ==========================================
async function auth(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1] || req.headers.authorization;
        if (!token) return res.status(401).json({ error: 'Unauthorized' });
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await dbGet(`SELECT u.*, f.code as factionCode, f.active as factionActive FROM users u LEFT JOIN factions f ON u.faction_id = f.id WHERE u.id = ?`, [decoded.id]);
        
        if (!user || user.active !== 1) return res.status(401).json({ error: 'User disabled or not found' });
        if (user.faction_id && user.factionActive !== 1) return res.status(403).json({ error: 'Faction is disabled' });
        
        req.user = { id: user.id, username: user.username, name: user.name, role: user.role, factionId: user.faction_id, factionCode: user.factionCode };
        next();
    } catch (e) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

function requireSuperAdminDelete(req, res, next) {
    if (!req.user || req.user.role !== 'super_admin') {
        return res.status(403).json({
            error: 'Somente o Super Admin pode excluir registros permanentemente.'
        });
    }
    next();
}

async function getEffectiveCapabilities(userId, role) {
    if (role === 'super_admin') return ['*'];
    const roleRows = await dbAll(`SELECT capability FROM permissions WHERE role=?`, [role]);
    const caps = new Set(roleRows.map(r => r.capability));

    const overrides = await dbAll(`SELECT capability,effect FROM user_permissions WHERE user_id=?`, [userId]);
    for (const row of overrides) {
        if (row.effect === 'deny') caps.delete(row.capability);
        else caps.add(row.capability);
    }
    return [...caps];
}

function requireCapability(...capabilities) {
    return async (req, res, next) => {
        if (req.user.role === 'super_admin') return next();
        const userCaps = await getEffectiveCapabilities(req.user.id, req.user.role);
        const hasCap = capabilities.some(c => userCaps.includes(c));
        if (!hasCap) {
            await auditLog({ userId: req.user.id, factionId: req.user.factionId, action: 'DENIED', entity: 'capability', metadata: { required: capabilities } });
            return res.status(403).json({ error: 'Forbidden: Missing capability' });
        }
        next();
    };
}

// ==========================================
// OBLIVION CONTROL V1.7.1 — PERSISTENT RELEASE CONTROL PLANE
// ==========================================
const OBC_PATHS = Object.freeze({
    'Catalog/items.json': 'items',
    'TradeSystem/traders.json': 'traders',
    'TradeSystem/categories.json': 'categories',
    'TradeSystem/prices.json': 'prices',
    'Economy/economy.json': 'economy',
    'Reputation/reputation.json': 'reputation',
    'NPCs/npcs.json': 'npcs'
});
const OBC_ALLOWED_FIELDS = new Set(['buyPrice','sellPrice','enabled','buyEnabled','sellEnabled','stock','reputationRequired','maxQuantityPerTransaction','stockMode','category']);
const obcId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value);
const obcClone = value => JSON.parse(JSON.stringify(value));
const obcHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const obcAtomicWrite = (file, content) => { const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, content, { flag: 'wx' }); fs.renameSync(tmp, file); };
const obcReadJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function createOblivionControl() {
    const root = OBC_DATA_ROOT;
    const draftsRoot = path.join(root, 'drafts');
    const releasesRoot = path.join(root, 'releases');
    const recordsRoot = path.join(root, 'release-records');
    const statusFile = path.join(root, 'bridge-status.json');
    [draftsRoot, releasesRoot, recordsRoot].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
    const recordPath = id => path.join(recordsRoot, `${id}.json`);
    const getRecord = id => { if (!obcId(id) || !fs.existsSync(recordPath(id))) throw Object.assign(new Error('RELEASE_NOT_FOUND'), { statusCode: 404 }); return obcReadJson(recordPath(id)); };
    const saveRecord = record => obcAtomicWrite(recordPath(record.releaseId), JSON.stringify(record, null, 2) + '\n');
    const listRecords = () => fs.readdirSync(recordsRoot).filter(x => x.endsWith('.json')).map(x => obcReadJson(path.join(recordsRoot, x))).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    async function bundle() {
        const [traderRows, ruleRows] = await Promise.all([
            dbAll(`SELECT * FROM oblivion_traders ORDER BY trader_id`),
            dbAll(`SELECT * FROM oblivion_trader_rules ORDER BY trader_id,classname`)
        ]);
        const unique = new Map();
        for (const r of ruleRows) if (!unique.has(r.classname)) unique.set(r.classname, { id:r.classname, className:r.classname, displayName:r.item_name, category:r.category, enabled:!!r.enabled, confirmed:r.source_of_truth !== 'OWNER_CATALOG_IMPORT', buyEnabled:!!r.buy_enabled, sellEnabled:!!r.sell_enabled, baseBuyPrice:Number(r.buy_price), baseSellPrice:Number(r.sell_price), reputationReward:0, stockControlled:r.stock_mode === 'finite', defaultStock:Number(r.stock), sourceOfTruth:r.source_of_truth, editable:true });
        const byTrader = new Map(traderRows.map(t => [t.trader_id, ruleRows.filter(r => r.trader_id === t.trader_id)]));
        const traders = traderRows.map(t => ({ id:t.trader_id, name:t.name, enabled:true, faction:t.faction_code, traderType:'existing-real-npc', locationLabel:t.location_label, entityClass:t.entity_classname, currency:t.currency, catalogOverrideEnabled:!!t.catalog_override_enabled, overlayMode:t.overlay_mode, allowedItemIds:(byTrader.get(t.trader_id)||[]).map(r=>r.classname), soldItems:(byTrader.get(t.trader_id)||[]).map(r=>({ itemId:r.classname,className:r.classname,enabled:!!r.enabled,buyEnabled:!!r.buy_enabled,sellEnabled:!!r.sell_enabled,buyPrice:Number(r.buy_price),sellPrice:Number(r.sell_price),stockMode:r.stock_mode,stock:Number(r.stock),reputationRequired:Number(r.reputation_required),maxQuantityPerTransaction:Number(r.max_quantity),category:r.category,sourceOfTruth:r.source_of_truth })) }));
        const categories = [...new Set(ruleRows.map(r => r.category))].sort();
        return { items:{items:[...unique.values()]}, traders:{traders}, categories:{categories}, prices:{defaultBuyPrice:0,defaultSellPrice:0,active:false,overrides:traders.flatMap(t=>t.soldItems.map(r=>({itemId:r.itemId,traderId:t.id,faction:t.faction,buyPrice:r.buyPrice,sellPrice:r.sellPrice,enabled:r.enabled,sourceOfTruth:r.sourceOfTruth})))}, economy:{currency:'RUB',pricesActive:false}, reputation:{enabled:true}, npcs:{existingTraders:traders.map(t=>({traderId:t.id,entityClass:t.entityClass}))} };
    }
    const draftPath = id => path.join(draftsRoot, `${id}.json`);
    const getDraft = id => { if (!obcId(id) || !fs.existsSync(draftPath(id))) throw Object.assign(new Error('DRAFT_NOT_FOUND'), { statusCode:404 }); return obcReadJson(draftPath(id)); };
    const saveDraft = draft => obcAtomicWrite(draftPath(draft.draftId), JSON.stringify(draft, null, 2) + '\n');
    return {
        async traders(){ return (await bundle()).traders.traders; },
        async trader(id){ if(!obcId(id))throw Object.assign(new Error('INVALID_ID'),{statusCode:400}); const t=(await bundle()).traders.traders.find(x=>x.id===id); if(!t)throw Object.assign(new Error('TRADER_NOT_FOUND'),{statusCode:404}); return t; },
        async items(id){ const b=await bundle(), t=b.traders.traders.find(x=>x.id===id); if(!t)throw Object.assign(new Error('TRADER_NOT_FOUND'),{statusCode:404}); const allowed=new Set(t.allowedItemIds); return b.items.items.filter(x=>allowed.has(x.id)); },
        async createDraft(traderId){ await this.trader(traderId); const draft={draftId:`draft-${uuidv4()}`,status:'DRAFT',traderId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),baseBundle:await bundle(),changes:[]}; saveDraft(draft); return draft; },
        updateDraft(id,itemId,patch){ if(!obcId(itemId))throw Object.assign(new Error('INVALID_ID'),{statusCode:400}); if(!patch||Object.keys(patch).some(k=>!OBC_ALLOWED_FIELDS.has(k)))throw Object.assign(new Error('UNKNOWN_ITEM_FIELD'),{statusCode:400}); const draft=getDraft(id); if(draft.status!=='DRAFT')throw Object.assign(new Error('DRAFT_NOT_EDITABLE'),{statusCode:409}); const trader=draft.baseBundle.traders.traders.find(t=>t.id===draft.traderId); let rule=trader.soldItems.find(x=>x.itemId===itemId); if(!rule)throw Object.assign(new Error('ITEM_NOT_FOUND'),{statusCode:404}); Object.assign(rule,patch); const item=draft.baseBundle.items.items.find(x=>x.id===itemId); if(item)Object.assign(item,{enabled:!!rule.enabled,buyEnabled:!!rule.buyEnabled,sellEnabled:!!rule.sellEnabled,baseBuyPrice:Number(rule.buyPrice),baseSellPrice:Number(rule.sellPrice)}); draft.changes.push({itemId,patch:obcClone(patch),at:new Date().toISOString()});draft.updatedAt=new Date().toISOString();saveDraft(draft);return draft; },
        validateDraft(id){ const draft=getDraft(id); const trader=draft.baseBundle.traders.traders.find(t=>t.id===draft.traderId); if(!trader||new Set(trader.soldItems.map(x=>x.itemId)).size!==trader.soldItems.length)throw Object.assign(new Error('DRAFT_INVALID'),{statusCode:400}); for(const r of trader.soldItems){if(!Number.isFinite(Number(r.buyPrice))||Number(r.buyPrice)<0||!Number.isFinite(Number(r.sellPrice))||Number(r.sellPrice)<0)throw Object.assign(new Error('INVALID_PRICE'),{statusCode:400});} draft.status='VALIDATED';draft.validatedAt=new Date().toISOString();saveDraft(draft);return draft; },
        publishDraft(id){ const draft=this.validateDraft(id), releaseId=`release-${uuidv4()}`, dir=path.join(releasesRoot,releaseId), manifest={schemaVersion:1,releaseId,mode:'export-only',createdAt:new Date().toISOString(),files:[]}; for(const [releasePath,key] of Object.entries(OBC_PATHS)){const text=JSON.stringify(draft.baseBundle[key],null,2)+'\n';obcAtomicWrite(path.join(dir,releasePath),text);manifest.files.push({releasePath,targetKey:`oblivion-control-${key==='items'?'catalog':key}`,sha256:obcHash(text),restartPolicy:'pending-restart'});}obcAtomicWrite(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');const record={releaseId,status:'PENDING_SERVER_APPLY',createdAt:manifest.createdAt,manifest,draftId:id,snapshotImmutable:true};saveRecord(record);draft.status='PUBLISHED';draft.releaseId=releaseId;saveDraft(draft);return record; },
        listRecords, getRecord,
        latest(){return listRecords()[0]||null;},
        manifest(id){const record=getRecord(id);const manifest=obcReadJson(path.join(releasesRoot,id,'manifest.json'));if(manifest.releaseId!==record.releaseId)throw new Error('RELEASE_MANIFEST_ID_MISMATCH');return manifest;},
        file(id,key){if(!obcId(key))throw Object.assign(new Error('RELEASE_FILE_UNKNOWN_KEY'),{statusCode:404});const entry=this.manifest(id).files.find(x=>x.targetKey===key);if(!entry||!Object.hasOwn(OBC_PATHS,entry.releasePath))throw Object.assign(new Error('RELEASE_FILE_UNKNOWN_KEY'),{statusCode:404});const bytes=fs.readFileSync(path.join(releasesRoot,id,entry.releasePath));if(obcHash(bytes)!==entry.sha256)throw new Error('RELEASE_FILE_HASH_MISMATCH');return {entry,bytes};},
        requestRollback(id){const record=getRecord(id);record.status='ROLLBACK_PENDING';record.rollbackRequestedAt=new Date().toISOString();saveRecord(record);return record;},
        pending(){return listRecords().filter(x=>x.status==='ROLLBACK_PENDING');},
        status(){const s=fs.existsSync(statusFile)?obcReadJson(statusFile):{status:'OFFLINE'};const online=s.heartbeatAt&&Date.now()-Date.parse(s.heartbeatAt)<=120000;return {...s,online:!!online,connection:online?'ONLINE':'OFFLINE'};},
        heartbeat(input){const s={serverId:String(input.serverId||process.env.OBC_SERVER_ID||'oblivion-production'),currentReleaseId:input.currentReleaseId||null,status:input.status||'UNKNOWN',lastApply:input.lastApply||null,rolledBackReleaseId:input.rolledBackReleaseId||null,restoredReleaseId:input.restoredReleaseId||null,completedAt:input.completedAt||null,heartbeatAt:new Date().toISOString()};obcAtomicWrite(statusFile,JSON.stringify(s,null,2)+'\n');if(s.rolledBackReleaseId){const r=getRecord(s.rolledBackReleaseId);r.status='ROLLED_BACK';r.rolledBackAt=s.completedAt||s.heartbeatAt;r.restoredReleaseId=s.restoredReleaseId;saveRecord(r);}return s;}
    };
}
const obc = createOblivionControl();
function requireObcCapability(capability) { return async (req,res,next) => { if(req.user.role==='super_admin')return next(); const caps=await getEffectiveCapabilities(req.user.id,req.user.role); if(!caps.includes(capability))return res.status(403).json({error:'Forbidden: Missing Oblivion capability'}); next(); }; }
function obcBridgeAuth(req,res,next) { const supplied=req.headers['x-obc-bridge-token']; const expected=OBC_BRIDGE_TOKEN; if(!expected||typeof supplied!=='string'||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return res.status(401).json({error:'BRIDGE_AUTH_REQUIRED'});next(); }

function requireFaction(...allowedCodes) {
    return (req, res, next) => {
        if (req.user.role === 'super_admin') return next();
        if (!allowedCodes.includes(req.user.factionCode)) return res.status(403).json({ error: 'Forbidden: Wrong faction' });
        next();
    };
}

function getFactionScope(req) {
    if (req.user.role === 'super_admin') return req.query.faction_id ? parseInt(req.query.faction_id) : null;
    return req.user.factionId;
}

function getAppToday() {
    const timeZone = process.env.APP_TIMEZONE || 'America/Maceio';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());

    const byType = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

function isValidIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [y, m, d] = String(value).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function canManageGeneralBank(req) {
    return req.user.role === 'super_admin' || req.user.role === 'faction_admin';
}

// ==========================================
// ROUTES
// ==========================================

// --- PUBLIC ---
app.get('/', (req, res) => res.redirect('/index.html'));

const contractSchema = z.object({
    clientName: z.string().min(2).max(100),
    contact: z.string().max(200).optional(),
    discord: z.string().max(100).optional(),
    missionType: z.string().max(100).optional(),
    location: z.string().max(200).optional(),
    objective: z.string().max(500).optional(),
    description: z.string().max(2000).optional(),
    target: z.string().max(500).optional(),
    operatorEstimate: z.number().min(1).max(100).optional(),
    riskLevel: z.enum(['low', 'medium', 'high', 'extreme']).optional(),
    desiredDate: z.string().max(50).optional(),
    reward: z.string().max(500).optional(),
    additionalInfo: z.string().max(2000).optional(),
    honeypot: z.string().optional()
});

app.post('/api/public/contracts', publicFormLimiter, async (req, res, next) => {
    try {
        const data = contractSchema.parse(req.body);
        if (data.honeypot) return res.json({ success: true }); // Anti-spam silent reject
        
        const lastIdRow = await dbGet(`SELECT MAX(id) as maxId FROM mercenary_contracts`);
        const nextId = (lastIdRow.maxId || 0) + 1;
        const publicCode = `MRC-${String(nextId).padStart(6, '0')}`;
        
        await dbRun(`INSERT INTO mercenary_contracts (public_code, client_name, contact, discord, mission_type, location, objective, description, target, operator_estimate, risk_level, desired_date, reward, additional_info, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW')`,
            [publicCode, data.clientName, data.contact, data.discord, data.missionType, data.location, data.objective, data.description, data.target, data.operatorEstimate, data.riskLevel, data.desiredDate, data.reward, data.additionalInfo]);
        
        await auditLog({ action: 'CREATE_CONTRACT', entity: 'mercenary_contracts', metadata: { publicCode } });
        await sendDiscordNotification({ title: 'New Contract Form', description: `Code: ${publicCode}`, color: 3447003 });
        
        res.json({ success: true, code: publicCode });
    } catch (err) { next(err); }
});

// --- AUTH ---
app.post('/api/login', loginLimiter, async (req, res, next) => {
    try {
        const { username, password } = z.object({ username: z.string(), password: z.string() }).parse(req.body);
        const user = await dbGet(`SELECT u.*, f.code as factionCode, f.slug as factionSlug, f.theme_config as factionTheme, f.active as factionActive 
            FROM users u LEFT JOIN factions f ON u.faction_id = f.id WHERE u.username = ?`, [username]);
        
        if (!user || user.active !== 1 || (user.faction_id && user.factionActive !== 1)) {
            await auditLog({ action: 'LOGIN_FAILED', metadata: { username }, ipAddress: req.ip });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            await auditLog({ action: 'LOGIN_FAILED', metadata: { username }, ipAddress: req.ip });
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ id: user.id, role: user.role, factionId: user.faction_id, factionCode: user.factionCode, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
        await dbRun(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?`, [user.id]);
        await auditLog({ userId: user.id, factionId: user.faction_id, action: 'LOGIN', ipAddress: req.ip });
        await sendDiscordNotification({ title: 'User Logged In', description: `${user.username} logged in.` });
        
        const capabilities = await getEffectiveCapabilities(user.id, user.role);
        res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role, factionId: user.faction_id, factionCode: user.factionCode, factionSlug: user.factionSlug, factionTheme: JSON.parse(user.factionTheme || '{}'), capabilities } });
    } catch (err) { next(err); }
});

// --- FACTIONS ---
app.get('/api/factions', auth, requireCapability('faction:manage'), async (req, res) => {
    const factions = await dbAll(`SELECT * FROM factions`);
    res.json(factions);
});

app.get('/api/factions/mine', auth, async (req, res) => {
    if (!req.user.factionId) return res.json(null);
    const faction = await dbGet(`SELECT * FROM factions WHERE id = ?`, [req.user.factionId]);
    res.json(faction);
});

app.put('/api/factions/:id', auth, requireCapability('faction:manage'), async (req, res) => {
    const { name, active, theme_config, public_form_enabled } = req.body;
    await dbRun(`UPDATE factions SET name = ?, active = ?, theme_config = ?, public_form_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [name, active, JSON.stringify(theme_config), public_form_enabled, req.params.id]);
    await auditLog({ userId: req.user.id, action: 'UPDATE_FACTION', entityId: req.params.id });
    res.json({ success: true });
});

app.put('/api/factions/:id/toggle', auth, requireCapability('faction:manage'), async (req, res) => {
    const f = await dbGet(`SELECT active FROM factions WHERE id = ?`, [req.params.id]);
    const nextState = f.active === 1 ? 0 : 1;
    await dbRun(`UPDATE factions SET active = ? WHERE id = ?`, [nextState, req.params.id]);
    await auditLog({ userId: req.user.id, action: 'TOGGLE_FACTION', entityId: req.params.id });
    await sendDiscordNotification({ title: 'Faction Toggled', description: `Faction ${req.params.id} active set to ${nextState}` });
    res.json({ success: true, active: nextState });
});

app.get('/api/factions/:id/modules', auth, async (req, res) => {
    const modules = await dbAll(`SELECT * FROM faction_modules WHERE faction_id = ?`, [req.params.id]);
    res.json(modules);
});

// --- USERS ---
app.get('/api/users', auth, async (req, res) => {
    const factionId = getFactionScope(req);
    const params = factionId ? [factionId] : [];
    const users = await dbAll(`SELECT u.id, u.username, u.name, u.faction_id, u.role, u.active, u.last_login_at, f.name as faction_name FROM users u LEFT JOIN factions f ON u.faction_id = f.id ${factionId ? 'WHERE u.faction_id = ?' : ''}`, params);
    res.json(users);
});

app.post('/api/users', auth, requireCapability('users:manage'), async (req, res, next) => {
    try {
        const schema = z.object({
            username: z.string().trim().min(3).max(50),
            password: z.string().min(6).max(72),
            name: z.string().trim().min(2).max(100),
            role: z.enum(['viewer', 'operator', 'commander', 'faction_admin', 'super_admin']),
            factionId: z.coerce.number().int().positive().nullable().optional()
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Dados do usuário inválidos.',
                details: parsed.error.issues.map(issue => issue.message)
            });
        }

        const { username, password, name, role, factionId = null } = parsed.data;

        if (role === 'super_admin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Apenas o Super Admin pode criar outro Super Admin.' });
        }

        // Super Admin inside a faction page inherits the selected faction context
        // when the form itself does not send factionId.
        const contextFaction = getFactionScope(req);
        const targetFaction = role === 'super_admin'
            ? null
            : (req.user.role === 'super_admin'
                ? (factionId || contextFaction)
                : req.user.factionId);

        if (role !== 'super_admin' && !targetFaction) {
            return res.status(400).json({ error: 'Selecione uma facção para este usuário.' });
        }

        if (targetFaction) {
            const faction = await dbGet(`SELECT id, active FROM factions WHERE id=?`, [targetFaction]);
            if (!faction) return res.status(400).json({ error: 'Facção selecionada não existe.' });
        }

        const duplicate = await dbGet(
            `SELECT id FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`,
            [username]
        );
        if (duplicate) {
            return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await dbRun(
            `INSERT INTO users (username, password_hash, name, faction_id, role, active)
             VALUES (?, ?, ?, ?, ?, 1)`,
            [username, hash, name, targetFaction, role]
        );

        await auditLog({
            userId: req.user.id,
            factionId: targetFaction,
            action: 'CREATE_USER',
            entity: 'users',
            entityId: result.lastID,
            metadata: { username, role, factionId: targetFaction }
        });

        const created = await dbGet(
            `SELECT u.id,u.username,u.name,u.faction_id,u.role,u.active,f.name AS faction_name
             FROM users u LEFT JOIN factions f ON f.id=u.faction_id WHERE u.id=?`,
            [result.lastID]
        );

        res.status(201).json({ success: true, user: created });
    } catch (e) {
        console.error('CREATE USER ERROR:', e);
        next(e);
    }
});

app.put('/api/users/:id', auth, requireCapability('users:manage'), async (req, res, next) => {
    try {
        const current = await dbGet(`SELECT * FROM users WHERE id=?`, [req.params.id]);
        if (!current) return res.status(404).json({ error: 'Usuário não encontrado.' });

        // Non-super-admin managers may only manage users from their own faction.
        if (req.user.role !== 'super_admin' && current.faction_id !== req.user.factionId) {
            return res.status(403).json({ error: 'Você só pode gerenciar usuários da sua própria facção.' });
        }

        const nextUsername = req.body.username !== undefined ? String(req.body.username).trim() : current.username;
        const nextName = req.body.name !== undefined ? String(req.body.name).trim() : current.name;
        const nextRole = req.body.role !== undefined ? req.body.role : current.role;
        const nextActive = req.body.active !== undefined ? (Number(req.body.active) ? 1 : 0) : current.active;

        if (!['viewer','operator','commander','faction_admin','super_admin'].includes(nextRole)) {
            return res.status(400).json({ error: 'Cargo inválido.' });
        }
        if (nextRole === 'super_admin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Apenas o Super Admin pode atribuir este cargo.' });
        }

        const contextFaction = getFactionScope(req);
        let nextFaction;
        if (nextRole === 'super_admin') {
            nextFaction = null;
        } else if (req.user.role === 'super_admin') {
            const suppliedFaction = req.body.factionId ?? req.body.faction_id;
            nextFaction = suppliedFaction ? Number(suppliedFaction) : (current.faction_id || contextFaction);
        } else {
            nextFaction = req.user.factionId;
        }

        if (nextRole !== 'super_admin' && !nextFaction) {
            return res.status(400).json({ error: 'Usuário precisa estar vinculado a uma facção.' });
        }

        const duplicate = await dbGet(
            `SELECT id FROM users WHERE username=? COLLATE NOCASE AND id<>? LIMIT 1`,
            [nextUsername, req.params.id]
        );
        if (duplicate) return res.status(409).json({ error: 'Este nome de usuário já está em uso.' });

        let sql = `UPDATE users SET username=?, name=?, role=?, faction_id=?, active=?, updated_at=CURRENT_TIMESTAMP`;
        const params = [nextUsername, nextName, nextRole, nextFaction, nextActive];

        if (req.body.password) {
            if (String(req.body.password).length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
            const hash = await bcrypt.hash(String(req.body.password), 10);
            sql += `, password_hash=?`;
            params.push(hash);
        }

        sql += ` WHERE id=?`;
        params.push(req.params.id);
        await dbRun(sql, params);

        await auditLog({
            userId:req.user.id,
            factionId:nextFaction,
            action:'UPDATE_USER',
            entity:'users',
            entityId:req.params.id,
            metadata:{ username:nextUsername, role:nextRole, active:nextActive }
        });

        res.json({ success:true });
    } catch(e) {
        console.error('UPDATE USER ERROR:', e);
        next(e);
    }
});

app.delete('/api/users/:id', auth, requireSuperAdminDelete, requireCapability('users:manage'), async (req, res, next) => {
    try {
        const targetId = parseInt(req.params.id, 10);

        if (!Number.isInteger(targetId)) {
            return res.status(400).json({ error: 'Usuário inválido.' });
        }

        if (targetId === req.user.id) {
            return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
        }

        const targetUser = await dbGet(
            `SELECT id, username, faction_id, role FROM users WHERE id = ?`,
            [targetId]
        );

        if (!targetUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        // Faction Admin may only manage users from their own faction.
        if (req.user.role !== 'super_admin') {
            if (!req.user.factionId || targetUser.faction_id !== req.user.factionId) {
                return res.status(403).json({
                    error: 'Você só pode excluir usuários da sua própria facção.'
                });
            }

            if (targetUser.role === 'super_admin') {
                return res.status(403).json({
                    error: 'Faction Admin não pode excluir um Super Admin.'
                });
            }
        }

        await dbRun(`DELETE FROM users WHERE id = ?`, [targetId]);

        await auditLog({
            userId: req.user.id,
            factionId: targetUser.faction_id,
            action: 'DELETE_USER',
            entity: 'users',
            entityId: targetId,
            metadata: { username: targetUser.username }
        });

        res.json({ success: true, deleted: true });
    } catch (e) {
        next(e);
    }
});

// --- MEMBROS (LEGACY USERS) ---
app.get('/api/membros', auth, async (req, res) => {
    const factionId = getFactionScope(req);
    const params = factionId ? [factionId] : [];
    const users = await dbAll(`SELECT id, name as nome, username as usuario, role FROM users ${factionId ? 'WHERE faction_id = ?' : ''}`, params);
    res.json(users);
});

app.post('/api/membros', auth, requireCapability('users:manage'), async (req, res, next) => {
    try {
        const factionId = getFactionScope(req) || 2;
        const hash = await bcrypt.hash(req.body.senha, 10);
        await dbRun(`INSERT INTO users (username, password_hash, name, faction_id, role) VALUES (?, ?, ?, ?, ?)`,
            [req.body.usuario, hash, req.body.nome, factionId, req.body.role || 'operator']);
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.put('/api/membros/:id', auth, requireCapability('users:manage'), async (req, res, next) => {
    try {
        if (req.body.senha) {
            const hash = await bcrypt.hash(req.body.senha, 10);
            await dbRun(`UPDATE users SET username=?, password_hash=?, name=?, role=? WHERE id=?`,
                [req.body.usuario, hash, req.body.nome, req.body.role || 'operator', req.params.id]);
        } else {
            await dbRun(`UPDATE users SET username=?, name=?, role=? WHERE id=?`,
                [req.body.usuario, req.body.nome, req.body.role || 'operator', req.params.id]);
        }
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.delete('/api/membros/:id', auth, requireSuperAdminDelete, requireCapability('users:manage'), async (req, res, next) => {
    try {
        const targetId = parseInt(req.params.id, 10);

        if (!Number.isInteger(targetId)) {
            return res.status(400).json({ error: 'Usuário inválido.' });
        }

        if (targetId === req.user.id) {
            return res.status(400).json({ error: 'Você não pode excluir sua própria conta.' });
        }

        const targetUser = await dbGet(
            `SELECT id, username, faction_id, role FROM users WHERE id = ?`,
            [targetId]
        );

        if (!targetUser) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        if (req.user.role !== 'super_admin') {
            if (!req.user.factionId || targetUser.faction_id !== req.user.factionId) {
                return res.status(403).json({
                    error: 'Você só pode excluir usuários da sua própria facção.'
                });
            }

            if (targetUser.role === 'super_admin') {
                return res.status(403).json({
                    error: 'Faction Admin não pode excluir um Super Admin.'
                });
            }
        }

        await dbRun(`DELETE FROM users WHERE id = ?`, [targetId]);

        await auditLog({
            userId: req.user.id,
            factionId: targetUser.faction_id,
            action: 'DELETE_USER',
            entity: 'users',
            entityId: targetId,
            metadata: { username: targetUser.username, legacyRoute: true }
        });

        res.json({ success: true, deleted: true });
    } catch (e) {
        next(e);
    }
});

// --- STALKERS ---
app.get('/api/stalkers', auth, requireCapability('stalkers:read'), async (req, res) => {
    const factionId = getFactionScope(req);
    const params = factionId ? [factionId] : [];
    const rows = await dbAll(`SELECT * FROM stalkers ${factionId ? 'WHERE faction_id = ?' : ''}`, params);
    res.json(rows);
});

app.post('/api/stalkers', auth, requireCapability('stalkers:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const fId = getFactionScope(req) || 2;
        const foto = req.file ? `/uploads/${req.file.filename}` : null;
        await dbRun(`INSERT INTO stalkers (nome, codinome, faccao, foto, rumores, area_atuacao, aliados, inimigos, relacoes_faccoes, reputacao, faction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            [req.body.nome, req.body.codinome, req.body.faccao, foto, req.body.rumores, req.body.area_atuacao, req.body.aliados, req.body.inimigos, req.body.relacoes_faccoes, fId]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.put('/api/stalkers/:id', auth, requireCapability('stalkers:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        let sql = `UPDATE stalkers SET nome=?, codinome=?, faccao=?, rumores=?, area_atuacao=?, aliados=?, inimigos=?, relacoes_faccoes=? WHERE id=?`;
        let params = [req.body.nome, req.body.codinome, req.body.faccao, req.body.rumores, req.body.area_atuacao, req.body.aliados, req.body.inimigos, req.body.relacoes_faccoes, req.params.id];
        if (req.file) {
            sql = `UPDATE stalkers SET nome=?, codinome=?, faccao=?, rumores=?, area_atuacao=?, aliados=?, inimigos=?, relacoes_faccoes=?, foto=? WHERE id=?`;
            params = [req.body.nome, req.body.codinome, req.body.faccao, req.body.rumores, req.body.area_atuacao, req.body.aliados, req.body.inimigos, req.body.relacoes_faccoes, `/uploads/${req.file.filename}`, req.params.id];
        }
        await dbRun(sql, params);
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.delete('/api/stalkers/:id', auth, requireSuperAdminDelete, requireCapability('stalkers:manage'), async (req, res) => {
    await dbRun(`DELETE FROM stalkers WHERE id=?`, [req.params.id]);
    res.json({ success: true });
});

app.post('/api/stalkers/:id/banir', auth, requireCapability('stalkers:manage'), async (req, res) => {
    await dbRun(`UPDATE stalkers SET status_lista_negra=1, motivo_lista_negra=? WHERE id=?`, [req.body.motivo, req.params.id]);
    res.json({ success: true });
});

app.post('/api/stalkers/:id/perdoar', auth, requireCapability('stalkers:manage'), async (req, res) => {
    await dbRun(`UPDATE stalkers SET status_lista_negra=0, motivo_lista_negra='' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
});

app.post('/api/presenca', auth, requireCapability('stalkers:manage'), async (req, res, next) => {
    try {
        const { stalker_id } = req.body;
        const fId = getFactionScope(req) || 2;
        const stalker = await dbGet(`SELECT reputacao FROM stalkers WHERE id=?`, [stalker_id]);
        if (!stalker) return res.status(404).json({ error: 'Stalker not found' });
        const newRep = Math.min(5000, (stalker.reputacao || 0) + 10);
        await dbRun(`UPDATE stalkers SET reputacao=?, presencas = IFNULL(presencas,0)+1, ultimo_checkin=CURRENT_TIMESTAMP WHERE id=?`, [newRep, stalker_id]);
        await dbRun(`INSERT INTO historico (stalker_id, acao, valor, motivo, faction_id) VALUES (?, 'Check-in Diário', 10, 'Presença registrada', ?)`, [stalker_id, fId]);
        res.json({ success: true, novaReputacao: newRep });
    } catch (e) { next(e); }
});

app.post('/api/reputacao', auth, requireCapability('stalkers:manage'), async (req, res, next) => {
    try {
        const { stalker_id, valor, motivo } = req.body;
        const fId = getFactionScope(req) || 2;
        await dbRun(`UPDATE stalkers SET reputacao = IFNULL(reputacao,0) + ? WHERE id=?`, [valor, stalker_id]);
        await dbRun(`INSERT INTO historico (stalker_id, acao, valor, motivo, faction_id) VALUES (?, 'Ajuste Manual', ?, ?, ?)`, [stalker_id, valor, motivo, fId]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/api/transacao', auth, requireCapability('stalkers:manage'), async (req, res, next) => {
    try {
        const { stalker_id, motivo, tipo, reputacao_extra } = req.body;
        const fId = getFactionScope(req) || 2;
        await dbRun(`UPDATE stalkers SET reputacao = IFNULL(reputacao,0) + ? WHERE id=?`, [reputacao_extra || 0, stalker_id]);
        await dbRun(`INSERT INTO historico (stalker_id, acao, valor, motivo, faction_id) VALUES (?, ?, ?, ?, ?)`, [stalker_id, tipo, reputacao_extra || 0, motivo, fId]);
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.get('/api/historico/:id', auth, async (req, res) => {
    res.json(await dbAll(`SELECT * FROM historico WHERE stalker_id=? ORDER BY id DESC`, [req.params.id]));
});

// --- MERCENARY CONTRACTS ---
function hasMercenaryAccess(req) {
    return req.user.role === 'super_admin' || req.user.factionCode === 'mercenaries';
}

function isMercenaryLeader(req) {
    return req.user.role === 'super_admin' ||
        (req.user.factionCode === 'mercenaries' && req.user.role === 'faction_admin');
}

app.get('/api/contracts', auth, requireCapability('contracts:read'), async (req, res) => {
    if (!hasMercenaryAccess(req)) {
        return res.status(403).json({ error: 'Contratos são exclusivos dos Mercenários.' });
    }
    const rows = await dbAll(`SELECT * FROM mercenary_contracts ORDER BY created_at DESC, id DESC`);
    res.json(rows);
});

app.get('/api/contracts/:id', auth, requireCapability('contracts:read'), async (req, res) => {
    if (!hasMercenaryAccess(req)) {
        return res.status(403).json({ error: 'Contratos são exclusivos dos Mercenários.' });
    }
    const row = await dbGet(`SELECT * FROM mercenary_contracts WHERE id = ?`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Contrato não encontrado.' });
    res.json(row);
});

app.put('/api/contracts/:id/status', auth, requireCapability('contracts:update'), async (req, res) => {
    if (!isMercenaryLeader(req)) {
        return res.status(403).json({ error: 'Apenas o líder dos Mercenários pode alterar o status de contratos.' });
    }

    const current = await dbGet(
        `SELECT id, status FROM mercenary_contracts WHERE id = ?`,
        [req.params.id]
    );

    if (!current) {
        return res.status(404).json({ error: 'Contrato não encontrado.' });
    }

    const terminalStatuses = ['SUSPENDED', 'COMPLETED', 'REJECTED'];

    if (terminalStatuses.includes(current.status)) {
        return res.status(409).json({
            error: 'Este contrato está em um status final e não pode mais ser alterado.'
        });
    }

    const nextStatus = String(req.body.status || '').toUpperCase();
    const transitions = {
        NEW: ['ACCEPTED', 'SUSPENDED', 'COMPLETED', 'REJECTED'],
        ACCEPTED: ['SUSPENDED', 'COMPLETED', 'REJECTED']
    };

    const allowedNext = transitions[current.status] || [];

    if (!allowedNext.includes(nextStatus)) {
        return res.status(400).json({
            error: 'Transição de status não permitida.'
        });
    }

    await dbRun(
        `UPDATE mercenary_contracts
         SET status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [nextStatus, req.params.id]
    );

    await auditLog({
        userId: req.user.id,
        factionId: req.user.factionId,
        action: 'UPDATE_CONTRACT_STATUS',
        entity: 'mercenary_contracts',
        entityId: req.params.id,
        metadata: { previousStatus: current.status, status: nextStatus }
    });

    res.json({ success: true, status: nextStatus });
});

app.post('/api/contracts/:id/notes', auth, requireCapability('contracts:update'), async (req, res) => {
    if (!hasMercenaryAccess(req)) {
        return res.status(403).json({ error: 'Contratos são exclusivos dos Mercenários.' });
    }
    await dbRun(
        `INSERT INTO contract_notes (contract_id, user_id, message) VALUES (?, ?, ?)`,
        [req.params.id, req.user.id, req.body.message]
    );
    res.json({ success: true });
});

app.get('/api/contracts/:id/notes', auth, requireCapability('contracts:read'), async (req, res) => {
    if (!hasMercenaryAccess(req)) {
        return res.status(403).json({ error: 'Contratos são exclusivos dos Mercenários.' });
    }
    const notes = await dbAll(
        `SELECT n.*, u.name as userName
         FROM contract_notes n
         JOIN users u ON n.user_id = u.id
         WHERE contract_id = ?
         ORDER BY n.created_at ASC`,
        [req.params.id]
    );
    res.json(notes);
});

// --- ITEMS & INVENTORY ---
app.get('/api/itens', auth, requireCapability('items:read'), async (req, res) => {
    const fId = getFactionScope(req);
    const params = fId ? [fId] : [];
    res.json(await dbAll(`SELECT * FROM itens ${fId ? 'WHERE faction_id = ?' : ''}`, params));
});
app.post('/api/itens', auth, requireCapability('items:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const fId = getFactionScope(req) || 2;
        const nome = req.body.nome || '';
        const tipo = req.body.tipo || req.body.categoria || 'Item';
        const quantidade = Number(req.body.quantidade || 1);
        const valorBase = Number(req.body.valor_base ?? req.body.preco_base ?? 0);
        const foto = req.file ? `/uploads/${req.file.filename}` : '';
        const nivel = Number(req.body.nivel_minimo || req.body.nivel_piaget || 1);

        const cols = await getTableColumns('itens');
        const fields = ['nome','tipo','quantidade','valor_base','faction_id'];
        const values = [nome,tipo,quantidade,valorBase,fId];

        if (cols.includes('foto')) { fields.push('foto'); values.push(foto); }
        if (cols.includes('categoria')) { fields.push('categoria'); values.push(tipo); }
        if (cols.includes('preco_base')) { fields.push('preco_base'); values.push(valorBase); }
        if (cols.includes('nivel_piaget')) { fields.push('nivel_piaget'); values.push(nivel); }

        const placeholders = fields.map(() => '?').join(',');
        const result = await dbRun(
            `INSERT INTO itens (${fields.join(',')}) VALUES (${placeholders})`,
            values
        );

        await auditLog({
            userId:req.user.id,
            factionId:fId,
            action:'CREATE_ITEM',
            entity:'itens',
            entityId:result.lastID,
            metadata:{ nome, tipo }
        });

        res.status(201).json({ success:true, id:result.lastID });
    } catch (e) { next(e); }
});
app.put('/api/itens/:id', auth, requireCapability('items:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const nome = req.body.nome || '';
        const tipo = req.body.tipo || req.body.categoria || 'Item';
        const quantidade = Number(req.body.quantidade || 1);
        const valorBase = Number(req.body.valor_base ?? req.body.preco_base ?? 0);
        const nivel = Number(req.body.nivel_minimo || req.body.nivel_piaget || 1);

        const cols = await getTableColumns('itens');
        const sets = ['nome=?','tipo=?','quantidade=?','valor_base=?'];
        const values = [nome,tipo,quantidade,valorBase];

        if (cols.includes('categoria')) { sets.push('categoria=?'); values.push(tipo); }
        if (cols.includes('preco_base')) { sets.push('preco_base=?'); values.push(valorBase); }
        if (cols.includes('nivel_piaget')) { sets.push('nivel_piaget=?'); values.push(nivel); }
        if (req.file && cols.includes('foto')) { sets.push('foto=?'); values.push(`/uploads/${req.file.filename}`); }

        values.push(req.params.id);
        await dbRun(`UPDATE itens SET ${sets.join(', ')} WHERE id=?`, values);

        await auditLog({
            userId:req.user.id,
            factionId:getFactionScope(req),
            action:'UPDATE_ITEM',
            entity:'itens',
            entityId:req.params.id,
            metadata:{ nome, tipo }
        });

        res.json({ success:true });
    } catch (e) { next(e); }
});
app.delete('/api/itens/:id', auth, requireSuperAdminDelete, requireCapability('items:manage'), async (req, res) => {
    const row = await dbGet(`SELECT id,nome FROM itens WHERE id=?`, [req.params.id]);
    if (!row) return res.status(404).json({ error:'Item não encontrado.' });
    await dbRun(`DELETE FROM itens WHERE id=?`, [req.params.id]);
    await auditLog({userId:req.user.id,factionId:getFactionScope(req),action:'DELETE_ITEM',entity:'itens',entityId:req.params.id,metadata:{nome:row.nome}});
    res.json({ success: true, deleted:true });
});
app.post('/api/itens/importar', auth, requireCapability('items:manage'), async (req, res, next) => {
    try {
        const fId = getFactionScope(req) || 2;
        const defaultItems = [
            {nome:'Medkit', tipo:'Consumível', quantidade:10, valor_base:500},
            {nome:'Bandage', tipo:'Consumível', quantidade:20, valor_base:100},
            {nome:'Antirad', tipo:'Consumível', quantidade:5, valor_base:300}
        ];
        for (const it of defaultItems) {
            await dbRun(`INSERT INTO itens (nome, tipo, quantidade, valor_base, faction_id) VALUES (?, ?, ?, ?, ?)`,
                [it.nome, it.tipo, it.quantidade, it.valor_base, fId]);
        }
        res.json({ success: true });
    } catch (e) { next(e); }
});

// --- MISSIONS ---
app.get('/api/missoes', auth, requireCapability('missions:read'), async (req, res) => {
    const fId = getFactionScope(req);
    res.json(await dbAll(`SELECT * FROM missoes ${fId ? 'WHERE faction_id = ?' : ''}`, fId ? [fId] : []));
});
app.post('/api/missoes', auth, requireCapability('missions:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const fId = getFactionScope(req) || 2;
        const foto = req.file ? `/uploads/${req.file.filename}` : '';
        const result = await dbRun(
            `INSERT INTO missoes (titulo, descricao, recompensa, status, faction_id, foto)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.body.titulo, req.body.descricao, Number(req.body.recompensa || 0), 'pendente', fId, foto]
        );
        await auditLog({userId:req.user.id,factionId:fId,action:'CREATE_MISSION',entity:'missoes',entityId:result.lastID});
        res.status(201).json({ success:true, id:result.lastID });
    } catch(e) { next(e); }
});
app.put('/api/missoes/:id', auth, requireCapability('missions:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        if (req.file) {
            await dbRun(
                `UPDATE missoes SET titulo=?, descricao=?, recompensa=?, status=?, foto=? WHERE id=?`,
                [req.body.titulo, req.body.descricao, Number(req.body.recompensa || 0), req.body.status || 'pendente', `/uploads/${req.file.filename}`, req.params.id]
            );
        } else {
            await dbRun(
                `UPDATE missoes SET titulo=?, descricao=?, recompensa=?, status=? WHERE id=?`,
                [req.body.titulo, req.body.descricao, Number(req.body.recompensa || 0), req.body.status || 'pendente', req.params.id]
            );
        }
        res.json({ success:true });
    } catch(e) { next(e); }
});
app.delete('/api/missoes/:id', auth, requireSuperAdminDelete, requireCapability('missions:manage'), async (req, res) => {
    const row = await dbGet(`SELECT id,titulo FROM missoes WHERE id=?`, [req.params.id]);
    if (!row) return res.status(404).json({ error:'Missão não encontrada.' });
    await dbRun(`DELETE FROM missoes WHERE id=?`, [req.params.id]);
    await auditLog({userId:req.user.id,factionId:getFactionScope(req),action:'DELETE_MISSION',entity:'missoes',entityId:req.params.id,metadata:{titulo:row.titulo}});
    res.json({ success: true, deleted:true });
});
app.put('/api/missoes/:id/atribuir', auth, requireCapability('missions:manage'), async (req, res) => {
    await dbRun(`UPDATE missoes SET stalker_id=?, status='em andamento' WHERE id=?`, [req.body.stalker_id, req.params.id]);
    res.json({ success: true });
});
app.post('/api/missoes/:id/concluir_individual/:stalker_id', auth, requireCapability('missions:manage'), async (req, res) => {
    await dbRun(`UPDATE missoes SET status='concluida' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
});
app.post('/api/missoes/:id/abortar/:stalker_id', auth, requireCapability('missions:manage'), async (req, res) => {
    await dbRun(`UPDATE missoes SET status='pendente', stalker_id=NULL WHERE id=?`, [req.params.id]);
    res.json({ success: true });
});
app.post('/api/missoes/:id/encerrar_mural', auth, requireCapability('missions:manage'), async (req, res) => {
    await dbRun(`UPDATE missoes SET status='encerrada' WHERE id=?`, [req.params.id]);
    res.json({ success: true });
});

// --- RESEARCH (PESQUISAS) ---
app.get('/api/pesquisas', auth, requireCapability('research:read'), async (req, res) => {
    const fId = getFactionScope(req);
    res.json(await dbAll(`SELECT * FROM pesquisas ${fId ? 'WHERE faction_id = ?' : ''}`, fId ? [fId] : []));
});
app.post('/api/pesquisas', auth, requireCapability('research:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const fId = getFactionScope(req) || 2;
        const foto = req.file ? `/uploads/${req.file.filename}` : null;
        await dbRun(`INSERT INTO pesquisas (titulo, classificacao, descricao, autor, foto, faction_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [req.body.titulo, req.body.classificacao, req.body.descricao, req.body.autor, foto, fId]);
        res.json({ success: true });
    } catch (e) { next(e); }
});
app.put('/api/pesquisas/:id', auth, requireCapability('research:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        let sql = `UPDATE pesquisas SET titulo=?, classificacao=?, descricao=?, autor=? WHERE id=?`;
        let params = [req.body.titulo, req.body.classificacao, req.body.descricao, req.body.autor, req.params.id];
        if (req.file) {
            sql = `UPDATE pesquisas SET titulo=?, classificacao=?, descricao=?, autor=?, foto=? WHERE id=?`;
            params = [req.body.titulo, req.body.classificacao, req.body.descricao, req.body.autor, `/uploads/${req.file.filename}`, req.params.id];
        }
        await dbRun(sql, params);
        res.json({ success: true });
    } catch (e) { next(e); }
});
app.delete('/api/pesquisas/:id', auth, requireSuperAdminDelete, requireCapability('research:manage'), async (req, res) => {
    await dbRun(`DELETE FROM pesquisas WHERE id=?`, [req.params.id]);
    res.json({ success: true });
});

// --- REPORTS (RELATORIOS) ---
app.get('/api/relatorios', auth, requireCapability('reports:read'), async (req, res) => {
    const fId = getFactionScope(req);
    res.json(await dbAll(`SELECT * FROM relatorios ${fId ? 'WHERE faction_id = ?' : ''}`, fId ? [fId] : []));
});
app.post('/api/relatorios', auth, requireCapability('reports:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const fId = getFactionScope(req) || 2;
        const foto = req.file ? `/uploads/${req.file.filename}` : '';
        const result = await dbRun(
            `INSERT INTO relatorios
             (numero, autor, membros, objetivo, col1, col2, col3, faction_id, foto)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.body.numero, req.body.autor, req.body.membros, req.body.objetivo,
             req.body.col1, req.body.col2, req.body.col3, fId, foto]
        );
        await auditLog({
            userId:req.user.id,
            factionId:fId,
            action:'CREATE_REPORT',
            entity:'relatorios',
            entityId:result.lastID
        });
        res.status(201).json({ success:true, id:result.lastID });
    } catch (e) { next(e); }
});
app.put('/api/relatorios/:id', auth, requireCapability('reports:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const values = [
            req.body.numero, req.body.autor, req.body.membros, req.body.objetivo,
            req.body.col1, req.body.col2, req.body.col3, req.user.name
        ];
        let sql = `UPDATE relatorios
                   SET numero=?, autor=?, membros=?, objetivo=?, col1=?, col2=?, col3=?, editado_por=?`;
        if (req.file) {
            sql += `, foto=?`;
            values.push(`/uploads/${req.file.filename}`);
        }
        sql += ` WHERE id=?`;
        values.push(req.params.id);
        await dbRun(sql, values);
        res.json({ success:true });
    } catch (e) { next(e); }
});
app.delete('/api/relatorios/:id', auth, requireSuperAdminDelete, requireCapability('reports:manage'), async (req, res) => {
    const row = await dbGet(`SELECT id,numero,objetivo FROM relatorios WHERE id=?`, [req.params.id]);
    if (!row) return res.status(404).json({ error:'Relatório não encontrado.' });
    await dbRun(`DELETE FROM relatorios WHERE id=?`, [req.params.id]);
    await auditLog({userId:req.user.id,factionId:getFactionScope(req),action:'DELETE_REPORT',entity:'relatorios',entityId:req.params.id,metadata:{numero:row.numero,objetivo:row.objetivo}});
    res.json({ success: true, deleted:true });
});

// --- CONFIG / TAXAS ---
app.get('/api/config/taxas', auth, requireCapability('config:manage'), async (req, res) => {
    const fId = getFactionScope(req);
    const row = await dbGet(`SELECT * FROM configuracoes ${fId ? 'WHERE faction_id = ?' : ''} LIMIT 1`, fId ? [fId] : []);
    res.json(row || { taxa_compra: 1.0, taxa_venda: 1.0 });
});
app.put('/api/config/taxas', auth, requireCapability('config:manage'), async (req, res) => {
    const fId = getFactionScope(req) || 2;
    const { taxa_compra, taxa_venda } = req.body;
    const exists = await dbGet(`SELECT id FROM configuracoes WHERE faction_id=?`, [fId]);
    if (exists) {
        await dbRun(`UPDATE configuracoes SET taxa_compra=?, taxa_venda=? WHERE faction_id=?`, [taxa_compra, taxa_venda, fId]);
    } else {
        await dbRun(`INSERT INTO configuracoes (taxa_compra, taxa_venda, faction_id) VALUES (?, ?, ?)`, [taxa_compra, taxa_venda, fId]);
    }
    res.json({ success: true });
});

// --- FACTION-SPECIFIC RP MODULES ---
const factionModuleAccess = {
    duty: ['operators', 'arsenal', 'intel', 'logs'],
    ecologists: ['trade'],
    bandits: ['business', 'territory', 'info', 'records'],
    freedom: ['outposts', 'supplies', 'intel', 'comms'],
    mercenaries: ['operators', 'clients', 'operations', 'intel', 'archive']
};

async function resolveFactionModuleScope(req, moduleCode) {
    let factionId = req.user.factionId;

    if (req.user.role === 'super_admin') {
        factionId = req.query.faction_id ? parseInt(req.query.faction_id, 10) : null;
        if (!factionId && req.body && req.body.factionId) {
            factionId = parseInt(req.body.factionId, 10);
        }
        if (!factionId) {
            return { error: 'Selecione uma facção no contexto do Super Admin antes de usar este módulo.' };
        }
    }

    if (!factionId) return { error: 'Usuário sem facção.' };

    const faction = await dbGet(`SELECT id, code, name FROM factions WHERE id = ? AND active = 1`, [factionId]);
    if (!faction) return { error: 'Facção inválida ou desativada.' };

    const allowed = factionModuleAccess[faction.code] || [];
    if (!allowed.includes(moduleCode)) {
        return { error: `O módulo "${moduleCode}" não pertence à facção ${faction.name}.` };
    }

    return { factionId, faction };
}

function canWriteFactionRp(req) {
    return ['super_admin', 'faction_admin', 'commander'].includes(req.user.role);
}

app.get('/api/faction-records/:module', auth, async (req, res) => {
    const moduleCode = String(req.params.module || '').trim().toLowerCase();
    const scope = await resolveFactionModuleScope(req, moduleCode);
    if (scope.error) return res.status(403).json({ error: scope.error });

    const rows = await dbAll(
        `SELECT fr.*, u.name AS created_by_name
         FROM faction_records fr
         LEFT JOIN users u ON u.id = fr.created_by
         WHERE fr.faction_id = ? AND fr.module_code = ?
         ORDER BY fr.updated_at DESC, fr.id DESC`,
        [scope.factionId, moduleCode]
    );
    res.json(rows.map(r => ({ ...r, extra: JSON.parse(r.extra_json || '{}') })));
});

app.post('/api/faction-records/:module', auth, upload.single('foto'), async (req, res, next) => {
    try {
        if (!canWriteFactionRp(req)) {
            return res.status(403).json({ error: 'Seu cargo possui acesso somente de leitura neste módulo.' });
        }

        const moduleCode = String(req.params.module || '').trim().toLowerCase();
        const scope = await resolveFactionModuleScope(req, moduleCode);
        if (scope.error) return res.status(403).json({ error: scope.error });

        let bodyData = { ...req.body };
        if (typeof bodyData.extra === 'string') {
            try { bodyData.extra = JSON.parse(bodyData.extra); } catch (_) { bodyData.extra = {}; }
        }
        if (req.file) {
            bodyData.extra = { ...(bodyData.extra || {}), photo: `/uploads/${req.file.filename}` };
        }

        const schema = z.object({
            title: z.string().trim().min(2).max(120),
            category: z.string().trim().max(80).optional().default(''),
            status: z.string().trim().max(40).optional().default('ativo'),
            location: z.string().trim().max(120).optional().default(''),
            subject: z.string().trim().max(160).optional().default(''),
            description: z.string().trim().max(5000).optional().default(''),
            extra: z.record(z.any()).optional().default({})
        });

        const parsed = schema.safeParse(bodyData);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Dados inválidos.', details: parsed.error.issues.map(i => i.message) });
        }

        const d = parsed.data;
        const result = await dbRun(
            `INSERT INTO faction_records
             (faction_id, module_code, title, category, status, location, subject, description, extra_json, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [scope.factionId, moduleCode, d.title, d.category, d.status, d.location, d.subject, d.description, JSON.stringify(d.extra), req.user.id]
        );

        await auditLog({
            userId: req.user.id,
            factionId: scope.factionId,
            action: 'CREATE_FACTION_RECORD',
            entity: moduleCode,
            entityId: result.lastID
        });

        res.status(201).json({ success: true, id: result.lastID });
    } catch (e) { next(e); }
});

app.put('/api/faction-records/:module/:id', auth, upload.single('foto'), async (req, res, next) => {
    try {
        if (!canWriteFactionRp(req)) {
            return res.status(403).json({ error: 'Seu cargo possui acesso somente de leitura neste módulo.' });
        }

        const moduleCode = String(req.params.module || '').trim().toLowerCase();
        const scope = await resolveFactionModuleScope(req, moduleCode);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const current = await dbGet(
            `SELECT id, extra_json FROM faction_records WHERE id = ? AND faction_id = ? AND module_code = ?`,
            [req.params.id, scope.factionId, moduleCode]
        );
        if (!current) return res.status(404).json({ error: 'Registro não encontrado nesta facção.' });

        let bodyData = { ...req.body };
        if (typeof bodyData.extra === 'string') {
            try { bodyData.extra = JSON.parse(bodyData.extra); } catch (_) { bodyData.extra = {}; }
        }
        let existingExtra = {};
        try { existingExtra = JSON.parse(current.extra_json || '{}'); } catch (_) {}
        bodyData.extra = { ...existingExtra, ...(bodyData.extra || {}) };
        if (req.file) {
            bodyData.extra.photo = `/uploads/${req.file.filename}`;
        }

        const schema = z.object({
            title: z.string().trim().min(2).max(120),
            category: z.string().trim().max(80).optional().default(''),
            status: z.string().trim().max(40).optional().default('ativo'),
            location: z.string().trim().max(120).optional().default(''),
            subject: z.string().trim().max(160).optional().default(''),
            description: z.string().trim().max(5000).optional().default(''),
            extra: z.record(z.any()).optional().default({})
        });
        const parsed = schema.safeParse(bodyData);
        if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos.' });

        const d = parsed.data;
        await dbRun(
            `UPDATE faction_records
             SET title=?, category=?, status=?, location=?, subject=?, description=?, extra_json=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code=?`,
            [d.title, d.category, d.status, d.location, d.subject, d.description, JSON.stringify(d.extra), req.params.id, scope.factionId, moduleCode]
        );
        await auditLog({ userId:req.user.id, factionId:scope.factionId, action:'UPDATE_FACTION_RECORD', entity:moduleCode, entityId:req.params.id, metadata:{title:d.title} });
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.delete('/api/faction-records/:module/:id', auth, requireSuperAdminDelete, async (req, res, next) => {
    try {
        if (!canWriteFactionRp(req)) {
            return res.status(403).json({ error: 'Seu cargo não pode excluir registros deste módulo.' });
        }

        const moduleCode = String(req.params.module || '').trim().toLowerCase();
        const scope = await resolveFactionModuleScope(req, moduleCode);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const current = await dbGet(
            `SELECT id FROM faction_records WHERE id = ? AND faction_id = ? AND module_code = ?`,
            [req.params.id, scope.factionId, moduleCode]
        );
        if (!current) return res.status(404).json({ error: 'Registro não encontrado nesta facção.' });

        await dbRun(
            `DELETE FROM faction_records WHERE id = ? AND faction_id = ? AND module_code = ?`,
            [req.params.id, scope.factionId, moduleCode]
        );
        await auditLog({ userId:req.user.id, factionId:scope.factionId, action:'DELETE_FACTION_RECORD', entity:moduleCode, entityId:req.params.id });
        res.json({ success: true, deleted: true });
    } catch (e) { next(e); }
});

// --- ECOLOGIST RP EXPERIMENTS ---
// Fictional role-play records only; no real-world biological procedures are generated here.
async function resolveEcologistScope(req) {
    let factionId = req.user.factionId;
    if (req.user.role === 'super_admin') {
        factionId = req.query.faction_id ? parseInt(req.query.faction_id, 10) : 2;
    }
    const faction = await dbGet(`SELECT id, code, name FROM factions WHERE id = ? AND active = 1`, [factionId]);
    if (!faction || faction.code !== 'ecologists') return null;
    return faction;
}

app.get('/api/rp-experiments', auth, requireCapability('research:read'), async (req, res) => {
    const faction = await resolveEcologistScope(req);
    if (!faction) return res.status(403).json({ error: 'Experimentos RP são exclusivos dos Ecologistas.' });

    const rows = await dbAll(
        `SELECT e.*, u.name AS created_by_name
         FROM rp_experiments e
         LEFT JOIN users u ON u.id = e.created_by
         WHERE e.faction_id = ?
         ORDER BY e.updated_at DESC, e.id DESC`,
        [faction.id]
    );
    res.json(rows);
});

app.post('/api/rp-experiments', auth, requireCapability('research:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const faction = await resolveEcologistScope(req);
        if (!faction) return res.status(403).json({ error: 'Experimentos RP são exclusivos dos Ecologistas.' });

        const schema = z.object({
            title: z.string().trim().min(3).max(120),
            experimentType: z.enum(['mutante', 'artefato']),
            subject: z.string().trim().min(2).max(160),
            hypothesis: z.string().trim().max(3000).optional().default(''),
            riskLevel: z.enum(['baixo', 'moderado', 'alto', 'critico']).optional().default('baixo'),
            status: z.enum(['planejado', 'em_andamento', 'pausado', 'concluido', 'falhou']).optional().default('planejado'),
            procedureSummary: z.string().trim().max(4000).optional().default(''),
            expectedResult: z.string().trim().max(3000).optional().default(''),
            observedResult: z.string().trim().max(3000).optional().default(''),
            rpEffects: z.string().trim().max(3000).optional().default(''),
            notes: z.string().trim().max(3000).optional().default('')
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Dados do experimento inválidos.', details: parsed.error.issues.map(i => i.message) });
        }
        const d = parsed.data;

        const result = await dbRun(
            `INSERT INTO rp_experiments
             (faction_id,title,experiment_type,subject,hypothesis,risk_level,status,procedure_summary,expected_result,observed_result,rp_effects,notes,created_by,foto)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [faction.id,d.title,d.experimentType,d.subject,d.hypothesis,d.riskLevel,d.status,d.procedureSummary,d.expectedResult,d.observedResult,d.rpEffects,d.notes,req.user.id,req.file ? `/uploads/${req.file.filename}` : '']
        );
        res.status(201).json({ success: true, id: result.lastID });
    } catch (e) { next(e); }
});

app.put('/api/rp-experiments/:id', auth, requireCapability('research:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        const faction = await resolveEcologistScope(req);
        if (!faction) return res.status(403).json({ error: 'Experimentos RP são exclusivos dos Ecologistas.' });

        const current = await dbGet(`SELECT id FROM rp_experiments WHERE id=? AND faction_id=?`, [req.params.id, faction.id]);
        if (!current) return res.status(404).json({ error: 'Experimento não encontrado.' });

        const schema = z.object({
            title: z.string().trim().min(3).max(120),
            experimentType: z.enum(['mutante', 'artefato']),
            subject: z.string().trim().min(2).max(160),
            hypothesis: z.string().trim().max(3000).optional().default(''),
            riskLevel: z.enum(['baixo', 'moderado', 'alto', 'critico']).optional().default('baixo'),
            status: z.enum(['planejado', 'em_andamento', 'pausado', 'concluido', 'falhou']).optional().default('planejado'),
            procedureSummary: z.string().trim().max(4000).optional().default(''),
            expectedResult: z.string().trim().max(3000).optional().default(''),
            observedResult: z.string().trim().max(3000).optional().default(''),
            rpEffects: z.string().trim().max(3000).optional().default(''),
            notes: z.string().trim().max(3000).optional().default('')
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos.' });
        const d = parsed.data;

        await dbRun(
            `UPDATE rp_experiments SET
             title=?,experiment_type=?,subject=?,hypothesis=?,risk_level=?,status=?,procedure_summary=?,
             expected_result=?,observed_result=?,rp_effects=?,notes=?,updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=?`,
            [d.title,d.experimentType,d.subject,d.hypothesis,d.riskLevel,d.status,d.procedureSummary,
             d.expectedResult,d.observedResult,d.rpEffects,d.notes,req.params.id,faction.id]
        );
        if (req.file) {
            await dbRun(`UPDATE rp_experiments SET foto=? WHERE id=? AND faction_id=?`,
                [`/uploads/${req.file.filename}`, req.params.id, faction.id]);
        }
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.delete('/api/rp-experiments/:id', auth, requireSuperAdminDelete, requireCapability('research:manage'), async (req, res, next) => {
    try {
        const faction = await resolveEcologistScope(req);
        if (!faction) return res.status(403).json({ error: 'Experimentos RP são exclusivos dos Ecologistas.' });

        const current = await dbGet(`SELECT id FROM rp_experiments WHERE id=? AND faction_id=?`, [req.params.id, faction.id]);
        if (!current) return res.status(404).json({ error: 'Experimento não encontrado.' });

        await dbRun(`DELETE FROM rp_experiments WHERE id=? AND faction_id=?`, [req.params.id, faction.id]);
        res.json({ success: true, deleted: true });
    } catch (e) { next(e); }
});

// --- MERCENARY CLIENT PHOTOS ---
app.post('/api/mercenary/clients/:id/photo', auth, upload.single('photo'), async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Clientes são exclusivos dos Mercenários.' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Selecione uma imagem.' });
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(req.file.mimetype)) {
            return res.status(400).json({ error: 'Formato inválido. Use JPG, PNG ou WEBP.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const row = await dbGet(
            `SELECT id, extra_json FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='clients'`,
            [req.params.id, mercFactionId]
        );

        if (!row) {
            return res.status(404).json({ error: 'Cliente não encontrado.' });
        }

        const extra = JSON.parse(row.extra_json || '{}');
        extra.photo = `/uploads/${req.file.filename}`;

        await dbRun(
            `UPDATE faction_records
             SET extra_json=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='clients'`,
            [JSON.stringify(extra), req.params.id, mercFactionId]
        );

        await auditLog({
            userId: req.user.id,
            factionId: mercFactionId,
            action: 'UPDATE_MERCENARY_CLIENT_PHOTO',
            entity: 'clients',
            entityId: row.id,
            metadata: { photo: extra.photo },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, photo: extra.photo });
    } catch (e) {
        next(e);
    }
});

app.delete('/api/mercenary/clients/:id', auth, requireSuperAdminDelete, async (req, res, next) => {
    try {
        if (!isMercenaryLeader(req)) {
            return res.status(403).json({
                error: 'Apenas o líder dos Mercenários pode excluir cadastros de clientes.'
            });
        }

        const mercFactionId = await getMercenaryFactionId();
        const row = await dbGet(
            `SELECT id, title, extra_json
             FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='clients'`,
            [req.params.id, mercFactionId]
        );

        if (!row) {
            return res.status(404).json({ error: 'Cliente não encontrado.' });
        }

        let extra = {};
        try {
            extra = JSON.parse(row.extra_json || '{}');
        } catch (_) {}

        // Remove the associated uploaded photo from disk, if it exists.
        if (extra.photo) {
            const filename = path.basename(extra.photo);
            const photoPath = path.join(UPLOAD_DIR, filename);
            try {
                if (fs.existsSync(photoPath)) {
                    fs.unlinkSync(photoPath);
                }
            } catch (photoError) {
                console.error('Could not delete client photo:', photoError);
            }
        }

        await dbRun(
            `DELETE FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='clients'`,
            [req.params.id, mercFactionId]
        );

        await auditLog({
            userId: req.user.id,
            factionId: mercFactionId,
            action: 'DELETE_MERCENARY_CLIENT',
            entity: 'clients',
            entityId: row.id,
            metadata: {
                clientName: row.title,
                deletedPhoto: Boolean(extra.photo)
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, deleted: true });
    } catch (e) {
        next(e);
    }
});

app.delete('/api/mercenary/clients/:id/photo', auth, requireSuperAdminDelete, async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Clientes são exclusivos dos Mercenários.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const row = await dbGet(
            `SELECT id, extra_json FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='clients'`,
            [req.params.id, mercFactionId]
        );

        if (!row) {
            return res.status(404).json({ error: 'Cliente não encontrado.' });
        }

        const extra = JSON.parse(row.extra_json || '{}');
        delete extra.photo;

        await dbRun(
            `UPDATE faction_records
             SET extra_json=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='clients'`,
            [JSON.stringify(extra), req.params.id, mercFactionId]
        );

        res.json({ success: true });
    } catch (e) {
        next(e);
    }
});

// --- MERCENARY TACTICAL INTELLIGENCE ---
function canCreateMercenaryIntel(req) {
    return req.user.role === 'super_admin' ||
        (req.user.factionCode === 'mercenaries' &&
         ['operator', 'commander', 'faction_admin'].includes(req.user.role));
}

app.get('/api/mercenary/intel', auth, async (req, res) => {
    if (!hasMercenaryAccess(req)) {
        return res.status(403).json({ error: 'Inteligência é exclusiva dos Mercenários.' });
    }

    const mercFactionId = await getMercenaryFactionId();
    const rows = await dbAll(
        `SELECT fr.*, u.name AS created_by_name, u.username AS created_by_username
         FROM faction_records fr
         LEFT JOIN users u ON u.id = fr.created_by
         WHERE fr.faction_id=? AND fr.module_code='intel'
         ORDER BY fr.id DESC`,
        [mercFactionId]
    );

    res.json(rows.map(r => ({
        ...r,
        intel_code: `INT-${String(r.id).padStart(4, '0')}`,
        extra: JSON.parse(r.extra_json || '{}')
    })));
});

app.post('/api/mercenary/intel', auth, async (req, res, next) => {
    try {
        if (!canCreateMercenaryIntel(req)) {
            return res.status(403).json({ error: 'Seu cargo não pode criar informes.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const schema = z.object({
            title: z.string().trim().min(2).max(140),
            classification: z.enum(['PUBLICO','RESTRITO','CONFIDENCIAL','SIGILOSO']),
            status: z.enum(['NOVO','ANALISANDO','CONFIRMADO','ARQUIVADO']).optional().default('NOVO'),
            priority: z.enum(['BAIXA','MEDIA','ALTA','CRITICA']).optional().default('MEDIA'),
            target: z.string().trim().max(220).optional().default(''),
            area: z.string().trim().max(180).optional().default(''),
            reliability: z.string().trim().max(120).optional().default(''),
            summary: z.string().trim().max(2500).optional().default(''),
            content: z.string().trim().max(8000).optional().default(''),
            tacticalNotes: z.string().trim().max(4000).optional().default('')
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Dados do informe inválidos.' });
        }

        const d = parsed.data;
        const extra = {
            priority: d.priority,
            reliability: d.reliability,
            summary: d.summary,
            tacticalNotes: d.tacticalNotes
        };

        const result = await dbRun(
            `INSERT INTO faction_records
             (faction_id,module_code,title,category,status,location,subject,description,extra_json,created_by)
             VALUES (?, 'intel', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [mercFactionId, d.title, d.classification, d.status, d.area, d.target,
             d.content, JSON.stringify(extra), req.user.id]
        );

        res.status(201).json({
            success: true,
            id: result.lastID,
            intelCode: `INT-${String(result.lastID).padStart(4, '0')}`
        });
    } catch (e) { next(e); }
});

app.put('/api/mercenary/intel/:id', auth, async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Inteligência é exclusiva dos Mercenários.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id, created_by FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='intel'`,
            [req.params.id, mercFactionId]
        );
        if (!current) return res.status(404).json({ error: 'Informe não encontrado.' });

        if (req.user.role !== 'super_admin' && current.created_by !== req.user.id) {
            return res.status(403).json({ error: 'Apenas quem criou este informe pode editá-lo.' });
        }

        const schema = z.object({
            title: z.string().trim().min(2).max(140),
            classification: z.enum(['PUBLICO','RESTRITO','CONFIDENCIAL','SIGILOSO']),
            status: z.enum(['NOVO','ANALISANDO','CONFIRMADO','ARQUIVADO']),
            priority: z.enum(['BAIXA','MEDIA','ALTA','CRITICA']),
            target: z.string().trim().max(220).optional().default(''),
            area: z.string().trim().max(180).optional().default(''),
            reliability: z.string().trim().max(120).optional().default(''),
            summary: z.string().trim().max(2500).optional().default(''),
            content: z.string().trim().max(8000).optional().default(''),
            tacticalNotes: z.string().trim().max(4000).optional().default('')
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos.' });
        const d = parsed.data;
        const extra = {
            priority: d.priority,
            reliability: d.reliability,
            summary: d.summary,
            tacticalNotes: d.tacticalNotes
        };

        await dbRun(
            `UPDATE faction_records
             SET title=?, category=?, status=?, location=?, subject=?, description=?, extra_json=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='intel'`,
            [d.title,d.classification,d.status,d.area,d.target,d.content,JSON.stringify(extra),req.params.id,mercFactionId]
        );

        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/api/mercenary/intel/:id/status', auth, async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Inteligência é exclusiva dos Mercenários.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id, created_by FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='intel'`,
            [req.params.id, mercFactionId]
        );
        if (!current) return res.status(404).json({ error: 'Informe não encontrado.' });

        if (req.user.role !== 'super_admin' && current.created_by !== req.user.id) {
            return res.status(403).json({ error: 'Apenas quem criou este informe pode alterar o status.' });
        }

        const status = String(req.body.status || '').toUpperCase();
        const allowed = ['NOVO','ANALISANDO','CONFIRMADO','ARQUIVADO'];
        if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido.' });

        await dbRun(
            `UPDATE faction_records SET status=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='intel'`,
            [status, req.params.id, mercFactionId]
        );
        res.json({ success: true, status });
    } catch (e) { next(e); }
});

app.delete('/api/mercenary/intel/:id', auth, requireSuperAdminDelete, async (req, res, next) => {
    try {
        if (!isMercenaryLeader(req)) {
            return res.status(403).json({ error: 'Apenas o líder da facção pode excluir informes.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='intel'`,
            [req.params.id, mercFactionId]
        );
        if (!current) return res.status(404).json({ error: 'Informe não encontrado.' });

        await dbRun(
            `DELETE FROM faction_records WHERE id=? AND faction_id=? AND module_code='intel'`,
            [req.params.id, mercFactionId]
        );
        res.json({ success: true, deleted: true });
    } catch (e) { next(e); }
});

// --- MERCENARY CONFIDENTIAL ARCHIVE ---
function canCreateMercenaryArchive(req) {
    return req.user.role === 'super_admin' ||
        (req.user.factionCode === 'mercenaries' &&
         ['operator', 'commander', 'faction_admin'].includes(req.user.role));
}

app.get('/api/mercenary/archive', auth, async (req, res) => {
    if (!hasMercenaryAccess(req)) {
        return res.status(403).json({ error: 'Arquivo é exclusivo dos Mercenários.' });
    }

    const mercFactionId = await getMercenaryFactionId();
    const rows = await dbAll(
        `SELECT fr.*, u.name AS created_by_name, u.username AS created_by_username
         FROM faction_records fr
         LEFT JOIN users u ON u.id = fr.created_by
         WHERE fr.faction_id=? AND fr.module_code='archive'
         ORDER BY fr.id DESC`,
        [mercFactionId]
    );

    res.json(rows.map(r => ({
        ...r,
        archive_code: `ARQ-${String(r.id).padStart(4, '0')}`,
        extra: JSON.parse(r.extra_json || '{}')
    })));
});

app.post('/api/mercenary/archive', auth, async (req, res, next) => {
    try {
        if (!canCreateMercenaryArchive(req)) {
            return res.status(403).json({ error: 'Seu cargo não pode criar dossiês.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const schema = z.object({
            title: z.string().trim().min(2).max(140),
            classification: z.enum(['PUBLICO','RESTRITO','CONFIDENCIAL','SIGILOSO']),
            origin: z.string().trim().max(160).optional().default(''),
            relatedTo: z.string().trim().max(200).optional().default(''),
            summary: z.string().trim().max(3000).optional().default(''),
            content: z.string().trim().max(8000).optional().default(''),
            secretNotes: z.string().trim().max(4000).optional().default('')
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Dados do dossiê inválidos.' });
        }

        const d = parsed.data;
        const extra = {
            relatedTo: d.relatedTo,
            summary: d.summary,
            secretNotes: d.secretNotes
        };

        const result = await dbRun(
            `INSERT INTO faction_records
             (faction_id,module_code,title,category,status,location,subject,description,extra_json,created_by)
             VALUES (?, 'archive', ?, ?, 'ATIVO', ?, ?, ?, ?, ?)`,
            [mercFactionId, d.title, d.classification, d.origin, d.relatedTo,
             d.content, JSON.stringify(extra), req.user.id]
        );

        res.status(201).json({
            success: true,
            id: result.lastID,
            archiveCode: `ARQ-${String(result.lastID).padStart(4, '0')}`
        });
    } catch (e) {
        next(e);
    }
});

app.put('/api/mercenary/archive/:id', auth, async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Arquivo é exclusivo dos Mercenários.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id, created_by, status FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='archive'`,
            [req.params.id, mercFactionId]
        );

        if (!current) return res.status(404).json({ error: 'Dossiê não encontrado.' });

        if (req.user.role !== 'super_admin' && current.created_by !== req.user.id) {
            return res.status(403).json({ error: 'Apenas quem criou o dossiê pode editá-lo.' });
        }

        const schema = z.object({
            title: z.string().trim().min(2).max(140),
            classification: z.enum(['PUBLICO','RESTRITO','CONFIDENCIAL','SIGILOSO']),
            origin: z.string().trim().max(160).optional().default(''),
            relatedTo: z.string().trim().max(200).optional().default(''),
            summary: z.string().trim().max(3000).optional().default(''),
            content: z.string().trim().max(8000).optional().default(''),
            secretNotes: z.string().trim().max(4000).optional().default('')
        });

        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos.' });
        const d = parsed.data;
        const extra = {
            relatedTo: d.relatedTo,
            summary: d.summary,
            secretNotes: d.secretNotes
        };

        await dbRun(
            `UPDATE faction_records
             SET title=?, category=?, location=?, subject=?, description=?, extra_json=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='archive'`,
            [d.title, d.classification, d.origin, d.relatedTo, d.content,
             JSON.stringify(extra), req.params.id, mercFactionId]
        );

        res.json({ success: true });
    } catch (e) {
        next(e);
    }
});

app.post('/api/mercenary/archive/:id/archive', auth, async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Arquivo é exclusivo dos Mercenários.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id, created_by FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='archive'`,
            [req.params.id, mercFactionId]
        );

        if (!current) return res.status(404).json({ error: 'Dossiê não encontrado.' });

        if (req.user.role !== 'super_admin' && current.created_by !== req.user.id) {
            return res.status(403).json({ error: 'Apenas quem criou o dossiê pode arquivá-lo.' });
        }

        await dbRun(
            `UPDATE faction_records
             SET status='ARQUIVADO', updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='archive'`,
            [req.params.id, mercFactionId]
        );

        res.json({ success: true });
    } catch (e) {
        next(e);
    }
});

app.delete('/api/mercenary/archive/:id', auth, requireSuperAdminDelete, async (req, res, next) => {
    try {
        if (!isMercenaryLeader(req)) {
            return res.status(403).json({ error: 'Apenas o líder da facção pode excluir dossiês.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='archive'`,
            [req.params.id, mercFactionId]
        );

        if (!current) return res.status(404).json({ error: 'Dossiê não encontrado.' });

        await dbRun(
            `DELETE FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='archive'`,
            [req.params.id, mercFactionId]
        );

        res.json({ success: true, deleted: true });
    } catch (e) {
        next(e);
    }
});

// --- MERCENARY OPERATIONS ---
async function getMercenaryFactionId() {
    const row = await dbGet(`SELECT id FROM factions WHERE code = 'mercenaries' LIMIT 1`);
    return row ? row.id : 5;
}

function canCreateMercenaryOperation(req) {
    return req.user.role === 'super_admin' ||
        (req.user.factionCode === 'mercenaries' &&
         ['operator', 'commander', 'faction_admin'].includes(req.user.role));
}

app.get('/api/mercenary/operations', auth, async (req, res) => {
    if (!hasMercenaryAccess(req)) {
        return res.status(403).json({ error: 'Operações são exclusivas dos Mercenários.' });
    }
    const mercFactionId = await getMercenaryFactionId();
    const rows = await dbAll(
        `SELECT fr.*, u.name AS created_by_name, u.username AS created_by_username
         FROM faction_records fr
         LEFT JOIN users u ON u.id = fr.created_by
         WHERE fr.faction_id = ? AND fr.module_code = 'operations'
         ORDER BY fr.updated_at DESC, fr.id DESC`,
        [mercFactionId]
    );
    res.json(rows.map(r => ({ ...r, extra: JSON.parse(r.extra_json || '{}') })));
});

app.post('/api/mercenary/operations', auth, async (req, res, next) => {
    try {
        if (!canCreateMercenaryOperation(req)) {
            return res.status(403).json({ error: 'Seu cargo não pode criar operações mercenárias.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const schema = z.object({
            title: z.string().trim().min(2).max(120),
            contractCode: z.string().trim().max(80).optional().default(''),
            objective: z.string().trim().max(500).optional().default(''),
            location: z.string().trim().max(160).optional().default(''),
            risk: z.enum(['baixo','medio','alto','extremo']).optional().default('medio'),
            reward: z.string().trim().max(120).optional().default(''),
            team: z.string().trim().max(500).optional().default(''),
            description: z.string().trim().max(5000).optional().default(''),
            status: z.enum(['planejamento','ativa','suspensa','concluida']).optional().default('planejamento')
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Dados da operação inválidos.', details: parsed.error.issues.map(i => i.message) });
        }
        const d = parsed.data;
        const extra = {
            contractCode: d.contractCode,
            objective: d.objective,
            risk: d.risk,
            reward: d.reward,
            team: d.team
        };

        const result = await dbRun(
            `INSERT INTO faction_records
             (faction_id,module_code,title,category,status,location,subject,description,extra_json,created_by)
             VALUES (?, 'operations', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [mercFactionId, d.title, 'Operação Mercenária', 'planejamento', d.location, d.objective,
             d.description, JSON.stringify(extra), req.user.id]
        );

        await auditLog({
            userId: req.user.id,
            factionId: mercFactionId,
            action: 'CREATE_MERCENARY_OPERATION',
            entity: 'operations',
            entityId: result.lastID
        });

        res.status(201).json({ success: true, id: result.lastID });
    } catch (e) { next(e); }
});

app.put('/api/mercenary/operations/:id', auth, async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Operações são exclusivas dos Mercenários.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id, created_by FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='operations'`,
            [req.params.id, mercFactionId]
        );
        if (!current) return res.status(404).json({ error: 'Operação não encontrada.' });

        // Only the creator can edit; super admin is the only global override.
        if (req.user.role !== 'super_admin' && current.created_by !== req.user.id) {
            return res.status(403).json({ error: 'Apenas quem criou esta operação pode editá-la.' });
        }

        const schema = z.object({
            title: z.string().trim().min(2).max(120),
            contractCode: z.string().trim().max(80).optional().default(''),
            objective: z.string().trim().max(500).optional().default(''),
            location: z.string().trim().max(160).optional().default(''),
            risk: z.enum(['baixo','medio','alto','extremo']).optional().default('medio'),
            reward: z.string().trim().max(120).optional().default(''),
            team: z.string().trim().max(500).optional().default(''),
            description: z.string().trim().max(5000).optional().default(''),
            status: z.enum(['planejamento','ativa','suspensa','concluida']).optional().default('planejamento')
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: 'Dados inválidos.' });
        const d = parsed.data;
        const extra = {
            contractCode: d.contractCode,
            objective: d.objective,
            risk: d.risk,
            reward: d.reward,
            team: d.team
        };

        await dbRun(
            `UPDATE faction_records
             SET title=?, status=?, location=?, subject=?, description=?, extra_json=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='operations'`,
            [d.title, d.status, d.location, d.objective, d.description, JSON.stringify(extra),
             req.params.id, mercFactionId]
        );
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.post('/api/mercenary/operations/:id/status', auth, async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Operações são exclusivas dos Mercenários.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id, created_by, status FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='operations'`,
            [req.params.id, mercFactionId]
        );

        if (!current) {
            return res.status(404).json({ error: 'Operação não encontrada.' });
        }

        if (req.user.role !== 'super_admin' && current.created_by !== req.user.id) {
            return res.status(403).json({
                error: 'Apenas quem criou esta operação pode alterar seu status.'
            });
        }

        const allowed = ['planejamento', 'ativa', 'suspensa'];
        const status = String(req.body.status || '').toLowerCase();

        if (!allowed.includes(status)) {
            return res.status(400).json({ error: 'Status inválido.' });
        }

        await dbRun(
            `UPDATE faction_records
             SET status=?, updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='operations'`,
            [status, req.params.id, mercFactionId]
        );

        await auditLog({
            userId: req.user.id,
            factionId: mercFactionId,
            action: 'UPDATE_MERCENARY_OPERATION_STATUS',
            entity: 'operations',
            entityId: req.params.id,
            metadata: { status }
        });

        res.json({ success: true, status });
    } catch (e) {
        next(e);
    }
});

app.post('/api/mercenary/operations/:id/complete', auth, async (req, res, next) => {
    try {
        if (!hasMercenaryAccess(req)) {
            return res.status(403).json({ error: 'Operações são exclusivas dos Mercenários.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id, created_by FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='operations'`,
            [req.params.id, mercFactionId]
        );
        if (!current) return res.status(404).json({ error: 'Operação não encontrada.' });

        if (req.user.role !== 'super_admin' && current.created_by !== req.user.id) {
            return res.status(403).json({ error: 'Apenas quem criou esta operação pode marcá-la como concluída.' });
        }

        await dbRun(
            `UPDATE faction_records SET status='concluida', updated_at=CURRENT_TIMESTAMP
             WHERE id=? AND faction_id=? AND module_code='operations'`,
            [req.params.id, mercFactionId]
        );
        res.json({ success: true });
    } catch (e) { next(e); }
});

app.delete('/api/mercenary/operations/:id', auth, requireSuperAdminDelete, async (req, res, next) => {
    try {
        if (!isMercenaryLeader(req)) {
            return res.status(403).json({ error: 'Apenas o líder da facção pode excluir operações.' });
        }

        const mercFactionId = await getMercenaryFactionId();
        const current = await dbGet(
            `SELECT id FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='operations'`,
            [req.params.id, mercFactionId]
        );
        if (!current) return res.status(404).json({ error: 'Operação não encontrada.' });

        await dbRun(
            `DELETE FROM faction_records
             WHERE id=? AND faction_id=? AND module_code='operations'`,
            [req.params.id, mercFactionId]
        );
        res.json({ success: true, deleted: true });
    } catch (e) { next(e); }
});

// --- ADMIN / DASHBOARD STATS ---
app.get('/api/faction-dashboard', auth, async (req, res, next) => {
    try {
        const factionId = getFactionScope(req);
        if (!factionId) return res.status(400).json({ error: 'Selecione uma facção.' });

        const faction = await dbGet(`SELECT id, code, name, active FROM factions WHERE id=?`, [factionId]);
        if (!faction) return res.status(404).json({ error: 'Facção não encontrada.' });

        const bank = await dbGet(`
            SELECT
              COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE 0 END),0) entradas,
              COALESCE(SUM(CASE WHEN type='saida' THEN amount ELSE 0 END),0) saidas
            FROM faction_bank_transactions WHERE faction_id=?`, [factionId]);
        const users = await dbGet(`SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN active=1 THEN 1 ELSE 0 END),0) active FROM users WHERE faction_id=?`, [factionId]);
        const missions = await dbGet(`
            SELECT
              COUNT(*) total,
              COALESCE(SUM(CASE
                WHEN LOWER(COALESCE(status,'')) IN ('pendente','em andamento','em_andamento','ativa','ativo','aberta','novo','planejamento')
                THEN 1 ELSE 0 END),0) open
            FROM missoes WHERE faction_id=?`, [factionId]);
        const records = (await tableExists('faction_records'))
            ? await dbAll(`SELECT module_code, status, COUNT(*) qty FROM faction_records WHERE faction_id=? GROUP BY module_code,status`, [factionId])
            : [];
        const stalkers = await dbGet(`SELECT COUNT(*) total FROM stalkers WHERE faction_id=?`, [factionId]);

        const itemCols = await getTableColumns('itens');
        const itemQtyExpr = itemCols.includes('quantidade') ? 'COALESCE(SUM(COALESCE(quantidade,1)),0)' : 'COUNT(*)';
        const items = await dbGet(`SELECT ${itemQtyExpr} qty, COUNT(*) types FROM itens WHERE faction_id=?`, [factionId]);

        const research = (await tableExists('rp_experiments'))
            ? await dbGet(`SELECT COUNT(*) total FROM rp_experiments WHERE faction_id=?`, [factionId])
            : { total: 0 };
        const reports = await dbGet(`SELECT COUNT(*) total FROM relatorios WHERE faction_id=?`, [factionId]);
        const latest = await dbAll(`
            SELECT a.action,a.entity,a.entity_id,a.created_at,u.name user_name
            FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
            WHERE a.faction_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 6`, [factionId]);

        res.json({
            faction,
            balance: Number(bank.entradas || 0) - Number(bank.saidas || 0),
            entradas: Number(bank.entradas || 0),
            saidas: Number(bank.saidas || 0),
            users: { total: Number(users.total || 0), active: Number(users.active || 0) },
            missions: { total: Number(missions.total || 0), open: Number(missions.open || 0) },
            records,
            stalkers: Number(stalkers.total || 0),
            inventory: { qty: Number(items.qty || 0), types: Number(items.types || 0) },
            research: Number(research.total || 0),
            reports: Number(reports.total || 0),
            latest
        });
    } catch (e) { next(e); }
});

app.get('/api/stats', auth, async (req, res) => {
    const fId = getFactionScope(req);
    const stalkersCount = await dbGet(`SELECT COUNT(*) as count FROM stalkers ${fId ? 'WHERE faction_id = ?' : ''}`, fId ? [fId] : []);
    const itensCount = await dbGet(`SELECT COUNT(*) as count FROM itens ${fId ? 'WHERE faction_id = ?' : ''}`, fId ? [fId] : []);
    const missoesCount = await dbGet(`SELECT COUNT(*) as count FROM missoes WHERE status != 'ENCERRADA' ${fId ? 'AND faction_id = ?' : ''}`, fId ? [fId] : []);
    const topStalkerRow = await dbGet(`SELECT codinome, reputacao FROM stalkers ${fId ? 'WHERE faction_id = ?' : ''} ORDER BY reputacao DESC LIMIT 1`, fId ? [fId] : []);
    
    let topStalkerStr = 'Nenhum';
    if (topStalkerRow) topStalkerStr = `${topStalkerRow.codinome} (${topStalkerRow.reputacao || 0} pts)`;

    res.json({
        totalStalkers: stalkersCount.count,
        totalItens: itensCount.count,
        missoesAtivas: missoesCount.count,
        topStalker: topStalkerStr
    });
});


// --- FACTION COMMERCE / PERSONAL WALLET ---
const COMMERCE_MODULES = {
    duty: ['arsenal'],
    ecologists: ['trade'],
    bandits: ['business'],
    freedom: ['supplies']
};

async function resolveCommerceScope(req, moduleCode) {
    const factionId = getFactionScope(req);
    if (!factionId) return { error: 'Contexto de facção necessário.' };
    const faction = await dbGet(`SELECT id, code, name FROM factions WHERE id=?`, [factionId]);
    if (!faction) return { error: 'Facção não encontrada.' };
    const allowed = COMMERCE_MODULES[faction.code] || [];
    if (!allowed.includes(moduleCode)) {
        return { error: `O módulo ${moduleCode} não é um módulo comercial da facção ${faction.name}.` };
    }
    return { factionId, faction };
}


// --- GLOBAL ADMIN CONTROL LAYER ---
const STAFF_CAPABILITY_CATALOG = [
    {key:'server:panel', group:'PAINEL', label:'Acessar Central Administrativa'},
    {key:'oblivion:read', group:'SERVIDOR DAYZ', label:'Visualizar Oblivion Control e traders reais'},
    {key:'oblivion:manage', group:'SERVIDOR DAYZ', label:'Gerenciar overlays, regras e catálogo do Oblivion Control'},
    {key:'releases:manage', group:'SERVIDOR DAYZ', label:'Criar/aprovar releases de configuração'},
    {key:'faction:manage', group:'FACÇÕES', label:'Gerenciar facções'},
    {key:'users:manage', group:'USUÁRIOS', label:'Gerenciar usuários'},
    {key:'trade:manage', group:'COMÉRCIO', label:'Criar/editar catálogo global e traders'},
    {key:'quests:manage', group:'QUESTS', label:'Criar/editar quests'},
    {key:'quests:read', group:'QUESTS', label:'Visualizar quests globais'},
    {key:'economy:read', group:'ECONOMIA', label:'Visualizar economia global'},
    {key:'economy:manage', group:'ECONOMIA', label:'Gerenciar economia'},
    {key:'operations:global', group:'OPERAÇÕES', label:'Visualizar operações globais'},
    {key:'audit:read', group:'AUDITORIA', label:'Visualizar auditoria'},
    {key:'config:manage', group:'SISTEMA', label:'Alterar configurações do sistema'},
    {key:'stalkers:manage', group:'REGISTRO DA ZONA', label:'Gerenciar stalkers'},
    {key:'missions:manage', group:'OPERAÇÕES', label:'Gerenciar missões'},
    {key:'reports:manage', group:'OPERAÇÕES', label:'Gerenciar relatórios'},
    {key:'research:manage', group:'OPERAÇÕES', label:'Gerenciar pesquisas/experimentos'},
    {key:'items:manage', group:'ITENS', label:'Gerenciar itens/estoque'},
    {key:'operations:manage', group:'OPERAÇÕES', label:'Gerenciar operações'}
];

app.get('/api/me/capabilities', auth, async (req,res,next)=>{
    try{
        res.json({capabilities:await getEffectiveCapabilities(req.user.id,req.user.role)});
    }catch(e){next(e)}
});

app.get('/api/admin/staff/capabilities', auth, async (req,res)=>{
    if(req.user.role!=='super_admin') return res.status(403).json({error:'Somente o Super Admin pode administrar permissões.'});
    res.json(STAFF_CAPABILITY_CATALOG);
});

app.get('/api/admin/staff/:id/permissions', auth, async (req,res,next)=>{
    try{
        if(req.user.role!=='super_admin') return res.status(403).json({error:'Somente o Super Admin pode administrar permissões.'});
        const user=await dbGet(`SELECT id,username,name,role,faction_id,active FROM users WHERE id=?`,[req.params.id]);
        if(!user)return res.status(404).json({error:'Usuário não encontrado.'});
        const roleCaps=(await dbAll(`SELECT capability FROM permissions WHERE role=?`,[user.role])).map(x=>x.capability);
        const overrides=await dbAll(`SELECT capability,effect FROM user_permissions WHERE user_id=? ORDER BY capability`,[user.id]);
        res.json({user,roleCapabilities:roleCaps,overrides,effective:await getEffectiveCapabilities(user.id,user.role)});
    }catch(e){next(e)}
});

app.put('/api/admin/staff/:id/permissions', auth, async (req,res,next)=>{
    try{
        if(req.user.role!=='super_admin') return res.status(403).json({error:'Somente o Super Admin pode alterar permissões.'});
        const target=await dbGet(`SELECT id,username,role FROM users WHERE id=?`,[req.params.id]);
        if(!target)return res.status(404).json({error:'Usuário não encontrado.'});
        if(target.role==='super_admin')return res.status(400).json({error:'Super Admin possui acesso total e não usa overrides.'});

        const requested=Array.isArray(req.body.capabilities)?req.body.capabilities.map(String):[];
        const valid=new Set(STAFF_CAPABILITY_CATALOG.map(x=>x.key));
        const clean=[...new Set(requested.filter(x=>valid.has(x)))];

        await dbRun(`DELETE FROM user_permissions WHERE user_id=?`,[target.id]);
        for(const cap of clean){
            await dbRun(`INSERT INTO user_permissions(user_id,capability,effect,created_by) VALUES (?,?, 'allow',?)`,[target.id,cap,req.user.id]);
        }
        await auditLog({userId:req.user.id,action:'UPDATE_STAFF_PERMISSIONS',entity:'users',entityId:target.id,metadata:{username:target.username,capabilities:clean}});
        res.json({success:true,effective:await getEffectiveCapabilities(target.id,target.role)});
    }catch(e){next(e)}
});

// QUESTS
app.get('/api/quests', auth, async (req,res,next)=>{
    try{
        const rows=await dbAll(`SELECT q.*,f.name faction_name,p.code prerequisite_code,u.name created_by_name
          FROM quests q LEFT JOIN factions f ON f.id=q.faction_id
          LEFT JOIN quests p ON p.id=q.prerequisite_quest_id
          LEFT JOIN users u ON u.id=q.created_by
          ORDER BY q.id DESC`);
        res.json(rows.map(r=>({...r,requirements:JSON.parse(r.requirements_json||'[]'),rewards:JSON.parse(r.rewards_json||'{}')})));
    }catch(e){next(e)}
});

app.post('/api/admin/quests', auth, requireCapability('quests:manage'), upload.single('image'), async (req,res,next)=>{
    try{
        const code=String(req.body.code||'').trim().toUpperCase();
        const title=String(req.body.title||'').trim();
        if(code.length<3||title.length<3)return res.status(400).json({error:'Código e título são obrigatórios.'});
        let requirements=[]; let rewards={};
        try{requirements=JSON.parse(req.body.requirements||'[]')}catch(_){}
        try{rewards=JSON.parse(req.body.rewards||'{}')}catch(_){}
        const result=await dbRun(`INSERT INTO quests(code,title,faction_id,quest_giver,description,status,repeatable,cooldown_hours,prerequisite_quest_id,requirements_json,rewards_json,image,created_by)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
            code,title,req.body.faction_id?Number(req.body.faction_id):null,String(req.body.quest_giver||'').trim(),
            String(req.body.description||'').trim(),String(req.body.status||'DRAFT').toUpperCase(),
            Number(req.body.repeatable||0)?1:0,Number(req.body.cooldown_hours||0),req.body.prerequisite_quest_id?Number(req.body.prerequisite_quest_id):null,
            JSON.stringify(Array.isArray(requirements)?requirements:[]),JSON.stringify(rewards&&typeof rewards==='object'?rewards:{}),
            req.file?`/uploads/${req.file.filename}`:'',req.user.id
        ]);
        await auditLog({userId:req.user.id,action:'CREATE_QUEST',entity:'quests',entityId:result.lastID,metadata:{code,title}});
        res.status(201).json({success:true,id:result.lastID});
    }catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Já existe uma quest com esse código.'});next(e)}
});

app.put('/api/admin/quests/:id', auth, requireCapability('quests:manage'), upload.single('image'), async (req,res,next)=>{
    try{
        const current=await dbGet(`SELECT * FROM quests WHERE id=?`,[req.params.id]);
        if(!current)return res.status(404).json({error:'Quest não encontrada.'});
        let requirements=JSON.parse(current.requirements_json||'[]'),rewards=JSON.parse(current.rewards_json||'{}');
        if(req.body.requirements!==undefined)try{requirements=JSON.parse(req.body.requirements)}catch(_){}
        if(req.body.rewards!==undefined)try{rewards=JSON.parse(req.body.rewards)}catch(_){}
        const image=req.file?`/uploads/${req.file.filename}`:current.image;
        await dbRun(`UPDATE quests SET code=?,title=?,faction_id=?,quest_giver=?,description=?,status=?,repeatable=?,cooldown_hours=?,prerequisite_quest_id=?,requirements_json=?,rewards_json=?,image=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[
            String(req.body.code||current.code).trim().toUpperCase(),String(req.body.title||current.title).trim(),
            req.body.faction_id?Number(req.body.faction_id):null,String(req.body.quest_giver??current.quest_giver).trim(),
            String(req.body.description??current.description).trim(),String(req.body.status||current.status).toUpperCase(),
            Number(req.body.repeatable??current.repeatable)?1:0,Number(req.body.cooldown_hours??current.cooldown_hours),
            req.body.prerequisite_quest_id?Number(req.body.prerequisite_quest_id):null,JSON.stringify(requirements),JSON.stringify(rewards),image,req.params.id
        ]);
        await auditLog({userId:req.user.id,action:'UPDATE_QUEST',entity:'quests',entityId:req.params.id,metadata:{code:req.body.code||current.code}});
        res.json({success:true});
    }catch(e){next(e)}
});

app.delete('/api/admin/quests/:id', auth, requireSuperAdminDelete, async (req,res,next)=>{
    try{
        const q=await dbGet(`SELECT id,code,title FROM quests WHERE id=?`,[req.params.id]);
        if(!q)return res.status(404).json({error:'Quest não encontrada.'});
        await dbRun(`DELETE FROM quest_progress WHERE quest_id=?`,[q.id]);
        await dbRun(`DELETE FROM quests WHERE id=?`,[q.id]);
        await auditLog({userId:req.user.id,action:'DELETE_QUEST',entity:'quests',entityId:q.id,metadata:{code:q.code,title:q.title}});
        res.json({success:true});
    }catch(e){next(e)}
});

// Quest progress for web/RP integration
app.get('/api/quest-progress', auth, async (req,res,next)=>{
    try{
        const personId=Number(req.query.person_id||0);
        if(!personId)return res.status(400).json({error:'person_id é obrigatório.'});
        const rows=await dbAll(`SELECT qp.*,q.code,q.title FROM quest_progress qp JOIN quests q ON q.id=qp.quest_id WHERE qp.person_id=? ORDER BY qp.id DESC`,[personId]);
        res.json(rows.map(r=>({...r,progress:JSON.parse(r.progress_json||'{}')})));
    }catch(e){next(e)}
});

app.put('/api/quest-progress/:questId/:personId', auth, requireCapability('quests:manage'), async (req,res,next)=>{
    try{
        const status=String(req.body.status||'IN_PROGRESS').toUpperCase();
        const progress=req.body.progress&&typeof req.body.progress==='object'?req.body.progress:{};
        await dbRun(`INSERT INTO quest_progress(quest_id,person_id,status,progress_json,accepted_at,completed_at,updated_at)
          VALUES (?,?,?,?,CASE WHEN ?<>'NOT_STARTED' THEN CURRENT_TIMESTAMP ELSE NULL END,CASE WHEN ?='COMPLETED' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP)
          ON CONFLICT(quest_id,person_id) DO UPDATE SET status=excluded.status,progress_json=excluded.progress_json,
          completed_at=CASE WHEN excluded.status='COMPLETED' THEN CURRENT_TIMESTAMP ELSE quest_progress.completed_at END,updated_at=CURRENT_TIMESTAMP`,
          [req.params.questId,req.params.personId,status,JSON.stringify(progress),status,status]);
        res.json({success:true});
    }catch(e){next(e)}
});

// TRADERS / NPCs
app.get('/api/admin/traders', auth, requireCapability('trade:manage'), async (req,res,next)=>{
    try{
        const rows=await dbAll(`SELECT t.*,f.name faction_name FROM traders t LEFT JOIN factions f ON f.id=t.faction_id ORDER BY t.name`);
        res.json(rows);
    }catch(e){next(e)}
});

app.post('/api/admin/traders', auth, requireCapability('trade:manage'), async (req,res,next)=>{
    try{
        const name=String(req.body.name||'').trim(); if(name.length<2)return res.status(400).json({error:'Informe o nome.'});
        const result=await dbRun(`INSERT INTO traders(name,trader_type,faction_id,location,active,buy_categories_json,sell_categories_json,quest_ids_json,notes)
          VALUES (?,?,?,?,?,?,?,?,?)`,[
            name,String(req.body.trader_type||'TRADER').toUpperCase(),req.body.faction_id?Number(req.body.faction_id):null,String(req.body.location||'').trim(),
            Number(req.body.active??1)?1:0,JSON.stringify(req.body.buy_categories||[]),JSON.stringify(req.body.sell_categories||[]),JSON.stringify(req.body.quest_ids||[]),String(req.body.notes||'').trim()
        ]);
        await auditLog({userId:req.user.id,action:'CREATE_TRADER',entity:'traders',entityId:result.lastID,metadata:{name}});
        res.status(201).json({success:true,id:result.lastID});
    }catch(e){next(e)}
});

app.put('/api/admin/traders/:id', auth, requireCapability('trade:manage'), async (req,res,next)=>{
    try{
        const current=await dbGet(`SELECT * FROM traders WHERE id=?`,[req.params.id]); if(!current)return res.status(404).json({error:'Trader não encontrado.'});
        await dbRun(`UPDATE traders SET name=?,trader_type=?,faction_id=?,location=?,active=?,buy_categories_json=?,sell_categories_json=?,quest_ids_json=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[
            String(req.body.name||current.name).trim(),String(req.body.trader_type||current.trader_type).toUpperCase(),
            req.body.faction_id?Number(req.body.faction_id):null,String(req.body.location??current.location).trim(),Number(req.body.active??current.active)?1:0,
            JSON.stringify(req.body.buy_categories||JSON.parse(current.buy_categories_json||'[]')),JSON.stringify(req.body.sell_categories||JSON.parse(current.sell_categories_json||'[]')),
            JSON.stringify(req.body.quest_ids||JSON.parse(current.quest_ids_json||'[]')),String(req.body.notes??current.notes).trim(),req.params.id
        ]);
        res.json({success:true});
    }catch(e){next(e)}
});

app.delete('/api/admin/traders/:id', auth, requireSuperAdminDelete, async (req,res,next)=>{
    try{await dbRun(`DELETE FROM traders WHERE id=?`,[req.params.id]);res.json({success:true})}catch(e){next(e)}
});

// --- OBLIVION CONTROL / DAYZ CONTROL-PLANE ---
// These routes manage panel drafts and release metadata only. They do not write to Qonzer,
// Workshop, DayZ Runtime/, PBOs or server storage.
async function readOblivionSettings() {
    const rows = await dbAll(`SELECT key,value,updated_at FROM server_settings WHERE key LIKE 'obc.%' ORDER BY key`);
    return Object.fromEntries(rows.map(r => [r.key, { value:r.value, updated_at:r.updated_at }]));
}

app.get('/api/admin/oblivion/overview', auth, requireCapability('server:panel','oblivion:read','oblivion:manage'), async (req,res,next)=>{
    try{
        const settings = await readOblivionSettings();
        const traders = await dbAll(`SELECT t.*,(SELECT COUNT(*) FROM oblivion_trader_rules r WHERE r.trader_id=t.trader_id) rule_count FROM oblivion_traders t ORDER BY CASE trader_id WHEN 'skad' THEN 1 WHEN 'yanov' THEN 2 WHEN 'bandit' THEN 3 WHEN 'duty' THEN 4 WHEN 'merc' THEN 5 ELSE 9 END, trader_id`);
        const ruleCount = await dbGet(`SELECT COUNT(*) count FROM oblivion_trader_rules`);
        const activeOverlayCount = await dbGet(`SELECT COUNT(*) count FROM oblivion_traders WHERE catalog_override_enabled=1`);
        const latestRelease = await dbGet(`SELECT id,release_code,status,created_at,approved_at FROM oblivion_releases ORDER BY id DESC LIMIT 1`);
        const tradeEvents = await dbGet(`SELECT COUNT(*) count FROM commerce_transactions`);
        const bridgeConfigured = !!String(process.env.OBLIVION_BRIDGE_URL || '').trim();
        res.json({
            integration:{
                releaseCandidate: settings['obc.release_candidate']?.value || 'V1.6',
                bridgeStatus: bridgeConfigured ? (settings['obc.bridge_status']?.value || 'CONFIGURED_NOT_VERIFIED') : 'NOT_CONNECTED',
                bridgeConfigured,
                qonzerStatus: settings['obc.qonzer_status']?.value || 'NOT_INSTALLED',
                workshopStatus: settings['obc.workshop_status']?.value || 'NOT_PUBLISHED',
                pricesActive: String(settings['obc.prices_active']?.value || 'false').toLowerCase()==='true',
                catalogOverridesDefault: String(settings['obc.catalog_overrides_default']?.value || 'false').toLowerCase()==='true'
            },
            counts:{traders:traders.length,rules:Number(ruleCount.count||0),activeOverlays:Number(activeOverlayCount.count||0),siteTradeEvents:Number(tradeEvents.count||0)},
            traders,
            latestRelease
        });
    }catch(e){next(e)}
});

app.get('/api/admin/oblivion/traders', auth, requireCapability('server:panel','oblivion:read','oblivion:manage'), async (req,res,next)=>{
    try{
        const rows=await dbAll(`SELECT t.*,(SELECT COUNT(*) FROM oblivion_trader_rules r WHERE r.trader_id=t.trader_id) rule_count FROM oblivion_traders t ORDER BY t.name COLLATE NOCASE`);
        res.json(rows);
    }catch(e){next(e)}
});

app.put('/api/admin/oblivion/traders/:traderId', auth, requireCapability('oblivion:manage'), async (req,res,next)=>{
    try{
        const traderId=String(req.params.traderId||'').trim().toLowerCase();
        const current=await dbGet(`SELECT * FROM oblivion_traders WHERE trader_id=?`,[traderId]);
        if(!current)return res.status(404).json({error:'Trader mapeado não encontrado.'});
        const overlayMode=['selective','replace'].includes(String(req.body.overlay_mode||current.overlay_mode).toLowerCase())?String(req.body.overlay_mode||current.overlay_mode).toLowerCase():'selective';
        const enabled=Number(req.body.catalog_override_enabled??current.catalog_override_enabled)?1:0;
        const location=String(req.body.location_label??current.location_label).trim().slice(0,160);
        const notes=String(req.body.notes??current.notes).trim().slice(0,1000);
        await dbRun(`UPDATE oblivion_traders SET catalog_override_enabled=?,overlay_mode=?,location_label=?,notes=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE trader_id=?`,[enabled,overlayMode,location,notes,req.user.id,traderId]);
        await auditLog({userId:req.user.id,action:'UPDATE_OBC_TRADER_DRAFT',entity:'oblivion_traders',metadata:{traderId,catalogOverrideEnabled:enabled,overlayMode}});
        res.json({success:true,appliedToServer:false,message:'Rascunho salvo no painel. Nenhuma alteração foi aplicada ao DayZ/Qonzer.'});
    }catch(e){next(e)}
});

app.get('/api/admin/oblivion/item-library', auth, requireCapability('server:panel','oblivion:read','oblivion:manage'), async (req,res,next)=>{
    try{
        // V27.3 item picker: normalized library from the catalog already imported into this control-plane.
        // This does NOT claim to enumerate every class shipped by every Workshop PBO; it exposes every
        // classname currently cataloged by Oblivion Control, enriched with any image already stored in the site.
        const rows=await dbAll(`SELECT
            r.classname,
            MAX(CASE WHEN TRIM(COALESCE(r.item_name,''))<>'' THEN r.item_name ELSE r.classname END) item_name,
            MAX(COALESCE(r.category,'GERAL')) category,
            MAX(CASE WHEN TRIM(COALESCE(r.photo,''))<>'' THEN r.photo ELSE '' END) rule_photo,
            MIN(r.sell_price) min_sell_price,
            MAX(r.sell_price) max_sell_price,
            MIN(r.buy_price) min_buy_price,
            MAX(r.buy_price) max_buy_price,
            COUNT(DISTINCT r.trader_id) trader_count,
            GROUP_CONCAT(DISTINCT r.trader_id) traders
          FROM oblivion_trader_rules r
          GROUP BY r.classname
          ORDER BY item_name COLLATE NOCASE, r.classname COLLATE NOCASE`);
        const global=await dbAll(`SELECT name,category,photo FROM trade_catalog WHERE active=1 ORDER BY id DESC`);
        const byName=new Map();
        for(const item of global){
            const key=String(item.name||'').trim().toLowerCase();
            if(key&&!byName.has(key))byName.set(key,item);
        }
        res.json(rows.map(row=>{
            const match=byName.get(String(row.item_name||'').trim().toLowerCase());
            const photo=String(row.rule_photo||match?.photo||'').trim();
            return {
                classname:row.classname,
                item_name:row.item_name||row.classname,
                category:row.category||match?.category||'GERAL',
                photo,
                hasPhoto:!!photo,
                traderCount:Number(row.trader_count||0),
                traders:String(row.traders||'').split(',').filter(Boolean),
                buyPriceRange:[Number(row.min_buy_price||0),Number(row.max_buy_price||0)],
                sellPriceRange:[Number(row.min_sell_price||0),Number(row.max_sell_price||0)]
            };
        }));
    }catch(e){next(e)}
});

app.get('/api/admin/oblivion/rules', auth, requireCapability('server:panel','oblivion:read','oblivion:manage'), async (req,res,next)=>{
    try{
        const traderId=String(req.query.trader_id||'').trim().toLowerCase();
        const params=[]; let where='';
        if(traderId){where='WHERE r.trader_id=?';params.push(traderId)}
        const rows=await dbAll(`SELECT r.*,t.name trader_name,t.entity_classname FROM oblivion_trader_rules r JOIN oblivion_traders t ON t.trader_id=r.trader_id ${where} ORDER BY t.name,r.item_name`,params);
        res.json(rows);
    }catch(e){next(e)}
});

function normalizeOblivionRule(body){
    const classname=String(body.classname||'').trim();
    const itemName=String(body.item_name||body.name||classname).trim();
    if(!/^[A-Za-z0-9_]{2,120}$/.test(classname)) return {error:'Classname inválido.'};
    if(itemName.length<2||itemName.length>160)return {error:'Nome do item inválido.'};
    const buyPrice=Number(body.buy_price||0),sellPrice=Number(body.sell_price||0);
    if(!Number.isFinite(buyPrice)||!Number.isFinite(sellPrice)||buyPrice<0||sellPrice<0)return {error:'Preço inválido.'};
    const stockMode=String(body.stock_mode||'infinite').toLowerCase()==='finite'?'finite':'infinite';
    const stock=stockMode==='finite'?Math.max(0,Math.floor(Number(body.stock||0))):-1;
    return {value:{
        item_name:itemName,classname,category:String(body.category||'GERAL').trim().toUpperCase().slice(0,80),
        enabled:Number(body.enabled??1)?1:0,buy_enabled:Number(body.buy_enabled??0)?1:0,sell_enabled:Number(body.sell_enabled??1)?1:0,
        buy_price:buyPrice,sell_price:sellPrice,stock_mode:stockMode,stock,
        reputation_required:Math.max(0,Math.floor(Number(body.reputation_required||0))),
        max_quantity:Math.max(1,Math.min(999,Math.floor(Number(body.max_quantity||1)))),
        notes:String(body.notes||'').trim().slice(0,1000)
    }};
}

app.post('/api/admin/oblivion/traders/:traderId/rules', auth, requireCapability('oblivion:manage'), upload.single('photo'), async (req,res,next)=>{
    try{
        const traderId=String(req.params.traderId||'').trim().toLowerCase();
        if(!await dbGet(`SELECT trader_id FROM oblivion_traders WHERE trader_id=?`,[traderId]))return res.status(404).json({error:'Trader não encontrado.'});
        const parsed=normalizeOblivionRule(req.body);if(parsed.error)return res.status(400).json({error:parsed.error}); const v=parsed.value;
        const result=await dbRun(`INSERT INTO oblivion_trader_rules(trader_id,item_name,classname,category,enabled,buy_enabled,sell_enabled,buy_price,sell_price,stock_mode,stock,reputation_required,max_quantity,source_of_truth,photo,notes,created_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'OBLIVIONCONTROL_CONFIG',?,?,?)`,[traderId,v.item_name,v.classname,v.category,v.enabled,v.buy_enabled,v.sell_enabled,v.buy_price,v.sell_price,v.stock_mode,v.stock,v.reputation_required,v.max_quantity,req.file?`/uploads/${req.file.filename}`:'',v.notes,req.user.id]);
        await auditLog({userId:req.user.id,action:'CREATE_OBC_TRADE_RULE_DRAFT',entity:'oblivion_trader_rules',entityId:result.lastID,metadata:{traderId,classname:v.classname}});
        res.status(201).json({success:true,id:result.lastID,appliedToServer:false});
    }catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Esse classname já possui regra nesse trader.'});next(e)}
});

app.put('/api/admin/oblivion/rules/:id', auth, requireCapability('oblivion:manage'), upload.single('photo'), async (req,res,next)=>{
    try{
        const current=await dbGet(`SELECT * FROM oblivion_trader_rules WHERE id=?`,[req.params.id]);if(!current)return res.status(404).json({error:'Regra não encontrada.'});
        const parsed=normalizeOblivionRule({...current,...req.body,classname:current.classname});if(parsed.error)return res.status(400).json({error:parsed.error}); const v=parsed.value;
        const photo=req.file?`/uploads/${req.file.filename}`:current.photo;
        await dbRun(`UPDATE oblivion_trader_rules SET item_name=?,category=?,enabled=?,buy_enabled=?,sell_enabled=?,buy_price=?,sell_price=?,stock_mode=?,stock=?,reputation_required=?,max_quantity=?,source_of_truth='OBLIVIONCONTROL_CONFIG',photo=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[v.item_name,v.category,v.enabled,v.buy_enabled,v.sell_enabled,v.buy_price,v.sell_price,v.stock_mode,v.stock,v.reputation_required,v.max_quantity,photo,v.notes,req.params.id]);
        await auditLog({userId:req.user.id,action:'UPDATE_OBC_TRADE_RULE_DRAFT',entity:'oblivion_trader_rules',entityId:req.params.id,metadata:{traderId:current.trader_id,classname:current.classname}});
        res.json({success:true,appliedToServer:false});
    }catch(e){next(e)}
});

app.delete('/api/admin/oblivion/rules/:id', auth, requireSuperAdminDelete, async (req,res,next)=>{
    try{
        const current=await dbGet(`SELECT * FROM oblivion_trader_rules WHERE id=?`,[req.params.id]);if(!current)return res.status(404).json({error:'Regra não encontrada.'});
        await dbRun(`DELETE FROM oblivion_trader_rules WHERE id=?`,[req.params.id]);
        await auditLog({userId:req.user.id,action:'DELETE_OBC_TRADE_RULE_DRAFT',entity:'oblivion_trader_rules',entityId:req.params.id,metadata:{traderId:current.trader_id,classname:current.classname}});
        res.json({success:true,appliedToServer:false});
    }catch(e){next(e)}
});

app.get('/api/admin/oblivion/releases', auth, requireCapability('server:panel','oblivion:read','releases:manage'), async (req,res,next)=>{
    try{res.json(await dbAll(`SELECT id,release_code,status,notes,created_at,approved_at FROM oblivion_releases ORDER BY id DESC LIMIT 100`))}catch(e){next(e)}
});

app.post('/api/admin/oblivion/releases', auth, requireCapability('releases:manage'), async (req,res,next)=>{
    try{
        const traders=await dbAll(`SELECT trader_id,name,entity_classname,faction_code,location_label,currency,catalog_override_enabled,overlay_mode,source_of_truth,validation_status,notes FROM oblivion_traders ORDER BY trader_id`);
        const rules=await dbAll(`SELECT trader_id,item_name,classname,category,enabled,buy_enabled,sell_enabled,buy_price,sell_price,stock_mode,stock,reputation_required,max_quantity,source_of_truth,notes FROM oblivion_trader_rules ORDER BY trader_id,classname`);
        const settings=await readOblivionSettings();
        const releaseCode=`OBC-WEB-${new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14)}`;
        const payload={schemaVersion:1,mode:'export-only',releaseId:releaseCode,createdAt:new Date().toISOString(),pricesActive:false,traders,rules,settings:Object.fromEntries(Object.entries(settings).map(([k,v])=>[k,v.value]))};
        const result=await dbRun(`INSERT INTO oblivion_releases(release_code,status,payload_json,notes,created_by) VALUES (?,'DRAFT',?,?,?)`,[releaseCode,JSON.stringify(payload),String(req.body.notes||'').trim().slice(0,1000),req.user.id]);
        await auditLog({userId:req.user.id,action:'CREATE_OBC_RELEASE_DRAFT',entity:'oblivion_releases',entityId:result.lastID,metadata:{releaseCode}});
        res.status(201).json({success:true,id:result.lastID,releaseCode,status:'DRAFT',appliedToServer:false});
    }catch(e){next(e)}
});

app.put('/api/admin/oblivion/releases/:id/status', auth, requireCapability('releases:manage'), async (req,res,next)=>{
    try{
        const status=String(req.body.status||'').toUpperCase();
        if(!['DRAFT','APPROVED','ARCHIVED'].includes(status))return res.status(400).json({error:'Status inválido. APPLIED/ONLINE só pode vir do bridge real.'});
        const current=await dbGet(`SELECT * FROM oblivion_releases WHERE id=?`,[req.params.id]);if(!current)return res.status(404).json({error:'Release não encontrada.'});
        await dbRun(`UPDATE oblivion_releases SET status=?,approved_at=CASE WHEN ?='APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END WHERE id=?`,[status,status,req.params.id]);
        await auditLog({userId:req.user.id,action:'UPDATE_OBC_RELEASE_STATUS',entity:'oblivion_releases',entityId:req.params.id,metadata:{releaseCode:current.release_code,status}});
        res.json({success:true,status,appliedToServer:false});
    }catch(e){next(e)}
});

app.get('/api/admin/oblivion/releases/:id/export', auth, requireCapability('server:panel','oblivion:read','releases:manage'), async (req,res,next)=>{
    try{
        const row=await dbGet(`SELECT release_code,payload_json FROM oblivion_releases WHERE id=?`,[req.params.id]);if(!row)return res.status(404).json({error:'Release não encontrada.'});
        res.setHeader('Content-Type','application/json; charset=utf-8');
        res.setHeader('Content-Disposition',`attachment; filename="${row.release_code}.json"`);
        res.send(row.payload_json);
    }catch(e){next(e)}
});

// ECONOMY / OPERATIONS / SYSTEM
app.get('/api/admin/economy-overview' , auth, requireCapability('economy:read'), async (req,res,next)=>{
    try{
        const factions=await dbAll(`SELECT f.id,f.name,
          COALESCE(SUM(CASE WHEN b.type='entrada' THEN b.amount ELSE -b.amount END),0) operational_balance
          FROM factions f LEFT JOIN faction_bank_transactions b ON b.faction_id=f.id GROUP BY f.id ORDER BY f.id`);
        const general=await dbAll(`SELECT faction_id,COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE -amount END),0) balance FROM faction_general_bank_transactions GROUP BY faction_id`);
        const genMap=Object.fromEntries(general.map(x=>[x.faction_id,Number(x.balance||0)]));
        const people=await dbGet(`SELECT COUNT(*) people,COALESCE(SUM(saldo_ru),0) total_personal_money,COALESCE(AVG(reputacao),0) avg_reputation FROM stalkers`);
        const commerce=await dbGet(`SELECT COUNT(*) transactions,COALESCE(SUM(ABS(money_delta)),0) volume FROM commerce_transactions`);
        res.json({factions:factions.map(x=>({...x,general_balance:genMap[x.id]||0})),people,commerce});
    }catch(e){next(e)}
});

app.get('/api/admin/operations-overview', auth, requireCapability('operations:global'), async (req,res,next)=>{
    try{
        const missions=await dbAll(`SELECT status,COUNT(*) qty FROM missoes GROUP BY status`);
        const contracts=await dbAll(`SELECT status,COUNT(*) qty FROM mercenary_contracts GROUP BY status`);
        const quests=await dbAll(`SELECT status,COUNT(*) qty FROM quests GROUP BY status`);
        const experiments=await dbAll(`SELECT status,COUNT(*) qty FROM rp_experiments GROUP BY status`);
        res.json({missions,contracts,quests,experiments});
    }catch(e){next(e)}
});

app.get('/api/admin/system-health', auth, requireCapability('config:manage'), async (req,res,next)=>{
    try{
        const tables=(await dbAll(`SELECT name FROM sqlite_master WHERE type='table'`)).map(x=>x.name);
        const settings=await dbAll(`SELECT key,value,updated_at FROM server_settings ORDER BY key`);
        res.json({
            service:'stalker-faction-network',
            node:process.version,
            uptimeSeconds:Math.floor(process.uptime()),
            database:DB_PATH,
            tableCount:tables.length,
            settings
        });
    }catch(e){next(e)}
});

app.put('/api/admin/system-settings/:key', auth, requireCapability('config:manage'), async (req,res,next)=>{
    try{
        const key=String(req.params.key||'').trim();
        if(!/^[a-zA-Z0-9_.:-]{2,80}$/.test(key))return res.status(400).json({error:'Chave inválida.'});
        if(key.toLowerCase().startsWith('obc.')) return res.status(400).json({error:'Configurações Oblivion Control são gerenciadas pela Central Servidor & Oblivion e pelo bridge validado.'});
        const value=String(req.body.value??'');
        await dbRun(`INSERT INTO server_settings(key,value,updated_by,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`,[key,value,req.user.id]);
        await auditLog({userId:req.user.id,action:'UPDATE_SERVER_SETTING',entity:'server_settings',metadata:{key}});
        res.json({success:true});
    }catch(e){next(e)}
});

// --- GLOBAL TRADE CATALOG ---
app.get('/api/trade-catalog', auth, async (req,res,next)=>{
    try{
        const channel=String(req.query.channel||'ALL').toUpperCase();
        const rows=await dbAll(`SELECT * FROM trade_catalog ORDER BY active DESC, category COLLATE NOCASE, name COLLATE NOCASE`);
        const filtered=rows.filter(r=>{
            let channels=['ALL'];
            try{channels=JSON.parse(r.channels_json||'["ALL"]')}catch(_){}
            channels=(Array.isArray(channels)?channels:['ALL']).map(v=>String(v).toUpperCase());
            return channel==='ADMIN'||channels.includes('ALL')||channels.includes(channel);
        });
        res.json(filtered);
    }catch(e){next(e)}
});

app.post('/api/admin/trade-catalog', auth, upload.single('foto'), async (req,res,next)=>{
    try{
        if(req.user.role!=='super_admin'){const caps=await getEffectiveCapabilities(req.user.id,req.user.role);if(!caps.includes('trade:manage'))return res.status(403).json({error:'Sem permissão para administrar o catálogo global.'});}
        let channels=['ALL'];try{channels=JSON.parse(req.body.channels||'["ALL"]')}catch(_){}
        if(!Array.isArray(channels)||!channels.length)channels=['ALL'];
        const name=String(req.body.name||'').trim();
        if(name.length<2)return res.status(400).json({error:'Informe o nome do item.'});
        const result=await dbRun(`INSERT INTO trade_catalog
            (name,category,buy_price,sell_price,reputation_reward,stock,track_stock,active,photo,notes,channels_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[
            name,String(req.body.category||'GERAL').trim().toUpperCase(),Number(req.body.buy_price||0),Number(req.body.sell_price||0),
            Number(req.body.reputation_reward||0),Number(req.body.stock||0),Number(req.body.track_stock||0)?1:0,
            req.body.active===undefined?1:(Number(req.body.active)?1:0),req.file?`/uploads/${req.file.filename}`:'',String(req.body.notes||'').trim(),JSON.stringify(channels)
        ]);
        await auditLog({userId:req.user.id,factionId:null,action:'CREATE_GLOBAL_TRADE_ITEM',entity:'trade_catalog',entityId:result.lastID,metadata:{name}});
        res.status(201).json({success:true,id:result.lastID});
    }catch(e){if(String(e.message).includes('UNIQUE'))return res.status(409).json({error:'Já existe um item com esse nome.'});next(e)}
});

app.put('/api/admin/trade-catalog/:id', auth, upload.single('foto'), async (req,res,next)=>{
    try{
        if(req.user.role!=='super_admin'){const caps=await getEffectiveCapabilities(req.user.id,req.user.role);if(!caps.includes('trade:manage'))return res.status(403).json({error:'Sem permissão para administrar o catálogo global.'});}
        const current=await dbGet(`SELECT * FROM trade_catalog WHERE id=?`,[req.params.id]);
        if(!current)return res.status(404).json({error:'Item não encontrado.'});
        let channels=['ALL'];try{channels=JSON.parse(req.body.channels||current.channels_json||'["ALL"]')}catch(_){}
        const photo=req.file?`/uploads/${req.file.filename}`:current.photo;
        await dbRun(`UPDATE trade_catalog SET name=?,category=?,buy_price=?,sell_price=?,reputation_reward=?,stock=?,track_stock=?,active=?,photo=?,notes=?,channels_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[
            String(req.body.name||current.name).trim(),String(req.body.category||current.category).trim().toUpperCase(),Number(req.body.buy_price??current.buy_price),Number(req.body.sell_price??current.sell_price),
            Number(req.body.reputation_reward??current.reputation_reward),Number(req.body.stock??current.stock),Number(req.body.track_stock??current.track_stock)?1:0,Number(req.body.active??current.active)?1:0,
            photo,String(req.body.notes??current.notes).trim(),JSON.stringify(Array.isArray(channels)&&channels.length?channels:['ALL']),req.params.id
        ]);
        await auditLog({userId:req.user.id,factionId:null,action:'UPDATE_GLOBAL_TRADE_ITEM',entity:'trade_catalog',entityId:req.params.id,metadata:{name:req.body.name||current.name}});
        res.json({success:true});
    }catch(e){next(e)}
});

app.delete('/api/admin/trade-catalog/:id', auth, requireSuperAdminDelete, async (req,res,next)=>{
    try{
        const row=await dbGet(`SELECT id,name FROM trade_catalog WHERE id=?`,[req.params.id]);
        if(!row)return res.status(404).json({error:'Item não encontrado.'});
        await dbRun(`DELETE FROM trade_catalog WHERE id=?`,[req.params.id]);
        await auditLog({userId:req.user.id,factionId:null,action:'DELETE_GLOBAL_TRADE_ITEM',entity:'trade_catalog',entityId:req.params.id,metadata:{name:row.name}});
        res.json({success:true});
    }catch(e){next(e)}
});

app.get('/api/commerce/people', auth, async (req, res, next) => {
    try {
        const moduleCode = String(req.query.module || '').trim().toLowerCase();
        const scope = await resolveCommerceScope(req, moduleCode);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const rows = await dbAll(`
            SELECT id,nome,codinome,faccao,foto,reputacao,COALESCE(saldo_ru,0) AS saldo_ru,area_atuacao
            FROM stalkers
            WHERE faction_id=?
            ORDER BY codinome COLLATE NOCASE ASC, nome COLLATE NOCASE ASC`,
            [scope.factionId]
        );
        res.json(rows);
    } catch (e) { next(e); }
});

app.get('/api/commerce/transactions', auth, async (req, res, next) => {
    try {
        const moduleCode = String(req.query.module || '').trim().toLowerCase();
        const scope = await resolveCommerceScope(req, moduleCode);
        if (scope.error) return res.status(403).json({ error: scope.error });

        const rows = await dbAll(`
            SELECT ct.*, s.nome, s.codinome, s.foto, u.name AS created_by_name
            FROM commerce_transactions ct
            LEFT JOIN stalkers s ON s.id=ct.person_id
            LEFT JOIN users u ON u.id=ct.created_by
            WHERE ct.faction_id=? AND ct.module_code=?
            ORDER BY ct.created_at DESC, ct.id DESC
            LIMIT 250`, [scope.factionId, moduleCode]);
        res.json(rows);
    } catch (e) { next(e); }
});

app.post('/api/commerce/transactions', auth, async (req, res, next) => {
    try {
        if (!canWriteFactionRp(req)) {
            return res.status(403).json({ error:'Seu cargo não pode registrar transações comerciais.' });
        }

        const schema = z.object({
            module: z.string().trim().min(2).max(40),
            personId: z.coerce.number().int().positive(),
            operationType: z.enum(['FACCAO_COMPRA','FACCAO_VENDE','RECOMPENSA']),
            merchandise: z.string().trim().min(2).max(160),
            catalogId: z.coerce.number().int().positive().optional(),
            quantity: z.coerce.number().positive().max(100000).default(1),
            money: z.coerce.number().min(0).max(100000000).default(0),
            reputation: z.coerce.number().int().min(0).max(1000000).default(0),
            notes: z.string().trim().max(2000).optional().default('')
        });
        const parsed=schema.safeParse(req.body);
        if(!parsed.success) return res.status(400).json({error:'Dados da transação inválidos.'});
        const d=parsed.data;
        const moduleCode=d.module.toLowerCase();
        const scope=await resolveCommerceScope(req,moduleCode);
        if(scope.error) return res.status(403).json({error:scope.error});

        let catalogItem=null;
        if(d.catalogId){
            catalogItem=await dbGet(`SELECT * FROM trade_catalog WHERE id=? AND active=1`,[d.catalogId]);
            if(!catalogItem)return res.status(404).json({error:'Item do catálogo não encontrado ou desativado.'});
            let channels=['ALL'];try{channels=JSON.parse(catalogItem.channels_json||'["ALL"]')}catch(_){}
            const channel=String(scope.faction.code||'').toUpperCase();
            if(!channels.map(v=>String(v).toUpperCase()).includes('ALL')&&!channels.map(v=>String(v).toUpperCase()).includes(channel)){
                return res.status(403).json({error:'Este item não está disponível neste trade.'});
            }
            d.merchandise=catalogItem.name;
            if(d.operationType==='FACCAO_COMPRA') d.money=Number(catalogItem.buy_price||0)*Number(d.quantity||1);
            if(d.operationType==='FACCAO_VENDE') d.money=Number(catalogItem.sell_price||0)*Number(d.quantity||1);
            if(d.reputation<=0) d.reputation=Number(catalogItem.reputation_reward||0);
            if(d.operationType==='FACCAO_VENDE' && Number(catalogItem.track_stock||0)===1 && Number(d.quantity||1)>Number(catalogItem.stock||0)){
                return res.status(400).json({error:`Estoque insuficiente. Disponível: ${Number(catalogItem.stock||0)}.`});
            }
        }

        if(d.money<=0 && d.reputation<=0){
            return res.status(400).json({error:'Informe uma recompensa/valor em RU, reputação ou ambos.'});
        }

        const person=await dbGet(`
            SELECT id,nome,codinome,reputacao,COALESCE(saldo_ru,0) AS saldo_ru
            FROM stalkers WHERE id=? AND faction_id=?`, [d.personId,scope.factionId]);
        if(!person) return res.status(404).json({error:'Pessoa não encontrada nesta facção.'});

        const bankRow=await dbGet(`
            SELECT COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE -amount END),0) AS balance
            FROM faction_bank_transactions WHERE faction_id=?`,[scope.factionId]);
        const factionBalance=Number(bankRow?.balance||0);
        const personBalance=Number(person.saldo_ru||0);

        let moneyDelta=0;
        let bankType=null;
        if(d.operationType==='FACCAO_COMPRA' || d.operationType==='RECOMPENSA'){
            moneyDelta=d.money;
            bankType=d.money>0?'saida':null;
            if(d.money>factionBalance){
                return res.status(400).json({error:`Saldo insuficiente da facção. Caixa atual: ${factionBalance.toFixed(2)} RU.`});
            }
        } else if(d.operationType==='FACCAO_VENDE'){
            moneyDelta=-d.money;
            bankType=d.money>0?'entrada':null;
            if(d.money>personBalance){
                return res.status(400).json({error:`Saldo insuficiente da pessoa. Saldo pessoal: ${personBalance.toFixed(2)} RU.`});
            }
        }

        const nextBalance=personBalance+moneyDelta;
        const nextRep=Number(person.reputacao||0)+d.reputation;
        let bankTransactionId=null;
        const today=new Date().toISOString().slice(0,10);

        await dbRun('BEGIN IMMEDIATE TRANSACTION');
        try{
            await dbRun(`UPDATE stalkers SET saldo_ru=?, reputacao=? WHERE id=? AND faction_id=?`,
                [nextBalance,nextRep,person.id,scope.factionId]);

            if(catalogItem && Number(catalogItem.track_stock||0)===1){
                const qty=Number(d.quantity||1);
                const delta=d.operationType==='FACCAO_COMPRA'?qty:(d.operationType==='FACCAO_VENDE'?-qty:0);
                if(delta!==0) await dbRun(`UPDATE trade_catalog SET stock=stock+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[delta,catalogItem.id]);
            }

            if(bankType){
                const reason=`${moduleCode.toUpperCase()} • ${d.operationType} • ${d.merchandise} • ${person.codinome||person.nome}`;
                const bankResult=await dbRun(`
                    INSERT INTO faction_bank_transactions (faction_id,user_id,type,amount,reason,transaction_date)
                    VALUES (?,?,?,?,?,?)`,[scope.factionId,req.user.id,bankType,d.money,reason,today]);
                bankTransactionId=bankResult.lastID;
            }

            const result=await dbRun(`
                INSERT INTO commerce_transactions
                (faction_id,module_code,person_id,operation_type,merchandise,quantity,money_delta,reputation_delta,person_balance_after,person_reputation_after,bank_transaction_id,notes,created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [scope.factionId,moduleCode,person.id,d.operationType,d.merchandise,d.quantity,moneyDelta,d.reputation,nextBalance,nextRep,bankTransactionId,d.notes,req.user.id]
            );
            await dbRun('COMMIT');

            await auditLog({
                userId:req.user.id,factionId:scope.factionId,action:'CREATE_COMMERCE_TRANSACTION',entity:moduleCode,entityId:result.lastID,
                metadata:{personId:person.id,person:person.codinome||person.nome,operationType:d.operationType,merchandise:d.merchandise,quantity:d.quantity,moneyDelta,reputationDelta:d.reputation}
            });

            res.status(201).json({
                success:true,id:result.lastID,
                person:{id:person.id,nome:person.nome,codinome:person.codinome,saldo_ru:nextBalance,reputacao:nextRep},
                factionBalance:factionBalance+(bankType==='entrada'?d.money:bankType==='saida'?-d.money:0)
            });
        }catch(e){
            try{await dbRun('ROLLBACK')}catch(_){ }
            throw e;
        }
    } catch(e){next(e)}
});

app.delete('/api/commerce/transactions/:id', auth, requireSuperAdminDelete, async (req,res,next)=>{
    try{
        const tx=await dbGet(`SELECT * FROM commerce_transactions WHERE id=?`,[req.params.id]);
        if(!tx) return res.status(404).json({error:'Transação não encontrada.'});
        const fId=getFactionScope(req);
        if(!fId || Number(tx.faction_id)!==Number(fId)) return res.status(403).json({error:'Transação não pertence à facção selecionada.'});

        await dbRun('BEGIN IMMEDIATE TRANSACTION');
        try{
            await dbRun(`UPDATE stalkers SET saldo_ru=COALESCE(saldo_ru,0)-?, reputacao=COALESCE(reputacao,0)-? WHERE id=? AND faction_id=?`,
                [Number(tx.money_delta||0),Number(tx.reputation_delta||0),tx.person_id,tx.faction_id]);
            if(tx.bank_transaction_id){
                await dbRun(`DELETE FROM faction_bank_transactions WHERE id=? AND faction_id=?`,[tx.bank_transaction_id,tx.faction_id]);
            }
            await dbRun(`DELETE FROM commerce_transactions WHERE id=?`,[tx.id]);
            await dbRun('COMMIT');
        }catch(e){try{await dbRun('ROLLBACK')}catch(_){ } throw e}

        await auditLog({userId:req.user.id,factionId:tx.faction_id,action:'DELETE_COMMERCE_TRANSACTION',entity:tx.module_code,entityId:tx.id,
            metadata:{personId:tx.person_id,moneyDelta:tx.money_delta,reputationDelta:tx.reputation_delta,merchandise:tx.merchandise}});
        res.json({success:true,deleted:true});
    }catch(e){next(e)}
});

// --- BANCO GERAL / RESERVA DA FACÇÃO ---
app.get('/api/general-bank', auth, async (req, res, next) => {
    try {
        const fId = getFactionScope(req);
        if (!fId) return res.status(400).json({ error: 'Selecione uma facção.' });

        const faction = await dbGet(`SELECT id, name, code FROM factions WHERE id=?`, [fId]);
        if (!faction) return res.status(404).json({ error: 'Facção não encontrada.' });

        const summary = await dbGet(`
            SELECT
              COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE 0 END),0) AS total_entradas,
              COALESCE(SUM(CASE WHEN type='saida' THEN amount ELSE 0 END),0) AS total_saidas
            FROM faction_general_bank_transactions
            WHERE faction_id=?
        `, [fId]);

        const transactions = await dbAll(`
            SELECT t.*, u.name AS user_name, u.username
            FROM faction_general_bank_transactions t
            LEFT JOIN users u ON u.id=t.user_id
            WHERE t.faction_id=?
            ORDER BY t.transaction_date DESC, t.id DESC
        `, [fId]);

        const entradas = Number(summary.total_entradas || 0);
        const saidas = Number(summary.total_saidas || 0);

        res.json({
            faction,
            balance: entradas - saidas,
            total_entradas: entradas,
            total_saidas: saidas,
            can_manage: canManageGeneralBank(req),
            transactions
        });
    } catch (e) { next(e); }
});

app.post('/api/general-bank', auth, async (req, res, next) => {
    try {
        if (!canManageGeneralBank(req)) {
            return res.status(403).json({
                error: 'Somente o líder da facção pode registrar entradas e retiradas no Banco Geral.'
            });
        }

        const fId = getFactionScope(req);
        if (!fId) return res.status(400).json({ error: 'Selecione uma facção.' });

        if (req.user.role !== 'super_admin' && fId !== req.user.factionId) {
            return res.status(403).json({ error: 'Você só pode operar o Banco Geral da sua própria facção.' });
        }

        const { type, amount, reason, transaction_date } = req.body;
        const value = Number(amount);

        if (!['entrada','saida'].includes(type)) {
            return res.status(400).json({ error: 'Tipo de movimentação inválido.' });
        }
        if (!Number.isFinite(value) || value <= 0) {
            return res.status(400).json({ error: 'O valor deve ser maior que zero.' });
        }
        if (!String(reason || '').trim()) {
            return res.status(400).json({ error: 'Informe o motivo da movimentação.' });
        }

        const today = getAppToday();
        if (!isValidIsoDate(transaction_date)) {
            return res.status(400).json({ error: 'Data inválida.' });
        }
        if (transaction_date < today) {
            return res.status(400).json({
                error: `Datas anteriores a ${today} não são permitidas.`
            });
        }

        if (type === 'saida') {
            const row = await dbGet(`
                SELECT COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE -amount END),0) AS balance
                FROM faction_general_bank_transactions
                WHERE faction_id=?
            `, [fId]);

            const balance = Number(row?.balance || 0);
            if (value > balance) {
                return res.status(400).json({
                    error: `Saldo insuficiente no Banco Geral. Saldo atual: ${balance.toFixed(2)} RU.`
                });
            }
        }

        const result = await dbRun(`
            INSERT INTO faction_general_bank_transactions
            (faction_id,user_id,type,amount,reason,transaction_date)
            VALUES (?,?,?,?,?,?)
        `, [fId, req.user.id, type, value, String(reason).trim(), transaction_date]);

        await auditLog({
            userId:req.user.id,
            factionId:fId,
            action:type === 'entrada' ? 'GENERAL_BANK_DEPOSIT' : 'GENERAL_BANK_WITHDRAWAL',
            entity:'general_bank',
            entityId:result.lastID,
            metadata:{ amount:value, reason:String(reason).trim(), date:transaction_date },
            ipAddress:req.ip,
            userAgent:req.get('user-agent')
        });

        res.status(201).json({ success:true, id:result.lastID });
    } catch (e) { next(e); }
});

app.delete('/api/general-bank/:id', auth, requireSuperAdminDelete, async (req, res, next) => {
    try {
        const fId = getFactionScope(req);
        if (!fId) return res.status(400).json({ error: 'Selecione uma facção.' });

        const row = await dbGet(`
            SELECT id,type,amount,reason
            FROM faction_general_bank_transactions
            WHERE id=? AND faction_id=?
        `, [req.params.id, fId]);

        if (!row) return res.status(404).json({ error: 'Lançamento não encontrado.' });

        await dbRun(`DELETE FROM faction_general_bank_transactions WHERE id=? AND faction_id=?`,
            [req.params.id, fId]);

        await auditLog({
            userId:req.user.id,
            factionId:fId,
            action:'DELETE_GENERAL_BANK_TRANSACTION',
            entity:'general_bank',
            entityId:req.params.id,
            metadata:{ type:row.type, amount:row.amount, reason:row.reason },
            ipAddress:req.ip,
            userAgent:req.get('user-agent')
        });

        res.json({ success:true, deleted:true });
    } catch (e) { next(e); }
});

// --- BANK / CAIXA ---
app.get('/api/bank', auth, async (req, res) => {
    const fId = getFactionScope(req);
    if (!fId) return res.status(400).json({ error: 'Contexto de facção necessário.' });
    
    const balanceRow = await dbGet(`
        SELECT 
            SUM(CASE WHEN type = 'entrada' THEN amount ELSE 0 END) as total_entradas,
            SUM(CASE WHEN type = 'saida' THEN amount ELSE 0 END) as total_saidas
        FROM faction_bank_transactions 
        WHERE faction_id = ?
    `, [fId]);
    
    const transactions = await dbAll(`
        SELECT t.*, u.name as user_name, u.username 
        FROM faction_bank_transactions t
        JOIN users u ON t.user_id = u.id
        WHERE t.faction_id = ?
        ORDER BY t.transaction_date DESC, t.id DESC
    `, [fId]);
    
    res.json({
        balance: (balanceRow.total_entradas || 0) - (balanceRow.total_saidas || 0),
        total_entradas: balanceRow.total_entradas || 0,
        total_saidas: balanceRow.total_saidas || 0,
        transactions
    });
});

app.delete('/api/bank/:id', auth, requireSuperAdminDelete, async (req, res, next) => {
    try {
        const fId = getFactionScope(req);
        if (!fId) return res.status(400).json({ error: 'Selecione uma facção.' });

        const tx = await dbGet(
            `SELECT id, type, amount, reason FROM faction_bank_transactions WHERE id=? AND faction_id=?`,
            [req.params.id, fId]
        );
        if (!tx) return res.status(404).json({ error: 'Transação não encontrada nesta facção.' });

        await dbRun(`DELETE FROM faction_bank_transactions WHERE id=? AND faction_id=?`, [req.params.id, fId]);
        await auditLog({
            userId:req.user.id,
            factionId:fId,
            action:'DELETE_BANK_TRANSACTION',
            entity:'bank',
            entityId:req.params.id,
            metadata:{ type:tx.type, amount:tx.amount, reason:tx.reason },
            ipAddress:req.ip,
            userAgent:req.get('user-agent')
        });
        res.json({ success:true, deleted:true });
    } catch(e) { next(e); }
});

app.post('/api/bank', auth, async (req, res) => {
    const fId = getFactionScope(req);
    if (!fId) return res.status(400).json({ error: 'Contexto de facção necessário.' });
    
    const { type, amount, reason, transaction_date } = req.body;
    if (!type || !amount || !reason || !transaction_date) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios (tipo, valor, justificativa, data).' });
    }
    
    if (type !== 'entrada' && type !== 'saida') {
        return res.status(400).json({ error: 'Tipo inválido.' });
    }

    // Data retroativa não é permitida. O fuso padrão do sistema é America/Maceio.
    const today = getAppToday();
    if (!isValidIsoDate(transaction_date)) {
        return res.status(400).json({ error: 'Data inválida.' });
    }
    if (transaction_date < today) {
        return res.status(400).json({
            error: `Não é permitido registrar transações anteriores a ${today}.`
        });
    }
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Valor deve ser maior que zero.' });
    }

    if (type === 'saida') {
        const balanceRow = await dbGet(`
            SELECT COALESCE(SUM(CASE WHEN type = 'entrada' THEN amount ELSE -amount END), 0) AS balance
            FROM faction_bank_transactions
            WHERE faction_id = ?
        `, [fId]);

        const currentBalance = Number(balanceRow?.balance || 0);
        if (numAmount > currentBalance) {
            return res.status(400).json({
                error: `Saldo insuficiente. Saldo atual: ${currentBalance.toFixed(2)} RU.`
            });
        }
    }

    try {
        await dbRun(`
            INSERT INTO faction_bank_transactions (faction_id, user_id, type, amount, reason, transaction_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [fId, req.user.id, type, numAmount, reason, transaction_date]);
        
        await auditLog({
            userId: req.user.id,
            factionId: fId,
            action: `bank_${type}`,
            entity: 'bank',
            metadata: { amount: numAmount, reason, date: transaction_date },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao salvar transação.' });
    }
});


async function tableHasColumn(tableName, columnName) {
    if (!(await tableExists(tableName))) return false;
    const cols = await getTableColumns(tableName);
    return cols.includes(columnName);
}

async function backupDatabaseForReset(label='reset') {
    const backupDir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '-');
    const backupPath = path.join(backupDir, `database-before-${safeLabel}-${stamp}.db`);
    try { await dbRun('PRAGMA wal_checkpoint(FULL)'); } catch (_) {}
    fs.copyFileSync(DB_PATH, backupPath);
    return backupPath;
}

async function countFactionResetData(factionId, factionCode) {
    const counts = {};
    const factionTables = [
        'faction_bank_transactions','faction_general_bank_transactions','faction_records','rp_experiments',
        'commerce_transactions','stalkers','itens','missoes','relatorios','pesquisas','historico','audit_log'
    ];
    for (const table of factionTables) {
        if (await tableHasColumn(table, 'faction_id')) {
            const row = await dbGet(`SELECT COUNT(*) AS count FROM ${table} WHERE faction_id=?`, [factionId]);
            counts[table] = Number(row?.count || 0);
        }
    }
    if (factionCode === 'mercenaries' && await tableExists('mercenary_contracts')) {
        const row = await dbGet(`SELECT COUNT(*) AS count FROM mercenary_contracts`);
        counts.mercenary_contracts = Number(row?.count || 0);
        if (await tableExists('contract_notes')) {
            const notes = await dbGet(`SELECT COUNT(*) AS count FROM contract_notes`);
            counts.contract_notes = Number(notes?.count || 0);
        }
    }
    const users = await dbGet(`SELECT COUNT(*) AS count FROM users WHERE faction_id=?`, [factionId]);
    counts.users = Number(users?.count || 0);
    return counts;
}

async function cleanupOrphanUploads() {
    const refs = new Set();
    const addRef = (value) => {
        if (!value || typeof value !== 'string') return;
        const match = value.match(/\/uploads\/([^?"'#]+)/);
        if (match) refs.add(path.basename(match[1]));
    };

    for (const table of ['stalkers','itens','missoes','relatorios','rp_experiments']) {
        if (!(await tableExists(table)) || !(await tableHasColumn(table,'foto'))) continue;
        const rows = await dbAll(`SELECT foto FROM ${table} WHERE foto IS NOT NULL AND foto != ''`);
        rows.forEach(r => addRef(r.foto));
    }
    if (await tableExists('faction_records')) {
        const rows = await dbAll(`SELECT extra_json FROM faction_records WHERE extra_json IS NOT NULL`);
        for (const row of rows) {
            try {
                const obj = JSON.parse(row.extra_json || '{}');
                if (obj?.photo) addRef(obj.photo);
            } catch (_) {}
        }
    }

    if (!fs.existsSync(UPLOAD_DIR)) return 0;
    let removed = 0;
    for (const name of fs.readdirSync(UPLOAD_DIR)) {
        if (name === '.gitkeep') continue;
        const full = path.join(UPLOAD_DIR, name);
        try {
            if (fs.statSync(full).isFile() && !refs.has(name)) {
                fs.unlinkSync(full);
                removed++;
            }
        } catch (_) {}
    }
    return removed;
}

async function resetFactionData(factionId, mode='operational') {
    const faction = await dbGet(`SELECT id, code, name FROM factions WHERE id=?`, [factionId]);
    if (!faction) throw new Error('Facção não encontrada.');

    const tables = [
        'faction_bank_transactions','faction_general_bank_transactions','faction_records','rp_experiments',
        'commerce_transactions','stalkers','itens','missoes','relatorios','pesquisas','historico','audit_log'
    ];

    await dbRun('PRAGMA foreign_keys=OFF');
    try {
        await dbRun('BEGIN IMMEDIATE TRANSACTION');

        // Mercenary contracts are global/public records dedicated to the Mercenary faction.
        if (faction.code === 'mercenaries') {
            if (await tableExists('contract_notes')) await dbRun(`DELETE FROM contract_notes`);
            if (await tableExists('mercenary_contracts')) await dbRun(`DELETE FROM mercenary_contracts`);
        }

        for (const table of tables) {
            if (await tableHasColumn(table, 'faction_id')) {
                await dbRun(`DELETE FROM ${table} WHERE faction_id=?`, [factionId]);
            }
        }

        if (mode === 'full') {
            await dbRun(`DELETE FROM users WHERE faction_id=?`, [factionId]);
        }

        await dbRun('COMMIT');
    } catch (e) {
        try { await dbRun('ROLLBACK'); } catch (_) {}
        throw e;
    } finally {
        try { await dbRun('PRAGMA foreign_keys=ON'); } catch (_) {}
    }

    const orphanUploadsRemoved = await cleanupOrphanUploads();
    return { faction, orphanUploadsRemoved };
}

async function resetAllFactionData(mode='operational') {
    const factions = await dbAll(`SELECT id, code, name FROM factions ORDER BY id`);
    for (const faction of factions) {
        await resetFactionData(faction.id, mode);
    }
    return factions;
}


app.get('/api/admin/reset-history', auth, requireCapability('faction:manage'), async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error:'Somente o Super Admin pode consultar resets.' });
        const rows = await dbAll(`
            SELECT h.*, u.name AS user_name, u.username, f.name AS faction_name
            FROM admin_reset_history h
            LEFT JOIN users u ON u.id=h.user_id
            LEFT JOIN factions f ON f.id=h.faction_id
            ORDER BY h.created_at DESC, h.id DESC LIMIT 20
        `);
        res.json(rows);
    } catch (e) { next(e); }
});

app.get('/api/admin/factions/:id/reset-summary', auth, requireCapability('faction:manage'), async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error:'Somente o Super Admin pode resetar facções.' });
        const faction = await dbGet(`SELECT id,code,name FROM factions WHERE id=?`, [req.params.id]);
        if (!faction) return res.status(404).json({ error:'Facção não encontrada.' });
        const counts = await countFactionResetData(faction.id, faction.code);
        res.json({ faction, counts });
    } catch (e) { next(e); }
});

app.post('/api/admin/factions/:id/reset', auth, requireCapability('faction:manage'), async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error:'Somente o Super Admin pode resetar facções.' });
        const faction = await dbGet(`SELECT id,code,name FROM factions WHERE id=?`, [req.params.id]);
        if (!faction) return res.status(404).json({ error:'Facção não encontrada.' });

        const mode = req.body?.mode === 'full' ? 'full' : 'operational';
        const expected = `RESETAR ${String(faction.name).toUpperCase()}`;
        if (String(req.body?.confirmation || '').trim().toUpperCase() !== expected) {
            return res.status(400).json({ error:`Confirmação inválida. Digite exatamente: ${expected}` });
        }

        const backupPath = await backupDatabaseForReset(`faction-${faction.code}-${mode}`);
        const result = await resetFactionData(faction.id, mode);
        await dbRun(`INSERT INTO admin_reset_history (user_id,faction_id,reset_mode,scope,backup_file) VALUES (?,?,?,?,?)`,
            [req.user.id, faction.id, mode, 'faction', path.basename(backupPath)]);

        res.json({ success:true, faction:result.faction, mode, backup:path.basename(backupPath), orphanUploadsRemoved:result.orphanUploadsRemoved });
    } catch (e) { next(e); }
});

app.post('/api/admin/reset-all-factions', auth, requireCapability('faction:manage'), async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error:'Somente o Super Admin pode resetar o servidor.' });
        const mode = req.body?.mode === 'full' ? 'full' : 'operational';
        const expected = mode === 'full' ? 'RESETAR TUDO' : 'ZERAR TODAS';
        if (String(req.body?.confirmation || '').trim().toUpperCase() !== expected) {
            return res.status(400).json({ error:`Confirmação inválida. Digite exatamente: ${expected}` });
        }

        const backupPath = await backupDatabaseForReset(`all-factions-${mode}`);
        const factions = await resetAllFactionData(mode);
        await dbRun(`INSERT INTO admin_reset_history (user_id,faction_id,reset_mode,scope,backup_file) VALUES (?,?,?,?,?)`,
            [req.user.id, null, mode, 'all', path.basename(backupPath)]);

        res.json({ success:true, mode, factions:factions.length, backup:path.basename(backupPath) });
    } catch (e) { next(e); }
});

app.get('/api/admin/overview', auth, requireCapability('faction:manage'), async (req, res) => {
    const users = await dbGet(`SELECT COUNT(*) as count FROM users`);
    const factions = await dbGet(`SELECT COUNT(*) as count FROM factions WHERE active=1`);
    const contracts = await dbGet(`SELECT COUNT(*) as count FROM mercenary_contracts WHERE status='NEW'`);
    const audits = await dbGet(`SELECT COUNT(*) as count FROM audit_log`);
    res.json({ 
        totalUsers: users.count, 
        activeFactions: factions.count, 
        pendingContracts: contracts.count,
        auditEntries: audits.count
    });
});

app.get('/api/admin/global-dashboard', auth, requireCapability('faction:manage'), async (req, res, next) => {
    try {
        const factions = await dbAll(`SELECT id, code, name, slug, active, theme_config FROM factions ORDER BY id ASC`);

        const totalUsersRow = await dbGet(`SELECT COUNT(*) AS count FROM users`);
        const activeUsersRow = await dbGet(`SELECT COUNT(*) AS count FROM users WHERE active = 1`);
        const inactiveUsersRow = await dbGet(`SELECT COUNT(*) AS count FROM users WHERE active = 0`);
        const activeFactionsRow = await dbGet(`SELECT COUNT(*) AS count FROM factions WHERE active = 1`);
        const pendingContractsRow = await dbGet(`SELECT COUNT(*) AS count FROM mercenary_contracts WHERE status = 'NEW'`);
        const activeContractsRow = await dbGet(`SELECT COUNT(*) AS count FROM mercenary_contracts WHERE status = 'ACCEPTED'`);
        const audits24hRow = await dbGet(`SELECT COUNT(*) AS count FROM audit_log WHERE created_at >= datetime('now', '-1 day')`);
        const missionsOpenRow = await dbGet(`SELECT COUNT(*) AS count FROM missoes WHERE status IS NULL OR status != 'ENCERRADA'`);

        const bankGlobal = await dbGet(`
            SELECT
                COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE 0 END),0) AS entradas,
                COALESCE(SUM(CASE WHEN type='saida' THEN amount ELSE 0 END),0) AS saidas
            FROM faction_bank_transactions
        `);

        const factionCards = [];
        const alerts = [];

        for (const f of factions) {
            const users = await dbGet(`SELECT COUNT(*) AS count FROM users WHERE faction_id=?`, [f.id]);
            const activeUsers = await dbGet(`SELECT COUNT(*) AS count FROM users WHERE faction_id=? AND active=1`, [f.id]);
            const bank = await dbGet(`
                SELECT
                    COALESCE(SUM(CASE WHEN type='entrada' THEN amount ELSE 0 END),0) AS entradas,
                    COALESCE(SUM(CASE WHEN type='saida' THEN amount ELSE 0 END),0) AS saidas
                FROM faction_bank_transactions WHERE faction_id=?
            `, [f.id]);
            const missions = await dbGet(`SELECT COUNT(*) AS count FROM missoes WHERE faction_id=? AND (status IS NULL OR status != 'ENCERRADA')`, [f.id]);
            const stalkers = await dbGet(`SELECT COUNT(*) AS count FROM stalkers WHERE faction_id=?`, [f.id]);
            const items = await dbGet(`SELECT COUNT(*) AS count FROM itens WHERE faction_id=?`, [f.id]);
            const activity7d = await dbGet(`SELECT COUNT(*) AS count FROM audit_log WHERE faction_id=? AND created_at >= datetime('now','-7 day')`, [f.id]);
            const lastActivity = await dbGet(`
                SELECT a.action, a.created_at, u.name AS user_name, u.username
                FROM audit_log a
                LEFT JOIN users u ON u.id=a.user_id
                WHERE a.faction_id=?
                ORDER BY a.created_at DESC, a.id DESC LIMIT 1
            `, [f.id]);

            const moduleRows = await dbAll(`
                SELECT module_code, status, COUNT(*) AS count
                FROM faction_records
                WHERE faction_id=?
                GROUP BY module_code, status
            `, [f.id]);

            const moduleCounts = {};
            for (const r of moduleRows) {
                if (!moduleCounts[r.module_code]) moduleCounts[r.module_code] = { total:0, statuses:{} };
                moduleCounts[r.module_code].total += Number(r.count || 0);
                moduleCounts[r.module_code].statuses[r.status || 'sem_status'] = Number(r.count || 0);
            }

            const balance = Number(bank.entradas || 0) - Number(bank.saidas || 0);
            const metrics = [];

            if (f.code === 'mercenaries') {
                const contracts = await dbGet(`
                    SELECT
                        SUM(CASE WHEN status='NEW' THEN 1 ELSE 0 END) AS novos,
                        SUM(CASE WHEN status='ACCEPTED' THEN 1 ELSE 0 END) AS aceitos,
                        SUM(CASE WHEN status='SUSPENDED' THEN 1 ELSE 0 END) AS suspensos,
                        SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS concluidos
                    FROM mercenary_contracts
                `);
                metrics.push(
                    { label:'Contratos novos', value:Number(contracts.novos || 0) },
                    { label:'Contratos aceitos', value:Number(contracts.aceitos || 0) },
                    { label:'Operações', value:moduleCounts.operations?.total || 0 },
                    { label:'Clientes', value:moduleCounts.clients?.total || 0 },
                    { label:'Inteligência', value:moduleCounts.intel?.total || 0 },
                    { label:'Dossiês', value:moduleCounts.archive?.total || 0 }
                );
                if (Number(contracts.novos || 0) > 0) alerts.push({ severity:'warning', factionId:f.id, faction:f.name, message:`${contracts.novos} contrato(s) novo(s) aguardando análise.` });
            } else if (f.code === 'bandits') {
                metrics.push(
                    { label:'Membros', value:users.count },
                    { label:'Negócios', value:moduleCounts.business?.total || 0 },
                    { label:'Territórios', value:moduleCounts.territory?.total || 0 },
                    { label:'Informações', value:moduleCounts.info?.total || 0 },
                    { label:'Registros', value:moduleCounts.records?.total || 0 },
                    { label:'Missões', value:missions.count }
                );
            } else if (f.code === 'ecologists') {
                const experiments = await dbGet(`SELECT COUNT(*) AS count FROM rp_experiments WHERE faction_id=?`, [f.id]);
                const risky = await dbGet(`SELECT COUNT(*) AS count FROM rp_experiments WHERE faction_id=? AND risk_level IN ('alto','critico') AND status NOT IN ('concluido','falhou')`, [f.id]);
                metrics.push(
                    { label:'Stalkers', value:stalkers.count },
                    { label:'Experimentos', value:experiments.count },
                    { label:'Comércio', value:moduleCounts.trade?.total || 0 },
                    { label:'Itens/Estoque', value:items.count },
                    { label:'Missões', value:missions.count },
                    { label:'Pesquisas críticas', value:risky.count }
                );
                if (Number(risky.count || 0) > 0) alerts.push({ severity:'danger', factionId:f.id, faction:f.name, message:`${risky.count} experimento(s) de risco alto/crítico em aberto.` });
            } else if (f.code === 'freedom') {
                metrics.push(
                    { label:'Membros', value:users.count },
                    { label:'Postos', value:moduleCounts.outposts?.total || 0 },
                    { label:'Suprimentos', value:moduleCounts.supplies?.total || 0 },
                    { label:'Intel', value:moduleCounts.intel?.total || 0 },
                    { label:'Comunicações', value:moduleCounts.comms?.total || 0 },
                    { label:'Missões', value:missions.count }
                );
            } else if (f.code === 'duty') {
                metrics.push(
                    { label:'Operadores', value:moduleCounts.operators?.total || users.count },
                    { label:'Arsenal', value:moduleCounts.arsenal?.total || 0 },
                    { label:'Inteligência', value:moduleCounts.intel?.total || 0 },
                    { label:'Logs', value:moduleCounts.logs?.total || 0 },
                    { label:'Itens', value:items.count },
                    { label:'Missões', value:missions.count }
                );
            }

            if (balance <= 0) alerts.push({ severity:'warning', factionId:f.id, faction:f.name, message:`Saldo atual em ${balance.toFixed(2)} RU.` });
            if (Number(activeUsers.count || 0) === 0) alerts.push({ severity:'danger', factionId:f.id, faction:f.name, message:'Nenhum usuário ativo nesta facção.' });
            if (!f.active) alerts.push({ severity:'danger', factionId:f.id, faction:f.name, message:'Facção desativada.' });

            const theme = (() => { try { return JSON.parse(f.theme_config || '{}'); } catch { return {}; } })();
            const activityScore = Math.min(100, Math.round(
                Math.min(Number(activity7d.count || 0) * 4, 40) +
                Math.min(Number(activeUsers.count || 0) * 8, 32) +
                Math.min(Number(missions.count || 0) * 4, 16) +
                (balance > 0 ? 12 : 0)
            ));

            factionCards.push({
                id:f.id, code:f.code, name:f.name, slug:f.slug, active:!!f.active,
                color:theme.accentColor || '#3498db',
                users:Number(users.count || 0), activeUsers:Number(activeUsers.count || 0),
                balance, missions:Number(missions.count || 0), stalkers:Number(stalkers.count || 0), items:Number(items.count || 0),
                activity7d:Number(activity7d.count || 0), activityScore,
                lastActivity:lastActivity || null,
                metrics
            });
        }

        const recentActivity = await dbAll(`
            SELECT a.id, a.action, a.entity, a.entity_id, a.created_at,
                   u.name AS user_name, u.username,
                   f.id AS faction_id, f.name AS faction_name, f.code AS faction_code
            FROM audit_log a
            LEFT JOIN users u ON u.id=a.user_id
            LEFT JOIN factions f ON f.id=a.faction_id
            ORDER BY a.created_at DESC, a.id DESC LIMIT 12
        `);

        res.json({
            overview:{
                activeFactions:Number(activeFactionsRow.count || 0),
                totalUsers:Number(totalUsersRow.count || 0),
                activeUsers:Number(activeUsersRow.count || 0),
                inactiveUsers:Number(inactiveUsersRow.count || 0),
                pendingContracts:Number(pendingContractsRow.count || 0),
                activeContracts:Number(activeContractsRow.count || 0),
                openMissions:Number(missionsOpenRow.count || 0),
                audits24h:Number(audits24hRow.count || 0),
                totalBalance:Number(bankGlobal.entradas || 0)-Number(bankGlobal.saidas || 0),
                totalEntradas:Number(bankGlobal.entradas || 0),
                totalSaidas:Number(bankGlobal.saidas || 0)
            },
            factions:factionCards,
            alerts:alerts.slice(0,12),
            recentActivity
        });
    } catch (e) { next(e); }
});

app.get('/api/audit', auth, requireCapability('audit:read'), async (req, res) => {
    const fId = getFactionScope(req);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);

    const where = fId ? 'WHERE a.faction_id = ?' : '';
    const params = fId ? [fId, limit] : [limit];

    const rows = await dbAll(`
        SELECT
            a.*,
            u.name AS user_name,
            u.username AS username,
            u.role AS user_role,
            f.name AS faction_name,
            CASE
                WHEN a.user_id IS NULL THEN 'system'
                WHEN u.id IS NULL THEN 'deleted_user'
                ELSE 'user'
            END AS actor_type
        FROM audit_log a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN factions f ON f.id = a.faction_id
        ${where}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
    `, params);

    res.json(rows);
});

// --- V1.7.1 OBLIVION CONTROL API (same Express server; no second port) ---
app.get('/api/oblivion/traders', auth, requireObcCapability('oblivion:read'), async (req,res,next)=>{try{res.json({traders:await obc.traders()})}catch(e){next(e)}});
app.get('/api/oblivion/traders/:id/items', auth, requireObcCapability('oblivion:read'), async (req,res,next)=>{try{res.json({items:await obc.items(req.params.id)})}catch(e){next(e)}});
app.get('/api/oblivion/traders/:id', auth, requireObcCapability('oblivion:read'), async (req,res,next)=>{try{res.json(await obc.trader(req.params.id))}catch(e){next(e)}});
app.post('/api/oblivion/drafts', auth, requireObcCapability('oblivion:manage'), async (req,res,next)=>{try{res.status(201).json(await obc.createDraft(String(req.body.traderId||'skad')))}catch(e){next(e)}});
app.patch('/api/oblivion/drafts/:draftId/items/:itemId', auth, requireObcCapability('oblivion:manage'), (req,res,next)=>{try{res.json(obc.updateDraft(req.params.draftId,req.params.itemId,req.body))}catch(e){next(e)}});
app.post('/api/oblivion/drafts/:draftId/validate', auth, requireObcCapability('oblivion:manage'), (req,res,next)=>{try{res.json(obc.validateDraft(req.params.draftId))}catch(e){next(e)}});
app.post('/api/oblivion/drafts/:draftId/publish', auth, requireObcCapability('oblivion:publish'), (req,res,next)=>{try{res.status(201).json(obc.publishDraft(req.params.draftId))}catch(e){next(e)}});
app.get('/api/oblivion/releases', auth, requireObcCapability('oblivion:read'), (req,res)=>res.json({releases:obc.listRecords()}));
app.get('/api/oblivion/releases/latest', obcBridgeAuth, (req,res)=>res.json(obc.latest()));
app.get('/api/oblivion/releases/:releaseId', auth, requireObcCapability('oblivion:read'), (req,res,next)=>{try{res.json(obc.getRecord(req.params.releaseId))}catch(e){next(e)}});
app.post('/api/oblivion/releases/:releaseId/rollback-request', auth, requireObcCapability('oblivion:publish'), (req,res,next)=>{try{res.status(202).json(obc.requestRollback(req.params.releaseId))}catch(e){next(e)}});
app.get('/api/oblivion/bridge/status', auth, requireObcCapability('oblivion:read'), (req,res)=>res.json(obc.status()));
app.get('/api/oblivion/bridge/releases/:releaseId/manifest', obcBridgeAuth, (req,res,next)=>{try{res.json(obc.manifest(req.params.releaseId))}catch(e){next(e)}});
app.get('/api/oblivion/bridge/releases/:releaseId/files/:fileKey', obcBridgeAuth, (req,res,next)=>{try{const file=obc.file(req.params.releaseId,req.params.fileKey);res.set('Content-Type','application/json; charset=utf-8');res.set('X-OBC-SHA256',file.entry.sha256);res.send(file.bytes)}catch(e){next(e)}});
app.get('/api/oblivion/bridge/rollback-requests', obcBridgeAuth, (req,res)=>res.json({requests:obc.pending()}));
app.post('/api/oblivion/bridge/heartbeat', obcBridgeAuth, (req,res,next)=>{try{res.json(obc.heartbeat(req.body||{}))}catch(e){next(e)}});

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    if (NODE_ENV === 'production') {
        res.status(500).json({ error: 'Internal Server Error' });
    } else {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

// ==========================================
// HEALTH + SERVER START
// ==========================================
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
    console.log(`Database: ${DB_PATH}`);
    console.log(`Uploads: ${UPLOAD_DIR}`);
});

function shutdown(signal) {
    console.log(`${signal} received. Shutting down...`);
    server.close(() => {
        db.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
