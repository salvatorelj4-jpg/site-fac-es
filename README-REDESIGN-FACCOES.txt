ATUALIZAÇÃO — REDESIGN COMPLETO DAS FACÇÕES STALKER

ESCOPO
- Duty: redesenho completo e funções específicas de comando/militares.
- Ecologistas: bunker científico, catálogo, aquisições, depósito, laboratório RP, relatórios, arquivos, expedições e risco biológico.
- Bandidos: covil, caixa preto, gangue, negócios, territórios, informantes e livro negro.
- Freedom: base livre, fundo comum, companheiros, postos, incursões, suprimentos, reconhecimento e rádio.
- Mercenários: preservados.
- Painel Administrativo: preservado; apenas o menu/contexto agora aponta para as novas páginas específicas.

SUPER ADMIN
Ao escolher Duty/Ecologistas/Bandidos/Freedom no seletor do painel administrativo, o menu e as APIs usam o contexto da facção selecionada e abrem as novas páginas.

ARQUIVOS PRINCIPAIS A SUBSTITUIR
- server.js
- public/app.js

ARQUIVOS NOVOS
- public/special-factions.css
- public/special-factions.js
- todos os HTMLs duty-*, eco-*, bandit-* e freedom-* presentes neste pacote.

Depois de copiar, reinicie o Wispbyte.


V14 HOTFIX
- Corrige as facções Duty, Ecologistas, Bandidos e Freedom quando o banco antigo não possui o mesmo schema do redesign.
- Faz migração automática de colunas legadas em itens, missoes, relatorios e stalkers.
- Corrige o endpoint /api/faction-dashboard para não gerar Internal Server Error nos painéis especiais.
- Mantém Mercenários e Painel Administrativo como estavam.


V15
- Duty / Efetivo ganhou uma tela própria inspirada no cadastro de stalkers, porém adaptada à identidade da Duty.
- Inclui formulário militarizado, diplomacia por facção, upload de foto, busca, ordenação e edição/exclusão de agentes.

V16
- Ecologistas / Stalkers: cadastro completo de agentes de campo com foto, relações, busca, ordenação e edição.
- Bandidos / Gangue: cadastro de membros da gangue com função, território, contatos, rivais, foto e relações.
- Freedom / Companheiros: cadastro de companheiros com função, posto, contatos, ameaças, foto e relações.
- As três telas usam o contexto da facção selecionada no Super Admin e salvam no banco da própria facção.

V17 — REGRA GLOBAL DE EXCLUSÃO + FOTOS OPCIONAIS

SEGURANÇA
- Somente super_admin pode executar exclusões permanentes.
- Faction Admin, Commander, Operator e Viewer continuam podendo criar/editar conforme suas permissões, mas não excluir.
- Regra aplicada no backend a todas as rotas DELETE autenticadas.
- Banco/Caixa ganhou exclusão de lançamento somente para Super Admin, com auditoria.

FOTOS OPCIONAIS
- Registros RP genéricos aceitam foto/imagem opcional.
- Ordens/Missões/Incursões aceitam imagem opcional.
- Itens aceitam imagem opcional também no cadastro inicial.
- Experimentos RP Ecologistas aceitam imagem opcional.
- Cadastros de membros/stalkers continuam aceitando foto.
- Foto nunca é obrigatória.

V18 — CORREÇÃO DE DADOS ANTIGOS + ECOLOGISTAS

CORRIGIDO:
- Banco/Caixa mostra EXCLUIR para Super Admin em cada lançamento.
- Depósito Científico agora permite criar, editar e excluir itens.
- Itens podem receber foto opcional.
- Relatórios Científicos agora permitem criar, editar e excluir.
- Relatórios podem receber foto/evidência opcional.
- Laboratório de Anomalias agora possui formulário completo de experimentos RP.
- Experimentos: artefato/mutante, risco, status, hipótese, contexto RP, resultados, efeitos e foto opcional.
- Apenas Super Admin visualiza/executa exclusões permanentes.
- Exclusões de itens, missões e relatórios passam a gerar auditoria.
- Corrigido upload de imagem em faction_records via multipart/FormData.

PARA ZERAR OS DADOS ANTIGOS MOSTRADOS NAS TELAS:
1. Pare o servidor.
2. Faça backup (o script também cria um automaticamente).
3. Execute em /home/container:
   node reset-operational-data.js
4. Aguarde "RESET OPERACIONAL COMPLETO CONCLUÍDO."
5. Inicie o servidor.

O reset zera:
- banco/caixa
- itens/inventários
- missões
- relatórios
- pesquisas
- experimentos RP
- registros RP
- stalkers
- contratos
- auditoria/logs

Preserva:
- usuários
- Super Admin
- facções
- permissões
- configurações
