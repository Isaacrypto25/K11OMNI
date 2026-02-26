/**
 * K11 OMNI ELITE — AUTH MIDDLEWARE
 * ══════════════════════════════════
 * Token Bearer simples para proteger todos os endpoints.
 * Token configurado via API_SECRET_TOKEN no .env
 */

'use strict';

const logger = require('../services/logger');

// Rotas públicas que não precisam de token
const PUBLIC_PATHS = [
    '/health',
    '/api/status',
];

function authMiddleware(req, res, next) {
    // Rotas públicas passam direto
    if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) {
        return next();
    }

    const token     = process.env.API_SECRET_TOKEN;
    const authHeader = req.headers['authorization'] || '';
    const provided  = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : req.query._token || '';

    if (!token) {
        // Sem token configurado = modo desenvolvimento (sem auth)
        logger.warn('AUTH', 'API_SECRET_TOKEN não configurado — auth desativada');
        return next();
    }

    if (!provided || provided !== token) {
        logger.warn('AUTH', 'Token inválido ou ausente', {
            ip:   req.ip,
            path: req.path,
            ua:   req.headers['user-agent']?.slice(0, 60),
        });
        return res.status(401).json({
            ok:    false,
            error: 'Não autorizado. Envie o token em Authorization: Bearer <token>',
        });
    }

    next();
}

module.exports = authMiddleware;
