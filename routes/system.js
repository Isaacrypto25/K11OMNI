/**
 * K11 OMNI ELITE — SYSTEM ROUTES
 * ════════════════════════════════
 * GET  /api/system/status   → saúde completa do servidor (JSON)
 * GET  /api/system/logs     → logs recentes (filtráveis)
 * GET  /api/system/stream   → SSE: stream de logs em tempo real
 * POST /api/system/log      → injeta log externo (do front-end)
 * DELETE /api/system/logs   → limpa arquivo de log
 */

'use strict';

const router         = require('express').Router();
const logger         = require('../services/logger');
const datastore      = require('../services/datastore');
const requestTracker = require('../middleware/request-tracker');
const os             = require('os');

// ── SSE CLIENTS ────────────────────────────────────────────────
const _sseClients = new Set();

// Envia cada novo log para todos os clientes SSE conectados
logger.on('log', (entry) => {
    const msg = `data: ${JSON.stringify(entry)}\n\n`;
    _sseClients.forEach(res => {
        try { res.write(msg); } catch (_) { _sseClients.delete(res); }
    });
});

// ── GET /api/system/status ─────────────────────────────────────
router.get('/status', (req, res) => {
    const mem    = process.memoryUsage();
    const cpus   = os.cpus();

    res.json({
        ok:      true,
        system:  'K11 OMNI ELITE SERVER',
        version: '1.0.0',
        env:     process.env.NODE_ENV || 'development',
        uptime:  {
            ms:      process.uptime() * 1000,
            seconds: Math.floor(process.uptime()),
            human:   _formatUptime(process.uptime()),
        },
        memory: {
            heapUsedMB:  Math.round(mem.heapUsed  / 1024 / 1024),
            heapTotalMB: Math.round(mem.heapTotal  / 1024 / 1024),
            rssMB:       Math.round(mem.rss        / 1024 / 1024),
        },
        cpu: {
            model:   cpus[0]?.model || 'N/A',
            cores:   cpus.length,
            loadAvg: os.loadavg().map(v => v.toFixed(2)),
        },
        platform: {
            os:       os.platform(),
            arch:     os.arch(),
            hostname: os.hostname(),
        },
        requests:  requestTracker.getStats(),
        logs:      logger.getStats(),
        datastore: datastore.getStats(),
        sseClients: _sseClients.size,
        ts:        new Date().toISOString(),
    });
});

// ── GET /api/system/logs ───────────────────────────────────────
router.get('/logs', (req, res) => {
    const { level, module, limit = 200 } = req.query;
    const logs = logger.getLogs({
        level:  level  || undefined,
        module: module || undefined,
        limit:  parseInt(limit, 10),
    });
    res.json({ ok: true, count: logs.length, logs });
});

// ── GET /api/system/stream (SSE) ───────────────────────────────
router.get('/stream', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx: desativa buffer

    // Envia ping inicial + histórico recente
    res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`);
    const recent = logger.getLogs({ limit: 50 }).reverse();
    recent.forEach(entry => res.write(`data: ${JSON.stringify(entry)}\n\n`));

    _sseClients.add(res);
    logger.info('SSE', `Cliente conectado (total: ${_sseClients.size})`);

    // Keepalive a cada 25s para evitar timeout
    const keepalive = setInterval(() => {
        try { res.write(': ping\n\n'); } catch (_) { clearInterval(keepalive); }
    }, 25_000);

    req.on('close', () => {
        clearInterval(keepalive);
        _sseClients.delete(res);
        logger.debug('SSE', `Cliente desconectado (total: ${_sseClients.size})`);
    });
});

// ── POST /api/system/log — injeta log do front-end ────────────
router.post('/log', (req, res) => {
    const { level = 'info', module = 'FRONTEND', message, meta } = req.body || {};

    if (!message) {
        return res.status(400).json({ ok: false, error: 'message é obrigatório' });
    }

    const validLevels = ['debug', 'info', 'warn', 'error', 'critical'];
    const safeLevel   = validLevels.includes(level) ? level : 'info';

    logger[safeLevel](String(module).slice(0, 20), String(message).slice(0, 500), meta || null);
    res.json({ ok: true });
});

// ── DELETE /api/system/logs ───────────────────────────────────
router.delete('/logs', (req, res) => {
    logger.clearFile((err) => {
        if (err) return res.status(500).json({ ok: false, error: err.message });
        res.json({ ok: true, message: 'Log file limpo' });
    });
});

// ── HELPER ────────────────────────────────────────────────────
function _formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
}

module.exports = router;
