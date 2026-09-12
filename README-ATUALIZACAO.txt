ATUALIZAÇÃO CONSOLIDADA — BANDIDOS + MERCENÁRIOS

SUBSTITUIR:
- /home/container/server.js
- /home/container/public/app.js
- /home/container/public/banco.html
- /home/container/public/team.html
- /home/container/public/contratar.html
- /home/container/public/contratos.html
- /home/container/public/clients.html
- /home/container/public/operations.html
- /home/container/public/intel.html

ADICIONAR/SUBSTITUIR PARA BANDIDOS:
- /home/container/public/business.html
- /home/container/public/territory.html
- /home/container/public/info.html
- /home/container/public/records.html
- /home/container/public/faction-module.js

MERCENÁRIOS:
- Operadores removido do menu.
- Contratos mostra somente formulários públicos recebidos.
- Alteração de status de contrato restrita ao líder (Faction Admin) ou Super Admin.
- Formulário público só mostra erro depois de tentativa inválida.
- Clientes com visual de dossiê mercenário.
- Operações com contadores: planejamento, ativa, suspensa, concluída.
- Só quem criou uma operação pode editar/concluir.
- Só líder da facção ou Super Admin pode excluir operação.
- Inteligência com design mercenário.
- Equipe deixa de ser tela branca e respeita isolamento por facção.

BANDIDOS:
- Caixa corrigido para enviar JSON corretamente.
- Equipe funcional e isolada pela facção.
- Negócios, Territórios, Informações e Registros incluídos.
- Faction Admin continua limitado à própria facção.

Depois de copiar, reinicie o Wispbyte.

AJUSTE ADICIONAL — OPERAÇÕES MERCENÁRIAS
- Nova operação sempre nasce como PLANEJAMENTO.
- Status não é mais escolhido no formulário.
- No card da operação, o criador pode:
  ATIVAR
  SUSPENDER
  CONCLUIR
  EDITAR
- Apenas líder da facção/Super Admin continua podendo EXCLUIR.

AJUSTE DE FLUXO — CONTRATOS MERCENÁRIOS
- NOVO é apenas o estado inicial.
- Ao alterar um contrato, NOVO não aparece mais como opção.
- Não é possível voltar um contrato para NOVO.
- Ao marcar como CONCLUÍDO, o status fica definitivamente bloqueado.
- O backend também impede alteração de contrato já concluído.

AJUSTE — CAIXA/BANCO
- Datas anteriores ao dia atual ficam bloqueadas no calendário.
- A data atual é preenchida automaticamente.
- O backend também recusa transações com data passada.

ATUALIZAÇÕES NOVAS — MERCENÁRIOS
- Contratos:
  NOVO -> ACEITO / SUSPENSO / CONCLUÍDO / RECUSADO
  ACEITO -> SUSPENSO / CONCLUÍDO / RECUSADO
  SUSPENSO / CONCLUÍDO / RECUSADO são status finais e bloqueados.
- Clientes:
  upload de foto JPG/PNG/WEBP;
  foto aparece no dossiê;
  opção de remover foto.
- Arquivo:
  novo ARQUIVO CONFIDENCIAL;
  código automático ARQ-0001 etc.;
  classificações Público/Restrito/Confidencial/Sigiloso;
  contadores, filtros e busca;
  criador pode editar e arquivar;
  líder/Super Admin pode excluir.
- Caixa:
  datas anteriores ao dia atual permanecem bloqueadas.

AJUSTE — CAIXA/BANCO
- O sistema não permite registrar saída quando o saldo é insuficiente.
- O formulário já bloqueia a retirada acima do saldo atual.
- O backend também impede que o saldo fique negativo.

AJUSTE — INTELIGÊNCIA MERCENÁRIA
- Novo Centro de Inteligência Tática.
- Códigos automáticos INT-0001.
- Contadores: Novo, Em Análise, Confirmado, Arquivado.
- Filtros por classificação, status e prioridade.
- Classificação Público/Restrito/Confidencial/Sigiloso.
- Prioridade Baixa/Média/Alta/Crítica.
- Criador pode editar e alterar status.
- Líder/Super Admin pode excluir.
