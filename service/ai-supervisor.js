/**
 * K11 OMNI ELITE — AI SUPERVISOR SERVICE
 * ════════════════════════════════════════
 * IA baseada em Groq que monitora a saúde do servidor.
 * Analisa logs, detecta anomalias e gera diagnósticos.
 * Responde perguntas sobre o estado do sistema.
 */

'use strict';

const https  = require('https');
const logger = require('./logger');

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';

// Histórico de análises (rolling, max 50)
const _analysisHistory = [];
let   _lastHealthScore = null;

// ── PROMPT DO SISTEMA ──────────────────────────────────────────
function _buildSystemPrompt() {
    return `Você é o K11 AI Supervisor — sistema de monitoramento inteligente do servidor K11 OMNI ELITE.

MISSÃO: Analisar logs, métricas e estado do sistema para:
1. Detectar anomalias e padrões críticos
2. Calcular health score (0-100)
3. Gerar diagnósticos acionáveis e objetivos
4. Responder perguntas sobre o estado do servidor

REGRAS:
- Seja conciso e direto. Sem enrolação.
- Health score: 90-100 = saudável | 70-89 = atenção | 50-69 = degradado | <50 = crítico
- Use terminologia técnica mas explique o impacto
- Priorize erros críticos sobre warnings
- Responda SEMPRE em português do Brasil
- Para análises automáticas, retorne JSON estruturado quando solicitado

CONTEXTO DO SISTEMA:
- Servidor Node.js/Express servindo dados para K11 OMNI ELITE (gestão de estoque/operações)
- Datasets: produtos, pdv, movimento, auditoria, fornecedor, tarefas
- Front-end consome via REST API com token de autenticação`;
}

// ── CHAMADA À API GROQ ────────────────────────────────────────
function _callGroq(messages) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.GROQ_API_KEY || '';
        if (!apiKey || !apiKey.startsWith('gsk_')) {
            reject(new Error('GROQ_API_KEY não configurada'));
            return;
        }

        const body = JSON.stringify({
            model:       GROQ_MODEL,
            messages,
            max_tokens:  1024,
            temperature: 0.3,
        });

        const options = {
            hostname: 'api.groq.com',
            path:     '/openai/v1/chat/completions',
            method:   'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(body),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.error) { reject(new Error(parsed.error.message)); return; }
                    resolve(parsed.choices?.[0]?.message?.content || '');
                } catch (e) { reject(e); }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Groq timeout')); });
        req.write(body);
        req.end();
    });
}

// ── ANÁLISE AUTOMÁTICA DE SAÚDE ───────────────────────────────
async function analyzeHealth(systemSnapshot) {
    const { logStats, datastoreStats, requestStats, uptime } = systemSnapshot;

    const prompt = `Analise o snapshot do servidor K11 e retorne JSON com health score e diagnóstico.

SNAPSHOT:
- Uptime: ${Math.floor(uptime / 1000)}s
- Logs: ${JSON.stringify(logStats)}
- DataStore: ${JSON.stringify(datastoreStats)}
- Requests: ${JSON.stringify(requestStats)}

Retorne APENAS JSON válido neste formato:
{
  "score": 85,
  "status": "saudável",
  "issues": ["descrição do problema se houver"],
  "recommendations": ["ação recomendada"],
  "summary": "Resumo em 1 frase"
}`;

    try {
        const response = await _callGroq([
            { role: 'system',  content: _buildSystemPrompt() },
            { role: 'user',    content: prompt },
        ]);

        // Extrai JSON da resposta
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('Resposta não contém JSON válido');

        const analysis = JSON.parse(jsonMatch[0]);
        analysis.ts    = new Date().toISOString();
        analysis.raw   = response;

        _lastHealthScore = analysis.score;
        _analysisHistory.push(analysis);
        if (_analysisHistory.length > 50) _analysisHistory.shift();

        logger.info('AI-SUPERVISOR', `Health check concluído`, {
            score:  analysis.score,
            status: analysis.status,
            issues: analysis.issues?.length || 0,
        });

        return analysis;

    } catch (err) {
        logger.error('AI-SUPERVISOR', 'Falha no health check', { error: err.message });
        return {
            score:           _lastHealthScore ?? 50,
            status:          'indisponível',
            issues:          [`Supervisor offline: ${err.message}`],
            recommendations: ['Verifique a chave GROQ_API_KEY'],
            summary:         'Supervisor de IA temporariamente indisponível',
            ts:              new Date().toISOString(),
            error:           true,
        };
    }
}

// ── CHAT COM O SUPERVISOR ─────────────────────────────────────
async function chat(userMessage, contextSnapshot) {
    const context = contextSnapshot ? `
ESTADO ATUAL DO SERVIDOR:
- Uptime: ${Math.floor((contextSnapshot.uptime || 0) / 1000)}s
- Logs recentes: ${JSON.stringify(contextSnapshot.recentLogs?.slice(0, 10) || [])}
- Health score atual: ${_lastHealthScore ?? 'não calculado'}
- Stats: ${JSON.stringify(contextSnapshot.logStats || {})}
` : '';

    try {
        const response = await _callGroq([
            { role: 'system', content: _buildSystemPrompt() + context },
            { role: 'user',   content: userMessage },
        ]);

        logger.info('AI-SUPERVISOR', 'Chat respondido', {
            question: userMessage.slice(0, 60),
            chars:    response.length,
        });

        return { success: true, response, ts: new Date().toISOString() };

    } catch (err) {
        logger.error('AI-SUPERVISOR', 'Falha no chat', { error: err.message });
        return {
            success:  false,
            response: `Supervisor indisponível: ${err.message}`,
            ts:       new Date().toISOString(),
        };
    }
}

// ── ANÁLISE DE LOGS CRÍTICOS ──────────────────────────────────
async function analyzeLogs(logs) {
    if (!logs || logs.length === 0) return null;

    const criticalLogs = logs
        .filter(l => l.level === 'error' || l.level === 'critical')
        .slice(0, 20);

    if (criticalLogs.length === 0) return null;

    const prompt = `Analise estes logs de erro do servidor K11 e forneça diagnóstico:

${criticalLogs.map(l => `[${l.level.toUpperCase()}] ${l.module}: ${l.message}`).join('\n')}

Forneça: causa raiz provável, impacto no sistema e ação corretiva imediata.`;

    try {
        const response = await _callGroq([
            { role: 'system', content: _buildSystemPrompt() },
            { role: 'user',   content: prompt },
        ]);
        return { diagnosis: response, logsAnalyzed: criticalLogs.length, ts: new Date().toISOString() };
    } catch (err) {
        return null;
    }
}

module.exports = {
    analyzeHealth,
    analyzeLogs,
    chat,
    getHistory:       () => [..._analysisHistory].reverse().slice(0, 20),
    getLastScore:     () => _lastHealthScore,
};
