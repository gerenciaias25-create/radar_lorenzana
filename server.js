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
    actor3 = '',
    actor4 = '',
    actor5 = '',
    actor6 = '',
    mes = 'Agosto',
    anio = '2026',
  } = params;

  const actorName = String(actor).trim();
  const actor2Name = String(actor2 || '').trim();
  // Actores 3-6 son EXCLUSIVOS de "comparativo" (hasta 6 en total). Para el
  // resto de skills se ignoran aunque lleguen en el body.
  const extraActores = skill === 'comparativo'
    ? [actor3, actor4, actor5, actor6].map(a => String(a || '').trim()).filter(Boolean)
    : [];
  // Lista completa sin duplicados vacíos, en el orden en que se capturaron.
  const actoresNombres = [actorName, actor2Name, ...extraActores].filter(Boolean);

  if (!actorName) {
    return res.status(400).json({ error: 'El parámetro "actor" es requerido.' });
  }
  if ((skill === 'opositor' || skill === 'comparativo') && !actor2Name) {
    return res.status(400).json({ error: `La skill "${skill}" requiere un segundo actor ("actor2").` });
  }
  if (skill === 'comparativo' && actoresNombres.length > 6) {
    return res.status(400).json({ error: 'La skill "comparativo" admite un máximo de 6 actores.' });
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
  procesarAnalisis({ jobId, skill, actorName, actor2Name, actoresNombres, mes, anio, APIFY_TOKEN, OPENROUTER_KEY });

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

async function procesarAnalisis({ jobId, skill, actorName, actor2Name, actoresNombres, mes, anio, APIFY_TOKEN, OPENROUTER_KEY }) {
  try {
    const listaActores = skill === 'comparativo' && actoresNombres?.length ? actoresNombres : [actorName, actor2Name].filter(Boolean);
    console.log(`[+] Iniciando análisis (${jobId}) para: ${listaActores.join(' vs ')} (${skill})`);

    JOBS.set(jobId, { status: 'processing', progreso: `Extrayendo fuentes en Apify para ${listaActores.length} actor(es) (X, Facebook, Instagram, TikTok, YouTube, prensa)...` });

    let datosActor1, datosActor2, datosPorActor;

    if (skill === 'comparativo') {
      // N actores (2-6), cada uno con sus 6 fuentes en paralelo. Con 6 actores
      // esto son hasta 36 llamadas a Apify simultáneas -- vigila el consumo
      // de créditos/concurrencia de tu plan si usas el máximo de actores.
      const resultados = await Promise.allSettled(listaActores.map(nombre => scrapeActor(nombre, APIFY_TOKEN)));
      datosPorActor = resultados.map(r => r.status === 'fulfilled' ? r.value : { count: 0, items: [] });
    } else {
      // 1. Scraping masivo (6 fuentes en paralelo) -- flujo original para
      //    radar/emociones/tensiones/opositor, sin tocar.
      [datosActor1, datosActor2] = await Promise.all([
        scrapeActor(actorName, APIFY_TOKEN),
        actor2Name ? scrapeActor(actor2Name, APIFY_TOKEN) : Promise.resolve(null),
      ]);
    }

    JOBS.set(jobId, { status: 'processing', progreso: 'Estructurando datos con OpenRouter...' });

    // 2. Estructuración con OpenRouter
    const schema = SCHEMAS[skill] || SCHEMAS.radar;
    const prompt = buildPrompt({ skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, datosActor1, datosActor2, schema });
    const structured = await callOpenRouter(prompt, OPENROUTER_KEY);

    // 3. Normalizar respuesta para asegurar que todos los arrays existan
    const normalized = normalizeResponse(structured, skill, { actorName, actor2Name, actoresNombres: listaActores });

    // "socioafectiva" tiene una pestaña de Fuentes con enlaces citables: se
    // reemplaza lo que haya devuelto el modelo (que podría inventar URLs)
    // por la lista real construida a partir de las URLs efectivamente
    // scrapeadas, para no exponer citas falsas.
    if (skill === 'socioafectiva' || skill === 'semiotica') {
      const fuentesReales = construirFuentesReales(datosActor1);
      if (fuentesReales.length) normalized.fuentes = fuentesReales;
    }

    const fuentesEncontradas = skill === 'comparativo'
      ? (datosPorActor || []).reduce((sum, d) => sum + (d?.count || 0), 0)
      : (datosActor1?.count || 0) + (datosActor2?.count || 0);

    JOBS.set(jobId, {
      status: 'done',
      result: {
        skill,
        actor: actorName,
        actor2: actor2Name || null,
        actores: skill === 'comparativo' ? listaActores : undefined,
        periodo: `${mes} ${anio}`,
        fuentesEncontradas,
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
  // Para "comparativo" puede haber de 2 a 6 actores; si ctx.actoresNombres
  // viene poblado (desde procesarAnalisis) se usa esa lista completa.
  const actoresNombresCtx = (ctx.actoresNombres && ctx.actoresNombres.length)
    ? ctx.actoresNombres
    : [actorName, actor2Name].filter(Boolean);

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
    if (!data.segIntro) data.segIntro = '';
    ensureArray(data, 'segmentos', []);
    ensureObject(data, 'semiotica', {});
    ensureObject(data.semiotica, 'arquetipoColectivo', { dominante: '', secundario: '', emergente: '', rechazado: '' });
    ensureObject(data.semiotica, 'arquetipoPolitico', { ideal: '', secundario: '', resonancia: '', evidencia: '' });
    ensureArray(data.semiotica, 'arquetiposRadar', new Array(12).fill(0));
    ensureArray(data.semiotica, 'miedos', []);
    ensureArray(data.semiotica, 'deseos', []);
    ensureArray(data.semiotica, 'necesidades', []);
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
    ensureObject(data, 'cartografiaSocioafectiva', {
      iasPorZona: [], dolores: [], enemigosSimbolicos: [], fracturasSociales: [], segmentacion: [],
      narrativaMadre: '', narrativaMadreDesc: '', narrativas: [], preguntas: []
    });
    ensureArray(data.cartografiaSocioafectiva, 'iasPorZona', []);
    ensureArray(data.cartografiaSocioafectiva, 'dolores', []);
    ensureArray(data.cartografiaSocioafectiva, 'enemigosSimbolicos', []);
    ensureArray(data.cartografiaSocioafectiva, 'fracturasSociales', []);
    ensureArray(data.cartografiaSocioafectiva, 'segmentacion', []);
    ensureArray(data.cartografiaSocioafectiva, 'narrativas', []);
    ensureArray(data.cartografiaSocioafectiva, 'preguntas', []);
    if (!data.cartografiaSocioafectiva.narrativaMadre) data.cartografiaSocioafectiva.narrativaMadre = '';
    if (!data.cartografiaSocioafectiva.narrativaMadreDesc) data.cartografiaSocioafectiva.narrativaMadreDesc = '';
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

  // SESGO (sesgos cognitivos electorales)
  if (skill === 'sesgo') {
    ensureObject(data, 'meta', { entidad: 'Sin entidad', segmento: 'Electorado general', periodo: '', fuentes: 0, estado: 'LIMITADO', ventanaPersuasion: 'Entreabierta' });
    ensureObject(data, 'metricas', {});
    ensureObject(data.metricas, 'sesgosCriticos', { valor: 0, detalle: '' });
    ensureObject(data.metricas, 'sesgosAltos', { valor: 0, detalle: '' });
    ensureObject(data.metricas, 'sri', { valor: 0, nivel: 'Medio', detalle: '' });
    ensureObject(data.metricas, 'sistemaDominante', { valor: 'Sistema 1', detalle: '' });
    ensureArray(data, 'ranking', []);
    ensureArray(data, 'segmentos', []);
    ensureArray(data, 'ventanasPersuasion', []);
    ensureArray(data, 'arquitecturaMensajes', []);
    if (!data.resumenEjecutivo) data.resumenEjecutivo = '';
  }

  // SOCIOAFECTIVA (cartografía socioafectiva territorial)
  if (skill === 'socioafectiva') {
    ensureObject(data, 'meta', { territorio: actorName, ventana: '', modalidad: '', fuentesRevisadas: 0, corte: '' });
    ensureObject(data, 'indice', { valor: 0, lecturaBrutal: '' });
    ensureArray(data, 'issues', []);
    ensureArray(data, 'radiografia', []);
    ensureArray(data, 'hallazgos', []);
    ensureArray(data, 'emociones', []);
    ensureObject(data, 'sintesisEmocional', { dominante: '', secundaria: '', masPeligrosa: '', masPeligrosaRiesgo: '', masMovilizable: '', masMovilizableEvidencia: '', masDesaprovechada: '', masDesaprovechadaEvidencia: '' });
    ensureArray(data, 'dolores', []);
    ensureArray(data, 'simbolos', []);
    ensureArray(data, 'zonas', []);
    ensureArray(data, 'enemigos', []);
    ensureArray(data, 'segmentos', []);
    ensureArray(data, 'actores', []);
    ensureArray(data, 'narrativas', []);
    ensureObject(data, 'narrativaMadre', { fraseRectora: '', heridaCentral: '', enemigoSimbolico: '', promesaEmocional: '', protagonista: '', futuroDeseado: '', tonoNarrativo: '', simbolosUsar: '', simbolosEvitar: '', mensajesFuerza: [] });
    ensureArray(data.narrativaMadre, 'mensajesFuerza', []);
    ensureArray(data, 'riesgos', []);
    ensureArray(data, 'oportunidades', []);
    ensureArray(data, 'recomendaciones', []);
    ensureArray(data, 'preguntas9', []);
    ensureArray(data, 'fuentes', []);
    if (!data.conclusionEjecutiva) data.conclusionEjecutiva = '';
  }

  // COMPARATIVO
  // Este skill compara de 2 a 6 actores (usa ctx.actoresNombres, con
  // [actorName, actor2Name] como respaldo si no viene poblado). Varios campos
  // del frontend (comparativo.js) usan como LLAVE el nombre exacto del actor
  // en objetos dinámicos (sentimientoGeneral, traSerie.series,
  // picosSerie.series, plataformasRadar.data). Si el modelo devuelve una
  // llave distinta al nombre real (typo, abreviación, etc.) el frontend no
  // la encuentra y renderiza vacío -- por eso aquí se RE-MAPEAN esas llaves
  // a los nombres reales en vez de solo confiar en el prompt.
  if (skill === 'comparativo') {
    const nombreEsperados = actoresNombresCtx;
    const zeros4 = () => [0, 0, 0, 0];
    // Colores ya usados en las variables CSS de comparativo.html (--teal,
    // --red, --orange, --green, --amber, --blue2), para que el color de cada
    // actor siempre coincida con la paleta visual del propio skill.
    const PALETA_ACTORES = ['#00A8B5', '#C0392B', '#D35400', '#1E8449', '#C49A00', '#1B4F8A'];

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

    ensureArray(data, 'actores', nombreEsperados.map((n, i) => ({ nombre: n, color: PALETA_ACTORES[i % PALETA_ACTORES.length] })));
    // Asegura que "actores" tenga nombre real aunque el modelo mande otra cosa,
    // y que el número de actores coincida EXACTAMENTE con los solicitados
    // (si el modelo devuelve de más o de menos, se recorta o se completa).
    data.actores = nombreEsperados.map((n, i) => ({
      nombre: n,
      color: (data.actores[i] && data.actores[i].color) || PALETA_ACTORES[i % PALETA_ACTORES.length],
    }));

    ensureObject(data, 'alertaPrincipal', { actor: actorName, nivel: 'MEDIO', label: 'Sin alerta específica detectada.' });
    ensureObject(data, 'periodo', { corte: '', rango: '' });
    if (!data.resumenKpis) data.resumenKpis = '';
    ensureArray(data, 'kpiCards', []);
    ensureArray(data, 'npsPorActor', nombreEsperados.map(() => 0));
    if (data.npsPorActor.length !== nombreEsperados.length) {
      data.npsPorActor = nombreEsperados.map((_, i) => data.npsPorActor[i] ?? 0);
    }
    if (!data.npsNote) data.npsNote = '';
    ensureArray(data, 'ratioPorActor', nombreEsperados.map(() => 0));
    if (data.ratioPorActor.length !== nombreEsperados.length) {
      data.ratioPorActor = nombreEsperados.map((_, i) => data.ratioPorActor[i] ?? 0);
    }
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

  // SEMIOTICA (semiótica política digital territorial)
  if (skill === 'semiotica') {
    ensureObject(data, 'territorio', { nombre: actorName, ventana: '', corte: '', fuentesRevisadas: 0, metodologiaModulos: '13 módulos' });
    ensureObject(data, 'kpis', { arquetipoColectivo: 'Sin datos', arquetipoColectivoDesc: '', arquetipoIdeal: 'Sin datos', arquetipoIdealDesc: '', tensionDominante: 'Sin datos', tensionDominanteDesc: '', irsTopActor: 'Sin datos', irsTopScore: 0, irsTopEstado: 'warning' });
    if (!data.codigoSimbolico) data.codigoSimbolico = 'No se recibieron datos estructurados del backend.';
    ensureArray(data, 'signos', []);
    ensureArray(data, 'poblacion', []);
    ensureArray(data, 'significacion', []);
    ensureArray(data, 'narrativas', []);
    ensureObject(data, 'frameDominante', { titulo: 'Frame dominante (Lakoff)', bullets: [] });
    ensureArray(data.frameDominante, 'bullets', []);
    ensureObject(data, 'fundacionesMorales', { titulo: 'Fundaciones morales activas (Haidt)', bullets: [] });
    ensureArray(data.fundacionesMorales, 'bullets', []);
    ensureArray(data, 'miedos', []);
    ensureArray(data, 'deseos', []);
    ensureArray(data, 'necesidades', []);
    ensureArray(data, 'simbolosPoder', []);
    ensureArray(data, 'mapaMemetico', []);
    ensureArray(data, 'cosmovision', []);
    ensureArray(data, 'arquetipos', []);
    ensureObject(data, 'arquetipoIdealPrincipal', { rol: '', nombre: '', texto: '', riesgo: '' });
    ensureObject(data, 'arquetipoIdealSecundario', { rol: '', nombre: '', texto: '', riesgo: '' });
    ensureArray(data, 'tensiones', []);
    ensureArray(data, 'matrizEstrategica', []);
    ensureObject(data, 'irs', { actores: [], nota1: '', nota2: '' });
    ensureArray(data.irs, 'actores', []);
    ensureArray(data, 'fuentes', []);
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
      url: i.url || i.link || i.webUrl || i.postUrl || i.permalink || null,
    }))
    .filter(t => t.texto && t.texto.length > 8)
    .slice(0, 160);

  return { count: textos.length, items: textos };
}

function tag(items, fuente) {
  return (items || []).map(i => ({ ...i, __fuente: fuente }));
}

// Construye la pestaña "Fuentes" (solo usada por "socioafectiva") a partir de
// metadatos REALES del scraping — nunca del modelo — para evitar que
// OpenRouter invente títulos de artículos o URLs que parezcan reales pero
// sean falsas. Deduplica por URL y descarta cualquier item sin URL (mejor
// pocas fuentes reales que una lista larga con enlaces inventados).
function construirFuentesReales(bloque, max = 24) {
  if (!bloque || !bloque.items) return [];
  const vistos = new Set();
  const out = [];
  for (const item of bloque.items) {
    if (!item.url || vistos.has(item.url)) continue;
    vistos.add(item.url);
    const titulo = (item.texto || '').replace(/\s+/g, ' ').trim().slice(0, 140) || `Publicación en ${item.fuente}`;
    out.push({ titulo, url: item.url, fuente: item.fuente });
    if (out.length >= max) break;
  }
  return out;
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
    resumenEjecutivo: "string",
    segIntro: "string (párrafo metodológico introductorio de la segmentación N×E×I — Narrativa × Emoción × Identidad — para este territorio)",
    segmentos: [
      {
        tipo: "string (código de tipo, ej. 'T1 · LEAL ACTIVO')",
        nombre: "string (nombre evocador y memorable del segmento)",
        subtitulo: "string (una línea describiendo a quién representa este segmento)",
        peso: "string (peso estimado del segmento, ej. '22% [ESTIMACIÓN]')",
        persuabilidad: "string (ej. 'YA ES NUESTRO' | 'MUY ALTA' | 'ALTA' | 'MEDIA' | 'BAJA')",
        persuColor: "#hex",
        objetivo: "MOVILIZAR|PERSUADIR|CONTENER|IGNORAR",
        color: "#hex",
        frase: "string (cita ciudadana textual representativa del segmento, sin comillas, se agregan en frontend)",
        perfil: { edad: "string", zona: "string", ocupacion: "string", escolaridad: "string", digital: "string (hábitos y canales de consumo digital)", historia: "string (historia electoral/comportamiento de voto previo)" },
        emocional: { emocion: "string (emoción Plutchik dominante + intensidad + hacia qué/quién se dirige)", cotidiana: "string (cómo se manifiesta en la vida diaria)", tension: "string (tensión política activa que vive este segmento)", dolor: "string (dolor profundo específico)", miedo: "string", orgullo: "string", narrativa: "string (frase/narrativa maestra que mejor lo describe)" },
        palancas: { problemas: ["string (2-4 problemas críticos)"], orgullo: "string (orgullo comunitario que comparte)", consumo: "string (consumo digital predominante)", acerca: "string (qué acerca a este segmento a un candidato)", aleja: "string (qué lo aleja)", frame: "string (marco cognitivo/framing dominante)", palanca: "string (palanca estratégica de comunicación recomendada)" },
        vector: { canal: "string (canal recomendado)", tono: "string (tono de comunicación recomendado)", formato: "string (formato de contenido recomendado)" }
      }
    ],
    semiotica: {
      arquetipoColectivo: {
        dominante: "string (arquetipo junguiano dominante + evidencia concreta que lo sustenta)",
        secundario: "string (arquetipo secundario + por qué emerge)",
        emergente: "string (arquetipo emergente + qué lo impulsa)",
        rechazado: "string (arquetipo que la ciudadanía rechaza + por qué es riesgoso para un candidato)"
      },
      arquetipoPolitico: {
        ideal: "string (nombre del arquetipo político ideal que busca la ciudadanía, ej. 'Guerrero')",
        secundario: "string (arquetipo complementario, ej. 'Cuidador')",
        resonancia: "string (ej. '4.2 / 5')",
        evidencia: "string (párrafo explicando por qué ese arquetipo es el ideal y el riesgo de sobreactuación si un candidato lo fuerza sin resultados reales)"
      },
      arquetiposRadar: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      miedos: [{ rank: 0, nombre: "string", evidencia: "string (hecho/fuente concreta)", significado: "string (lectura política)" }],
      deseos: [{ rank: 0, nombre: "string", evidencia: "string", significado: "string" }],
      necesidades: [{ rank: 0, nombre: "string", evidencia: "string", significado: "string" }]
    }
  }, null, 2),

  tensiones: JSON.stringify({
    actor: { entidad: "string", cargo: "string", periodo: "string" },
    ranking: [
      {
        nombre: "string",
        score: 0,
        color: "#C05621",
        nivel: "Alto|Relevante|Medio|Bajo",
        emocion: "string (formato: 'EmociónPrimaria + EmociónSecundaria · X/5', ej. 'Hartazgo + Desprotección · 4/5')",
        narrativa: "string (frase textual entrecomillada que resume el sentir ciudadano, ej. 'El agua es un privilegio en Pachuca')",
        actor: "string (institución/persona responsable, puede ser una cadena 'A - B - C')",
        territorio: "string (colonias/zonas específicas afectadas)",
        politica: "string (potencial político/de movilización: riesgo de bloqueos, paro, viralización, etc., específico y accionable)",
        evidencia: "string (párrafo de evidencia documentada con cifras y fuente entre paréntesis, ej. 'Corte de hasta 96h en mayo por rehabilitación planta X (La Silla Rota, ICF 4.3)')",
        recomendacion: "string (acción concreta y específica, no genérica)"
      }
    ],
    emociones: [
      { nombre: "string", intensidad: 0, color: "#hex", porcentaje: 0, descripcion: "string (una línea explicando el tipo/origen/tendencia de esta emoción, ej. 'Estructural, multi-frente · Agua, tarifa de transporte y comercio informal se acumulan sin resolución visible')" }
    ],
    narrativas: [
      { nombre: "string", tema: "string", actor: "string", politica: "string (impacto/potencial político de esta narrativa)", frase: "string (cita textual representativa)", fuente: "string (medio y fecha aproximada, ej. 'La Silla Rota, mayo-julio 2026')" }
    ],
    territorios: [
      { nombre: "string", tension: "string", emocion: "string", color: "Rojo|Naranja|Amarillo", observaciones: "string (evidencia documentada con cifras concretas: número de afectados, fechas, montos, y fuente entre paréntesis)" }
    ],
    riesgos: [
      { nombre: "string", srr: 0, accion: "string", color: "#hex", actorExpuesto: "string", tipoSenal: "Amplificada legítima|Orgánica|Inducida|Aislada", probEscalar: "Alta|Media|Baja" }
    ],
    trayectoria: [
      { nombre: "string", t3: 0, t2: 0, t1: 0, ta: 0, delta: "string (ej. '+7' o '-3', con signo)", tipo: "Persistente|Nueva|Emergente", velocidad: "Creciendo|Estable|Bajando" }
    ],
    alertas: [
      { titulo: "string", rows: [["clave", "valor"]] }
    ],
    hallazgoEmocional: "string",
    hallazgoTrayectoria: "string",
    resumenEjecutivo: "string",
    cartografiaSocioafectiva: {
      iasPorZona: [
        { zona: "string (colonia/zona/corredor específico)", ias: 0 }
      ],
      dolores: [
        { frase: "string (frase ciudadana en primera persona o muy cercana al habla local, sin comillas)", meta: "string (una línea de contexto: quién lo dice, por qué, con qué evidencia)" }
      ],
      enemigosSimbolicos: [
        { nombre: "string (persona, institución o fenómeno señalado como responsable simbólico)", descripcion: "string (por qué se le atribuye la culpa, con evidencia concreta)" }
      ],
      fracturasSociales: [
        { titulo: "string (nombre corto de la fractura/división social)", descripcion: "string (entre quiénes, por qué, con evidencia)" }
      ],
      segmentacion: [
        { segmento: "string (grupo social/económico específico del territorio)", emocionDominante: "string (1-2 emociones, ej. 'Miedo + Desconfianza')", detonante: "string (hecho concreto que activa esa emoción en ese segmento, con fecha)" }
      ],
      narrativaMadre: "string (frase corta entrecomillada que resume el sentir colectivo transversal a todos los segmentos)",
      narrativaMadreDesc: "string (párrafo explicando en qué se diferencia esta narrativa de la narrativa madre de TENSIONES, y qué aporta la mirada socioafectiva)",
      narrativas: [
        { nombre: "string", tema: "string", actor: "string", potencial: "string (potencial de propagación/impacto, específico)", frase: "string (cita textual representativa)", fuente: "string (medio + fecha aproximada)" }
      ],
      preguntas: [
        { pregunta: "string", respuesta: "string (respuesta ejecutiva de 2-4 líneas)" }
      ]
    }
  }, null, 2),

  opositor: JSON.stringify({
    actor: { cargo: "string", partido: "string", periodo: "string", aspiracion: "string" },
    vulnerabilidades: [{ titulo: "string", nivel: "CRÍTICO|ALTO|MEDIO", bullets: ["string"], score: 0, descripcion: "string (párrafo de contexto/mecanismo antes de los bullets)" }],
    fortalezas: [{ titulo: "string", texto: "string" }],
    perfil: {
      rows: [{ label: "string", value: "string" }],
      cronologia: [{ periodo: "string", titulo: "string", descripcion: "string" }],
      ierPorCargo: [{ cargo: "string (DEBE coincidir textualmente con el 'titulo' de la etapa correspondiente en perfil.cronologia)", valor: 0 }]
    },
    contradicciones: {
      ranking: [{ codigo: "string (ej. C1, DEBE reutilizarse igual en contradicciones.tabla)", titulo: "string", score: 0, nivel: "CRÍTICO|ALTO|MEDIO" }],
      destacados: [{ titulo: "string", texto: "string", nivel: "CRÍTICO|ALTO|MEDIO|BAJO" }],
      tabla: [{ codigo: "string (mismo código que en ranking)", tipo: "string", declaracion: "string", realidad: "string", dano: "CRÍTICO|ALTO|MEDIO", canal: "string" }]
    },
    vectoresAtaque: [{ codigo: "string", titulo: "string", nivel: "CRÍTICO|ALTO|MEDIO", fuenteTag: "string", argumento: "string", evidencias: ["string"], fraseLista: "string" }],
    redDePoder: {
      radar: [0, 0, 0, 0, 0, 0],
      alertas: [{ nivel: "CRÍTICO|ALTO|MEDIO", categoria: "Aliado|Deuda Política|Tensión Interna|Vulnerabilidad de Red", titulo: "string", bullets: ["string"] }],
      tabla: [{ actor: "string", vinculo: "string", categoria: "Aliado|Deuda Política|Tensión Interna|Riesgo", riesgoOportunidad: "string" }]
    },
    resumenEjecutivo: "string"
  }, null, 2),

  sesgo: JSON.stringify({
    meta: {
      entidad: "string (territorio/entidad evaluada)",
      segmento: "string (ej. 'Electorado general (sucesión gubernatura 2027)')",
      periodo: "string (ej. 'mar–sep 2026')",
      fuentes: 0,
      estado: "ROBUSTO|MODERADO|LIMITADO (según cantidad y calidad de evidencia disponible)",
      ventanaPersuasion: "Abierta|Entreabierta|Cerrada"
    },
    metricas: {
      sesgosCriticos: { valor: 0, detalle: "string (nombres de los sesgos SAS≥81, separados por ' · ')" },
      sesgosAltos: { valor: 0, detalle: "string (nombres de los sesgos SAS 61-80, separados por ' · ')" },
      sri: { valor: 0, nivel: "Alto|Medio|Bajo", detalle: "string (explica brevemente qué actor/continuidad está en riesgo y por qué)" },
      sistemaDominante: { valor: "Sistema 1|Sistema 2", detalle: "string (una línea explicando el procesamiento dominante: emocional/reactivo vs. deliberativo/racional)" }
    },
    ranking: [{ categoria: "I|II|III|IV|V|VI|VII|VIII", codigo: "string (ej. S11)", nombre: "string (nombre del sesgo cognitivo)", descripcion: "string (una línea explicando el mecanismo y el hecho/evidencia que lo activa)", score: 0, nivel: "Crítico|Alto|Medio|Bajo" }],
    segmentos: [{ perfil: "string (ej. 'Duro (Morena)', 'Blando', 'Persuadible', 'Abstencionista', 'Indeciso')", color: "verde|azul|ambar|gris", sesgoPrincipal: "string (código + nombre del sesgo)", sesgoSecundario: "string (código + nombre del sesgo)", lectura: "string (frase interpretativa breve del comportamiento cognitivo de este segmento)" }],
    ventanasPersuasion: [{ segmento: "string (público objetivo específico, no genérico)", sesgoActivo: "string (código(s) + nombre(s) de sesgo, ej. 'S11 Negatividad + S20 Aversión a la pérdida')", ivp: "Abierta|Entreabierta|Cerrada", recomendacion: "string (mensaje o acción concreta y específica para abrir/aprovechar esta ventana)" }],
    arquitecturaMensajes: [{ etiqueta: "Diferenciación|Posicionamiento|Lanzamiento|Contención|Movilización", titulo: "string (sesgo(s) objetivo + público al que se dirige)", texto: "string (táctica concreta de mensaje/canal, no genérica)" }],
    resumenEjecutivo: "string"
  }, null, 2),

  socioafectiva: JSON.stringify({
    meta: {
      territorio: "string",
      ventana: "string (ej. 'mar–sep 2026 (6 meses)')",
      modalidad: "string (ej. 'Multitemática · 6 issues')",
      fuentesRevisadas: 0,
      corte: "string (fecha de corte del análisis)"
    },
    indice: {
      valor: 0,
      lecturaBrutal: "string (párrafo de 60-100 palabras, tono directo y sin eufemismos, resumiendo el estado emocional colectivo del territorio con al menos 2 hechos concretos — NO incluyas emoji de banda ni la palabra 'Banda', eso se calcula aparte)"
    },
    issues: [{ titulo: "string (problema estatal/municipal prioritario)", frase: "string (frase ciudadana textual representativa, entre comillas)", emocion: "string (emoción dominante que activa)", score: 0 }],
    radiografia: [{ label: "string", valor: "string" }],
    hallazgos: [{ hallazgo: "string (hecho concreto con cifra/fecha/fuente)", lectura: "string (interpretación socioafectiva de ese hallazgo, 20-40 palabras)" }],
    emociones: [{ nombre: "string", score: 0, grupo: "string (segmento donde aparece con mayor fuerza)", detonante: "string (hecho concreto que la activa)", color: "critical|serious|violet|warning|muted|accent|good" }],
    sintesisEmocional: { dominante: "string", secundaria: "string", masPeligrosa: "string", masPeligrosaRiesgo: "string (por qué es la más peligrosa)", masMovilizable: "string", masMovilizableEvidencia: "string (evidencia de que ya se está movilizando)", masDesaprovechada: "string", masDesaprovechadaEvidencia: "string (por qué está desaprovechada como activo narrativo)" },
    dolores: [{ titulo: "string", score: 0, frase: "string (cita textual entre comillas)", tags: ["string"] }],
    simbolos: [{ simbolo: "string (objeto/lugar/actor concreto)", emocion: "string", usoEstrategico: "string (cómo usarlo o evitarlo en comunicación)" }],
    zonas: [{ nombre: "string", subzona: "string", dolor: "string", tension: 0 }],
    enemigos: [{ nombre: "string (enemigo simbólico o fractura social)", riesgo: "string", neutralizacion: "string (acción concreta)" }],
    segmentos: [{ titulo: "string", perfil: "string (composición del segmento)", dolor: "string", deseo: "string", miedo: "string", narrativa: "string" }],
    actores: [{ nombre: "string", confianza: 0, emocion: "string (emoción asociada a este actor)", potencial: "string (potencial estratégico, explicado)" }],
    narrativas: [{ tipo: "string (ej. 'Oficial / gubernamental', 'Crítica / opositora')", impulsor: "string (quién la impulsa)", frase: "string (entre comillas)", penetracion: 0, oportunidad: "string" }],
    narrativaMadre: {
      fraseRectora: "string (entre comillas)",
      heridaCentral: "string", enemigoSimbolico: "string", promesaEmocional: "string",
      protagonista: "string", futuroDeseado: "string", tonoNarrativo: "string",
      simbolosUsar: "string", simbolosEvitar: "string",
      mensajesFuerza: ["string (frase corta entre comillas, lista para usar en discurso/spot)"]
    },
    riesgos: [{ riesgo: "string", probabilidad: "Baja|Media|Media-alta|Alta", impacto: "Bajo|Medio|Alto|Muy alto", detonante: "string", recomendacion: "string" }],
    oportunidades: [{ titulo: "string", texto: "string" }],
    recomendaciones: [{ dimension: "string (ej. 'Comunicación', 'Forense', 'Económica')", accion: "string", publico: "string", atiende: "string (emoción/dolor que atiende)" }],
    preguntas9: [{ pregunta: "string", respuesta: "string" }],
    conclusionEjecutiva: "string (párrafo de 60-100 palabras, tono directo, cerrando el diagnóstico)"
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
  }, null, 2),

  semiotica: JSON.stringify({
    territorio: { nombre: "string", ventana: "string (ej. 'mar–sep 2026 (6 meses)')", corte: "string (fecha de corte del análisis)", fuentesRevisadas: 0, metodologiaModulos: "string (ej. '13 módulos')" },
    kpis: {
      arquetipoColectivo: "string (nombre del arquetipo junguiano dominante)",
      arquetipoColectivoDesc: "string (una línea explicando por qué domina)",
      arquetipoIdeal: "string (nombre del arquetipo político ideal para resonar)",
      arquetipoIdealDesc: "string (una línea explicando por qué resonaría)",
      tensionDominante: "string (ej. 'Orgullo identitario vs. estigma narco')",
      tensionDominanteDesc: "string (una línea de contexto)",
      irsTopActor: "string (nombre del aspirante con IRS más alto)",
      irsTopScore: 0,
      irsTopEstado: "good|warning|serious|critical (según banda del IRS: 81-100 good, 61-80 warning, 41-60 serious, 0-40 critical)"
    },
    codigoSimbolico: "string (párrafo de síntesis de 100-160 palabras, tono de consultoría, con al menos 2 hechos concretos del territorio)",
    signos: [{ categoria: "string (ej. 'Naturales', 'Económicos', 'Culturales', 'Religiosos', 'Digitales', 'Históricos', 'Arquitectónicos', 'Signos de población — dominantes')", items: [{ titulo: "string", texto: "string" }] }],
    poblacion: [{ titulo: "string", estado: "dominante|emergente", texto: "string" }],
    significacion: [{ tema: "string", manifiesto: "string (lo que se dice textualmente)", latente: "string (lo que se sugiere)", inconsciente: "string (lo que se proyecta sin notarlo)" }],
    narrativas: [{ tipo: "dominante|emergente|aspiracional|enojo|miedo|esperanza", texto: "string" }],
    frameDominante: { titulo: "string (fijo: 'Frame dominante (Lakoff)')", bullets: ["string"] },
    fundacionesMorales: { titulo: "string (fijo: 'Fundaciones morales activas (Haidt)')", bullets: ["string"] },
    miedos: ["string"],
    deseos: ["string"],
    necesidades: ["string"],
    simbolosPoder: [{ titulo: "string", texto: "string" }],
    mapaMemetico: [{ tipo: "admira|ridiculiza|castiga|rechaza|legitima", texto: "string" }],
    cosmovision: [{ concepto: "string (ej. 'Cambio', 'Orden', 'Libertad', 'Autoridad', 'Futuro')", texto: "string" }],
    arquetipos: [{ rol: "Dominante|Secundario|Emergente|Rechazado", nombre: "string (nombre del arquetipo junguiano)", texto: "string" }],
    arquetipoIdealPrincipal: { rol: "string (fijo: 'Arquetipo político ideal — 1er lugar')", nombre: "string", texto: "string (párrafo explicando por qué resuena más)", riesgo: "string (riesgo de sobreactuación, corto)" },
    arquetipoIdealSecundario: { rol: "string (fijo: '2° lugar')", nombre: "string", texto: "string", riesgo: "string" },
    tensiones: [{ poloA: "string", poloB: "string", intensidad: 0, texto: "string" }],
    matrizEstrategica: [{ decir: "string", noDecir: "string", simbolosUsar: "string", simbolosEvitar: "string", emocionesMovilizan: "string", emocionesBloquean: "string", narrativaGanadora: "string", narrativaPerdedora: "string" }],
    irs: {
      actores: [{ nombre: "string", cargo: "string (partido/posición actual o aspiración)", narrativa: 0, simbolos: 0, arquetipo: 0, estado: "good|warning|serious|critical" }],
      nota1: "string (explica qué mide cada capa A/B/C)",
      nota2: "string (conclusión sobre el rango de resonancia alcanzado por los actores evaluados)"
    },
    fuentes: []
  }, null, 2)
};

// =========================================================
// PROMPTS
// =========================================================

function buildPrompt({ skill, actorName, actor2Name, actoresNombres, datosPorActor, mes, anio, datosActor1, datosActor2, schema }) {
  let contexto;

  if (skill === 'comparativo' && actoresNombres?.length) {
    // N actores (2-6): un bloque de fuentes crudas por cada uno.
    const encabezado = actoresNombres.map((n, i) => `Actor ${i + 1}: ${n}`).join('\n');
    const bloques = actoresNombres.map((n, i) => `\n--- Datos crudos sobre ${n} ---\n${resumirFuentes(datosPorActor?.[i])}`).join('\n');
    contexto = `${encabezado}\n${bloques}`;
  } else {
    const bloque1 = resumirFuentes(datosActor1);
    const bloque2 = datosActor2 ? resumirFuentes(datosActor2) : null;
    const etiquetaSujeto = (skill === 'tensiones' || skill === 'sesgo' || skill === 'semiotica') ? 'Territorio/Entidad evaluada' : 'Personaje';
    contexto = actor2Name
      ? `Personaje A: ${actorName}\nPersonaje B: ${actor2Name}\n\n--- Datos crudos sobre ${actorName} ---\n${bloque1}\n\n--- Datos crudos sobre ${actor2Name} ---\n${bloque2}`
      : `${etiquetaSujeto}: ${actorName}\n\n--- Datos crudos extraídos ---\n${bloque1}`;
  }

  const guardarropaOpositor = skill === 'opositor'
    ? `\nReglas adicionales OBLIGATORIAS para este expediente de oposición:\n- Basa cualquier señalamiento grave ÚNICAMENTE en lo que aparezca en las fuentes crudas proporcionadas.\n- NO inventes números de expediente ni fechas falsas de documentos.\n- Si no hay suficiente información cruda, trátalo como "área de riesgo reputacional" y dilo explícitamente en el texto (no lo disfraces de hecho probado).\n- Este es un expediente de consultoría política pagado: CADA una de las 5 pestañas (Perfil, Vulnerabilidades, Contradicciones, Vectores de Ataque, Red de Poder) debe sentirse igual de investigada — está prohibido que una pestaña quede robusta y otra con 2-3 elementos genéricos.`
    : '';

  const guardarropaSesgo = skill === 'sesgo'
    ? `\nReglas adicionales OBLIGATORIAS para este análisis de sesgos cognitivos electorales:\n- Marco teórico: analiza el electorado del territorio/entidad evaluado a través de sesgos cognitivos de psicología política (heurísticos de Kahneman-Tversky y afines) que la evidencia de las fuentes crudas sugiera que están activos, no un catálogo genérico repetido de análisis a análisis.\n- Catálogo de referencia (no exhaustivo, úsalo como guía de categorías y códigos S01-S26, pero adáptalo a lo que realmente sugieran las fuentes; puedes usar otros sesgos conocidos si encajan mejor):\n  · Categoría I — Heurísticos de disponibilidad y exposición: S08 Disponibilidad, S23 Mera exposición, S26 Verdad ilusoria.\n  · Categoría II — Sesgos de negatividad y pérdida: S11 Negatividad, S20 Aversión a la pérdida, S13 Víctima identificable.\n  · Categoría III — Sesgos identitarios y sociales: S15 Identidad social, S05 Efecto bandwagon, S17 Sesgo endogrupal.\n  · Categoría IV — Sesgos retrospectivos y de atribución: S18 Retrospectivo, S03 Atribución, S09 Sesgo de resultado.\n  · Categoría V — Sesgos de autoridad y confianza institucional: S25 Autoridad, S02 Halo, S06 Autoservicio institucional.\n  · Categoría VI — Sesgos de confirmación y consistencia: S07 Confirmación, S21 Disonancia cognitiva, S14 Consistencia interna.\n  · Categoría VII — Sesgos de anclaje y encuadre: S01 Anclaje inicial, S10 Encuadre/framing, S19 Proyección.\n  · Categoría VIII — Sesgos de statu quo y fatiga cívica: S12 Statu quo/fatiga, S24 Descuento hiperbólico, S16 Ilusión de control.\n- El SAS (Score de Activación de Sesgo) de cada elemento en "ranking" va de 0-100: 81-100 = Crítico, 61-80 = Alto, 41-60 = Medio, <41 = Bajo. Distribuye los scores de forma realista y variada (no todos en el mismo rango).\n- "metricas.sesgosCriticos.valor" y "metricas.sesgosAltos.valor" DEBEN coincidir exactamente con el conteo real de elementos de "ranking" en esos rangos de score — nunca un número inventado que no cuadre con el ranking.\n- "metricas.sri" (Riesgo Cognitivo de continuidad/actor en turno) interpreta qué tan expuesto está el actor/partido gobernante a que la oposición explote los sesgos activos.\n- Basa cualquier cifra o hecho concreto (número de negocios cerrados, meses de conflicto, medios que dieron cobertura, etc.) ÚNICAMENTE en las fuentes crudas proporcionadas; si no hay suficiente evidencia para un dato concreto, redacta el mecanismo del sesgo en términos cualitativos en vez de inventar una cifra.`
    : '';

  const guardarropaSocioafectiva = skill === 'socioafectiva'
    ? `\nReglas adicionales OBLIGATORIAS para esta cartografía socioafectiva territorial:\n- NO generes la lista "fuentes": ese campo se construye por separado a partir de las URLs reales scrapeadas; si el esquema no la pide, no la incluyas ni inventes artículos/enlaces.\n- "issues" debe cubrir los problemas/temas realmente prioritarios que emergen de las fuentes crudas del territorio (seguridad, economía, servicios, salud, movilidad, etc. — los que apliquen), nunca una lista genérica copiada de otro territorio.\n- Cada "frase" (en issues, dolores, narrativas, narrativaMadre, mensajesFuerza) debe sonar a cita ciudadana real y específica del territorio, no a eslogan genérico de campaña.\n- "zonas[].tension" y "actores[].confianza" son escalas 0-10; ordena "zonas" de mayor a menor tensión.\n- "indice.valor" (Índice General Socioafectivo, 0-10, donde 10 = clima más deteriorado) debe ser coherente con el promedio implícito de "emociones[].score" y "zonas[].tension" — no un número desconectado del resto del reporte. NO incluyas emoji ni la palabra "Banda" dentro de "indice.lecturaBrutal", eso se calcula aparte en el frontend a partir del número.\n- Basa cualquier cifra concreta (empleos perdidos, homicidios, empresas cerradas, porcentajes de desconfianza, etc.) ÚNICAMENTE en las fuentes crudas proporcionadas; si no hay dato exacto, describe la magnitud en términos cualitativos verosímiles en vez de inventar una cifra precisa.`
    : '';

  const listaComparativo = (actoresNombres?.length ? actoresNombres : [actorName, actor2Name].filter(Boolean));
  const nombresComillas = listaComparativo.map(n => `"${n}"`).join(', ');
  const ejemploLlaves = listaComparativo.map(n => `"${n}": [...]`).join(', ');
  const reglaEscalado = listaComparativo.length > 2
    ? `\n- CONTROL DE LONGITUD (IMPORTANTE, hay ${listaComparativo.length} actores): como el JSON crece con cada actor adicional y hay un límite duro de tokens de salida, sé más CONCISO por actor que si solo hubiera 2: usa párrafos de 40-70 palabras (no 60-120) en "text"/"bivariado"/similares dentro de este skill, y para "narrativas" es suficiente 1 favorable + 1 crítica + 1 ambivalente por actor (no 2 de cada una). Prioriza que el JSON quede COMPLETO y válido para los ${listaComparativo.length} actores por encima de la extensión de cada texto individual.`
    : '';

  const guardarropaComparativo = skill === 'comparativo'
    ? `\nReglas adicionales OBLIGATORIAS para este comparativo de ${listaComparativo.length} actores:\n- Los actores a comparar son EXACTAMENTE (en este orden): ${nombresComillas}. Usa estos nombres tal cual, sin abreviar ni traducir, en TODOS los campos donde se requiera el nombre de un actor.\n- El array "actores" del JSON debe tener EXACTAMENTE ${listaComparativo.length} elementos, uno por cada nombre listado arriba, en el mismo orden.\n- Sé BALANCEADO: dedica volumen y profundidad comparable a TODOS los actores en cada sección (KPIs, sentimiento, narrativas, riesgos) — no conviertas esto en un perfil de un solo actor con menciones ocasionales del resto.${reglaEscalado}`
    : '';

  const guardarropaSemiotica = skill === 'semiotica'
    ? `\nReglas adicionales OBLIGATORIAS para este estudio de semiótica política digital:\n- NO generes el array "fuentes": ese campo se construye por separado a partir de las URLs reales scrapeadas; déjalo como array vacío si el esquema lo pide.\n- "signos" debe cubrir un mínimo de 6 categorías distintas (usa las sugeridas en el esquema como guía, adáptalas al territorio real), con 1-2 "items" cada una, y cada "texto" debe anclarse en un hecho digital verificable-style (fecha, cifra, medio, colonia) tomado de las fuentes crudas cuando exista evidencia.\n- "significacion" (Sistema de significación) debe cubrir mínimo 5 temas centrales del territorio (seguridad, autoridad/gobierno, futuro, trabajo/dinero, identidad regional u otros que apliquen), cada uno con sus tres capas (manifiesto/latente/inconsciente) claramente diferenciadas — nunca repitas el mismo texto en dos capas.\n- "narrativas": mínimo 6, cubriendo al menos 4 de los 6 tipos disponibles (dominante, emergente, aspiracional, enojo, miedo, esperanza) — nunca las concentres todas en "dominante".\n- "miedos", "deseos" y "necesidades": EXACTAMENTE 10 elementos cada uno, ordenados de mayor a menor intensidad/recurrencia, cada uno una frase corta y específica del territorio (no genérica).\n- "mapaMemetico": EXACTAMENTE 5 elementos, uno por cada "tipo" (admira, ridiculiza, castiga, rechaza, legitima), sin repetir tipo.\n- "cosmovision": EXACTAMENTE 5 elementos (Cambio, Orden, Libertad, Autoridad, Futuro o equivalentes conceptuales), cada uno con un "texto" que interprete cómo lo vive el territorio evaluado, no una definición genérica del concepto.\n- "arquetipos": EXACTAMENTE 4 elementos, uno por cada "rol" (Dominante, Secundario, Emergente, Rechazado), sin repetir rol. "arquetipoIdealPrincipal" y "arquetipoIdealSecundario" deben ser arquetipos DISTINTOS entre sí y coherentes con el "arquetipoIdeal" reportado en "kpis".\n- "tensiones": mínimo 5, ordenadas de mayor a menor "intensidad" (0-100), cada "texto" explicando por qué esa tensión es estratégicamente relevante (no solo describir los dos polos).\n- "matrizEstrategica": EXACTAMENTE 2 filas, cada una completa en las 8 columnas, con contenido específico y accionable (nunca "N/A" ni una palabra suelta).\n- "irs.actores": mínimo 3 aspirantes/actores políticos reales o verosímiles del territorio evaluado, con las 3 capas de puntaje (narrativa 0-40, símbolos 0-30, arquetipo 0-30) coherentes entre sí y con "estado" calculado según el total (81-100 good, 61-80 warning, 41-60 serious, 0-40 critical) — nunca dejes que ningún actor supere 80 salvo que la evidencia lo respalde con claridad excepcional.\n- Todos los "texto"/"descripcion" de una sola frase deben tener 25-50 palabras; los párrafos más largos (codigoSimbolico, textos de tensiones y del código simbólico) 60-160 palabras según se indique.`
    : '';

  const instruccionesEstructura = skill === 'emociones'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Emociones):\n- "emotions.intensity" es un ENTERO de escala fija 0-3, NUNCA otro rango: 0 = inactiva (no se detecta evidencia real de esta emoción), 1 = baja, 2 = media, 3 = alta. Debes DISTRIBUIR intensidades realistas y VARIADAS entre las 8 emociones según la evidencia — está PROHIBIDO poner intensity:3 a todas las emociones activas; eso es un error, no un signo de análisis completo. Como referencia, en un territorio típico: 1-2 emociones en intensidad 3 (las dominantes), 2-3 en intensidad 2, el resto en 1 o 0 (inactivas). Refleja la mezcla real de las fuentes, no un maximalismo genérico.\n- "dyads" (Díadas Emocionales) — NUNCA lo dejes vacío, es OBLIGATORIO que tenga mínimo 3 elementos, sin excepción. Una díada emocional es la COMBINACIÓN de dos de las 8 emociones activas que juntas producen una dinámica política específica y nombrable. Estructura de cada díada: "name" = nombre corto de la dinámica combinada (ej. "Indignación Resignada", "Miedo Desconfiado", "Esperanza Cautelosa"); "formula" = las dos emociones que se combinan, formato "EmociónA + EmociónB" (ej. "Ira + Tristeza"); "type" = "Primaria" si es la combinación dominante en el territorio o "Secundaria" si es una dinámica emergente menor; "text" = párrafo explicando el mecanismo político-emocional de esa combinación y su implicación estratégica; "risk" = CRÍTICO/ALTO/MEDIO/BAJO; "score" = número 0-100 de intensidad de riesgo. Ejemplo completo: {"name":"Indignación Resignada","formula":"Ira + Tristeza","type":"Primaria","text":"La ciudadanía combina enojo activo por el desabasto de agua con una tristeza resignada ante la falta de respuesta institucional, generando apatía electoral disfrazada de crítica...","risk":"ALTO","score":78}. Construye las díadas a partir de las emociones con mayor "intensity" en el array "emotions" — siempre hay al menos 3 combinaciones detectables en cualquier territorio político real.\n- "dyadInterp" debe ser un párrafo (60-120 palabras) interpretando el conjunto de díadas en términos de estrategia política, no una frase genérica.\n- "actores.rows" (comparación de actores políticos) — cada actor debe traer MÍNIMO 6 filas, usando estas categorías de análisis como referencia (puedes adaptar la etiqueta exacta pero cubre el fondo de cada una): "Emoción dominante que activa", "Rol narrativo (Westen)", "Capital emocional positivo/diferencial", "Fundación moral que activa (Haidt)", "Principal vulnerabilidad", "Ventana estratégica 30 días" o "Riesgo para [el otro actor]". El VALOR de cada fila NUNCA debe ser una etiqueta corta o palabra suelta — debe ser una CLÁUSULA COMPLETA Y ESPECÍFICA con evidencia concreta (cifras, nombres de proyectos/lugares, fechas), del mismo nivel de detalle que: "78 Huellas de la Transformación, 250+ patrullas, Mexicable al 68%" o "Brecha entre cifras oficiales y experiencia cotidiana en colonias periféricas" — nunca algo tan corto como "Popularidad alta" o "Buena imagen".\n- "temasChart" debe ser un ARRAY DE ARRAYS: cada elemento es ["nombre del tema", porcentajeNumero, "colorHex"]. Ejemplo: [["Seguridad", 35, "#3b82f6"], ["Economía", 25, "#f97316"]]\n- "partidosChart" debe ser un ARRAY DE ARRAYS: cada elemento es [iraAscoNum, decepcionTristezaNum, interesDisponibleNum]. Ejemplo: [[45, 30, 25], [20, 60, 20]]\n- "gestionPrioridad" debe ser un ARRAY DE ARRAYS: cada elemento es ["label", valorNumero, "colorHex"]. Ejemplo: [["Comunicación", 85, "#ef4444"]]\n- "actoresRadar.data" debe ser un ARRAY DE ARRAYS de números (0-100), uno por actor.\n- "recs" debe incluir las propiedades: bg (color fondo), tx (color texto), label (texto corto), text (descripción).\n- "secondary" debe incluir color (hex) para cada emoción secundaria.\n- "segmentos" (Segmentación N×E×I — Narrativa × Emoción × Identidad, pestaña "Segmentos y Perfiles"): cada segmento representa un bloque real y reconocible del electorado/población del territorio (ej. base leal de un actor, indeciso evaluador de otro, base ideológica de un tercero, segmento transversal no partidista/desconectado). "peso" es un porcentaje ESTIMADO (marca [ESTIMACIÓN] si no hay encuesta de campo real en las fuentes); "persuabilidad" clasifica qué tan movible es ("YA ES NUESTRO"/"MUY ALTA"/"ALTA"/"MEDIA"/"BAJA") y debe ser coherente con "objetivo" (MOVILIZAR si ya es nuestro, PERSUADIR si es persuadible, CONTENER si es hostil pero relevante, IGNORAR si es irrelevante). "frase" debe sonar a cita ciudadana real de ese segmento específico, no a eslogan genérico. Cada uno de los 4 sub-bloques (perfil, emocional, palancas, vector) debe llenarse por completo, con datos concretos del territorio, nunca genéricos intercambiables entre segmentos.\n- "semiotica" (pestaña "Semiótica"): aplica el modelo de los 12 arquetipos junguianos (Inocente, Explorador, Sabio, Héroe, Rebelde, Mago, Todos/Hombre común, Amante, Bufón, Cuidador, Gobernante, Guerrero) sobre el imaginario colectivo del territorio. "arquetipoColectivo" describe qué arquetipo vive la ciudadanía de sí misma/su comunidad (dominante/secundario/emergente/rechazado), siempre con evidencia concreta del territorio. "arquetipoPolitico" describe qué arquetipo espera la ciudadanía de SU LIDERAZGO político (puede ser distinto al colectivo) y su "evidencia" debe explicar también el riesgo de sobreactuación si un candidato fuerza ese arquetipo sin resultados reales. "arquetiposRadar" es un ARRAY DE EXACTAMENTE 12 NÚMEROS (escala 0-5, pueden llevar un decimal) EN ESTE ORDEN EXACTO: [Inocente, Explorador, Sabio, Héroe, Rebelde, Mago, Todos/Hombre común, Amante, Bufón, Cuidador, Gobernante, Guerrero] — refleja qué tanto resuena cada arquetipo en el imaginario colectivo, con variación real entre valores (nunca todos iguales ni todos en el máximo). "miedos", "deseos" y "necesidades" son 3 rankings INDEPENDIENTES de EXACTAMENTE 10 elementos cada uno, ordenados de "rank":1 (el más fuerte/prioritario) a "rank":10, cada uno con "evidencia" (hecho/fuente concreta del corpus, o [inferencia razonable] si no hay evidencia digital directa) y "significado" (lectura política de por qué importa ese miedo/deseo/necesidad).`
    : skill === 'comparativo'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Comparativo, ${listaComparativo.length} actores):\n- LLAVES DINÁMICAS POR ACTOR: en "sentimientoGeneral", "traSerie.series", "picosSerie.series", "plataformasRadar.data" y "sentimientoCruces.*.data", las llaves del objeto deben ser EXACTAMENTE los ${listaComparativo.length} nombres reales listados arriba, NUNCA "NombreActor1"/"NombreActor2" ni variantes. Ejemplo real: {${ejemploLlaves}}. Cada uno de estos objetos debe traer entradas para TODOS los actores, no solo los primeros 2.\n- "npsPorActor" y "ratioPorActor" deben tener EXACTAMENTE ${listaComparativo.length} números, en el mismo orden que la lista de actores.\n- "sentimientoGeneral" y los arrays dentro de "sentimientoCruces.*.data.<actor>.<segmento>" son [positivo, neutro, negativo, polarizado] — 4 números que idealmente suman ~100.\n- "kpiCards": mínimo 4 tarjetas, "color" debe ser una de estas 4 letras exactas: "g" (verde/bueno), "a" (ámbar/atención), "r" (rojo/riesgo), "n" (neutro). NUNCA un color hex aquí.\n- "hashtags": cada fila es EXACTAMENTE 6 elementos en este orden: [hashtag (con #), nombre del actor al que más se asocia, tono ("Positivo"/"Negativo"/"Neutro"/"Polarizado"), plataforma principal donde circula, origen ("orgánico"/"inducido"), frecuencia relativa (número 0-100)].\n- "riesgos" y "oportunidades": cada fila es un array de 4 elementos [nivel, titulo, texto, bivariado]. Nivel de "riesgos" usa CRÍTICO/ALTO/MEDIO/BAJO; nivel de "oportunidades" usa ALTA/MEDIA/BAJA.\n- "narrativas.tipo" debe ser EXACTAMENTE uno de: "favorable", "critica", "ambivalente" (sin acentos, en minúsculas) — el frontend filtra por este valor literal. Debe haber narrativas para CADA uno de los ${listaComparativo.length} actores, no solo de los primeros 2.\n- "alertaTabla" debe tener EXACTAMENTE ${listaComparativo.length} filas, una por actor.\n- "topOfMindCruces.*.data" usa como llave el NOMBRE DEL TEMA (no del actor), con un array de números alineado a "segments".\n- "plataformasRadar.labels" siempre debe ser ["X (Twitter)", "Facebook", "Instagram", "Medios digitales"] y "plataformasRadar.data.<actor>" un array de 4 números alineados a esas labels, para CADA uno de los ${listaComparativo.length} actores.`
    : skill === 'opositor'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Opositor):\n- CONSISTENCIA ENTRE PESTAÑAS (crítico, igual que en un reporte real): "perfil.ierPorCargo" debe tener una entrada por CADA etapa relevante de "perfil.cronologia" (mismo texto en "cargo" que en el "titulo" de esa etapa), para que la gráfica de barras "IER por Cargo" refleje exactamente los mismos eventos que se leen en la línea de tiempo — nunca uses cargos que no aparezcan en la cronología ni omitas etapas importantes de la cronología en la gráfica. "valor" es 0-10 donde valores bajos (0-3) marcan las etapas con escándalo/controversia y valores altos (7-10) las etapas limpias o exitosas.\n- "contradicciones.ranking" y "contradicciones.tabla" deben cubrir EXACTAMENTE las mismas contradicciones (mismo "codigo" C1, C2, C3... en ambas), en el mismo orden — nunca un ranking con más o menos elementos que filas en la tabla.\n- "vulnerabilidades[].descripcion": párrafo de 40-70 palabras que explique el MECANISMO de la vulnerabilidad (qué pasó, cuándo, quién estuvo involucrado) ANTES de los bullets, que a su vez deben aterrizar el dato duro (cifra, fecha, nombre, fuente). Nunca dejes "descripcion" vacía o como una sola frase genérica.\n- "vectoresAtaque[].argumento": párrafo de 40-80 palabras que plantee la contradicción central de forma ofensiva y citable (el "gancho" del ataque). "evidencias" debe tener 3-5 elementos, cada uno con formato "Evidencia (Fuente, fecha aproximada): hecho concreto con cifra/nombre" — igual de denso que en "tensiones.ranking[].evidencia". "fraseLista" es obligatoria en TODOS los vectores: una frase corta lista para usar en debate/spot, entre comillas.\n- "redDePoder.alertas[].categoria" y "redDePoder.tabla[].categoria" deben usar EXACTAMENTE una de: "Aliado", "Deuda Política", "Tensión Interna", "Vulnerabilidad de Red" (en alertas) o "Aliado"/"Deuda Política"/"Tensión Interna"/"Riesgo" (en tabla) — distribuye las 6+ filas de la tabla y las alertas entre las 4 categorías, no las concentres todas en una sola. "redDePoder.tabla[].riesgoOportunidad" debe ser una cláusula específica y accionable (qué gana o arriesga el actor por este vínculo), nunca una palabra suelta como "riesgo alto".\n- "perfil.rows": cubre como mínimo estos datos si existen en las fuentes (adapta etiqueta si aplica): Nacimiento, Formación académica, Posgrado/especialización, Trayectoria partidista, Padrino o mentor político, Deuda política (a quién le debe el cargo), Aspiración electoral, Patrimonio/declaración si es pública — cada "value" debe ser un dato concreto, no "Sin datos" salvo que realmente no exista evidencia.`
    : skill === 'sesgo'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Sesgo):\n- CONSISTENCIA NUMÉRICA (crítico): "metricas.sesgosCriticos.valor" debe ser EXACTAMENTE el número de elementos de "ranking" con score 81-100, y "metricas.sesgosAltos.valor" el número con score 61-80 — cuenta el array real, nunca un número aproximado o inventado.\n- "ranking[].categoria" usa EXACTAMENTE uno de los números romanos "I" a "VIII" del catálogo de referencia dado en las reglas adicionales; distribúyelos, no concentres todo en 1-2 categorías.\n- "ranking[].descripcion" siempre ancla el sesgo en un hecho/evidencia concreto de las fuentes (fecha, cifra, medio, actor), no una definición de libro de texto del sesgo — ej. "22 meses de conflicto armado saturan el frame emocional del electorado (cobertura CNN/Infobae, ago-sep 2026)", nunca solo "La gente reacciona más a lo negativo".\n- "segmentos[].perfil" debe cubrir el espectro completo del electorado del territorio evaluado (mínimo: base dura del partido en el poder, base blanda/decepcionada, persuadible/indeciso, abstencionista/fatigado) — nunca dupliques el mismo perfil dos veces. "color" debe ser EXACTAMENTE uno de "verde", "azul", "ambar", "gris".\n- "ventanasPersuasion[].segmento" debe ser un público específico y territorializado (ej. "Comerciantes de Culiacán", no "Ciudadanía en general"), y "recomendacion" una acción/mensaje concreto y accionable, nunca un consejo genérico tipo "comunicar mejor".\n- "arquitecturaMensajes[].etiqueta" debe ser EXACTAMENTE una de "Diferenciación", "Posicionamiento", "Lanzamiento", "Contención", "Movilización" — cubre al menos 3 etiquetas distintas entre los elementos, no repitas la misma etiqueta en todos.\n- "metricas.sistemaDominante.valor" debe ser EXACTAMENTE "Sistema 1" (procesamiento emocional/reactivo, típico cuando predominan sesgos de negatividad/disponibilidad/pérdida) o "Sistema 2" (procesamiento deliberativo, típico cuando predominan sesgos de confirmación/consistencia con baja intensidad emocional) — decide según qué categorías dominan el ranking.`
    : skill === 'tensiones'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Tensiones):\n- CONSISTENCIA ENTRE PESTAÑAS (crítico): "trayectoria" debe tener EXACTAMENTE las mismas tensiones que "ranking" (mismos "nombre", mismo orden), y "riesgos" también debe cubrir esas mismas tensiones en el mismo orden — un analista que lea las 3 pestañas debe reconocer que hablan de las mismas 6-10 tensiones, no de conjuntos distintos. El campo "ta" de cada fila en "trayectoria" debe ser IGUAL al "score" de esa misma tensión en "ranking".\n- "ranking[].emocion" formato EXACTO: "EmociónPrimaria + EmociónSecundaria · X/5" (ej. "Hartazgo + Desprotección · 4/5"), nunca solo una palabra suelta.\n- "ranking[].evidencia" es un párrafo (no una frase) que encadena 2-3 datos verificables (cifras, fechas, colonias) cada uno rematado con su fuente entre paréntesis, siguiendo este patrón: "Dato 1 con cifra y fecha (Fuente, ICF X.X) - Dato 2 (Fuente, ICF X.X)". Nunca lo dejes como una oración vaga sin cifras ni fuente.\n- "emociones[].descripcion" siempre debe indicar si la emoción es estructural/coyuntural y su tendencia (sostenida/en descenso/nueva), no solo repetir el nombre de la emoción.\n- "territorios[].color" debe ser EXACTAMENTE "Rojo", "Naranja" o "Amarillo" (no otros valores ni colores hex aquí).\n- "riesgos[].tipoSenal" debe ser EXACTAMENTE uno de: "Amplificada legítima", "Orgánica", "Inducida", "Aislada". "riesgos[].probEscalar" debe ser EXACTAMENTE "Alta", "Media" o "Baja".\n- "trayectoria[].delta" es un STRING con signo, ej. "+7" o "-3" (ta menos t3), nunca un número sin signo ni una palabra.\n- "alertas[].rows": cada alerta necesita mínimo 8 filas cubriendo Territorio, Emoción, Actor expuesto, Qué ocurrió (párrafo con fecha), Narrativa activa, Fuente verificadora, Riesgo, Escalamiento, Acción inmediata — usa esas etiquetas o muy similares, en ese orden.\\n- "cartografiaSocioafectiva" es un módulo COMPLEMENTARIO a tensiones (no lo dupliques): mientras "ranking"/"narrativas"/"territorios" leen el conflicto institucional, "cartografiaSocioafectiva" lee la vivencia emocional por SEGMENTO social. "iasPorZona[].ias" es 0-100 (Índice de Activación Socioafectiva), nunca copies aquí los mismos números de "riesgos[].srr". "segmentacion[].emocionDominante" usa formato corto "EmociónA + EmociónB" (sin el "· X/5" que sí llevan las emociones de "ranking"). "preguntas" debe ser un array de EXACTAMENTE 9 objetos {pregunta, respuesta}, ni 8 ni 10.`
    : skill === 'socioafectiva'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Socioafectiva):\n- CONSISTENCIA ENTRE PESTAÑAS (crítico): las emociones que aparecen en "sintesisEmocional" (dominante/secundaria/masPeligrosa/masMovilizable/masDesaprovechada) DEBEN ser nombres que también existan literalmente en el array "emociones" — nunca menciones ahí una emoción que no esté en el listado. Las "zonas" mencionadas en "enemigos[].riesgo" o en "segmentos" deben ser consistentes con los nombres usados en "zonas".\n- "indice.valor" es 0-10 (10 = clima socioafectivo más deteriorado/crítico); no escribas la banda ni el emoji en ningún campo de texto, eso lo calcula el frontend a partir del número.\n- "emociones[].color" debe ser EXACTAMENTE uno de: "critical" (miedo/terror/pánico), "serious" (ira/indignación/hartazgo), "violet" (impotencia/duelo/tristeza profunda), "warning" (desconfianza/incertidumbre), "muted" (resignación/apatía/fatiga), "accent" (orgullo/identidad), "good" (esperanza/vigilancia activa) — elige según la naturaleza real de cada emoción, distribuyendo varios colores, no todas "critical".\n- "issues[].score" y "emociones[].score" y "dolores[].score" son escalas 0-10; "narrativas[].penetracion" es 0-10; "actores[].confianza" es 0-10; "zonas[].tension" es 0-10 — nunca uses una escala 0-100 en estos campos.\n- "riesgos[].probabilidad" debe ser EXACTAMENTE "Baja", "Media", "Media-alta" o "Alta"; "riesgos[].impacto" debe ser EXACTAMENTE "Bajo", "Medio", "Alto" o "Muy alto".\n- "narrativaMadre.mensajesFuerza": mínimo 5 frases cortas, cada una entre comillas, listas para usar en un discurso o spot — no descripciones, sino la frase textual misma.\n- "preguntas9": exactamente 9 pares pregunta/respuesta, cubriendo un diagnóstico ejecutivo completo (qué está pasando, por qué, quién gana/pierde emocionalmente, qué hacer, qué NO hacer, ventana de tiempo, riesgo si no se actúa, activo narrativo desaprovechado, recomendación final) — adapta las preguntas exactas al territorio, pero cubre ese tipo de terreno.\n- "recomendaciones[].dimension" varía entre al menos 3 categorías distintas (ej. Comunicación, Forense/Datos, Económica, Territorial, Institucional) — no repitas la misma dimensión en todas las filas.`
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
${requisitosCantidad}${guardarropaOpositor}${guardarropaSesgo}${guardarropaSocioafectiva}${guardarropaComparativo}${guardarropaSemiotica}${instruccionesEstructura}`;

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
- gestionPrioridad (Prioridad de Gestión Emocional): mínimo 4 elementos.
- segmentos: mínimo 4 segmentos distintos, cubriendo el espectro real del electorado/población (mínimo: una base leal/afín, un indeciso evaluable, una base ideológica opositora, y un segmento transversal no partidista o de desconexión política) — cada uno con los 4 sub-bloques (perfil, emocional, palancas, vector) completos, nunca vacíos ni genéricos.
- semiotica.arquetiposRadar: EXACTAMENTE 12 números, en el orden fijo: Inocente, Explorador, Sabio, Héroe, Rebelde, Mago, Todos/Hombre común, Amante, Bufón, Cuidador, Gobernante, Guerrero — con variación real entre valores.
- semiotica.miedos, semiotica.deseos, semiotica.necesidades: EXACTAMENTE 10 elementos cada lista (rank 1 a 10), nunca menos.`,

  tensiones: `
REQUISITOS MÍNIMOS DE CANTIDAD (TENSIONES) — mínimo 6, ideal hasta 10, en TODAS estas listas: ranking, emociones, narrativas, territorios, riesgos, trayectoria, alertas. Nunca entregues menos de 6 en ninguna.

- ranking: 6-10 tensiones sociales distintas, cada una completa (nunca "—" en ningún campo):
  · "emocion" en formato EXACTO "EmociónPrimaria + EmociónSecundaria · X/5" (ej. "Hartazgo + Desprotección · 4/5").
  · "narrativa" es una frase corta que resume el sentir ciudadano (irá entrecomillada en la plantilla, no la entrecomilles tú).
  · "politica" (etiqueta en pantalla: "Potencial") describe el riesgo/potencial de movilización concreto (ej. "Movilización sectorial recurrente — riesgo de bloqueos en temporada de estiaje"), nunca genérico tipo "riesgo alto".
  · "evidencia" es OBLIGATORIO y es lo más importante de esta sección: un párrafo con 2-4 datos verificables (cifras, fechas, nombres de colonias) rematando cada dato con la fuente entre paréntesis, ej: "Corte de hasta 96h en mayo por rehabilitación planta Tezontle y acueducto Tizayuca (La Silla Rota, ICF 4.3) - Colonias Carboneras, El Saucillo... (ICF 4.0)". Encadena 2-3 datos con guiones " - " como en el ejemplo, no lo dejes en una sola oración vaga.
  · "recomendacion" debe ser una acción específica y ejecutable en el corto plazo, no un consejo genérico.

- emociones: 6-8 emociones (ej. Hartazgo, Indignación, Desconfianza, Miedo, Ansiedad, Resignación, Esperanza — usa las que apliquen al territorio), cada una con:
  · "descripcion": una línea que explique el TIPO de la emoción (estructural/coyuntural/en descenso/sostenida) y su origen, ej. "Estructural, multi-frente · Agua, tarifa de transporte y comercio informal se acumulan sin resolución visible".
  · "intensidad" en escala 1-5, VARIADA entre emociones (no todas en 4-5).

- narrativas: 6-10, cada una con "politica" (impacto/potencial político específico, no genérico) y "fuente" (medio + rango de fechas, ej. "La Silla Rota, mayo-julio 2026").

- territorios: 6-10 zonas/colonias específicas (nunca el municipio genérico completo), cada una con:
  · "color": "Rojo" (crítico), "Naranja" (alto) o "Amarillo" (medio) según severidad.
  · "observaciones" con AL MENOS una cifra concreta (número de personas/colonias/pesos) y fuente entre paréntesis — nunca solo descriptivo sin datos, ej: "Más de 200 comerciantes retirados de plaza Constitución en abril 2026 y reubicados en obra de 5.6 mdp junto al mercado Benito Juárez. Protesta en junio por baja afluencia (Criterio Hidalgo / La Silla Rota, ICF 4.0-4.3)".

- riesgos: 6-10, EN EL MISMO ORDEN Y CANTIDAD que las tensiones del ranking (cada tensión del ranking debe tener su fila de riesgo correspondiente), cada uno con "actorExpuesto", "tipoSenal" y "probEscalar" llenos (nunca vacíos) y "accion" concreta.

- trayectoria: DEBE cubrir las MISMAS 6-10 tensiones que aparecen en "ranking" (mismos nombres, mismo orden) — no un subconjunto reducido. "ta" (actual) debe coincidir con el "score" de esa tensión en "ranking". "delta" = ta - t3, con signo (+/-).

- alertas: 6-10 alertas (como las demás secciones), y cada alerta debe ser MUY explicativa: usa estas filas en "rows" como mínimo (adapta la etiqueta si hace falta, pero cubre el fondo): "Territorio", "Emoción" (con intensidad X/5), "Actor expuesto", "Qué ocurrió" (párrafo de 40-80 palabras con fecha y hechos concretos), "Narrativa activa", "Fuente verificadora" (medio + fecha + ICF), "Riesgo" (nivel + SRR + contexto), "Escalamiento" (probabilidad + qué lo activaría), "Acción inmediata" (específica, no genérica). Mínimo 8 rows por alerta.

- hallazgoEmocional y hallazgoTrayectoria: párrafos de 80-140 palabras con razonamiento estratégico específico (no una frase suelta) — ejemplo de la profundidad esperada: explicar POR QUÉ el patrón importa políticamente y qué lo hace distinto a otros casos (ej. "hartazgo distribuido en varios frentes es más difícil de gestionar comunicacionalmente que una crisis única con un solo culpable simbólico").

REQUISITOS MÍNIMOS — cartografiaSocioafectiva (pestañas "Radiografía y dolores", "Enemigos y segmentación", "Narrativas y 9 preguntas"):
- iasPorZona: 5-6 zonas/corredores específicos del territorio (nunca el municipio genérico), "ias" 0-100 con variación real entre zonas (no todas en el mismo rango).
- dolores: 5-6 frases de dolor social, cada una anclada en un hecho o patrón real documentado en "meta" (quién lo vive, evidencia).
- enemigosSimbolicos: 3-5 elementos — a quién o qué culpa la ciudadanía de forma simbólica, con evidencia concreta en "descripcion".
- fracturasSociales: 3-5 divisiones sociales reales y específicas del territorio (nunca genéricas tipo "ricos contra pobres" sin contexto local).
- segmentacion: 5-6 segmentos sociales/económicos específicos (comerciantes, familias de una colonia, gremio, militancia de un partido, etc.), cada uno con "emocionDominante" y "detonante" concreto y fechado.
- narrativaMadre/narrativaMadreDesc: debe ser DISTINTA a la narrativa madre general de tensiones — agrupa la vivencia emocional por segmento, no el discurso institucional.
- narrativas (dentro de cartografiaSocioafectiva): 4-6 narrativas propias de esta cartografía, mismo nivel de detalle que las narrativas generales de tensiones (con "fuente").
- preguntas: EXACTAMENTE 9 pares pregunta/respuesta — diagnóstico ejecutivo completo (qué pasa, por qué, quién gana/pierde emocionalmente, qué hacer, qué NO hacer, ventana de tiempo, riesgo si no se actúa, activo desaprovechado, recomendación final).`,

  opositor: `
REQUISITOS MÍNIMOS DE CANTIDAD (OPOSITOR) — mínimo 6, ideal hasta 10, en: vulnerabilidades, contradicciones.ranking, contradicciones.tabla, vectoresAtaque, redDePoder.tabla. Nunca entregues menos de 6 en ninguna de estas.

- vulnerabilidades: 6-10, cada una con "descripcion" (párrafo de mecanismo, ver instrucciones de estructura) + mínimo 3 bullets con dato duro (cifra/fecha/nombre/fuente) cada uno. Distribuye niveles de forma realista (no todas "CRÍTICO").
- fortalezas: mínimo 4, cada "texto" con al menos un dato concreto (cifra, proyecto, resultado medible), no un elogio genérico.
- perfil.rows: mínimo 8 filas (ver categorías sugeridas en instrucciones de estructura).
- perfil.cronologia: mínimo 6 eventos cronológicos relevantes, cubriendo toda la trayectoria pública del actor (no solo el cargo actual).
- perfil.ierPorCargo: EXACTAMENTE una entrada por cada etapa de perfil.cronologia que tenga un cargo evaluable (ver regla de consistencia en instrucciones de estructura) — mínimo 6.
- contradicciones.ranking: mínimo 6, mismos códigos que contradicciones.tabla. contradicciones.destacados: mínimo 3, cada "texto" de 40-70 palabras explicando por qué es un hallazgo único (no repetir el título). contradicciones.tabla: mínimo 6 filas, "declaracion" y "realidad" ambas con cifra/fecha/fuente cuando exista evidencia.
- vectoresAtaque: mínimo 6, cada uno con "argumento" (40-80 palabras), mínimo 3 "evidencias" densas y "fraseLista" obligatoria.
- redDePoder.alertas: mínimo 4, repartidas entre las 4 categorías (Aliado / Deuda Política / Tensión Interna / Vulnerabilidad de Red), cada una con mínimo 3 bullets con dato concreto.
- redDePoder.tabla: mínimo 6 actores vinculados, repartidos entre las categorías Aliado/Deuda Política/Tensión Interna/Riesgo, "riesgoOportunidad" siempre como cláusula específica y accionable.
- resumenEjecutivo: 80-140 palabras, mencionando explícitamente el hallazgo más grave y el activo político más defendible del actor.`,

  sesgo: `
REQUISITOS MÍNIMOS DE CANTIDAD (SESGO) — no entregues menos de esto:
- ranking: mínimo 8, ideal hasta 14, cubriendo al menos 5 de las 8 categorías (I-VIII) del catálogo de referencia. Scores variados y realistas (no todos en el mismo rango).
- segmentos: mínimo 4 perfiles de electorado distintos (ver instrucciones de estructura), cada uno con "lectura" de 20-40 palabras.
- ventanasPersuasion: mínimo 4, cada "recomendacion" de 25-50 palabras, concreta y accionable.
- arquitecturaMensajes: mínimo 4, cubriendo al menos 3 etiquetas distintas, cada "texto" de 25-50 palabras con canal/táctica concreta.
- metricas: los 4 indicadores (sesgosCriticos, sesgosAltos, sri, sistemaDominante) siempre con "detalle" lleno (nunca vacío) y consistentes con el "ranking" (ver instrucciones de estructura).
- resumenEjecutivo: 80-140 palabras, mencionando el sesgo más crítico, el segmento más persuadible y el riesgo cognitivo (SRI) para el actor/partido en el poder.`,

  socioafectiva: `
REQUISITOS MÍNIMOS DE CANTIDAD (SOCIOAFECTIVA) — no entregues menos de esto:
- issues: mínimo 6, cada uno con "frase" (cita ciudadana textual) y "emocion" que activa.
- radiografia: mínimo 6 filas de datos duros del territorio (población afectada, cifras económicas/de seguridad, etc.).
- hallazgos: mínimo 5, cada "lectura" de 20-40 palabras interpretando el hallazgo.
- emociones: mínimo 6, ideal hasta 9, cubriendo al menos 4 colores/categorías distintas (ver instrucciones de estructura). "detonante" siempre con hecho concreto.
- sintesisEmocional: los 8 campos siempre llenos, nunca vacíos, y coherentes con el array "emociones".
- dolores: mínimo 6, cada uno con "frase" (cita textual) y mínimo 2 "tags".
- simbolos: mínimo 6, cada "usoEstrategico" de 15-30 palabras.
- zonas: mínimo 6, ordenadas de mayor a menor "tension".
- enemigos: mínimo 4, cada "neutralizacion" con acción concreta.
- segmentos: mínimo 6, cubriendo el espectro completo del electorado/población (base afín, base crítica, persuadible, afectados directos, diáspora/migrantes si aplica, abstencionista/fatigado).
- actores: mínimo 6, cada "potencial" de 20-40 palabras explicando por qué.
- narrativas: mínimo 5, cubriendo al menos oficial/gubernamental, crítica/opositora y una tercera (social/ciudadana, mediática, etc.).
- narrativaMadre: "mensajesFuerza" mínimo 5 frases citables.
- riesgos: mínimo 6, cada "recomendacion" concreta y accionable.
- oportunidades: mínimo 4.
- recomendaciones: mínimo 6, cubriendo al menos 3 "dimension" distintas.
- preguntas9: EXACTAMENTE 9 pares pregunta/respuesta, cada respuesta de 40-80 palabras.
- conclusionEjecutiva: 60-100 palabras, tono directo, cerrando el diagnóstico con la recomendación más urgente.`,

  comparativo: `
REQUISITOS MÍNIMOS DE CANTIDAD (COMPARATIVO) — no entregues menos de esto:
- kpiCards: mínimo 4 tarjetas KPI.
- npsPorActor y ratioPorActor: un número por cada actor comparado, en el mismo orden que "actores" (ni más ni menos números que actores haya).
- traSerie.labels: mínimo 5 puntos temporales; cada serie en "traSerie.series" debe tener el mismo número de valores.
- sentimientoCruces (edad/genero/partido): cada uno con datos completos para AMBOS actores en TODOS los segmentos declarados — no dejes segmentos en [0,0,0,0] si el actor tiene cobertura en las fuentes.
- topOfMindTabla: mínimo 6 temas distintos.
- topOfMindCruces: mínimo 3 temas ("themes") por cruce.
- picosTabla: mínimo 5 eventos/picos de conversación, con fechas distintas y verosímiles del período evaluado, alternando entre ambos actores.
- plataformasNotas: mínimo 3, una por cada plataforma más relevante.
- nubePalabras: mínimo 12 palabras/términos con pesos variados (no todos el mismo "weight").
- hashtags: mínimo 6 hashtags distintos.
- narrativas: mínimo 2 favorables + 2 críticas + 2 ambivalentes por CADA actor comparado (el total escala con el número de actores), nunca concentradas solo en uno o dos de ellos.
- riesgos: mínimo 4. oportunidades: mínimo 3.
- alertaTabla: exactamente una fila por cada actor comparado (ni más ni menos).
- territorialTabla: mínimo 5 regiones/municipios.
- resumenKpis: mínimo 100 palabras comparando explícitamente a ambos actores.`,

  semiotica: `
REQUISITOS MÍNIMOS DE CANTIDAD (SEMIÓTICA) — no entregues menos de esto:
- signos: mínimo 6 categorías, cada una con 1-2 "items" (mínimo 8 items en total).
- poblacion: mínimo 3 elementos, mezclando estado "dominante" y "emergente".
- significacion: mínimo 5 temas, con las tres capas (manifiesto/latente/inconsciente) siempre diferenciadas entre sí.
- narrativas: mínimo 6, cubriendo al menos 4 tipos distintos de los 6 disponibles.
- frameDominante.bullets: mínimo 2. fundacionesMorales.bullets: mínimo 3.
- miedos, deseos, necesidades: EXACTAMENTE 10 elementos cada lista.
- simbolosPoder: mínimo 5.
- mapaMemetico: EXACTAMENTE 5 (uno por tipo: admira/ridiculiza/castiga/rechaza/legitima).
- cosmovision: EXACTAMENTE 5 conceptos.
- arquetipos: EXACTAMENTE 4 (uno por rol: Dominante/Secundario/Emergente/Rechazado).
- tensiones: mínimo 5, ordenadas de mayor a menor intensidad.
- matrizEstrategica: EXACTAMENTE 2 filas completas en las 8 columnas.
- irs.actores: mínimo 3 aspirantes/actores, con las 3 capas de puntaje siempre llenas.
- codigoSimbolico: 100-160 palabras. irs.nota2: 40-80 palabras.`,
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
