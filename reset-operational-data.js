'use strict';
const fs=require('fs');
const path=require('path');
const sqlite3=require('sqlite3').verbose();

const DATA_DIR=process.env.DATA_DIR?path.resolve(process.env.DATA_DIR):__dirname;
const DB_PATH=process.env.DB_PATH?path.resolve(process.env.DB_PATH):path.join(DATA_DIR,'database.db');
const BACKUP_DIR=path.join(DATA_DIR,'backups');

if(!fs.existsSync(DB_PATH)){console.error(`Banco não encontrado: ${DB_PATH}`);process.exit(1)}
fs.mkdirSync(BACKUP_DIR,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backupPath=path.join(BACKUP_DIR,`database-before-full-reset-${stamp}.db`);
fs.copyFileSync(DB_PATH,backupPath);

const db=new sqlite3.Database(DB_PATH);
const run=(sql,p=[])=>new Promise((resolve,reject)=>db.run(sql,p,function(e){e?reject(e):resolve(this)}));
const all=(sql,p=[])=>new Promise((resolve,reject)=>db.all(sql,p,(e,r)=>e?reject(e):resolve(r)));

(async()=>{
 const tablesToClear=[
  'contract_notes','mercenary_contracts','commerce_transactions','faction_bank_transactions','faction_records',
  'rp_experiments','audit_log','historico','stalkers','itens','inventarios','missoes',
  'relatorios','pesquisas'
 ];
 const existing=await all(`SELECT name FROM sqlite_master WHERE type='table'`);
 const names=new Set(existing.map(x=>x.name));
 try{
  await run('PRAGMA foreign_keys=OFF');
  await run('BEGIN IMMEDIATE TRANSACTION');
  for(const t of tablesToClear){if(names.has(t))await run(`DELETE FROM ${t}`)}
  if(names.has('sqlite_sequence')){
   for(const t of tablesToClear)await run(`DELETE FROM sqlite_sequence WHERE name=?`,[t]);
  }
  await run('COMMIT');
  await run('PRAGMA foreign_keys=ON');
  console.log('');
  console.log('RESET OPERACIONAL COMPLETO CONCLUÍDO.');
  console.log(`Backup: ${backupPath}`);
  console.log('Saldo, itens, missões, relatórios, pesquisas, RP, contratos e logs foram zerados.');
  console.log('Usuários, facções, permissões e configurações foram preservados.');
 }catch(e){
  try{await run('ROLLBACK')}catch(_){}
  console.error('Falha no reset:',e);
  console.error(`Backup preservado em: ${backupPath}`);
  process.exitCode=1;
 }finally{db.close()}
})();