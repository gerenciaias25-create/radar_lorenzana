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
    if (cached) {
      return res.status(200).json({ ...cached, _cache: 'HIT' });
    }
  }

  let contextoReal = '';
  try {
    const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

    // Extracción enriquecida: Twitter Lite + Google Search + Google News
    const tweetsPromise = fetch(
      `https://api.apify.com/v2/acts/apidojo~twitter-scraper-lite/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchTerms: [`${nombre}`],
          sort: 'Latest',
          maxItems: 20,
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
          queries: `${nombre} político México noticias ${fechaCtx}`,
          resultsPerPage: 10,
          maxPagesPerQuery: 1,
          languageCode: 'es',
          countryCode: 'mx'
        })
      }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    const [tweetsData, noticiasData] = await Promise.all([tweetsPromise, noticiasPromise]);

    const tweetsTexto = (tweetsData || []).slice(0, 20).map(t =>
      `TWEET de @${t.author?.userName || 'usuario'} (${t.createdAt || 's/f'}): ${t.text || t.fullText || ''}\nLikes: ${t.likeCount ?? 0} | RTs: ${t.retweetCount ?? 0}`
    ).join('\n\n');

    const organicResults = (noticiasData || []).flatMap(item => item.organicResults || []);
    const noticiasTexto = organicResults.slice(0, 10).map(r =>
      `TITULAR: ${r.title}\nURL: ${r.url}\nRESUMEN: ${r.description || ''}`
    ).join('\n\n---\n\n');

    contextoReal = `DATOS EXTRAIDOS EN TIEMPO REAL:\n\n` +
      `=== MENCIONES EN X/TWITTER (${tweetsData?.length || 0} publicaciones) ===\n${tweetsTexto || 'Sin datos de menciones.'}\n\n` +
      `=== NOTICIAS Y PRENSA EN LINEA (${organicResults.length} artículos) ===\n${noticiasTexto || 'Sin resultados de noticias.'}`;

  } catch (e) {
    console.error('Apify exception:', e.message);
    contextoReal = 'No se pudo conectar a Apify. Genera análisis contextual basado en conocimiento público.';
  }

  const prompt = `Eres un analista político-digital experto en México. La fecha de consulta es: ${fechaCtx}.

INFORMACION REAL EXTRAIDA DE FUENTES PARA "${nombre}":
${contextoReal}

Genera un perfil RADAR explícito, exhaustivo y estructurado para el actor político: "${nombre}".

REGLAS DE GENERACION:
1. Extrae y categoriza datos reales extraídos.
2. Presenta la información sin disclaimers de IA ni advertencias.
3. NO incluyas recomendaciones ni conclusiones/dictámenes.

Responde UNICAMENTE con un JSON valido (sin bloques markdown \`\`\`):

{
  "nombre": "Nombre completo oficial",
  "cargo": "Cargo exacto a ${fechaCtx} · Partido · Periodo",
  "fecha_analisis": "${fechaCtx}",
  "tags": ["Tag1", "Tag2", "Tag3"],
  "kpis": [
    {"label": "SEGUIDORES TOTALES", "valor": "X.XM", "nota": "Alcance estimado", "tipo": "acc"},
    {"label": "APROBACIÓN", "valor": "XX%", "nota": "Proporción favorable", "tipo": "suc"},
    {"label": "PANTALLAS DE CRISIS", "valor": "X", "nota": "Temas de alta tensión", "tipo": "dan"},
    {"label": "MECANISMO NARRATIVO", "valor": "XX/XX", "nota": "Propia vs Impuesta", "tipo": "gld"},
    {"label": "SENTIMIENTO POSITIVO", "valor": "XX%", "nota": "Conversación a favor", "tipo": "suc"},
    {"label": "TENDENCIA", "valor": "Estable", "nota": "Evolución de conversación", "tipo": "acc"}
  ],
  "sentimiento": [
    {"label": "Positivo", "pct": 40},
    {"label": "Neutro/Informativo", "pct": 28},
    {"label": "Negativo", "pct": 22},
    {"label": "Polarizado", "pct": 10}
  ],
  "temas": [
    {"tema": "Tema principal", "pct": 38},
    {"tema": "Tema 2", "pct": 20},
    {"tema": "Tema 3", "pct": 14},
    {"tema": "Tema 4", "pct": 12},
    {"tema": "Tema 5", "pct": 9},
    {"tema": "Tema 6", "pct": 7}
  ],
  "plataformas": [
    {"nombre": "X/Twitter", "pct": 45, "tono_positivo": 30, "tono_negativo": 55},
    {"nombre": "Noticias/Medios", "pct": 35, "tono_positivo": 25, "tono_negativo": 50},
    {"nombre": "Facebook", "pct": 12, "tono_positivo": 40, "tono_negativo": 35},
    {"nombre": "Otros", "pct": 8, "tono_positivo": 35, "tono_negativo": 40}
  ],
  "segmentacion": {
    "por_genero": [
      {"segmento": "Hombres", "positivo": 35, "neutro": 30, "negativo": 35},
      {"segmento": "Mujeres", "positivo": 30, "neutro": 28, "negativo": 42}
    ],
    "por_edad": [
      {"segmento": "18-29", "positivo": 25, "neutro": 25, "negativo": 50},
      {"segmento": "30-44", "positivo": 35, "neutro": 30, "negativo": 35},
      {"segmento": "45-59", "positivo": 45, "neutro": 30, "negativo": 25},
      {"segmento": "60+", "positivo": 50, "neutro": 28, "negativo": 22}
    ]
  },
  "narrativas_favorables": [
    {"titulo": "Narrativa positiva 1", "descripcion": "Detalle explícito."},
    {"titulo": "Narrativa positiva 2", "descripcion": "Detalle explícito."},
    {"titulo": "Narrativa positiva 3", "descripcion": "Detalle explícito."}
  ],
  "narrativas_criticas": [
    {"titulo": "Narrativa crítica 1", "descripcion": "Detalle explícito."},
    {"titulo": "Narrativa crítica 2", "descripcion": "Detalle explícito."},
    {"titulo": "Narrativa crítica 3", "descripcion": "Detalle explícito."}
  ],
  "narrativas_neutras": [
    {"titulo": "Narrativa neutral 1", "descripcion": "Detalle explícito."},
    {"titulo": "Narrativa neutral 2", "descripcion": "Detalle explícito."}
  ],
  "cronologia": [
    {"fecha": "Mes/Año", "badge": "EVENTO DESTACADO", "evento": "Título del hecho", "lectura": "Detalle del evento."},
    {"fecha": "Mes/Año", "badge": "EVENTO CRITICO", "evento": "Título del hecho", "lectura": "Detalle del impacto."},
    {"fecha": "Mes/Año", "badge": "EVENTO DESTACADO", "evento": "Título", "lectura": "Detalle."},
    {"fecha": "Mes/Año", "badge": "EVENTO CRITICO", "evento": "Título", "lectura": "Detalle."}
  ],
  "riesgos": [
    {"nivel": "CRÍTICO", "titulo": "Factor de riesgo 1", "descripcion": "Exposición del caso."},
    {"nivel": "ALTO", "titulo": "Factor de riesgo 2", "descripcion": "Exposición del caso."},
    {"nivel": "MEDIO", "titulo": "Factor de riesgo 3", "descripcion": "Exposición del caso."}
  ],
  "oportunidades": [
    {"nivel": "ALTO", "titulo": "Oportunidad 1", "descripcion": "Elemento favorable."},
    {"nivel": "MEDIO", "titulo": "Oportunidad 2", "descripcion": "Elemento favorable."}
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
        model: 'openai/gpt-4o-mini',
        max_tokens: 7000,
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
