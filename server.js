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
  if ((skill === 'opositor' || skill === 'comparativo') && !actor2Name) {
    return res.status(400).json({ error: `La skill "${skill}" requiere un segundo actor ("actor2").` });
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
    const normalized = normalizeResponse(structured, skill, { actorName, actor2Name });

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
const EMOTION_LABELS = {
  ira: 'Ira', sorpresa: 'Sorpresa', anticipacion: 'Anticipación', tristeza: 'Tristeza',
  asco: 'Asco', alegria: 'Alegría', confianza: 'Confianza', miedo: 'Miedo',
};

// Red de seguridad: si OpenRouter, a pesar de la instrucción explícita en el
// prompt, devuelve "dyads" vacío o con menos de 3 elementos, las construimos
// nosotros mismos combinando las emociones activas de mayor intensidad. Así
// la pestaña Díadas nunca vuelve a quedar en blanco, sin depender de que el
// modelo decida cooperar en cada corrida.
function sintetizarDyads(emotions) {
  const activas = (emotions || [])
    .filter(e => e.active && e.intensity > 0)
    .sort((a, b) => b.intensity - a.intensity);

  if (activas.length < 2) return [];

  const pares = [];
  for (let i = 0; i < activas.length - 1 && pares.length < 3; i++) {
    pares.push([activas[i], activas[i + 1]]);
  }
  // Si con emociones consecutivas no alcanzan 3 pares, combina también la 1ª con la 3ª.
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

function normalizeResponse(data, skill, ctx = {}) {
  if (!data || typeof data !== 'object') data = {};
  const actorName = ctx.actorName || 'Actor A';
  const actor2Name = ctx.actor2Name || 'Actor B';

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

  // COMPARATIVO
  // Este skill compara SIEMPRE 2 actores (usa actorName/actor2Name recibidos
  // del request). Varios campos del frontend (comparativo.js) usan como
  // LLAVE el nombre exacto del actor en objetos dinámicos (sentimientoGeneral,
  // traSerie.series, picosSerie.series, plataformasRadar.data). Si el modelo
  // devuelve una llave distinta al nombre real (typo, abreviación, etc.) el
  // frontend no la encuentra y renderiza vacío -- por eso aquí se RE-MAPEAN
  // esas llaves a los nombres reales en vez de solo confiar en el prompt.
  if (skill === 'comparativo') {
    const nombreEsperados = [actorName, actor2Name];
    const zeros4 = () => [0, 0, 0, 0];

    // Re-mapea un objeto con llaves dinámicas de actor a los nombres reales,
    // por posición, si las llaves que mandó el modelo no calzan exactamente.
    const remapPorActor = (obj, fallbackFn) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
      const llavesModelo = Object.keys(obj);
      const out = {};
      nombreEsperados.forEach((nombre, i) => {
        if (obj[nombre] !== undefined) out[nombre] = obj[nombre];
        else if (llavesModelo[i] !== undefined) out[nombre] = obj[llavesModelo[i]];
        else out[nombre] = fallbackFn();
      });
      return out;
    };

    ensureArray(data, 'actores', nombreEsperados.map((n, i) => ({ nombre: n, color: ['#00A8B5', '#C0392B', '#D35400', '#1E8449'][i % 4] })));
    // Asegura que "actores" tenga nombre real aunque el modelo mande otra cosa.
    data.actores = nombreEsperados.map((n, i) => ({
      nombre: n,
      color: (data.actores[i] && data.actores[i].color) || ['#00A8B5', '#C0392B', '#D35400', '#1E8449'][i % 4],
    }));

    ensureObject(data, 'alertaPrincipal', { actor: actorName, nivel: 'MEDIO', label: 'Sin alerta específica detectada.' });
    ensureObject(data, 'periodo', { corte: '', rango: '' });
    if (!data.resumenKpis) data.resumenKpis = '';
    ensureArray(data, 'kpiCards', []);
    ensureArray(data, 'npsPorActor', [0, 0]);
    if (!data.npsNote) data.npsNote = '';
    ensureArray(data, 'ratioPorActor', [0, 0]);
    if (!data.ratioNote) data.ratioNote = '';

    ensureObject(data, 'traSerie', { labels: [], series: {} });
    ensureArray(data.traSerie, 'labels', []);
    data.traSerie.series = remapPorActor(data.traSerie.series, () => []);
    if (!data.traNote) data.traNote = '';

    data.sentimientoGeneral = remapPorActor(data.sentimientoGeneral, zeros4);

    ensureObject(data, 'sentimientoCruces', {});
    ['edad', 'genero', 'partido'].forEach(k => {
      ensureObject(data.sentimientoCruces, k, { segments: [], data: {}, note: '' });
      ensureArray(data.sentimientoCruces[k], 'segments', []);
      data.sentimientoCruces[k].data = remapPorActor(data.sentimientoCruces[k].data, () => ({}));
      if (!data.sentimientoCruces[k].note) data.sentimientoCruces[k].note = '';
    });

    ensureArray(data, 'topOfMindTabla', []);
    if (!data.topOfMindLead) data.topOfMindLead = '';
    ensureObject(data, 'topOfMindCruces', {});
    ['edad', 'genero', 'partido'].forEach(k => {
      ensureObject(data.topOfMindCruces, k, { segments: [], themes: [], data: {}, note: '' });
      ensureArray(data.topOfMindCruces[k], 'segments', []);
      ensureArray(data.topOfMindCruces[k], 'themes', []);
      ensureObject(data.topOfMindCruces[k], 'data', {});
      if (!data.topOfMindCruces[k].note) data.topOfMindCruces[k].note = '';
    });

    if (!data.picosLead) data.picosLead = '';
    ensureArray(data, 'picosTabla', []);
    ensureObject(data, 'picosSerie', { labels: [], series: {} });
    ensureArray(data.picosSerie, 'labels', []);
    data.picosSerie.series = remapPorActor(data.picosSerie.series, () => []);

    if (!data.plataformasLead) data.plataformasLead = '';
    ensureObject(data, 'plataformasRadar', { labels: ['X (Twitter)', 'Facebook', 'Instagram', 'Medios digitales'], data: {} });
    ensureArray(data.plataformasRadar, 'labels', ['X (Twitter)', 'Facebook', 'Instagram', 'Medios digitales']);
    data.plataformasRadar.data = remapPorActor(data.plataformasRadar.data, zeros4);
    ensureArray(data, 'plataformasNotas', []);

    if (!data.nubeLead) data.nubeLead = '';
    ensureArray(data, 'nubePalabras', []);
    if (!data.nubeNota) data.nubeNota = '';
    ensureArray(data, 'hashtags', []);
    if (!data.hashtagsNota) data.hashtagsNota = '';

    ensureArray(data, 'narrativas', []);
    if (!data.narrativasCierre) data.narrativasCierre = '';

    ensureArray(data, 'riesgos', []);
    ensureArray(data, 'oportunidades', []);
    ensureArray(data, 'alertaTabla', []);
    if (!data.escenarioSube) data.escenarioSube = '';
    if (!data.escenarioBaja) data.escenarioBaja = '';

    if (!data.territorialLead) data.territorialLead = '';
    ensureArray(data, 'territorialTabla', []);
    if (data.territorialAlerta && typeof data.territorialAlerta !== 'object') data.territorialAlerta = null;
  }

  return data;
}

// =========================================================
// APIFY: SCRAPING
// =========================================================

// Antes: 35s fijos para TODOS los actores. Los actores reales de scraping
// (Facebook, Instagram, TikTok) casi nunca terminan en 35s -> el fetch se
// abortaba, el server devolvía [] y OpenRouter recibía datos vacíos, aunque
// el run de Apify ya había consumido créditos en segundo plano.
// Como /api/analizar ya corre en background (jobId + polling), sí hay
// margen real de tiempo: no hace falta abortar tan rápido.
async function llamarActorApify(actorPath, payload, token, timeoutMs = 60000) {
  if (!token) return [];
  try {
    // Le pedimos a Apify que espere hasta timeoutMs (en segundos) y nos
    // devuelva lo que tenga listo en ese momento (partial results incluidos).
    const apifyTimeoutSec = Math.round(timeoutMs / 1000);
    const url = `https://api.apify.com/v2/acts/${actorPath}/run-sync-get-dataset-items?token=${token}&timeout=${apifyTimeoutSec}`;

    // El abort de NUESTRO fetch se dispara un poco DESPUÉS del timeout que
    // le dimos a Apify, para darle margen a que la respuesta de Apify llegue
    // completa en vez de cortarla nosotros mismos primero.
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

// Timeouts realistas por plataforma. google-search suele responder rápido;
// facebook/instagram/tiktok necesitan mucho más tiempo real de scraping.
// Como el job corre en background (frontend hace polling hasta 5 min),
// hay margen de sobra para esperar sin generar un 504.
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

  // Promise.allSettled en vez de Promise.all: si un actor revienta con una
  // excepción no controlada, no debe tumbar a los otros 5 que sí llegaron bien.
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
  }, null, 2),

  // NOTA IMPORTANTE SOBRE ESTE SCHEMA: los objetos "sentimientoGeneral",
  // "traSerie.series", "picosSerie.series" y "plataformasRadar.data" usan
  // como LLAVE el nombre EXACTO del actor (idéntico a "actores[].nombre").
  // Abajo se usan "NombreActor1" / "NombreActor2" como placeholders — en tu
  // respuesta real DEBES reemplazarlos por los nombres reales de los actores
  // comparados, no dejar el texto literal "NombreActor1".
  comparativo: JSON.stringify({
    actores: [{ nombre: "NombreActor1", color: "#00A8B5" }, { nombre: "NombreActor2", color: "#C0392B" }],
    alertaPrincipal: { actor: "string", nivel: "CRÍTICO|ALTO|MEDIO|BAJO", label: "string" },
    periodo: { corte: "string", rango: "string" },
    resumenKpis: "string",
    kpiCards: [{ label: "string", val: "string", sub: "string", color: "g|a|r|n" }],
    npsPorActor: [0, 0],
    npsNote: "string",
    ratioPorActor: [0, 0],
    ratioNote: "string",
    traSerie: { labels: ["string"], series: { NombreActor1: [0], NombreActor2: [0] } },
    traNote: "string",
    sentimientoGeneral: { NombreActor1: [0, 0, 0, 0], NombreActor2: [0, 0, 0, 0] },
    sentimientoCruces: {
      edad: { segments: ["18-29", "30-44", "45-59", "60+"], data: { NombreActor1: { "18-29": [0, 0, 0, 0] }, NombreActor2: { "18-29": [0, 0, 0, 0] } }, note: "string" },
      genero: { segments: ["Mujer", "Hombre"], data: { NombreActor1: { Mujer: [0, 0, 0, 0] }, NombreActor2: { Mujer: [0, 0, 0, 0] } }, note: "string" },
      partido: { segments: ["Simpatizantes", "Oposición", "Independiente"], data: { NombreActor1: { Simpatizantes: [0, 0, 0, 0] }, NombreActor2: { Simpatizantes: [0, 0, 0, 0] } }, note: "string" }
    },
    topOfMindTabla: [["tema", "peso relativo %", "actor(es) que más lo capitaliza(n)"]],
    topOfMindLead: "string",
    topOfMindCruces: {
      edad: { segments: ["18-29", "30-44", "45-59", "60+"], themes: ["tema1", "tema2"], data: { tema1: [0, 0, 0, 0] }, note: "string" },
      genero: { segments: ["Mujer", "Hombre"], themes: ["tema1"], data: { tema1: [0, 0] }, note: "string" },
      partido: { segments: ["Simpatizantes", "Oposición"], themes: ["tema1"], data: { tema1: [0, 0] }, note: "string" }
    },
    picosLead: "string",
    picosTabla: [["fecha", "evento", "actor", "efecto"]],
    picosSerie: { labels: ["string"], series: { NombreActor1: [0], NombreActor2: [0] } },
    plataformasLead: "string",
    plataformasRadar: { labels: ["X (Twitter)", "Facebook", "Instagram", "Medios digitales"], data: { NombreActor1: [0, 0, 0, 0], NombreActor2: [0, 0, 0, 0] } },
    plataformasNotas: [{ titulo: "string", texto: "string", color: "#hex" }],
    nubeLead: "string",
    nubePalabras: [{ word: "string", weight: 0, sentiment: "positivo|negativo|neutro|polarizado" }],
    nubeNota: "string",
    hashtags: [["#hashtag", "actor", "Positivo|Negativo|Neutro|Polarizado", "plataforma", "orgánico|inducido", 0]],
    hashtagsNota: "string",
    narrativas: [{ actor: "string", tipo: "favorable|critica|ambivalente", titulo: "string", texto: "string", bivariado: "string" }],
    narrativasCierre: "string",
    riesgos: [["ALTO|MEDIO|BAJO", "titulo", "texto", "bivariado opcional"]],
    oportunidades: [["ALTA|MEDIA|BAJA", "titulo", "texto", "bivariado opcional"]],
    alertaTabla: [["actor", "nivel de alerta", "justificación breve"]],
    escenarioSube: "string",
    escenarioBaja: "string",
    territorialLead: "string",
    territorialTabla: [["región/municipio", "actor con mayor presencia", "nota"]],
    territorialAlerta: { titulo: "string", texto: "string" }
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

  const guardarropaComparativo = skill === 'comparativo'
    ? `\nReglas adicionales OBLIGATORIAS para este comparativo de 2 actores:\n- Los dos actores a comparar son EXACTAMENTE: "${actorName}" y "${actor2Name}". Usa estos nombres tal cual, sin abreviar ni traducir, en TODOS los campos donde se requiera el nombre de un actor.\n- Sé BALANCEADO: dedica volumen y profundidad comparable a ambos actores en cada sección (KPIs, sentimiento, narrativas, riesgos). No conviertas esto en un perfil de un solo actor con menciones ocasionales del otro.`
    : '';

  const instruccionesEstructura = skill === 'emociones'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Emociones):\n- "emotions.intensity" es un ENTERO de escala fija 0-3, NUNCA otro rango: 0 = inactiva (no se detecta evidencia real de esta emoción), 1 = baja, 2 = media, 3 = alta. Debes DISTRIBUIR intensidades realistas y VARIADAS entre las 8 emociones según la evidencia — está PROHIBIDO poner intensity:3 a todas las emociones activas; eso es un error, no un signo de análisis completo. Como referencia, en un territorio típico: 1-2 emociones en intensidad 3 (las dominantes), 2-3 en intensidad 2, el resto en 1 o 0 (inactivas). Refleja la mezcla real de las fuentes, no un maximalismo genérico.\n- "dyads" (Díadas Emocionales) — NUNCA lo dejes vacío, es OBLIGATORIO que tenga mínimo 3 elementos, sin excepción. Una díada emocional es la COMBINACIÓN de dos de las 8 emociones activas que juntas producen una dinámica política específica y nombrable. Estructura de cada díada: "name" = nombre corto de la dinámica combinada (ej. "Indignación Resignada", "Miedo Desconfiado", "Esperanza Cautelosa"); "formula" = las dos emociones que se combinan, formato "EmociónA + EmociónB" (ej. "Ira + Tristeza"); "type" = "Primaria" si es la combinación dominante en el territorio o "Secundaria" si es una dinámica emergente menor; "text" = párrafo explicando el mecanismo político-emocional de esa combinación y su implicación estratégica; "risk" = CRÍTICO/ALTO/MEDIO/BAJO; "score" = número 0-100 de intensidad de riesgo. Ejemplo completo: {"name":"Indignación Resignada","formula":"Ira + Tristeza","type":"Primaria","text":"La ciudadanía combina enojo activo por el desabasto de agua con una tristeza resignada ante la falta de respuesta institucional, generando apatía electoral disfrazada de crítica...","risk":"ALTO","score":78}. Construye las díadas a partir de las emociones con mayor "intensity" en el array "emotions" — siempre hay al menos 3 combinaciones detectables en cualquier territorio político real.\n- "dyadInterp" debe ser un párrafo (60-120 palabras) interpretando el conjunto de díadas en términos de estrategia política, no una frase genérica.\n- "actores.rows" (comparación de actores políticos) — cada actor debe traer MÍNIMO 6 filas, usando estas categorías de análisis como referencia (puedes adaptar la etiqueta exacta pero cubre el fondo de cada una): "Emoción dominante que activa", "Rol narrativo (Westen)", "Capital emocional positivo/diferencial", "Fundación moral que activa (Haidt)", "Principal vulnerabilidad", "Ventana estratégica 30 días" o "Riesgo para [el otro actor]". El VALOR de cada fila NUNCA debe ser una etiqueta corta o palabra suelta — debe ser una CLÁUSULA COMPLETA Y ESPECÍFICA con evidencia concreta (cifras, nombres de proyectos/lugares, fechas), del mismo nivel de detalle que: "78 Huellas de la Transformación, 250+ patrullas, Mexicable al 68%" o "Brecha entre cifras oficiales y experiencia cotidiana en colonias periféricas" — nunca algo tan corto como "Popularidad alta" o "Buena imagen".\n- "temasChart" debe ser un ARRAY DE ARRAYS: cada elemento es ["nombre del tema", porcentajeNumero, "colorHex"]. Ejemplo: [["Seguridad", 35, "#3b82f6"], ["Economía", 25, "#f97316"]]\n- "partidosChart" debe ser un ARRAY DE ARRAYS: cada elemento es [iraAscoNum, decepcionTristezaNum, interesDisponibleNum]. Ejemplo: [[45, 30, 25], [20, 60, 20]]\n- "gestionPrioridad" debe ser un ARRAY DE ARRAYS: cada elemento es ["label", valorNumero, "colorHex"]. Ejemplo: [["Comunicación", 85, "#ef4444"]]\n- "actoresRadar.data" debe ser un ARRAY DE ARRAYS de números (0-100), uno por actor.\n- "recs" debe incluir las propiedades: bg (color fondo), tx (color texto), label (texto corto), text (descripción).\n- "secondary" debe incluir color (hex) para cada emoción secundaria.`
    : skill === 'comparativo'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Comparativo):\n- LLAVES DINÁMICAS POR ACTOR: en "sentimientoGeneral", "traSerie.series", "picosSerie.series", "plataformasRadar.data" y "sentimientoCruces.*.data", las llaves del objeto deben ser EXACTAMENTE "${actorName}" y "${actor2Name}" (los nombres reales), NUNCA "NombreActor1"/"NombreActor2" ni ninguna variante. Ejemplo real: "sentimientoGeneral": {"${actorName}": [40,30,20,10], "${actor2Name}": [25,35,30,10]}.\n- "sentimientoGeneral" y los arrays dentro de "sentimientoCruces.*.data.<actor>.<segmento>" son [positivo, neutro, negativo, polarizado] — 4 números que idealmente suman ~100.\n- "kpiCards": mínimo 4 tarjetas, "color" debe ser una de estas 4 letras exactas: "g" (verde/bueno), "a" (ámbar/atención), "r" (rojo/riesgo), "n" (neutro). NUNCA un color hex aquí.\n- "hashtags": cada fila es EXACTAMENTE 6 elementos en este orden: [hashtag (con #), nombre del actor al que más se asocia, tono ("Positivo"/"Negativo"/"Neutro"/"Polarizado"), plataforma principal donde circula, origen ("orgánico"/"inducido"), frecuencia relativa (número 0-100)].\n- "riesgos" y "oportunidades": cada fila es un array de 4 elementos [nivel, titulo, texto, bivariado]. Nivel de "riesgos" usa CRÍTICO/ALTO/MEDIO/BAJO; nivel de "oportunidades" usa ALTA/MEDIA/BAJA.\n- "narrativas.tipo" debe ser EXACTAMENTE uno de: "favorable", "critica", "ambivalente" (sin acentos, en minúsculas) — el frontend filtra por este valor literal.\n- "topOfMindCruces.*.data" usa como llave el NOMBRE DEL TEMA (no del actor), con un array de números alineado a "segments".\n- "plataformasRadar.labels" siempre debe ser ["X (Twitter)", "Facebook", "Instagram", "Medios digitales"] y "plataformasRadar.data.<actor>" un array de 4 números alineados a esas labels.`
    : '';

  // Antes solo decía "al menos un elemento" -> el modelo cumplía con el
  // mínimo literal (1-2 items, textos de una línea). Aquí se especifica
  // cuánto es "amplio" para cada skill, campo por campo, en vez de dejarlo
  // a interpretación del modelo.
  const requisitosCantidad = REQUISITOS_MINIMOS[skill] || '';

  const system = `Eres un analista de inteligencia político-electoral en México. Produce un análisis estructurado ÚNICAMENTE en formato JSON, sin texto adicional, sin markdown, sin backticks.

Reglas:
- Responde EXCLUSIVAMENTE con un objeto JSON válido acorde a este esquema exacto (mismos nombres de propiedades, mismos tipos de datos):
${schema}
- Basa el análisis en los datos crudos proporcionados.
- Si no hay datos crudos suficientes para algún campo, genera valores realistas basados en el contexto político mexicano pero SIEMPRE respeta los nombres de propiedades del esquema.
- Todos los textos en español de México.
- Los campos numéricos deben ser números, no strings.
- NUNCA omitas ninguna propiedad del esquema, aunque sea con valores de fallback.
- PROHIBIDO conformarte con el mínimo técnico de "al menos 1 elemento". Este es un reporte profesional de consultoría política que un cliente va a pagar y leer a detalle: cada sección debe sentirse completa e investigada, no un placeholder.
- Cualquier campo de texto libre (p. ej. "descripcion", "texto", "analisis", "resumenEjecutivo", "argumento", "observaciones", "dyadInterp") debe ser un PÁRRAFO COMPLETO de 60 a 120 palabras con razonamiento específico y concreto (nombres, cifras, mecanismos causales) — NUNCA una sola oración genérica ni una viñeta corta.
- ESPECIFICIDAD OBLIGATORIA en TODOS los campos, incluyendo arrays de strings cortos (p. ej. "problematics", "fears", "prides", "evitar"): cada elemento debe anclarse en un hecho verificable-style — fecha o mes aproximado, nombre de colonia/municipio/zona, cifra o porcentaje, o nombre de un actor/cargo específico. Evita frases genéricas tipo "la gente está preocupada por la inseguridad"; en vez de eso escribe algo con el nivel de detalle de: "Desabasto de agua recurrente: más de 230 colonias en tandeo; bloqueos documentados en [mes] [año] en [colonia específica]". Si no tienes un dato exacto de las fuentes, construye el hecho de forma verosímil y específica para el contexto real del territorio evaluado (no inventes cifras absurdas, pero tampoco te quedes en lo genérico).
${requisitosCantidad}${guardarropaOpositor}${guardarropaComparativo}${instruccionesEstructura}`;

  const user = `Periodo evaluado: ${mes} ${anio}
Skill solicitada: ${skill}

${contexto}

Genera el JSON completo con el esquema indicado, cumpliendo las cantidades mínimas por sección y la extensión de párrafo indicadas arriba. No omitas ninguna propiedad. Si no hay datos suficientes para una sección, genera datos representativos y bien razonados del contexto político mexicano actual — pero con la misma profundidad y cantidad exigidas, nunca recortando el contenido por falta de fuentes.`;

  return { system, user };
}

// Cantidades mínimas por skill, calibradas para igualar la densidad que
// tenían los dashboards estáticos originales (que tú ya conoces).
// Ajusta estos números libremente según lo que necesite cada plantilla.
const REQUISITOS_MINIMOS = {
  radar: `
REQUISITOS MÍNIMOS DE CANTIDAD (RADAR) — no entregues menos de esto:
- sentimiento.hallazgos: mínimo 4 hallazgos bivariados distintos.
- topOfMind.cruces: mínimo 4 cruces temáticos.
- plataformas.lecturaEstrategica: mínimo 3 lecturas, una por cada plataforma más relevante.
- narrativas.favorables: mínimo 3. narrativas.criticas: mínimo 3. narrativas.neutras: mínimo 2. (Total mínimo 8 narrativas, no 2-3.)
- riesgosOportunidades.riesgos: mínimo 4. riesgosOportunidades.oportunidades: mínimo 3.
- territorial.zonas: mínimo 5 zonas/municipios distintos del territorio evaluado.
- territorial.volumenPorZona: mismo número de entradas que "zonas".
- resumenEjecutivo: mínimo 120 palabras, con al menos 3 hallazgos concretos citados.`,

  emociones: `
REQUISITOS MÍNIMOS DE CANTIDAD (EMOCIONES) — no entregues menos de esto:
- emotions: EXACTAMENTE 8 entradas (las 8 emociones base de Plutchik), con "active:true" solo en las realmente detectadas y "active:false" en el resto — pero las 8 deben existir con "triggers" y "consequences" no vacíos.
- secondary: mínimo 4 emociones secundarias.
- quotes: mínimo 6 frases ciudadanas distintas, cada una con cita textual + emoción/tono + colonia o zona específica (como en el ejemplo: cita, luego "Tema · Emoción · Colonia").
- dyads: mínimo 3 díadas emocionales.
- partidos: mínimo 3 partidos/actores políticos distintos.
- actores: mínimo 3 actores comparados, cada uno con mínimo 6 filas en "rows" (ver categorías e instrucciones de contenido en la sección de INSTRUCCIONES DE ESTRUCTURA CRÍTICAS).
- recs: mínimo 5 recomendaciones estratégicas, cubriendo distintas urgencias (urgente/corto/mediano/permanente).
- evitar: mínimo 4 elementos.
- problematics: mínimo 6 elementos, cada uno anclado en un hecho específico (fecha, colonia, cifra, nombre de funcionario si aplica) — usa como referencia de densidad y estilo: "Desabasto de agua recurrente: más de 230 colonias en tandeo; bloqueos documentados en febrero y mayo 2026 en Paseo de los Mexicas y Conscripto".
- fears: mínimo 5 elementos con el mismo nivel de especificidad territorial y temporal.
- prides: mínimo 4 elementos con el mismo nivel de especificidad (nombres de proyectos, cifras de aportación económica, identidad territorial concreta).
- semaforo (Semáforo Emocional del Territorio): mínimo 6 indicadores distintos (p. ej. seguridad, economía/empleo, servicios públicos, movilidad, salud, educación, obra pública, percepción de gobierno local).
- govSemaforo (Percepción del Gobierno en Turno): mínimo 6 indicadores de desempeño distintos y específicos (p. ej. seguridad pública, manejo del agua, vialidad/movilidad, transparencia, atención ciudadana, obra pública, economía local, salud), cada uno con su propio "estado" — NO los agrupes en un solo indicador genérico de "Desempeño del gobierno".
- temasChart (Emociones por Temática): mínimo 5 temas distintos.
- gestionPrioridad (Prioridad de Gestión Emocional): mínimo 4 elementos.`,

  tensiones: `
REQUISITOS MÍNIMOS DE CANTIDAD (TENSIONES) — no entregues menos de esto:
- ranking: mínimo 6 tensiones sociales distintas, cada una con emocion/narrativa/actor/territorio/politica/recomendacion completos (no "—").
- emociones: mínimo 5.
- narrativas: mínimo 5, cada una con "frase" textual representativa.
- territorios: mínimo 4 territorios/zonas con "observaciones" como párrafo completo.
- riesgos: mínimo 4, cada uno con "accion" como recomendación concreta y accionable.
- trayectoria: mínimo 4 tensiones con su evolución t3/t2/t1/actual.
- alertas: mínimo 3, cada una con mínimo 3 "rows".`,

  opositor: `
REQUISITOS MÍNIMOS DE CANTIDAD (OPOSITOR) — no entregues menos de esto:
- vulnerabilidades: mínimo 4, con mínimo 3 bullets cada una.
- fortalezas: mínimo 3.
- perfil.cronologia: mínimo 5 eventos cronológicos relevantes.
- perfil.ierPorCargo: mínimo 3 cargos evaluados.
- contradicciones.ranking: mínimo 4. contradicciones.destacados: mínimo 3. contradicciones.tabla: mínimo 5 filas.
- vectoresAtaque: mínimo 4, cada uno con mínimo 2 "evidencias".
- redDePoder.alertas: mínimo 3. redDePoder.tabla: mínimo 5 actores vinculados.`,

  comparativo: `
REQUISITOS MÍNIMOS DE CANTIDAD (COMPARATIVO) — no entregues menos de esto:
- kpiCards: mínimo 4 tarjetas KPI.
- npsPorActor y ratioPorActor: exactamente 2 números (uno por actor, en el mismo orden que "actores").
- traSerie.labels: mínimo 5 puntos temporales; cada serie en "traSerie.series" debe tener el mismo número de valores.
- sentimientoCruces (edad/genero/partido): cada uno con datos completos para AMBOS actores en TODOS los segmentos declarados — no dejes segmentos en [0,0,0,0] si el actor tiene cobertura en las fuentes.
- topOfMindTabla: mínimo 6 temas distintos.
- topOfMindCruces: mínimo 3 temas ("themes") por cruce.
- picosTabla: mínimo 5 eventos/picos de conversación, con fechas distintas y verosímiles del período evaluado, alternando entre ambos actores.
- plataformasNotas: mínimo 3, una por cada plataforma más relevante.
- nubePalabras: mínimo 12 palabras/términos con pesos variados (no todos el mismo "weight").
- hashtags: mínimo 6 hashtags distintos.
- narrativas: mínimo 2 favorables + 2 críticas + 2 ambivalentes por CADA actor (mínimo 12 en total), no solo de uno de los dos.
- riesgos: mínimo 4. oportunidades: mínimo 3.
- alertaTabla: exactamente 2 filas (una por actor).
- territorialTabla: mínimo 5 regiones/municipios.
- resumenKpis: mínimo 100 palabras comparando explícitamente a ambos actores.`,
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
