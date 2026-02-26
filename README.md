# K11 OMNI ELITE — BACKEND SERVER

> A alma do projeto. Servidor Node.js/Express que serve dados, logs e supervisão por IA.

---

## ⚡ ESTRUTURA

```
k11-server/
├── server.js                  ← Entry point principal
├── package.json
├── .env.example               ← Copie para .env e configure
├── Procfile                   ← Para Railway/Heroku
├── railway.json               ← Config de deploy Railway
│
├── services/
│   ├── logger.js              ← Sistema de logs estruturado
│   ├── datastore.js           ← Gerencia os JSONs com cache
│   └── ai-supervisor.js       ← Supervisor de IA (Groq)
│
├── middleware/
│   ├── auth.js                ← Autenticação por Bearer token
│   └── request-tracker.js    ← Métricas de requests/latência
│
├── routes/
│   ├── data.js                ← /api/data/* (datasets)
│   ├── system.js              ← /api/system/* (logs, SSE, status)
│   └── ai.js                  ← /api/ai/* (supervisor)
│
├── data/                      ← COLOQUE OS JSONs AQUI
│   ├── produtos.json
│   ├── pdv.json
│   ├── pdvAnterior.json
│   ├── pdvmesquita.json
│   ├── pdvjacarepagua.json
│   ├── pdvbenfica.json
│   ├── movimento.json
│   ├── auditoria.json
│   ├── fornecedor.json
│   └── tarefas.json
│
└── logs/
    └── k11.log                ← Gerado automaticamente
```

---

## 🚀 DEPLOY NO RAILWAY (Passo a Passo)

### 1. Preparar o repositório

```bash
# Na pasta k11-server:
git init
git add .
git commit -m "feat: K11 OMNI ELITE Server v1.0.0"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/k11-server.git
git push -u origin main
```

### 2. Criar projeto no Railway

1. Acesse **railway.app** → Login com GitHub
2. Clique em **New Project** → **Deploy from GitHub repo**
3. Selecione o repositório `k11-server`
4. Railway detecta automaticamente Node.js e faz o build

### 3. Configurar variáveis de ambiente

No painel do Railway → **Variables** → adicione:

| Variável | Valor |
|---|---|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `API_SECRET_TOKEN` | Gere com: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `GROQ_API_KEY` | Sua chave do Groq (`gsk_...`) |
| `RATE_LIMIT_MAX` | `120` |

### 4. Adicionar os JSONs

**Opção A — Commitar os JSONs (mais simples):**
```bash
cp /caminho/dos/jsons/*.json ./data/
git add data/
git commit -m "data: adiciona datasets iniciais"
git push
```

**Opção B — Volume no Railway (dados persistentes):**
No Railway → **Volumes** → Monte em `/app/data`

### 5. Verificar o deploy

Acesse a URL gerada pelo Railway e teste:
```
https://seu-projeto.railway.app/health
https://seu-projeto.railway.app/api/status
```

---

## 🔌 ENDPOINTS

### Públicos (sem token)
```
GET  /health                  → {"status":"ok"}
GET  /api/status              → info básica do servidor
```

### Dados (requer Bearer token)
```
GET  /api/data/all                    → todos os datasets
GET  /api/data/produtos               → produtos.json
GET  /api/data/pdv                    → pdv.json
GET  /api/data/movimento              → movimento.json
GET  /api/data/fornecedor             → fornecedor.json
GET  /api/data/tarefas                → tarefas.json
GET  /api/data/:nome?refresh=1        → força reload do cache
PUT  /api/data/:dataset/:id           → atualiza item
POST /api/data/tarefas/:id/toggle     → toggle done/pendente
DELETE /api/data/cache                → invalida cache
```

### Sistema
```
GET  /api/system/status       → CPU, memória, uptime, requests
GET  /api/system/logs         → logs recentes (query: level, module, limit)
GET  /api/system/stream       → SSE: stream de logs em tempo real
POST /api/system/log          → injeta log do front-end
DELETE /api/system/logs       → limpa arquivo de log
```

### IA Supervisor
```
GET  /api/ai/health           → análise automática (health score)
POST /api/ai/chat             → {"message":"Como está o servidor?"}
GET  /api/ai/score            → health score atual
GET  /api/ai/history          → histórico de análises
POST /api/ai/analyze-logs     → diagnóstico dos logs críticos
```

---

## 🔐 AUTENTICAÇÃO

Todos os endpoints `/api/*` (exceto `/api/status`) exigem:

```
Authorization: Bearer SEU_TOKEN_AQUI
```

Exemplo com curl:
```bash
curl -H "Authorization: Bearer SEU_TOKEN" \
     https://seu-projeto.railway.app/api/data/produtos
```

---

## 📡 INTEGRAÇÃO COM O FRONT-END

Adicione no `k11-config.js`:

```javascript
const K11_SERVER_URL   = 'https://seu-projeto.railway.app';
const K11_SERVER_TOKEN = 'seu-token-aqui';
```

Modifique o `APP._safeFetch` no `k11-app.js` para usar o servidor:

```javascript
async _safeFetch(url, retries = FETCH_RETRY) {
    // Se URL é relativa, prefix com o servidor
    const fullUrl = url.startsWith('http') ? url 
                  : `${K11_SERVER_URL}/api/data/${url.replace('./', '').replace('.json', '')}`;
    
    const headers = K11_SERVER_TOKEN 
        ? { 'Authorization': `Bearer ${K11_SERVER_TOKEN}` } 
        : {};
    
    // ... resto do fetch
}
```

---

## 🛠️ DESENVOLVIMENTO LOCAL

```bash
# Instalar dependências
npm install

# Criar .env
cp .env.example .env
# Edite o .env com seus valores

# Copiar JSONs para /data
cp /caminho/dos/jsons/*.json ./data/

# Iniciar servidor
npm start
# ou com auto-reload:
npm run dev

# Testar
curl http://localhost:3000/health
curl http://localhost:3000/api/status
curl -H "Authorization: Bearer SEU_TOKEN" http://localhost:3000/api/data/produtos
```

---

## 📊 STREAM DE LOGS EM TEMPO REAL (SSE)

```javascript
// No browser ou Node.js:
const stream = new EventSource(
    'https://seu-projeto.railway.app/api/system/stream',
    { headers: { 'Authorization': 'Bearer SEU_TOKEN' } }
);

stream.onmessage = (e) => {
    const log = JSON.parse(e.data);
    console.log(`[${log.level}] ${log.module}: ${log.message}`);
};
```

---

## 🧠 SUPERVISOR DE IA

```bash
# Verificar saúde do sistema
curl -H "Authorization: Bearer TOKEN" \
     https://seu-projeto.railway.app/api/ai/health

# Perguntar ao supervisor
curl -X POST \
     -H "Authorization: Bearer TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"message":"Quantos erros nos últimos logs?"}' \
     https://seu-projeto.railway.app/api/ai/chat
```

---

*K11 OMNI ELITE Server — Construído com Node.js, Express, amor e determinação.*
