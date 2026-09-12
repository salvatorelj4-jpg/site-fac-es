const fs = require('fs');

const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sindicato Mercenário - Terminal de Serviço</title>
    <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: #030508;
            background-image: 
                linear-gradient(rgba(10, 20, 30, 0.2) 1px, transparent 1px),
                linear-gradient(90deg, rgba(10, 20, 30, 0.2) 1px, transparent 1px);
            background-size: 20px 20px;
            font-family: 'Share Tech Mono', monospace;
            color: #58a6ff;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        /* HUD Superior */
        .hud-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 30px;
            font-size: 0.85em;
            color: #4a6b8c;
            border-bottom: 1px solid #101d2b;
            background: linear-gradient(180deg, rgba(5,10,15,0.9) 0%, rgba(3,5,8,0) 100%);
            letter-spacing: 2px;
        }
        .hud-header span.online { color: #58a6ff; }
        .hud-header span.online::before {
            content: '●';
            color: #58a6ff;
            text-shadow: 0 0 8px #58a6ff;
            margin-right: 8px;
        }

        /* Layout Principal */
        .main-wrapper {
            display: flex;
            gap: 30px;
            padding: 30px;
            flex: 1;
            max-width: 1400px;
            margin: 0 auto;
            width: 100%;
        }

        /* Paineis estilo Sci-Fi */
        .panel {
            background: rgba(10, 15, 22, 0.85);
            border: 1px solid #1a2c3a;
            box-shadow: 0 0 30px rgba(0,0,0,0.8), inset 0 0 20px rgba(26, 44, 58, 0.2);
            border-radius: 4px;
            position: relative;
        }
        .panel::before, .panel::after {
            content: ''; position: absolute; width: 10px; height: 10px; border: 1px solid #58a6ff;
        }
        .panel::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
        .panel::after { bottom: -1px; right: -1px; border-left: none; border-top: none; }

        /* Coluna Esquerda: Formulário */
        .form-col {
            flex: 1;
            padding: 40px;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
        }

        .header-title {
            display: flex;
            align-items: center;
            gap: 20px;
            margin-bottom: 40px;
            border-bottom: 1px solid #1a2c3a;
            padding-bottom: 20px;
        }
        .header-title img { width: 60px; filter: drop-shadow(0 0 5px rgba(88, 166, 255, 0.5)); opacity: 0.8; }
        .header-title h1 {
            color: #58a6ff;
            font-size: 2.2em;
            letter-spacing: 3px;
            margin-bottom: 5px;
            text-shadow: 0 0 10px rgba(88,166,255,0.3);
        }
        .header-title p { color: #4a6b8c; font-size: 0.9em; letter-spacing: 1px; }

        .input-row { display: flex; gap: 30px; margin-bottom: 25px; }
        .input-group { flex: 1; display: flex; flex-direction: column; gap: 8px; }
        
        .input-group label {
            color: #58a6ff;
            font-size: 0.85em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .input-group input, .input-group select, .input-group textarea {
            background: #080c10;
            border: 1px solid #1a2c3a;
            color: #7f9ab5;
            padding: 12px 15px;
            font-family: 'Share Tech Mono', monospace;
            font-size: 1em;
            border-radius: 2px;
            outline: none;
            transition: all 0.3s;
        }
        .input-group input:focus, .input-group select:focus, .input-group textarea:focus {
            border-color: #58a6ff;
            box-shadow: 0 0 10px rgba(88, 166, 255, 0.2);
            color: #fff;
        }

        /* Botão Principal */
        .cyber-btn {
            background: linear-gradient(90deg, rgba(16,33,48,0.9) 0%, rgba(26,53,78,0.9) 50%, rgba(16,33,48,0.9) 100%);
            border: 1px solid #3a6b9c;
            color: #58a6ff;
            padding: 20px;
            font-family: 'Share Tech Mono', monospace;
            font-size: 1.2em;
            text-transform: uppercase;
            letter-spacing: 2px;
            cursor: pointer;
            position: relative;
            box-shadow: inset 0 0 15px rgba(88,166,255,0.2);
            transition: all 0.3s;
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 15px;
            text-decoration: none;
            border-radius: 4px;
        }
        .cyber-btn:hover {
            background: rgba(36, 73, 108, 0.9);
            color: #fff;
            box-shadow: inset 0 0 20px rgba(88,166,255,0.5), 0 0 15px rgba(88,166,255,0.3);
            border-color: #58a6ff;
        }

        /* Coluna Direita: Sidebar */
        .sidebar-col {
            width: 350px;
            padding: 30px;
            display: flex;
            flex-direction: column;
            gap: 30px;
        }

        .login-box {
            text-align: center;
            border-bottom: 1px solid #1a2c3a;
            padding-bottom: 30px;
        }
        .login-box h3 {
            color: #58a6ff;
            font-size: 1.2em;
            margin-bottom: 20px;
            letter-spacing: 1.5px;
            font-weight: normal;
        }
        .icon-box {
            font-size: 40px;
            color: #2a4b6c;
            margin-bottom: 20px;
            position: relative;
            display: inline-block;
        }
        .icon-box::before, .icon-box::after {
            content: ''; position: absolute; width: 15px; height: 15px; border: 1px solid #3a6b9c;
        }
        .icon-box::before { top: -10px; left: -10px; border-right: none; border-bottom: none; }
        .icon-box::after { bottom: -10px; right: -10px; border-left: none; border-top: none; }
        
        .login-box p {
            color: #4a6b8c;
            font-size: 0.85em;
            line-height: 1.5;
            margin-bottom: 25px;
        }

        .network-info {
            text-align: center;
            color: #3a5b7c;
            font-size: 0.85em;
            line-height: 1.8;
            margin-top: auto;
        }

        /* Mensagem Sucesso */
        #sucesso-msg {
            text-align: center;
            padding: 80px 40px;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }

        /* Scrollbar customizada */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #050a0f; border-left: 1px solid #1a2c3a; }
        ::-webkit-scrollbar-thumb { background: #1a2c3a; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a6b9c; }
    </style>
</head>
<body>

    <!-- CABEÇALHO HUD -->
    <div class="hud-header">
        <span class="online">REDE SEGURA: ONLINE &nbsp; ▃▆▇</span>
        <span>TERMINAL MERCENÁRIO v2.4.7</span>
        <span>ENCRYPT: AES-256 🔒</span>
    </div>

    <!-- ÁREA PRINCIPAL -->
    <div class="main-wrapper">
        
        <!-- ESQUERDA: FORMULÁRIO -->
        <div class="panel form-col">
            <div class="header-title">
                <!-- Ícone simulado usando texto (caveira) -->
                <div style="font-size: 45px; color: #3a6b9c; border-right: 1px solid #1a2c3a; padding-right: 20px;">☠️</div>
                <div>
                    <h1>SINDICATO MERCENÁRIO</h1>
                    <p>TERMINAL DE SOLICITAÇÃO DE SERVIÇOS (REDE SEGURA)</p>
                </div>
            </div>

            <!-- TELA DE SUCESSO -->
            <div id="sucesso-msg" style="display:none;">
                <h2 style="color: #2ecc71; font-size: 2em; margin-bottom: 10px;">TRANSMISSÃO CONCLUÍDA</h2>
                <p style="color: #4a6b8c; margin-bottom: 30px;">DADOS CRIPTOGRAFADOS E ENVIADOS AO SINDICATO.</p>
                
                <div style="background: rgba(46, 204, 113, 0.1); border: 1px solid #2ecc71; padding: 20px; width: 100%; max-width: 400px; margin-bottom: 40px;">
                    <span style="color:#2ecc71; font-size: 0.8em; text-transform:uppercase;">CÓDIGO DE RASTREIO ALOCADO:</span><br>
                    <strong id="cod-rastreio" style="color: #fff; font-size: 1.8em; letter-spacing: 4px;"></strong>
                </div>

                <a href="/contratar.html" class="cyber-btn" style="width:100%; max-width:400px; font-size: 1em; padding: 15px;">NOVA SOLICITAÇÃO</a>
            </div>

            <!-- FORMULÁRIO DE CONTRATO -->
            <form id="contractForm" onsubmit="enviarContrato(event)">
                <input type="text" name="honeypot" style="display:none;">

                <div class="input-row">
                    <div class="input-group">
                        <label>SEU NOME / ALCUNHA *</label>
                        <input type="text" name="clientName" placeholder="Digite seu nome ou alcunha" required>
                    </div>
                    <div class="input-group">
                        <label>MEIO DE CONTATO (PDA / RÁDIO)</label>
                        <input type="text" name="contact" placeholder="Ex: Canal 12, Frequência 88.3, etc.">
                    </div>
                </div>

                <div class="input-row">
                    <div class="input-group">
                        <label>TIPO DE MISSÃO</label>
                        <select name="missionType">
                            <option value="Proteção/Escolta">Proteção/Escolta</option>
                            <option value="Eliminação">Eliminação / Caça</option>
                            <option value="Busca e Recuperação">Busca e Recuperação</option>
                            <option value="Reconhecimento">Reconhecimento de Área</option>
                            <option value="Outro">Outro (Especificar)</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>LOCALIZAÇÃO / SETOR</label>
                        <input type="text" name="location" placeholder="Ex: Cordon, Rostok, etc.">
                    </div>
                </div>

                <div class="input-group" style="margin-bottom: 25px;">
                    <label>ALVO / OBJETIVO PRINCIPAL</label>
                    <input type="text" name="target" placeholder="Quem ou o que é o alvo?">
                </div>

                <div class="input-group" style="margin-bottom: 25px;">
                    <label>DESCRIÇÃO DETALHADA DO TRABALHO</label>
                    <textarea name="description" rows="4" placeholder="Forneça o máximo de detalhes possível sobre o trabalho solicitado."></textarea>
                </div>

                <div class="input-row">
                    <div class="input-group">
                        <label>RECOMPENSA OFERECIDA (RU / ARTEFATOS)</label>
                        <input type="text" name="reward" placeholder="Ex: 5000 RU, Artefato Vento da Liberdade, etc.">
                    </div>
                    <div class="input-group">
                        <label style="color:#e74c3c;">NÍVEL DE RISCO ESTIMADO</label>
                        <select name="riskLevel" style="border-color:#3a1c1c; color:#e74c3c;">
                            <option value="low">Baixo (mínima resistência)</option>
                            <option value="medium">Médio (ameaças comuns)</option>
                            <option value="high">Alto (mutantes pesados/esquadrões)</option>
                            <option value="extreme">Extremo (Garantia de Morte)</option>
                        </select>
                    </div>
                </div>

                <button type="submit" class="cyber-btn" style="width: 100%; margin-top: 20px;">
                    🔒 ENVIAR TRANSMISSÃO ENCRIPTADA <span>&raquo;</span>
                </button>
            </form>
        </div>

        <!-- DIREITA: SIDEBAR LOGIN -->
        <div class="panel sidebar-col">
            <div class="login-box">
                <h3>ACESSO DO CONTRATANTE</h3>
                <div class="icon-box">🗝️</div>
                <h4 style="color:#fff; margin-bottom: 10px; font-weight:normal;">Acesse sua solicitação</h4>
                <p>Consulte, acompanhe ou gerencie suas transmissões anteriores efetuando login na rede das facções.</p>
                <a href="/login.html" class="cyber-btn" style="padding: 15px; font-size: 1.1em;">
                    🔒 LOGIN <span>&raquo;</span>
                </a>
            </div>

            <div class="network-info">
                <p>REDE MERCENÁRIA</p>
                <p style="color:#2a4b6c;">Comunicações seguras.<br>Contratos discretos.<br>Pagamento garantido.</p>
                <div style="font-size: 24px; margin-top:15px; color:#1a2c3a;">☠️</div>
                <div style="font-size: 12px; margin-top:5px; color:#1a2c3a;">★★★</div>
            </div>
        </div>

    </div>

    <!-- RODAPÉ HUD -->
    <div style="text-align:right; padding: 10px 30px; color:#2a4b6c; font-size: 0.7em; letter-spacing: 2px;">
        N 51° 30' 12" E 30° 02' 45"
    </div>

    <script>
        async function enviarContrato(e) {
            e.preventDefault();
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            try {
                const btn = e.target.querySelector('button');
                btn.innerHTML = "🔒 TRANSMITINDO... <span>&raquo;</span>";
                btn.disabled = true;

                const res = await fetch('/api/public/contracts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await res.json();
                if(res.ok && result.success) {
                    document.getElementById('contractForm').style.display = 'none';
                    document.getElementById('sucesso-msg').style.display = 'flex';
                    document.getElementById('cod-rastreio').innerText = result.code || "REG-999X";
                } else {
                    alert('Falha na transmissão. Tente novamente.');
                    btn.innerHTML = "🔒 ENVIAR TRANSMISSÃO ENCRIPTADA <span>&raquo;</span>";
                    btn.disabled = false;
                }
            } catch(err) {
                alert('Erro de conexão com o servidor local.');
            }
        }
    </script>
</body>
</html>`;

fs.writeFileSync('public/contratar.html', html);
console.log("contratar.html reescrito com visual exato da imagem.");
