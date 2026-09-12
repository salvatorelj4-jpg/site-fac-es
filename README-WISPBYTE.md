# Clear Sky — pacote preparado para Wispbyte

Este pacote foi limpo para Linux/Wispbyte.

## O que foi removido
- `node_modules/` do Windows
- `ngrok.exe`
- `.env` com segredos locais

## O que foi mantido
- `database.db` atual
- `uploads/` atuais
- frontend em `public/`
- scripts e arquivos auxiliares

## Instalação no Wispbyte
1. Envie o conteúdo deste pacote para o servidor.
2. Use Node.js 20, 22 ou 24.
3. Instale as dependências no próprio servidor Linux:
   `npm ci --omit=dev`
4. Configure as variáveis do arquivo `.env.wispbyte.example` no painel do Wispbyte.
5. Startup command:
   `npm start`
6. O servidor escuta `0.0.0.0` e usa automaticamente `process.env.PORT`.
7. Teste `/health`; deve responder `{ "status": "ok" }`.

## Persistência
Por padrão o banco fica em `database.db` e os uploads em `uploads/` dentro da pasta do projeto.
Também é possível apontar um volume persistente usando `DATA_DIR`, `DB_PATH` e `UPLOAD_DIR`.

## Segurança
Antes de publicar:
- use `NODE_ENV=production`;
- defina um `JWT_SECRET` novo e longo;
- altere `ADMIN_PASSWORD`;
- configure `ALLOWED_ORIGINS` com o domínio público real;
- nunca envie o `.env` original para terceiros.
