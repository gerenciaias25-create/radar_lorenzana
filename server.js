import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Servir archivos estáticos
app.use(express.static(__dirname));

// Servir la vista principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// =========================================================
// TRABAJOS EN SEGUNDO PLANO
// El proxy de Hostinger corta peticiones que tardan mucho
// (504 Gateway Timeout) mucho antes de que Apify + OpenRouter
// terminen. Por eso /api/analizar ya NO espera el resultado:
// crea un job, responde de inmediato, y procesa en background.
// El frontend consulta /api/estado/:jobId hasta que termine.
// =========================================================
const JOBS = new Map(); // jobId -> { status: 'processing'|'done'|'error', result?, error? }
const JOB_TTL_MS = 15 * 60 * 1000; // 15 min, luego se limpia de memoria

function limpiarJob(jobId) {
  setTimeout(() => JOBS.delete(jobId), JOB_TTL_MS);
}

// Endpoint que INICIA el análisis (responde en milisegundos)
app.post('/api/analizar', (req, res) => {
  const params = req.body || {};

  const {
    skill = 'radar',
    actor = '',
    actor2 = '',
    mes = 'Agosto',
    anio = '2026',
  } = params;

  const actorName = String(actor).trim();
  const actor2Name = String(actor2 || '').trim();

  if (!actorName) {
    return res.status(400).json({ error: 'El parámetro "actor" es requerido.' });
  }

  const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: 'Falta OPENROUTER_API_KEY en las variables de entorno.' });
  }

  const jobId = crypto.randomUUID();
  JOBS.set(jobId, { status: 'processing', progreso: 'Extrayendo fuentes en Apify...' });

  // Se procesa en segundo plano; NO se espera (no "await") para
  // poder responder al cliente de inmediato.
  procesarAnalisis({ jobId, skill, actorName, actor2Name, mes, anio, APIFY_TOKEN, OPENROUTER_KEY });

  return res.status(202).json({ jobId });
});

// Endpoint que CONSULTA el estado/resultado de un job ya iniciado
app.get('/api/estado/:jobId', (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job no encontrado o expirado.' });
  }
  return res.status(200).json(job);
});

async function procesarAnalisis({ jobId, skill, actorName, actor2Name, mes, anio, APIFY_TOKEN, OPENROUTER_KEY }) {
  try {
    console.log(`[+] Iniciando análisis (${jobId}) para: ${actorName} ${actor2Name ? 'vs ' + actor2Name : ''} (${skill})`);

    JOBS.set(jobId, { status: 'processing', progreso: 'Extrayendo fuentes en Apify (X, Facebook, Instagram, TikTok, YouTube, prensa)...' });

    // 1. Scraping masivo (6 fuentes en paralelo)
    const [datosActor1, datosActor2] = await Promise.all([
      scrapeActor(actorName, APIFY_TOKEN),
      actor2Name ? scrapeActor(actor2Name, APIFY_TOKEN) : Promise.resolve(null),
    ]);

    JOBS.set(jobId, { status: 'processing', progreso: 'Estructurando datos con OpenRouter...' });

    // 2. Estructuración con OpenRouter
    const schema = SCHEMAS[skill] || SCHEMAS.radar;
    const prompt = buildPrompt({ skill, actorName, actor2Name, mes, anio, datosActor1, datosActor2, schema });
    const structured = await callOpenRouter(prompt, OPENROUTER_KEY);

    // 3. Normalizar respuesta para asegurar que todos los arrays existan
    const normalized = normalizeResponse(structured, skill);

    JOBS.set(jobId, {
      status: 'done',
      result: {
        skill,
        actor: actorName,
        actor2: actor2Name || null,
        periodo: `${mes} ${anio}`,
        fuentesEncontradas: (datosActor1?.count || 0) + (datosActor2?.count || 0),
        data: normalized,
      },
    });
    limpiarJob(jobId);
  } catch (err) {
    console.error(`[-] Error en job ${jobId}:`, err);
    JOBS.set(jobId, {
      status: 'error',
      error: 'Error procesando el análisis.',
      detail: String(err.message || err),
    });
    limpiarJob(jobId);
  }
}

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Servidor RADAR activo' });
});

// Puerto
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor RADAR escuchando en el puerto ${PORT}`);
});

server.timeout = 180000;

// =========================================================
// NORMALIZACIÓN DE RESPUESTA
// =========================================================
function normalizeResponse(data, skill) {
  if (!data || typeof data !== 'object') data = {};

  const ensureArray = (obj, key, defaultVal = []) => {
    if (!obj[key]) obj[key] = defaultVal;
    if (!Array.isArray(obj[key])) obj[key] = defaultVal;
    return obj;
  };

  const ensureObject = (obj, key, defaultVal = {}) => {
    if (!obj[key] || typeof obj[key] !== 'object' || Array.isArray(obj[key])) obj[key] = defaultVal;
    return obj;
  };

  // RADAR
  if (skill === 'radar') {
    ensureObject(data, 'actor', { cargo: 'Servidor(a) Público(a)', entidad: 'Sin entidad', partido: '—', periodo: '' });
    ensureObject(data, 'kpis', {});
    ensureArray(data.kpis, 'npsPartido', [{ label: 'Sin datos', valor: 0 }]);
    ensureArray(data.kpis, 'npsDemografico', [{ label: 'Sin datos', valor: 0 }]);
    ensureArray(data.kpis, 'ratioAtaqueDefensa', [{ plataforma: 'Sin datos', ratio: 0 }]);
    ensureObject(data.kpis, 'traSemanal', { labels: ['Sin datos'], valores: [0] });
    ensureObject(data, 'sentimiento', {});
    ensureObject(data.sentimiento, 'general', { labels: ['Sin datos'], valores: [0] });
    ensureObject(data.sentimiento, 'genero', { labels: ['Sin datos'], valores: [0] });
    ensureObject(data.sentimiento, 'edad', { labels: ['Sin datos'], valores: [0] });
    ensureObject(data.sentimiento, 'partido', { labels: ['Sin datos'], valores: [0] });
    ensureArray(data.sentimiento, 'hallazgos', []);
    ensureObject(data, 'topOfMind', {});
    ensureObject(data.topOfMind, 'general', { temas: ['Sin datos'], valores: [0] });
    ensureObject(data.topOfMind, 'genero', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureObject(data.topOfMind, 'edad', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureObject(data.topOfMind, 'partido', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureArray(data.topOfMind, 'cruces', []);
    ensureObject(data, 'plataformas', {});
    ensureArray(data.plataformas, 'alcance', [{ plataforma: 'Sin datos', valor: 0 }]);
    ensureArray(data.plataformas, 'tono', [{ plataforma: 'Sin datos', positivo: 0, negativo: 0 }]);
    ensureArray(data.plataformas, 'porEdad', [{ plataforma: 'Sin datos', series: [{ nombre: '—', valor: 0 }] }]);
    ensureArray(data.plataformas, 'viralizacion', [{ plataforma: 'Sin datos', critica: 0, propia: 0 }]);
    ensureArray(data.plataformas, 'lecturaEstrategica', []);
    ensureObject(data, 'narrativas', {});
    ensureArray(data.narrativas, 'favorables', []);
    ensureArray(data.narrativas, 'criticas', []);
    ensureArray(data.narrativas, 'neutras', []);
    ensureObject(data, 'riesgosOportunidades', {});
    ensureArray(data.riesgosOportunidades, 'riesgos', []);
    ensureArray(data.riesgosOportunidades, 'oportunidades', []);
    ensureObject(data, 'territorial', {});
    ensureArray(data.territorial, 'zonas', []);
    ensureArray(data.territorial, 'volumenPorZona', []);
    if (!data.resumenEjecutivo) data.resumenEjecutivo = 'Sin datos de resumen ejecutivo disponibles.';
  }

  // EMOCIONES
  if (skill === 'emociones') {
    if (!data.territory) data.territory = 'Sin datos';
    if (!data.subtitle) data.subtitle = '';
    if (!data.date) data.date = '';
    if (!data.riskLevel) data.riskLevel = 'MEDIO';
    if (typeof data.ivEstimado !== 'number') data.ivEstimado = 0;
    if (!data.concept) data.concept = 'Sin datos';
    if (!data.conceptDesc) data.conceptDesc = 'No se recibieron datos estructurados del backend.';
    ensureArray(data, 'emotions', []);
    ensureArray(data, 'secondary', []);
    ensureArray(data, 'problematics', []);
    ensureArray(data, 'fears', []);
    ensureArray(data, 'prides', []);
    ensureArray(data, 'quotes', []);
    ensureArray(data, 'temasChart', [['Sin datos', 0, '#94a3b8']]);
    ensureArray(data, 'semaforo', []);
    ensureArray(data, 'dyads', []);
    if (!data.dyadInterp) data.dyadInterp = '';
    if (!data.preguntaPolitica) data.preguntaPolitica = '';
    if (!data.preguntaDesc) data.preguntaDesc = '';
    ensureArray(data, 'govSemaforo', []);
    ensureArray(data, 'partidos', []);
    ensureArray(data, 'partidosChart', [[0, 0, 0]]);
    ensureArray(data, 'actores', []);
    ensureObject(data, 'actoresRadar', { labels: [], data: [], colors: [] });
    if (!data.alertaEstrategica) data.alertaEstrategica = '';
    if (!data.alertaDesc) data.alertaDesc = '';
    ensureArray(data, 'recs', []);
    ensureArray(data, 'evitar', []);
    ensureArray(data, 'gestionPrioridad', [['Sin datos', 0, '#94a3b8']]);
    if (!data.resumenEjecutivo) data.resumenEjecutivo = '';
  }

  // TENSIONES
  if (skill === 'tensiones') {
    ensureObject(data, 'actor', { entidad: 'Sin entidad', cargo: 'Servidor(a) Público(a)', periodo: '' });
    ensureArray(data, 'ranking', []);
    ensureArray(data, 'emociones', []);
    ensureArray(data, 'narrativas', []);
    ensureArray(data, 'territorios', []);
    ensureArray(data, 'riesgos', []);
    ensureArray(data, 'trayectoria', []);
    ensureArray(data, 'alertas', []);
    if (!data.hallazgoEmocional) data.hallazgoEmocional = 'Sin datos de hallazgo emocional disponibles.';
    if (!data.hallazgoTrayectoria) data.hallazgoTrayectoria = 'Sin datos de trayectoria disponibles.';
    if (!data.resumenEjecutivo) data.resumenEjecutivo = '';
  }

  // OPOSITOR
  if (skill === 'opositor') {
    ensureObject(data, 'actor', { cargo: 'Servidor(a) Público(a)', partido: '—', periodo: '', aspiracion: '' });
    ensureArray(data, 'vulnerabilidades', []);
    ensureArray(data, 'fortalezas', []);
    ensureObject(data, 'perfil', { rows: [], cronologia: [], ierPorCargo: [] });
    ensureObject(data, 'contradicciones', { ranking: [], destacados: [], tabla: [] });
    ensureArray(data, 'vectoresAtaque', []);
    ensureObject(data, 'redDePoder', { radar: [0, 0, 0, 0, 0, 0], alertas: [], tabla: [] });
    if (!data.resumenEjecutivo) data.resumenEjecutivo = '';
  }

  return data;
}

// =========================================================
// APIFY: SCRAPING
// =========================================================

async function llamarActorApify(actorPath, payload, token, timeoutMs = 35000) {
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
    console.warn(`[!] Timeout o fallo en actor ${actorPath}:`, e.message);
    return [];
  }
}

async function scrapeActor(nombre, token) {
  const tareas = [
    llamarActorApify('apify~google-search-scraper', {
      queries: `"${nombre}" (noticias OR opinión OR declaraciones)`,
      resultsPerPage: 20,
    }, token).then(i => tag(i, 'prensa')),

    llamarActorApify('apidojo~tweet-scraper', {
      searchTerms: [nombre],
      maxItems: 30,
    }, token).then(i => tag(i, 'twitter')),

    llamarActorApify('apify~facebook-posts-scraper', {
      search: nombre,
      resultsLimit: 20,
    }, token).then(i => tag(i, 'facebook')),

    llamarActorApify('apify~instagram-scraper', {
      search: nombre,
      resultsLimit: 15,
    }, token).then(i => tag(i, 'instagram')),

    llamarActorApify('clockworks~tiktok-scraper', {
      searchQueries: [nombre],
      resultsPerPage: 15,
    }, token).then(i => tag(i, 'tiktok')),

    llamarActorApify('streamers~youtube-scraper', {
      searchKeywords: nombre,
      maxResults: 10,
    }, token).then(i => tag(i, 'youtube')),
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
    .slice(0, 120);

  return { count: textos.length, items: textos };
}

function tag(items, fuente) {
  return (items || []).map(i => ({ ...i, __fuente: fuente }));
}

// =========================================================
// SCHEMAS LIMPIOS (coinciden 1:1 con las plantillas HTML)
// =========================================================

const SCHEMAS = {
  radar: JSON.stringify({
    actor: { cargo: "string", entidad: "string", partido: "string", periodo: "string" },
    kpis: {
      npsPartido: [{ label: "string", valor: 0 }],
      npsDemografico: [{ label: "string", valor: 0 }],
      ratioAtaqueDefensa: [{ plataforma: "string", ratio: 0 }],
      traSemanal: { labels: ["string"], valores: [0] }
    },
    sentimiento: {
      general: { labels: ["string"], valores: [0] },
      genero: { labels: ["string"], valores: [0] },
      edad: { labels: ["string"], valores: [0] },
      partido: { labels: ["string"], valores: [0] },
      hallazgos: [{ titulo: "string", texto: "string", accion: "string" }]
    },
    topOfMind: {
      general: { temas: ["string"], valores: [0] },
      genero: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] },
      edad: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] },
      partido: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] },
      cruces: [{ titulo: "string", texto: "string", accion: "string" }]
    },
    plataformas: {
      alcance: [{ plataforma: "string", valor: 0 }],
      tono: [{ plataforma: "string", positivo: 0, negativo: 0 }],
      porEdad: [{ plataforma: "string", series: [{ nombre: "string", valor: 0 }] }],
      viralizacion: [{ plataforma: "string", critica: 0, propia: 0 }],
      lecturaEstrategica: [{ titulo: "string", texto: "string", alerta: false }]
    },
    narrativas: {
      favorables: [{ titulo: "string", descripcion: "string", tags: ["string"], bivariado: "string" }],
      criticas: [{ titulo: "string", descripcion: "string", tags: ["string"], bivariado: "string" }],
      neutras: [{ titulo: "string", descripcion: "string", tags: ["string"], bivariado: "string" }]
    },
    riesgosOportunidades: {
      riesgos: [{ nivel: "CRÍTICO|ALTO|MEDIO|BAJO", titulo: "string", descripcion: "string", bivariado: "string" }],
      oportunidades: [{ nivel: "ALTO|MEDIO|BAJO", titulo: "string", descripcion: "string", bivariado: "string" }]
    },
    territorial: {
      zonas: [{ nombre: "string", nps: 0, clasificacion: "favorable|adversa|inercial", nota: "string" }],
      volumenPorZona: [{ zona: "string", volumen: 0 }]
    },
    resumenEjecutivo: "string"
  }, null, 2),

  emociones: JSON.stringify({
    territory: "string",
    subtitle: "string",
    date: "string",
    riskLevel: "CRÍTICO|ALTO|MEDIO|BAJO",
    ivEstimado: 0,
    concept: "string",
    conceptDesc: "string",
    emotions: [
      { key: "ira|sorpresa|anticipacion|tristeza|asco|alegria|confianza|miedo", active: true, intensity: 1, triggers: ["string"], consequences: ["string"] }
    ],
    secondary: [{ name: "string", text: "string", color: "#hex" }],
    problematics: ["string"],
    fears: ["string"],
    prides: ["string"],
    quotes: [{ text: "string", topic: "string", emotion: "string", territory: "string" }],
    temasChart: [["string", 0, "#hex"]],
    semaforo: [{ label: "string", val: "string", estado: "positivo|atencion|critico", color: "#hex" }],
    dyads: [{ name: "string", formula: "string", type: "Primaria|Secundaria", text: "string", risk: "CRÍTICO|ALTO|MEDIO|BAJO", score: 0 }],
    dyadInterp: "string",
    preguntaPolitica: "string",
    preguntaDesc: "string",
    govSemaforo: [{ label: "string", val: "string", estado: "positivo|atencion|critico", color: "#hex" }],
    partidos: [
      {
        nombre: "string",
        emocion: "string",
        capital: "string",
        tendencia: "string",
        direccion: "baja|sube|estable",
        cargaEmocional: { iraAsco: 0, decepcionTristeza: 0, interesDisponible: 0 }
      }
    ],
    partidosChart: [[0, 0, 0]],
    actores: [
      {
        name: "string",
        role: "string",
        rows: [["label", "value"]],
        borderColor: "#hex"
      }
    ],
    actoresRadar: {
      labels: ["string"],
      data: [[0, 0, 0, 0, 0, 0]],
      colors: ["#hex"]
    },
    alertaEstrategica: "string",
    alertaDesc: "string",
    recs: [{ urgencia: "urgente|corto|mediano|permanente", text: "string", bg: "#hex", tx: "#hex", label: "string" }],
    evitar: ["string"],
    gestionPrioridad: [["string", 0, "#hex"]],
    resumenEjecutivo: "string"
  }, null, 2),

  tensiones: JSON.stringify({
    actor: { entidad: "string", cargo: "string", periodo: "string" },
    ranking: [
      {
        nombre: "string",
        score: 0,
        color: "#C05621",
        nivel: "string",
        emocion: "string",
        narrativa: "string",
        actor: "string",
        territorio: "string",
        politica: "string",
        recomendacion: "string"
      }
    ],
    emociones: [
      { nombre: "string", intensidad: 0, color: "#hex", porcentaje: 0 }
    ],
    narrativas: [
      { nombre: "string", tema: "string", actor: "string", politica: "string", frase: "string" }
    ],
    territorios: [
      { nombre: "string", tension: "string", emocion: "string", observaciones: "string" }
    ],
    riesgos: [
      { nombre: "string", srr: 0, accion: "string", color: "#hex" }
    ],
    trayectoria: [
      { nombre: "string", t3: 0, t2: 0, t1: 0, ta: 0, tipo: "string", velocidad: "string" }
    ],
    alertas: [
      { titulo: "string", rows: [["clave", "valor"]] }
    ],
    hallazgoEmocional: "string",
    hallazgoTrayectoria: "string",
    resumenEjecutivo: "string"
  }, null, 2),

  opositor: JSON.stringify({
    actor: { cargo: "string", partido: "string", periodo: "string", aspiracion: "string" },
    vulnerabilidades: [{ titulo: "string", nivel: "CRÍTICO|ALTO|MEDIO", bullets: ["string"], score: 0 }],
    fortalezas: [{ titulo: "string", texto: "string" }],
    perfil: {
      rows: [{ label: "string", value: "string" }],
      cronologia: [{ periodo: "string", titulo: "string", descripcion: "string" }],
      ierPorCargo: [{ cargo: "string", valor: 0 }]
    },
    contradicciones: {
      ranking: [{ codigo: "string", titulo: "string", score: 0, nivel: "CRÍTICO|ALTO|MEDIO" }],
      destacados: [{ titulo: "string", texto: "string", nivel: "CRÍTICO|ALTO|MEDIO|BAJO" }],
      tabla: [{ codigo: "string", tipo: "string", declaracion: "string", realidad: "string", dano: "CRÍTICO|ALTO|MEDIO", canal: "string" }]
    },
    vectoresAtaque: [{ codigo: "string", titulo: "string", nivel: "CRÍTICO|ALTO|MEDIO", fuenteTag: "string", argumento: "string", evidencias: ["string"], fraseLista: "string" }],
    redDePoder: {
      radar: [0, 0, 0, 0, 0, 0],
      alertas: [{ nivel: "CRÍTICO|ALTO|MEDIO", titulo: "string", bullets: ["string"] }],
      tabla: [{ actor: "string", vinculo: "string", riesgoOportunidad: "string" }]
    },
    resumenEjecutivo: "string"
  }, null, 2)
};

// =========================================================
// PROMPTS
// =========================================================

function buildPrompt({ skill, actorName, actor2Name, mes, anio, datosActor1, datosActor2, schema }) {
  const bloque1 = resumirFuentes(datosActor1);
  const bloque2 = datosActor2 ? resumirFuentes(datosActor2) : null;

  const contexto = actor2Name
    ? `Personaje A: ${actorName}\nPersonaje B: ${actor2Name}\n\n--- Datos crudos sobre ${actorName} ---\n${bloque1}\n\n--- Datos crudos sobre ${actor2Name} ---\n${bloque2}`
    : `Personaje: ${actorName}\n\n--- Datos crudos extraídos ---\n${bloque1}`;

  const guardarropaOpositor = skill === 'opositor'
    ? `\nReglas adicionales OBLIGATORIAS para este expediente de oposición:\n- Basa cualquier señalamiento grave ÚNICAMENTE en lo que aparezca en las fuentes crudas proporcionadas.\n- NO inventes números de expediente ni fechas falsas de documentos.\n- Si no hay suficiente información cruda, trátalo como "área de riesgo reputacional".`
    : '';

  const instruccionesEstructura = skill === 'emociones'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Emociones):\n- "temasChart" debe ser un ARRAY DE ARRAYS: cada elemento es ["nombre del tema", porcentajeNumero, "colorHex"]. Ejemplo: [["Seguridad", 35, "#3b82f6"], ["Economía", 25, "#f97316"]]\n- "partidosChart" debe ser un ARRAY DE ARRAYS: cada elemento es [iraAscoNum, decepcionTristezaNum, interesDisponibleNum]. Ejemplo: [[45, 30, 25], [20, 60, 20]]\n- "gestionPrioridad" debe ser un ARRAY DE ARRAYS: cada elemento es ["label", valorNumero, "colorHex"]. Ejemplo: [["Comunicación", 85, "#ef4444"]]\n- "actores.rows" dentro de cada actor debe ser un ARRAY DE ARRAYS: cada elemento es ["label", "valor"]. Ejemplo: [["Cargo", "Gobernador"], ["Partido", "Morena"]]\n- "actoresRadar.data" debe ser un ARRAY DE ARRAYS de números (0-100), uno por actor.\n- "recs" debe incluir las propiedades: bg (color fondo), tx (color texto), label (texto corto), text (descripción).\n- "secondary" debe incluir color (hex) para cada emoción secundaria.`
    : '';

  const system = `Eres un analista de inteligencia político-electoral en México. Produce un análisis estructurado ÚNICAMENTE en formato JSON, sin texto adicional, sin markdown, sin backticks.

Reglas:
- Responde EXCLUSIVAMENTE con un objeto JSON válido acorde a este esquema exacto (mismos nombres de propiedades, mismos tipos de datos):
${schema}
- Basa el análisis en los datos crudos proporcionados.
- Si no hay datos crudos suficientes para algún campo, genera valores realistas basados en el contexto político mexicano pero SIEMPRE respeta los nombres de propiedades del esquema.
- Todos los textos en español de México.
- Asegúrate de que TODOS los arrays tengan al menos un elemento.
- Los campos numéricos deben ser números, no strings.
- NUNCA omitas ninguna propiedad del esquema, aunque sea con valores de fallback.${guardarropaOpositor}${instruccionesEstructura}`;

  const user = `Periodo evaluado: ${mes} ${anio}
Skill solicitada: ${skill}

${contexto}

Genera el JSON completo con el esquema indicado. No omitas ninguna propiedad. Si no hay datos suficientes para una sección, genera datos representativos del contexto político mexicano actual.`;

  return { system, user };
}

function resumirFuentes(bloque) {
  if (!bloque || !bloque.items || bloque.items.length === 0) {
    return '(No se obtuvieron resultados directos de scraping en vivo; genera el análisis basándote en conocimiento experto del contexto político mexicano respetando estrictamente el esquema JSON proporcionado.)';
  }
  return bloque.items
    .slice(0, 50)
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
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: 8000,
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
    console.error('[-] JSON inválido de OpenRouter:', clean.slice(0, 500));
    throw new Error('OpenRouter devolvió un JSON con formato inválido.');
  }
}
