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

            // Preserve existing tables
            const existingTables = ['stalkers', 'historico', 'itens', 'missoes', 'relatorios', 'pesquisas', 'configuracoes'];
            for (const table of existingTables) {
                await dbRun(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT)`);
                try {
                    await dbRun(`ALTER TABLE ${table} ADD COLUMN faction_id INTEGER DEFAULT 2`);
                } catch (e) { /* Ignore if column exists */ }
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

        const parsed = schema.safeParse(req.body);
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

app.delete('/api/users/:id', auth, requireCapability('users:manage'), async (req, res, next) => {
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

app.delete('/api/membros/:id', auth, requireCapability('users:manage'), async (req, res, next) => {
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

app.delete('/api/stalkers/:id', auth, requireCapability('stalkers:manage'), async (req, res) => {
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
app.get('/api/contracts', auth, requireCapability('contracts:read'), async (req, res) => {
    const rows = await dbAll(`SELECT * FROM mercenary_contracts`);
    res.json(rows);
});
app.get('/api/contracts/:id', auth, requireCapability('contracts:read'), async (req, res) => {
    const row = await dbGet(`SELECT * FROM mercenary_contracts WHERE id = ?`, [req.params.id]);
    res.json(row);
});
app.put('/api/contracts/:id/status', auth, requireCapability('contracts:update'), async (req, res) => {
    await dbRun(`UPDATE mercenary_contracts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [req.body.status, req.params.id]);
    await auditLog({ userId: req.user.id, factionId: req.user.factionId, action: 'UPDATE_CONTRACT_STATUS', entityId: req.params.id, metadata: { status: req.body.status } });
    res.json({ success: true });
});
app.post('/api/contracts/:id/notes', auth, requireCapability('contracts:update'), async (req, res) => {
    await dbRun(`INSERT INTO contract_notes (contract_id, user_id, message) VALUES (?, ?, ?)`, [req.params.id, req.user.id, req.body.message]);
    res.json({ success: true });
});
app.get('/api/contracts/:id/notes', auth, requireCapability('contracts:read'), async (req, res) => {
    const notes = await dbAll(`SELECT n.*, u.name as userName FROM contract_notes n JOIN users u ON n.user_id = u.id WHERE contract_id = ? ORDER BY n.created_at ASC`, [req.params.id]);
    res.json(notes);
});

// --- ITEMS & INVENTORY ---
app.get('/api/itens', auth, requireCapability('items:read'), async (req, res) => {
    const fId = getFactionScope(req);
    const params = fId ? [fId] : [];
    res.json(await dbAll(`SELECT * FROM itens ${fId ? 'WHERE faction_id = ?' : ''}`, params));
});
app.post('/api/itens', auth, requireCapability('items:manage'), async (req, res) => {
    const fId = getFactionScope(req) || 2;
    await dbRun(`INSERT INTO itens (nome, tipo, quantidade, valor_base, faction_id) VALUES (?, ?, ?, ?, ?)`,
        [req.body.nome, req.body.tipo, req.body.quantidade, req.body.valor_base, fId]);
    res.json({ success: true });
});
app.put('/api/itens/:id', auth, requireCapability('items:manage'), upload.single('foto'), async (req, res, next) => {
    try {
        let sql = `UPDATE itens SET nome=?, tipo=?, quantidade=?, valor_base=? WHERE id=?`;
        let params = [req.body.nome, req.body.tipo, req.body.quantidade, req.body.valor_base, req.params.id];
        if (req.file) {
            sql = `UPDATE itens SET nome=?, tipo=?, quantidade=?, valor_base=?, foto=? WHERE id=?`;
            params = [req.body.nome, req.body.tipo, req.body.quantidade, req.body.valor_base, `/uploads/${req.file.filename}`, req.params.id];
        }
        await dbRun(sql, params);
        res.json({ success: true });
    } catch (e) { next(e); }
});
app.delete('/api/itens/:id', auth, requireCapability('items:manage'), async (req, res) => {
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
app.post('/api/missoes', auth, requireCapability('missions:manage'), async (req, res) => {
    const fId = getFactionScope(req) || 2;
    await dbRun(`INSERT INTO missoes (titulo, descricao, recompensa, status, faction_id) VALUES (?, ?, ?, ?, ?)`,
        [req.body.titulo, req.body.descricao, req.body.recompensa, 'pendente', fId]);
    res.json({ success: true });
});
app.put('/api/missoes/:id', auth, requireCapability('missions:manage'), async (req, res) => {
    await dbRun(`UPDATE missoes SET titulo=?, descricao=?, recompensa=?, status=? WHERE id=?`,
        [req.body.titulo, req.body.descricao, req.body.recompensa, req.body.status || 'pendente', req.params.id]);
    res.json({ success: true });
});
app.delete('/api/missoes/:id', auth, requireCapability('missions:manage'), async (req, res) => {
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
app.delete('/api/pesquisas/:id', auth, requireCapability('research:manage'), async (req, res) => {
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
app.delete('/api/relatorios/:id', auth, requireCapability('reports:manage'), async (req, res) => {
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

// --- ADMIN / DASHBOARD STATS ---
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
    
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ error: 'Valor deve ser maior que zero.' });
    }

    try {
        await dbRun(`
            INSERT INTO faction_bank_transactions (faction_id, user_id, type, amount, reason, transaction_date)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [fId, req.user.id, type, numAmount, reason, transaction_date]);
        
        await auditLog(db, {
            userId: req.user.id,
            factionId: fId,
            action: `bank_${type}`,
            entity: 'bank',
            metadata: JSON.stringify({ amount: numAmount, reason, date: transaction_date })
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

app.get('/api/audit', auth, requireCapability('audit:read'), async (req, res) => {
    const fId = getFactionScope(req);
    const rows = await dbAll(`SELECT * FROM audit_log ${fId ? 'WHERE faction_id = ?' : ''} ORDER BY created_at DESC LIMIT 100`, fId ? [fId] : []);
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