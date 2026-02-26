/**
 * K11 OMNI ELITE — LOGGER SERVICE
 * ════════════════════════════════
 * Sistema de logs estruturado com:
 * - Níveis: DEBUG | INFO | WARN | ERROR | CRITICAL
 * - Persistência em arquivo rotativo
 * - Emissão via EventEmitter para SSE em tempo real
 * - Estatísticas de erros por módulo
 */

'use strict';

const fs           = require('fs');
const path         = require('path');
const { EventEmitter } = require('events');

const LOG_DIR      = path.join(__dirname, '..', 'logs');
const LOG_FILE     = path.join(LOG_DIR, 'k11.log');
const MAX_LINES    = parseInt(process.env.LOG_MAX_LINES || '2000', 10);

// Garante que a pasta de logs existe
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// ── CORES ANSI PARA TERMINAL ──────────────────────────
const C = {
    reset:    '\x1b[0m',
    bright:   '\x1b[1m',
    debug:    '\x1b[36m',   // cyan
    info:     '\x1b[32m',   // green
    warn:     '\x1b[33m',   // yellow
    error:    '\x1b[31m',   // red
    critical: '\x1b[35m',   // magenta
    time:     '\x1b[90m',   // gray
    module:   '\x1b[34m',   // blue
};

class K11Logger extends EventEmitter {
    constructor() {
        super();
        this._buffer    = [];    // últimas N entradas em memória
        this._stats     = { debug: 0, info: 0, warn: 0, error: 0, critical: 0 };
        this._startTime = Date.now();
    }

    _write(level, module, message, meta = null) {
        const now     = new Date();
        const ts      = now.toISOString();
        const uptime  = Math.floor((Date.now() - this._startTime) / 1000);

        const entry = {
            id:       `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            ts,
            level,
            module:   module || 'CORE',
            message:  String(message),
            meta:     meta || null,
            uptime,
        };

        // Estatísticas
        this._stats[level] = (this._stats[level] || 0) + 1;

        // Buffer em memória (rolling)
        this._buffer.push(entry);
        if (this._buffer.length > MAX_LINES) this._buffer.shift();

        // Terminal colorido
        const color  = C[level] || C.info;
        const badge  = level.toUpperCase().padEnd(8);
        const mod    = `[${entry.module}]`.padEnd(16);
        console.log(
            `${C.time}${ts.slice(11, 23)}${C.reset} ` +
            `${color}${C.bright}${badge}${C.reset} ` +
            `${C.module}${mod}${C.reset} ` +
            `${message}` +
            (meta ? ` ${C.time}${JSON.stringify(meta)}${C.reset}` : '')
        );

        // Persistência em arquivo (não-bloqueante)
        const line = JSON.stringify(entry) + '\n';
        fs.appendFile(LOG_FILE, line, () => {});

        // Emite para listeners SSE em tempo real
        this.emit('log', entry);

        return entry;
    }

    debug   (mod, msg, meta) { return this._write('debug',    mod, msg, meta); }
    info    (mod, msg, meta) { return this._write('info',     mod, msg, meta); }
    warn    (mod, msg, meta) { return this._write('warn',     mod, msg, meta); }
    error   (mod, msg, meta) { return this._write('error',    mod, msg, meta); }
    critical(mod, msg, meta) { return this._write('critical', mod, msg, meta); }

    /** Últimas N entradas, opcionalmente filtradas */
    getLogs({ level, module, limit = 200 } = {}) {
        let entries = [...this._buffer];
        if (level)  entries = entries.filter(e => e.level  === level);
        if (module) entries = entries.filter(e => e.module === module);
        return entries.slice(-limit).reverse();
    }

    getStats() {
        return {
            ...this._stats,
            total:      Object.values(this._stats).reduce((a, b) => a + b, 0),
            uptimeMs:   Date.now() - this._startTime,
            bufferSize: this._buffer.length,
        };
    }

    /** Limpa log file em disco (mantém buffer em memória) */
    clearFile(cb) {
        fs.writeFile(LOG_FILE, '', cb || (() => {}));
        this.info('LOGGER', 'Log file cleared by admin');
    }
}

module.exports = new K11Logger();
