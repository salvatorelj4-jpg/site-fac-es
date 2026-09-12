const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

// Adiciona a fonte do PDA no topo
if (!css.includes("Share+Tech+Mono")) {
    css = "@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap');\n" + css;
}

// Troca a fonte principal para a do PDA
css = css.replace(
    /--font-main: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;/g, 
    "--font-main: 'Share Tech Mono', monospace; letter-spacing: 0.5px;"
);

// Ajusta o fundo para o grid escuro
css = css.replace(
    /body \{/g,
    "body {\n    background-image: linear-gradient(rgba(42, 46, 42, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(42, 46, 42, 0.1) 1px, transparent 1px);\n    background-size: 20px 20px;\n"
);

// Ajusta o container (card principal)
css = css.replace(
    /.card \{([\s\S]*?)\}/g,
    ".card {\n    background: #121314;\n    border: 1px solid var(--border);\n    border-radius: 2px;\n    padding: 20px;\n    box-shadow: inset 0 0 50px rgba(0,0,0,0.5);\n    margin-bottom: 20px;\n    position: relative;\n}"
);

// Ajusta os botões
css = css.replace(
    /button \{([\s\S]*?)\}/g,
    "button {\n    background: rgba(var(--accent-rgb), 0.1);\n    color: var(--accent);\n    border: 1px solid var(--accent);\n    padding: 10px 15px;\n    font-family: var(--font-main);\n    border-radius: 2px;\n    cursor: pointer;\n    text-transform: uppercase;\n    font-weight: bold;\n    letter-spacing: 1px;\n    transition: all 0.2s;\n}"
);

css = css.replace(
    /button:hover \{([\s\S]*?)\}/g,
    "button:hover {\n    background: var(--accent);\n    color: #0b111a;\n    box-shadow: 0 0 15px rgba(var(--accent-rgb), 0.4);\n}"
);

// Inputs text
css = css.replace(
    /input\[type="text"\], input\[type="password"\], input\[type="number"\], select, textarea \{([\s\S]*?)\}/g,
    "input[type=\"text\"], input[type=\"password\"], input[type=\"number\"], select, textarea {\n    width: 100%;\n    padding: 12px;\n    background: #0f1011;\n    border: 1px solid #333;\n    color: var(--accent);\n    border-radius: 2px;\n    font-family: var(--font-main);\n    box-sizing: border-box;\n}"
);

fs.writeFileSync('public/style.css', css);
console.log("CSS atualizado para o tema PDA.");
