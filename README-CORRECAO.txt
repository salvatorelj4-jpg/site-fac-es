CORREÇÃO WISPBYTE — USUÁRIOS + DEPENDÊNCIAS

CAUSA DO ERRO AO CRIAR USUÁRIO
O admin.html enviava body: JSON.stringify(body), mas o helper api() já serializa objetos.
Com isso o Content-Type application/json não era definido e req.body chegava vazio.
Por isso password ficava undefined e o bcrypt gerava:
Illegal arguments: undefined, number

CORREÇÕES
- public/admin.html envia body como objeto.
- toggle de usuário corrigido pelo mesmo motivo.
- server.js valida nome, usuário, senha, papel e facção.
- usuário duplicado retorna erro 409 amigável.
- package.json atualizado para versões mais novas:
  bcryptjs ^3.0.3
  express ^4.22.2
  jsonwebtoken ^9.0.3
  multer ^2.3.0
  sqlite3 ^6.0.1

ORDEM SEGURA NO WISPBYTE
1. Troque o runtime para Node.js 22.
2. Substitua server.js, public/admin.html e package.json.
3. Pare o servidor.
4. Apague a pasta node_modules.
5. Rode: npm install
6. Rode: npm audit
7. Inicie/reinicie o servidor.

IMPORTANTE
Não use npm audit fix --force sem revisar.
O package-lock.json não foi incluído; o npm vai atualizá-lo no Linux/Wispbyte.
