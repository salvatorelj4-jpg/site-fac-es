const RP_MODULES = {
  operators: { title:'OPERADORES', singular:'Operador', category:'Especialidade', subject:'Codinome / Responsável', location:'Base / Setor',
    statuses:['disponível','em missão','ferido','inativo'] },
  arsenal: { title:'ARSENAL', singular:'Item do Arsenal', category:'Tipo', subject:'Responsável', location:'Depósito',
    statuses:['disponível','reservado','manutenção','baixado'] },
  intel: { title:'INTELIGÊNCIA', singular:'Informe', category:'Classificação', subject:'Alvo / Fonte', location:'Área',
    statuses:['novo','verificando','confirmado','arquivado'] },
  logs: { title:'LOGS OPERACIONAIS', singular:'Registro', category:'Tipo de ocorrência', subject:'Responsável', location:'Local',
    statuses:['aberto','revisado','encerrado'] },
  trade: { title:'COMÉRCIO CIENTÍFICO', singular:'Negociação', category:'Tipo de recurso', subject:'Contato', location:'Ponto de troca',
    statuses:['aberta','negociando','concluída','cancelada'] },
  business: { title:'NEGÓCIOS', singular:'Negócio', category:'Tipo de acordo', subject:'Contato / Devedor', location:'Local',
    statuses:['aberto','cobrando','pago','cancelado'] },
  territory: { title:'TERRITÓRIOS', singular:'Território', category:'Controle', subject:'Responsável / Rival', location:'Área',
    statuses:['controlado','disputado','ameaçado','perdido'] },
  info: { title:'INFORMAÇÕES', singular:'Informação', category:'Fonte', subject:'Alvo', location:'Área',
    statuses:['rumor','verificando','confirmado','descartado'] },
  records: { title:'REGISTROS', singular:'Registro', category:'Tipo', subject:'Envolvido', location:'Local',
    statuses:['aberto','pendente','resolvido','arquivado'] },
  outposts: { title:'POSTOS', singular:'Posto', category:'Tipo de posto', subject:'Comandante', location:'Localização',
    statuses:['operacional','alerta','isolado','evacuado'] },
  supplies: { title:'SUPRIMENTOS', singular:'Lote de suprimentos', category:'Categoria', subject:'Responsável', location:'Destino',
    statuses:['disponível','baixo','crítico','em trânsito'] },
  comms: { title:'COMUNICAÇÕES', singular:'Comunicado', category:'Canal / Prioridade', subject:'Origem / Destino', location:'Posto',
    statuses:['novo','transmitido','recebido','arquivado'] },
  clients: { title:'CLIENTES', singular:'Cliente', category:'Perfil', subject:'Contato', location:'Zona de atuação',
    statuses:['ativo','prioritário','restrito','bloqueado'] },
  operations: { title:'OPERAÇÕES', singular:'Operação', category:'Tipo de missão', subject:'Equipe / Alvo', location:'Área operacional',
    statuses:['planejada','ativa','suspensa','concluída','falhou'] },
  archive: { title:'ARQUIVO', singular:'Dossiê', category:'Classificação', subject:'Referência', location:'Origem',
    statuses:['ativo','selado','arquivado'] }
};

let currentEditId = null;

function moduleConfig() {
  return RP_MODULES[window.FACTION_MODULE] || {
    title: String(window.FACTION_MODULE || 'MÓDULO').toUpperCase(),
    singular: 'Registro', category:'Categoria', subject:'Assunto', location:'Local',
    statuses:['ativo','encerrado']
  };
}

function canEditModule() {
  const u = getUser();
  return u && ['super_admin','faction_admin','commander'].includes(u.role);
}

function fillModuleHeader() {
  const c = moduleConfig();
  document.getElementById('moduleTitle').textContent = c.title;
  document.getElementById('moduleSubtitle').textContent = `Registros RP da facção • ${c.singular}`;
  document.getElementById('labelCategory').textContent = c.category;
  document.getElementById('labelSubject').textContent = c.subject;
  document.getElementById('labelLocation').textContent = c.location;
  const status = document.getElementById('recordStatus');
  status.innerHTML = c.statuses.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  document.getElementById('newBtn').style.display = canEditModule() ? '' : 'none';
}

function openRecordForm(record = null) {
  if (!canEditModule()) return showError('Seu cargo possui acesso somente de leitura.');
  const c = moduleConfig();
  currentEditId = record?.id || null;
  document.getElementById('formTitle').textContent = currentEditId ? `EDITAR ${c.singular.toUpperCase()}` : `NOVO ${c.singular.toUpperCase()}`;
  document.getElementById('recordTitle').value = record?.title || '';
  document.getElementById('recordCategory').value = record?.category || '';
  document.getElementById('recordStatus').value = record?.status || c.statuses[0];
  document.getElementById('recordLocation').value = record?.location || '';
  document.getElementById('recordSubject').value = record?.subject || '';
  document.getElementById('recordDescription').value = record?.description || '';
  document.getElementById('recordExtra').value = record?.extra?.details || '';
  document.getElementById('recordForm').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeRecordForm() {
  currentEditId = null;
  document.getElementById('recordForm').classList.add('hidden');
}

async function saveFactionRecord() {
  try {
    const body = {
      title: document.getElementById('recordTitle').value.trim(),
      category: document.getElementById('recordCategory').value.trim(),
      status: document.getElementById('recordStatus').value,
      location: document.getElementById('recordLocation').value.trim(),
      subject: document.getElementById('recordSubject').value.trim(),
      description: document.getElementById('recordDescription').value.trim(),
      extra: { details: document.getElementById('recordExtra').value.trim() }
    };
    if (body.title.length < 2) return showError('Informe um título.');

    const endpoint = currentEditId
      ? `/api/faction-records/${window.FACTION_MODULE}/${currentEditId}`
      : `/api/faction-records/${window.FACTION_MODULE}`;
    await api(endpoint, { method: currentEditId ? 'PUT' : 'POST', body });
    showSuccess(currentEditId ? 'Registro atualizado.' : 'Registro criado.');
    closeRecordForm();
    await loadFactionRecords();
  } catch (e) { console.error(e); }
}

async function deleteFactionRecord(id) {
  if (!confirm('Excluir este registro permanentemente?')) return;
  try {
    await api(`/api/faction-records/${window.FACTION_MODULE}/${id}`, { method:'DELETE' });
    showSuccess('Registro excluído.');
    await loadFactionRecords();
  } catch (e) { console.error(e); }
}

async function loadFactionRecords() {
  const list = document.getElementById('recordList');
  try {
    const rows = await api(`/api/faction-records/${window.FACTION_MODULE}`) || [];
    if (!rows.length) {
      list.innerHTML = '<div class="card"><p class="text-muted">Nenhum registro cadastrado neste módulo.</p></div>';
      return;
    }
    list.innerHTML = rows.map(r => `
      <div class="card">
        <div class="d-flex justify-between gap-1 flex-wrap">
          <div style="flex:1; min-width:250px;">
            <h3 class="text-accent" style="margin:0 0 8px 0;">${escapeHtml(r.title)}</h3>
            <div class="text-muted">${escapeHtml(r.category || 'Sem categoria')} • ${escapeHtml(r.status || '')}</div>
            ${r.subject ? `<p><b>Referência:</b> ${escapeHtml(r.subject)}</p>` : ''}
            ${r.location ? `<p><b>Local:</b> ${escapeHtml(r.location)}</p>` : ''}
            ${r.description ? `<p>${escapeHtml(r.description)}</p>` : ''}
            ${r.extra?.details ? `<p class="text-muted">${escapeHtml(r.extra.details)}</p>` : ''}
            <small class="text-muted">Atualizado: ${formatDateTime(r.updated_at)}${r.created_by_name ? ` • por ${escapeHtml(r.created_by_name)}` : ''}</small>
          </div>
          ${canEditModule() ? `<div class="d-flex gap-1">
            <button class="btn-secondary w-auto" onclick='openRecordForm(${JSON.stringify(r).replace(/'/g,"&#39;")})'>Editar</button>
            <button class="btn-danger w-auto" onclick="deleteFactionRecord(${r.id})">Excluir</button>
          </div>` : ''}
        </div>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = `<div class="card"><p class="text-danger">${escapeHtml(e.message || 'Erro ao carregar módulo.')}</p></div>`;
  }
}

async function initFactionModule() {
  checkAuth();
  fillModuleHeader();
  await loadFactionRecords();
}
