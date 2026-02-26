/**
 * K11 OMNI ELITE — DATA STORE SERVICE
 * ═════════════════════════════════════
 * Gerencia todos os JSONs como fonte de verdade.
 * Cache em memória com TTL e invalidação.
 * Leitura segura com fallback para array vazio.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_TTL_MS = 30_000; // 30s de cache

// ── MAPA DE ARQUIVOS CONHECIDOS ────────────────────────────────
const DATASETS = {
    produtos:       'produtos.json',
    pdv:            'pdv.json',
    pdvAnterior:    'pdvAnterior.json',
    pdvmesquita:    'pdvmesquita.json',
    pdvjacarepagua: 'pdvjacarepagua.json',
    pdvbenfica:     'pdvbenfica.json',
    movimento:      'movimento.json',
    auditoria:      'auditoria.json',
    fornecedor:     'fornecedor.json',
    tarefas:        'tarefas.json',
};

class DataStore {
    constructor() {
        this._cache  = new Map();   // key → { data, ts }
        this._writes = 0;
        this._reads  = 0;
        this._errors = 0;

        // Garante pasta data
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            logger.warn('DATASTORE', `Pasta /data criada. Coloque os JSONs em: ${DATA_DIR}`);
        }

        logger.info('DATASTORE', 'DataStore inicializado', { dir: DATA_DIR, datasets: Object.keys(DATASETS).length });
    }

    // ── LEITURA ───────────────────────────────────────────────

    /**
     * Lê um dataset por nome ou arquivo.
     * Usa cache com TTL para performance.
     */
    async get(name, { bustCache = false } = {}) {
        const filename = DATASETS[name] || (name.endsWith('.json') ? name : `${name}.json`);
        const filepath = path.join(DATA_DIR, filename);
        const cacheKey = filename;

        // Verifica cache
        if (!bustCache && this._cache.has(cacheKey)) {
            const cached = this._cache.get(cacheKey);
            if (Date.now() - cached.ts < CACHE_TTL_MS) {
                logger.debug('DATASTORE', `Cache HIT: ${filename}`);
                return cached.data;
            }
        }

        // Lê do disco
        try {
            if (!fs.existsSync(filepath)) {
                logger.warn('DATASTORE', `Arquivo não encontrado: ${filename}`, { path: filepath });
                this._errors++;
                return [];
            }

            const raw  = fs.readFileSync(filepath, 'utf8');
            const data = JSON.parse(raw);
            this._reads++;

            // Normaliza para array
            const result = Array.isArray(data) ? data : (data?.data ?? Object.values(data));

            // Atualiza cache
            this._cache.set(cacheKey, { data: result, ts: Date.now() });

            logger.debug('DATASTORE', `Lido: ${filename}`, { rows: result.length });
            return result;

        } catch (err) {
            this._errors++;
            logger.error('DATASTORE', `Falha ao ler ${filename}`, { error: err.message });
            return [];
        }
    }

    /**
     * Carrega todos os datasets de uma vez.
     * Retorna objeto com todos os dados.
     */
    async getAll() {
        const keys    = Object.keys(DATASETS);
        const results = await Promise.all(keys.map(k => this.get(k)));
        const map     = {};
        keys.forEach((k, i) => { map[k] = results[i]; });
        logger.info('DATASTORE', 'Todos os datasets carregados', {
            totals: Object.fromEntries(keys.map((k, i) => [k, results[i].length]))
        });
        return map;
    }

    /**
     * Salva/substitui um dataset (write-through cache).
     */
    async set(name, data) {
        const filename = DATASETS[name] || `${name}.json`;
        const filepath = path.join(DATA_DIR, filename);

        try {
            const payload = Array.isArray(data) ? data : data;
            fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
            this._writes++;

            // Invalida cache
            this._cache.delete(filename);

            logger.info('DATASTORE', `Escrito: ${filename}`, {
                rows: Array.isArray(data) ? data.length : 1
            });
            return true;
        } catch (err) {
            this._errors++;
            logger.error('DATASTORE', `Falha ao escrever ${filename}`, { error: err.message });
            return false;
        }
    }

    /**
     * Atualiza um item de um array por ID.
     */
    async updateItem(name, id, patch) {
        const data = await this.get(name, { bustCache: true });
        const idx  = data.findIndex(item => String(item.id) === String(id));
        if (idx === -1) {
            logger.warn('DATASTORE', `Item não encontrado para update`, { dataset: name, id });
            return null;
        }
        data[idx] = { ...data[idx], ...patch, updatedAt: new Date().toISOString() };
        await this.set(name, data);
        return data[idx];
    }

    /** Invalida todo o cache */
    clearCache() {
        this._cache.clear();
        logger.info('DATASTORE', 'Cache invalidado manualmente');
    }

    /** Estatísticas do DataStore */
    getStats() {
        return {
            reads:      this._reads,
            writes:     this._writes,
            errors:     this._errors,
            cacheSize:  this._cache.size,
            cacheTTL:   CACHE_TTL_MS,
            dataDir:    DATA_DIR,
            datasets:   Object.keys(DATASETS),
        };
    }

    /** Lista arquivos presentes na pasta /data */
    listFiles() {
        try {
            return fs.readdirSync(DATA_DIR)
                .filter(f => f.endsWith('.json'))
                .map(f => {
                    const stats = fs.statSync(path.join(DATA_DIR, f));
                    return {
                        name:     f,
                        size:     stats.size,
                        modified: stats.mtime.toISOString(),
                        loaded:   this._cache.has(f),
                    };
                });
        } catch {
            return [];
        }
    }
}

module.exports = new DataStore();
