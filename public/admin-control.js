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
      const installed=d?.integration?.qonzerStatus==='INSTALLED';
      dot.className='admin-dot '+(connected&&installed?'ok':connected||installed?'warn':'');
      label.textContent=connected&&installed?'servidor integrado':'modo administrativo / staging';
    }catch(_){dot.className='admin-dot danger';label.textContent='status indisponível';}
  };

  window.adminStateBadge=function(value){
    const raw=String(value??'').toUpperCase();
    let cls='muted';
    if(['PASS','READY','READY_STATIC','CONNECTED','INSTALLED','ONLINE','ACTIVE','APPROVED','EXPORTED'].some(x=>raw.includes(x))) cls='ok';
    if(['PENDING','NOT_RUN','NOT_CONNECTED','NOT_INSTALLED','NOT_PUBLISHED','DRAFT','READY_STATIC'].some(x=>raw.includes(x))) cls='warn';
    if(['FAIL','ERROR','BLOCKED','REJECTED'].some(x=>raw.includes(x))) cls='danger';
    return `<span class="admin-badge ${cls}">${escapeHtml(String(value??'N/A'))}</span>`;
  };

  window.adminMoney=function(v){return Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:2})+' RUB'};
})();
