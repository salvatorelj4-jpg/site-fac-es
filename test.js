const sqlite3=require('sqlite3'); const db=new sqlite3.Database('database.db'); db.all('PRAGMA table_info(relatorios)', (err, rows) => console.log(rows));
