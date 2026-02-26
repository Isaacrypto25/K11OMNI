/**
 * K11 OMNI ELITE — AI SUPERVISOR ROUTES
 * ═══════════════════════════════════════
 * GET  /api/ai/health        → análise automática de saúde
 * POST /api/ai/chat          → conversa com o supervisor
 * GET  /api/ai/history       → histórico de análises
 * POST /api/ai/analyze-logs  → análise de logs críticos
 */

'use strict';

const router      = require('express').Router();
const supervisor  = require('../services/ai-supervisor');
const logger      = require('../services/logger');
const datastore   = require('../services/datastore');
const reqTracker  = require('../middleware/request-tracker');

// ── GET /api/ai/health ────────────────────────────────────────
router.get('/health', async (req, res) => {
    try {
        const snapshot = _buildSnapshot();
        const analysis = await supervisor.analyzeHealth(snapshot);
        res.json({ ok: true, analysis });
    } catch (err) {
        logger.error('ROUTES/AI', 'Falha no health check', { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/ai/chat ─────────────────────────────────────────
router.post('/chat', async (req, res) => {
    const { message } = req.body || {};

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ ok: false, error: 'Campo "message" é obrigatório' });
    }

    if (message.length > 1000) {
        return res.status(400).json({ ok: false, error: 'Mensagem muito longa (max 1000 chars)' });
    }

    try {
        const snapshot = _buildSnapshot();
        const result   = await supervisor.chat(message, snapshot);
        res.json({ ok: result.success, ...result });
    } catch (err) {
        logger.error('ROUTES/AI', 'Falha no chat', { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/ai/history ───────────────────────────────────────
router.get('/history', (req, res) => {
    res.json({ ok: true, history: supervisor.getHistory() });
});

// ── POST /api/ai/analyze-logs ─────────────────────────────────
router.post('/analyze-logs', async (req, res) => {
    try {
        const logs     = logger.getLogs({ limit: 100 });
        const diagnosis = await supervisor.analyzeLogs(logs);

        if (!diagnosis) {
            return res.json({ ok: true, message: 'Nenhum erro crítico nos logs recentes.' });
        }

        res.json({ ok: true, diagnosis });
    } catch (err) {
        logger.error('ROUTES/AI', 'Falha na análise de logs', { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/ai/score ─────────────────────────────────────────
router.get('/score', (req, res) => {
    const score = supervisor.getLastScore();
    res.json({
        ok:    true,
        score: score ?? null,
        label: score == null ? 'Não calculado' :
               score >= 90 ? 'Saudável' :
               score >= 70 ? 'Atenção' :
               score >= 50 ? 'Degradado' : 'Crítico',
    });
});

// ── HELPER ────────────────────────────────────────────────────
function _buildSnapshot() {
    return {
        uptime:        process.uptime() * 1000,
        logStats:      logger.getStats(),
        datastoreStats: datastore.getStats(),
        requestStats:  reqTracker.getStats(),
        recentLogs:    logger.getLogs({ limit: 30 }),
    };
}

module.exports = router;
