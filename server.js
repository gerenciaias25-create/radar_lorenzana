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
    actores = [],
    actor = '',
    actor2 = '',
    mes = 'Agosto',
    anio = '2026',
  } = params;

  // Normalizar lista de actores (soporta de 1 a 4 actores desde 'actores' o 'actor/actor2')
  let listaActores = Array.isArray(actores) && actores.length > 0 
    ? actores.map(a => String(a).trim()).filter(Boolean)
    : [actor, actor2].map(a => String(a).trim()).filter(Boolean);

  listaActores = listaActores.slice(0, 4);

  if (listaActores.length === 0) {
    return res.status(400).json({ error: 'Debes ingresar al menos un actor político.' });
  }

  const APIFY_TOKEN = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: 'Falta OPENROUTER_API_KEY en las variables de entorno.' });
  }

  const jobId = crypto.randomUUID();
  JOBS.set(jobId, { status: 'processing', progreso: 'Extrayendo fuentes en Apify...' });

  procesarAnalisis({ jobId, skill, listaActores, mes, anio, APIFY_TOKEN, OPENROUTER_KEY });

  return res.status(202).json({ jobId });
});

app.get('/api/estado/:jobId', (req, res) => {
  const job = JOBS.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job no encontrado o expirado.' });
  }
  return res.status(200).json(job);
});

async function procesarAnalisis({ jobId, skill, listaActores, mes, anio, APIFY_TOKEN, OPENROUTER_KEY }) {
  try {
    const actorPrincipal = listaActores[0];
    console.log(`[+] Iniciando análisis (${jobId}) para: ${listaActores.join(' vs ')} (${skill})`);

    JOBS.set(jobId, { status: 'processing', progreso: `Extrayendo fuentes en Apify para ${listaActores.length} actor(es)...` });

    // Scraping en paralelo para hasta 4 actores
    const resultadosScraping = await Promise.all(
      listaActores.map(nombreActor => scrapeActor(nombreActor, APIFY_TOKEN))
    );

    JOBS.set(jobId, { status: 'processing', progreso: 'Estructurando datos con OpenRouter...' });

    const schema = SCHEMAS[skill] || SCHEMAS.radar;
    const prompt = buildPromptMulti({ skill, listaActores, resultadosScraping, mes, anio, schema });
    const structured = await callOpenRouter(prompt, OPENROUTER_KEY);

    const normalized = normalizeResponse(structured, skill);

    JOBS.set(jobId, {
      status: 'done',
      result: {
        skill,
        actor: actorPrincipal,
        actores: listaActores,
        periodo: `${mes} ${anio}`,
        fuentesEncontradas: resultadosScraping.reduce((acc, r) => acc + (r?.count || 0), 0),
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

function normalizeResponse(data, skill) {
  if (!data || typeof data !== 'object') data = {};

  const ensureArray = (obj, key, defaultVal = []) => {
    if (!obj[key] || !Array.isArray(obj[key])) obj[key] = defaultVal;
    return obj;
  };

  const ensureObject = (obj, key, defaultVal = {}) => {
    if (!obj[key] || typeof obj[key] !== 'object' || Array.isArray(obj[key])) obj[key] = defaultVal;
    return obj;
  };

  if (skill === 'radar') {
    ensureObject(data, 'header', { nivelAlerta: 'NIVEL 2 · ALERTA AMARILLA', actorNombre: 'Actor', corte: '', periodo: '' });
    ensureObject(data, 'actor', { cargo: 'Servidor(a) Público(a)', entidad: 'Sin entidad', partido: '—', periodo: '' });

    ensureObject(data, 'kpis', {});
    if (typeof data.kpis.volumenTotal !== 'number') data.kpis.volumenTotal = 0;
    if (typeof data.kpis.npsPromedio !== 'number') data.kpis.npsPromedio = 0;
    if (typeof data.kpis.reachEstimado !== 'number') data.kpis.reachEstimado = 0;
    if (typeof data.kpis.conversacionCriticaPct !== 'number') data.kpis.conversacionCriticaPct = 0;
    ensureArray(data.kpis, 'npsPartido', [{ label: 'Sin datos', valor: 0 }]);
    ensureArray(data.kpis, 'npsDemografico', [{ label: 'Sin datos', valor: 0 }]);
    ensureArray(data.kpis, 'ratioAtaqueDefensa', [{ plataforma: 'Sin datos', ratio: 0 }]);
    ensureObject(data.kpis, 'traSemanal', { labels: ['Sin datos'], valores: [0] });

    ensureObject(data, 'sentimiento', {});
    ensureObject(data.sentimiento, 'general', { labels: ['Positivo', 'Neutro', 'Negativo'], valores: [0, 0, 0] });
    ensureObject(data.sentimiento, 'genero', { labels: ['Hombres', 'Mujeres'], valores: [0, 0] });
    ensureObject(data.sentimiento, 'edad', { labels: ['18-29', '30-49', '50+'], valores: [0, 0, 0] });
    ensureObject(data.sentimiento, 'partido', { labels: ['Propios', 'Oposición', 'Independientes'], valores: [0, 0, 0] });
    ensureArray(data.sentimiento, 'hallazgos', []);

    ensureObject(data, 'topOfMind', {});
    ensureObject(data.topOfMind, 'general', { temas: ['Sin datos'], valores: [0] });
    ensureObject(data.topOfMind, 'genero', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureObject(data.topOfMind, 'edad', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureObject(data.topOfMind, 'partido', { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] });
    ensureArray(data.topOfMind, 'cruces', []);

    ensureObject(data, 'picos', {});
    ensureArray(data.picos, 'eventos', []);
    ensureObject(data.picos, 'graficoMenciones', { fechas: [], volumen: [], anomalias: [] });

    ensureObject(data, 'plataformas', {});
    ensureArray(data.plataformas, 'alcance', [{ plataforma: 'Sin datos', valor: 0 }]);
    ensureArray(data.plataformas, 'tono', [{ plataforma: 'Sin datos', positivo: 0, negativo: 0 }]);
    ensureArray(data.plataformas, 'porEdad', [{ plataforma: 'Sin datos', series: [{ nombre: '—', valor: 0 }] }]);
    ensureArray(data.plataformas, 'viralizacion', [{ plataforma: 'Sin datos', critica: 0, propia: 0 }]);
    ensureArray(data.plataformas, 'lecturaEstrategica', []);

    ensureObject(data, 'nubeHashtags', {});
    ensureArray(data.nubeHashtags, 'palabrasClave', []);
    ensureArray(data.nubeHashtags, 'topHashtags', []);
    ensureArray(data.nubeHashtags, 'mencionesActores', []);

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
  const tareas = [
    llamarActorApify('apify~google-search-scraper', { queries: `"${nombre}" (noticias OR opinión)`, resultsPerPage: 15 }, token, 60000).then(i => tag(i, 'prensa')),
    llamarActorApify('apidojo~tweet-scraper', { searchTerms: [nombre], maxItems: 25 }, token, 90000).then(i => tag(i, 'twitter')),
    llamarActorApify('apify~facebook-posts-scraper', { search: nombre, resultsLimit: 15 }, token, 110000).then(i => tag(i, 'facebook')),
    llamarActorApify('apify~instagram-scraper', { search: nombre, resultsLimit: 10 }, token, 100000).then(i => tag(i, 'instagram')),
    llamarActorApify('clockworks~tiktok-scraper', { searchQueries: [nombre], resultsPerPage: 10 }, token, 90000).then(i => tag(i, 'tiktok')),
    llamarActorApify('streamers~youtube-scraper', { searchKeywords: nombre, maxResults: 10 }, token, 80000).then(i => tag(i, 'youtube')),
  ];

  const resultados = await Promise.allSettled(tareas);
  const rawItems = resultados.filter(r => r.status === 'fulfilled').flatMap(r => r.value);

  const textos = rawItems
    .map(i => ({
      fuente: i.__fuente,
      texto: i.snippet || i.full_text || i.text || i.caption || i.title || i.description || '',
      fecha: i.date || i.timestamp || i.publishedAt || null,
    }))
    .filter(t => t.texto && t.texto.length > 8)
    .slice(0, 150);

  return { count: textos.length, items: textos };
}

function tag(items, fuente) {
  return (items || []).map(i => ({ ...i, __fuente: fuente }));
}

// =========================================================
// SCHEMAS Y PROMPTS
// =========================================================

const SCHEMAS = {
  radar: JSON.stringify({
    header: { nivelAlerta: "string", actorNombre: "string", corte: "string", periodo: "string" },
    actor: { cargo: "string", entidad: "string", partido: "string", periodo: "string" },
    kpis: { volumenTotal: 0, npsPromedio: 0, reachEstimado: 0, conversacionCriticaPct: 0, npsPartido: [{ label: "string", valor: 0 }], npsDemografico: [{ label: "string", valor: 0 }], ratioAtaqueDefensa: [{ plataforma: "string", ratio: 0 }], traSemanal: { labels: ["string"], valores: [0] } },
    sentimiento: { general: { labels: ["Positivo", "Neutro", "Negativo"], valores: [0, 0, 0] }, genero: { labels: ["Hombres", "Mujeres"], valores: [0, 0] }, edad: { labels: ["18-29", "30-49", "50+"], valores: [0, 0, 0] }, partido: { labels: ["Propios", "Oposición", "Independientes"], valores: [0, 0, 0] }, hallazgos: [{ titulo: "string", texto: "string", accion: "string" }] },
    topOfMind: { general: { temas: ["string"], valores: [0] }, genero: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] }, edad: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] }, partido: { temas: ["string"], series: [{ nombre: "string", valores: [0] }] }, cruces: [{ titulo: "string", texto: "string", accion: "string" }] },
    picos: { eventos: [{ fecha: "string", titulo: "string", descripcion: "string", impacto: "CRÍTICO|ALTO|MEDIO|BAJO", fuente: "string" }], graficoMenciones: { fechas: ["string"], volumen: [0], anomalias: [0] } },
    plataformas: { alcance: [{ plataforma: "string", valor: 0 }], tono: [{ plataforma: "string", positivo: 0, negativo: 0 }], porEdad: [{ plataforma: "string", series: [{ nombre: "string", valor: 0 }] }], viralizacion: [{ plataforma: "string", critica: 0, propia: 0 }], lecturaEstrategica: [{ titulo: "string", texto: "string", alerta: false }] },
    nubeHashtags: { palabrasClave: [{ texto: "string", peso: 0, sentimiento: "positivo|negativo|neutro" }], topHashtags: [{ tag: "string", volumen: 0, tendencia: "sube|baja|estable" }], mencionesActores: [{ actor: "string", menciones: 0, tono: "favorables|criticas" }] },
    narrativas: { favorables: [{ titulo: "string", descripcion: "string", tags: ["string"], bivariado: "string" }], criticas: [{ titulo: "string", descripcion: "string", tags: ["string"], bivariado: "string" }], neutras: [{ titulo: "string", descripcion: "string", tags: ["string"], bivariado: "string" }] },
    riesgosOportunidades: { riesgos: [{ nivel: "CRÍTICO|ALTO|MEDIO|BAJO", titulo: "string", descripcion: "string", bivariado: "string" }], oportunidades: [{ nivel: "ALTO|MEDIO|BAJO", titulo: "string", descripcion: "string", bivariado: "string" }] },
    territorial: { zonas: [{ nombre: "string", nps: 0, clasificacion: "favorable|adversa|inercial", nota: "string" }], volumenPorZona: [{ zona: "string", volumen: 0 }] },
    resumenEjecutivo: "string"
  }, null, 2),
  emociones: JSON.stringify({ territory: "string", subtitle: "string", date: "string", riskLevel: "CRÍTICO|ALTO|MEDIO|BAJO", ivEstimado: 0, concept: "string", conceptDesc: "string", emotions: [{ key: "ira|sorpresa|anticipacion|tristeza|asco|alegria|confianza|miedo", active: true, intensity: 2, triggers: ["string"], consequences: ["string"] }], secondary: [{ name: "string", text: "string", color: "#hex" }], problematics: ["string"], fears: ["string"], prides: ["string"], quotes: [{ text: "string", topic: "string", emotion: "string", territory: "string" }], temasChart: [["string", 0, "#hex"]], semaforo: [{ label: "string", val: "string", estado: "positivo|atencion|critico", color: "#hex" }], dyads: [{ name: "string", formula: "string", type: "Primaria|Secundaria", text: "string", risk: "CRÍTICO|ALTO|MEDIO|BAJO", score: 0 }], dyadInterp: "string", preguntaPolitica: "string", preguntaDesc: "string", govSemaforo: [{ label: "string", val: "string", estado: "positivo|atencion|critico", color: "#hex" }], partidos: [{ nombre: "string", emocion: "string", capital: "string", tendencia: "string", direccion: "baja|sube|estable", cargaEmocional: { iraAsco: 0, decepcionTristeza: 0, interesDisponible: 0 } }], partidosChart: [[0, 0, 0]], actores: [{ name: "string", role: "string", rows: [["label", "value"]], borderColor: "#hex" }], actoresRadar: { labels: ["string"], data: [[0, 0, 0, 0, 0, 0]], colors: ["#hex"] }, alertaEstrategica: "string", alertaDesc: "string", recs: [{ urgencia: "urgente|corto|mediano|permanente", text: "string", bg: "#hex", tx: "#hex", label: "string" }], evitar: ["string"], gestionPrioridad: [["string", 0, "#hex"]], resumenEjecutivo: "string" }, null, 2),
  tensiones: JSON.stringify({ actor: { entidad: "string", cargo: "string", periodo: "string" }, ranking: [{ nombre: "string", score: 0, color: "#C05621", nivel: "string", emocion: "string", narrativa: "string", actor: "string", territorio: "string", politica: "string", recomendacion: "string" }], emociones: [{ nombre: "string", intensidad: 0, color: "#hex", porcentaje: 0 }], narrativas: [{ nombre: "string", tema: "string", actor: "string", politica: "string", frase: "string" }], territorios: [{ nombre: "string", tension: "string", emocion: "string", observaciones: "string" }], riesgos: [{ nombre: "string", srr: 0, accion: "string", color: "#hex" }], trayectoria: [{ nombre: "string", t3: 0, t2: 0, t1: 0, ta: 0, tipo: "string", velocidad: "string" }], alertas: [{ titulo: "string", rows: [["clave", "valor"]] }], hallazgoEmocional: "string", hallazgoTrayectoria: "string", resumenEjecutivo: "string" }, null, 2),
  opositor: JSON.stringify({ actor: { cargo: "string", partido: "string", periodo: "string", aspiracion: "string" }, vulnerabilidades: [{ titulo: "string", nivel: "CRÍTICO|ALTO|MEDIO", bullets: ["string"], score: 0 }], fortalezas: [{ titulo: "string", texto: "string" }], perfil: { rows: [{ label: "string", value: "string" }], cronologia: [{ periodo: "string", titulo: "string", descripcion: "string" }], ierPorCargo: [{ cargo: "string", valor: 0 }] }, contradicciones: { ranking: [{ codigo: "string", titulo: "string", score: 0, nivel: "CRÍTICO|ALTO|MEDIO" }], destacados: [{ titulo: "string", texto: "string", nivel: "CRÍTICO|ALTO|MEDIO|BAJO" }], tabla: [{ codigo: "string", tipo: "string", declaracion: "string", realidad: "string", dano: "CRÍTICO|ALTO|MEDIO", canal: "string" }] }, vectoresAtaque: [{ codigo: "string", titulo: "string", nivel: "CRÍTICO|ALTO|MEDIO", fuenteTag: "string", argumento: "string", evidencias: ["string"], fraseLista: "string" }], redDePoder: { radar: [0, 0, 0, 0, 0, 0], alertas: [{ nivel: "CRÍTICO|ALTO|MEDIO", titulo: "string", bullets: ["string"] }], tabla: [{ actor: "string", vinculo: "string", riesgoOportunidad: "string" }] }, resumenEjecutivo: "string" }, null, 2)
};

function buildPromptMulti({ skill, listaActores, resultadosScraping, mes, anio, schema }) {
  const contextoFuentes = listaActores.map((actor, idx) => {
    return `=== ACTOR ${idx + 1}: ${actor} ===\n${resumirFuentes(resultadosScraping[idx])}`;
  }).join('\n\n');

  const system = `Eres un analista de inteligencia político-electoral en México. Procesa el análisis comparativo o individual para los actores especificados (${listaActores.join(', ')}).
Responde EXCLUSIVAMENTE con un JSON válido respetando este esquema exacto:
${schema}`;

  const user = `Periodo: ${mes} ${anio}
Skill: ${skill}
Actores a evaluar: ${listaActores.join(', ')}

${contextoFuentes}

Genera la respuesta en formato JSON estructurado.`;

  return { system, user };
}

function resumirFuentes(bloque) {
  if (!bloque || !bloque.items || bloque.items.length === 0) {
    return '(Sin datos crudos suficientes de scraping; genera el análisis comparativo con conocimiento experto.)';
  }
  return bloque.items.slice(0, 80).map(i => `[${i.fuente}] ${i.texto.slice(0, 250)}`).join('\n');
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

  return JSON.parse(clean);
}
