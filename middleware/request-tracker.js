/**
 * K11 OMNI ELITE — REQUEST TRACKER MIDDLEWARE
 * ═════════════════════════════════════════════
 * Mede latência de cada request, conta por rota e método,
 * detecta requests lentos e erros 4xx/5xx.
 */

'use strict';

const logger = require('../services/logger');

const stats = {
    total:       0,
    ok:          0,
    errors4xx:   0,
    errors5xx:   0,
    slow:        0,        // >500ms
    avgLatencyMs: 0,
    byRoute:     {},
    startTime:   Date.now(),
};

const SLOW_THRESHOLD_MS = 500;

function requestTracker(req, res, next) {
    const startAt = process.hrtime.bigint();

    res.on('finish', () => {
        const elapsedMs = Number(process.hrtime.bigint() - startAt) / 1_000_000;
        const status    = res.statusCode;
        const route     = `${req.method} ${req.path}`;

        // Contadores globais
        stats.total++;
        if (status >= 500)       stats.errors5xx++;
        else if (status >= 400)  stats.errors4xx++;
        else                     stats.ok++;
        if (elapsedMs > SLOW_THRESHOLD_MS) stats.slow++;

        // Média de latência (rolling)
        stats.avgLatencyMs = Math.round(
            (stats.avgLatencyMs * (stats.total - 1) + elapsedMs) / stats.total
        );

        // Por rota
        if (!stats.byRoute[route]) stats.byRoute[route] = { count: 0, totalMs: 0, errors: 0 };
        stats.byRoute[route].count++;
        stats.byRoute[route].totalMs += elapsedMs;
        if (status >= 400) stats.byRoute[route].errors++;

        // Log de requests lentos ou erros
        if (elapsedMs > SLOW_THRESHOLD_MS) {
            logger.warn('REQUEST', `Lento: ${route}`, {
                ms:     Math.round(elapsedMs),
                status,
            });
        } else if (status >= 500) {
            logger.error('REQUEST', `Erro ${status}: ${route}`, { ms: Math.round(elapsedMs) });
        }
    });

    next();
}

requestTracker.getStats = () => ({
    ...stats,
    uptimeMs:  Date.now() - stats.startTime,
    topRoutes: Object.entries(stats.byRoute)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([route, s]) => ({
            route,
            count:   s.count,
            avgMs:   Math.round(s.totalMs / s.count),
            errors:  s.errors,
        })),
});

module.exports = requestTracker;
