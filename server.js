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
// =========================================================
const JOBS = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

function limpiarJob(jobId) {
  setTimeout(() => JOBS.delete(jobId), JOB_TTL_MS);
}

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

  procesarAnalisis({ jobId, skill, actorName, actor2Name, mes, anio, APIFY_TOKEN, OPENROUTER_KEY });

  return res.status(202).json({ jobId });
});

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

    const [datosActor1, datosActor2] = await Promise.all([
      scrapeActor(actorName, APIFY_TOKEN),
      actor2Name ? scrapeActor(actor2Name, APIFY_TOKEN) : Promise.resolve(null),
    ]);

    JOBS.set(jobId, { status: 'processing', progreso: 'Estructurando datos con OpenRouter...' });

    const schema = SCHEMAS[skill] || SCHEMAS.radar;
    const prompt = buildPrompt({ skill, actorName, actor2Name, mes, anio, datosActor1, datosActor2, schema });
    const structured = await callOpenRouter(prompt, OPENROUTER_KEY);

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

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor RADAR escuchando en el puerto ${PORT}`);
});

server.timeout = 180000;

// =========================================================
// NORMALIZACIÓN DE RESPUESTA
// =========================================================
const EMOTION_LABELS = {
  ira: 'Ira', sorpresa: 'Sorpresa', anticipacion: 'Anticipación', tristeza: 'Tristeza',
  asco: 'Asco', alegria: 'Alegría', confianza: 'Confianza', miedo: 'Miedo',
};

function sintetizarDyads(emotions) {
  const activas = (emotions || [])
    .filter(e => e.active && e.intensity > 0)
    .sort((a, b) => b.intensity - a.intensity);

  if (activas.length < 2) return [];

  const pares = [];
  for (let i = 0; i < activas.length - 1 && pares.length < 3; i++) {
    pares.push([activas[i], activas[i + 1]]);
  }
  if (pares.length < 3 && activas.length >= 3) pares.push([activas[0], activas[2]]);

  const RISK_BY_SCORE = (score) => score >= 75 ? 'CRÍTICO' : score >= 55 ? 'ALTO' : score >= 35 ? 'MEDIO' : 'BAJO';

  return pares.slice(0, 4).map(([a, b], idx) => {
    const labelA = EMOTION_LABELS[a.key] || a.key;
    const labelB = EMOTION_LABELS[b.key] || b.key;
    const score = Math.round(((a.intensity + b.intensity) / 6) * 100);
    const triggersA = (a.triggers || []).slice(0, 2).join(', ');
    const triggersB = (b.triggers || []).slice(0, 2).join(', ');
    return {
      name: `${labelA} + ${labelB}`,
      formula: `${labelA} + ${labelB}`,
      type: idx === 0 ? 'Primaria' : 'Secundaria',
      text: `La combinación de ${labelA.toLowerCase()} (detonada por ${triggersA || 'factores del contexto reciente'}) y ${labelB.toLowerCase()} (asociada a ${triggersB || 'la percepción ciudadana del período'}) genera una dinámica emocional de riesgo ${RISK_BY_SCORE(score).toLowerCase()} que puede erosionar la confianza si no se atiende con comunicación específica y acciones visibles en el corto plazo.`,
      risk: RISK_BY_SCORE(score),
      score,
    };
  });
}

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

  // RADAR CON LAS 9 PESTAÑAS Y CABECERA
  if (skill === 'radar') {
    ensureObject(data, 'header', {
      nivelAlerta: 'NIVEL 2 · ALERTA AMARILLA',
      actorNombre: 'Actor',
      corte: '',
      periodo: ''
    });
    ensureObject(data, 'actor', { cargo: 'Servidor(a) Público(a)', entidad: 'Sin entidad', partido: '—', periodo: '' });

    // 1. KPIs Ampliados
    ensureObject(data, 'kpis', {});
    if (typeof data.kpis.volumenTotal !== 'number') data.kpis.volumenTotal = 0;
    if (typeof data.kpis.npsPromedio !== 'number') data.kpis.npsPromedio = 0;
    if (typeof data.kpis.reachEstimado !== 'number') data.kpis.reachEstimado = 0;
    if (typeof data.kpis.conversacionCriticaPct !== 'number') data.kpis.conversacionCriticaPct = 0;
    ensureArray(data.kpis, 'npsPartido', [{ label: 'Sin datos', valor: 0 }]);
    ensureArray(data.kpis, 'npsDemografico', [{ label: 'Sin datos', valor: 0 }]);
    ensureArray(data.kpis, 'ratioAtaqueDefensa', [{ plataforma: 'Sin datos', ratio: 0 }]);
    ensureObject(data.kpis, 'traSemanal', { labels: ['Sin datos'], valores: [0] });

    // 2. Sentimiento
    ensureObject(data, 'sentimiento', {});
    ensureObject(data.sentimiento, 'general', { labels: ['Positivo', 'Neutro', 'Negativo'], valores: [0, 0, 0] });
    ensureObject(data.sentimiento, 'genero', { labels: ['Hombres', 'Mujeres'], valores: [0, 0] });
    ensureObject(data.sentimiento, 'edad', { labels: ['18-29', '30-49', '50+'], valores: [0, 0, 0] });
    ensureObject(data.sentimiento, 'partido', { labels: ['Propios', 'Oposición', 'Independientes'], valores: [0, 0, 0] });
    ensureArray(data.sentimiento, 'hallazgos', []);

    // 3. Top of Mind
    ensureObject(data, 'topOfMind', {});
    ensureObject(data.topOfMind, 'general', { temas: ['Sin datos'], valores: [0] });
    ensureObject(data.topOfMind, 'genero', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureObject(data.topOfMind, 'edad', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureObject(data.topOfMind, 'partido', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureArray(data.topOfMind, 'cruces', []);

    // 4. Picos de Volatilidad
    ensureObject(data, 'picos', {});
    ensureArray(data.picos, 'eventos', []);
    ensureObject(data.picos, 'graficoMenciones', { fechas: [], volumen: [], anomalias: [] });

    // 5. Plataformas
    ensureObject(data, 'plataformas', {});
    ensureArray(data.plataformas, 'alcance', [{ plataforma: 'Sin datos', valor: 0 }]);
    ensureArray(data.plataformas, 'tono', [{ plataforma: 'Sin datos', positivo: 0, negativo: 0 }]);
    ensureArray(data.plataformas, 'porEdad', [{ plataforma: 'Sin datos', series: [{ nombre: '—', valor: 0 }] }]);
    ensureArray(data.plataformas, 'viralizacion', [{ plataforma: 'Sin datos', critica: 0, propia: 0 }]);
    ensureArray(data.plataformas, 'lecturaEstrategica', []);

    // 6. Nube y Hashtags
    ensureObject(data, 'nubeHashtags', {});
    ensureArray(data.nubeHashtags, 'palabrasClave', []);
    ensureArray(data.nubeHashtags, 'topHashtags', []);
    ensureArray(data.nubeHashtags, 'mencionesActores', []);

    // 7. Narrativas
    ensureObject(data, 'narrativas', {});
    ensureArray(data.narrativas, 'favorables', []);
    ensureArray(data.narrativas, 'criticas', []);
    ensureArray(data.narrativas, 'neutras', []);

    // 8. Riesgos y Oportunidades
    ensureObject(data, 'riesgosOportunidades', {});
    ensureArray(data.riesgosOportunidades, 'riesgos', []);
    ensureArray(data.riesgosOportunidades, 'oportunidades', []);

    // 9. Territorial
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
async function llamarActorApify(actorPath, payload, token, timeoutMs = 60000) {
  if (!token) return [];
  try {
    const apifyTimeoutSec = Math.round(timeoutMs / 1000);
    const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${token}&timeout=${apifyTimeoutSec}`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs + 10000);

    const inicio = Date.now();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(t);

    if (!r.ok) {
      console.warn(`[!] Apify ${actorPath} respondió HTTP ${r.status} tras ${Date.now() - inicio}ms`);
      return [];
    }
    const data = await r.json();
    const items = Array.isArray(data) ? data : [];
    console.log(`[✓] Apify ${actorPath}: ${items.length} items en ${Date.now() - inicio}ms`);
    return items;
  } catch (e) {
    console.warn(`[!] Timeout o fallo en actor ${actorPath}:`, e.message);
    return [];
  }
}

const PLATFORM_TIMEOUTS = {
  prensa: 60000,
  twitter: 90000,
  facebook: 110000,
  instagram: 100000,
  tiktok: 90000,
  youtube: 80000,
};

async function scrapeActor(nombre, token) {
  const tareas = [
    llamarActorApify('apify~google-search-scraper', {
      queries: `"${nombre}" (noticias OR opinión OR declaraciones)`,
      resultsPerPage: 20,
    }, token, PLATFORM_TIMEOUTS.prensa).then(i => tag(i, 'prensa')),

    llamarActorApify('apidojo~tweet-scraper', {
      searchTerms: [nombre],
      maxItems: 30,
    }, token, PLATFORM_TIMEOUTS.twitter).then(i => tag(i, 'twitter')),

    llamarActorApify('apify~facebook-posts-scraper', {
      search: nombre,
      resultsLimit: 20,
    }, token, PLATFORM_TIMEOUTS.facebook).then(i => tag(i, 'facebook')),

    llamarActorApify('apify~instagram-scraper', {
      search: nombre,
      resultsLimit: 15,
    }, token, PLATFORM_TIMEOUTS.instagram).then(i => tag(i, 'instagram')),

    llamarActorApify('clockworks~tiktok-scraper', {
      searchQueries: [nombre],
      resultsPerPage: 15,
    }, token, PLATFORM_TIMEOUTS.tiktok).then(i => tag(i, 'tiktok')),

    llamarActorApify('streamers~youtube-scraper', {
      searchKeywords: nombre,
      maxResults: 10,
    }, token, PLATFORM_TIMEOUTS.youtube).then(i => tag(i, 'youtube')),
  ];

  const resultados = await Promise.allSettled(tareas);
  const rawItems = resultados
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);

  const conteoPorFuente = rawItems.reduce((acc, i) => {
    acc[i.__fuente] = (acc[i.__fuente] || 0) + 1;
    return acc;
  }, {});
  console.log(`[i] Scraping "${nombre}" — items por fuente:`, conteoPorFuente, `| total: ${rawItems.length}`);

  const textos = rawItems
    .map(i => ({
      fuente: i.__fuente,
      texto: i.snippet || i.full_text || i.text || i.caption || i.title || i.description || '',
      fecha: i.date || i.timestamp || i.publishedAt || null,
      autor: i.author || i.username || i.ownerUsername || i.channelName || null,
      likes: i.likeCount ?? i.likes ?? i.diggCount ?? null,
    }))
    .filter(t => t.texto && t.texto.length > 8)
    .slice(0, 160);

  return { count: textos.length, items: textos };
}

function tag(items, fuente) {
  return (items || []).map(i => ({ ...i, __fuente: fuente }));
}

// =========================================================
// SCHEMAS COMPLETOS
// =========================================================

const SCHEMAS = {
  radar: JSON.stringify({
    header: {
      nivelAlerta: "NIVEL 1 · ALERTA VERDE | NIVEL 2 · ALERTA AMARILLA | NIVEL 3 · ALERTA ROJA",
      actorNombre: "string",
      corte: "string",
      periodo: "string"
    },
    actor: { cargo: "string", entidad: "string", partido: "string", periodo: "string" },
    kpis: {
      volumenTotal: 0,
      npsPromedio: 0,
      reachEstimado: 0,
      conversacionCriticaPct: 0,
      npsPartido: [{ label: "string", valor: 0 }],
      npsDemografico: [{ label: "string", valor: 0 }],
      ratioAtaqueDefensa: [{ plataforma: "string", ratio: 0 }],
      traSemanal: { labels: ["string"], valores: [0] }
    },
    sentimiento: {
      general: { labels: ["Positivo", "Neutro", "Negativo"], valores: [0, 0, 0] },
      genero: { labels: ["Hombres", "Mujeres"], valores: [0, 0] },
      edad: { labels: ["18-29", "30-49", "50+"], valores: [0, 0, 0] },
      partido: { labels: ["Propios", "Oposición", "Independientes"], valores: [0, 0, 0] },
      hallazgos: [{ titulo: "string", texto: "string", accion: "string" }]
    },
    topOfMind: {
      general: { temas: ["string"], valores: [0] },
      genero: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] },
      edad: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] },
      partido: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] },
      cruces: [{ titulo: "string", texto: "string", accion: "string" }]
    },
    picos: {
      eventos: [{ fecha: "string", titulo: "string", descripcion: "string", impacto: "CRÍTICO|ALTO|MEDIO|BAJO", fuente: "string" }],
      graficoMenciones: { fechas: ["string"], volumen: [0], anomalias: [0] }
    },
    plataformas: {
      alcance: [{ plataforma: "string", valor: 0 }],
      tono: [{ plataforma: "string", positivo: 0, negativo: 0 }],
      porEdad: [{ plataforma: "string", series: [{ nombre: "string", valor: 0 }] }],
      viralizacion: [{ plataforma: "string", critica: 0, propia: 0 }],
      lecturaEstrategica: [{ titulo: "string", texto: "string", alerta: false }]
    },
    nubeHashtags: {
      palabrasClave: [{ texto: "string", peso: 0, sentimiento: "positivo|negativo|neutro" }],
      topHashtags: [{ tag: "string", volumen: 0, tendencia: "sube|baja|estable" }],
      mencionesActores: [{ actor: "string", menciones: 0, tono: "favorables|criticas" }]
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
      { key: "ira|sorpresa|anticipacion|tristeza|asco|alegria|confianza|miedo", active: true, intensity: 2, triggers: ["string"], consequences: ["string"] }
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
// PROMPTS Y REQUISITOS
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
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Emociones):\n- "emotions.intensity" es un ENTERO de escala fija 0-3...`
    : skill === 'radar'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (RADAR - LAS 9 PESTAÑAS Y CABECERA):
1. **Header Metadatos:** Llena "header.nivelAlerta" (ej. "NIVEL 2 · ALERTA AMARILLA — ${actorName}"), "header.corte" y "header.periodo".
2. **KPIs Ampliados:** "kpis.volumenTotal", "npsPromedio", "reachEstimado", "conversacionCriticaPct", "npsPartido", "npsDemografico", "ratioAtaqueDefensa", "traSemanal".
3. **Sentimiento:** Distribuciones de "general", "genero", "edad", "partido", y arreglos de tarjetas bivariadas en "hallazgos".
4. **Top of Mind:** Array en "general", desgloses en "genero", "edad", "partido", y hallazgos temáticos en "cruces".
5. **Picos:** Genera "picos.eventos" con fechas y detonantes clave, y "picos.graficoMenciones" con la serie temporal.
6. **Plataformas:** "alcance", "tono", "porEdad", "viralizacion", y "lecturaEstrategica" por red social.
7. **Nube y Hashtags:** Llena "nubeHashtags.palabrasClave" (con pesos y sentimiento), "topHashtags" y "mencionesActores".
8. **Narrativas:** Categorías "favorables", "criticas" y "neutras" con su descripción y análisis bivariado.
9. **Riesgos y Oportunidades:** Tarjetas con nivel de severidad y recomendación táctica.
10. **Territorial:** "zonas" principales con NPS local y "volumenPorZona".
11. **Resumen Ejecutivo:** Redacción estratégica completa (mínimo 120 palabras).`
    : '';

  const requisitosCantidad = REQUISITOS_MINIMOS[skill] || '';

  const system = `Eres un analista de inteligencia político-electoral en México. Produce un análisis estructurado ÚNICAMENTE en formato JSON, sin texto adicional, sin markdown, sin backticks.

Reglas:
- Responde EXCLUSIVAMENTE con un objeto JSON válido acorde a este esquema exacto:
${schema}
- Basa el análisis en los datos crudos proporcionados.
- Si no hay datos crudos suficientes para algún campo, genera valores realistas basados en el contexto político mexicano.
- PROHIBIDO omitir cualquier propiedad requerida por el esquema.
${requisitosCantidad}${guardarropaOpositor}${instruccionesEstructura}`;

  const user = `Periodo evaluado: ${mes} ${anio}
Skill solicitada: ${skill}

${contexto}

Genera el JSON alimentando todas las pestañas de la skill solicitada exactamente con los nombres especificados.`;

  return { system, user };
}

const REQUISITOS_MINIMOS = {
  radar: `
REQUISITOS MÍNIMOS DE CANTIDAD (RADAR):
- sentimiento.hallazgos: mínimo 4 hallazgos bivariados distintos.
- topOfMind.cruces: mínimo 4 cruces temáticos.
- picos.eventos: mínimo 3 eventos críticos o picos de volatilidad.
- plataformas.lecturaEstrategica: mínimo 3 lecturas estratégicas por red social.
- nubeHashtags.palabrasClave: mínimo 10 términos clave.
- nubeHashtags.topHashtags: mínimo 6 hashtags relevantes.
- narrativas.favorables: mínimo 3. narrativas.criticas: mínimo 3. narrativas.neutras: mínimo 2.
- riesgosOportunidades.riesgos: mínimo 4. riesgosOportunidades.oportunidades: mínimo 3.
- territorial.zonas: mínimo 5 zonas/municipios distintos.
- resumenEjecutivo: mínimo 120 palabras.`,

  emociones: `
REQUISITOS MÍNIMOS DE CANTIDAD (EMOCIONES):
- emotions: EXACTAMENTE 8 entradas.
- secondary: mínimo 4 emociones secundarias.
- quotes: mínimo 6 frases ciudadanas distintas.
- dyads: mínimo 3 díadas emocionales.
- partidos: mínimo 3 partidos/actores políticos distintos.
- actores: mínimo 3 actores comparados.
- recs: mínimo 5 recomendaciones estratégicas.
- evitar: mínimo 4 elementos.
- problematics: mínimo 6 elementos.
- fears: mínimo 5 elementos.
- prides: mínimo 4 elementos.
- semaforo: mínimo 6 indicadores.
- govSemaforo: mínimo 6 indicadores.
- temasChart: mínimo 5 temas distintos.
- gestionPrioridad: mínimo 4 elementos.`,

  tensiones: `
REQUISITOS MÍNIMOS DE CANTIDAD (TENSIONES):
- ranking: mínimo 6 tensiones sociales.
- emociones: mínimo 5.
- narrativas: mínimo 5.
- territorios: mínimo 4 territorios/zonas.
- riesgos: mínimo 4.
- trayectoria: mínimo 4 tensiones.
- alertas: mínimo 3.`,

  opositor: `
REQUISITOS MÍNIMOS DE CANTIDAD (OPOSITOR):
- vulnerabilidades: mínimo 4.
- fortalezas: mínimo 3.
- perfil.cronologia: mínimo 5 eventos.
- perfil.ierPorCargo: mínimo 3 cargos.
- contradicciones.ranking: mínimo 4. contradicciones.destacados: mínimo 3. contradicciones.tabla: mínimo 5 filas.
- vectoresAtaque: mínimo 4.
- redDePoder.alertas: mínimo 3. redDePoder.tabla: mínimo 5 actores.`,
};

function resumirFuentes(bloque) {
  if (!bloque || !bloque.items || bloque.items.length === 0) {
    return '(No se obtuvieron resultados directos de scraping en vivo; genera el análisis basándote en conocimiento experto del contexto político mexicano respetando estrictamente el esquema JSON proporcionado.)';
  }
  return bloque.items
    .slice(0, 90)
    .map(i => `[${i.fuente}] ${i.texto.slice(0, 280)}`)
    .join('\n');
}

async function callOpenRouter({ system, user }, apiKey) {
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

  const r = await fetch('https://openrouter.ai/ai/v1/chat/completions', {
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
      max_tokens: 16000,
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
