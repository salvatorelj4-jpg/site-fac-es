/**
 * app.js - Main Client-side Core Logic
 * Multi-faction S.T.A.L.K.E.R. System
 */

// ==========================================
// 1. CONSTANTS & CONFIG
// ==========================================
const API = '';
const TOKEN_KEY = 'stalker_token';
const USER_KEY = 'stalker_user';

// ==========================================
// 2. AUTH UTILITIES
// ==========================================

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

function getUser() {
  const userStr = localStorage.getItem(USER_KEY);
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    console.error('Error parsing user data:', e);
    return null;
  }
}

function isLoggedIn() {
  return !!getToken();
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.clear();
  window.location.href = '/login.html';
}

function saveAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch(e) {
    return null;
  }
}

function checkAuth(requireRole = null) {
  const token = getToken();
  if (!token) {
    window.location.href = '/login.html';
    return null;
  }

  const user = getUser();
  if (!user) {
    logout();
    return null;
  }
  
  if (requireRole && user.role !== requireRole && user.role !== 'super_admin') {
     window.location.href = '/unauthorized.html';
     return null;
  }

  applyTheme(user.factionSlug || 'default');
  injectNav(window.location.pathname);
  
  return user;
}

// ==========================================
// 3. API HELPER & FETCH INTERCEPTOR
// ==========================================

const originalFetch = window.fetch;
window.fetch = async function() {
    let [resource, config] = arguments;
    if (typeof resource === 'string' && resource.startsWith('/api/')) {
        const user = getUser();
        const context = localStorage.getItem('super_admin_context');
        if (user && user.role === 'super_admin' && context) {
            const sep = resource.includes('?') ? '&' : '?';
            resource += `${sep}faction_id=${context}`;
            arguments[0] = resource;
        }
    }
    return originalFetch.apply(this, arguments);
};

async function api(endpoint, options = {}) {
  let url = API + endpoint;
  
  const headers = {
    ...options.headers
  };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const config = {
    ...options,
    headers
  };

  try {
    const response = await fetch(url, config);
    
    if (response.status === 401) {
      showError('Sessão expirada. Faça login novamente.');
      setTimeout(logout, 2000);
      return null;
    }

    const contentType = response.headers.get("content-type");
    let data;
    if (contentType && contentType.indexOf("application/json") !== -1) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw new Error(data.message || data.error || data || 'Erro na requisição');
    }

    return data;
  } catch (error) {
    showError(error.message);
    throw error;
  }
}

async function apiForm(endpoint, formData, method = 'POST') {
  let url = API + endpoint;
  
  const headers = {};

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const config = {
    method,
    headers,
    body: formData
  };

  try {
    const response = await fetch(url, config);
    
    if (response.status === 401) {
      showError('Sessão expirada. Faça login novamente.');
      setTimeout(logout, 2000);
      return null;
    }

    let data;
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      throw new Error(data.message || data.error || data || 'Erro na requisição');
    }

    return data;
  } catch (error) {
    showError(error.message);
    throw error;
  }
}


// ==========================================
// 4. THEME SYSTEM
// ==========================================

function applyTheme(factionSlug) {
  const body = document.body;
  body.className = body.className.replace(/\btheme-\S+/g, '');
  
  if (factionSlug) {
    body.classList.add(`theme-${factionSlug}`);
  }

  const themeColors = {
    'ecologists': '#00bfa5',
    'duty': '#d50000',
    'bandits': '#6d4c41',
    'freedom': '#64dd17',
    'mercenaries': '#2962ff',
    'clear_sky': '#00b0ff'
  };

  const color = themeColors[factionSlug] || '#333333';
  let metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!metaTheme) {
    metaTheme = document.createElement('meta');
    metaTheme.name = 'theme-color';
    document.head.appendChild(metaTheme);
  }
  metaTheme.content = color;
}

function getThemeClass(slug) {
  return `theme-${slug}`;
}

// ==========================================
// 5. NAVIGATION
// ==========================================

function buildNav(currentPage) {
  const user = getUser();
  if (!user) return '';

  let links = [];
  const faction = user.factionSlug;
  const role = user.role;

  if (role === 'super_admin') {
    const currentCtx = localStorage.getItem('super_admin_context') || '';
    links = [];
    
    if (currentCtx === '') {
        links.push({ name: 'Painel Admin', url: '/admin.html' });
    }
    
    links.push(
      { name: 'Stalkers', url: '/stalkers.html' },
      { name: 'Missões', url: '/missoes.html' },
      { name: 'Itens', url: '/itens.html' },
      { name: 'Estoque', url: '/estoque.html' },
      { name: 'Relatórios', url: '/relatorios.html' },
      { name: 'Lista Negra', url: '/listanegra.html' }
    );
    if (currentCtx === '2' || currentCtx === '') {
        links.push({ name: 'Enciclopédia', url: '/enciclopedia.html' });
    }
    if (currentCtx === '5' || currentCtx === '') {
        links.push({ name: 'Contratos', url: '/contratos.html' });
    }
    links.push({ name: 'Caixa', url: '/banco.html' });
  } else {
    if (faction === 'ecologists') {
      links = [
        { name: 'Painel', url: '/dashboard.html' },
        { name: 'Caixa', url: '/banco.html' },
        { name: 'Stalkers', url: '/stalkers.html' },
        { name: 'Comércio', url: '/trade.html' },
        { name: 'Estoque', url: '/estoque.html' },
        { name: 'Pesquisa', url: '/research.html' },
        { name: 'Relatórios', url: '/relatorios.html' },
        { name: 'Histórico', url: '/historico.html' },
        { name: 'Missões', url: '/missoes.html' },
        { name: 'Lista Negra', url: '/listanegra.html' }
      ];
    } else if (faction === 'duty') {
      links = [
        { name: 'Painel', url: '/dashboard.html' },
        { name: 'Caixa', url: '/banco.html' },
        { name: 'Operadores', url: '/operators.html' },
        { name: 'Missões', url: '/missoes.html' },
        { name: 'Arsenal', url: '/arsenal.html' },
        { name: 'Relatórios', url: '/relatorios.html' },
        { name: 'Inteligência', url: '/intel.html' },
        { name: 'Logs', url: '/logs.html' }
      ];
    } else if (faction === 'bandits') {
      links = [
        { name: 'Painel', url: '/dashboard.html' },
        { name: 'Caixa', url: '/banco.html' },
        { name: 'Membros', url: '/membros.html' },
        { name: 'Negócios', url: '/business.html' },
        { name: 'Territórios', url: '/territory.html' },
        { name: 'Informações', url: '/info.html' },
        { name: 'Registros', url: '/records.html' }
      ];
    } else if (faction === 'freedom') {
      links = [
        { name: 'Painel', url: '/dashboard.html' },
        { name: 'Caixa', url: '/banco.html' },
        { name: 'Membros', url: '/membros.html' },
        { name: 'Postos', url: '/outposts.html' },
        { name: 'Missões', url: '/missoes.html' },
        { name: 'Suprimentos', url: '/supplies.html' },
        { name: 'Intel', url: '/intel.html' },
        { name: 'Comunicações', url: '/comms.html' }
      ];
    } else if (faction === 'mercenaries') {
      links = [
        { name: 'Painel', url: '/dashboard.html' },
        { name: 'Caixa', url: '/banco.html' },
        { name: 'Contratos', url: '/contratos.html' },
        { name: 'Operadores', url: '/operators.html' },
        { name: 'Clientes', url: '/clients.html' },
        { name: 'Operações', url: '/operations.html' },
        { name: 'Inteligência', url: '/intel.html' },
        { name: 'Arquivo', url: '/archive.html' }
      ];
    } else {
        links = [
            { name: 'Painel', url: '/dashboard.html' }
        ];
    }

    if (role === 'admin' || role === 'faction_admin') {
      links.push({ name: 'Equipe', url: '/team.html' });
    }
  }

  let navHtml = `<div class="nav-brand"><span class="faction-logo ${faction}"></span> <span class="username">${escapeHtml(user.username)}</span>`;
  
  if (role === 'super_admin') {
      const currentCtx = localStorage.getItem('super_admin_context') || '';
      navHtml += `<select onchange="localStorage.setItem('super_admin_context', this.value); window.location.reload();" style="margin-left:15px; padding:2px; font-size:12px; background:#111; color:#fff; border:1px solid #444;">
          <option value="">🌍 Visão Global</option>
          <option value="1" ${currentCtx === '1' ? 'selected' : ''}>Duty</option>
          <option value="2" ${currentCtx === '2' ? 'selected' : ''}>Ecologistas</option>
          <option value="3" ${currentCtx === '3' ? 'selected' : ''}>Bandidos</option>
          <option value="4" ${currentCtx === '4' ? 'selected' : ''}>Freedom</option>
          <option value="5" ${currentCtx === '5' ? 'selected' : ''}>Mercenários</option>
      </select>`;
  }
  
  navHtml += `</div><ul class="nav-links" style="list-style:none; display:flex; align-items:center; gap:20px; margin:0; padding:0;">`;
  
  links.forEach(link => {
    const activeClass = currentPage === link.url ? 'active' : '';
    navHtml += `<li><a href="${link.url}" class="${activeClass}">${link.name}</a></li>`;
  });

  navHtml += `<li><a href="#" onclick="logout(); return false;" class="logout-btn">Sair</a></li>`;
  navHtml += `</ul>`;

  return navHtml;
}

function injectNav(currentPage) {
  const navEl = document.querySelector('nav');
  if (navEl) {
    navEl.innerHTML = buildNav(currentPage);
  }
}

// ==========================================
// 6. NOTIFICATIONS
// ==========================================

function showNotification(message, type = 'info') {
  let container = document.getElementById('notification-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notification-container';
    document.body.appendChild(container);
  }

  const notif = document.createElement('div');
  notif.className = `notification notif-${type}`;
  notif.innerHTML = `<span>${escapeHtml(message)}</span>`;
  
  container.appendChild(notif);

  // Trigger animation
  setTimeout(() => notif.classList.add('show'), 10);

  setTimeout(() => {
    notif.classList.remove('show');
    setTimeout(() => notif.remove(), 300);
  }, 4000);
}

function showError(message) {
  showNotification(message, 'error');
}

function showSuccess(message) {
  showNotification(message, 'success');
}

// ==========================================
// 7. SOUND EFFECTS
// ==========================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playBeep(freq, type, duration, vol) {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  oscillator.type = type;
  oscillator.frequency.value = freq;
  
  gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.start();
  oscillator.stop(audioCtx.currentTime + duration);
}

document.addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A' || e.target.closest('.clickable')) {
      playBeep(400, 'square', 0.05, 0.02);
  }
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Alt') {
        // Subtle key click
        playBeep(800, 'sine', 0.02, 0.005);
    }
});


// ==========================================
// 8. BOOT SEQUENCE
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
    if (isLoggedIn() && !sessionStorage.getItem('bootPlayed')) {
        const loader = document.createElement('div');
        loader.id = 'boot-loader';
        loader.innerHTML = `
            <div class="terminal-text">
                <p>INICIANDO SISTEMA OPERACIONAL V.4.0</p>
                <p id="boot-msg-1"></p>
                <p id="boot-msg-2"></p>
                <p id="boot-msg-3"></p>
                <div class="spinner"></div>
            </div>
        `;
        document.body.appendChild(loader);

        setTimeout(() => { document.getElementById('boot-msg-1').innerText = '> Carregando módulos...'; playBeep(300, 'square', 0.1, 0.05); }, 500);
        setTimeout(() => { document.getElementById('boot-msg-2').innerText = '> Estabelecendo conexão segura...'; playBeep(400, 'square', 0.1, 0.05); }, 1200);
        setTimeout(() => { document.getElementById('boot-msg-3').innerText = '> Acesso concedido. Bem-vindo.'; playBeep(600, 'square', 0.2, 0.05); }, 2200);
        
        setTimeout(() => {
            loader.style.opacity = '0';
            setTimeout(() => loader.remove(), 500);
        }, 3600);

        sessionStorage.setItem('bootPlayed', 'true');
    }
});

// ==========================================
// 9. UTILITY FUNCTIONS
// ==========================================

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString();
}

function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

function nomeNivelItem(nivel) {
  const niveis = {
    1: 'Básico',
    2: 'Avançado',
    3: 'Elite',
    4: 'Lendário'
  };
  return niveis[nivel] || `Nível ${nivel}`;
}

// ==========================================
// 10. TRADE/ECONOMY SYSTEM
// ==========================================

let taxasComercio = [];

async function carregarTaxas() {
  try {
    const data = await api('/rates');
    taxasComercio = data || [];
  } catch (err) {
    console.error('Erro ao carregar taxas', err);
  }
}

function getRepInfo(val) {
  if (val >= 1000) return { tier: 'Lenda', color: '#ffd700' };
  if (val >= 500) return { tier: 'Veterano', color: '#ff8c00' };
  if (val >= 250) return { tier: 'Experiente', color: '#00fa9a' };
  if (val >= 0) return { tier: 'Novato', color: '#f8f8ff' };
  return { tier: 'Hostil', color: '#ff0000' };
}

// ==========================================
// 11. MERCENARY PUBLIC FUNCTIONS
// ==========================================

async function submitContract(formData) {
  try {
    const data = await api('/public/contracts', {
      method: 'POST',
      body: formData
    });
    showSuccess(`Contrato enviado. Código: ${data.code || data.id}`);
    return data;
  } catch (error) {
    console.error('Submit contract error', error);
    throw error;
  }
}

// ==========================================
// 12. DASHBOARD FUNCTIONS
// ==========================================

async function loadDashboard() {
  try {
    const stats = await api('/dashboard/stats');
    // populate dashboard UI
    const container = document.getElementById('dashboard-stats');
    if (container && stats) {
        container.innerHTML = `
            <div class="stat-card">
                <h3>Membros Ativos</h3>
                <p>${stats.activeMembers || 0}</p>
            </div>
            <div class="stat-card">
                <h3>Missões</h3>
                <p>${stats.missions || 0}</p>
            </div>
            <div class="stat-card">
                <h3>Recursos</h3>
                <p>${stats.resources || 0}</p>
            </div>
        `;
    }
  } catch (error) {
    console.error('Error loading dashboard', error);
  }
}

// ==========================================
// 13. CONTRACT MANAGEMENT
// ==========================================

async function loadContracts() {
  try {
    const contracts = await api('/contracts');
    const list = document.getElementById('contracts-list');
    if (list) {
      list.innerHTML = contracts.map(renderContractCard).join('');
    }
  } catch (error) {
    console.error('Error loading contracts', error);
  }
}

async function loadContract(id) {
  try {
    const contract = await api(`/contracts/${id}`);
    return contract;
  } catch (error) {
    console.error('Error loading contract details', error);
    throw error;
  }
}

async function updateContractStatus(id, status) {
  try {
    await api(`/contracts/${id}/status`, {
      method: 'PUT',
      body: { status }
    });
    showSuccess('Status atualizado');
  } catch (error) {
    console.error('Error updating status', error);
  }
}

async function addContractNote(id, message) {
  try {
    await api(`/contracts/${id}/notes`, {
      method: 'POST',
      body: { message }
    });
    showSuccess('Nota adicionada');
  } catch (error) {
    console.error('Error adding note', error);
  }
}

function renderContractCard(contract) {
  return `
    <div class="contract-card">
      <div class="contract-header">
        <h4>${escapeHtml(contract.title)}</h4>
        ${renderStatusBadge(contract.status)}
      </div>
      <div class="contract-body">
        <p>${escapeHtml(contract.description)}</p>
        <small>Cliente: ${escapeHtml(contract.clientName)}</small>
      </div>
      <div class="contract-footer">
        <button onclick="loadContract('${contract.id}')">Ver Detalhes</button>
      </div>
    </div>
  `;
}

function renderStatusBadge(status) {
  const statusMap = {
    'pending': { label: 'Pendente', class: 'badge-pending' },
    'active': { label: 'Ativo', class: 'badge-active' },
    'completed': { label: 'Concluído', class: 'badge-completed' },
    'cancelled': { label: 'Cancelado', class: 'badge-cancelled' }
  };
  const s = statusMap[status] || { label: status, class: 'badge-default' };
  return `<span class="badge ${s.class}">${s.label}</span>`;
}


// ==========================================
// 14. SUPER ADMIN FUNCTIONS
// ==========================================

async function loadFactions() {
  try {
    return await api('/admin/factions');
  } catch (error) {
    console.error('Error loading factions', error);
    return [];
  }
}

async function toggleFaction(id) {
  try {
    await api(`/admin/factions/${id}/toggle`, { method: 'POST' });
    showSuccess('Status da facção alterado');
  } catch (error) {
    console.error('Error toggling faction', error);
  }
}

async function loadAdminOverview() {
  try {
    return await api('/admin/overview');
  } catch (error) {
    console.error('Error loading admin overview', error);
    return null;
  }
}

async function loadAuditLog() {
  try {
    return await api('/admin/audit');
  } catch (error) {
    console.error('Error loading audit log', error);
    return [];
  }
}

async function loadUsers() {
  try {
    return await api('/admin/users');
  } catch (error) {
    console.error('Error loading users', error);
    return [];
  }
}

async function createUser(data) {
  try {
    const user = await api('/admin/users', {
      method: 'POST',
      body: data
    });
    showSuccess('Usuário criado');
    return user;
  } catch (error) {
    console.error('Error creating user', error);
    throw error;
  }
}

async function updateUser(id, data) {
  try {
    const user = await api(`/admin/users/${id}`, {
      method: 'PUT',
      body: data
    });
    showSuccess('Usuário atualizado');
    return user;
  } catch (error) {
    console.error('Error updating user', error);
    throw error;
  }
}
