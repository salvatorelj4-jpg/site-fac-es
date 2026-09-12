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

// ==========================================
// ENVIRONMENT VALIDATION
// ==========================================
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_DEV';
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : __dirname;
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, 'database.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(DATA_DIR, 'uploads');
if (NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('CHANGE_ME'))) {
    throw new Error('FATAL ERROR: JWT_SECRET must be securely set in production.');
}

// ==========================================
// DB INITIALIZATION & PROMISES
// ==========================================
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
                super_admin: ['faction:manage', 'users:manage', 'contracts:read', 'contracts:create', 'contracts:update', 'contracts:assign', 'audit:read', 'operations:read', 'operations:manage', 'research:read', 'research:manage', 'members:read', 'members:manage', 'items:read', 'items:manage', 'missions:read', 'missions:manage', 'reports:read', 'reports:manage', 'stalkers:read', 'stalkers:manage', 'config:manage', 'modules:manage'],
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

function requireCapability(...capabilities) {
    return async (req, res, next) => {
        if (req.user.role === 'super_admin') return next();
        const perms = await dbAll(`SELECT capability FROM permissions WHERE role = ?`, [req.user.role]);
        const userCaps = perms.map(p => p.capability);
        const hasCap = capabilities.some(c => userCaps.includes(c));
        if (!hasCap) {
            await auditLog({ userId: req.user.id, factionId: req.user.factionId, action: 'DENIED', entity: 'capability', metadata: { required: capabilities } });
            return res.status(403).json({ error: 'Forbidden: Missing capability' });
        }
        next();
    };
}

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
        
        res.json({ token, user: { id: user.id, name: user.name, role: user.role, factionId: user.faction_id, factionCode: user.factionCode, factionSlug: user.factionSlug, factionTheme: JSON.parse(user.factionTheme || '{}') } });
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
            factionId: z.number().int().positive().nullable().optional()
        });

        const parsed = schema.safeParse(bodyData);
        if (!parsed.success) {
            return res.status(400).json({
                error: 'Dados do usuário inválidos.',
                details: parsed.error.issues.map(issue => issue.message)
            });
        }

        const { username, password, name, role, factionId = null } = parsed.data;

        // Only the global super admin can create another super admin.
        if (role === 'super_admin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Apenas o Super Admin pode criar outro Super Admin.' });
        }

        // Faction Admin is always locked to their own faction.
        // Any factionId sent manually by the browser is ignored for non-super-admin users.
        const targetFaction = role === 'super_admin'
            ? null
            : (req.user.role === 'super_admin' ? factionId : req.user.factionId);

        if (role !== 'super_admin' && !targetFaction) {
            return res.status(400).json({ error: 'Selecione uma facção para este usuário.' });
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
            metadata: { username, role }
        });

        res.status(201).json({ success: true, id: result.lastID });
    } catch (e) { next(e); }
});

app.put('/api/users/:id', auth, requireCapability('users:manage'), async (req, res, next) => {
    try {
        const { username, password, name, role, factionId, active } = req.body;
        const targetFaction = req.user.role === 'super_admin' ? factionId : req.user.factionId;
        let query = `UPDATE users SET username=?, name=?, role=?, faction_id=?, active=? WHERE id=?`;
        let params = [username, name, role, targetFaction, active, req.params.id];
        
        if (password) {
            query = `UPDATE users SET username=?, password_hash=?, name=?, role=?, faction_id=?, active=? WHERE id=?`;
            params = [username, await bcrypt.hash(password, 10), name, role, targetFaction, active, req.params.id];
        }
        
        if (req.user.role !== 'super_admin') {
            const t = await dbGet(`SELECT faction_id FROM users WHERE id=?`, [req.params.id]);
            if (t.faction_id !== req.user.factionId) return res.status(403).json({ error: 'Forbidden' });
        }
        
        await dbRun(query, params);
        res.json({ success: true });
    } catch (e) { next(e); }
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
    await dbRun(`DELETE FROM itens WHERE id=?`, [req.params.id]);
    res.json({ success: true });
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
    await dbRun(`DELETE FROM missoes WHERE id=?`, [req.params.id]);
    res.json({ success: true });
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
app.post('/api/relatorios', auth, requireCapability('reports:manage'), async (req, res, next) => {
    try {
        const fId = getFactionScope(req) || 2;
        await dbRun(`INSERT INTO relatorios (numero, autor, membros, objetivo, col1, col2, col3, faction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.body.numero, req.body.autor, req.body.membros, req.body.objetivo, req.body.col1, req.body.col2, req.body.col3, fId]);
        res.json({ success: true });
    } catch (e) { next(e); }
});
app.put('/api/relatorios/:id', auth, requireCapability('reports:manage'), async (req, res, next) => {
    try {
        await dbRun(`UPDATE relatorios SET numero=?, autor=?, membros=?, objetivo=?, col1=?, col2=?, col3=?, editado_por=? WHERE id=?`,
            [req.body.numero, req.body.autor, req.body.membros, req.body.objetivo, req.body.col1, req.body.col2, req.body.col3, req.user.name, req.params.id]);
        res.json({ success: true });
    } catch (e) { next(e); }
});
app.delete('/api/relatorios/:id', auth, requireSuperAdminDelete, requireCapability('reports:manage'), async (req, res) => {
    await dbRun(`DELETE FROM relatorios WHERE id=?`, [req.params.id]);
    res.json({ success: true });
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

        const parsed = schema.safeParse(req.body);
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

    // Data retroativa não é permitida.
    const today = new Date().toISOString().slice(0, 10);
    if (transaction_date < today) {
        return res.status(400).json({
            error: 'Não é permitido registrar transações com data anterior à data atual.'
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

// --- GLOBAL ERROR HANDLER ---
app.use((err, req, res, next) => {
    console.error(err.stack);
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