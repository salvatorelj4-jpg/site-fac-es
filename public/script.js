// ==========================================
// 1. TELA DE BOOT (INICIALIZAÇÃO DO SISTEMA)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem('stalker_token') && !sessionStorage.getItem('boot_sequence_played')) {
        if(window.location.pathname.includes('login.html')) return;
        const loader = document.createElement('div');
        loader.id = 'nuclear-loader';
        loader.innerHTML = `<div class="simbolo-nuclear">☢</div><div class="texto-loader">SISTEMA CLEAR SKY V.3.0</div><div class="log-loader" id="loaderLog">Estabelecendo conexão com os Pantanos...</div>`;
        document.body.appendChild(loader);
        let beepInic = setInterval(() => playBeep(500, 'square', 0.05, 0.02), 400);
        setTimeout(() => { document.getElementById('loaderLog').innerText = "Descriptografando Dossiês Confidenciais..."; }, 1200);
        setTimeout(() => { document.getElementById('loaderLog').innerText = "Calibrando Sensores de Radiação..."; }, 2400);
        setTimeout(() => {
            clearInterval(beepInic); playBeep(900, 'square', 0.3, 0.05); 
            document.getElementById('loaderLog').innerText = "ACESSO CONCEDIDO.";
            document.getElementById('loaderLog').style.color = "#2ecc71";
            document.getElementById('loaderLog').style.textShadow = "0 0 10px #2ecc71";
            document.getElementById('loaderLog').style.fontWeight = "bold";
            setTimeout(() => { loader.style.opacity = '0'; setTimeout(() => { loader.remove(); sessionStorage.setItem('boot_sequence_played', 'true'); }, 1000); }, 800);
        }, 3600);
    }
});

// ==========================================
// 2. EFEITOS SONOROS DE TERMINAL
// ==========================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep(freq, type, duration, vol) { 
    if (audioCtx.state === 'suspended') audioCtx.resume(); 
    const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain(); 
    osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime); 
    gain.gain.setValueAtTime(vol, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration); 
    osc.connect(gain); gain.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + duration); 
}
document.addEventListener('click', (e) => { 
    if(e.target.tagName === 'BUTTON' || e.target.classList.contains('foto-clicavel') || e.target.tagName === 'SELECT') { playBeep(600, 'square', 0.1, 0.05); } 
    else if(e.target.tagName === 'A' && e.target.href) { 
        if (e.target.hasAttribute('onclick')) { playBeep(600, 'square', 0.1, 0.05); return; } 
        e.preventDefault(); playBeep(600, 'square', 0.1, 0.05); setTimeout(() => { window.location.href = e.target.href; }, 150); 
    } 
});
document.addEventListener('keydown', (e) => { if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') playBeep(300, 'triangle', 0.05, 0.03); });


function nomeNivelItem(nivel) { if(nivel == 1) return "Desconhecido/Baixo"; if(nivel == 2) return "Médio"; return "Alto/Total"; }

window.taxasComercio = [];
async function carregarTaxas() {
    try { const res = await fetch('/api/config/taxas', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); if(res.ok) window.taxasComercio = await res.json(); } catch(e) {}
    if(!window.taxasComercio || window.taxasComercio.length === 0 || !Array.isArray(window.taxasComercio)) {
        window.taxasComercio = [ { min: 0, max: 100, label: "Desconhecido", cor: "#7f8c8d", acesso: "Itens Básicos", compra: 1.75, venda: 0.50, nivel: 1 }, { min: 101, max: 500, label: "Baixo", cor: "#e74c3c", acesso: "Itens Básicos", compra: 1.60, venda: 0.65, nivel: 1 }, { min: 501, max: 3000, label: "Médio", cor: "#f1c40f", acesso: "Artefatos/Trajes", compra: 1.50, venda: 0.75, nivel: 2 }, { min: 3001, max: 5000, label: "Alto", cor: "#2ecc71", acesso: "Tecnologia Experimental", compra: 1.25, venda: 0.85, nivel: 3 }, { min: 5001, max: 9999, label: "Total", cor: "#00b4d8", acesso: "Acesso Irrestrito", compra: 1.0, venda: 1.0, nivel: 3 } ];
    }
}
function getRepInfo(val) { let found = window.taxasComercio.find(c => val >= c.min && val <= c.max); return found || window.taxasComercio[window.taxasComercio.length - 1]; }

async function carregarDashboard() { 
    const token = localStorage.getItem('stalker_token');
    if(token) {
        try {
            const base64Url = token.split('.')[1]; const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
            const user = JSON.parse(jsonPayload);
            const painelNome = document.getElementById('nomeUsuarioLogado'); if (painelNome) painelNome.innerText = user.nome || 'Operador Desconhecido';
        } catch(e) {}
    }
    const res = await fetch('/api/estatisticas', { headers: { 'Authorization': token } }); 
    if(!res.ok) return; const stats = await res.json(); 
    document.getElementById('statStalkers').innerText = stats.totalStalkers; 
    document.getElementById('statTop').innerText = stats.topStalker; 
    document.getElementById('statMissoes').innerText = stats.missoesAtivas; 
    document.getElementById('statItens').innerText = stats.totalItens; 
}

window.pesquisasAtuais = [];
async function carregarPesquisas() { 
    try {
        const res = await fetch('/api/pesquisas', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); 
        if(!res.ok) return; 
        const data = await res.json(); 
        window.pesquisasAtuais = data; 
        const div = document.getElementById('listaPesquisas'); 
        if(!div) return; 
        const categorias = { 'artefato': 'ARTEFATOS CATALOGADOS', 'mutante': 'DISSECAÇÃO DE MUTANTES', 'anomalia': 'ANOMALIAS ESPACIAIS', 'tecnologia': 'TECNOLOGIAS EXPERIMENTAIS' }; 
        let html = ''; 
        for (let catKey in categorias) { 
            const items = data.filter(p => p.classificacao === catKey); 
            if (items.length > 0) { 
                html += `<details open style="margin-bottom: 15px; background: #121314; border: 1px solid #2a2e2a; border-radius: 4px;">
                    <summary style="padding: 15px; font-size: 1.1em; color: #a5b396; cursor: pointer; border-bottom: 1px solid #2a2e2a; outline: none; font-family: 'Share Tech Mono', monospace;">
                        ${categorias[catKey]} (${items.length})
                    </summary>
                    <div style="padding: 15px;">
                        ${items.map(p => `
                        <div class="pda-ui" style="border-left: 4px solid #a5b396; margin-bottom:10px; background: #0f1011; padding: 15px;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <div style="display:flex; gap:15px; align-items:center;">
                                    <img src="/uploads/${p.foto || 'default.jpg'}" onclick="abrirPerfilPesquisa(${p.id})" style="border-radius:2px; border:1px solid #333; object-fit:cover; cursor:pointer;" width="65" height="65">
                                    <div>
                                        <h4 style="margin:0 0 5px 0; color:#e67e22; font-family:'Share Tech Mono', monospace; font-size:1.1em; letter-spacing:1px;">${p.titulo}</h4>
                                        <small style="color:#778466; font-family:'Share Tech Mono', monospace;">POR: ${p.autor} EM ${new Date(p.data.replace(' ', 'T') + 'Z').toLocaleDateString()}</small>
                                    </div>
                                </div>
                                <div style="display:flex; gap: 5px; flex-direction: column;">
                                    <button onclick="prepararEdicaoPesquisa(${p.id})" class="pda-btn" style="background:#5e4a2b !important; border-color:#8a6a3b !important; color:#f39c12 !important; padding: 5px 10px !important;">EDITAR</button>
                                    <button onclick="excluirPesquisa(${p.id})" class="pda-btn" style="background:#4a1e1e !important; border-color:#7a2e2e !important; color:#e74c3c !important; padding: 5px 10px !important;">EXCLUIR</button>
                                </div>
                            </div>
                        </div>`).join('')}
                    </div>
                </details>`; 
            } 
        } 
        if(data.length === 0) html = "<p style='color:#778466; font-family: \"Share Tech Mono\", monospace;'>NENHUM REGISTRO CIENTÍFICO ENCONTRADO.</p>"; 
        div.innerHTML = html;
    } catch(e) {
        console.error("Erro enciclopedia", e);
    }
}
function abrirPerfilPesquisa(id) { const p = window.pesquisasAtuais.find(x => x.id === id); if(!p) return; const html = `<div style="display:flex; gap: 20px; align-items: flex-start; flex-wrap:wrap;"><img src="/uploads/${p.foto || 'default.jpg'}" width="200" height="200" style="border-radius:8px; border:3px solid #f1c40f; object-fit:cover;"><div style="flex:1;"><h1 style="margin: 0 0 5px 0; color: #f1c40f;">${p.titulo}</h1><h3 style="margin: 0 0 15px 0; color: #aaa; text-transform:uppercase;">${p.classificacao}</h3><p style="margin:5px 0; color:#ddd;"><b>Por:</b> ${p.autor}</p><p style="margin:5px 0; color:#ddd;"><b>Data:</b> ${new Date(p.data.replace(' ', 'T') + 'Z').toLocaleDateString()}</p></div></div><hr style="border-color: #333; margin: 25px 0;"><h3 style="color:#f39c12; margin-top:0;">📋 Análise Científica Detalhada:</h3><div style="background: rgba(243, 156, 18, 0.05); padding: 15px; border-left: 3px solid #f1c40f; border-radius: 4px; min-height: 120px; white-space: pre-wrap; color:#ccc; font-size:1.05em;">${p.descricao}</div>`; document.getElementById('conteudoPerfil').innerHTML = html; document.getElementById('modalPerfil').style.display = 'flex'; }
async function salvarPesquisa(e) { e.preventDefault(); const form = document.getElementById('formPesquisa'); const formData = new FormData(form); const id = document.getElementById('editPesquisaId').value; const url = id ? `/api/pesquisas/${id}` : '/api/pesquisas'; await fetch(url, { method: id ? 'PUT' : 'POST', headers: {'Authorization': localStorage.getItem('stalker_token')}, body: formData }); location.reload(); }
function prepararEdicaoPesquisa(id) { const p = window.pesquisasAtuais.find(x => x.id === id); document.getElementById('editPesquisaId').value = p.id; document.getElementById('pTitulo').value = p.titulo; document.getElementById('pClass').value = p.classificacao; document.getElementById('pDesc').value = p.descricao; document.getElementById('btnSalvarPesquisa').innerText = "ATUALIZAR DESCOBERTA"; document.getElementById('btnCancelarPesquisa').style.display = "inline-block"; window.scrollTo(0,0); }
function cancelarEdicaoPesquisa() { location.reload(); }
async function excluirPesquisa(id) { if(confirm("Deseja apagar este registro científico?")) { await fetch(`/api/pesquisas/${id}`, { method: 'DELETE', headers: {'Authorization': localStorage.getItem('stalker_token')} }); location.reload(); } }

window.membrosAtuais = [];
async function carregarMembros() { 
    const res = await fetch('/api/membros', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); 
    const ms = await res.json(); window.membrosAtuais = ms; const lista = document.getElementById('listaMembros'); 
    if(lista) { lista.innerHTML = ms.map(m => `<div class="card" style="display:flex; justify-content:space-between; align-items:center;"><div><strong style="font-size: 1.2em;">${m.nome}</strong> (@${m.usuario})<br><small style="color:var(--accent);">Nível de Acesso: <b>${m.role.toUpperCase()}</b></small></div><div style="display:flex; gap:5px;">${m.usuario !== 'admin' ? `<button onclick="prepararEdicaoMembro(${m.id})" style="background:#f39c12; width:auto; padding:5px 15px;">Editar</button><button onclick="excluirMembro(${m.id})" style="background:#c0392b; width:auto; padding:5px 15px;">Revogar</button>` : '<span style="color:#7f8c8d;">Matriz</span>'}</div></div>`).join(''); } 
}
async function salvarMembro(e) { e.preventDefault(); const id = document.getElementById('editMembroId').value; const body = { nome: document.getElementById('mNome').value, usuario: document.getElementById('mUser').value, senha: document.getElementById('mPass').value, role: document.getElementById('mRole').value }; const url = id ? `/api/membros/${id}` : '/api/membros'; const res = await fetch(url, { method: id ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token')}, body: JSON.stringify(body) }); if(res.ok) location.reload(); else alert("Erro ao salvar!"); }
function prepararEdicaoMembro(id) { const m = window.membrosAtuais.find(x => x.id === id); document.getElementById('editMembroId').value = m.id; document.getElementById('mNome').value = m.nome; document.getElementById('mUser').value = m.usuario; document.getElementById('mPass').value = ''; document.getElementById('mRole').value = m.role; document.getElementById('btnSalvarMembro').innerText = "ATUALIZAR DADOS"; document.getElementById('btnCancelarMembro').style.display = "inline-block"; window.scrollTo(0,0); }
function cancelarEdicaoMembro() { location.reload(); }
async function excluirMembro(id) { if(confirm("Revogar acesso?")) { await fetch(`/api/membros/${id}`, { method: 'DELETE', headers: {'Authorization': localStorage.getItem('stalker_token')} }); location.reload(); } }

window.stalkersGlobais = []; window.missoesGlobais = [];
async function carregarStalkers() {
    await carregarTaxas();
    const res = await fetch('/api/stalkers', { headers: { 'Authorization': localStorage.getItem('stalker_token') } });
    if (!res.ok) return; window.stalkersGlobais = await res.json(); 
    const resM = await fetch('/api/missoes', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); 
    if (resM.ok) { window.missoesGlobais = await resM.json(); } else { window.missoesGlobais = []; }
    aplicarFiltrosEOrdem(); 
}

function aplicarFiltrosEOrdem() {
    const inputBusca = document.getElementById('buscaStalker'); const inputOrdem = document.getElementById('ordemStalker');
    const termo = inputBusca ? inputBusca.value.toLowerCase() : ''; const ordem = inputOrdem ? inputOrdem.value : 'id_desc';
    const isListaNegra = window.location.pathname.includes('listanegra.html');
    let filtrados = [...window.stalkersGlobais];
    if (isListaNegra) { filtrados = filtrados.filter(s => s.status_lista_negra == 1); } else { filtrados = filtrados.filter(s => s.status_lista_negra != 1); }
    if (termo) { filtrados = filtrados.filter(s => { const codinome = s.codinome ? s.codinome.toLowerCase() : ''; const nome = s.nome ? s.nome.toLowerCase() : ''; const faccao = s.faccao ? s.faccao.toLowerCase() : ''; return codinome.includes(termo) || nome.includes(termo) || faccao.includes(termo); }); }
    filtrados.sort((a, b) => {
        const codA = a.codinome || ''; const codB = b.codinome || ''; const facA = a.faccao || ''; const facB = b.faccao || '';
        if (ordem === 'id_desc') return b.id - a.id; if (ordem === 'id_asc') return a.id - b.id;
        if (ordem === 'rep_desc') return b.reputacao - a.reputacao; if (ordem === 'rep_asc') return a.reputacao - b.reputacao;
        if (ordem === 'alfa_asc') return codA.localeCompare(codB); if (ordem === 'alfa_desc') return codB.localeCompare(codA);
        if (ordem === 'fac_asc') return facA.localeCompare(facB) || codA.localeCompare(codB);
        if (ordem === 'fac_desc') return facB.localeCompare(facA) || codA.localeCompare(codB);
        return 0;
    }); renderizarStalkers(filtrados, isListaNegra);
}

function renderizarStalkers(dados, isListaNegra) {
    const lista = document.getElementById('listaStalkers'); const now = new Date(); const dataHoje = now.getDate() + '/' + (now.getMonth() + 1) + '/' + now.getFullYear(); const isAdmin = (getUser() && (getUser().role === 'faction_admin' || getUser().role === 'super_admin')); 
    if (lista) {
        if (dados.length === 0) { lista.innerHTML = "<p style='color:#7f8c8d; font-size:1.1em; margin-top:20px;'>Nenhum registro encontrado nesta categoria.</p>"; return; }
        lista.innerHTML = dados.map(s => {
            const info = getRepInfo(s.reputacao);
            if (isListaNegra) { return `<div class="card" style="border-left: 4px solid #e74c3c; background:rgba(231, 76, 60, 0.05); margin-bottom:15px;"><div style="display:flex; justify-content:space-between; align-items:flex-start;"><div style="display:flex; gap:15px; align-items:center;"><img src="/uploads/${s.foto}" onclick="abrirPerfilStalker(${s.id})" class="foto-clicavel" width="60" height="60" style="border-radius:5px; border:2px solid #e74c3c; object-fit:cover; filter: grayscale(100%);"><div><strong style="font-size:1.3em; color:#e74c3c; text-decoration: line-through;">${s.codinome}</strong> <span style="color:#7f8c8d;">(${s.faccao})</span><br><small style="color:#aaa;">Motivo do Banimento:</small><br><b style="color:#e74c3c;">"${s.motivo_lista_negra}"</b></div></div>${isAdmin ? `<button onclick="perdoarStalker(${s.id})" style="background:#2ecc71; width:auto; margin:0;">Remover Banimento</button>` : ''}</div></div>`; }
            let missoesAtuais = window.missoesGlobais.filter(m => { let ativos = []; try { ativos = JSON.parse(m.stalkers_ids || '[]'); } catch(e){} if (m.stalker_id && !ativos.includes(m.stalker_id)) ativos.push(m.stalker_id); return ativos.includes(s.id); }).map(m => m.titulo);
            let badgeMissao = missoesAtuais.length > 0 ? `<div style="margin-top:15px; padding:8px; background:rgba(231, 76, 60, 0.1); border-left:3px solid #e74c3c; border-radius:3px; animation: pulse 2s infinite;"><small style="color:#e74c3c; font-weight:bold; letter-spacing:1px;">📌 EM OPERAÇÃO: [ ${missoesAtuais.join(', ')} ]</small></div>` : '';
            let btnCheckin = (s.ultimo_checkin === dataHoje) ? `<button disabled style="background:#444; color:#aaa; width:auto; font-weight:bold; cursor:not-allowed; border: 1px solid #222; margin:0;">✅ Feito Hoje</button>` : `<button onclick="marcarPresenca(${s.id})" style="background:#27ae60; width:auto; font-weight:bold; margin:0;">📍 Check-in</button>`;
            return `<details class="card" style="padding:0; overflow:hidden; border-left: 4px solid ${info.cor}; margin-bottom:15px; background:var(--bg);"><summary style="padding:15px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; outline:none; background:rgba(30, 33, 36, 0.85);"><div style="display:flex; gap:15px; align-items:center;"><img src="/uploads/${s.foto}" onclick="abrirPerfilStalker(${s.id}); event.preventDefault();" class="foto-clicavel" title="Ver Dossiê Completo" width="60" height="60" style="border-radius:5px; border:2px solid ${info.cor}; object-fit:cover;"><div><strong style="font-size:1.3em; color:var(--text);">${s.codinome}</strong> <span style="color:#7f8c8d;">(${s.faccao})</span>${missoesAtuais.length > 0 ? '<span style="color:#e74c3c; margin-left:10px; font-size:0.8em; animation: pulse 2s infinite; font-weight:bold;">🔴 CAMPO</span>' : ''}</div></div><div style="text-align:right;"><small style="color:#aaa;">Reputação: <b style="color:${info.cor}; font-size:1.3em;">${s.reputacao}</b></small></div></summary><div style="padding:15px; border-top:1px solid #333; background:rgba(0,0,0,0.4);"><div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:15px;"><div><p style="margin:0 0 5px 0;"><small style="color:#aaa;">Nome Real:</small> <b>${s.nome}</b></p><p style="margin:0 0 5px 0;"><small style="color:#aaa;">Status Compra:</small> <b style="color:${info.cor}">${info.label}</b></p><p style="margin:0 0 5px 0;"><small style="color:#aaa;">Dias no Pantano:</small> <b style="color:var(--accent)">${s.presencas || 0} dias</b></p></div><div style="display:flex; gap:5px; flex-direction:column; align-items:flex-end;"><div style="display:flex; gap:5px; flex-wrap:wrap;">${btnCheckin}<button onclick="window.location.href='historico.html?id=${s.id}'" style="background:#3498db; width:auto; margin:0;">Histórico</button><button onclick="prepararEdicao(${s.id})" style="background:#f39c12; width:auto; margin:0;">Editar Perfil</button>${isAdmin ? `<button onclick="banirStalker(${s.id})" style="background:#8e44ad; width:auto; margin:0;">Mover p/ Lista Negra</button>` : ''}<button onclick="excluirStalker(${s.id})" style="background:#e74c3c; width:auto; margin:0;">Apagar</button></div></div></div>${badgeMissao}<hr style="margin:15px 0; border-color:#222;"><div style="display:flex; gap:10px; align-items:center;"><input type="number" id="val-${s.id}" placeholder="Pts (+/-)" style="width:100px; margin:0;"><input type="text" id="mot-${s.id}" placeholder="Motivo..." style="flex:1; margin:0;"><button onclick="mudarRep(${s.id})" style="width:auto; margin:0;">Lançar Pts</button></div></div></details>`;
        }).join('');
    }
}

function abrirPerfilStalker(id) { 
    const s = window.stalkersGlobais.find(x => x.id === id); if(!s) return; 
    const info = getRepInfo(s.reputacao); 
    let htmlListaNegra = ''; if (s.status_lista_negra == 1) { htmlListaNegra = `<div style="background:#e74c3c; color:#fff; padding:10px; text-align:center; font-weight:bold; font-size:1.2em; letter-spacing:2px; margin-bottom:15px; border-radius:4px;">❌ ACESSO NEGADO: LISTA NEGRA ❌<br><small style="font-weight:normal; letter-spacing:0;">Motivo: ${s.motivo_lista_negra}</small></div>`; }
    let relHtml = '<i style="color:#777;">Neutras / Desconhecidas</i>';
    try {
        if(s.relacoes_faccoes && s.relacoes_faccoes.startsWith('{')) {
            const rObj = JSON.parse(s.relacoes_faccoes); let badges = [];
            for(let f in rObj) {
                if(rObj[f] === 'Aliado') badges.push(`<span style="display:inline-block; background:rgba(46, 204, 113, 0.15); color:#2ecc71; padding:3px 8px; border-radius:4px; margin:3px; font-size:0.95em; border:1px solid #2ecc71; font-weight:bold;">🛡️ ${f}: Aliado</span>`);
                else if(rObj[f] === 'Inimigo') badges.push(`<span style="display:inline-block; background:rgba(231, 76, 60, 0.15); color:#e74c3c; padding:3px 8px; border-radius:4px; margin:3px; font-size:0.95em; border:1px solid #e74c3c; font-weight:bold;">⚔️ ${f}: Inimigo</span>`);
                else if(rObj[f] === 'Neutro') badges.push(`<span style="display:inline-block; background:rgba(150, 150, 150, 0.1); color:#aaa; padding:3px 8px; border-radius:4px; margin:3px; font-size:0.95em; border:1px solid #555;">⚪ ${f}: Neutro</span>`);
            }
            if(badges.length > 0) relHtml = badges.join('');
        }
    } catch(e) { }

    const html = `${htmlListaNegra}<div style="display:flex; gap: 20px; align-items: flex-start; flex-wrap:wrap;"><img src="/uploads/${s.foto}" width="160" height="160" style="border-radius:8px; border:3px solid ${s.status_lista_negra == 1 ? '#e74c3c' : info.cor}; object-fit:cover; box-shadow: 0 0 15px ${s.status_lista_negra == 1 ? '#e74c3c' : info.cor}; ${s.status_lista_negra == 1 ? 'filter:grayscale(100%);' : ''}"><div style="flex:1;"><h1 style="margin: 0 0 5px 0; color: ${s.status_lista_negra == 1 ? '#e74c3c' : info.cor};">${s.codinome}</h1><h3 style="margin: 0 0 15px 0; color: #aaa; font-weight:normal;">Identidade Real: ${s.nome}</h3><p style="margin:5px 0;"><b>Afiliação:</b> ${s.faccao}</p><p style="margin:5px 0;"><b>Status no Bunker:</b> ${s.status_lista_negra == 1 ? '<span style="color:#e74c3c; font-weight:bold;">BANIDO</span>' : info.label}</p><p style="margin:5px 0;"><b>Pontos de Reputação:</b> ${s.reputacao}</p><p style="margin:5px 0;"><b>Dias na Base:</b> ${s.presencas || 0}</p></div></div><div style="margin-top:20px; background:rgba(52, 152, 219, 0.1); border-left: 3px solid #3498db; padding:15px; border-radius:4px;"><h4 style="color:#3498db; margin-top:0;">🌐 Relatório de Inteligência de Campo</h4><p style="margin:5px 0;"><b>Área de Atuação Preferida:</b> ${s.area_atuacao || '<i style="color:#777;">Desconhecida</i>'}</p><p style="margin:5px 0;"><b>Aliados Conhecidos:</b> ${s.aliados || '<i style="color:#777;">Nenhum registro</i>'}</p><p style="margin:5px 0;"><b>Inimigos Declarados:</b> ${s.inimigos || '<i style="color:#777;">Nenhum registro</i>'}</p><div style="margin-top:15px;"><b style="display:block; margin-bottom:5px;">Relações com Facções:</b>${relHtml}</div></div><hr style="border-color: var(--border); margin: 25px 0;"><h3 style="color:#f39c12; margin-top:0;">📝 Notas Confidenciais da Direção:</h3><div style="background: rgba(243, 156, 18, 0.1); padding: 15px; border-left: 3px solid #f39c12; border-radius: 4px; min-height: 80px; white-space: pre-wrap; font-style: italic; color:#ddd; font-size:1.1em; line-height:1.4;">${s.rumores ? s.rumores : "Nenhuma anotação comportamental registrada."}</div>`; 
    document.getElementById('conteudoPerfil').innerHTML = html; document.getElementById('modalPerfil').style.display = 'flex'; 
}
function fecharPerfilStalker() { document.getElementById('modalPerfil').style.display = 'none'; }

async function salvarStalker(e) { e.preventDefault(); const selects = document.querySelectorAll('.relacao-fac'); let relacoes = {}; selects.forEach(sel => { relacoes[sel.getAttribute('data-fac')] = sel.value; }); const fRelacoes = document.getElementById('fRelacoes'); if (fRelacoes) fRelacoes.value = JSON.stringify(relacoes); const f = document.getElementById('formStalker'); const id = document.getElementById('editId').value; const url = id ? `/api/stalkers/${id}` : '/api/stalkers'; await fetch(url, { method: id ? 'PUT' : 'POST', headers: { 'Authorization': localStorage.getItem('stalker_token') }, body: new FormData(f) }); location.reload(); }
function prepararEdicao(id) { const s = window.stalkersGlobais.find(x => x.id === id); if(!s) return; document.getElementById('editId').value = s.id; document.getElementById('fNome').value = s.nome; document.getElementById('fCodinome').value = s.codinome; document.getElementById('fFaccao').value = s.faccao; document.getElementById('fRumores').value = s.rumores || ''; if (document.getElementById('fArea')) document.getElementById('fArea').value = s.area_atuacao || ''; if (document.getElementById('fAliados')) document.getElementById('fAliados').value = s.aliados || ''; if (document.getElementById('fInimigos')) document.getElementById('fInimigos').value = s.inimigos || ''; document.querySelectorAll('.relacao-fac').forEach(el => el.value = 'Neutro'); try { if(s.relacoes_faccoes && s.relacoes_faccoes.startsWith('{')) { const rObj = JSON.parse(s.relacoes_faccoes); for(let f in rObj) { let sel = document.querySelector(`.relacao-fac[data-fac="${f}"]`); if(sel) sel.value = rObj[f]; } } } catch(e){} document.getElementById('formTitle').innerText = "Editar Dossiê Confidencial"; document.getElementById('btnSalvar').innerText = "Salvar Alterações"; document.getElementById('btnCancelar').style.display = "block"; window.scrollTo(0,0); }
function cancelarEdicao() { location.reload(); }
async function excluirStalker(id) { if(confirm("Deseja apagar permanentemente este registro?")) { await fetch(`/api/stalkers/${id}`, { method: 'DELETE', headers: { 'Authorization': localStorage.getItem('stalker_token') } }); location.reload(); } }
async function mudarRep(id) { const valor = document.getElementById(`val-${id}`).value, motivo = document.getElementById(`mot-${id}`).value; if(!valor || !motivo) return alert("Preencha tudo."); await fetch('/api/reputacao', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token') }, body: JSON.stringify({ stalker_id: id, valor, motivo }) }); location.reload(); }
async function marcarPresenca(id) { if(confirm("Confirmar check-in (+10 de Reputação)?")) { const res = await fetch('/api/presenca', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token') }, body: JSON.stringify({ stalker_id: id }) }); if (!res.ok) alert(await res.text()); location.reload(); } }
async function banirStalker(id) { const s = window.stalkersGlobais.find(x => x.id === id); const motivo = prompt(`MOTIVO DO BANIMENTO PARA O AGENTE [${s.codinome}]:`); if (!motivo) return alert("O banimento exige uma justificativa oficial."); await fetch(`/api/stalkers/${id}/banir`, { method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token')}, body: JSON.stringify({motivo}) }); location.reload(); }
async function perdoarStalker(id) { if(confirm("Deseja perdoar este Stalker e permitir seu retorno ao Laboratório?")) { await fetch(`/api/stalkers/${id}/perdoar`, { method: 'POST', headers: {'Authorization': localStorage.getItem('stalker_token')} }); location.reload(); } }

// ==========================================
// 8. O ESTOQUE (COM FILTRO E IMPORTAÇÃO)
// ==========================================
window.itensGlobais = [];
async function inicializarEstoque() { 
    const res = await fetch('/api/itens', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); 
    window.itensGlobais = await res.json(); 
    const isAdmin = (getUser() && (getUser().role === 'faction_admin' || getUser().role === 'super_admin')); 
    const formEstoque = document.getElementById('painelGerenciamentoEstoque'); 
    if(formEstoque) formEstoque.style.display = isAdmin ? 'block' : 'none'; 
    const btnImportar = document.getElementById('btnImportarCarga');
    if(btnImportar) btnImportar.style.display = isAdmin ? 'block' : 'none';
    renderizarEstoque(window.itensGlobais);
}
function aplicarFiltroEstoque() { const inputBusca = document.getElementById('buscaEstoque'); const termo = inputBusca ? inputBusca.value.toLowerCase() : ''; let filtrados = [...window.itensGlobais]; if (termo) { filtrados = filtrados.filter(i => (i.nome && i.nome.toLowerCase().includes(termo)) || (i.categoria && i.categoria.toLowerCase().includes(termo)) ); } renderizarEstoque(filtrados); }
function renderizarEstoque(dados) { const lista = document.getElementById('listaDeItens'); const isAdmin = (getUser() && (getUser().role === 'faction_admin' || getUser().role === 'super_admin')); const canDelete = (getUser() && getUser().role === 'super_admin'); if(lista) { if (dados.length === 0) { lista.innerHTML = "<p style='color:#7f8c8d; font-size:1.1em; margin-top:20px;'>Nenhum equipamento encontrado.</p>"; return; } const categorias = [...new Set(dados.map(i => i.categoria || 'Geral'))]; let html = ''; categorias.forEach(cat => { const itemsCat = dados.filter(i => (i.categoria || 'Geral') === cat); html += `<details open style="margin-bottom: 15px; background: #1a1d1f; border: 1px solid var(--border); border-radius: 5px;"><summary style="padding: 10px; font-size: 1.2em; font-weight: bold; color: var(--accent); cursor: pointer; border-bottom: 1px solid var(--border); outline: none;">📦 ${cat.toUpperCase()} (${itemsCat.length})</summary><div style="padding: 15px;">${itemsCat.map(i => `<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #333; padding:10px 0;"><div style="display:flex; gap:15px; align-items:center;"><img src="/uploads/${i.foto || 'default.jpg'}" width="55" height="55" style="border-radius:4px; border:1px solid var(--accent); object-fit:cover;"><div><strong style="font-size:1.1em;">${i.nome}</strong><br><small style="color:#aaa;">${i.preco_base} RU | Exige Nível: ${nomeNivelItem(i.nivel_piaget)}</small></div></div>${isAdmin ? `<div style="display:flex; gap:5px;"><button onclick="prepararEdicaoItem(${i.id}, '${i.nome}', '${i.categoria || 'Geral'}', ${i.preco_base}, ${i.nivel_piaget})" style="background:#f39c12; width:auto; padding:5px 10px;">Editar</button>${canDelete?`<button onclick="excluirItem(${i.id})" style="background:#e74c3c; width:auto; padding:5px 10px;">X</button>`:''}</div>` : ''}</div>`).join('')}</div></details>`; }); lista.innerHTML = html; } }
async function importarCarga() { if(confirm("Deseja contatar o Alto Comando e solicitar a Carga Oficial de Suprimentos para o Laboratório? (Isso também vai clonar as Pesquisas já feitas para o Estoque)")) { document.getElementById('btnImportarCarga').innerText = "⏳ O Helicóptero está a caminho..."; const res = await fetch('/api/itens/importar', { method: 'POST', headers: { 'Authorization': localStorage.getItem('stalker_token') } }); if(res.ok) { alert("🚁 Carga recebida com sucesso no Bunker!"); location.reload(); } else { alert("Falha na comunicação com o QG."); document.getElementById('btnImportarCarga').innerText = "📥 Solicitar Carga Oficial"; } } }
async function salvarItem(e) { e.preventDefault(); const form = document.getElementById('formItem'); const formData = new FormData(form); const id = document.getElementById('editItemId').value; const url = id ? `/api/itens/${id}` : '/api/itens'; const res = await fetch(url, { method: id ? 'PUT' : 'POST', headers: {'Authorization': localStorage.getItem('stalker_token')}, body: formData }); if(res.ok) location.reload(); else alert("Apenas Diretores!"); }
function prepararEdicaoItem(id, nome, categoria, preco, nivel) { document.getElementById('editItemId').value = id; document.getElementById('nomeItem').value = nome; document.getElementById('catItem').value = categoria; document.getElementById('precoItem').value = preco; document.getElementById('nivelMinimo').value = nivel; document.getElementById('btnSalvarItem').innerText = "Atualizar Item"; document.getElementById('btnCancelarItem').style.display = "inline-block"; window.scrollTo(0,0); }
function cancelarEdicaoItem() { location.reload(); }
async function excluirItem(id) { if(!getUser() || getUser().role !== "super_admin") return alert("Somente o Super Admin pode excluir itens."); if(confirm("Excluir item?")) { await fetch(`/api/itens/${id}`, { method: 'DELETE', headers: { 'Authorization': localStorage.getItem('stalker_token') } }); location.reload(); } }

// ==========================================
// 9. O COMÉRCIO (FILTRO E CÁLCULO AUTO)
// ==========================================
window.carrinho = []; 
window.itensComercioGlobais = []; 

async function inicializarComercio() { 
    await carregarTaxas(); 
    const isAdmin = (getUser() && (getUser().role === 'faction_admin' || getUser().role === 'super_admin')); 
    const btnEco = document.getElementById('btnEconomiaAdmin'); if(btnEco) btnEco.style.display = isAdmin ? 'block' : 'none';
    
    const resS = await fetch('/api/stalkers', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); const stalkers = await resS.json(); 
    const resI = await fetch('/api/itens', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); 
    window.itensComercioGlobais = await resI.json(); 
    
    const selectS = document.getElementById('selectStalker'); 
    if(selectS) selectS.innerHTML = `<option value="0">-- Selecione um Stalker --</option>` + stalkers.filter(s => s.status_lista_negra != 1).map(s => `<option value="${s.id}" data-rep="${s.reputacao}">${s.codinome} | ${s.nome} (${s.reputacao} pts)</option>`).join(''); 
    
    renderizarDropdownItens();
}

function renderizarDropdownItens() {
    const selectI = document.getElementById('selectItem');
    const selS = document.getElementById('selectStalker');
    const inputBusca = document.getElementById('buscaComercioItem');
    if(!selectI) return;

    let termo = inputBusca ? inputBusca.value.toLowerCase() : '';
    let nivelPermitido = 3; 

    if (selS && selS.value != 0) {
        const rep = selS.options[selS.selectedIndex].getAttribute('data-rep');
        const info = getRepInfo(parseInt(rep));
        nivelPermitido = info.nivel;
    }

    let itensFiltrados = window.itensComercioGlobais.filter(i => {
        if (parseInt(i.nivel_piaget) > nivelPermitido) return false;
        if (termo && !i.nome.toLowerCase().includes(termo)) return false;
        return true;
    });

    selectI.innerHTML = `<option value="0">-- Selecione um Item --</option>` + itensFiltrados.map(i => `<option value="${i.id}" data-nome="${i.nome}" data-preco="${i.preco_base}" data-nivel="${i.nivel_piaget}">${i.nome} (${i.preco_base} RU)</option>`).join('');
}

function filtrarItensComercio() { renderizarDropdownItens(); }

function atualizarInterfaceComercio() { 
    const selS = document.getElementById('selectStalker'); 
    if(!selS || selS.value == 0) { window.carrinho = []; renderizarCarrinho(); document.getElementById('statusPiaget').style.display = 'none'; document.getElementById('painelPagamento').style.display = 'none'; renderizarDropdownItens(); return; } 
    const rep = selS.options[selS.selectedIndex].getAttribute('data-rep'); const info = getRepInfo(parseInt(rep)); 
    const painel = document.getElementById('statusPiaget'); 
    if(painel) { painel.style.display = 'block'; painel.style.borderColor = info.cor; document.getElementById('labelNivel').innerText = "Status: " + info.label; document.getElementById('itensLiberados').innerText = info.acesso; } 
    document.getElementById('painelPagamento').style.display = 'block'; 
    renderizarCarrinho(); 
    renderizarDropdownItens(); // FILTRA A LISTA NA HORA
}

function adicionarAoCarrinho() {
    const selS = document.getElementById('selectStalker'); const selI = document.getElementById('selectItem'); const qtd = parseInt(document.getElementById('qtdItem').value) || 1;
    if(!selS || selS.value == 0) return alert("Selecione um Stalker primeiro."); if(!selI || selI.value == 0) return alert("Selecione um Item para adicionar."); if(qtd < 1) return alert("Quantidade inválida.");
    const rep = parseInt(selS.options[selS.selectedIndex].getAttribute('data-rep')); const info = getRepInfo(rep);
    const optI = selI.options[selI.selectedIndex]; const idItem = optI.value; const nomeItem = optI.getAttribute('data-nome'); const precoBase = parseFloat(optI.getAttribute('data-preco')); const nivelI = parseInt(optI.getAttribute('data-nivel'));
    if(info.nivel < nivelI) return alert("❌ ACESSO NEGADO: O nível de confiança deste Stalker é muito baixo para esta tecnologia.");
    let ex = window.carrinho.find(i => i.id === idItem); if(ex) { ex.qtd += qtd; } else { window.carrinho.push({ id: idItem, nome: nomeItem, preco: precoBase, qtd: qtd }); } document.getElementById('qtdItem').value = 1; renderizarCarrinho();
}

function removerDoCarrinho(idx) { window.carrinho.splice(idx, 1); renderizarCarrinho(); }

function renderizarCarrinho() {
    const selS = document.getElementById('selectStalker'); if(!selS || selS.value == 0) return;
    const rep = parseInt(selS.options[selS.selectedIndex].getAttribute('data-rep')); const info = getRepInfo(rep);
    let html = ''; let totalCompra = 0; let totalVenda = 0;
    window.carrinho.forEach((c, idx) => {
        let subCompra = (c.preco * info.compra) * c.qtd; let subVenda = (c.preco * info.venda) * c.qtd; totalCompra += subCompra; totalVenda += subVenda;
        html += `<div style="display:flex; justify-content:space-between; margin-bottom:8px; padding-bottom:8px; border-bottom:1px dashed #444; font-size:1.1em; align-items:center;"><span><b style="color:var(--accent);">${c.qtd}x</b> ${c.nome}</span><button onclick="removerDoCarrinho(${idx})" style="background:transparent; color:#e74c3c; border:1px solid #e74c3c; width:auto; padding:2px 8px; font-size:0.8em; margin:0;">Remover</button></div>`;
    });
    document.getElementById('carrinhoLista').innerHTML = html || "<p style='color:#7f8c8d; font-style:italic;'>Nenhum item selecionado.</p>";
    document.getElementById('resCompra').innerText = Math.round(totalCompra) + " RU"; document.getElementById('resVenda').innerText = Math.round(totalVenda) + " RU";
    toggleInputsPagamento(); // RECALCULA O BÔNUS SEMPRE
}

function toggleInputsPagamento() { 
    document.getElementById('divEscambo').style.display = document.getElementById('pgItem').checked ? 'block' : 'none'; 
    const usaRep = document.getElementById('pgRep').checked;
    const usaRu = document.getElementById('pgRu').checked;
    const divRep = document.getElementById('divReputacao');
    const inputRep = document.getElementById('numReputacao');
    if (usaRep) {
        divRep.style.display = 'block';
        if (usaRu) {
            let strVenda = document.getElementById('resCompra').innerText.replace(' RU', '');
            let strCompra = document.getElementById('resVenda').innerText.replace(' RU', '');
            let ptsVenda = Math.round((parseFloat(strVenda || 0) / 2) * 0.01);
            let ptsCompra = Math.round((parseFloat(strCompra || 0) / 2) * 0.01);
            inputRep.disabled = true; inputRep.value = ''; inputRep.placeholder = `Aprox: +${ptsVenda} pts (Se Vender) | +${ptsCompra} pts (Se Comprar)`;
            inputRep.style.backgroundColor = '#222'; inputRep.style.color = '#f1c40f'; inputRep.style.border = '1px solid #f1c40f'; inputRep.style.textAlign = 'center'; inputRep.style.fontWeight = 'bold';
        } else {
            inputRep.disabled = false; inputRep.value = ''; inputRep.placeholder = 'Reputação Bônus (+/-)';
            inputRep.style.backgroundColor = 'rgba(0,0,0,0.6)'; inputRep.style.color = '#fff'; inputRep.style.border = '1px solid #444'; inputRep.style.textAlign = 'left'; inputRep.style.fontWeight = 'normal';
        }
    } else {
        divRep.style.display = 'none';
    }
}

async function registrarTransacaoCarrinho(tipo) { 
    if(window.carrinho.length === 0) return alert("O carrinho está vazio!");
    const idS = document.getElementById('selectStalker').value; 
    const strValor = tipo === 'venda_bunker' ? document.getElementById('resCompra').innerText : document.getElementById('resVenda').innerText; 
    const valorNumerico = parseFloat(strValor.replace(' RU', ''));
    let descItens = window.carrinho.map(c => `${c.qtd}x ${c.nome}`).join(', '); 
    let acao = tipo === 'venda_bunker' ? "VENDEU P/ STALKER" : "COMPROU DO STALKER";
    let metodos = [], detalhes = [], repE = 0; 
    const usaRu = document.getElementById('pgRu').checked; const usaRep = document.getElementById('pgRep').checked;
    if(usaRu) metodos.push("Rublos"); 
    if(document.getElementById('pgItem').checked) { metodos.push("Escambo"); detalhes.push(`Troca: ${document.getElementById('txtEscambo').value}`); } 
    if(usaRep) { 
        metodos.push("Reputação"); 
        if (usaRu) { repE = Math.round((valorNumerico / 2) * 0.01); } 
        else { repE = parseInt(document.getElementById('numReputacao').value) || 0; }
        detalhes.push(`Rep bônus: ${repE > 0 ? '+':''}${repE}`); 
    } 
    await fetch('/api/transacao', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token') }, body: JSON.stringify({ stalker_id: idS, motivo: `COMÉRCIO: Bunker ${acao} [${descItens}] por Total de ${strValor}. Pgtos: [${metodos.join(', ')}] (${detalhes.join(' | ')})`, tipo: tipo, reputacao_extra: repE }) }); 
    alert("Operação Finalizada e gravada no Dossiê!"); location.reload(); 
}

function abrirPainelEconomia() {
    if (!window.taxasComercio || window.taxasComercio.length === 0) {
        window.taxasComercio = [ { min: 0, max: 100, label: "Desconhecido", cor: "#7f8c8d", acesso: "Itens Básicos", compra: 1.75, venda: 0.50, nivel: 1 }, { min: 101, max: 500, label: "Baixo", cor: "#e74c3c", acesso: "Itens Básicos", compra: 1.60, venda: 0.65, nivel: 1 }, { min: 501, max: 3000, label: "Médio", cor: "#f1c40f", acesso: "Artefatos/Trajes", compra: 1.50, venda: 0.75, nivel: 2 }, { min: 3001, max: 5000, label: "Alto", cor: "#3498db", acesso: "Tecnologia Experimental", compra: 1.25, venda: 0.85, nivel: 3 }, { min: 5001, max: 9999, label: "Total", cor: "#2ecc71", acesso: "Acesso Irrestrito", compra: 1.0, venda: 1.0, nivel: 3 } ];
    }
    let html = `<h2 style="color:#f39c12; margin-top:0;">⚙️ Diretoria: Ajuste da Economia</h2><p style="color:#aaa; margin-bottom:20px;">Altere os multiplicadores de preços com base na reputação do Stalker.</p>`;
    window.taxasComercio.forEach((t, i) => { html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:rgba(0,0,0,0.5); padding:15px; border-left:5px solid ${t.cor}; border-radius:4px;"><div style="flex:1;"><b style="font-size:1.2em; color:${t.cor};">${t.label}</b><br><small style="color:#7f8c8d;">De ${t.min} a ${t.max} pts</small></div><div style="display:flex; gap:15px;"><div><label style="font-size:0.85em; color:#e74c3c;">Venda (Ele Paga):</label><br><input type="number" id="taxaCompra_${i}" step="0.05" value="${t.compra}" style="width:90px; margin:0; font-weight:bold; color:#fff; background:#222; border:1px solid #444; padding:5px;"></div><div><label style="font-size:0.85em; color:#2ecc71;">Compra (Ele Recebe):</label><br><input type="number" id="taxaVenda_${i}" step="0.05" value="${t.venda}" style="width:90px; margin:0; font-weight:bold; color:#fff; background:#222; border:1px solid #444; padding:5px;"></div></div></div>`; });
    html += `<div style="display:flex; gap:10px; margin-top:20px;"><button onclick="salvarPainelEconomia()" style="background:#2ecc71;">Salvar Algoritmo</button><button onclick="fecharPerfilStalker()" style="background:#555;">Cancelar</button></div>`;
    document.getElementById('conteudoPerfil').innerHTML = html; document.getElementById('modalPerfil').style.display = 'flex';
}
async function salvarPainelEconomia() {
    let novasTaxas = [...window.taxasComercio];
    novasTaxas.forEach((t, i) => { t.compra = parseFloat(document.getElementById(`taxaCompra_${i}`).value); t.venda = parseFloat(document.getElementById(`taxaVenda_${i}`).value); });
    await fetch('/api/config/taxas', { method: 'PUT', headers: {'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token')}, body: JSON.stringify(novasTaxas) });
    alert("Economia atualizada com sucesso!"); location.reload();
}

// ==========================================
// 10. MISSÕES DO MURAL
// ==========================================
window.missoesMural = []; async function carregarMissoes() { const resM = await fetch('/api/missoes', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); if (!resM.ok) return; const missoes = await resM.json(); window.missoesMural = missoes; const resS = await fetch('/api/stalkers', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); const stalkers = await resS.json(); const mural = document.getElementById('mural'); const isAdmin = (getUser() && (getUser().role === 'faction_admin' || getUser().role === 'super_admin')); const formCriar = document.getElementById('painelCriarMissao'); if(formCriar) formCriar.style.display = isAdmin ? 'block' : 'none'; if (mural) { const niveis = ['Fácil', 'Médio', 'Alto', 'Suicida']; const coresNivel = { 'Fácil': '#2ecc71', 'Médio': '#f1c40f', 'Alto': '#e67e22', 'Suicida': '#e74c3c' }; let htmlGeral = niveis.map(niv => { let ms = missoes.filter(m => (m.dificuldade || 'Fácil') === niv); if(ms.length === 0) return ''; let htmlDificuldade = `<details open style="margin-bottom:15px; border:1px solid ${coresNivel[niv]}; background:rgba(0,0,0,0.5); border-radius:5px;"><summary style="padding:15px; font-size:1.2em; font-weight:bold; color:${coresNivel[niv]}; cursor:pointer; background:rgba(0,0,0,0.8); outline:none;">📋 Nível de Ameaça: ${niv.toUpperCase()} (${ms.length} em aberto)</summary><div style="padding:15px;">`; htmlDificuldade += ms.map(m => { let recompensas = []; if(m.recompensa_rep) recompensas.push(`<b style="color:#f39c12">+${m.recompensa_rep} REP</b>`); if(m.recompensa_ru) recompensas.push(`<b style="color:#2ecc71">${m.recompensa_ru} RU</b>`); if(m.recompensa_item) recompensas.push(`<b style="color:#3498db">Item: ${m.recompensa_item}</b>`); let ativosIds = []; try { ativosIds = JSON.parse(m.stalkers_ids || '[]'); } catch(e){} let concluidosIds = []; try { concluidosIds = JSON.parse(m.concluidos_ids || '[]'); } catch(e){} if (m.stalker_id && !ativosIds.includes(m.stalker_id) && !concluidosIds.includes(m.stalker_id)) ativosIds.push(m.stalker_id); let equipeAtivaHTML = ""; if (ativosIds.length > 0) { let lista = ativosIds.map(id => { const s = stalkers.find(st => st.id === id); return s ? `<div style="display:flex; justify-content:space-between; margin-top:8px; background:rgba(0,0,0,0.3); padding:8px; align-items:center; border-radius:4px;"><span>⏳ <b>${s.codinome}</b></span><div style="display:flex; gap:5px;"><button onclick="pagarStalkerIndividual(${m.id}, ${s.id})" style="background:#2ecc71; width:auto; padding:5px 10px; font-size:0.85em;">✅ Pagar</button><button onclick="abortarMissao(${m.id}, ${s.id})" style="background:#e74c3c; width:auto; padding:5px 10px; font-size:0.85em;">❌ Abortar</button></div></div>` : ''; }).join(''); equipeAtivaHTML = `<div style="margin-top:15px; padding:10px; border-left:3px solid #f39c12; background:rgba(243, 156, 18, 0.05);"><small style="color:#f39c12;"><b>EQUIPE EM CAMPO:</b></small>${lista}</div>`; } let equipeConcluidaHTML = ""; if (concluidosIds.length > 0) { const nomesConcluidos = concluidosIds.map(id => stalkers.find(st => st.id === id)?.codinome).filter(Boolean).join(', '); equipeConcluidaHTML = `<div style="margin-top:10px; padding:8px; border-left:3px solid #2ecc71; background:rgba(46, 204, 113, 0.05);"><small style="color:#aaa;"><b>✔️ JÁ FINALIZARAM:</b> ${nomesConcluidos}</small></div>`; } const indisponiveis = [...ativosIds, ...concluidosIds]; const stalkersDisponiveis = stalkers.filter(s => s.status_lista_negra != 1 && !indisponiveis.includes(s.id)); const opts = stalkersDisponiveis.map(s => `<option value="${s.id}">${s.codinome}</option>`).join(''); let acaoAdicionar = ""; if(stalkersDisponiveis.length > 0) { acaoAdicionar = `<div style="margin-top:10px; display:flex; gap:10px;"><select id="atribuir-${m.id}" style="flex:1"><option value="">-- Convidar para Missão --</option>${opts}</select><button onclick="atribuirMissao(${m.id})" style="width:auto; background:#3498db">Adicionar</button></div>`; } const btnEditar = isAdmin ? `<button onclick="prepararEdicaoMissao(${m.id})" style="background:#f39c12; width:auto; padding:5px 10px; font-size:0.8em; border-radius:4px;">✏️ Editar</button>` : ''; const btnEncerrar = isAdmin ? `<button onclick="encerrarMissaoGeral(${m.id})" style="background:#555; width:auto; padding:5px 10px; font-size:0.8em; border-radius:4px;">Encerrar Mural</button>` : ''; const btnApagar = isAdmin ? `<button onclick="excluirMissao(${m.id})" style="background:#c0392b; width:auto; padding:5px 10px; font-size:0.8em; border-radius:4px;">X Apagar</button>` : ''; let badgeTemp = m.temporaria ? `<span style="background:#e74c3c; color:#fff; padding:3px 8px; border-radius:3px; font-size:0.8em; font-weight:bold; animation: pulse 1.5s infinite; margin-left:10px;">⏳ URGENTE</span>` : ''; return `<div class="card" style="border-left:4px solid ${coresNivel[niv]}"><div style="display:flex; justify-content:space-between; align-items:flex-start;"><h4 style="margin: 0 0 10px 0;">${m.titulo} ${badgeTemp}</h4><div style="display:flex; gap:5px;">${btnEditar}${btnEncerrar}${btnApagar}</div></div><p style="margin-top:0;">${m.descricao}</p><div style="margin-bottom:10px; font-size:0.9em; color:#ddd;">Recompensa <b>individual</b>: ${recompensas.join(' | ')}</div>${equipeAtivaHTML}${equipeConcluidaHTML}${acaoAdicionar}</div>`; }).join(''); htmlDificuldade += `</div></details>`; return htmlDificuldade; }).join(''); mural.innerHTML = htmlGeral || "<p style='color:#7f8c8d;'>Nenhuma missão ativa no momento.</p>"; } } function prepararEdicaoMissao(id) { const m = window.missoesMural.find(x => x.id === id); if(!m) return; document.getElementById('editMissaoId').value = m.id; document.getElementById('qTitulo').value = m.titulo; document.getElementById('qDesc').value = m.descricao; document.getElementById('qRep').value = m.recompensa_rep; document.getElementById('qRu').value = m.recompensa_ru; document.getElementById('qItem').value = m.recompensa_item; document.getElementById('qDif').value = m.dificuldade || 'Fácil'; document.getElementById('qTemp').checked = m.temporaria ? true : false; document.getElementById('tituloFormMissao').innerText = "Editar Operação Oficial"; document.getElementById('btnSalvarMissao').innerText = "Salvar Alterações"; document.getElementById('btnCancelarMissao').style.display = "inline-block"; window.scrollTo(0,0); } function cancelarEdicaoMissao() { location.reload(); } async function salvarNovaMissao(e) { e.preventDefault(); const id = document.getElementById('editMissaoId').value; const body = { titulo: document.getElementById('qTitulo').value, descricao: document.getElementById('qDesc').value, recompensa_rep: parseInt(document.getElementById('qRep').value) || 0, recompensa_ru: parseFloat(document.getElementById('qRu').value) || 0, recompensa_item: document.getElementById('qItem').value || "", dificuldade: document.getElementById('qDif').value, temporaria: document.getElementById('qTemp').checked }; const url = id ? `/api/missoes/${id}` : '/api/missoes'; const method = id ? 'PUT' : 'POST'; try { const res = await fetch(url, { method: method, headers: {'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token')}, body: JSON.stringify(body) }); if(res.ok) { location.reload(); } else { alert("Apenas Diretores podem editar missões!"); } } catch (error) { alert("Erro de conexão."); } } async function atribuirMissao(id) { const sId = document.getElementById(`atribuir-${id}`).value; if(!sId) return alert("Selecione um stalker."); await fetch(`/api/missoes/${id}/atribuir`, { method: 'PUT', headers: {'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token')}, body: JSON.stringify({ stalker_id: sId }) }); location.reload(); } async function pagarStalkerIndividual(missaoId, stalkerId) { if(confirm("Confirmar pagamento na conta do agente?")) { try { const res = await fetch(`/api/missoes/${missaoId}/concluir_individual/${stalkerId}`, { method: 'POST', headers: {'Authorization': localStorage.getItem('stalker_token')} }); if(res.ok) location.reload(); else alert("Erro!"); } catch(e) { alert("Erro."); } } } async function abortarMissao(missaoId, stalkerId) { if(confirm("Remover da equipe sem ganhar recompensas?")) { try { const res = await fetch(`/api/missoes/${missaoId}/abortar/${stalkerId}`, { method: 'POST', headers: {'Authorization': localStorage.getItem('stalker_token')} }); if(res.ok) location.reload(); else alert("Erro!"); } catch(e) { alert("Erro."); } } } async function encerrarMissaoGeral(id) { if(confirm("Encerrar esta missão? Ela será fechada.")) { await fetch(`/api/missoes/${id}/encerrar_mural`, { method: 'POST', headers: {'Authorization': localStorage.getItem('stalker_token')} }); location.reload(); } } async function excluirMissao(id) { if(confirm("Deseja apagar permanentemente?")) { const res = await fetch(`/api/missoes/${id}`, { method: 'DELETE', headers: {'Authorization': localStorage.getItem('stalker_token')} }); if(res.ok) location.reload(); else alert("Apenas Administradores!"); } }

// ==========================================
// 11. RELATÓRIOS OFICIAIS E HISTÓRICO GERAL
// ==========================================
async function carregarRelatorios() { 
    try {
        const res = await fetch('/api/relatorios', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); 
        const rels = await res.json(); 
        window.relatoriosAtuais = rels; 
        const lista = document.getElementById('listaRelatorios'); 
        if(lista) { 
            if (rels.length === 0) {
                lista.innerHTML = "<p style='color:#778466; font-family: \"Share Tech Mono\", monospace;'>Nenhum registro encontrado no banco de dados.</p>";
                return;
            }
            lista.innerHTML = rels.map(r => `
            <div class="pda-ui" style="margin-bottom:15px; border-left: 4px solid #a5b396; padding: 15px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <strong style="color:#e67e22; font-size:1.1em;">ARQUIVO #${r.numero}</strong><br>
                        <small style="color:#778466;">AUTOR: ${r.autor} ${r.editado_por ? `(RETIFICADO POR: ${r.editado_por})` : ''}</small>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button onclick="abrirVisualizacaoRel(${r.id})" class="pda-btn" style="background:#2a3622 !important; border-color:#4a5c40 !important;">LER DADOS</button>
                        <button onclick="prepararEdicaoRel(${r.id})" class="pda-btn" style="background:#5e4a2b !important; border-color:#8a6a3b !important; color:#f39c12 !important;">EDITAR</button>
                        <button onclick="excluirRelatorio(${r.id})" class="pda-btn" style="background:#4a1e1e !important; border-color:#7a2e2e !important; color:#e74c3c !important;">EXCLUIR</button>
                    </div>
                </div>
            </div>`).join(''); 
        } 
    } catch(e) {
        console.error("Erro ao carregar relatorios", e);
        const lista = document.getElementById('listaRelatorios');
        if(lista) lista.innerHTML = `<p style="color:red">Erro de conexão: ${e.message}</p>`;
    }
} async function salvarRelatorio(e) { e.preventDefault(); const id = document.getElementById('editRelatorioId').value; const body = { numero: document.getElementById('rNum').value, autor: document.getElementById('rAutor').value, objetivo: document.getElementById('rObj').value, col1: document.getElementById('rCol1').value, col2: document.getElementById('rCol2').value, col3: document.getElementById('rCol3').value }; await fetch(id ? `/api/relatorios/${id}` : '/api/relatorios', { method: id ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json', 'Authorization': localStorage.getItem('stalker_token')}, body: JSON.stringify(body) }); location.reload(); } function prepararEdicaoRel(id) { const r = window.relatoriosAtuais.find(rel => rel.id === id); document.getElementById('editRelatorioId').value = r.id; document.getElementById('rNum').value = r.numero; document.getElementById('rAutor').value = r.autor; document.getElementById('rObj').value = r.objetivo; document.getElementById('rCol1').value = r.col1; document.getElementById('rCol2').value = r.col2; document.getElementById('rCol3').value = r.col3; document.getElementById('btnCancelarRel').style.display = "block"; window.scrollTo(0,0); } function cancelarEdicaoRelatorio() { location.reload(); } async function excluirRelatorio(id) { if(confirm("Excluir relatório?")) { await fetch(`/api/relatorios/${id}`, { method: 'DELETE', headers: {'Authorization': localStorage.getItem('stalker_token')} }); location.reload(); } } function abrirVisualizacaoRel(id) { const r = window.relatoriosAtuais.find(rel => rel.id === id); document.getElementById('painelGerenciamento').style.display = 'none'; document.getElementById('painelVisualizacao').style.display = 'block'; document.getElementById('vNum').innerText = r.numero; document.getElementById('vAutor').innerText = r.autor; document.getElementById('vObj').innerText = r.objetivo; document.getElementById('vCol1').innerText = r.col1; document.getElementById('vCol2').innerText = r.col2; document.getElementById('vCol3').innerText = r.col3; const c = document.getElementById('vCarimboEditado'); if(r.editado_por) { c.style.display = "block"; document.getElementById('vNomeEditor').innerText = r.editado_por; } else { c.style.display = "none"; } } function fecharRelatorio() { document.getElementById('painelGerenciamento').style.display = 'block'; document.getElementById('painelVisualizacao').style.display = 'none'; }

async function carregarLogs() { await carregarTaxas(); const urlParams = new URLSearchParams(window.location.search); const idFiltro = urlParams.get('id'); const dateInput = document.getElementById('filtroData') ? document.getElementById('filtroData').value : null; const resS = await fetch('/api/stalkers', { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); let stalkers = await resS.json(); const div = document.getElementById('logs'); if(!div) return; div.innerHTML = ''; if(idFiltro) { stalkers = stalkers.filter(s => s.id == idFiltro); div.innerHTML += `<a href="historico.html" style="color:var(--accent); display:inline-block; margin-bottom:15px; font-weight:bold; font-size:1.1em;">&larr; Voltar para Todos os Registros</a>`; } let encontrouRegistros = false; for(let s of stalkers) { const resH = await fetch(`/api/historico/${s.id}`, { headers: { 'Authorization': localStorage.getItem('stalker_token') } }); let logs = await resH.json(); if (dateInput) { const inputDate = new Date(dateInput + 'T12:00:00').toLocaleDateString(); logs = logs.filter(h => new Date(h.data.replace(' ', 'T') + 'Z').toLocaleDateString() === inputDate); } if(logs.length > 0) { encontrouRegistros = true; const info = getRepInfo(s.reputacao); div.innerHTML += `<details style="margin-bottom: 15px; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 5px;"><summary style="padding: 15px; font-size: 1.2em; font-weight: bold; color: ${info.cor}; cursor: pointer; border-bottom: 1px solid var(--border); outline: none;">📂 Dossiê: ${s.codinome} <span style="color:#7f8c8d; font-size:0.8em; font-weight:normal;">(${logs.length} ações)</span></summary><div style="padding: 15px; background: var(--bg);">${logs.map(h => `<div class="card" style="border-left: 4px solid ${h.alteracao >= 0 ? '#2ecc71' : '#e74c3c'}; padding:10px; margin-bottom:10px; background:rgba(30,33,36,0.5);"><div style="display:flex; justify-content:space-between; margin-bottom:5px;"><small style="color:#aaa;">📅 ${new Date(h.data.replace(' ', 'T') + 'Z').toLocaleString()}</small><b style="color:${h.alteracao >= 0 ? '#2ecc71' : '#e74c3c'}; font-size:1.1em;">${h.alteracao >= 0 ? '+' : ''}${h.alteracao} pts</b></div><div style="color:#ddd;">${h.motivo}</div></div>`).join('')}</div></details>`; } } if(!encontrouRegistros) { div.innerHTML += "<p style='color:#e74c3c; margin-top: 20px; font-size:1.1em; font-weight:bold;'>Nenhum registro encontrado no banco de dados.</p>"; } }
