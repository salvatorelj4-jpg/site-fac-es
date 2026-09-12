
const SF = {
  duty:{name:'Duty',code:'DUTY // COMMAND',tag:'Ordem, disciplina e contenção da Zona',currency:'Fundo Operacional'},
  ecologists:{name:'Ecologistas',code:'SSP-99 // BUNKER',tag:'Pesquisa científica, artefatos e anomalias',currency:'Orçamento Científico'},
  bandits:{name:'Bandidos',code:'BLACK MARKET // CELL',tag:'Território, influência e negócios da Zona',currency:'Caixa Preto'},
  freedom:{name:'Freedom',code:'FREE ZONE // RADIO',tag:'Autonomia, postos livres e resistência',currency:'Fundo Comum'}
};
function sfUser(){return getUser()}
function sfFaction(){return window.SF_PAGE?.faction||getEffectiveFactionSlug()}
function sfCfg(){return SF[sfFaction()]||SF.duty}
function sfInit(){const u=checkAuth();if(!u)return;const f=sfFaction();if(u.role!=='super_admin'&&u.factionSlug!==f){location.href='/unauthorized.html';return}document.body.classList.add('sf-body',`theme-${f}`);}
function sfMoney(n){return Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})+' RU'}
function sfCanWrite(){const u=sfUser();return u&&['super_admin','faction_admin','commander'].includes(u.role)}
function sfLeader(){const u=sfUser();return u&&(u.role==='super_admin'||u.role==='faction_admin')}
function sfCanDelete(){const u=sfUser();return !!u&&u.role==='super_admin'}
function sfEsc(v){return escapeHtml(String(v??''))}
function sfDate(v){return v?formatDateTime(v):'-'}
async function sfDashboard(){sfInit();const d=await api('/api/faction-dashboard');const c=window.SF_PAGE.dashboard;document.getElementById('sfTitle').textContent=c.title;document.getElementById('sfSub').textContent=c.sub;document.getElementById('sfCode').setAttribute('data-code',sfCfg().code);const vals=c.stats(d);document.getElementById('sfStats').innerHTML=vals.map(x=>`<div class="sf-stat"><b>${sfEsc(x[1])}</b><span>${sfEsc(x[0])}</span></div>`).join('');const mods={};(d.records||[]).forEach(r=>{mods[r.module_code]=(mods[r.module_code]||0)+Number(r.qty||0)});document.getElementById('sfOps').innerHTML=c.panels(d,mods);document.getElementById('sfRecent').innerHTML=(d.latest||[]).map(a=>`<div class="sf-event"><b>${sfEsc(a.action)}</b><div class="sf-meta">${sfEsc(a.user_name||'Sistema')} • ${sfDate(a.created_at)}</div></div>`).join('')||'<div class="sf-empty">Sem atividade recente.</div>'}
async function sfBank(){sfInit();const page=window.SF_PAGE;document.getElementById('bankTitle').textContent=page.title;document.getElementById('bankSub').textContent=page.sub;const inp=document.getElementById('bDate');const today=new Date().toISOString().slice(0,10);inp.min=today;inp.value=today;await sfLoadBank()}
async function sfLoadBank(){const d=await api('/api/bank');window._sfBalance=Number(d.balance||0);document.getElementById('bBalance').textContent=sfMoney(d.balance);document.getElementById('bIn').textContent=sfMoney(d.total_entradas);document.getElementById('bOut').textContent=sfMoney(d.total_saidas);document.getElementById('bList').innerHTML=(d.transactions||[]).map(t=>`<div class="sf-card"><div class="sf-tag">${t.type==='entrada'?'ENTRADA':'SAÍDA'}</div><h3>${sfEsc(t.reason)}</h3><div class="sf-meta">${sfDate(t.transaction_date)} • ${sfEsc(t.user_name||t.username||'Sistema')}</div><b style="color:${t.type==='entrada'?'#32d583':'#ef5350'}">${t.type==='entrada'?'+':'-'}${sfMoney(t.amount)}</b>${sfCanDelete()?`<div class="sf-actions"><button class="btn-danger w-auto" onclick="sfDeleteBankTransaction(${t.id})">EXCLUIR LANÇAMENTO</button></div>`:''}</div>`).join('')||'<div class="sf-empty">Nenhuma movimentação.</div>'}
async function sfDeleteBankTransaction(id){
 if(!sfCanDelete())return showError('Somente o Super Admin pode excluir lançamentos bancários.');
 if(!confirm('Excluir permanentemente este lançamento do banco?'))return;
 await api(`/api/bank/${id}`,{method:'DELETE'});
 showSuccess('Lançamento excluído e registrado na auditoria.');
 await sfLoadBank();
}
async function sfSaveBank(){const type=bType.value,amount=Number(bAmount.value),reason=bReason.value.trim(),date=bDate.value;if(!type||!amount||!reason||!date)return showError('Preencha os campos.');if(type==='saida'&&amount>window._sfBalance)return showError('Saldo insuficiente.');const today=new Date().toISOString().slice(0,10);if(date<today)return showError('Data passada não é permitida.');await api('/api/bank',{method:'POST',body:{type,amount,reason,transaction_date:date}});showSuccess('Movimentação registrada.');bAmount.value='';bReason.value='';await sfLoadBank()}

const RECORDS = {
 duty:{
  operators:{title:'QUADRO DE EFETIVO',sub:'Militares, funções e prontidão operacional',singular:'MILITAR',fields:[['rank','Patente'],['specialty','Especialidade'],['post','Posto / Setor'],['readiness','Prontidão']],statuses:['PRONTO','EM OPERAÇÃO','FERIDO','LICENÇA']},
  arsenal:{title:'ARSENAL CENTRAL',sub:'Armamento, munição e material sob custódia',singular:'ITEM',fields:[['weaponClass','Classe / Calibre'],['quantity','Quantidade'],['condition','Condição'],['custodian','Responsável']],statuses:['OPERACIONAL','RESERVA','MANUTENÇÃO','BAIXADO']},
  intel:{title:'SALA DE INTELIGÊNCIA',sub:'Ameaças, facções hostis e setores críticos',singular:'INFORME',fields:[['threat','Nível de ameaça'],['target','Alvo / Facção'],['confidence','Confiabilidade'],['priority','Prioridade']],statuses:['RECEBIDO','EM ANÁLISE','CONFIRMADO','ARQUIVADO']},
  logs:{title:'DISCIPLINA & OCORRÊNCIAS',sub:'Infrações, incidentes e decisões de comando',singular:'OCORRÊNCIA',fields:[['severity','Gravidade'],['involved','Envolvido'],['measure','Medida tomada'],['officer','Oficial responsável']],statuses:['ABERTA','EM APURAÇÃO','RESOLVIDA','ARQUIVADA']}
 },
 ecologists:{trade:{title:'AQUISIÇÕES CIENTÍFICAS',sub:'Compra de artefatos, amostras e equipamentos de campo',singular:'AQUISIÇÃO',fields:[['resource','Recurso / Artefato'],['value','Valor acordado'],['quality','Qualidade / Estado'],['contact','Fornecedor / Stalker']],statuses:['PROPOSTA','NEGOCIANDO','RECEBIDA','CANCELADA']}},
 bandits:{
  business:{title:'MESA DE NEGÓCIOS',sub:'Cobranças, acordos, vendas e dívidas da gangue',singular:'NEGÓCIO',fields:[['dealType','Tipo de negócio'],['value','Valor / Dívida'],['contact','Contato / Devedor'],['cut','Parte da gangue']],statuses:['ABERTO','COBRANDO','PAGO','CANCELADO']},
  territory:{title:'MAPA DE TERRITÓRIOS',sub:'Controle, disputa e pressão sobre áreas da Zona',singular:'TERRITÓRIO',fields:[['control','Nível de controle'],['rival','Rival / Ameaça'],['income','Renda estimada'],['strength','Homens no setor']],statuses:['CONTROLADO','DISPUTADO','AMEAÇADO','PERDIDO']},
  info:{title:'REDE DE INFORMANTES',sub:'Rumores, alvos e informações compradas ou roubadas',singular:'INFORMAÇÃO',fields:[['source','Fonte'],['target','Alvo'],['price','Preço da informação'],['confidence','Confiabilidade']],statuses:['RUMOR','VERIFICANDO','CONFIRMADO','QUEIMADO']},
  records:{title:'LIVRO NEGRO',sub:'Dívidas, punições, favores e ocorrências internas',singular:'REGISTRO',fields:[['recordType','Tipo'],['person','Envolvido'],['debt','Dívida / Valor'],['sentence','Punição / Acordo']],statuses:['ABERTO','PENDENTE','QUITADO','ARQUIVADO']}
 },
 freedom:{
  outposts:{title:'REDE DE POSTOS LIVRES',sub:'Bases, fogueiras, guardas e rotas seguras',singular:'POSTO',fields:[['commander','Responsável'],['capacity','Capacidade'],['ammo','Munição %'],['medical','Medicamentos %']],statuses:['OPERACIONAL','ALERTA','ISOLADO','EVACUADO']},
  supplies:{title:'CADEIA DE SUPRIMENTOS',sub:'Comida, munição, remédios e material compartilhado',singular:'LOTE',fields:[['supplyType','Categoria'],['quantity','Quantidade'],['destination','Destino'],['runner','Responsável pelo transporte']],statuses:['DISPONÍVEL','BAIXO','CRÍTICO','EM TRÂNSITO']},
  intel:{title:'RECONHECIMENTO LIVRE',sub:'Patrulhas, ameaças e movimentação na Zona',singular:'INFORME',fields:[['source','Batedor / Fonte'],['threat','Ameaça'],['route','Rota / Área'],['confidence','Confiabilidade']],statuses:['NOVO','VERIFICANDO','CONFIRMADO','ARQUIVADO']},
  comms:{title:'RÁDIO LIVRE',sub:'Chamados entre postos, avisos e transmissões abertas',singular:'TRANSMISSÃO',fields:[['channel','Canal'],['priority','Prioridade'],['from','Origem'],['to','Destino']],statuses:['NO AR','TRANSMITIDA','RECEBIDA','ARQUIVADA']}
 }
};
let sfEditId=null,sfRows=[];
function sfRecordConfig(){return RECORDS[sfFaction()][window.SF_PAGE.module]}
async function sfRecords(){sfInit();const c=sfRecordConfig();moduleTitle.textContent=c.title;moduleSub.textContent=c.sub;newBtn.textContent=`+ NOVO ${c.singular}`;if(!sfCanWrite())newBtn.style.display='none';buildRecordForm();await sfLoadRecords()}
function buildRecordForm(r=null){const c=sfRecordConfig();formFields.innerHTML=`<div class="full"><label>TÍTULO / IDENTIFICAÇÃO</label><input id="rTitle"></div><div><label>STATUS</label><select id="rStatus">${c.statuses.map(s=>`<option>${s}</option>`).join('')}</select></div><div><label>LOCAL / SETOR</label><input id="rLocation"></div>${c.fields.map(([k,l])=>`<div><label>${l.toUpperCase()}</label><input data-extra="${k}"></div>`).join('')}<div class="full"><label>DESCRIÇÃO / CONTEXTO</label><textarea id="rDescription" rows="5"></textarea></div><div class="full"><label>FOTO / IMAGEM (OPCIONAL)</label><input id="rPhoto" type="file" accept="image/*">${r?.extra?.photo?`<div style="margin-top:8px"><img src="${sfEsc(r.extra.photo)}" style="max-width:180px;max-height:140px;object-fit:cover;border:1px solid var(--line)"></div>`:''}</div>`;if(r){rTitle.value=r.title||'';rStatus.value=r.status||c.statuses[0];rLocation.value=r.location||'';rDescription.value=r.description||'';document.querySelectorAll('[data-extra]').forEach(i=>i.value=r.extra?.[i.dataset.extra]||'')}}
function sfOpenRecord(r=null){sfEditId=r?.id||null;buildRecordForm(r);recordForm.classList.remove('hidden');formHeading.textContent=sfEditId?`EDITAR ${sfRecordConfig().singular}`:`NOVO ${sfRecordConfig().singular}`;scrollTo({top:0,behavior:'smooth'})}
function sfCloseRecord(){sfEditId=null;recordForm.classList.add('hidden')}
async function sfSaveRecord(){
 const extra={};document.querySelectorAll('[data-extra]').forEach(i=>extra[i.dataset.extra]=i.value.trim());
 const title=rTitle.value.trim();if(title.length<2)return showError('Informe a identificação.');
 const fd=new FormData();
 fd.append('title',title);fd.append('category',sfRecordConfig().singular);fd.append('status',rStatus.value);
 fd.append('location',rLocation.value.trim());fd.append('subject',Object.values(extra)[0]||'');
 fd.append('description',rDescription.value.trim());fd.append('extra',JSON.stringify(extra));
 if(rPhoto?.files?.[0])fd.append('foto',rPhoto.files[0]);
 await apiForm(sfEditId?`/api/faction-records/${window.SF_PAGE.module}/${sfEditId}`:`/api/faction-records/${window.SF_PAGE.module}`,fd,sfEditId?'PUT':'POST');
 showSuccess('Registro salvo.');sfCloseRecord();sfLoadRecords();
}
async function sfDeleteRecord(id){if(!sfCanDelete())return showError('Somente o Super Admin pode excluir registros.');if(!confirm('Excluir permanentemente este registro?'))return;await api(`/api/faction-records/${window.SF_PAGE.module}/${id}`,{method:'DELETE'});showSuccess('Registro excluído.');sfLoadRecords()}
async function sfLoadRecords(){sfRows=await api(`/api/faction-records/${window.SF_PAGE.module}`)||[];sfRenderRecords()}
function sfRenderRecords(){const c=sfRecordConfig(),q=(recordSearch?.value||'').toLowerCase(),status=recordFilter?.value||'';const rows=sfRows.filter(r=>(!q||JSON.stringify(r).toLowerCase().includes(q))&&(!status||r.status===status));recordFilter.innerHTML='<option value="">TODOS STATUS</option>'+c.statuses.map(s=>`<option ${status===s?'selected':''}>${s}</option>`).join('');recordList.innerHTML=rows.map(r=>`<div class="sf-card"><span class="sf-tag">${sfEsc(r.status)}</span><h3>${sfEsc(r.title)}</h3><div class="sf-meta">${sfEsc(r.location||'SEM LOCAL')} • ${sfEsc(r.created_by_name||'Sistema')}</div>${c.fields.map(([k,l])=>r.extra?.[k]?`<p><b>${l}:</b> ${sfEsc(r.extra[k])}</p>`:'').join('')}${r.extra?.photo?`<img src="${sfEsc(r.extra.photo)}" style="width:100%;max-height:210px;object-fit:cover;border:1px solid var(--line);margin:8px 0">`:''}${r.description?`<p>${sfEsc(r.description)}</p>`:''}${sfCanWrite()?`<div class="sf-actions"><button class="btn-secondary w-auto" onclick='sfOpenRecord(${JSON.stringify(r).replace(/'/g,"&#39;")})'>EDITAR</button>${sfCanDelete()?`<button class="btn-danger w-auto" onclick="sfDeleteRecord(${r.id})">EXCLUIR</button>`:''}</div>`:''}</div>`).join('')||'<div class="sf-empty">Nenhum registro encontrado.</div>'}

async function sfMissions(){sfInit();const p=window.SF_PAGE;missionTitle.textContent=p.title;missionSub.textContent=p.sub;await sfLoadMissions()}
async function sfLoadMissions(){const rows=await api('/api/missoes')||[];window._missions=rows;missionList.innerHTML=rows.map(m=>`<div class="sf-card"><span class="sf-tag">${sfEsc(m.status||'pendente')}</span><h3>${sfEsc(m.titulo)}</h3><p>${sfEsc(m.descricao||'')}</p><div class="sf-meta">Recompensa: ${sfEsc(m.recompensa||0)} RU</div>${m.foto?`<img src="${sfEsc(m.foto)}" style="width:100%;max-height:220px;object-fit:cover;border:1px solid var(--line);margin:8px 0">`:''}${sfCanWrite()?`<div class="sf-actions"><button class="btn-success w-auto" onclick="sfMissionStatus(${m.id},'em andamento')">INICIAR</button><button class="btn-secondary w-auto" onclick="sfMissionStatus(${m.id},'concluida')">CONCLUIR</button>${sfCanDelete()?`<button class="btn-danger w-auto" onclick="sfDeleteMission(${m.id})">EXCLUIR</button>`:''}</div>`:''}</div>`).join('')||'<div class="sf-empty">Nenhuma operação cadastrada.</div>'}
async function sfCreateMission(){
 if(!mTitle.value.trim())return showError('Informe o título.');
 const fd=new FormData();fd.append('titulo',mTitle.value.trim());fd.append('descricao',mDesc.value.trim());fd.append('recompensa',Number(mReward.value||0));
 if(typeof mPhoto!=='undefined'&&mPhoto?.files?.[0])fd.append('foto',mPhoto.files[0]);
 await apiForm('/api/missoes',fd,'POST');
 showSuccess('Operação registrada.');missionForm.classList.add('hidden');sfLoadMissions();
}
async function sfMissionStatus(id,status){const m=window._missions.find(x=>x.id===id);await api(`/api/missoes/${id}`,{method:'PUT',body:{titulo:m.titulo,descricao:m.descricao,recompensa:m.recompensa,status}});sfLoadMissions()}
async function sfDeleteMission(id){if(!sfCanDelete())return showError('Somente o Super Admin pode excluir missões.');if(!confirm('Excluir esta operação?'))return;await api(`/api/missoes/${id}`,{method:'DELETE'});sfLoadMissions()}

async function sfTeam(){sfInit();const f=sfCfg();teamTitle.textContent=window.SF_PAGE.title;teamSub.textContent=window.SF_PAGE.sub;if(!sfLeader())newUserBtn.style.display='none';await sfLoadTeam()}
async function sfLoadTeam(){const rows=await api('/api/users')||[];teamList.innerHTML=rows.map(u=>`<div class="sf-card"><h3>${sfEsc(u.name)} <small>@${sfEsc(u.username)}</small></h3><span class="sf-tag">${sfEsc(u.role)}</span><span class="sf-tag">${u.active?'ATIVO':'INATIVO'}</span><div class="sf-meta">Último acesso: ${sfDate(u.last_login_at)}</div></div>`).join('')||'<div class="sf-empty">Nenhum membro.</div>'}
async function sfCreateUser(){const body={name:uName.value.trim(),username:uLogin.value.trim(),password:uPass.value,role:uRole.value,factionId:sfUser().factionId};if(body.name.length<2||body.username.length<3||body.password.length<6)return showError('Confira nome, login e senha.');await api('/api/users',{method:'POST',body});showSuccess('Membro adicionado.');userForm.classList.add('hidden');sfLoadTeam()}


let dutyStalkerRows=[];
function sfDutySerializeRelations(){const obj={};document.querySelectorAll('.duty-rel').forEach(el=>obj[el.dataset.fac]=el.value);return JSON.stringify(obj)}
function sfDutyApplyRelations(raw){let data={};try{data=raw?JSON.parse(raw):{}}catch(e){}document.querySelectorAll('.duty-rel').forEach(el=>{if(data[el.dataset.fac]) el.value=data[el.dataset.fac]})}
function sfDutyResetForm(){dutyEditId.value='';dutyStalkerForm.reset();sfDutyApplyRelations('{}');document.getElementById('dutyCancelBtn').style.display='none';document.querySelector('.duty-form-title').textContent='NOVO REGISTRO DE STALKER';}
async function sfDutyOperators(){sfInit();if(!sfCanWrite()) document.querySelector('.duty-form-panel').style.display='none';sfDutyResetForm();await sfDutyLoadStalkers()}
async function sfDutyLoadStalkers(){dutyStalkerRows=await api('/api/stalkers')||[];const total=dutyStalkerRows.length;document.getElementById('dutyStatTotal').textContent=total;document.getElementById('dutyStatVeteran').textContent=dutyStalkerRows.filter(s=>Number(s.reputacao||0)>=100).length;document.getElementById('dutyStatBlack').textContent=dutyStalkerRows.filter(s=>Number(s.status_lista_negra||0)===1).length;document.getElementById('dutyStatRecent').textContent=total?('#'+dutyStalkerRows.slice().sort((a,b)=>Number(b.id)-Number(a.id))[0].id):'-';sfDutyRenderStalkers()}
function sfDutyRenderStalkers(){const q=(dutySearch.value||'').toLowerCase().trim();const order=dutyOrder.value;let rows=dutyStalkerRows.filter(s=>!q||[s.nome,s.codinome,s.faccao,s.area_atuacao].join(' ').toLowerCase().includes(q));rows=rows.slice().sort((a,b)=>{switch(order){case 'id_asc': return Number(a.id)-Number(b.id);case 'rep_desc': return Number(b.reputacao||0)-Number(a.reputacao||0);case 'rep_asc': return Number(a.reputacao||0)-Number(b.reputacao||0);case 'alpha_asc': return String(a.codinome||'').localeCompare(String(b.codinome||''),'pt-BR');case 'alpha_desc': return String(b.codinome||'').localeCompare(String(a.codinome||''),'pt-BR');default:return Number(b.id)-Number(a.id)}});dutyStalkerList.innerHTML=rows.map(s=>{let rel={};try{rel=s.relacoes_faccoes?JSON.parse(s.relacoes_faccoes):{}}catch(e){}const relBadges=Object.entries(rel).slice(0,6).map(([k,v])=>`<span class="duty-rel-badge">${sfEsc(k)}: ${sfEsc(v)}</span>`).join('');return `<article class="duty-agent-card"><div>${s.foto?`<img class="duty-agent-photo" src="${sfEsc(s.foto)}" alt="Foto de ${sfEsc(s.codinome||s.nome)}">`:`<div class="duty-agent-photo placeholder">SEM FOTO<br>DE AGENTE</div>`}${Number(s.status_lista_negra||0)===1?`<div class="sf-tag" style="margin-top:8px;color:#ff8c8c;border-color:#6d2c2c">RESTRIÇÃO INTERNA</div>`:''}</div><div><div class="duty-agent-header"><div><h3>${sfEsc(s.codinome||'SEM CODINOME')}</h3><div class="duty-agent-sub">${sfEsc(s.nome||'Sem nome')} • ${sfEsc(s.faccao||'Duty')}</div></div><span class="sf-tag">REP ${Number(s.reputacao||0)}</span></div><div class="duty-agent-meta"><p><b>Área:</b> ${sfEsc(s.area_atuacao||'-')}</p><p><b>ID:</b> #${s.id}</p><p><b>Aliados:</b> ${sfEsc(s.aliados||'-')}</p><p><b>Inimigos:</b> ${sfEsc(s.inimigos||'-')}</p></div>${relBadges?`<div class="duty-rel-badges">${relBadges}</div>`:''}${s.rumores?`<p class="duty-agent-notes"><b>Notas:</b> ${sfEsc(s.rumores)}</p>`:''}${sfCanWrite()?`<div class="duty-agent-actions"><button class="btn-secondary" onclick='sfDutyEditStalker(${JSON.stringify(s).replace(/'/g,"&#39;")})'>EDITAR</button>${sfCanDelete()?`<button class="btn-danger" onclick="sfDutyDeleteStalker(${s.id})">EXCLUIR</button>`:''}</div>`:''}</div></article>`}).join('')||'<div class="sf-empty">Nenhum agente registrado no efetivo.</div>'}
function sfDutyEditStalker(s){dutyEditId.value=s.id||'';dutyNome.value=s.nome||'';dutyCodinome.value=s.codinome||'';dutyFaccao.value=s.faccao||'';dutyArea.value=s.area_atuacao||'';dutyAliados.value=s.aliados||'';dutyInimigos.value=s.inimigos||'';dutyRumores.value=s.rumores||'';sfDutyApplyRelations(s.relacoes_faccoes||'{}');document.getElementById('dutyCancelBtn').style.display='inline-flex';document.querySelector('.duty-form-title').textContent='EDITAR REGISTRO DE STALKER';window.scrollTo({top:0,behavior:'smooth'})}
async function sfDutySaveStalker(){const fd=new FormData();fd.append('nome', dutyNome.value.trim());fd.append('codinome', dutyCodinome.value.trim());fd.append('faccao', dutyFaccao.value.trim()||'Duty');fd.append('area_atuacao', dutyArea.value.trim());fd.append('aliados', dutyAliados.value.trim());fd.append('inimigos', dutyInimigos.value.trim());fd.append('relacoes_faccoes', sfDutySerializeRelations());fd.append('rumores', dutyRumores.value.trim());if(dutyFoto.files[0]) fd.append('foto', dutyFoto.files[0]);const editId=dutyEditId.value;await apiForm(editId?`/api/stalkers/${editId}`:'/api/stalkers', fd, editId?'PUT':'POST');showSuccess(editId?'Registro atualizado.':'Agente registrado no efetivo.');sfDutyResetForm();await sfDutyLoadStalkers()}
async function sfDutyDeleteStalker(id){if(!sfCanDelete())return showError('Somente o Super Admin pode excluir registros.');if(!confirm('Excluir este agente do efetivo da Duty?')) return;await api(`/api/stalkers/${id}`,{method:'DELETE'});showSuccess('Registro excluído do efetivo.');await sfDutyLoadStalkers()}

async function sfEcoStalkers(){sfInit();const rows=await api('/api/stalkers')||[];stalkerList.innerHTML=rows.map(s=>`<div class="sf-card">${s.foto?`<img src="${sfEsc(s.foto)}" style="width:90px;height:110px;object-fit:cover;float:right;border:1px solid var(--line)">`:''}<span class="sf-tag">REP ${Number(s.reputacao||0)}</span><h3>${sfEsc(s.codinome||s.nome)}</h3><p><b>Nome:</b> ${sfEsc(s.nome)}</p><p><b>Facção:</b> ${sfEsc(s.faccao||'-')}</p><p><b>Área:</b> ${sfEsc(s.area_atuacao||'-')}</p><div class="sf-meta">Rumores: ${sfEsc(s.rumores||'Nenhum')}</div></div>`).join('')||'<div class="sf-empty">Nenhum stalker catalogado.</div>'}
let ecoItems=[], ecoItemEdit=null;
async function sfEcoInventory(){
 sfInit();
 if(!sfCanWrite())invNewBtn.style.display='none';
 await sfEcoLoadInventory();
}
async function sfEcoLoadInventory(){
 ecoItems=await api('/api/itens')||[];
 invCount.textContent=ecoItems.reduce((a,x)=>a+Number(x.quantidade||1),0);
 invTypes.textContent=new Set(ecoItems.map(x=>x.tipo||x.categoria||'Item')).size;
 sfEcoRenderInventory();
}
function sfEcoRenderInventory(){
 const q=(invSearch?.value||'').toLowerCase();
 const rows=ecoItems.filter(i=>!q||[i.nome,i.tipo,i.categoria].join(' ').toLowerCase().includes(q));
 invList.innerHTML=rows.map(i=>`<div class="sf-card">
 ${i.foto?`<img src="${sfEsc(i.foto)}" style="width:100%;height:160px;object-fit:cover;border:1px solid var(--line);margin-bottom:10px">`:''}
 <span class="sf-tag">${sfEsc(i.tipo||i.categoria||'ITEM')}</span>
 <h3>${sfEsc(i.nome)}</h3>
 <p><b>Quantidade:</b> ${Number(i.quantidade||1)}</p>
 <p><b>Valor-base:</b> ${sfMoney(i.valor_base??i.preco_base??0)}</p>
 ${sfCanWrite()?`<div class="sf-actions">
 <button class="btn-secondary w-auto" onclick='sfEcoOpenItem(${JSON.stringify(i).replace(/'/g,"&#39;")})'>EDITAR</button>
 ${sfCanDelete()?`<button class="btn-danger w-auto" onclick="sfEcoDeleteItem(${i.id})">EXCLUIR</button>`:''}
 </div>`:''}</div>`).join('')||'<div class="sf-empty">Depósito vazio.</div>';
}
function sfEcoOpenItem(i=null){
 ecoItemEdit=i?.id||null;
 invFormTitle.textContent=ecoItemEdit?'EDITAR ITEM':'NOVO ITEM';
 iName.value=i?.nome||'';iType.value=i?.tipo||i?.categoria||'';iQty.value=i?.quantidade||1;iValue.value=i?.valor_base??i?.preco_base??0;
 iPhoto.value='';iCurrentPhoto.innerHTML=i?.foto?`<img src="${sfEsc(i.foto)}" style="max-width:180px;max-height:130px;object-fit:cover;border:1px solid var(--line)">`:'';
 invForm.classList.remove('hidden');
}
function sfEcoCloseItem(){ecoItemEdit=null;invForm.classList.add('hidden')}
async function sfEcoSaveItem(){
 if(!iName.value.trim())return showError('Informe o nome do item.');
 const fd=new FormData();fd.append('nome',iName.value.trim());fd.append('tipo',iType.value.trim()||'Item');fd.append('quantidade',Number(iQty.value||1));fd.append('valor_base',Number(iValue.value||0));
 if(iPhoto.files[0])fd.append('foto',iPhoto.files[0]);
 await apiForm(ecoItemEdit?`/api/itens/${ecoItemEdit}`:'/api/itens',fd,ecoItemEdit?'PUT':'POST');
 showSuccess(ecoItemEdit?'Item atualizado.':'Item cadastrado.');sfEcoCloseItem();sfEcoLoadInventory();
}
async function sfEcoDeleteItem(id){
 if(!sfCanDelete())return showError('Somente o Super Admin pode excluir itens.');
 if(!confirm('Excluir permanentemente este item?'))return;
 await api(`/api/itens/${id}`,{method:'DELETE'});showSuccess('Item excluído.');sfEcoLoadInventory();
}
let ecoResearchRows=[], ecoResearchEdit=null;
async function sfEcoResearch(){
 sfInit();
 if(!sfCanWrite())researchNewBtn.style.display='none';
 await sfEcoLoadResearch();
}
async function sfEcoLoadResearch(){
 ecoResearchRows=await api('/api/rp-experiments')||[];
 rPlan.textContent=ecoResearchRows.filter(x=>x.status==='planejado').length;
 rRun.textContent=ecoResearchRows.filter(x=>x.status==='em_andamento').length;
 rDone.textContent=ecoResearchRows.filter(x=>x.status==='concluido').length;
 rHigh.textContent=ecoResearchRows.filter(x=>['alto','critico'].includes(x.risk_level)).length;
 researchList.innerHTML=ecoResearchRows.map(e=>`<div class="sf-card">
 ${e.foto?`<img src="${sfEsc(e.foto)}" style="width:100%;height:180px;object-fit:cover;border:1px solid var(--line);margin-bottom:10px">`:''}
 <span class="sf-tag">${sfEsc(e.experiment_type)}</span><span class="sf-tag">RISCO ${sfEsc(e.risk_level)}</span><span class="sf-tag">${sfEsc(e.status)}</span>
 <h3>${sfEsc(e.title)}</h3>
 <p><b>Amostra:</b> ${sfEsc(e.subject)}</p>
 ${e.hypothesis?`<p><b>Hipótese:</b> ${sfEsc(e.hypothesis)}</p>`:''}
 ${e.rp_effects?`<p><b>Efeito RP:</b> ${sfEsc(e.rp_effects)}</p>`:''}
 <div class="sf-meta">Responsável: ${sfEsc(e.created_by_name||'Sistema')} • ${sfDate(e.updated_at)}</div>
 ${sfCanWrite()?`<div class="sf-actions"><button class="btn-secondary w-auto" onclick='sfEcoOpenResearch(${JSON.stringify(e).replace(/'/g,"&#39;")})'>EDITAR</button>${sfCanDelete()?`<button class="btn-danger w-auto" onclick="sfEcoDeleteResearch(${e.id})">EXCLUIR</button>`:''}</div>`:''}
 </div>`).join('')||'<div class="sf-empty">Nenhum experimento cadastrado.</div>';
}
function sfEcoOpenResearch(e=null){
 ecoResearchEdit=e?.id||null;researchFormTitle.textContent=ecoResearchEdit?'EDITAR EXPERIMENTO':'NOVO EXPERIMENTO';
 xTitle.value=e?.title||'';xType.value=e?.experiment_type||'artefato';xSubject.value=e?.subject||'';xRisk.value=e?.risk_level||'baixo';xStatus.value=e?.status||'planejado';
 xHypothesis.value=e?.hypothesis||'';xProcedure.value=e?.procedure_summary||'';xExpected.value=e?.expected_result||'';xObserved.value=e?.observed_result||'';xEffects.value=e?.rp_effects||'';xNotes.value=e?.notes||'';
 xPhoto.value='';xCurrentPhoto.innerHTML=e?.foto?`<img src="${sfEsc(e.foto)}" style="max-width:200px;max-height:150px;object-fit:cover;border:1px solid var(--line);margin-top:8px">`:'';
 researchForm.classList.remove('hidden');
}
function sfEcoCloseResearch(){ecoResearchEdit=null;researchForm.classList.add('hidden')}
async function sfEcoSaveResearch(){
 if(xTitle.value.trim().length<3||xSubject.value.trim().length<2)return showError('Informe título e amostra.');
 const fd=new FormData();
 fd.append('title',xTitle.value.trim());fd.append('experimentType',xType.value);fd.append('subject',xSubject.value.trim());fd.append('hypothesis',xHypothesis.value.trim());fd.append('riskLevel',xRisk.value);fd.append('status',xStatus.value);
 fd.append('procedureSummary',xProcedure.value.trim());fd.append('expectedResult',xExpected.value.trim());fd.append('observedResult',xObserved.value.trim());fd.append('rpEffects',xEffects.value.trim());fd.append('notes',xNotes.value.trim());
 if(xPhoto.files[0])fd.append('foto',xPhoto.files[0]);
 await apiForm(ecoResearchEdit?`/api/rp-experiments/${ecoResearchEdit}`:'/api/rp-experiments',fd,ecoResearchEdit?'PUT':'POST');
 showSuccess(ecoResearchEdit?'Experimento atualizado.':'Experimento cadastrado.');sfEcoCloseResearch();sfEcoLoadResearch();
}
async function sfEcoDeleteResearch(id){
 if(!sfCanDelete())return showError('Somente o Super Admin pode excluir experimentos.');
 if(!confirm('Excluir permanentemente este experimento?'))return;
 await api(`/api/rp-experiments/${id}`,{method:'DELETE'});showSuccess('Experimento excluído.');sfEcoLoadResearch();
}
let ecoReports=[], ecoReportEdit=null;
async function sfEcoReports(){
 sfInit();
 if(!sfCanWrite())reportNewBtn.style.display='none';
 await sfEcoLoadReports();
}
async function sfEcoLoadReports(){
 ecoReports=await api('/api/relatorios')||[];
 reportList.innerHTML=ecoReports.map(r=>`<div class="sf-card">
 ${r.foto?`<img src="${sfEsc(r.foto)}" style="width:100%;height:180px;object-fit:cover;border:1px solid var(--line);margin-bottom:10px">`:''}
 <span class="sf-tag">${sfEsc(r.numero||('REL-'+r.id))}</span>
 <h3>${sfEsc(r.objetivo||'Relatório científico')}</h3>
 <p><b>Autor:</b> ${sfEsc(r.autor||'-')}</p><p><b>Equipe:</b> ${sfEsc(r.membros||'-')}</p>
 ${r.col1?`<p>${sfEsc(r.col1)}</p>`:''}
 ${r.col2?`<p><b>Resultados:</b> ${sfEsc(r.col2)}</p>`:''}
 ${r.col3?`<p><b>Conclusão:</b> ${sfEsc(r.col3)}</p>`:''}
 ${sfCanWrite()?`<div class="sf-actions"><button class="btn-secondary w-auto" onclick='sfEcoOpenReport(${JSON.stringify(r).replace(/'/g,"&#39;")})'>EDITAR</button>${sfCanDelete()?`<button class="btn-danger w-auto" onclick="sfEcoDeleteReport(${r.id})">EXCLUIR</button>`:''}</div>`:''}
 </div>`).join('')||'<div class="sf-empty">Nenhum relatório científico.</div>';
}
function sfEcoOpenReport(r=null){
 ecoReportEdit=r?.id||null;reportFormTitle.textContent=ecoReportEdit?'EDITAR RELATÓRIO':'NOVO RELATÓRIO';
 pNumber.value=r?.numero||'';pAuthor.value=r?.autor||'';pMembers.value=r?.membros||'';pObjective.value=r?.objetivo||'';pCol1.value=r?.col1||'';pCol2.value=r?.col2||'';pCol3.value=r?.col3||'';
 pPhoto.value='';pCurrentPhoto.innerHTML=r?.foto?`<img src="${sfEsc(r.foto)}" style="max-width:200px;max-height:150px;object-fit:cover;border:1px solid var(--line);margin-top:8px">`:'';
 reportForm.classList.remove('hidden');
}
function sfEcoCloseReport(){ecoReportEdit=null;reportForm.classList.add('hidden')}
async function sfEcoSaveReport(){
 if(!pObjective.value.trim())return showError('Informe o título/objetivo do relatório.');
 const fd=new FormData();fd.append('numero',pNumber.value.trim());fd.append('autor',pAuthor.value.trim());fd.append('membros',pMembers.value.trim());fd.append('objetivo',pObjective.value.trim());fd.append('col1',pCol1.value.trim());fd.append('col2',pCol2.value.trim());fd.append('col3',pCol3.value.trim());
 if(pPhoto.files[0])fd.append('foto',pPhoto.files[0]);
 await apiForm(ecoReportEdit?`/api/relatorios/${ecoReportEdit}`:'/api/relatorios',fd,ecoReportEdit?'PUT':'POST');
 showSuccess(ecoReportEdit?'Relatório atualizado.':'Relatório criado.');sfEcoCloseReport();sfEcoLoadReports();
}
async function sfEcoDeleteReport(id){
 if(!sfCanDelete())return showError('Somente o Super Admin pode excluir relatórios.');
 if(!confirm('Excluir permanentemente este relatório?'))return;
 await api(`/api/relatorios/${id}`,{method:'DELETE'});showSuccess('Relatório excluído.');sfEcoLoadReports();
}
async function sfEcoHistory(){sfInit();const stalkers=await api('/api/stalkers')||[];historyList.innerHTML=stalkers.map(s=>`<div class="sf-card"><h3>${sfEsc(s.codinome||s.nome)}</h3><div class="sf-meta">Último check-in: ${sfDate(s.ultimo_checkin)} • Presenças: ${Number(s.presencas||0)}</div><p>Reputação científica: <b>${Number(s.reputacao||0)}</b></p></div>`).join('')||'<div class="sf-empty">Sem histórico de campo.</div>'}
async function sfEcoBlacklist(){sfInit();const rows=(await api('/api/stalkers')||[]).filter(s=>Number(s.status_lista_negra)===1);blackList.innerHTML=rows.map(s=>`<div class="sf-card" style="border-color:#7f1d1d"><span class="sf-tag" style="color:#f87171">RISCO BIOLÓGICO / SEGURANÇA</span><h3>${sfEsc(s.codinome||s.nome)}</h3><p>${sfEsc(s.motivo_lista_negra||'Sem justificativa')}</p><div class="sf-meta">Área: ${sfEsc(s.area_atuacao||'-')}</div></div>`).join('')||'<div class="sf-empty">Nenhum indivíduo em restrição.</div>'}


let sfRosterRows=[];

function sfRosterRelationsJson(){
  const obj={};
  document.querySelectorAll('.roster-rel').forEach(el=>obj[el.dataset.fac]=el.value);
  return JSON.stringify(obj);
}

function sfRosterApplyRelations(raw){
  let obj={};
  try{ obj=raw?JSON.parse(raw):{} }catch(e){}
  document.querySelectorAll('.roster-rel').forEach(el=>{
    if(obj[el.dataset.fac]) el.value=obj[el.dataset.fac];
  });
}

function sfRosterReset(){
  rosterEditId.value='';
  rosterForm.reset();
  sfRosterApplyRelations('{}');
  rosterCancel.style.display='none';
  document.querySelector('.roster-form-title').textContent='NOVO REGISTRO';
}

async function sfFactionRoster(){
  sfInit();
  if(!sfCanWrite()) document.querySelector('.roster-form-panel').style.display='none';
  sfRosterReset();
  await sfRosterLoad();
}

async function sfRosterLoad(){
  sfRosterRows=await api('/api/stalkers')||[];
  const total=sfRosterRows.length;
  rosterTotal.textContent=total;
  rosterStat2.textContent=sfRosterRows.filter(x=>Number(x.reputacao||0)>=100).length;
  rosterStat3.textContent=sfRosterRows.filter(x=>Number(x.status_lista_negra||0)===1).length;
  rosterRecent.textContent=total?('#'+sfRosterRows.slice().sort((a,b)=>Number(b.id)-Number(a.id))[0].id):'-';
  sfRosterRender();
}

function sfRosterRender(){
  const q=(rosterSearch.value||'').toLowerCase().trim();
  const order=rosterOrder.value;

  let rows=sfRosterRows.filter(s=>{
    const hay=[s.nome,s.codinome,s.faccao,s.area_atuacao,s.aliados,s.inimigos].join(' ').toLowerCase();
    return !q || hay.includes(q);
  });

  rows=rows.slice().sort((a,b)=>{
    switch(order){
      case 'id_asc': return Number(a.id)-Number(b.id);
      case 'rep_desc': return Number(b.reputacao||0)-Number(a.reputacao||0);
      case 'rep_asc': return Number(a.reputacao||0)-Number(b.reputacao||0);
      case 'alpha_asc': return String(a.codinome||'').localeCompare(String(b.codinome||''),'pt-BR');
      case 'alpha_desc': return String(b.codinome||'').localeCompare(String(a.codinome||''),'pt-BR');
      default: return Number(b.id)-Number(a.id);
    }
  });

  const faction=sfFaction();

  rosterList.innerHTML=rows.map(s=>{
    let rel={};
    try{rel=s.relacoes_faccoes?JSON.parse(s.relacoes_faccoes):{}}catch(e){}
    const badges=Object.entries(rel).slice(0,6)
      .map(([k,v])=>`<span class="roster-rel-badge">${sfEsc(k)}: ${sfEsc(v)}</span>`).join('');

    const flag = Number(s.status_lista_negra||0)===1
      ? `<span class="sf-tag roster-alert">ALERTA / RESTRIÇÃO</span>` : '';

    return `<article class="roster-card roster-card-${faction}">
      <div>
        ${s.foto
          ? `<img class="roster-photo" src="${sfEsc(s.foto)}" alt="Foto">`
          : `<div class="roster-photo placeholder">SEM FOTO</div>`}
        ${flag}
      </div>
      <div>
        <div class="roster-card-head">
          <div>
            <h3>${sfEsc(s.codinome||'SEM CODINOME')}</h3>
            <div class="roster-sub">${sfEsc(s.nome||'Sem nome')} • ${sfEsc(s.faccao||sfCfg().name)}</div>
          </div>
          <span class="sf-tag">REP ${Number(s.reputacao||0)}</span>
        </div>

        <div class="roster-meta">
          <p><b>Área:</b> ${sfEsc(s.area_atuacao||'-')}</p>
          <p><b>ID:</b> #${s.id}</p>
          <p><b>Aliados:</b> ${sfEsc(s.aliados||'-')}</p>
          <p><b>Inimigos:</b> ${sfEsc(s.inimigos||'-')}</p>
        </div>

        ${badges?`<div class="roster-rel-badges">${badges}</div>`:''}
        ${s.rumores?`<p class="roster-notes"><b>Notas:</b> ${sfEsc(s.rumores)}</p>`:''}

        ${sfCanWrite()?`<div class="roster-actions">
          <button class="btn-secondary w-auto" onclick='sfRosterEdit(${JSON.stringify(s).replace(/'/g,"&#39;")})'>EDITAR</button>
          ${sfCanDelete()?`<button class="btn-danger w-auto" onclick="sfRosterDelete(${s.id})">EXCLUIR</button>`:''}
        </div>`:''}
      </div>
    </article>`;
  }).join('') || '<div class="sf-empty">Nenhum registro encontrado.</div>';
}

function sfRosterEdit(s){
  rosterEditId.value=s.id||'';
  rosterName.value=s.nome||'';
  rosterCode.value=s.codinome||'';
  rosterRole.value=s.faccao||'';
  rosterArea.value=s.area_atuacao||'';
  rosterAllies.value=s.aliados||'';
  rosterEnemies.value=s.inimigos||'';
  rosterNotes.value=s.rumores||'';
  sfRosterApplyRelations(s.relacoes_faccoes||'{}');
  rosterCancel.style.display='inline-flex';
  document.querySelector('.roster-form-title').textContent='EDITAR REGISTRO';
  window.scrollTo({top:0,behavior:'smooth'});
}

async function sfRosterSave(){
  const fd=new FormData();
  fd.append('nome',rosterName.value.trim());
  fd.append('codinome',rosterCode.value.trim());
  fd.append('faccao',rosterRole.value.trim()||sfCfg().name);
  fd.append('area_atuacao',rosterArea.value.trim());
  fd.append('aliados',rosterAllies.value.trim());
  fd.append('inimigos',rosterEnemies.value.trim());
  fd.append('relacoes_faccoes',sfRosterRelationsJson());
  fd.append('rumores',rosterNotes.value.trim());
  if(rosterPhoto.files[0]) fd.append('foto',rosterPhoto.files[0]);

  const id=rosterEditId.value;
  await apiForm(id?`/api/stalkers/${id}`:'/api/stalkers',fd,id?'PUT':'POST');
  showSuccess(id?'Registro atualizado.':'Registro criado.');
  sfRosterReset();
  await sfRosterLoad();
}

async function sfRosterDelete(id){
  if(!sfCanDelete()) return showError('Somente o Super Admin pode excluir registros.');
  if(!confirm('Excluir este registro permanentemente?')) return;
  await api(`/api/stalkers/${id}`,{method:'DELETE'});
  showSuccess('Registro excluído.');
  await sfRosterLoad();
}
