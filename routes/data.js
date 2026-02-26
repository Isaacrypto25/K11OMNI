/**
 * K11 OMNI ELITE — DATA ROUTES
 * ══════════════════════════════
 * GET  /api/data/:dataset          → retorna dataset completo
 * GET  /api/data/all               → retorna todos os datasets
 * PUT  /api/data/:dataset/:id      → atualiza item por ID
 * POST /api/data/tarefas/:id/toggle → toggle done em tarefa
 * GET  /api/data/files             → lista arquivos na pasta /data
 */

'use strict';

const router    = require('express').Router();
const datastore = require('../services/datastore');
const logger    = require('../services/logger');

// GET /api/data/all — todos os datasets de uma vez
router.get('/all', async (req, res) => {
    try {
        const all = await datastore.getAll();
        res.json({ ok: true, data: all, ts: new Date().toISOString() });
    } catch (err) {
        logger.error('ROUTES/DATA', 'Falha ao carregar todos os dados', { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/data/files — lista arquivos disponíveis
router.get('/files', (req, res) => {
    res.json({ ok: true, files: datastore.listFiles() });
});

// GET /api/data/:dataset — retorna dataset específico
router.get('/:dataset', async (req, res) => {
    const { dataset } = req.params;
    const bustCache   = req.query.refresh === '1';

    try {
        const data = await datastore.get(dataset, { bustCache });

        if (!data || (Array.isArray(data) && data.length === 0)) {
            logger.warn('ROUTES/DATA', `Dataset vazio ou não encontrado: ${dataset}`);
            return res.status(404).json({
                ok:    false,
                error: `Dataset "${dataset}" não encontrado ou vazio`,
                data:  [],
            });
        }

        res.json({ ok: true, dataset, rows: data.length, data, ts: new Date().toISOString() });

    } catch (err) {
        logger.error('ROUTES/DATA', `Falha ao ler ${dataset}`, { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// PUT /api/data/:dataset/:id — atualiza item
router.put('/:dataset/:id', async (req, res) => {
    const { dataset, id } = req.params;
    const patch           = req.body;

    if (!patch || typeof patch !== 'object') {
        return res.status(400).json({ ok: false, error: 'Body deve ser um objeto JSON' });
    }

    try {
        const updated = await datastore.updateItem(dataset, id, patch);
        if (!updated) {
            return res.status(404).json({ ok: false, error: `Item ${id} não encontrado em ${dataset}` });
        }
        logger.info('ROUTES/DATA', `Item atualizado`, { dataset, id, fields: Object.keys(patch) });
        res.json({ ok: true, updated });

    } catch (err) {
        logger.error('ROUTES/DATA', `Falha ao atualizar ${dataset}/${id}`, { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/data/tarefas/:id/toggle — toggle done
router.post('/tarefas/:id/toggle', async (req, res) => {
    const { id } = req.params;

    try {
        const tarefas = await datastore.get('tarefas', { bustCache: true });
        const tarefa  = tarefas.find(t => String(t.id) === String(id));

        if (!tarefa) {
            return res.status(404).json({ ok: false, error: `Tarefa ${id} não encontrada` });
        }

        const updated = await datastore.updateItem('tarefas', id, { done: !tarefa.done });
        logger.info('ROUTES/DATA', `Tarefa ${id} toggled`, { done: updated.done });
        res.json({ ok: true, tarefa: updated });

    } catch (err) {
        logger.error('ROUTES/DATA', `Falha no toggle tarefa ${id}`, { error: err.message });
        res.status(500).json({ ok: false, error: err.message });
    }
});

// DELETE /api/data/cache — invalida cache
router.delete('/cache', (req, res) => {
    datastore.clearCache();
    res.json({ ok: true, message: 'Cache invalidado' });
});

module.exports = router;
