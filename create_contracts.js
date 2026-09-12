const fs = require('fs');

// 1. PUBLIC CONTRACT FORM (contratar.html)
const contratarHTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="style.css">
    <title>Solicitar Trabalho - Sindicato Mercenário</title>
</head>
<body style="background-image: none !important; background-color: #050607 !important;">
    <div class="container" style="max-width: 800px; margin-top: 50px;">
        <div class="pda-ui" style="border-color: #3498db; box-shadow: inset 0 0 50px rgba(52, 152, 219, 0.2);">
            <div style="text-align:center; margin-bottom: 30px; border-bottom: 2px solid #3498db; padding-bottom: 20px;">
                <h1 style="color: #3498db; margin: 0; font-size: 2em; letter-spacing: 2px;">SINDICATO MERCENÁRIO</h1>
                <p style="color: #7f8c8d; margin-top: 5px;">TERMINAL DE SOLICITAÇÃO DE SERVIÇOS (REDE SEGURA)</p>
            </div>
            
            <div id="sucesso-msg" style="display:none; text-align:center; padding: 40px; background: rgba(46, 204, 113, 0.1); border: 1px solid #2ecc71; border-radius: 2px;">
                <h2 style="color: #2ecc71;">SOLICITAÇÃO RECEBIDA.</h2>
                <p style="color: #a5b396;">SEU CÓDIGO DE RASTREIO É: <strong id="cod-rastreio" style="color: #fff; font-size: 1.2em;"></strong></p>
                <p style="color: #7f8c8d; margin-top: 20px;">AGUARDE O CONTATO DE UM OPERADOR DO SINDICATO.</p>
                <button onclick="location.reload()" class="pda-btn" style="margin-top:20px; background: #2c3e50 !important; border-color: #3498db !important;">NOVA SOLICITAÇÃO</button>
            </div>

            <form id="contractForm" onsubmit="enviarContrato(event)">
                <!-- Anti-spam honeypot -->
                <input type="text" name="honeypot" style="display:none;">

                <div class="pda-grid" style="margin-bottom: 20px;">
                    <div class="pda-input-group">
                        <label style="color: #3498db;">SEU NOME / ALCUNHA *</label>
                        <input type="text" name="clientName" required style="border-color: #2c3e50; color: #fff;">
                    </div>
                    <div class="pda-input-group">
                        <label style="color: #3498db;">MEIO DE CONTATO (PDA / Rádio)</label>
                        <input type="text" name="contact" style="border-color: #2c3e50; color: #fff;">
                    </div>
                </div>

                <div class="pda-grid" style="margin-bottom: 20px;">
                    <div class="pda-input-group">
                        <label style="color: #3498db;">TIPO DE MISSÃO</label>
                        <select name="missionType" style="border-color: #2c3e50; background: #0f1011; color: #fff; padding: 12px; font-family: 'Share Tech Mono', monospace;">
                            <option value="Proteção/Escolta">Proteção/Escolta</option>
                            <option value="Eliminação">Eliminação / Caça</option>
                            <option value="Busca e Recuperação">Busca e Recuperação</option>
                            <option value="Reconhecimento">Reconhecimento de Área</option>
                            <option value="Outro">Outro (Especificar)</option>
                        </select>
                    </div>
                    <div class="pda-input-group">
                        <label style="color: #3498db;">LOCALIZAÇÃO/SETOR</label>
                        <input type="text" name="location" placeholder="Ex: Cordon, Rostok, etc." style="border-color: #2c3e50; color: #fff;">
                    </div>
                </div>

                <div class="pda-input-group" style="margin-bottom: 20px;">
                    <label style="color: #3498db;">ALVO / OBJETIVO PRINCIPAL</label>
                    <input type="text" name="target" placeholder="Quem ou o que é o alvo?" style="border-color: #2c3e50; color: #fff;">
                </div>

                <div class="pda-input-group" style="margin-bottom: 20px;">
                    <label style="color: #3498db;">DESCRIÇÃO DETALHADA DO TRABALHO</label>
                    <textarea name="description" rows="5" style="border-color: #2c3e50; background: #0f1011; color: #fff; padding: 12px; font-family: 'Share Tech Mono', monospace;"></textarea>
                </div>

                <div class="pda-grid" style="margin-bottom: 20px;">
                    <div class="pda-input-group">
                        <label style="color: #3498db;">RECOMPENSA OFERECIDA (RU / Artefatos)</label>
                        <input type="text" name="reward" style="border-color: #2c3e50; color: #fff;">
                    </div>
                    <div class="pda-input-group">
                        <label style="color: #e74c3c;">NÍVEL DE RISCO ESTIMADO</label>
                        <select name="riskLevel" style="border-color: #c0392b; background: #0f1011; color: #e74c3c; padding: 12px; font-family: 'Share Tech Mono', monospace;">
                            <option value="low">Baixo (Mínima resistência)</option>
                            <option value="medium">Médio (Ameaças comuns)</option>
                            <option value="high">Alto (Mutantes pesados/Esquadrões)</option>
                            <option value="extreme">Extremo (Garantia de Morte)</option>
                        </select>
                    </div>
                </div>

                <button type="submit" class="pda-btn" style="width: 100% !important; font-size: 1.2em; padding: 15px !important; background: #1a252f !important; border-color: #3498db !important; color: #3498db !important;">ENVIAR TRANSMISSÃO ENCRIPTADA</button>
            </form>
        </div>
    </div>
    
    <script>
        async function enviarContrato(e) {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            try {
                const btn = e.target.querySelector('button');
                btn.innerText = "TRANSMITINDO...";
                btn.disabled = true;

                const res = await fetch('/api/public/contracts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await res.json();
                if(res.ok && result.success) {
                    document.getElementById('contractForm').style.display = 'none';
                    document.getElementById('sucesso-msg').style.display = 'block';
                    document.getElementById('cod-rastreio').innerText = result.code || "REGISTRADO";
                } else {
                    alert('Falha na transmissão.');
                    btn.innerText = "TENTAR NOVAMENTE";
                    btn.disabled = false;
                }
            } catch(err) {
                alert('Erro de conexão com a rede Merc.');
            }
        }
    </script>
</body>
</html>`;

// 2. INTERNAL CONTRACTS PAGE (contratos.html)
const contratosHTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="style.css">
    <title>Painel de Contratos</title>
</head>
<body onload="checkAuth('operator'); carregarPainelContratos()">
    <nav id="mainNav"></nav>

    <div class="container">
        <h2 style="color: #3498db; border-bottom: 2px solid #2c3e50; padding-bottom: 10px; margin-bottom: 30px;">
            TERMINAL DE CONTRATOS ATIVOS
        </h2>
        
        <div id="listaContratos">Carregando dados da rede...</div>
    </div>

    <script src="app.js"></script>
    <script>
        async function carregarPainelContratos() {
            try {
                const res = await fetch('/api/contracts', {
                    headers: { 'Authorization': localStorage.getItem('stalker_token') }
                });
                
                if (!res.ok) {
                    document.getElementById('listaContratos').innerHTML = "<p style='color:red;'>Acesso Negado ou Falha de Conexão.</p>";
                    return;
                }
                
                const contratos = await res.json();
                const div = document.getElementById('listaContratos');
                
                if (contratos.length === 0) {
                    div.innerHTML = "<p style='color:#7f8c8d;'>Nenhum contrato pendente no sistema.</p>";
                    return;
                }
                
                div.innerHTML = contratos.reverse().map(c => {
                    let statusColor = '#3498db';
                    if(c.status === 'ACCEPTED') statusColor = '#f39c12';
                    if(c.status === 'COMPLETED') statusColor = '#2ecc71';
                    if(c.status === 'FAILED') statusColor = '#e74c3c';
                    
                    return \`
                    <div class="pda-ui" style="margin-bottom: 20px; border-left: 4px solid \${statusColor};">
                        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                            <div>
                                <h3 style="margin:0 0 5px 0; color:\${statusColor};">\${c.public_code} - \${c.mission_type || 'Misteriosa'}</h3>
                                <p style="margin:0 0 10px 0; color:#aaa;">Cliente: \${c.client_name} | Local: \${c.location || 'N/A'}</p>
                                <p style="margin:0 0 5px 0; color:#ddd;"><strong>Alvo/Objetivo:</strong> \${c.target || c.objective}</p>
                                <p style="margin:0 0 10px 0; color:#aaa;">\${c.description}</p>
                                <div style="display:flex; gap:15px; font-size: 0.9em;">
                                    <span style="color:#e67e22;">Recompensa: \${c.reward || 'A Negociar'}</span>
                                    <span style="color:#e74c3c;">Risco: \${c.risk_level || 'N/A'}</span>
                                    <span style="color:#2ecc71;">Data: \${new Date(c.created_at).toLocaleString()}</span>
                                </div>
                            </div>
                            <div style="display:flex; flex-direction:column; gap:10px;">
                                <select onchange="atualizarStatusContrato(\${c.id}, this.value)" style="background:#0f1011; color:\${statusColor}; border-color:\${statusColor}; padding:8px;">
                                    <option value="NEW" \${c.status === 'NEW' ? 'selected' : ''}>NOVO</option>
                                    <option value="ACCEPTED" \${c.status === 'ACCEPTED' ? 'selected' : ''}>ACEITO (EM ANDAMENTO)</option>
                                    <option value="COMPLETED" \${c.status === 'COMPLETED' ? 'selected' : ''}>CONCLUÍDO</option>
                                    <option value="FAILED" \${c.status === 'FAILED' ? 'selected' : ''}>FALHOU / ABORTADO</option>
                                </select>
                            </div>
                        </div>
                    </div>\`;
                }).join('');
            } catch(e) {
                console.error(e);
            }
        }
        
        async function atualizarStatusContrato(id, novoStatus) {
            if(confirm("Confirmar atualização do contrato?")) {
                await fetch(\`/api/contracts/\${id}/status\`, {
                    method: 'PUT',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': localStorage.getItem('stalker_token')
                    },
                    body: JSON.stringify({ status: novoStatus })
                });
                location.reload();
            } else {
                location.reload(); // reset select
            }
        }
    </script>
</body>
</html>`;

fs.writeFileSync('public/contratar.html', contratarHTML);
fs.writeFileSync('public/contratos.html', contratosHTML);
console.log("Arquivos de contrato gerados com sucesso.");
