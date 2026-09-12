const fs = require('fs');
const path = require('path');

const dir = 'c:\\Users\\jaeds\\Pictures\\Clear Sky Site\\Clear Sky Site\\public';
const filesToUpdate = [
    'stalkers.html',
    'missoes.html',
    'itens.html',
    'estoque.html',
    'enciclopedia.html',
    'relatorios.html',
    'historico.html',
    'listanegra.html'
];

filesToUpdate.forEach(file => {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) {
        console.log(`File not found: ${file}`);
        return;
    }
    
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // 1. Add viewport meta
    if (!content.includes('<meta name="viewport"')) {
        content = content.replace(
            /<meta charset="UTF-8">/,
            '<meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">'
        );
    }
    
    // 2. Replace hardcoded nav with <nav id="mainNav"></nav>
    content = content.replace(/<nav>[\s\S]*?<\/nav>/, '<nav id="mainNav"></nav>');
    
    // 3. Add app.js before script.js
    if (!content.includes('<script src="app.js"></script>')) {
        content = content.replace(
            /<script src="script.js"><\/script>/,
            '<script src="app.js"></script>\n    <script src="script.js"></script>'
        );
    }
    
    // 4. Remove CLEAR SKY and SISTEMA CLEAR SKY (specifically titles in other elements if any)
    content = content.replace(/SISTEMA CLEAR SKY/g, 'SISTEMA');
    content = content.replace(/CLEAR SKY/gi, '');
    
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Updated ${file}`);
});
