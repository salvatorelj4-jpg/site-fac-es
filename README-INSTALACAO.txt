ATUALIZAÇÃO — MÓDULOS RP POR FACÇÃO

Substituir:
- /home/container/server.js
- /home/container/public/app.js

Adicionar dentro de /home/container/public/:
- faction-module.js
- operators.html
- arsenal.html
- intel.html
- logs.html
- trade.html
- research.html
- business.html
- territory.html
- info.html
- records.html
- outposts.html
- supplies.html
- comms.html
- clients.html
- operations.html
- archive.html

MÓDULOS
Duty: Operadores, Missões, Arsenal, Relatórios, Inteligência, Logs
Ecologistas: Stalkers, Comércio, Estoque, Pesquisa RP, Relatórios, Histórico, Missões, Lista Negra
Bandidos: Membros, Negócios, Territórios, Informações, Registros
Freedom: Membros, Postos, Missões, Suprimentos, Intel, Comunicações
Mercenários: Contratos, Operadores, Clientes, Operações, Inteligência, Arquivo

SEGURANÇA/ISOLAMENTO
- Cada registro genérico é gravado com faction_id.
- Uma facção não pode abrir CRUD de módulo pertencente a outra.
- Faction Admin e Commander podem criar/editar/excluir registros genéricos.
- Demais cargos ficam em leitura nesses módulos.
- Pesquisa RP é exclusiva dos Ecologistas e usa as permissões research:read/research:manage.
- Os experimentos são registros narrativos fictícios para RP.

Depois de copiar os arquivos, reinicie o Wispbyte.
