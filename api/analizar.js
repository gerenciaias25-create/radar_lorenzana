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
  const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 horas
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

  const prompt = `Eres un Director General de Inteligencia Político-Digital. La fecha actual del reporte es: ${fechaCtx}.

INFORMACIÓN EXTRAÍDA DE FUENTES PARA "${nombre}":
${contextoReal}

INSTRUCCIÓN CRÍTICA: Debes responder OBLIGATORIAMENTE un JSON válido sin marcas de markdown alrededor (o en bloque \`\`\`json). Provee datos realistas, profesionales y matemáticamente coherentes para alimentar todos los gráficos interactivos y vistas del Dashboard RADAR.

ESTRUCTURA DEL JSON EXIGIDA:
{
  "nombre": "Nombre oficial completo",
  "cargo": "Cargo exacto a ${fechaCtx} · Partido Político / Entidad",
  "tags": ["Tag1", "Tag2", "Tag3", "Tag4"],
  "kpis_ampliados": [
    {"label": "NPS GENERAL", "valor": "+18", "nota": "Net Promoter Score digital", "tipo": "su"},
    {"label": "TRA", "valor": "72/100", "nota": "Temperatura Reputacional", "tipo": "ac"},
    {"label": "SHARE OF VOICE", "valor": "34%", "nota": "Cuota de conversación", "tipo": "bl"},
    {"label": "ALCANCE BRUTO", "valor": "4.2M", "nota": "Impactos estimados", "tipo": "ac"},
    {"label": "RATIO ATAQUE/DEF", "valor": "1:2.4", "nota": "Menciones adversas vs apoyo", "tipo": "da"},
    {"label": "VEL. VIRALIZACIÓN", "valor": "2.1 hrs", "nota": "Tiempo promedio a 1k menciones", "tipo": "go"}
  ],
  "sentimiento": {
    "general": {
      "labels": ["Positivo", "Neutro", "Negativo", "Polarizado"],
      "data": [38, 25, 27, 10]
    },
    "genero": {
      "labels": ["Hombres Pos.", "Hombres Neg.", "Mujeres Pos.", "Mujeres Neg."],
      "data": [42, -28, 32, -35]
    },
    "edad": {
      "labels": ["18-24", "25-34", "35-49", "50-64", "65+"],
      "data": [-15, 8, 22, 35, 40]
    },
    "partido": {
      "labels": ["Base Propia", "Oposición A", "Oposición B", "Independientes"],
      "data": [68, -55, -42, 12]
    },
    "clima_general": { "labels": ["Favorable", "Inercial", "Crítico", "Indefinido"], "data": [40, 30, 20, 10] },
    "clima_genero": { "labels": ["Hombres Fav", "Hombres Crít", "Mujeres Fav", "Mujeres Crít"], "data": [35, 25, 25, 15] },
    "clima_edad": { "labels": ["Jóvenes", "Adultos", "Mayores", "Otros"], "data": [15, 45, 30, 10] },
    "clima_partido": { "labels": ["Propio", "Oposición", "Neutros", "Otros"], "data": [50, 30, 15, 5] }
  },
  "hallazgos_sentimiento": [
    {"tipo": "ac", "titulo": "Brecha Generacional Flagrante", "cuerpo": "El rechazo se concentra de forma aguda en el segmento de 18 a 24 años.", "insight": "Falta narrativa adaptada a formatos dinámicos y jóvenes."},
    {"tipo": "da", "titulo": "Ataque Coordinado en Redes", "cuerpo": "Fuerte volumen de críticas en X/Twitter provenientes de la oposición.", "insight": "Activar protocolos de contención de narrativa."}
  ],
  "kpis_bivariados": {
    "nps_partido": { "labels": ["Base Propia", "Oposición A", "Oposición B", "Independientes"], "data": [68, -55, -42, 12] },
    "nps_demografia": { "labels": ["H-Jóvenes", "H-Adultos", "M-Jóvenes", "M-Adultas"], "data": [-18, 24, -22, 18] },
    "ratio_ataque_plataforma": { "labels": ["X / Twitter", "Noticias", "Facebook", "TikTok", "Instagram"], "data": [68, 45, 28, 22, 12] },
    "tra_evolucion": { "labels": ["Sem 1", "Sem 2", "Sem 3", "Sem 4"], "data": [55, 62, 58, 72] }
  },
  "top_of_mind": {
    "general": { "labels": ["Gestión Pública", "Estrategia Electoral", "Declaraciones", "Seguridad", "Infraestructura"], "data": [35, 25, 18, 12, 10] },
    "genero": { "labels": ["Gestión", "Electoral", "Seguridad"], "hombres": [30, 28, 15], "mujeres": [22, 18, 25] },
    "edad": {
      "grupos": ["18-29", "30-49", "50+"],
      "temas": [
        {"tema": "Propuestas Jóvenes", "valores": [40, 15, 5]},
        {"tema": "Economía / Empleo", "valores": [30, 45, 35]}
      ]
    },
    "partido": { "labels": ["Gestión", "Corrupción", "Propuestas"], "base": [50, 5, 35], "op1": [10, 65, 10], "op2": [15, 50, 15] }
  },
  "cruces_tematicos": [
    {"tipo": "su", "titulo": "Aprobación en Obras e Infraestructura", "cuerpo": "El tema de obras genera menciones favorables en sectores adultos.", "insight": "Capitalizar inauguraciones y avances territoriales."}
  ],
  "plataformas": {
    "alcance": { "labels": ["Facebook", "X / Twitter", "Noticias", "Instagram", "TikTok", "YouTube"], "data": [38, 26, 16, 10, 6, 4] },
    "tono": { "labels": ["Facebook", "X", "Noticias", "Instagram", "TikTok"], "positivo": [48, 22, 35, 58, 42], "negativo": [28, 64, 42, 18, 32] },
    "edad": {
      "labels": ["Facebook", "X", "Instagram", "TikTok"],
      "grupos": [
        {"grupo": "18-29", "data": [15, 30, 60, 75]},
        {"grupo": "30-49", "data": [45, 45, 30, 20]},
        {"grupo": "50+", "data": [40, 25, 10, 5]}
      ]
    },
    "viralizacion": { "labels": ["Facebook", "X", "TikTok", "Instagram"], "critica_horas": [3.2, 0.8, 1.5, 4.0], "propia_horas": [6.0, 3.5, 5.0, 8.0] }
  },
  "lectura_estrategica_plataformas": [
    {"plataforma": "X / TWITTER", "dato": "Campos de batalla adverso", "texto": "Plataforma dominada por la crítica. Requiere rapidez de respuesta y vocería contundente."},
    {"plataforma": "FACEBOOK", "dato": "Fortaleza orgánica", "texto": "Espacio idóneo para la transmisión de logros de gobierno y cercanía comunitaria."}
  ],
  "narrativas": {
    "favorables": [
      {"titulo": "Liderazgo y Capacidad de Gestión", "descripcion": "Resalta el cumplimiento de metas y presencia constante.", "tags": ["Gestión", "Resultados"], "bivariado": "Mayor eco en Facebook y adultos 40+"}
    ],
    "criticas": [
      {"titulo": "Cuestionamiento de Prioridades", "descripcion": "Críticas de la oposición sobre el destino de recursos.", "tags": ["Oposición", "Gasto"], "bivariado": "Dominante en X/Twitter y jóvenes", "riesgo": true}
    ],
    "neutras": [
      {"titulo": "Cobertura Institucional", "descripcion": "Notas informativas de asistencia a eventos públicos sin sesgo.", "tags": ["Prensa"], "bivariado": "Uniforme en prensa digital"}
    ]
  },
  "riesgos_oportunidades": {
    "riesgos": [
      {"nivel": "CRÍTICO", "titulo": "Escalamiento de Narrativa Crítica en Redes", "descripcion": "Riesgo de que los ataques en X penetren en prensa nacional."}
    ],
    "oportunidades": [
      {"nivel": "ALTO", "titulo": "Posicionamiento en Juventudes", "descripcion": "Veta disponible para estructurar agenda digital en TikTok/Instagram."}
    ]
  },
  "territorial": {
    "zonas": [
      {"nombre": "Zona Centro / Capital", "nps": 22, "clasificacion": "favorable", "nota": "Baluarte histórico de apoyo"},
      {"nombre": "Zona Norte", "nps": -12, "clasificacion": "adversa", "nota": "Fuerte penetración de oposición"},
      {"nombre": "Zona Oriente", "nps": 5, "clasificacion": "inercial", "nota": "Terreno de competencia activa"}
    ],
    "volumen": [
      {"nombre": "Zona Centro", "pct": 45},
      {"nombre": "Zona Norte", "pct": 30},
      {"nombre": "Zona Oriente", "pct": 25}
    ]
  }
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
    if (!jsonMatch) return res.status(500).json({ error: 'Respuesta no válida del modelo', raw: rawText.substring(0, 300) });

    cleaned = jsonMatch[0].replace(/:\s*\+(\d)/g, ': $1').replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(cleaned);
      await cacheSet(cacheKey, parsed, CACHE_TTL_SECONDS);
      return res.status(200).json({ ...parsed, _cache: 'MISS' });
    } catch (e) {
      return res.status(500).json({ error: 'JSON inválido: ' + e.message, raw: rawText.substring(0, 500) });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
