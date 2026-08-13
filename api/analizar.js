// api/analizar.js
export const config = {
  maxDuration: 60,
};

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

  const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: 'Falta OPENROUTER_API_KEY en las variables de entorno de Vercel.' });
  }

  // ---------- CACHÉ ----------
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

// Reducimos el timeout a 8000ms para asegurar respuesta rápida en Vercel
async function llamarActorApify(actorPath, payload, token, timeoutMs = 8000) {
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

async function scrapeActor(nombre, token) {
  // Reducimos a las 3 fuentes más rápidas y críticas para evitar timeouts severos
  const tareas = [
    llamarActorApify('apify~google-search-scraper', {
      queries: `"${nombre}" (noticias OR opinión OR declaraciones)`,
      resultsPerPage: 15,
      maxPagesPerQuery: 1,
    }, token).then(items => tag(items, 'prensa')),

    llamarActorApify('apidojo~tweet-scraper', {
      searchTerms: [nombre],
      maxItems: 20,
      sort: 'Latest',
    }, token).then(items => tag(items, 'twitter')),

    llamarActorApify('apify~facebook-posts-scraper', {
      search: nombre,
      resultsLimit: 15,
    }, token).then(items => tag(items, 'facebook')),
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
    .slice(0, 100);

  return { count: textos.length, items: textos };
}

function tag(items, fuente) {
  return (items || []).map(i => ({ ...i, __fuente: fuente }));
}

// =========================================================
// OPENROUTER & SCHEMAS
// =========================================================

const SCHEMAS = {
  radar: `{
  "actor": {"cargo": string, "entidad": string, "partido": string, "periodo": string},
  "kpis": {
    "npsPartido": [{"label": string, "valor": number}],
    "npsDemografico": [{"label": string, "valor": number}],
    "ratioAtaqueDefensa": [{"plataforma": string, "ratio": number}],
    "traSemanal": {"labels": [string], "valores": [number]}
  },
  "sentimiento": {
    "general": {"labels": [string], "valores": [number]},
    "genero": {"labels": [string], "valores": [number]},
    "edad": {"labels": [string], "valores": [number]},
    "partido": {"labels": [string], "valores": [number]},
    "hallazgos": [{"titulo": string, "texto": string, "accion": string}]
  },
  "topOfMind": {
    "general": {"temas": [string], "valores": [number]},
    "genero": {"temas": [string], "series": [{"nombre": string, "valores": [number]}]},
    "edad": {"temas": [string], "series": [{"nombre": string, "valores": [number]}]},
    "partido": {"temas": [string], "series": [{"nombre": string, "valores": [number]}]},
    "cruces": [{"titulo": string, "texto": string, "accion": string}]
  },
  "plataformas": {
    "alcance": [{"plataforma": string, "valor": number}],
    "tono": [{"plataforma": string, "positivo": number, "negativo": number}],
    "porEdad": [{"plataforma": string, "series": [{"nombre": string, "valor": number}]}],
    "viralizacion": [{"plataforma": string, "critica": number, "propia": number}],
    "lecturaEstrategica": [{"titulo": string, "texto": string, "alerta": boolean}]
  },
  "narrativas": {
    "favorables": [{"titulo": string, "descripcion": string, "tags": [string], "bivariado": string}],
    "criticas": [{"titulo": string, "descripcion": string, "tags": [string], "bivariado": string}],
    "neutras": [{"titulo": string, "descripcion": string, "tags": [string], "bivariado": string}]
  },
  "riesgosOportunidades": {
    "riesgos": [{"nivel": "CRÍTICO"|"ALTO"|"MEDIO"|"BAJO", "titulo": string, "descripcion": string, "bivariado": string}],
    "oportunidades": [{"nivel": "ALTO"|"MEDIO"|"BAJO", "titulo": string, "descripcion": string, "bivariado": string}]
  },
  "territorial": {
    "zonas": [{"nombre": string, "nps": number, "clasificacion": "favorable"|"adversa"|"inercial", "nota": string}],
    "volumenPorZona": [{"zona": string, "volumen": number}]
  },
  "resumenEjecutivo": string
}`,
  emociones: `{
  "cabecera": {
    "concepto": string,
    "conceptoDescripcion": string,
    "nivelRiesgo": "CRÍTICO"|"ALTO"|"MEDIO"|"BAJO",
    "cargoContexto": string
  },
  "emociones": [
    {"key": "ira"|"sorpresa"|"anticipacion"|"tristeza"|"asco"|"alegria"|"confianza"|"miedo",
     "activa": boolean, "intensidad": 0|1|2|3, "sublabel": string,
     "disparadores": [string], "consecuencias": [string]}
  ],
  "secundarias": [{"nombre": string, "texto": string}],
  "problematicas": [string],
  "temores": [string],
  "orgullos": [string],
  "citas": [{"texto": string, "tema": string, "emocion": string, "fuente": string}],
  "temasChart": [{"tema": string, "valor": number}],
  "semaforo": [{"etiqueta": string, "valor": string, "nivel": "critico"|"alto"|"medio"|"bajo"}],
  "diadas": [{"nombre": string, "formula": string, "tipo": "Primaria"|"Secundaria", "texto": string, "riesgo": "CRÍTICO"|"ALTO"|"MEDIO"|"BAJO", "score": number}],
  "diadaInterpretacion": string,
  "preguntaPolitica": string,
  "preguntaDescripcion": string,
  "gobSemaforo": [{"etiqueta": string, "valor": string, "nivel": "critico"|"alto"|"medio"|"bajo"}],
  "partidos": [{"nombre": string, "emocion": string, "capital": string, "tendencia": string}],
  "partidosChart": [{"iraAsco": number, "decepcionTristeza": number, "interesDisponible": number}],
  "actores": [{"nombre": string, "rol": string, "fortaleza": string, "debilidad": string, "oportunidad": string, "amenaza": string, "emocionQueRecibe": string, "riesgoElectoral": string}],
  "actoresRadar": [[number, number, number, number, number, number]],
  "segmentos": [{
    "tipo": string, "arquetipo": string, "subtitulo": string, "peso": string, "persuabilidad": string,
    "fraseEmblema": string,
    "perfil": {"edad": string, "zona": string, "ocupacion": string, "escolaridad": string, "digital": string, "historialElectoral": string},
    "emocional": {"emocion": string, "vidaCotidiana": string, "tension": string, "dolor": string, "miedo": string, "orgullo": string, "narrativa": string},
    "estrategia": {"problematicas": [string], "orgulloComunitario": string, "consumoDigital": string, "loAcerca": string, "loAleja": string, "frame": string, "palanca": string},
    "vector": {"canal": string, "tono": string, "formato": string}
  }],
  "resumenEjecutivo": string
}`,
  tensiones: `{
  "actor": {"entidad": string, "cargo": string, "periodo": string},
  "kpis": {
    "totalTensiones": number,
    "promedioSTS": number,
    "tensionCritica": string,
    "emocionDominante": string,
    "zonaSensible": string
  },
  "ranking": [
    {
      "id": number,
      "nombre": string,
      "score": number,
      "color": string,
      "nivel": "Alto" | "Relevante" | "Medio" | "Bajo",
      "delta": string,
      "emocion": string,
      "intensidad": number,
      "narrativa": string,
      "actor": string,
      "territorio": string,
      "politica": string,
      "evidencia": string,
      "recomendacion": string
    }
  ],
  "emociones": [
    {"nombre": string, "intensidad": number, "color": string, "cambio": string, "lectura": string, "porcentaje": number}
  ],
  "narrativas": [
    {"nombre": string, "tema": string, "actor": string, "politica": string, "frase": string, "origen": string}
  ],
  "territorios": [
    {"nombre": string, "nivel": string, "color": string, "emocion": string, "tension": string, "observaciones": string}
  ],
  "riesgos": [
    {"nombre": string, "srr": number, "actor": string, "tipo": string, "probabilidad": string, "accion": string, "color": string}
  ],
  "trayectoria": [
    {"nombre": string, "t3": number, "t2": number, "t1": number, "ta": number, "tipo": string, "velocidad": string}
  ],
  "alertas": [
    {
      "titulo": string,
      "rows": [
        ["Territorio", string],
        ["Emoción", string],
        ["Actor expuesto", string],
        ["Qué ocurrió", string],
        ["Narrativa activa", string],
        ["Fuente verificadora", string],
        ["Riesgo", string],
        ["Escalamiento", string],
        ["Acción inmediata", string]
      ]
    }
  ],
  "hallazgoEmocional": string,
  "hallazgoTrayectoria": string,
  "resumenEjecutivo": string
}`,
  opositor: `{
  "actor": {"cargo": string, "partido": string, "periodo": string, "aspiracion": string},
  "vulnerabilidades": [{"titulo": string, "nivel": "CRÍTICO"|"ALTO"|"MEDIO", "bullets": [string], "score": number}],
  "fortalezas": [{"titulo": string, "texto": string}],
  "perfil": {
    "rows": [{"label": string, "value": string}],
    "cronologia": [{"periodo": string, "titulo": string, "descripcion": string}],
    "ierPorCargo": [{"cargo": string, "valor": number}]
  },
  "contradicciones": {
    "ranking": [{"codigo": string, "titulo": string, "score": number, "nivel": "CRÍTICO"|"ALTO"|"MEDIO"}],
    "destacados": [{"titulo": string, "texto": string, "nivel": "CRÍTICO"|"ALTO"|"MEDIO"|"BAJO"}],
    "tabla": [{"codigo": string, "tipo": string, "declaracion": string, "realidad": string, "dano": "CRÍTICO"|"ALTO"|"MEDIO", "canal": string}]
  },
  "vectoresAtaque": [{"codigo": string, "titulo": string, "nivel": "CRÍTICO"|"ALTO"|"MEDIO", "fuenteTag": string, "argumento": string, "evidencias": [string], "fraseLista": string}],
  "redDePoder": {
    "radar": [number,number,number,number,number,number],
    "alertas": [{"nivel": "CRÍTICO"|"ALTO"|"MEDIO", "titulo": string, "bullets": [string]}],
    "tabla": [{"actor": string, "vinculo": string, "riesgoOportunidad": string}]
  }
}`
};

function buildPrompt({ skill, actorName, actor2Name, mes, anio, datosActor1, datosActor2, schema }) {
  const bloque1 = resumirFuentes(datosActor1);
  const bloque2 = datosActor2 ? resumirFuentes(datosActor2) : null;

  const contexto = actor2Name
    ? `Personaje A: ${actorName}\nPersonaje B: ${actor2Name}\n\n--- Datos crudos extraídos sobre ${actorName} ---\n${bloque1}\n\n--- Datos crudos extraídos sobre ${actor2Name} ---\n${bloque2}`
    : `Personaje: ${actorName}\n\n--- Datos crudos extraídos ---\n${bloque1}`;

  const system = `Eres un analista de inteligencia político-electoral en México. Produce un análisis estructurado ÚNICAMENTE en formato JSON, sin texto adicional, sin markdown, sin backticks.

Reglas:
- Responde EXCLUSIVAMENTE con un objeto JSON válido que cumpla exactamente este esquema:
${schema}
- Mantén tono analítico y profesional.`;

  const user = `Periodo evaluado: ${mes} ${anio}\nSkill solicitada: ${skill}\n\n${contexto}\n\nGenera el JSON con el esquema indicado.`;

  return { system, user };
}

function resumirFuentes(bloque) {
  if (!bloque || !bloque.items || bloque.items.length === 0) {
    return '(No se obtuvieron resultados de scraping en vivo; produce el análisis con criterio experto general sobre el contexto político mexicano.)';
  }
  return bloque.items
    .slice(0, 40)
    .map(i => `[${i.fuente}] ${i.texto.slice(0, 200)}`)
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
      max_tokens: 3500,
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
// CACHÉ
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
  } catch {}
}

function upstashConfig() {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
}
