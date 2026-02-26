/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║          K11 OMNI ELITE — BACKEND SERVER v1.0.0               ║
 * ║          A alma do projeto. Tudo passa por aqui.              ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Stack: Node.js · Express · SQLite · Groq AI
 *
 * Endpoints:
 *   GET  /health                  → status rápido (sem auth)
 *   GET  /api/status              → status público básico
 *   GET  /api/data/all            → todos os datasets
 *   GET  /api/data/:dataset       → dataset específico
 *   PUT  /api/data/:dataset/:id   → atualiza item
 *   GET  /api/system/status       → métricas completas do servidor
 *   GET  /api/system/logs         → logs recentes
 *   GET  /api/system/stream       → SSE: stream de logs em tempo real
 *   POST /api/system/log          → injeta log do front-end
 *   GET  /api/ai/health           → análise IA do sistema
 *   POST /api/ai/chat             → chat com supervisor de IA
 *   GET  /api/ai/score            → health score atual
 */

'use strict';

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const compression  = require('compression');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const os           = require('os');

// ── SERVIÇOS ──────────────────────────────────────────────────
const logger         = require('./services/logger');
const datastore      = require('./services/datastore');
const supervisor     = require('./services/ai-supervisor');

// ── MIDDLEWARE ────────────────────────────────────────────────
const authMiddleware     = require('./middleware/auth');
const requestTracker     = require('./middleware/request-tracker');

// ── ROTAS ─────────────────────────────────────────────────────
const dataRoutes   = require('./routes/data');
const systemRoutes = require('./routes/system');
const aiRoutes     = require('./routes/ai');

// ─────────────────────────────────────────────────────────────
const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

logger.info('BOOT', '════════════════════════════════════════');
logger.info('BOOT', '  K11 OMNI ELITE SERVER — INICIANDO     ');
logger.info('BOOT', '════════════════════════════════════════');
logger.info('BOOT', `Node.js ${process.version} | PID ${process.pid}`);
logger.info('BOOT', `Plataforma: ${os.platform()} ${os.arch()}`);

// ── SEGURANÇA ─────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: false, // desativa pois servimos HTML estático
    crossOriginEmbedderPolicy: false,
}));

// CORS — permite front-end local + Railway
app.use(cors({
    origin: (origin, cb) => {
        // Permite: sem origin (apps mobile/curl), localhost, *.railway.app, *.up.railway.app
        if (!origin
            || origin.includes('localhost')
            || origin.includes('127.0.0.1')
            || origin.includes('railway.app')
            || origin.includes('file://')) {
            return cb(null, true);
        }
        // Em produção, adicione seus domínios aqui
        cb(null, true); // Permissivo por padrão — restrinja conforme necessário
    },
    credentials: true,
    methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-K11-Token'],
}));

// ── PERFORMANCE ───────────────────────────────────────────────
app.use(compression());

// ── BODY PARSING ──────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── RATE LIMITING ─────────────────────────────────────────────
const limiter = rateLimit({
    windowMs:         parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    max:              parseInt(process.env.RATE_LIMIT_MAX       || '120',   10),
    standardHeaders:  true,
    legacyHeaders:    false,
    handler: (req, res) => {
        logger.warn('RATE-LIMIT', `Limite excedido`, { ip: req.ip, path: req.path });
        res.status(429).json({ ok: false, error: 'Muitas requisições. Tente em 1 minuto.' });
    },
});
app.use('/api', limiter);

// ── MORGAN (HTTP LOG) ─────────────────────────────────────────
app.use(morgan((tokens, req, res) => {
    const status = tokens.status(req, res);
    const ms     = tokens['response-time'](req, res);
    const method = tokens.method(req, res);
    const url    = tokens.url(req, res);
    if (url?.includes('/api/system/stream')) return null; // não loga SSE keepalives
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'debug';
    logger[level]('HTTP', `${method} ${url} → ${status} (${ms}ms)`);
    return null; // morgan não escreve nada, logger já fez
}));

// ── REQUEST TRACKER ───────────────────────────────────────────
app.use(requestTracker);

// ── AUTH ──────────────────────────────────────────────────────
app.use(authMiddleware);

// ─────────────────────────────────────────────────────────────
// ROTAS PÚBLICAS (sem auth)
// ─────────────────────────────────────────────────────────────

// Healthcheck mínimo para Railway/Render/UptimeRobot
app.get('/health', (req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
});

// Status público básico
app.get('/api/status', (req, res) => {
    res.json({
        ok:      true,
        system:  'K11 OMNI ELITE',
        version: '1.0.0',
        uptime:  Math.floor(process.uptime()),
        env:     process.env.NODE_ENV || 'development',
    });
});

// ─────────────────────────────────────────────────────────────
// ROTAS PROTEGIDAS
// ─────────────────────────────────────────────────────────────
app.use('/api/data',   dataRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/ai',     aiRoutes);

// Serve arquivos estáticos do front-end (opcional)
// Descomente se quiser servir o HTML pelo mesmo servidor:
// app.use(express.static(path.join(__dirname, 'public')));

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
    logger.warn('HTTP', `404: ${req.method} ${req.path}`);
    res.status(404).json({
        ok:      false,
        error:   'Rota não encontrada',
        path:    req.path,
        routes:  [
            'GET  /health',
            'GET  /api/status',
            'GET  /api/data/all',
            'GET  /api/data/:dataset',
            'GET  /api/system/status',
            'GET  /api/system/logs',
            'GET  /api/system/stream  (SSE)',
            'POST /api/system/log',
            'GET  /api/ai/health',
            'POST /api/ai/chat',
            'GET  /api/ai/score',
        ],
    });
});

// ── ERROR HANDLER GLOBAL ─────────────────────────────────────
app.use((err, req, res, next) => {
    logger.critical('SERVER', `Erro não tratado: ${err.message}`, {
        stack: err.stack?.split('\n').slice(0, 4),
        path:  req.path,
    });
    res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
});

// ─────────────────────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', async () => {
    logger.info('BOOT', `Servidor online na porta ${PORT}`);
    logger.info('BOOT', `Local:    http://localhost:${PORT}`);
    logger.info('BOOT', `Network:  http://${_getLocalIP()}:${PORT}`);
    logger.info('BOOT', `Health:   http://localhost:${PORT}/health`);
    logger.info('BOOT', `Status:   http://localhost:${PORT}/api/status`);
    logger.info('BOOT', '────────────────────────────────────────');

    // Pré-carrega todos os datasets na inicialização
    logger.info('BOOT', 'Carregando datasets...');
    const all = await datastore.getAll();
    const totals = Object.entries(all)
        .map(([k, v]) => `${k}:${v.length}`)
        .join(' | ');
    logger.info('BOOT', `Datasets carregados → ${totals}`);

    // Health check automático ao iniciar (se IA disponível)
    if (process.env.GROQ_API_KEY?.startsWith('gsk_')) {
        logger.info('BOOT', 'Executando análise inicial de saúde...');
        setTimeout(async () => {
            try {
                const snap  = { uptime: process.uptime() * 1000, logStats: logger.getStats(), datastoreStats: datastore.getStats(), requestStats: requestTracker.getStats() };
                const check = await supervisor.analyzeHealth(snap);
                logger.info('AI-SUPERVISOR', `Score inicial: ${check.score}/100 — ${check.status}`);
            } catch (_) {}
        }, 2000);
    } else {
        logger.warn('BOOT', 'GROQ_API_KEY não configurada — supervisor de IA desativado');
    }

    logger.info('BOOT', '✓ K11 OMNI ELITE SERVER PRONTO');
});

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────────
function shutdown(signal) {
    logger.warn('BOOT', `Sinal ${signal} recebido. Encerrando servidor...`);
    server.close(() => {
        logger.info('BOOT', 'Servidor encerrado com sucesso.');
        process.exit(0);
    });
    // Força encerramento após 5s se algo travar
    setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    logger.critical('PROCESS', `uncaughtException: ${err.message}`, {
        stack: err.stack?.split('\n').slice(0, 5),
    });
    // Não encerra em uncaughtException para manter o servidor vivo
});

process.on('unhandledRejection', (reason) => {
    logger.error('PROCESS', `unhandledRejection: ${String(reason)}`);
});

// ── HELPER ────────────────────────────────────────────────────
function _getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.values(interfaces)) {
        for (const iface of name) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    return 'localhost';
}

module.exports = app;
