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
    console.error('Cache GET error:', e.message);
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
  } catch (e) {
    console.error('Cache SET error:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { nombre, fecha, forceRefresh } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });

  const fechaCtx = fecha || 'julio 2026';
  const CACHE_TTL_SECONDS = 6 * 60 * 60;
  const cacheKey = `radar:${nombre.trim().toLowerCase()}:${fechaCtx.trim().toLowerCase()}`;

  if (!forceRefresh) {
    const cached = await cacheGet(cacheKey);
    if (cached) return res.status(200).json({ ...cached, _cache: 'HIT' });
  }

  let contextoReal = '';
  try {
    const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

    const tweetsPromise = fetch(
      `https://api.apify.com/v2/acts/apidojo~twitter-scraper-lite/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchTerms: [`${nombre}`, `${nombre} oposicion`, `${nombre} gobierno`],
          sort: 'Latest',
          maxItems: 30,
          tweetLanguage: 'es'
        })
      }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    const noticiasPromise = fetch(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: `${nombre} columna opinion NOTICIAS ${fechaCtx}\n${nombre} oposicion denuncias edomex mexico`,
          resultsPerPage: 20,
          maxPagesPerQuery: 1,
          languageCode: 'es',
          countryCode: 'mx'
        })
      }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    const facebookPromise = fetch(
      `https://api.apify.com/v2/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchTerm: nombre, maxPosts: 20 })
      }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    const [tweetsData, noticiasData, facebookData] = await Promise.all([
      tweetsPromise, noticiasPromise, facebookPromise
    ]);

    const tweetsTexto = (tweetsData || []).slice(0, 25).map(t =>
      `TWEET de @${t.author?.userName || 'usuario'} (${t.createdAt || 's/f'}): ${t.text || t.fullText || ''}\nLikes: ${t.likeCount ?? 0} | RTs: ${t.retweetCount ?? 0}`
    ).join('\n\n');

    const organicResults = (noticiasData || []).flatMap(item => item.organicResults || []);
    const noticiasTexto = organicResults.slice(0, 20).map(r =>
      `TITULAR: ${r.title}\nURL: ${r.url}\nRESUMEN: ${r.description || ''}`
    ).join('\n\n---\n\n');

    const fbTexto = (facebookData || []).slice(0, 20).map(f =>
      `POST FB (${f.user?.name || 'Página/Usuario'}): ${f.text || f.caption || ''}\nReacciones: ${f.likes || 0} | Compartidos: ${f.shares || 0}`
    ).join('\n\n');

    contextoReal = `DATOS MULTI-PLATAFORMA EXTRAÍDOS:\n\n` +
      `=== X / TWITTER (${tweetsData?.length || 0} publicaciones) ===\n${tweetsTexto || 'Sin datos directos.'}\n\n` +
      `=== MEDIOS DIGITALES Y PRENSA (${organicResults.length} artículos) ===\n${noticiasTexto || 'Sin datos directos.'}\n\n` +
      `=== FACEBOOK (${facebookData?.length || 0} publicaciones) ===\n${fbTexto || 'Sin datos directos.'}`;

  } catch (e) {
    console.error('Apify exception:', e.message);
    contextoReal = 'Conexión parcial a fuentes. Generando análisis deductivo amplio.';
  }

  // Fragmento ajustado del Prompt enviado al modelo en /api/analizar.js

const prompt = `Eres un Director General de Inteligencia Político-Digital. La fecha actual del reporte es: ${fechaCtx}.

INFORMACIÓN EXTRAÍDA DE FUENTES PARA "${nombre}":
${contextoReal}

INSTRUCCIÓN CRÍTICA DE FORMATO Y ESTRUCTURA BIVARIADA:
No generes bloques de texto plano continuo. Extrae los datos y agrúpalos en tarjetas bivariadas con etiquetas demográficas, territoriales y de partidos políticos, replicando la estructura técnica exacta de RADAR v2.0.

Debes devolver estrictamente este formato JSON:

{
  "nombre": "${nombre}",
  "cargo": "Cargo y Partido",
  "tags": ["ANÁLISIS BIVARIADO", "CLIMA: MIXTO", "NPS-P: +12"],
  "kpis_principales": [
    {"label": "NPS POLÍTICO", "valor": "+12", "nota": "Zona mixta", "tipo": "ac"},
    {"label": "SHARE OF VOICE", "valor": "58%", "nota": "vs adversarios", "tipo": "su"},
    {"label": "RATIO ATAQUE/DEF", "valor": "2.1x", "nota": "Sin defensa orgánica", "tipo": "da"}
  ],
  "kpis_ampliados": [
    {"label": "TRA ACUMULADA", "valor": "+4.8", "nota": "Tendencia Q3", "tipo": "go"},
    {"label": "IRR RESILIENCIA", "valor": "5.4d", "nota": "Persistente", "tipo": "bl"},
    {"label": "ICN CONVERSIÓN", "valor": "35%", "nota": "Crítico <40%", "tipo": "da"}
  ],
  "hallazgos_sentimiento": [
    {
      "eje": "GÉNERO × SENTIMIENTO",
      "clase": "ac",
      "texto": "Las mujeres muestran un sentimiento adverso 15pp sobre la media.",
      "accion": "→ Priorizar vocería femenina."
    }
  ],
  "narrativas": {
    "favorables": [
      {
        "titulo": "Gestión de Obras",
        "desc": "Inversión histórica en infraestructura.",
        "tags": [
          {"texto": "♂ H 45-59", "clase": "bgen"},
          {"texto": "Base Afín", "clase": "bpar"}
        ],
        "bivariado_hallazgo": "Hombres de 45-59 años amplifican esta narrativa 2x más que la media."
      }
    ],
    "criticas": [
      {
        "titulo": "Inseguridad percepción",
        "desc": "Incremento de quejas en redes por falta de patrullaje.",
        "tags": [
          {"texto": "♀ Mujeres", "clase": "bgen"},
          {"texto": "Zona Centro", "clase": "bloc"}
        ],
        "bivariado_hallazgo": "Percepción crítica concentrada en mujeres y comercio local."
      }
    ],
    "neutras": []
  },
  "riesgos": [
    {
      "nivel": "CRÍTICO",
      "titulo": "Desgaste por servicios públicos",
      "desc": "Fallas recurrentes de suministro.",
      "bivariado": "Afecta principalmente a independientes (-18pp en aprobación)."
    }
  ],
  "oportunidades": [
    {
      "nivel": "ALTO",
      "titulo": "Defensa del presupuesto regional",
      "desc": "Convocatoria a causa común municipal.",
      "bivariado": "Potencial de conversión transpartidista (30% de independientes)."
    }
  ],
  "mapa_territorial": [
    {"zona": "Zona Centro", "nps": "-12", "clima": "🔴 ADVERSA", "nota": "Comercio informal"},
    {"zona": "Zona Norte", "nps": "+22", "clima": "🟢 FAVORABLE", "nota": "Obras entregadas"}
  ]
}`;
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://radar-politico.vercel.app',
        'X-Title': 'RADAR Politico'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        max_tokens: 7500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Error de API: ' + err });
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    let cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Respuesta no válida', raw: rawText.substring(0, 300) });

    cleaned = jsonMatch[0].replace(/:\s*\+(\d)/g, ': $1').replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(cleaned);
      await cacheSet(cacheKey, parsed, CACHE_TTL_SECONDS);
      return res.status(200).json({ ...parsed, _cache: 'MISS' });
    } catch(e) {
      return res.status(500).json({ error: 'JSON inválido: ' + e.message, raw: rawText.substring(0, 500) });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
