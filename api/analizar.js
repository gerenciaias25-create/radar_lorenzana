async function cacheGet(key) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;

    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key])
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.result ? JSON.parse(data.result) : null;
  } catch (e) {
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;

    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)])
    });
  } catch (e) {}
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { nombre, skill = 'radar', fecha, forceRefresh = false } = req.body || {};

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre del actor es requerido.' });
  }

  const skillNormalizado = String(skill).trim().toLowerCase();
  const fechaCtx = fecha || 'julio 2026';
  const CACHE_TTL_SECONDS = 6 * 60 * 60; 
  const cacheKey = `skill:${skillNormalizado}:${nombre.trim().toLowerCase()}:${fechaCtx.trim().toLowerCase()}`;

  if (!forceRefresh) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      return res.status(200).json({ ...cached, _cache: 'HIT' });
    }
  }

  try {
    let contextoReal = 'Análisis cuantitativo de tendencia.';

    let prompt = `Eres un Director General de Inteligencia Político-Digital. La fecha actual del reporte es: ${fechaCtx}.
    Genera un análisis amplio para "${nombre}".
    Debes responder estrictamente un JSON válido sin bloques markdown markdown alrededor (\`\`\`json).

    ESTRUCTURA EXIGIDA:
    {
      "nombre": "${nombre}",
      "cargo": "Gobernador / Servidor Público · ${fechaCtx}",
      "tags": ["Gobierno", "Seguridad", "Infraestructura"],
      "kpis_ampliados": [
        {"label": "NPS GENERAL", "valor": "+18", "nota": "Net Promoter Score digital"},
        {"label": "TRA", "valor": "72/100", "nota": "Temperatura Reputacional"},
        {"label": "SHARE OF VOICE", "valor": "34%", "nota": "Cuota de conversación"},
        {"label": "ALCANCE BRUTO", "valor": "4.2M", "nota": "Impactos estimados"}
      ],
      "sentimiento": {
        "general": { "labels": ["Positivo", "Neutro", "Negativo"], "data": [40, 30, 30] },
        "edad": { "labels": ["18-24", "25-34", "35-49", "50+"], "data": [-15, 10, 25, 35] },
        "clima_general": { "labels": ["Fav", "Neu", "Crit"], "data": [50, 30, 20] }
      },
      "kpis_bivariados": {
        "nps_partido": { "labels": ["Base", "Oposición", "Independiente"], "data": [65, -40, 10] }
      },
      "plataformas": {
        "alcance": { "labels": ["FB", "X", "TikTok", "Prensa"], "data": [40, 30, 20, 10] },
        "tono": { "labels": ["FB", "X", "TikTok"], "positivo": [60, 20, 45] }
      },
      "hallazgos_sentimiento": [
        {"titulo": "Brecha Generacional Flagrante", "cuerpo": "El rechazo se concentra en el segmento de 18 a 24 años.", "insight": "Falta narrativa para jóvenes."}
      ]
    }`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    let cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    await cacheSet(cacheKey, parsed, CACHE_TTL_SECONDS);
    return res.status(200).json({ ...parsed, _cache: 'MISS' });

  } catch (err) {
    return res.status(500).json({ error: 'Error procesando solicitud: ' + err.message });
  }
};
