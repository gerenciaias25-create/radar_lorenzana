// api/analizar.js
// Pipeline: Apify (scraping multi-fuente) -> OpenRouter/GPT (estructura en JSON) -> Upstash (cache) -> respuesta
//
// Variables de entorno requeridas en Vercel:
//   APIFY_API_TOKEN         token de Apify
//   OPENROUTER_API_KEY      token de OpenRouter
//   OPENROUTER_MODEL        (opcional) ej. "openai/gpt-4o-mini" — default abajo
//   UPSTASH_REDIS_REST_URL  (opcional, activa caché)
//   UPSTASH_REDIS_REST_TOKEN(opcional, activa caché)
//
// NUNCA se exponen estos valores al cliente: todo corre server-side.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const params = req.method === 'POST' ? req.body : req.query;
  const {
    skill = 'radar',
    actor = '',
    actor2 = '',
    mes = 'Agosto',
    anio = '2026',
  } = params || {};

  const actorName = String(actor).trim();
  const actor2Name = String(actor2 || '').trim();

  if (!actorName) {
    return res.status(400).json({ error: 'El parámetro "actor" es requerido.' });
  }
  if (skill === 'opositor' && !actor2Name) {
    return res.status(400).json({ error: 'La Skill "Opositor" requiere dos personajes: "actor" y "actor2".' });
  }

  const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: 'Falta OPENROUTER_API_KEY en las variables de entorno de Vercel.' });
  }

  // ---------- CACHÉ (Upstash Redis REST) ----------
  const cacheKey = `radar:${skill}:${norm(actorName)}:${norm(actor2Name)}:${mes}:${anio}`;
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  try {
    // ---------- 1. SCRAPING (Apify) ----------
    const [datosActor1, datosActor2] = await Promise.all([
      scrapeActor(actorName, APIFY_TOKEN),
      actor2Name ? scrapeActor(actor2Name, APIFY_TOKEN) : Promise.resolve(null),
    ]);

    // ---------- 2. ESTRUCTURACIÓN (OpenRouter) ----------
    const schema = SCHEMAS[skill] || SCHEMAS.radar;
    const prompt = buildPrompt({ skill, actorName, actor2Name, mes, anio, datosActor1, datosActor2, schema });

    const structured = await callOpenRouter(prompt, OPENROUTER_KEY);

    const payload = {
      skill,
      actor: actorName,
      actor2: actor2Name || null,
      periodo: `${mes} ${anio}`,
      fuentesEncontradas: (datosActor1?.count || 0) + (datosActor2?.count || 0),
      data: structured,
      cached: false,
    };

    await cacheSet(cacheKey, payload, 60 * 60 * 6); // 6 horas
    return res.status(200).json(payload);
  } catch (err) {
    console.error('Error en /api/analizar:', err);
    return res.status(500).json({ error: 'Error procesando el análisis.', detail: String(err.message || err) });
  }
}

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '-');
}

// =========================================================
// APIFY: llamadas a los actores de scraping
// =========================================================

async function llamarActorApify(actorPath, payload, token, timeoutMs = 25000) {
  if (!token) return [];
  try {
    const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${token}&timeout=${Math.round(timeoutMs / 1000)}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

// Scrapea todas las fuentes para un actor político y devuelve texto unificado + metadatos
async function scrapeActor(nombre, token) {
  const tareas = [
    // Prensa / noticias vía Google
    llamarActorApify('apify~google-search-scraper', {
      queries: `"${nombre}" (noticias OR opinión OR declaraciones)`,
      resultsPerPage: 20,
      maxPagesPerQuery: 1,
    }, token).then(items => tag(items, 'prensa')),

    // Twitter/X
    llamarActorApify('apidojo~tweet-scraper', {
      searchTerms: [nombre],
      maxItems: 30,
      sort: 'Latest',
    }, token).then(items => tag(items, 'twitter')),

    // Facebook
    llamarActorApify('apify~facebook-posts-scraper', {
      search: nombre,
      resultsLimit: 20,
    }, token).then(items => tag(items, 'facebook')),

    // Instagram
    llamarActorApify('apify~instagram-scraper', {
      search: nombre,
      resultsLimit: 15,
    }, token).then(items => tag(items, 'instagram')),

    // TikTok
    llamarActorApify('clockworks~tiktok-scraper', {
      searchQueries: [nombre],
      resultsPerPage: 15,
    }, token).then(items => tag(items, 'tiktok')),

    // YouTube (comentarios/menciones en videos de noticias)
    llamarActorApify('streamers~youtube-scraper', {
      searchKeywords: nombre,
      maxResults: 10,
    }, token).then(items => tag(items, 'youtube')),
  ];

  const resultados = await Promise.all(tareas);
  const rawItems = resultados.flat();

  const textos = rawItems
    .map(i => ({
      fuente: i.__fuente,
      texto: i.snippet || i.full_text || i.text || i.caption || i.title || i.description || '',
      fecha: i.date || i.timestamp || i.publishedAt || null,
      autor: i.author || i.username || i.ownerUsername || i.channelName || null,
      likes: i.likeCount ?? i.likes ?? i.diggCount ?? null,
    }))
    .filter(t => t.texto && t.texto.length > 8)
    .slice(0, 120); // límite para no reventar el prompt / costos

  return { count: textos.length, items: textos };
}

function tag(items, fuente) {
  return (items || []).map(i => ({ ...i, __fuente: fuente }));
}

// =========================================================
// OPENROUTER: estructuración de los datos en JSON fijo
// =========================================================

const SCHEMAS = {
  // Esquema completo RADAR — 7 pestañas: KPIs, Sentimiento, Top of Mind, Plataformas,
  // Narrativas, Riesgos&Oportunidades, Mapa Territorial. Debe ser AMPLIO en contenido:
  // no reducir el número de items sugerido en los comentarios.
  radar: `{
  "actor": {"cargo": string, "entidad": string, "partido": string, "periodo": string},

  "kpis": {
    "npsPartido": [{"label": string, "valor": number}],            // 4-6 segmentos por identidad partidista
    "npsDemografico": [{"label": string, "valor": number}],        // 6-8 cruces género x edad (ej. "H 18-29", "M 18-29"...)
    "ratioAtaqueDefensa": [{"plataforma": string, "ratio": number}], // 5-6 plataformas, ratio decimal
    "traSemanal": {"labels": [string], "valores": [number]}         // 10-14 puntos, temperatura reputacional semanal
  },

  "sentimiento": {
    "general": {"labels": [string], "valores": [number]},   // 4 categorías: Positivo/Neutro/Negativo/Polarizado
    "genero": {"labels": [string], "valores": [number]},    // 6 combinaciones (ej. H Pos/Neu/Neg, M Pos/Neu/Neg)
    "edad": {"labels": [string], "valores": [number]},      // 4 grupos etarios, valor NPS
    "partido": {"labels": [string], "valores": [number]},   // 3-4 identidades partidistas, valor NPS
    "hallazgos": [{"titulo": string, "texto": string, "accion": string}]  // EXACTAMENTE 4: género×sentimiento, partido×sentimiento, edad×sentimiento, localidad×sentimiento
  },

  "topOfMind": {
    "general": {"temas": [string], "valores": [number]},                    // 6-8 temas con % de peso
    "genero": {"temas": [string], "series": [{"nombre": string, "valores": [number]}]},     // series: Hombres, Mujeres
    "edad": {"temas": [string], "series": [{"nombre": string, "valores": [number]}]},        // series: por cada grupo etario (3-4)
    "partido": {"temas": [string], "series": [{"nombre": string, "valores": [number]}]},     // series: base, oposición, independientes
    "cruces": [{"titulo": string, "texto": string, "accion": string}]  // EXACTAMENTE 4: género×tema, edad×tema, partido×tema, localidad×tema
  },

  "plataformas": {
    "alcance": [{"plataforma": string, "valor": number}],                                    // 5-6 plataformas, % alcance
    "tono": [{"plataforma": string, "positivo": number, "negativo": number}],                 // mismas plataformas
    "porEdad": [{"plataforma": string, "series": [{"nombre": string, "valor": number}]}],     // series = grupos etarios (4)
    "viralizacion": [{"plataforma": string, "critica": number, "propia": number}],            // horas a 1K interacciones
    "lecturaEstrategica": [{"titulo": string, "texto": string, "alerta": boolean}]  // 3 items, uno por plataforma principal (usar alerta:true si es brecha crítica)
  },

  "narrativas": {
    "favorables": [{"titulo": string, "descripcion": string, "tags": [string], "bivariado": string}],  // 2-3 items
    "criticas": [{"titulo": string, "descripcion": string, "tags": [string], "bivariado": string}],    // 3-4 items
    "neutras": [{"titulo": string, "descripcion": string, "tags": [string], "bivariado": string}]      // 3-4 items
  },

  "riesgosOportunidades": {
    "riesgos": [{"nivel": "CRÍTICO"|"ALTO"|"MEDIO"|"BAJO", "titulo": string, "descripcion": string, "bivariado": string}],       // 4 items
    "oportunidades": [{"nivel": "ALTO"|"MEDIO"|"BAJO", "titulo": string, "descripcion": string, "bivariado": string}]            // 4 items
  },

  "territorial": {
    "zonas": [{"nombre": string, "nps": number, "clasificacion": "favorable"|"adversa"|"inercial", "nota": string}],  // 6-8 zonas/colonias reales de la localidad
    "volumenPorZona": [{"zona": string, "volumen": number}]  // mismas zonas, % del total de menciones
  },

  "resumenEjecutivo": string
}`,
  emociones: `{
  "emociones": [{"key": "joy"|"trust"|"fear"|"surprise"|"sadness"|"disgust"|"anger"|"anticipation", "label": string, "intensity": 1|2|3, "activa": boolean, "disparadores": [string]}],
  "diadas": [{"nombre": string, "formula": string, "texto": string}],
  "problematicas": [string],
  "temores": [string],
  "orgullos": [string],
  "citas": [{"texto": string, "tema": string, "emocion": string, "fuente": string}],
  "resumenEjecutivo": string
}`,
  tensiones: `{
  "alertas": [{"nivel": "ALTO"|"MEDIO"|"BAJO", "titulo": string, "descripcion": string}],
  "tensiones": [{"actorA": string, "actorB": string, "tema": string, "intensidad": 1|2|3, "descripcion": string}],
  "narrativas": [{"titulo": string, "resumen": string, "alcance": "alto"|"medio"|"bajo"}],
  "riesgos": [{"titulo": string, "probabilidad": "alta"|"media"|"baja", "impacto": "alto"|"medio"|"bajo", "descripcion": string}],
  "territorios": [{"zona": string, "nivelTension": number}],
  "trayectoria": [{"fecha": string, "evento": string, "nivelTension": number}],
  "emocionesDominantes": [{"emocion": string, "valor": number}],
  "resumenEjecutivo": string
}`,
  opositor: `{
  "overview": {"actorA": string, "actorB": string, "resumen": string},
  "radar": {"ejes": [string], "valoresA": [number], "valoresB": [number]},   // 5-7 ejes (ej. presencia digital, favorabilidad, cobertura, red de poder, controversia)
  "favorabilidad": {"actorA": number, "actorB": number},
  "coberturaMediatica": {"actorA": number, "actorB": number},
  "redDePoder": {"actorA": [string], "actorB": [string]},
  "vulnerabilidades": {"actorA": [string], "actorB": [string]},
  "puntosFuertes": {"actorA": [string], "actorB": [string]},
  "resumenEjecutivo": string
}`,
};

function buildPrompt({ skill, actorName, actor2Name, mes, anio, datosActor1, datosActor2, schema }) {
  const bloque1 = resumirFuentes(datosActor1);
  const bloque2 = datosActor2 ? resumirFuentes(datosActor2) : null;

  const contexto = actor2Name
    ? `Personaje A: ${actorName}\nPersonaje B: ${actor2Name}\n\n--- Datos crudos extraídos sobre ${actorName} ---\n${bloque1}\n\n--- Datos crudos extraídos sobre ${actor2Name} ---\n${bloque2}`
    : `Personaje: ${actorName}\n\n--- Datos crudos extraídos ---\n${bloque1}`;

  const system = `Eres un analista de inteligencia político-electoral en México. Recibes texto crudo extraído de prensa, X/Twitter, Facebook, Instagram, TikTok y YouTube sobre uno o dos personajes políticos, y debes producir un análisis estructurado ÚNICAMENTE en formato JSON, sin texto adicional, sin markdown, sin backticks.

Reglas:
- Responde EXCLUSIVAMENTE con un objeto JSON válido que cumpla exactamente este esquema y su estructura de campos:
${schema}
- Los comentarios "//" junto a cada campo indican la CANTIDAD de elementos esperada (ej. "4-6 segmentos", "EXACTAMENTE 4"). Respeta esas cantidades: el reporte debe ser AMPLIO y detallado, no minimalista. No devuelvas arrays vacíos ni de un solo elemento si el esquema pide varios.
- Basa el análisis en los datos crudos proporcionados (menciones, notas de prensa, publicaciones). Si hay poca información en las fuentes, usa criterio experto sobre el contexto político-electoral mexicano y sobre la localidad/entidad indicada para producir estimaciones razonables y realistas (zonas/colonias reales si se conocen, temas de agenda pública típicos de un gobierno local o estatal, etc.), pero evita inventar hechos específicos no verificables (acusaciones penales concretas, nombres de terceros, cifras oficiales exactas).
- No uses lenguaje partidista ni tomes postura política; mantén tono analítico y profesional, como un reporte de consultoría electoral real.
- Todos los textos en español de México, con terminología de análisis político-digital (NPS-P, TRA, bivariado, top of mind, etc.) igual que la usaría un consultor senior.`;

  const user = `Periodo evaluado: ${mes} ${anio}\nSkill solicitada: ${skill}\n\n${contexto}\n\nGenera el JSON con el esquema indicado.`;

  return { system, user };
}

function resumirFuentes(bloque) {
  if (!bloque || !bloque.items || bloque.items.length === 0) {
    return '(No se obtuvieron resultados de scraping en vivo; produce el análisis con criterio experto general sobre el contexto político mexicano.)';
  }
  return bloque.items
    .slice(0, 60)
    .map(i => `[${i.fuente}] ${i.texto.slice(0, 280)}`)
    .join('\n');
}

async function callOpenRouter({ system, user }, apiKey) {
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://radar-lorenzana.vercel.app',
      'X-Title': 'RADAR Politico',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.4,
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`OpenRouter error ${r.status}: ${errText.slice(0, 300)}`);
  }

  const data = await r.json();
  const raw = data?.choices?.[0]?.message?.content || '{}';
  const clean = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error('OpenRouter devolvió un JSON inválido.');
  }
}

// =========================================================
// CACHÉ: Upstash Redis (REST API) — opcional, reduce costos
// =========================================================

async function cacheGet(key) {
  const { url, token } = upstashConfig();
  if (!url) return null;
  try {
    const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.result) return null;
    return JSON.parse(j.result);
  } catch {
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  const { url, token } = upstashConfig();
  if (!url) return;
  try {
    await fetch(`${url}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  } catch {
    // silencioso: la caché es una optimización, no debe tumbar la respuesta
  }
}

function upstashConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}
