(function(){
  const sections = [
    ['CONTROLE GLOBAL', [
      ['overview','⌂','Visão Geral','/admin.html'],
      ['oblivion','◈','Servidor & Oblivion','/admin-oblivion.html'],
      ['commerce','⇄','Comércio & Traders','/admin-commerce.html'],
      ['quests','◆','Quests','/admin-quests.html'],
      ['economy','₽','Economia & Banco','/admin-economy.html']
    ]],
    ['ADMINISTRAÇÃO', [
      ['operations','⌁','Operações','/admin-operations.html'],
      ['staff','♟','Staff & Permissões','/admin-staff.html'],
      ['audit','≡','Auditoria','/admin-audit.html'],
      ['system','⚙','Sistema','/admin-system.html']
    ]],
    ['RISCO', [
      ['reset','⚠','Reset / Recuperação','/admin.html#reset']
    ]]
  ];

  window.mountAdminRail = function(active){
    const rail=document.getElementById('adminRail');
    if(!rail)return;
    const nav=sections.map(([title,items])=>`<div class="admin-rail-section">${title}</div>${items.map(([key,icon,label,url])=>`<a class="admin-rail-link ${key===active?'active':''} ${key==='reset'?'danger':''}" href="${url}"><span>${icon}</span><span>${label}</span></a>`).join('')}`).join('');
    rail.innerHTML=`<div class="admin-rail-brand"><div class="eyebrow">OBLIVION / CONTROL</div><strong>Central Administrativa</strong><div class="admin-rail-status"><span id="adminRailDot" class="admin-dot"></span><span id="adminRailState">carregando estado</span></div></div><nav class="admin-rail-nav">${nav}</nav>`;
    window.refreshAdminRailState();
  };

  window.refreshAdminRailState = async function(){
    const dot=document.getElementById('adminRailDot');
    const label=document.getElementById('adminRailState');
    if(!dot||!label||typeof api!=='function')return;
    try{
      const d=await api('/api/admin/oblivion/overview');
      const connected=d?.integration?.bridgeStatus==='CONNECTED';
      const installed=d?.integration?.qonzerStatus==='MOD_LOADED';
      dot.className='admin-dot '+(connected&&installed?'ok':connected||installed?'warn':'');
      label.textContent=connected&&installed?'servidor integrado':'painel online / bridge aguardando conexão';
    }catch(_){dot.className='admin-dot danger';label.textContent='status indisponível';}
  };

  window.adminTraderDisplayName=function(trader){
    const id=String(trader?.trader_id||'').toLowerCase();
    if(id==='merc') return 'Trader Mercenário (Rublos)';
    if(id==='merc_barter') return 'Bazar Mercenário (Pregos)';
    return String(trader?.name||id||'Trader');
  };

  window.adminStateLabel=function(value){
    const raw=String(value??'N/A').toUpperCase();
    const labels={
      READY_STATIC_IDENTITY_AMBIGUOUS:'3 BAZARES • IDENTIDADE PENDENTE',
      OWNER_RISK_ACCEPTED_NOT_LIVE_TESTED:'RISCO ACEITO • NÃO TESTADO AO VIVO',
      VALIDATED_LOCAL:'VALIDADO LOCALMENTE',
      NOT_CONNECTED:'NÃO CONECTADO',
      NOT_INSTALLED:'MOD INSTALADO',
      NOT_PUBLISHED:'PUBLICADO',
      MOD_INSTALADO:'MOD INSTALADO',
      INSTALLED:'MOD INSTALADO',
      PUBLICADO:'PUBLICADO',
      PUBLISHED:'PUBLICADO',
      AGUARDANDO_CONEXAO:'AGUARDANDO CONEXÃO',
      NEVER_CONNECTED:'AGUARDANDO CONEXÃO',
      STALE:'SEM SINAL',
      UNKNOWN:'NÃO VERIFICADO',
      OFFLINE:'OFFLINE',
      MOD_LOADED:'MOD CARREGADO',
      MOD_NOT_INSTALLED:'MOD NÃO INSTALADO',
      READY_STATIC:'PRONTO ESTÁTICO',
      NOT_RUN:'NÃO EXECUTADO'
    };
    return labels[raw]||String(value??'N/A').replaceAll('_',' ');
  };

  window.adminStateBadge=function(value){
    const raw=String(value??'').toUpperCase();
    let cls='muted';
    if(['PASS','READY','CONNECTED','INSTALLED','MOD_INSTALADO','PUBLICADO','PUBLISHED','ONLINE','ACTIVE','APPROVED','EXPORTED','VALIDATED'].some(x=>raw.includes(x))) cls='ok';
    if(['PENDING','NOT_RUN','NOT_CONNECTED','AGUARDANDO_CONEXAO','NEVER_CONNECTED','STALE','UNKNOWN','NOT_INSTALLED','NOT_PUBLISHED','DRAFT','AMBIGUOUS','RISK_ACCEPTED','READY_STATIC'].some(x=>raw.includes(x))) cls='warn';
    if(['FAIL','ERROR','BLOCKED','REJECTED','OFFLINE','MOD_NOT_INSTALLED'].some(x=>raw.includes(x))) cls='danger';
    return `<span class="admin-badge ${cls}">${escapeHtml(adminStateLabel(value))}</span>`;
  };

  window.adminMoney=function(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2})+' RUB'};
})();
