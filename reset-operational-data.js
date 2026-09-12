'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : __dirname;

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DATA_DIR, 'database.db');

const BACKUP_DIR = path.join(DATA_DIR, 'backups');

if (!fs.existsSync(DB_PATH)) {
  console.error(`Banco não encontrado: ${DB_PATH}`);
  process.exit(1);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(BACKUP_DIR, `database-before-operational-reset-${stamp}.db`);

fs.copyFileSync(DB_PATH, backupPath);

const db = new sqlite3.Database(DB_PATH);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

(async () => {
  const tablesToClear = [
    'contract_notes',
    'mercenary_contracts',
    'faction_bank_transactions',
    'faction_records',
    'rp_experiments',
    'audit_log',
    'historico',
    'stalkers',
    'itens',
    'missoes',
    'relatorios',
    'pesquisas'
  ];

  // These are intentionally preserved:
  // users, factions, permissions, faction_modules, configuracoes.
  const existing = await all(
    `SELECT name FROM sqlite_master WHERE type='table'`
  );
  const existingNames = new Set(existing.map(r => r.name));

  try {
    await run('PRAGMA foreign_keys = OFF');
    await run('BEGIN IMMEDIATE TRANSACTION');

    for (const table of tablesToClear) {
      if (existingNames.has(table)) {
        await run(`DELETE FROM ${table}`);
      }
    }

    // Reset AUTOINCREMENT counters for cleared operational tables.
    if (existingNames.has('sqlite_sequence')) {
      for (const table of tablesToClear) {
        await run(`DELETE FROM sqlite_sequence WHERE name = ?`, [table]);
      }
    }

    await run('COMMIT');
    await run('PRAGMA foreign_keys = ON');

    console.log('');
    console.log('RESET OPERACIONAL CONCLUÍDO.');
    console.log(`Backup criado em: ${backupPath}`);
    console.log('');
    console.log('Zerado:');
    console.log('- Logs de auditoria');
    console.log('- Caixa/Banco de todas as facções');
    console.log('- Contratos e notas');
    console.log('- Registros RP / operações / clientes / inteligência / arquivos');
    console.log('- Experimentos RP');
    console.log('- Stalkers');
    console.log('- Histórico');
    console.log('- Itens');
    console.log('- Missões');
    console.log('- Relatórios');
    console.log('- Pesquisas');
    console.log('');
    console.log('Preservado:');
    console.log('- Usuários e senhas');
    console.log('- Super Admin');
    console.log('- Facções');
    console.log('- Permissões');
    console.log('- Módulos habilitados');
    console.log('- Configurações');
  } catch (err) {
    try { await run('ROLLBACK'); } catch (_) {}
    console.error('Falha no reset operacional:', err);
    console.error(`Backup disponível em: ${backupPath}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
