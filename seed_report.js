const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('database.db');

const col1 = `
<h1>RELATÓRIO DE CAMPO - SETOR G-12 (O RADIAL)</h1>
<br>
<h2>DADOS GERAIS:</h2>
<ul>
    <li><b>IDENTIFICAÇÃO:</b> Artefato desconhecido (Codinome: "A Centelha") localizado nas ruínas do reator nº 3.</li>
    <li><b>CARACTERÍSTICAS:</b> Emite radiação anômala instável e luz intensa.</li>
    <li><b>COMPORTAMENTO:</b> Reage à proximidade de equipamentos eletrônicos e materiais orgânicos.</li>
    <li><b>RISCO:</b> Alta periculosidade. Exposição prolongada causa mutação celular severa.</li>
    <li><b>OBSERVAÇÕES:</b> Artefato recuperado pela equipe Alfa. Atualmente confinado no Bloco D.</li>
</ul>
<blockquote>
    <b>⚠️ ADVERTÊNCIA: ACESSO RESTRITO - CLASSIFICADO</b><br>
    STATUS ATUAL: ARMAZENADO (QUARENTENA)<br>
    PRÓXIMOS PASSOS: ANÁLISE DE LABORATÓRIO E MONITORAMENTO CONTÍNUO.
</blockquote>
`;

db.run(
    'INSERT INTO relatorios (numero, autor, objetivo, col1, faction_id) VALUES (?, ?, ?, ?, ?)',
    ['ARQUIVO DE EXPEDIÇÃO', 'S. Ryazansky', 'PESQUISA DE ANOMALIA - OPERAÇÃO "CHUMBO"', col1, 2],
    function(err) {
        if (err) console.error(err);
        else console.log('Relatorio de teste inserido com ID:', this.lastID);
    }
);
