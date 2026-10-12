import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// server.js (Node.js/Express)
app.use((req, res, next) => {
  // Permite que la plataforma SIE incruste la aplicación
  res.setHeader("X-Frame-Options", "ALLOW-FROM https://sielorenzana.com"); 
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self' https://sielorenzana.com https://*.sielorenzana.com");
  next();
});
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
    cliente = '',
  } = params;

  const SKILLS_VALIDAS = ['radar', 'emociones', 'tensiones', 'opositor', 'comparativo', 'sesgo'];
  if (!SKILLS_VALIDAS.includes(skill)) {
    return res.status(400).json({ error: `Skill no soportada: "${skill}".` });
  }

  // Periodo de investigación: mes único, rango de meses o semana.
  let periodo;
  try {
    periodo = construirPeriodo(params);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  const clienteName = skill === 'opositor' ? String(cliente || '').trim() : '';

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
  procesarAnalisis({ jobId, skill, actorName, actor2Name, actoresNombres, mes, anio, periodo, clienteName, APIFY_TOKEN, OPENROUTER_KEY });

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

async function procesarAnalisis({ jobId, skill, actorName, actor2Name, actoresNombres, mes, anio, periodo, clienteName = '', APIFY_TOKEN, OPENROUTER_KEY }) {
  periodo = periodo || construirPeriodo({ mes, anio });
  try {
    const listaActores = skill === 'comparativo' && actoresNombres?.length ? actoresNombres : [actorName, actor2Name].filter(Boolean);
    console.log(`[+] Iniciando análisis (${jobId}) para: ${listaActores.join(' vs ')} (${skill})`);

    JOBS.set(jobId, { status: 'processing', progreso: `Extrayendo fuentes en Apify para ${listaActores.length} actor(es) (X, Facebook, Instagram, TikTok, YouTube, prensa)...` });

    let datosActor1, datosActor2, datosPorActor;

    if (skill === 'comparativo') {
      // N actores (2-6), cada uno con sus 6 fuentes en paralelo. Con 6 actores
      // esto son hasta 36 llamadas a Apify simultáneas -- vigila el consumo
      // de créditos/concurrencia de tu plan si usas el máximo de actores.
      const resultados = await Promise.allSettled(listaActores.map(nombre => scrapeActor(nombre, APIFY_TOKEN, periodo)));
      datosPorActor = resultados.map(r => r.status === 'fulfilled' ? r.value : { count: 0, items: [] });
    } else {
      // 1. Scraping masivo (6 fuentes en paralelo) -- flujo original para
      //    radar/emociones/tensiones/opositor, sin tocar.
      [datosActor1, datosActor2] = await Promise.all([
        scrapeActor(actorName, APIFY_TOKEN, periodo),
        actor2Name ? scrapeActor(actor2Name, APIFY_TOKEN, periodo) : Promise.resolve(null),
      ]);
    }

    JOBS.set(jobId, { status: 'processing', progreso: 'Estructurando datos con OpenRouter...' });

    // 2. Estructuración con OpenRouter
    let structured;
    if (skill === 'opositor') {
      // Opositor (2 adversarios + cliente) genera un JSON muy grande: se pide
      // en DOS llamadas en paralelo (parte 1 y parte 2) para que el tope de
      // tokens de salida del modelo no corte las últimas pestañas.
      const base = { skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, periodo, clienteName, datosActor1, datosActor2 };
      const [p1, p2] = await Promise.all([
        callOpenRouter(buildPrompt({ ...base, schema: SCHEMAS.opositor, parteOpositor: 1 }), OPENROUTER_KEY),
        callOpenRouter(buildPrompt({ ...base, schema: SCHEMAS.opositor2, parteOpositor: 2 }), OPENROUTER_KEY),
      ]);
      structured = { ...(p2 || {}), ...(p1 || {}) };
    } else if (skill === 'tensiones') {
      const base = { skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, periodo, clienteName, datosActor1, datosActor2 };
      const p1 = await callOpenRouter(buildPrompt({ ...base, schema: SCHEMAS.tensiones, parteTensiones: 1 }), OPENROUTER_KEY);
      JOBS.set(jobId, { status: 'processing', progreso: 'Generando cartografía socioafectiva (radiografía, dolores, enemigos, segmentación, narrativas y 9 preguntas)...' });
      const promptCarto = buildPrompt({ ...base, schema: SCHEMAS.tensionesCartografia, parteTensiones: 2, contextoTensiones: resumenTensionesParaCartografia(p1) });
      let carto = null, mejorParcial = null, mejorPuntaje = 0;
      const LISTAS_CARTO = ['iasPorZona', 'dolores', 'enemigosSimbolicos', 'fracturasSociales', 'segmentacion', 'narrativas', 'preguntas'];
      const puntaje = (c) => LISTAS_CARTO.filter(k => c && Array.isArray(c[k]) && c[k].length).length;
      // Hasta 2 intentos: si la cartografía falla o llega incompleta, se
      // conserva el mejor resultado parcial; Tensiones se entrega de todas
      // formas (las 7 pestañas principales no dependen de ella).
      for (let intento = 1; intento <= 2 && !carto; intento++) {
        try {
          const p2 = await callOpenRouter(promptCarto, OPENROUTER_KEY, 1);
          const c = p2 && (p2.cartografiaSocioafectiva || p2);
          const pts = puntaje(c);
          if (pts === LISTAS_CARTO.length) carto = c;
          else {
            console.warn(`[!] Cartografía incompleta (intento ${intento}): ${pts}/${LISTAS_CARTO.length} listas con datos`);
            if (pts > mejorPuntaje) { mejorPuntaje = pts; mejorParcial = c; }
          }
        } catch (e) {
          console.warn(`[!] Falló la cartografía socioafectiva (intento ${intento}):`, e.message);
        }
      }
      if (!carto && mejorParcial) carto = mejorParcial;
      structured = { ...(p1 || {}), cartografiaSocioafectiva: carto || (p1 && p1.cartografiaSocioafectiva) || {} };
    } else {
      const schema = SCHEMAS[skill] || SCHEMAS.radar;
      const prompt = buildPrompt({ skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, periodo, clienteName, datosActor1, datosActor2, schema });
      structured = await callOpenRouter(prompt, OPENROUTER_KEY);
    }

    // 3. Normalizar respuesta para asegurar que todos los arrays existan
    const normalized = normalizeResponse(structured, skill, { actorName, actor2Name, actoresNombres: listaActores, clienteName, periodo });

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
        periodo: periodo.label,
        periodoInfo: periodo,
        cliente: clienteName || null,
        fuentesEncontradas,
        data: normalized,
      },
    });
    limpiarJob(jobId);
  } catch (err) {
    console.error(`[-] Error en job ${jobId}:`, err);
    JOBS.set(jobId, {
      status: 'error',
      error: `Error procesando el análisis: ${String(err.message || err).slice(0, 400)}`,
      detail: String(err.message || err),
    });
    limpiarJob(jobId);
  }
}

// =========================================================
// PERIODO DE INVESTIGACIÓN (mes único / rango de meses / semana)
// Compatible con el frontend anterior: si solo llegan "mes" y "anio",
// se trata como un mes único.
// =========================================================
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const isoFecha = (d) => d.toISOString().slice(0, 10);

function indiceMes(m) {
  const i = MESES.findIndex(x => x.toLowerCase() === String(m || '').trim().toLowerCase());
  return i >= 0 ? i : 7; // Agosto por defecto (comportamiento histórico)
}

function construirPeriodo(params = {}) {
  const tipo = ['mes', 'rango', 'semana'].includes(params.periodoTipo) ? params.periodoTipo : 'mes';
  const anio = parseInt(params.anio, 10) || 2026;

  if (tipo === 'semana') {
    const ini = new Date(`${params.semanaInicio || ''}T00:00:00Z`);
    if (isNaN(ini)) throw new Error('Selecciona la fecha de inicio de la semana.');
    const fin = new Date(ini.getTime() + 6 * 86400000);
    const dI = ini.getUTCDate(), mI = ini.getUTCMonth(), aI = ini.getUTCFullYear();
    const dF = fin.getUTCDate(), mF = fin.getUTCMonth(), aF = fin.getUTCFullYear();
    const label = (mI === mF)
      ? `Semana del ${dI} al ${dF} de ${MESES_CORTOS[mF]} ${aF}`
      : `Semana del ${dI} ${MESES_CORTOS[mI]}${aI !== aF ? ' ' + aI : ''} al ${dF} ${MESES_CORTOS[mF]} ${aF}`;
    const dias = [];
    for (let k = 0; k < 7; k++) {
      const d = new Date(ini.getTime() + k * 86400000);
      dias.push(`${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}`);
    }
    return {
      tipo, label, desde: isoFecha(ini), hasta: isoFecha(fin), cortes: dias,
      mes: MESES[mI], anio: String(aI),
      instruccion: `El periodo es UNA SEMANA (${label}). Todo hallazgo, cifra y serie temporal debe referirse a esos 7 días; las series de tendencia usan cortes DIARIOS (${dias.join(', ')}). Si un dato es anterior a la semana, márcalo como antecedente/contexto, no como hallazgo del periodo.`,
    };
  }

  if (tipo === 'rango') {
    const mI = indiceMes(params.mes);
    const mF = indiceMes(params.mesFin || params.mes);
    const aF = parseInt(params.anioFin, 10) || anio;
    const totalI = anio * 12 + mI, totalF = aF * 12 + mF;
    if (totalF < totalI) throw new Error('El mes final del rango no puede ser anterior al mes inicial.');
    if (totalF - totalI > 23) throw new Error('El rango máximo es de 24 meses.');
    const cortes = [];
    for (let t = totalI; t <= totalF; t++) {
      const a = Math.floor(t / 12), m = t % 12;
      cortes.push(anio === aF ? MESES[m] : `${MESES_CORTOS[m]} ${a}`);
    }
    const label = (totalI === totalF)
      ? `${MESES[mI]} ${anio}`
      : (anio === aF ? `${MESES[mI]}–${MESES[mF]} ${aF}` : `${MESES[mI]} ${anio} – ${MESES[mF]} ${aF}`);
    const ultimoDia = new Date(Date.UTC(aF, mF + 1, 0));
    return {
      tipo: totalI === totalF ? 'mes' : 'rango', label,
      desde: `${anio}-${String(mI + 1).padStart(2, '0')}-01`, hasta: isoFecha(ultimoDia), cortes,
      mes: MESES[mI], anio: String(anio),
      instruccion: totalI === totalF
        ? `El periodo es el mes de ${label}. Las series temporales pueden usar cortes semanales dentro de ese mes.`
        : `El periodo es un RANGO de ${cortes.length} meses (${label}). Compara la evolución entre meses: las series de tendencia/trayectoria usan EXACTAMENTE estos cortes mensuales: ${cortes.join(', ')}. Señala qué cambió entre el inicio y el final del rango.`,
    };
  }

  const mI = indiceMes(params.mes);
  const ultimoDia = new Date(Date.UTC(anio, mI + 1, 0));
  return {
    tipo: 'mes', label: `${MESES[mI]} ${anio}`,
    desde: `${anio}-${String(mI + 1).padStart(2, '0')}-01`, hasta: isoFecha(ultimoDia),
    cortes: ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'],
    mes: MESES[mI], anio: String(anio),
    instruccion: `El periodo es el mes de ${MESES[mI]} ${anio}. Las series temporales pueden usar cortes semanales dentro de ese mes.`,
  };
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
    // Red de seguridad: el primer actor SIEMPRE debe ser el nombre real que
    // se buscó (sabemos ese dato con certeza), nunca un placeholder como
    // "Competidor A" ni una variante mal escrita que haya devuelto el modelo.
    if (ctx.actorName && data.actores[0]) data.actores[0].name = ctx.actorName;
    ensureObject(data, 'actoresRadar', { labels: [], data: [], colors: [] });
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
    ensureArray(data, 'semaforo', []);
    ensureArray(data, 'ranking', []);
    ensureArray(data, 'emociones', []);
    ensureArray(data, 'lecturaPoliticaEmociones', []);
    ensureObject(data, 'narrativaMadreSintesis', { texto: '', descripcion: '' });
    ensureArray(data, 'narrativas', []);
    ensureArray(data, 'territorios', []);
    ensureArray(data, 'riesgos', []);
    ensureArray(data, 'trayectoriaLabels', []);
    ensureArray(data, 'trayectoria', []);
    ensureObject(data, 'aprobacion', { cortes: [], nota: '' });
    ensureArray(data.aprobacion, 'cortes', []);
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

    // Red de seguridad de la cartografía: acepta nombres de campo alternos
    // que a veces devuelve el modelo y completa colores/orden de las zonas.
    const cs = data.cartografiaSocioafectiva;
    const s_ = (...vals) => { for (const v of vals) if (v !== undefined && v !== null && String(v).trim()) return String(v); return ''; };
    const objs = (a) => a.filter(x => x && typeof x === 'object');
    cs.preguntas = objs(cs.preguntas).map(p => ({ pregunta: s_(p.pregunta, p.q, p.titulo), respuesta: s_(p.respuesta, p.r, p.texto) })).filter(p => p.pregunta || p.respuesta);
    cs.dolores = cs.dolores.map(d => typeof d === 'string' ? { frase: d, meta: '' } : d).filter(d => d && typeof d === 'object')
      .map(d => ({ frase: s_(d.frase, d.f, d.texto), meta: s_(d.meta, d.m, d.contexto) }));
    cs.enemigosSimbolicos = objs(cs.enemigosSimbolicos).map(e => ({ nombre: s_(e.nombre, e.n, e.titulo), descripcion: s_(e.descripcion, e.d, e.texto) }));
    cs.fracturasSociales = objs(cs.fracturasSociales).map(f => ({ titulo: s_(f.titulo, f.t, f.nombre), descripcion: s_(f.descripcion, f.d, f.texto) }));
    cs.segmentacion = objs(cs.segmentacion).map(g => ({ segmento: s_(g.segmento, g.nombre), emocionDominante: s_(g.emocionDominante, g.emocion), detonante: s_(g.detonante, g.detonantePrincipal) }));
    const sinComillas = (t) => String(t || '').trim().replace(/^["“”«']+|["“”»']+$/g, '').trim();
    cs.narrativas = objs(cs.narrativas).map(n => ({ nombre: sinComillas(s_(n.nombre, n.n)), tema: s_(n.tema, n.segmento), actor: s_(n.actor, n.act), potencial: s_(n.potencial, n.pol, n.politica), frase: s_(n.frase, n.f), fuente: s_(n.fuente, n.orig, n.origen) }));
    const colorIas = (v) => v >= 75 ? '#E24B4A' : v >= 55 ? '#D97706' : '#B45309';
    cs.iasPorZona = objs(cs.iasPorZona).map(z => {
      const ias = Math.max(0, Math.min(100, Math.round(Number(z.ias) || 0)));
      return {
        zona: s_(z.zona, z.nombre, z.n), tipo: s_(z.tipo, z.niv, z.nivel), ias,
        color: /^#[0-9a-f]{3,8}$/i.test(String(z.color || '')) ? z.color : colorIas(ias),
        tensionDominante: s_(z.tensionDominante, z.ten, z.tension), emocionDominante: s_(z.emocionDominante, z.emo, z.emocion),
        lectura: s_(z.lectura, z.lec),
      };
    }).sort((a, b) => b.ias - a.ias);
  }

   // OPOSITOR
  if (skill === 'opositor') {
    // Clave por adversario: "a" = actor (Adversario A), "b" = actor2 (Adversario B).
    const claveA = (v) => {
      const x = String(v || '').trim().toLowerCase();
      if (x === 'a' || x === 'b' || x === 'all') return x;
      if (x === 'ambos' || x === 'todos') return 'all';
      // El modelo a veces devuelve el nombre: se resuelve por coincidencia.
      if (actor2Name && x && actor2Name.toLowerCase().includes(x)) return 'b';
      return 'a';
    };
    const txt = (v) => (v === undefined || v === null) ? '' : String(v);
    const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0; };
    const arr = (v) => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
    const strArr = (v) => Array.isArray(v) ? v.map(txt).filter(Boolean) : [];

    ensureObject(data, 'meta', {});
    const m = data.meta;
    ['territorio', 'contienda', 'ventana', 'contexto', 'fuente'].forEach(k => { m[k] = txt(m[k]); });
    if (!m.ventana && ctx.periodo) m.ventana = ctx.periodo.label;
    m.cliente = ctx.clienteName || '';

    // Adversarios: los nombres reales SIEMPRE son los que se buscaron.
    const advIn = arr(data.adversarios);
    const findAdv = (k) => advIn.find(x => String(x.clave).toLowerCase() === k) || {};
    const iniciales = (n) => String(n || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    data.adversarios = [['a', actorName], ['b', actor2Name]].map(([k, nombre]) => {
      const x = findAdv(k);
      const partes = String(nombre).trim().split(/\s+/);
      return {
        clave: k,
        nombre,
        corto: txt(x.corto) || partes[Math.min(1, partes.length - 1)] || nombre,
        siglas: (txt(x.siglas) || iniciales(nombre)).slice(0, 3).toUpperCase(),
        partido: txt(x.partido),
        cargoActual: txt(x.cargoActual),
      };
    });

    data.alertaJuridica = txt(data.alertaJuridica);
    data.alertas = arr(data.alertas).map(x => ({ a: claveA(x.a), texto: txt(x.texto) })).filter(x => x.texto);
    data.recomendaciones = strArr(data.recomendaciones);
    const NIV3C = ['VULNERABLE', 'MEDIA', 'ALTA', 'BAJA'];
    data.semaforo3C = arr(data.semaforo3C).map(x => ({ a: claveA(x.a), nivel: NIV3C.includes(String(x.nivel).toUpperCase()) ? String(x.nivel).toUpperCase() : 'MEDIA', texto: txt(x.texto) }));

    data.perfiles = arr(data.perfiles).map(p => ({ a: claveA(p.a), rows: arr(p.rows).map(r => ({ label: txt(r.label), value: txt(r.value) })) }));
    data.ier = arr(data.ier).filter(x => x.cargo).map(x => ({
      a: claveA(x.a), cargo: txt(x.cargo), periodo: txt(x.periodo), promesa: txt(x.promesa), resultado: txt(x.resultado),
      valor: Math.round(num(x.valor, 0, 10) * 10) / 10,
    }));
    data.ierNota = txt(data.ierNota);

    data.contradicciones = arr(data.contradicciones).map((c, i) => ({
      a: claveA(c.a), codigo: txt(c.codigo) || `C-${i + 1}`, tipo: txt(c.tipo), titulo: txt(c.titulo), descripcion: txt(c.descripcion),
      fuentes: txt(c.fuentes), verificacion: txt(c.verificacion), potencial: Math.round(num(c.potencial, 0, 100)),
      audiencia: txt(c.audiencia), uso: txt(c.uso),
    }));
    const RIESGO = { 'C': 'C', 'CRÍTICO': 'C', 'CRITICO': 'C', 'A': 'A', 'ALTO': 'A', 'M': 'M', 'MEDIO': 'M', 'B': 'B', 'BAJO': 'B' };
    data.vulnerabilidades = arr(data.vulnerabilidades).map(v => ({
      a: claveA(v.a), categoria: txt(v.categoria), descripcion: txt(v.descripcion), evidencia: txt(v.evidencia),
      verificacion: txt(v.verificacion), riesgo: RIESGO[String(v.riesgo || '').trim().toUpperCase()] || 'M', publica: txt(v.publica) || '—', uso: txt(v.uso),
    }));
    data.red = arr(data.red).map(r => ({
      actor: txt(r.actor), a: claveA(r.a), vinculo: txt(r.vinculo),
      relevancia: ['Alta', 'Media', 'Baja'].includes(r.relevancia) ? r.relevancia : 'Media', compromete: txt(r.compromete),
    }));
    ensureObject(data, 'implicaciones', {});
    data.implicaciones = { a: strArr(data.implicaciones.a), b: strArr(data.implicaciones.b) };

    // ---- Parte 2 ----
    data.narrativa = arr(data.narrativa).map(n => ({
      a: claveA(n.a), propuesta: txt(n.propuesta), identidad: txt(n.identidad), villano: txt(n.villano), emocion: txt(n.emocion), frame: txt(n.frame),
      fortalezas: strArr(n.fortalezas), debilidades: strArr(n.debilidades),
    }));
    const letra = (v) => { const l = String(v || '').trim().charAt(0).toUpperCase(); return ['D', 'I', 'S', 'C'].includes(l) ? l : ''; };
    data.disc = arr(data.disc).map(d => ({
      a: claveA(d.a), dominante: letra(d.dominante), secundario: letra(d.secundario), estilo: txt(d.estilo), evidencia: txt(d.evidencia),
      implicacionDebate: txt(d.implicacionDebate), egoTrigger: txt(d.egoTrigger), patronBajoPresion: txt(d.patronBajoPresion),
      temasEvasion: Array.isArray(d.temasEvasion) ? d.temasEvasion.join(', ') : txt(d.temasEvasion),
    }));
    data.discNota = txt(data.discNota);
    data.digital = arr(data.digital).map(d => ({ indicador: txt(d.indicador), a: txt(d.a), b: txt(d.b) }));
    data.digitalNota = txt(data.digitalNota);
    const LEGAL = (v) => { const x = String(v || '').trim().toLowerCase().charAt(0); return ['g', 'y', 'r'].includes(x) ? x : (x === 'v' ? 'g' : x === 'a' ? 'y' : 'y'); };
    // --- Atribución a/b ---
    // El código del vector/contradicción manda: "A-…" es del Adversario A y
    // "B-…" del B (el modelo a veces marca "all" en los descartados).
    const porCodigo = (codigo, actual) => {
      const c = String(codigo || '').trim().toUpperCase();
      if (/^A[-\s]/.test(c)) return 'a';
      if (/^B[-\s]/.test(c)) return 'b';
      return actual;
    };
    // En Defensa no hay código: se infiere quién lanzaría el ataque por las
    // menciones a cada adversario (nombre, apellido o código de vector A-V/B-V).
    const tokensDe = (nombre) => String(nombre || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/).filter(w => w.length > 3);
    // Además del nombre, se usan partido y cargo actual de cada adversario
    // (ej. "Morena", "Secretario del Ayuntamiento") como pistas.
    const GENERICAS = ['municipal', 'presidencia', 'presidente', 'presidenta', 'candidato', 'candidata', 'gobierno', 'distrito', 'estatal', 'federal', 'actual'];
    const pistasDe = (k, nombre) => {
      const adv = (data.adversarios || []).find(x => x.clave === k) || {};
      const cargo = tokensDe(adv.cargoActual).filter(w => w.length > 6 && !GENERICAS.includes(w));
      const partido = tokensDe(adv.partido).concat(String(adv.partido || '').toLowerCase().length <= 4 && adv.partido ? [` ${String(adv.partido).toLowerCase()} `] : []);
      return [...new Set([...tokensDe(nombre), ...cargo, ...partido])];
    };
    const TOK = { a: pistasDe('a', actorName), b: pistasDe('b', actor2Name) };
    const inferirA = (texto, actual) => {
      if (actual === 'a' || actual === 'b') return actual;
      const t = ' ' + String(texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ\s-]/g, ' ') + ' ';
      const cuenta = (k) => TOK[k].reduce((n, w) => n + (t.split(w).length - 1), 0) + (t.match(new RegExp(`\\b${k}-v\\d`, 'g')) || []).length * 2;
      const ca = cuenta('a'), cb = cuenta('b');
      if (ca > cb) return 'a';
      if (cb > ca) return 'b';
      return 'all';
    };
    data.contradicciones.forEach(c => { c.a = porCodigo(c.codigo, c.a); });

    // --- Verificación 6E: nunca dejar "N/A" o vacío; si el modelo no la
    // explicó, se escribe la lectura estándar según el semáforo legal. ---
    const esVacio = (v) => /^\s*(n\/?a|na|no aplica|—|-|sin datos?|ninguno)?\s*\.?\s*$/i.test(String(v || ''));
    const FALLBACK_6E = {
      calumnia: { g: 'Sin riesgo: el argumento se apoya en hechos públicos verificables y citables.', y: 'Riesgo moderado: formular como pregunta, citar la fuente y no atribuir responsabilidad personal no acreditada.', r: 'Riesgo alto: no hay evidencia verificable; difundirlo podría constituir calumnia electoral.' },
      vpg: { g: 'Sin riesgo de VPG: el argumento se basa en conducta pública, no en género, familia ni vida privada.', y: 'Riesgo bajo: cuidar tono y no aludir a rol de género, familia o apariencia.', r: 'Revisar con jurídico: el encuadre podría leerse como ataque basado en género o en vínculos personales.' },
      datos: { g: 'Sin riesgo: fuente pública (prensa, actas o portales oficiales).', y: 'Riesgo moderado: verificar la fuente original y la fecha antes de usar.', r: 'Sin fuente verificable o basada en rumor: no utilizar ningún dato.' },
      vidaPrivada: { g: 'Interés público claro: conducta en el ejercicio de un cargo o aspiración pública.', y: 'Interés público, pero evitar aspectos personales o familiares.', r: 'Sin interés público acreditado: zona de vida privada o rumor.' },
      ajuste: { g: '', y: 'Usar con matiz: formular como pregunta de transparencia, citar la fuente y no afirmar responsabilidad personal.', r: 'Descartado: no usar. Si aparece en redes de terceros, deslindarse públicamente.' },
    };
    data.vectores = arr(data.vectores).map((v, i) => {
      const legal = LEGAL(v.legal);
      const codigo = txt(v.codigo) || `V${i + 1}`;
      const out = {
        a: porCodigo(codigo, inferirA([v.argumento, v.evidencia].join(' '), claveA(v.a))), codigo, tipo: txt(v.tipo), argumento: txt(v.argumento), evidencia: txt(v.evidencia),
        audiencia: txt(v.audiencia), canal: txt(v.canal), rebote: txt(v.rebote), legal,
      };
      ['calumnia', 'vpg', 'datos', 'vidaPrivada', 'ajuste'].forEach(k => {
        out[k] = esVacio(v[k]) ? FALLBACK_6E[k][legal] : txt(v[k]);
      });
      return out;
    });
    data.defensa = arr(data.defensa).map(d => ({
      a: inferirA([d.titulo, d.evidencia, d.bloqueo, d.reencuadre, d.contraataque, d.pendiente].join(' '), claveA(d.a)),
      titulo: txt(d.titulo), evidencia: txt(d.evidencia), probabilidad: txt(d.probabilidad) || 'Media',
      bloqueo: txt(d.bloqueo), reencuadre: txt(d.reencuadre), contraataque: txt(d.contraataque), pendiente: txt(d.pendiente),
    }));
    data.comparativo = arr(data.comparativo).map(c => ({ dimension: txt(c.dimension), cliente: txt(c.cliente), a: txt(c.a), b: txt(c.b), ventaja: txt(c.ventaja) }));
    data.indicadores9C = arr(data.indicadores9C).map(c => ({ indicador: txt(c.indicador), valor: txt(c.valor), fuente: txt(c.fuente), fecha: txt(c.fecha) }));
    ensureObject(data, 'diagnostico9B', {});
    ['gana', 'pierde', 'favorable', 'impondran'].forEach(k => { data.diagnostico9B[k] = txt(data.diagnostico9B[k]); });
    data.bolsilloNota = txt(data.bolsilloNota);
    data.bolsillo = arr(data.bolsillo).map(b => ({
      a: claveA(b.a), narrativa: txt(b.narrativa), vulnerabilidad: txt(b.vulnerabilidad), bajoPresion: txt(b.bajoPresion),
      meAtacara: arr(b.meAtacara).map(x => ({ ataque: txt(x.ataque), respuesta: txt(x.respuesta) })),
      misAtaques: arr(b.misAtaques).map(x => ({ texto: txt(x.texto), legal: LEGAL(x.legal) })),
      noDebo: txt(b.noDebo),
    }));
    ensureObject(data, 'changelog', {});
    const cl = data.changelog;
    ['version', 'fecha', 'fase', 'pendientes'].forEach(k => { cl[k] = txt(cl[k]); });
    cl.activadores = strArr(cl.activadores);

    // ---- IVA (Índice de Vulnerabilidad del Adversario), calculado AQUÍ y no
    // por el modelo, con la ponderación del dashboard de referencia:
    // contradicciones 25% (promedio TOP 3) · vulnerabilidades 25% (C90 A75 M55 B25)
    // · debilidad narrativa 15% · digital 15% · brecha de gestión IER 20%.
    ensureObject(data, 'puntajes', {});
    const VAL_RIESGO = { C: 90, A: 75, M: 55, B: 25 };
    const prom = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
    data.iva = {};
    ['a', 'b'].forEach(k => {
      const top3 = data.contradicciones.filter(c => c.a === k).map(c => c.potencial).sort((x, y) => y - x).slice(0, 3);
      const vul = data.vulnerabilidades.filter(v => v.a === k).map(v => VAL_RIESGO[v.riesgo]);
      const ierVals = data.ier.filter(x => x.a === k).map(x => x.valor);
      const p = (data.puntajes && data.puntajes[k]) || {};
      const comp = {
        contradicciones: Math.round(prom(top3)),
        vulnerabilidades: Math.round(prom(vul)),
        narrativa: Math.round(num(p.narrativa, 0, 100)),
        digital: Math.round(num(p.digital, 0, 100)),
        gestion: ierVals.length ? Math.round((10 - prom(ierVals)) * 10) : 0,
      };
      const total = Math.round(comp.contradicciones * 0.25 + comp.vulnerabilidades * 0.25 + comp.narrativa * 0.15 + comp.digital * 0.15 + comp.gestion * 0.20);
      const nivel = total >= 70 ? 'ALTA' : total >= 55 ? 'VULNERABLE' : total >= 40 ? 'MEDIA' : 'BAJA';
      data.iva[k] = { ...comp, total, nivel, ierPromedio: ierVals.length ? Math.round(prom(ierVals) * 10) / 10 : null };
    });
    data.iva.vectoresRojos = data.vectores.filter(v => v.legal === 'r').length;

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

async function scrapeActor(nombre, token, periodo = null) {
  // Filtro de fechas del periodo (mes, rango o semana). Google acepta los
  // operadores after:/before: y el scraper de X acepta start/end. El resto de
  // plataformas no filtran por fecha en búsqueda: se manda la fecha de cada
  // item al modelo para que distinga lo del periodo de lo que es contexto.
  const filtroGoogle = periodo ? ` after:${periodo.desde} before:${periodo.hasta}` : '';
  const filtroX = periodo ? { start: periodo.desde, end: periodo.hasta } : {};
  const tareas = [
    llamarActorApify('apify~google-search-scraper', {
      queries: `"${nombre}" (noticias OR opinión OR declaraciones)${filtroGoogle}`,
      resultsPerPage: 20,
    }, token, PLATFORM_TIMEOUTS.prensa).then(i => tag(i, 'prensa')),

    llamarActorApify('apidojo~tweet-scraper', {
      searchTerms: [nombre],
      maxItems: 30,
      ...filtroX,
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

// =========================================================
// SCHEMAS LIMPIOS (coinciden 1:1 con las plantillas HTML)
// =========================================================
//RADAR
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
//EMOCIONES
  emociones: JSON.stringify({
    territory: "string (NUNCA el nombre del país ni del personaje: el estado/entidad y cargo/partido específico de contexto, ej. 'Michoacán · Candidata a Diputación Local')",
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
      arquetipoColectivo: { dominante: "string (arquetipo junguiano + evidencia breve)", secundario: "string", emergente: "string", rechazado: "string" },
      arquetipoPolitico: { ideal: "string", secundario: "string", resonancia: "string (ALTA|MEDIA|BAJA + por qué)", evidencia: "string (evidencia y riesgo de sobreactuación)" },
      arquetiposRadar: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      miedos: [{ rank: 1, nombre: "string", evidencia: "string", significado: "string" }],
      deseos: [{ rank: 1, nombre: "string", evidencia: "string", significado: "string" }],
      necesidades: [{ rank: 1, nombre: "string", evidencia: "string", significado: "string" }]
    }
  }, null, 2),

//TENSIONES
  tensiones: JSON.stringify({
    actor: { entidad: "string", cargo: "string", periodo: "string" },
    semaforo: [
      { etiqueta: "string (EXACTAMENTE: 'Tensión social')", valor: "string (número 0-100)", nivel: "critico|alto|medio|bajo", sub: "string (ej. 'Roja / Crítica')" },
      { etiqueta: "string (EXACTAMENTE: 'Reputacional')", valor: "string (número 0-100, usa el SRR más alto de 'riesgos')", nivel: "critico|alto|medio|bajo", sub: "string (ej. 'Riesgo alto sostenido')" },
      { etiqueta: "string (EXACTAMENTE: 'Escalamiento')", valor: "string (número 0-100)", nivel: "critico|alto|medio|bajo", sub: "string (ej. 'Aceleración en 3 de 6 focos')" },
      { etiqueta: "string (EXACTAMENTE: 'Confianza institucional')", valor: "string (ej. 'MEDIA-BAJA', puede ser texto, no siempre numérico)", nivel: "critico|alto|medio|bajo", sub: "string (ej. 'Aprobación 50.5% (ago 2026)')" },
      { etiqueta: "string (EXACTAMENTE: 'Movilización social')", valor: "string (ej. 'MEDIA', 'ALTA', 'BAJA')", nivel: "critico|alto|medio|bajo", sub: "string (ej. 'Sin protesta de calle documentada')" }
    ],
    ranking: [
      {
        nombre: "string",
        score: 0,
        color: "#C05621",
        nivel: "Crítico|Alto|Relevante|Emergente",
        emocion: "string (formato: 'EmociónPrimaria + EmociónSecundaria · X/5', ej. 'Hartazgo + Desprotección · 4/5')",
        narrativa: "string (frase textual entrecomillada que resume el sentir ciudadano, ej. 'El agua es un privilegio en Pachuca')",
        actor: "string (institución/persona responsable, puede ser una cadena 'A - B - C')",
        territorio: "string (colonias/zonas específicas afectadas)",
        politica: "string (potencial político/de movilización: riesgo de bloqueos, paro, viralización, etc., específico y accionable)",
        evidencia: "string (párrafo de evidencia documentada con cifras y fuente entre paréntesis, ej. 'Corte de hasta 96h en mayo por rehabilitación planta X (La Silla Rota, ICF 4.3)')",
        lecturaEstrategica: "string (párrafo de 50-90 palabras, DISTINTO de 'evidencia': conecta esta tensión con el contexto regional/histórico más amplio, con otras tensiones del ranking, o con la respuesta institucional — es el análisis, no el hecho)",
        recomendacion: "string (acción concreta y específica, no genérica)"
      }
    ],
    emociones: [
      { nombre: "string", intensidad: 0, color: "#hex", porcentaje: 0, descripcion: "string (una línea explicando el tipo/origen/tendencia de esta emoción, ej. 'Estructural, multi-frente · Agua, tarifa de transporte y comercio informal se acumulan sin resolución visible')", tendencia: "string (ej. '↑ Fuerte ascenso', '— Estable alto', '↑ Sostenida alta', '↑ Creciente', '— Estable frágil', '↓ En descenso')", tendenciaDesc: "string (una línea explicando la causa concreta de esa evolución, con hecho/fecha)" }
    ],
    lecturaPoliticaEmociones: [
      { emocion: "string (debe coincidir EXACTAMENTE con un 'nombre' de 'emociones')", color: "#hex (igual al color de esa emoción en 'emociones')", porcentaje: 0, intensidad: 0, texto: "string (párrafo de 35-60 palabras interpretando específicamente ESA emoción en clave político-estratégica: por qué tiene ese peso, qué la sostiene, hacia dónde puede derivar)" }
    ],
    narrativaMadreSintesis: {
      texto: "string (frase corta entrecomillada que sintetiza en UNA sola narrativa el conjunto de TODAS las tensiones activas — la síntesis más amplia y potente del período)",
      descripcion: "string (párrafo explicando qué tensiones conecta esta narrativa y por qué es el hilo común del periodo)"
    },
    narrativas: [
      { nombre: "string", tema: "string", actor: "string", politica: "string (impacto/potencial político de esta narrativa)", potencial: 0, frase: "string (cita textual representativa)", fuente: "string (medio y fecha aproximada, ej. 'La Silla Rota, mayo-julio 2026')" }
    ],
    territorios: [
      { nombre: "string", tension: "string", emocion: "string", color: "Rojo|Naranja|Amarillo", observaciones: "string (párrafo de 50-90 palabras: encadena el hecho concreto con fecha/cifra, su fuente entre paréntesis, y por qué ese territorio específico concentra ese nivel de impacto — nunca una sola oración corta)" }
    ],
    riesgos: [
      { nombre: "string", srr: 0, accion: "string", consecuencia: "string (párrafo de 30-60 palabras: qué pasa concretamente si esta tensión NO se atiende — proyección de consecuencia, no una acción a tomar)", color: "#hex", actorExpuesto: "string", tipoSenal: "Amplificada legítima|Orgánica|Inducida|Aislada", probEscalar: "Alta|Media|Baja" }
    ],
    trayectoriaLabels: ["string (nombres reales de los periodos del corte, ej. 'Mayo','Junio','Julio','Agosto','Sept (corte 14)' — usa los meses reales de la ventana de análisis evaluada, no genéricos)"],
    trayectoria: [
      { nombre: "string", valores: [0], ta: 0, delta: "string (ej. '+7' o '-3', con signo)", tipo: "Persistente|Nueva|Emergente", velocidad: "Acelerada|Moderada|Gradual" }
    ],
    aprobacion: {
      cortes: [{ label: "string (ej. 'Agosto 2026')", valor: 0 }],
      nota: "string (explica cuántos cortes hay, de qué encuestadora, y por qué no se interpolan los meses sin dato — ej. 'Solo se identificó un corte con dato público verificado...')"
    },
    alertas: [
      { titulo: "string", rows: [["clave", "valor"]] }
    ],
    hallazgoEmocional: "string",
    hallazgoTrayectoria: "string",
    resumenEjecutivo: "string",
    cartografiaSocioafectiva: {
      preguntas: [
        { pregunta: "string", respuesta: "string (respuesta ejecutiva de 2-4 líneas)" }
      ],
      narrativas: [
        { nombre: "string", tema: "string", actor: "string", potencial: "string (potencial de propagación/impacto, específico)", frase: "string (cita textual representativa)", fuente: "string (medio + fecha aproximada)" }
      ],
      narrativaMadre: "string (frase corta entrecomillada que resume el sentir colectivo transversal a todos los segmentos)",
      narrativaMadreDesc: "string (párrafo explicando en qué se diferencia esta narrativa de la narrativa madre de TENSIONES, y qué aporta la mirada socioafectiva)",
      segmentacion: [
        { segmento: "string (grupo social/económico específico del territorio)", emocionDominante: "string (1-2 emociones, ej. 'Miedo + Desconfianza')", detonante: "string (hecho concreto que activa esa emoción en ese segmento, con fecha)" }
      ],
      fracturasSociales: [
        { titulo: "string (nombre corto de la fractura/división social)", descripcion: "string (entre quiénes, por qué, con evidencia)" }
      ],
      enemigosSimbolicos: [
        { nombre: "string (persona, institución o fenómeno señalado como responsable simbólico)", descripcion: "string (por qué se le atribuye la culpa, con evidencia concreta)" }
      ],
      dolores: [
        { frase: "string (frase ciudadana en primera persona o muy cercana al habla local, sin comillas)", meta: "string (una línea de contexto: quién lo dice, por qué, con qué evidencia)" }
      ],
      iasPorZona: [
        { zona: "string (colonia/zona/corredor específico)", tipo: "string (tipo de zona, ej. 'Corredor carretero / rural', 'Urbano-comercial', 'Ribereño / agroindustrial', 'Institucional / político')", ias: 0, color: "#hex (rojo si ias>=75, naranja si 55-74, ámbar si <55)", tensionDominante: "string (nombre de la tensión dominante en esa zona, idealmente tomado de 'ranking')", emocionDominante: "string (formato corto 'EmociónA + EmociónB', sin '· X/5')", lectura: "string (párrafo de 30-55 palabras interpretando el mecanismo socioafectivo concreto de esa zona — qué la activa y por qué)" }
      ]
    }
  }, null, 2),
//OPOSITOR (parte 1: Resumen, Perfiles & IER, Contradicciones, Vulnerabilidades, Red)
// Convención de claves: "a" = Adversario A (actor), "b" = Adversario B (actor2),
// "all" = aplica a ambos. Las plantillas filtran por esta clave.
  opositor: JSON.stringify({
    meta: {
      territorio: "string (municipio/estado donde compiten, ej. 'La Piedad, Michoacán')",
      contienda: "string (cargo en disputa y año, ej. 'Presidencia municipal 2027')",
      ventana: "string (ventana de investigación, ej. '23-sep-2024 → 23-sep-2026')",
      contexto: "string (1-2 oraciones: quiénes son, qué disputan, quién es el cliente de referencia y qué fuentes se usaron)",
      fuente: "string (ej. 'Investigación web abierta; sin encuesta local')"
    },
    adversarios: [
      { clave: "a", nombre: "string (nombre completo del Adversario A)", corto: "string (apellido o forma corta, ej. 'Oceguera')", siglas: "string (2 letras, ej. 'OC')", partido: "string (siglas del partido)", cargoActual: "string" },
      { clave: "b", nombre: "string", corto: "string", siglas: "string", partido: "string", cargoActual: "string" }
    ],
    alertaJuridica: "string (advertencia de validación jurídica: qué NO debe hacerse nunca con estos adversarios — calumnia, homonimias, VPG — con el número de vectores en rojo)",
    alertas: [{ a: "a|b", texto: "string (alerta estratégica de 25-50 palabras con dato duro; puede usar <b>negritas</b>)" }],
    recomendaciones: ["string (acción de uso inmediato para las próximas 2 semanas, 20-40 palabras, concreta)"],
    semaforo3C: [{ a: "a|b", nivel: "VULNERABLE|MEDIA|ALTA|BAJA", texto: "string (lectura cualitativa de 25-45 palabras y estrategia recomendada)" }],
    perfiles: [{ a: "a|b", rows: [{ label: "string (ej. 'Nombre en actas','Cargo actual','Aspira a','Trayectoria','Padrino político','Formación','Red de origen','Transparencia')", value: "string (dato concreto con fuente; marca [NO VERIFICADO] o [FUENTE ÚNICA] cuando aplique)" }] }],
    ier: [{ a: "a|b", cargo: "string", periodo: "string (ej. '2021-2024')", promesa: "string (promesa o narrativa pública en ese cargo)", resultado: "string (resultado verificable con cifra/fecha/fuente; [FUENTE ÚNICA] si es autorreporte)", valor: 0 }],
    ierNota: "string (IER promedio por adversario y qué cargos se excluyeron por no estar verificados)",
    contradicciones: [{ a: "a|b", codigo: "string (A-1, A-2... para el adversario A; B-1, B-2... para el B)", tipo: "string (ej. 'Dicho vs. hecho (seguridad)', 'Discurso vs. realidad', 'Antes vs. ahora', 'Mandato vs. ambición')", titulo: "string", descripcion: "string (párrafo de 40-70 palabras con fechas y cifras)", fuentes: "string (medios y fechas)", verificacion: "string (VERIFICADO | FUENTE PRIMARIA | FUENTE ÚNICA | NO VERIFICADO, con matiz)", potencial: 0, audiencia: "string", uso: "string (ej. 'Debate / redes / contraste', 'Reserva')" }],
    vulnerabilidades: [{ a: "a|b", categoria: "string (Gestión | Ética/Financiera | Reputacional | Narrativa | Política | Electoral | Transparencia ...)", descripcion: "string", evidencia: "string (fuentes concretas)", verificacion: "string (Confirmada | Observación preliminar | Fuente única | No verificada)", riesgo: "C|A|M|B", publica: "Sí|Parcial|No|—", uso: "string (uso recomendado y límite)" }],
    red: [{ actor: "string (persona o grupo vinculado)", a: "a|b", vinculo: "string", relevancia: "Alta|Media|Baja", compromete: "string (¿lo compromete? Sí/No/Parcialmente + por qué)" }],
    implicaciones: { a: ["string (implicación estratégica de la red del adversario A, 25-45 palabras)"], b: ["string"] }
  }, null, 2),

//OPOSITOR (parte 2: Narrativa/Psico/Digital, Vectores + 6E, Defensa, Comparativo, Bolsillo)
  opositor2: JSON.stringify({
    narrativa: [{ a: "a|b", propuesta: "string", identidad: "string", villano: "string", emocion: "string (incluye fundación moral Haidt)", frame: "string (Lakoff)", fortalezas: ["string (con dato concreto)"], debilidades: ["string"] }],
    disc: [{ a: "a|b", dominante: "D|I|S|C", secundario: "D|I|S|C", estilo: "string (rasgo en 5-12 palabras)", evidencia: "string (material público que sustenta la lectura)", implicacionDebate: "string", egoTrigger: "string (SOLO conducta pública, nunca género/familia/vida privada)", patronBajoPresion: "string", temasEvasion: "string (2-4 temas separados por coma)" }],
    discNota: "string (aclara que el DISC es hipótesis de trabajo y qué material audiovisual la validaría)",
    digital: [{ indicador: "string (ej. 'Share of voice', 'Seguidores / engagement', 'Canal que empuja su mensaje', 'Narrativa digital activa', 'Errores digitales documentados', 'Amplificadores coordinados')", a: "string", b: "string" }],
    digitalNota: "string (nivel de certeza del componente digital: [PARCIAL] si no hay métricas verificadas)",
    puntajes: { a: { narrativa: 0, digital: 0 }, b: { narrativa: 0, digital: 0 } },
    vectores: [{ a: "a|b", codigo: "string (A-V1, A-V2... / B-V1...; 'A-X' o 'B-X' para descartados)", tipo: "string (Contraste de resultados | coherencia | representación | valores | competencia | trayectoria | DESCARTADO)", argumento: "string (argumento central citable, 20-40 palabras)", evidencia: "string", audiencia: "string", canal: "string (canal · momento)", rebote: "string (Bajo | Medio | Alto | Crítico + matiz)", legal: "g|y|r", calumnia: "string", vpg: "string (riesgo de violencia política de género; 'N/A' si el adversario es hombre)", datos: "string (riesgo por datos personales / fuente)", vidaPrivada: "string (interés público vs. vida privada)", ajuste: "string (cómo reformular; vacío si es verde)" }],
    defensa: [{ a: "a|b|all", titulo: "string (ataque previsible contra el cliente, entre comillas)", evidencia: "string (qué usarán)", probabilidad: "Alta|Media|Baja", bloqueo: "string", reencuadre: "string", contraataque: "string", pendiente: "string (verificación pendiente; vacío si no hay)" }],
    comparativo: [{ dimension: "string", cliente: "string", a: "string", b: "string", ventaja: "string" }],
    indicadores9C: [{ indicador: "string", valor: "string", fuente: "string", fecha: "string" }],
    diagnostico9B: { gana: "string", pierde: "string", favorable: "string", impondran: "string" },
    bolsilloNota: "string (ej. si hay o no debate confirmado)",
    bolsillo: [{ a: "a|b", narrativa: "string (su narrativa en una frase entre comillas)", vulnerabilidad: "string", bajoPresion: "string", meAtacara: [{ ataque: "string", respuesta: "string" }], misAtaques: [{ texto: "string", legal: "g|y|r" }], noDebo: "string" }],
    changelog: { version: "string", fecha: "string", fase: "string", pendientes: "string (vectores en rojo pendientes)", activadores: ["string (evento que obliga a actualizar el expediente)"] }
  }, null, 2),

//SESGO
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

  //COMPARATIVO
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

};

// =========================================================
// PROMPTS
// =========================================================

function buildPrompt({ skill, actorName, actor2Name, actoresNombres, datosPorActor, mes, anio, periodo, clienteName = '', parteOpositor = 1, parteTensiones = 1, contextoTensiones = '', datosActor1, datosActor2, schema }) {
  periodo = periodo || construirPeriodo({ mes, anio });
  let contexto;

  if (skill === 'comparativo' && actoresNombres?.length) {
    // N actores (2-6): un bloque de fuentes crudas por cada uno.
    const encabezado = actoresNombres.map((n, i) => `Actor ${i + 1}: ${n}`).join('\n');
    const bloques = actoresNombres.map((n, i) => `\n--- Datos crudos sobre ${n} ---\n${resumirFuentes(datosPorActor?.[i])}`).join('\n');
    contexto = `${encabezado}\n${bloques}`;
  } else {
    const bloque1 = resumirFuentes(datosActor1);
    const bloque2 = datosActor2 ? resumirFuentes(datosActor2) : null;
    const etiquetaSujeto = (skill === 'tensiones' || skill === 'sesgo') ? 'Territorio/Entidad evaluada' : 'Personaje';
    contexto = skill === 'opositor'
      ? `Adversario A (clave "a"): ${actorName}\nAdversario B (clave "b"): ${actor2Name}\nCliente de referencia: ${clienteName || '(no especificado)'}\n\n--- Datos crudos sobre ${actorName} ---\n${bloque1}\n\n--- Datos crudos sobre ${actor2Name} ---\n${bloque2}`
      : actor2Name
      ? `Personaje A: ${actorName}\nPersonaje B: ${actor2Name}\n\n--- Datos crudos sobre ${actorName} ---\n${bloque1}\n\n--- Datos crudos sobre ${actor2Name} ---\n${bloque2}`
      : `${etiquetaSujeto}: ${actorName}\n\n--- Datos crudos extraídos ---\n${bloque1}`;
  }

  // Reglas de anclaje al contexto real para el análisis emocional de un
  // personaje. Evita respuestas genéricas: obliga a derivar municipio/región,
  // actores involucrados y hechos concretos de las fuentes crudas del scraping.
  const guardarropaEmociones = skill === 'emociones'
    ? `\nReglas adicionales OBLIGATORIAS para este análisis emocional de ${actorName}:\n- ANCLAJE AL CONTEXTO REAL: antes de redactar, identifica en las fuentes crudas (a) el cargo o aspiración actual de ${actorName}, (b) el municipio/estado/región donde ejerce o compite, y (c) los hechos recientes más repetidos (fechas, lugares, cifras, obras, escándalos, declaraciones, medios que los reportan). TODO el reporte debe girar alrededor de ESOS hechos concretos, no de generalidades sobre "la política en México".\n- PROHIBIDO el texto intercambiable: si una frase podría pegarse tal cual en el reporte de otro político o de otro municipio, está mal. Cada párrafo (subtitle, resumenEjecutivo, dyadInterp, preguntaDesc, textos de díadas, segmentos, semiótica, actores) debe nombrar al menos un hecho, lugar, actor, cifra o medio tomado de las fuentes crudas. Cita el medio o la fecha cuando exista (ej. "según [medio], [mes]").\n- ACTORES REALES DEL TERRITORIO: en "actores", el primer elemento es ${actorName}; los demás deben ser las personas que REALMENTE intervienen en la contienda o en el gobierno de ESE municipio/región: rivales de otros partidos, titular saliente o en turno, dirigentes locales/estatales de los partidos relevantes, o figuras que las fuentes crudas mencionan junto a ${actorName}. Prioriza los nombres que aparecen literalmente en las fuentes crudas. Si las fuentes no dan nombres suficientes, completa SOLO con figuras públicas que conozcas con certeza para ese cargo y territorio. Nunca inventes nombres de personas ni uses actores de otra región; si no puedes asegurar un nombre, usa el cargo y partido (ej. "Candidatura del PRI a la alcaldía de [municipio]").\n- "territory" y "subtitle" deben reflejar el municipio/estado y cargo reales detectados (ej. "Michoacán · Candidata a ..."), nunca el país genérico "México".\n- "quotes", "problematics", "fears" y "prides" deben provenir de lo que la ciudadanía y los medios dicen sobre ESE territorio en las fuentes crudas; si una fuente trae una frase textual, úsala (acortada) en vez de parafrasear en genérico.\n- Si las fuentes crudas son escasas para un campo, dilo en el texto en términos cualitativos y prudentes ("las fuentes disponibles apuntan a...") en vez de rellenar con frases de manual o inventar cifras.`
    : '';

  const etiquetaCliente = clienteName ? `"${clienteName}"` : 'la candidatura cliente (no se especificó nombre: refiérete a ella como "el cliente")';
  const guardarropaOpositor = skill === 'opositor'
    ? `\nReglas adicionales OBLIGATORIAS para este expediente de adversarios (Opositor):
- Hay DOS adversarios: Adversario A = "${actorName}" (clave "a") y Adversario B = "${actor2Name}" (clave "b"). Cliente de referencia para contraste y defensa: ${etiquetaCliente}. TODO elemento de un array por adversario lleva el campo "a" con "a" o "b" (o "all" solo en "defensa" cuando el ataque puede venir de ambos). Reparte el contenido de forma EQUILIBRADA entre los dos adversarios: ninguno puede quedar con la mitad de elementos que el otro.
- Basa cualquier señalamiento grave ÚNICAMENTE en lo que aparezca en las fuentes crudas proporcionadas. NO inventes números de expediente, pliegos, montos, fechas de documentos ni acusaciones.
- Regla de doble fuente: dato con UNA sola fuente (p. ej. autoinforme) → márcalo [FUENTE ÚNICA]; dato no verificable → [NO VERIFICADO] y NUNCA lo uses como base de ataque ni de cálculo. Los rumores no se activan.
- Si no hay información cruda suficiente, dilo explícitamente ("sin dato verificado", "área de riesgo reputacional") en vez de disfrazarlo de hecho probado.
- PROHIBIDO asociar a un adversario con delincuencia organizada o delitos por homonimia, parentesco o rumor: eso es calumnia electoral. Si existe ese riesgo en redes, regístralo como vector DESCARTADO en rojo ("legal":"r").
- Violencia política de género (VPG): si un adversario es mujer, NUNCA construyas ataques sobre su género, maternidad, apariencia, pareja o familia ("hija de", "esposa de"), ni reduzcas su carrera a un hombre o a su partido; si un vector cae en ese patrón márcalo "legal":"r" y propón la reformulación en "ajuste". Si el adversario es hombre, "vpg" = "N/A".
- El perfil DISC es una HIPÓTESIS DE TRABAJO basada SOLO en conducta pública observable (actas, informes, discursos, entrevistas, redes), nunca un diagnóstico clínico; "egoTrigger", "patronBajoPresion" y "temasEvasion" no pueden apoyarse en género, familia, origen, salud ni vida privada.
- Incluye comentarios y reacciones de MEDIOS y REDES (con el medio o la plataforma y el mes) en contradicciones, vulnerabilidades, alertas y digital: es parte central del expediente.
- Este expediente es un producto de consultoría pagado: cada pestaña debe sentirse igual de investigada; nunca 2-3 elementos genéricos.`
    : '';

  const guardarropaSesgo = skill === 'sesgo'
    ? `\nReglas adicionales OBLIGATORIAS para este análisis de sesgos cognitivos electorales:\n- Marco teórico: analiza el electorado del territorio/entidad evaluado a través de sesgos cognitivos de psicología política (heurísticos de Kahneman-Tversky y afines) que la evidencia de las fuentes crudas sugiera que están activos, no un catálogo genérico repetido de análisis a análisis.\n- Catálogo de referencia (no exhaustivo, úsalo como guía de categorías y códigos S01-S26, pero adáptalo a lo que realmente sugieran las fuentes; puedes usar otros sesgos conocidos si encajan mejor):\n  · Categoría I — Heurísticos de disponibilidad y exposición: S08 Disponibilidad, S23 Mera exposición, S26 Verdad ilusoria.\n  · Categoría II — Sesgos de negatividad y pérdida: S11 Negatividad, S20 Aversión a la pérdida, S13 Víctima identificable.\n  · Categoría III — Sesgos identitarios y sociales: S15 Identidad social, S05 Efecto bandwagon, S17 Sesgo endogrupal.\n  · Categoría IV — Sesgos retrospectivos y de atribución: S18 Retrospectivo, S03 Atribución, S09 Sesgo de resultado.\n  · Categoría V — Sesgos de autoridad y confianza institucional: S25 Autoridad, S02 Halo, S06 Autoservicio institucional.\n  · Categoría VI — Sesgos de confirmación y consistencia: S07 Confirmación, S21 Disonancia cognitiva, S14 Consistencia interna.\n  · Categoría VII — Sesgos de anclaje y encuadre: S01 Anclaje inicial, S10 Encuadre/framing, S19 Proyección.\n  · Categoría VIII — Sesgos de statu quo y fatiga cívica: S12 Statu quo/fatiga, S24 Descuento hiperbólico, S16 Ilusión de control.\n- El SAS (Score de Activación de Sesgo) de cada elemento en "ranking" va de 0-100: 81-100 = Crítico, 61-80 = Alto, 41-60 = Medio, <41 = Bajo. Distribuye los scores de forma realista y variada (no todos en el mismo rango).\n- "metricas.sesgosCriticos.valor" y "metricas.sesgosAltos.valor" DEBEN coincidir exactamente con el conteo real de elementos de "ranking" en esos rangos de score — nunca un número inventado que no cuadre con el ranking.\n- "metricas.sri" (Riesgo Cognitivo de continuidad/actor en turno) interpreta qué tan expuesto está el actor/partido gobernante a que la oposición explote los sesgos activos.\n- Basa cualquier cifra o hecho concreto (número de negocios cerrados, meses de conflicto, medios que dieron cobertura, etc.) ÚNICAMENTE en las fuentes crudas proporcionadas; si no hay suficiente evidencia para un dato concreto, redacta el mecanismo del sesgo en términos cualitativos en vez de inventar una cifra.`
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

  const instruccionesEstructura = skill === 'emociones'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Emociones):\n- "emotions.intensity" es un ENTERO de escala fija 0-3, NUNCA otro rango: 0 = inactiva (no se detecta evidencia real de esta emoción), 1 = baja, 2 = media, 3 = alta. Debes DISTRIBUIR intensidades realistas y VARIADAS entre las 8 emociones según la evidencia — está PROHIBIDO poner intensity:3 a todas las emociones activas; eso es un error, no un signo de análisis completo. Como referencia, en un territorio típico: 1-2 emociones en intensidad 3 (las dominantes), 2-3 en intensidad 2, el resto en 1 o 0 (inactivas). Refleja la mezcla real de las fuentes, no un maximalismo genérico.\n- "dyads" (Díadas Emocionales) — NUNCA lo dejes vacío, es OBLIGATORIO que tenga mínimo 3 elementos, sin excepción. Una díada emocional es la COMBINACIÓN de dos de las 8 emociones activas que juntas producen una dinámica política específica y nombrable. Estructura de cada díada: "name" = nombre corto de la dinámica combinada (ej. "Indignación Resignada", "Miedo Desconfiado", "Esperanza Cautelosa"); "formula" = las dos emociones que se combinan, formato "EmociónA + EmociónB" (ej. "Ira + Tristeza"); "type" = "Primaria" si es la combinación dominante en el territorio o "Secundaria" si es una dinámica emergente menor; "text" = párrafo explicando el mecanismo político-emocional de esa combinación y su implicación estratégica; "risk" = CRÍTICO/ALTO/MEDIO/BAJO; "score" = número 0-100 de intensidad de riesgo. Ejemplo completo: {"name":"Indignación Resignada","formula":"Ira + Tristeza","type":"Primaria","text":"La ciudadanía combina enojo activo por el desabasto de agua con una tristeza resignada ante la falta de respuesta institucional, generando apatía electoral disfrazada de crítica...","risk":"ALTO","score":78}. Construye las díadas a partir de las emociones con mayor "intensity" en el array "emotions" — siempre hay al menos 3 combinaciones detectables en cualquier territorio político real.\n- "dyadInterp" debe ser un párrafo (60-120 palabras) interpretando el conjunto de díadas en términos de estrategia política, no una frase genérica.\n- "actores" (comparación de actores políticos, pestaña "Actores") — PROHIBIDO usar placeholders genéricos como "Competidor A", "Competidor B", "Oponente 1": "actores[0].name" debe ser EXACTAMENTE "${actorName}" (el personaje principal evaluado), y los siguientes 2-3 actores deben ser sus rivales/contrapartes políticos REALES de ese mismo proceso electoral o cargo, con su NOMBRE REAL identificable por el contexto político público de la entidad/cargo (candidatos rivales conocidos, titular saliente, líder de oposición, etc.) — básate en lo que sea de conocimiento público sobre esa elección/cargo aunque las fuentes crudas no lo mencionen explícitamente. Únicamente si es genuinamente imposible identificar ningún nombre real de ningún rival (cargo muy local y sin contexto electoral claro), usa como alternativa el nombre del PARTIDO u organización que representaría cada rival (ej. "Candidatura del PRI", "Oposición del PAN") en vez de un placeholder tipo "Competidor A".\n- "actores.rows" (comparación de actores políticos) — cada actor debe traer MÍNIMO 6 filas, usando estas categorías de análisis como referencia (puedes adaptar la etiqueta exacta pero cubre el fondo de cada una): "Emoción dominante que activa", "Rol narrativo (Westen)", "Capital emocional positivo/diferencial", "Fundación moral que activa (Haidt)", "Principal vulnerabilidad", "Ventana estratégica 30 días" o "Riesgo para [el otro actor]". El VALOR de cada fila NUNCA debe ser una etiqueta corta o palabra suelta — debe ser una CLÁUSULA COMPLETA Y ESPECÍFICA con evidencia concreta (cifras, nombres de proyectos/lugares, fechas), del mismo nivel de detalle que: "78 Huellas de la Transformación, 250+ patrullas, Mexicable al 68%" o "Brecha entre cifras oficiales y experiencia cotidiana en colonias periféricas" — nunca algo tan corto como "Popularidad alta" o "Buena imagen".\n- "temasChart" debe ser un ARRAY DE ARRAYS: cada elemento es ["nombre del tema", porcentajeNumero, "colorHex"]. Ejemplo: [["Seguridad", 35, "#3b82f6"], ["Economía", 25, "#f97316"]]\n- "partidosChart" debe ser un ARRAY DE ARRAYS: cada elemento es [iraAscoNum, decepcionTristezaNum, interesDisponibleNum]. Ejemplo: [[45, 30, 25], [20, 60, 20]]\n- "actoresRadar.data" debe ser un ARRAY DE ARRAYS de números (0-100), uno por actor.\n- "secondary" debe incluir color (hex) para cada emoción secundaria.\n- "segmentos" (Segmentación N×E×I — Narrativa × Emoción × Identidad, pestaña "Segmentos y Perfiles"): cada segmento representa un bloque real y reconocible del electorado/población del territorio (ej. base leal de un actor, indeciso evaluador de otro, base ideológica de un tercero, segmento transversal no partidista/desconectado). "peso" es un porcentaje ESTIMADO (marca [ESTIMACIÓN] si no hay encuesta de campo real en las fuentes); "persuabilidad" clasifica qué tan movible es ("YA ES NUESTRO"/"MUY ALTA"/"ALTA"/"MEDIA"/"BAJA") y debe ser coherente con "objetivo" (MOVILIZAR si ya es nuestro, PERSUADIR si es persuadible, CONTENER si es hostil pero relevante, IGNORAR si es irrelevante). "frase" debe sonar a cita ciudadana real de ese segmento específico, no a eslogan genérico. Cada uno de los 4 sub-bloques (perfil, emocional, palancas, vector) debe llenarse por completo, con datos concretos del territorio, nunca genéricos intercambiables entre segmentos.\n- "semiotica" (pestaña "Semiótica"): aplica el modelo de los 12 arquetipos junguianos (Inocente, Explorador, Sabio, Héroe, Rebelde, Mago, Todos/Hombre común, Amante, Bufón, Cuidador, Gobernante, Guerrero) sobre el imaginario colectivo del territorio. "arquetipoColectivo" describe qué arquetipo vive la ciudadanía de sí misma/su comunidad (dominante/secundario/emergente/rechazado), siempre con evidencia concreta del territorio. "arquetipoPolitico" describe qué arquetipo espera la ciudadanía de SU LIDERAZGO político (puede ser distinto al colectivo) y su "evidencia" debe explicar también el riesgo de sobreactuación si un candidato fuerza ese arquetipo sin resultados reales. "arquetiposRadar" es un ARRAY DE EXACTAMENTE 12 NÚMEROS (escala 0-5, pueden llevar un decimal) EN ESTE ORDEN EXACTO: [Inocente, Explorador, Sabio, Héroe, Rebelde, Mago, Todos/Hombre común, Amante, Bufón, Cuidador, Gobernante, Guerrero] — refleja qué tanto resuena cada arquetipo en el imaginario colectivo, con variación real entre valores (nunca todos iguales ni todos en el máximo). "miedos", "deseos" y "necesidades" son 3 rankings INDEPENDIENTES de EXACTAMENTE 10 elementos cada uno, ordenados de "rank":1 (el más fuerte/prioritario) a "rank":10, cada uno con "evidencia" (hecho/fuente concreta del corpus, o [inferencia razonable] si no hay evidencia digital directa) y "significado" (lectura política de por qué importa ese miedo/deseo/necesidad).`
    : skill === 'comparativo'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Comparativo, ${listaComparativo.length} actores):\n- LLAVES DINÁMICAS POR ACTOR: en "sentimientoGeneral", "traSerie.series", "picosSerie.series", "plataformasRadar.data" y "sentimientoCruces.*.data", las llaves del objeto deben ser EXACTAMENTE los ${listaComparativo.length} nombres reales listados arriba, NUNCA "NombreActor1"/"NombreActor2" ni variantes. Ejemplo real: {${ejemploLlaves}}. Cada uno de estos objetos debe traer entradas para TODOS los actores, no solo los primeros 2.\n- "npsPorActor" y "ratioPorActor" deben tener EXACTAMENTE ${listaComparativo.length} números, en el mismo orden que la lista de actores.\n- "sentimientoGeneral" y los arrays dentro de "sentimientoCruces.*.data.<actor>.<segmento>" son [positivo, neutro, negativo, polarizado] — 4 números que idealmente suman ~100.\n- "kpiCards": mínimo 4 tarjetas, "color" debe ser una de estas 4 letras exactas: "g" (verde/bueno), "a" (ámbar/atención), "r" (rojo/riesgo), "n" (neutro). NUNCA un color hex aquí.\n- "hashtags": cada fila es EXACTAMENTE 6 elementos en este orden: [hashtag (con #), nombre del actor al que más se asocia, tono ("Positivo"/"Negativo"/"Neutro"/"Polarizado"), plataforma principal donde circula, origen ("orgánico"/"inducido"), frecuencia relativa (número 0-100)].\n- "riesgos" y "oportunidades": cada fila es un array de 4 elementos [nivel, titulo, texto, bivariado]. Nivel de "riesgos" usa CRÍTICO/ALTO/MEDIO/BAJO; nivel de "oportunidades" usa ALTA/MEDIA/BAJA.\n- "narrativas.tipo" debe ser EXACTAMENTE uno de: "favorable", "critica", "ambivalente" (sin acentos, en minúsculas) — el frontend filtra por este valor literal. Debe haber narrativas para CADA uno de los ${listaComparativo.length} actores, no solo de los primeros 2.\n- "alertaTabla" debe tener EXACTAMENTE ${listaComparativo.length} filas, una por actor.\n- "topOfMindCruces.*.data" usa como llave el NOMBRE DEL TEMA (no del actor), con un array de números alineado a "segments".\n- "plataformasRadar.labels" siempre debe ser ["X (Twitter)", "Facebook", "Instagram", "Medios digitales"] y "plataformasRadar.data.<actor>" un array de 4 números alineados a esas labels, para CADA uno de los ${listaComparativo.length} actores.`
    : skill === 'opositor' && parteOpositor === 2
        ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Opositor · parte 2: Narrativa/Psico/Digital, Vectores 6E, Defensa, Comparativo, Bolsillo):
- "narrativa": EXACTAMENTE 2 objetos (uno con "a":"a" y otro con "a":"b"), cada uno con mínimo 3 "fortalezas" (con dato concreto, "no subestimar") y mínimo 3 "debilidades" narrativas (incluye el tema que previsiblemente evita).
- "disc": EXACTAMENTE 2 objetos (a y b). "dominante" y "secundario" = UNA letra D/I/S/C distintas entre sí. "estilo" describe el rasgo observado.
- "digital": mínimo 6 indicadores con valor para a y b; si no hay métrica verificada escribe "Sin dato verificado" (no inventes seguidores). Usa "estimación RADAR" para share of voice estimado.
- "puntajes": debilidad narrativa y vulnerabilidad digital de cada adversario en escala 0-100 (más alto = más vulnerable). Si no hay errores digitales documentados, el digital debe ser bajo (30-45).
- "vectores": mínimo 8 en total (4+ por adversario). "legal": "g" = verde (usable), "y" = amarillo (usable con ajuste: llena "ajuste"), "r" = rojo (NO recomendado, se muestra solo como hallazgo con advertencia: llena "ajuste" con la reformulación o "Descartado de forma definitiva"). Incluye al menos 1 vector "y". Los campos de verificación 6E ("calumnia", "vpg", "datos", "vidaPrivada") siempre llenos.
- VERIFICACIÓN 6E (OBLIGATORIA en CADA vector, también en los rojos/descartados): "calumnia", "datos" y "vidaPrivada" SIEMPRE con una explicación de 10-25 palabras del riesgo concreto (ej. "Riesgo moderado si se afirma desvío: la ASF solo emitió observación preliminar"); está PROHIBIDO responder "N/A", "—" o dejarlos vacíos. "vpg": explica el riesgo de violencia política de género; solo si el adversario es hombre escribe "N/A (adversario hombre; argumento sobre conducta pública)". "ajuste": obligatorio en amarillos y rojos con la reformulación concreta.
- Cada vector pertenece a UN adversario: "a" debe ser "a" o "b" (nunca "all"), coherente con su código (A-… = "a", B-… = "b"), incluso los descartados (A-X / B-X).
- "defensa": mínimo 5 ataques previsibles CONTRA el cliente ${etiquetaCliente}, con el protocolo de 3 pasos: "bloqueo" (neutraliza), "reencuadre" (cambia el marco) y "contraataque" (puede remitir a un código de vector, ej. "Vector A-V1"). "pendiente" = verificación que el cliente debe hacer antes de usar la línea.
- "defensa[].a" indica QUÉ adversario lanzaría ese ataque contra el cliente: "a" o "b". Reparte: mínimo 2 ataques de "a" y 2 de "b". Usa "all" como máximo en 1 ataque y solo si ambos lo usarían por igual.
- "comparativo": mínimo 8 dimensiones (Trayectoria, Propuesta central, Consistencia pública, Credibilidad en seguridad, Credibilidad en transparencia, Share of voice, Red de alianzas, Conexión territorial...) comparando cliente vs. a vs. b, y en "ventaja" quién gana esa dimensión. NO incluyas la fila IVA (se calcula aparte).
- "indicadores9C": mínimo 5 indicadores cuantitativos de contexto con fuente y fecha reales; si falta encuesta escribe "Sin datos cuantitativos disponibles".
- "bolsillo": EXACTAMENTE 2 tarjetas (a y b), cada una con 3 "meAtacara" (ataque → respuesta del cliente) y 3 "misAtaques" con su semáforo "legal". "noDebo" = líneas rojas (calumnia/VPG).
- "changelog.activadores": mínimo 5 eventos que obligan a actualizar el expediente.`
    : skill === 'opositor'
        ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Opositor · parte 1: Resumen, Perfiles e IER, Contradicciones, Vulnerabilidades, Red):
- "adversarios": EXACTAMENTE 2 objetos, clave "a" = "${actorName}" y clave "b" = "${actor2Name}" (usa esos nombres tal cual). "siglas" = 2 letras para la etiqueta.
- "perfiles": EXACTAMENTE 2 objetos (a y b) con mínimo 7 "rows" cada uno: Nombre en actas / Cargo actual / Aspira a / Trayectoria / Padrino o red política / Formación / Transparencia (o Red de origen, Edad).
- "ier": mínimo 2 cargos por adversario (4+ en total) — uno por cada cargo verificable de su trayectoria; "valor" 0-10 (0-3 escándalo o gran brecha promesa/resultado; 4-6 mixto; 7-10 cumplido). Un cargo [NO VERIFICADO] NO entra a "ier": menciónalo en "perfiles" y en "ierNota".
- "contradicciones": mínimo 8 en total (4+ por adversario), códigos "A-1","A-2"… para a y "B-1","B-2"… para b. "potencial" es el potencial de daño 0-100 (usa valores variados y realistas, no todos 80+).
- "vulnerabilidades": mínimo 10 en total (5+ por adversario). "riesgo": "C" crítico, "A" alto, "M" medio, "B" bajo — distribuidos de forma realista. Si un adversario es éticamente limpio, dilo como fila ("Sin denuncias documentadas en la ventana") en vez de inventar.
- "red": mínimo 10 vínculos en total (5+ por adversario): padrinos, rivales internos, aliados, estructura partidista, grupos políticos.
- "implicaciones": mínimo 3 por adversario.
- "alertas": mínimo 8 (4+ por adversario). "recomendaciones": mínimo 5. "semaforo3C": EXACTAMENTE 2 (a y b).
- "alertaJuridica": siempre llena, con las líneas que nunca deben cruzarse con estos adversarios.`
    : skill === 'sesgo'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Sesgo):\n- CONSISTENCIA NUMÉRICA (crítico): "metricas.sesgosCriticos.valor" debe ser EXACTAMENTE el número de elementos de "ranking" con score 81-100, y "metricas.sesgosAltos.valor" el número con score 61-80 — cuenta el array real, nunca un número aproximado o inventado.\n- "ranking[].categoria" usa EXACTAMENTE uno de los números romanos "I" a "VIII" del catálogo de referencia dado en las reglas adicionales; distribúyelos, no concentres todo en 1-2 categorías.\n- "ranking[].descripcion" siempre ancla el sesgo en un hecho/evidencia concreto de las fuentes (fecha, cifra, medio, actor), no una definición de libro de texto del sesgo — ej. "22 meses de conflicto armado saturan el frame emocional del electorado (cobertura CNN/Infobae, ago-sep 2026)", nunca solo "La gente reacciona más a lo negativo".\n- "segmentos[].perfil" debe cubrir el espectro completo del electorado del territorio evaluado (mínimo: base dura del partido en el poder, base blanda/decepcionada, persuadible/indeciso, abstencionista/fatigado) — nunca dupliques el mismo perfil dos veces. "color" debe ser EXACTAMENTE uno de "verde", "azul", "ambar", "gris".\n- "ventanasPersuasion[].segmento" debe ser un público específico y territorializado (ej. "Comerciantes de Culiacán", no "Ciudadanía en general"), y "recomendacion" una acción/mensaje concreto y accionable, nunca un consejo genérico tipo "comunicar mejor".\n- "arquitecturaMensajes[].etiqueta" debe ser EXACTAMENTE una de "Diferenciación", "Posicionamiento", "Lanzamiento", "Contención", "Movilización" — cubre al menos 3 etiquetas distintas entre los elementos, no repitas la misma etiqueta en todos.\n- "metricas.sistemaDominante.valor" debe ser EXACTAMENTE "Sistema 1" (procesamiento emocional/reactivo, típico cuando predominan sesgos de negatividad/disponibilidad/pérdida) o "Sistema 2" (procesamiento deliberativo, típico cuando predominan sesgos de confirmación/consistencia con baja intensidad emocional) — decide según qué categorías dominan el ranking.`
    : skill === 'tensiones' && parteTensiones === 2
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Tensiones · CARTOGRAFÍA SOCIOAFECTIVA — pestañas "Radiografía y dolores", "Enemigos y segmentación" y "Narrativas y 9 preguntas"):
- En esta llamada generas ÚNICAMENTE el objeto "cartografiaSocioafectiva" con TODAS sus listas llenas. Es un módulo COMPLEMENTARIO a Tensiones: Tensiones lee el conflicto institucional; la cartografía lee la VIVENCIA EMOCIONAL por SEGMENTO social y por ZONA.
- "iasPorZona" (Radiografía territorial sintética + gráfica IAS): 6-8 zonas/corredores/colonias específicas, ordenadas de mayor a menor "ias" (0-100, con variación real). "color": "#E24B4A" si ias≥75, "#D97706" si 55-74, "#B45309" si <55. "tipo" describe la zona (ej. "Corredor carretero / rural", "Urbano-comercial", "Popular / periférico", "Ribereño / agroindustrial", "Empresarial / productivo", "Institucional / político"). "tensionDominante" usa un nombre del ranking de Tensiones. "emocionDominante" formato corto "EmociónA + EmociónB". "lectura" 30-55 palabras: puede abrir con una cita ciudadana entrecomillada seguida de "—" y su interpretación (ej. "\"Si atacan a la Guardia Nacional a plena luz del día, ¿qué nos espera a nosotros?\" — quiebre de la percepción de tránsito seguro").
- "dolores" (Mapa de dolores sociales): 6-8. "frase" = cita ciudadana entre comillas, en el habla local (ej. "En la carretera uno ya no sabe con qué se va a topar"). "meta" = "Hecho concreto · Intensidad X/5 · fecha o estado" (ej. "Enfrentamiento armado en El Pandillo · Intensidad 5/5 · 14 ago 2026").
- "enemigosSimbolicos": 4-6. "nombre" es una FIGURA SIMBÓLICA en lenguaje ciudadano (ej. "El que cobra por dejarte trabajar", "El funcionario que no rinde cuentas"), NO el nombre propio de una persona privada. "descripcion" 50-90 palabras con hecho, fecha y cifra.
- "fracturasSociales": 4-6. "titulo" con los dos polos "X vs. Y"; "descripcion" 50-90 palabras con evidencia.
- "segmentacion": 6-8 segmentos sociales/económicos concretos (comerciantes, familias con remesas, vecinos de un corredor, comunidad ribereña, militancia de un partido, jóvenes...), "emocionDominante" (1-2 emociones) y "detonante" con fecha.
- "narrativaMadre": UNA frase ciudadana entre comillas que agrupa las heridas por segmento (DISTINTA de la narrativa madre de Tensiones). "narrativaMadreDesc": 40-70 palabras explicando en qué se diferencia de la de Tensiones.
- "narrativas": 4-6 narrativas POR SEGMENTO. "nombre" = la narrativa en voz ciudadana; "tema" = "Segmento: …"; "actor" = hecho/actor detonante con fecha; "potencial" = párrafo de 25-45 palabras sobre su potencial de propagación; "frase" = cita textual entre comillas; "fuente" = "Reconstrucción analítica a partir de [medios], [fecha]".
- "preguntas": EXACTAMENTE 9, en este orden y con esta redacción: 1 "¿Qué le duele más al territorio hoy?", 2 "¿A quién culpa la ciudadanía?", 3 "¿En quién confía todavía?", 4 "¿Qué emoción domina y hacia dónde se dirige?", 5 "¿Qué símbolo podría unir a la comunidad?", 6 "¿Qué narrativa puede movilizarla?", 7 "¿Qué actor ocupa el rol de enemigo simbólico?", 8 "¿Qué segmento está más activado emocionalmente?", 9 "¿Qué tema puede detonar la próxima crisis?". Cada "respuesta" de 45-80 palabras con hechos, fechas y cifras.
- Incluye comentarios y reacciones de MEDIOS y REDES (con medio/plataforma y fecha) en dolores, narrativas y lecturas.
${contextoTensiones ? '\nCONTEXTO DE LA PARTE 1 (Tensiones ya generadas — mantén coherencia de nombres):\n' + contextoTensiones : ''}`
    : skill === 'tensiones'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Tensiones):\n- CONSISTENCIA ENTRE PESTAÑAS (crítico): "trayectoria" debe tener EXACTAMENTE las mismas tensiones que "ranking" (mismos "nombre", mismo orden), y "riesgos" también debe cubrir esas mismas tensiones en el mismo orden — un analista que lea las 3 pestañas debe reconocer que hablan de las mismas 8-10 tensiones, no de conjuntos distintos. El último elemento de "trayectoria[].valores" debe ser IGUAL al "score" de esa misma tensión en "ranking", y también igual a "trayectoria[].ta". "trayectoriaLabels" y cada "trayectoria[].valores" deben tener la MISMA longitud.\n- "ranking[].lecturaEstrategica" es un campo adicional y DISTINTO de "evidencia": mientras "evidencia" lista hechos verificables, "lecturaEstrategica" es la interpretación — conecta esta tensión con otras del ranking o con el contexto regional. Obligatorio en TODAS las tensiones del ranking, no solo en la primera.\n- "emociones[].tendencia" (flecha ↑/↓/— + palabra corta) y "emociones[].tendenciaDesc" (una línea con el hecho que explica esa evolución) son obligatorios en TODAS las emociones.\n- "riesgos[].accion" (qué hacer) y "riesgos[].consecuencia" (qué pasa si no se hace) son campos distintos y ambos obligatorios.\n- "narrativaMadreSintesis" (síntesis general de TODO el ranking) y "cartografiaSocioafectiva.narrativaMadre" (síntesis por segmento social) deben ser textos DIFERENTES entre sí.\n- "narrativas[].potencial" es un número 0-100, adicional al texto de "narrativas[].politica".\n- "aprobacion.cortes" normalmente trae 1 solo dato real verificado — nunca inventes puntos intermedios interpolados.\n- "ranking[].nivel" tiene SOLO 4 valores posibles y se asigna ÚNICAMENTE por el "score" de esa misma tensión, sin excepción: "Crítico" si score ≥80, "Alto" si score 65-79, "Relevante" si score 50-64, "Emergente" si score <50. Nunca uses "Medio" ni "Bajo" ni ningún otro texto — y nunca asignes "Crítico" a un score menor a 80 ni "Emergente" a uno de 50 o más.\n- "ranking[].emocion" formato EXACTO: "EmociónPrimaria + EmociónSecundaria · X/5" (ej. "Hartazgo + Desprotección · 4/5"), nunca solo una palabra suelta.\n- "ranking[].evidencia" es un párrafo (no una frase) que encadena 2-3 datos verificables (cifras, fechas, colonias) cada uno rematado con su fuente entre paréntesis, siguiendo este patrón: "Dato 1 con cifra y fecha (Fuente, ICF X.X) - Dato 2 (Fuente, ICF X.X)". Nunca lo dejes como una oración vaga sin cifras ni fuente.\n- "emociones[].descripcion" siempre debe indicar si la emoción es estructural/coyuntural y su tendencia (sostenida/en descenso/nueva), no solo repetir el nombre de la emoción.\n- "territorios[].color" debe ser EXACTAMENTE "Rojo", "Naranja" o "Amarillo" (no otros valores ni colores hex aquí).\n- "riesgos[].tipoSenal" debe ser EXACTAMENTE uno de: "Amplificada legítima", "Orgánica", "Inducida", "Aislada". "riesgos[].probEscalar" debe ser EXACTAMENTE "Alta", "Media" o "Baja".\n- "trayectoria[].delta" es un STRING con signo, ej. "+7" o "-3" (último valor menos primer valor de "valores"), nunca un número sin signo ni una palabra.\n- "trayectoria[].velocidad" tiene SOLO 3 valores posibles, asignados por la magnitud de "delta" (en valor absoluto): "Acelerada" si el cambio es ≥25 puntos, "Moderada" si es de 11 a 24 puntos, "Gradual" si es de 10 puntos o menos. PROHIBIDO usar "Creciendo", "Estable", "Bajando" u otro texto, y PROHIBIDO repetir el mismo valor de "velocidad" en todas las filas si los "delta" son distintos entre sí — cada fila refleja SU PROPIA magnitud de cambio.\n- "alertas[].rows": cada alerta necesita mínimo 8 filas cubriendo Territorio, Emoción, Actor expuesto, Qué ocurrió (párrafo con fecha, incorporando reacciones reales de medios/redes si las fuentes las traen), Narrativa activa, Riesgo, Qué puede pasar, Acción inmediata — usa esas etiquetas o muy similares, en ese orden. NINGÚN valor de estas filas puede ser una palabra o frase corta genérica (ej. "Culiacán", "Gobierno del Estado", "Miedo (5/5)"): cada valor debe ser una CLÁUSULA COMPLETA con contexto propio — ej. en vez de "Culiacán" escribe "Culiacán y su zona metropolitana, epicentro de los enfrentamientos de agosto"; en vez de "Gobierno del Estado" escribe "Gobierno del Estado de Sinaloa, por la Secretaría de Seguridad Pública estatal"; "Riesgo" siempre lleva nivel + por qué ("Alto — la ausencia de control territorial puede derivar en..."); "Qué puede pasar" y "Acción inmediata" nunca van en una sola línea genérica, sino con un escenario o acción específica y verificable.\n- "cartografiaSocioafectiva" es un módulo COMPLEMENTARIO a tensiones (no lo dupliques): mientras "ranking"/"narrativas"/"territorios" leen el conflicto institucional, "cartografiaSocioafectiva" lee la vivencia emocional por SEGMENTO social. "iasPorZona[].ias" es 0-100 (Índice de Activación Socioafectiva), nunca copies aquí los mismos números de "riesgos[].srr". "segmentacion[].emocionDominante" usa formato corto "EmociónA + EmociónB" (sin el "· X/5" que sí llevan las emociones de "ranking"). "preguntas" debe ser un array de EXACTAMENTE 9 objetos {pregunta, respuesta}, ni 8 ni 10.\n- "iasPorZona[].color" debe ser coherente con "ias": rojo (#C53030 o similar) si ias≥75, naranja (#C05621) si 55-74, ámbar (#B7791F) si <55 — y cada "lectura" debe nombrar el mecanismo propio de esa zona, nunca una frase intercambiable con otra. "territorios[].color" (Rojo/Naranja/Amarillo) se asigna por nivel de impacto real: "Rojo" = hecho violento, pérdida de vidas o tensión con score≥75 en "ranking"; "Naranja" = tensión activa con score 55-74 o riesgo institucional/económico sostenido; "Amarillo" = tensión latente o score<55 sin escalamiento agudo todavía.`
    : '';

  // Antes solo decía "al menos un elemento" -> el modelo cumplía con el
  // mínimo literal (1-2 items, textos de una línea). Aquí se especifica
  // cuánto es "amplio" para cada skill, campo por campo, en vez de dejarlo
  // a interpretación del modelo.
  // Tensiones parte 1: la cartografía se genera en la llamada 2, así que se
  // quitan de las instrucciones las líneas que la piden (para no gastar
  // tokens de salida en ella) y se avisa explícitamente que NO la genere.
  const instruccionesTensionesP1 = (txt) => (skill === 'tensiones' && parteTensiones === 1)
    ? txt.split('\n').filter(l => !l.includes('cartografiaSocioafectiva') && !l.includes('iasPorZona')).join('\n')
      + '\n- NO generes "cartografiaSocioafectiva" en esta respuesta: se genera en una llamada aparte. Usa todo tu espacio para las 7 pestañas de Tensiones.'
    : txt;
  const requisitosCantidad = REQUISITOS_MINIMOS[(skill === 'opositor' && parteOpositor === 2) ? 'opositor2' : (skill === 'tensiones' && parteTensiones === 2) ? 'tensionesCartografia' : skill] || '';

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
${requisitosCantidad}${guardarropaEmociones}${guardarropaOpositor}${guardarropaSesgo}${guardarropaComparativo}${instruccionesTensionesP1(instruccionesEstructura)}`;

  const user = `Periodo evaluado: ${periodo.label} (del ${periodo.desde} al ${periodo.hasta})
PERIODO DE INVESTIGACIÓN: ${periodo.instruccion}
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
- problematics: mínimo 6 elementos, cada uno anclado en un hecho específico (fecha, colonia, cifra, nombre de funcionario si aplica) — usa como referencia de densidad y estilo: "Desabasto de agua recurrente: más de 230 colonias en tandeo; bloqueos documentados en febrero y mayo 2026 en Paseo de los Mexicas y Conscripto".
- fears: mínimo 5 elementos con el mismo nivel de especificidad territorial y temporal.
- prides: mínimo 4 elementos con el mismo nivel de especificidad (nombres de proyectos, cifras de aportación económica, identidad territorial concreta).
- semaforo (Semáforo Emocional del Territorio): mínimo 6 indicadores distintos (p. ej. seguridad, economía/empleo, servicios públicos, movilidad, salud, educación, obra pública, percepción de gobierno local).
- govSemaforo (Percepción del Gobierno en Turno): mínimo 6 indicadores de desempeño distintos y específicos (p. ej. seguridad pública, manejo del agua, vialidad/movilidad, transparencia, atención ciudadana, obra pública, economía local, salud), cada uno con su propio "estado" — NO los agrupes en un solo indicador genérico de "Desempeño del gobierno".
- temasChart (Emociones por Temática): mínimo 5 temas distintos.
- segmentos: mínimo 4 segmentos distintos, cubriendo el espectro real del electorado/población (mínimo: una base leal/afín, un indeciso evaluable, una base ideológica opositora, y un segmento transversal no partidista o de desconexión política) — cada uno con los 4 sub-bloques (perfil, emocional, palancas, vector) completos, nunca vacíos ni genéricos.
- semiotica.arquetiposRadar: EXACTAMENTE 12 números, en el orden fijo: Inocente, Explorador, Sabio, Héroe, Rebelde, Mago, Todos/Hombre común, Amante, Bufón, Cuidador, Gobernante, Guerrero — con variación real entre valores.
- semiotica.miedos, semiotica.deseos, semiotica.necesidades: EXACTAMENTE 10 elementos cada lista (rank 1 a 10), nunca menos.`,

  tensiones: `
REGLA ANTI-CORTE (OBLIGATORIA, lee esto primero): este reporte tiene MUCHOS campos. Está PROHIBIDO dejar sin generar o vacíos los campos finales del JSON (especialmente "cartografiaSocioafectiva.preguntas" y "cartografiaSocioafectiva.narrativas") por quedarte sin espacio. Si notas que el contenido se está extendiendo demasiado, PRIORIZA ASÍ: primero asegura que TODOS los campos y TODAS las pestañas existan con contenido completo (nunca un array vacío ni un string vacío), y solo si hace falta recortar, acorta la longitud de los párrafos más largos (ej. "lecturaEstrategica", "observaciones", "descripcion") en vez de omitir un campo o una tensión completa. Un reporte con 8 tensiones y párrafos de 40 palabras es MEJOR que uno con 10 tensiones donde "preguntas" o "narrativas" quedaron vacíos.

REQUISITOS MÍNIMOS DE CANTIDAD (TENSIONES) — mínimo 8, ideal hasta 10, en TODAS estas listas: ranking, emociones, narrativas, territorios, riesgos, trayectoria, alertas. Nunca entregues menos de 8 en ninguna.

- semaforo: EXACTAMENTE 5 indicadores, en este orden y con estas etiquetas EXACTAS: "Tensión social" (= score de la tensión #1 del ranking), "Reputacional" (= SRR más alto de "riesgos"), "Escalamiento" (= score de escalamiento agregado, coherente con cuántas tensiones tienen velocidad "Creciendo"), "Confianza institucional" (puede ser texto como "MEDIA-BAJA" si no hay encuesta numérica, con "sub" citando el dato de aprobación si existe), "Movilización social" (ALTA/MEDIA/BAJA con "sub" explicando evidencia o ausencia de movilización de calle). Los 5 "nivel" deben ser coherentes con sus "valor" (nunca un valor de 87 con nivel "bajo").

- ranking: 8-10 tensiones sociales distintas, cada una completa (nunca "—" en ningún campo):
  · "emocion" en formato EXACTO "EmociónPrimaria + EmociónSecundaria · X/5" (ej. "Hartazgo + Desprotección · 4/5").
  · "narrativa" es una frase corta que resume el sentir ciudadano (irá entrecomillada en la plantilla, no la entrecomilles tú).
  · "politica" (etiqueta en pantalla: "Potencial") describe el riesgo/potencial de movilización concreto (ej. "Movilización sectorial recurrente — riesgo de bloqueos en temporada de estiaje"), nunca genérico tipo "riesgo alto".
  · "evidencia" es OBLIGATORIO: un párrafo con 2-4 datos verificables (cifras, fechas, nombres de colonias) rematando cada dato con la fuente entre paréntesis, ej: "Corte de hasta 96h en mayo por rehabilitación planta Tezontle y acueducto Tizayuca (La Silla Rota, ICF 4.3) - Colonias Carboneras, El Saucillo... (ICF 4.0)". Encadena 2-3 datos con guiones " - " como en el ejemplo, no lo dejes en una sola oración vaga.
  · "lecturaEstrategica" es OBLIGATORIO en las 8-10 tensiones (no solo en la primera): 50-90 palabras conectando ESTA tensión con el panorama regional/histórico más amplio, con otra(s) tensión(es) del mismo ranking, o con la respuesta institucional — nunca repitas el contenido de "evidencia", esto es interpretación, no hechos.
  · "recomendacion" debe ser una acción específica y ejecutable en el corto plazo, no un consejo genérico.

- emociones: 6-8 emociones (ej. Hartazgo, Indignación, Desconfianza, Miedo, Ansiedad, Resignación, Esperanza — usa las que apliquen al territorio), cada una con:
  · "descripcion": una línea que explique el TIPO de la emoción (estructural/coyuntural/en descenso/sostenida) y su origen.
  · "intensidad" en escala 1-5, VARIADA entre emociones (no todas en 4-5).
  · "tendencia" y "tendenciaDesc" en TODAS las emociones (para el cuadro "Evolución vs. periodo anterior") — la flecha (↑/↓/—) debe ser coherente con la palabra que sigue.

- lecturaPoliticaEmociones: un objeto por cada emoción de "emociones" (mismo "nombre" y "color" EXACTOS), para el cuadro "Lectura política estratégica". Cada "texto" (35-60 palabras) debe mencionar explícitamente el "porcentaje" de esa emoción (el mismo número que aparece en la gráfica de dona) y su "intensidad" (X/5), y explicar el mecanismo político específico de ESA emoción — nunca una definición genérica ni repetir literalmente lo ya dicho en "descripcion" de esa misma emoción.

- narrativaMadreSintesis: OBLIGATORIA — "texto" es la síntesis narrativa MÁS AMPLIA del periodo (conecta TODAS las tensiones, no solo 2), "descripcion" explica el hilo común. Debe ser claramente distinta de "cartografiaSocioafectiva.narrativaMadre" (esa es la lectura por segmento social; esta es la lectura institucional/general).

- narrativas: 8-10, cada una con "politica" (impacto/potencial político específico, no genérico), "potencial" (número 0-100, con variación real entre narrativas, ordenable de mayor a menor) y "fuente" (medio + rango de fechas).

- territorios: 8-10 zonas/colonias específicas (nunca el municipio genérico completo), cada una con:
  · "color": "Rojo" (crítico), "Naranja" (alto) o "Amarillo" (medio) según severidad — este color YA marca el nivel de sensibilidad, es obligatorio y debe ser coherente con la gravedad real del texto.
  · "observaciones": párrafo de 40-70 palabras (no una línea) con el acontecimiento específico narrado con hora/fecha si existe, actores involucrados, y AL MENOS una cifra concreta con fuente entre paréntesis.

- riesgos: 8-10, EN EL MISMO ORDEN Y CANTIDAD que las tensiones del ranking, cada uno con "actorExpuesto", "tipoSenal" y "probEscalar" llenos, "accion" (qué hacer) Y "consecuencia" (qué pasa si no se hace, 30-60 palabras) ambos obligatorios y claramente diferenciados entre sí.

- trayectoriaLabels: EXACTAMENTE tantos elementos como columnas mensuales tenga la ventana de análisis real (mínimo 4, típicamente 5), con los NOMBRES REALES de esos periodos (ej. "Mayo","Junio","Julio","Agosto","Sept (corte 14)") — nunca "Periodo 1"/"T-3" genéricos.
- trayectoria: DEBE cubrir las MISMAS 8-10 tensiones que aparecen en "ranking" (mismos nombres, mismo orden). "valores" debe tener EXACTAMENTE el mismo número de elementos que "trayectoriaLabels", en el mismo orden cronológico. "ta" = último elemento de "valores" y DEBE coincidir con el "score" de esa tensión en "ranking". "delta" = ta - valores[0], con signo (+/-).

- aprobacion: "cortes" normalmente tiene 1 solo elemento (dato real verificado, no interpolado) salvo que las fuentes den más de un corte real — NUNCA inventes cortes intermedios solo para rellenar la gráfica. "nota" debe explicar cuántos cortes hay y por qué no se interpolan los demás meses.

- alertas: 8-10 alertas, y cada alerta debe ser MUY explicativa: usa estas filas en "rows" como mínimo (adapta la etiqueta si hace falta, pero cubre el fondo): "Territorio", "Emoción" (con intensidad X/5), "Actor expuesto", "Qué ocurrió" (párrafo de 40-80 palabras con fecha y hechos concretos, incluyendo cualquier comentario o reacción real de medios/redes sociales presente en las fuentes crudas), "Narrativa activa", "Riesgo" (nivel + contexto), "Qué puede pasar" (proyección concreta de escalamiento), "Acción inmediata" (específica, no genérica). Mínimo 8 rows por alerta.

- hallazgoEmocional y hallazgoTrayectoria: párrafos de 80-140 palabras con razonamiento estratégico específico (no una frase suelta) — ejemplo de la profundidad esperada: explicar POR QUÉ el patrón importa políticamente y qué lo hace distinto a otros casos (ej. "hartazgo distribuido en varios frentes es más difícil de gestionar comunicacionalmente que una crisis única con un solo culpable simbólico").

REQUISITOS MÍNIMOS — cartografiaSocioafectiva (pestañas "Radiografía y dolores", "Enemigos y segmentación", "Narrativas y 9 preguntas"):
- iasPorZona: 6-8 zonas/corredores específicos del territorio (nunca el municipio genérico), "ias" 0-100 con variación real entre zonas (no todas en el mismo rango).
- dolores: 6-8 frases de dolor social, cada una anclada en un hecho o patrón real documentado en "meta" (quién lo vive, evidencia).
- enemigosSimbolicos: 4-6 elementos — a quién o qué culpa la ciudadanía de forma simbólica, con "descripcion" de 50-90 palabras (no una o dos líneas): explica POR QUÉ se le atribuye esa culpa, con evidencia concreta (hecho, fecha, cifra) y qué representa simbólicamente para la comunidad.
- fracturasSociales: 4-6 divisiones sociales reales y específicas del territorio (nunca genéricas tipo "ricos contra pobres" sin contexto local), con "descripcion" de 50-90 palabras: entre qué dos polos específicos corre la fractura, con evidencia concreta de ambos lados.
- segmentacion: 6-8 segmentos sociales/económicos específicos (comerciantes, familias de una colonia, gremio, militancia de un partido, etc.), cada uno con "emocionDominante" y "detonante" concreto y fechado.
- narrativaMadre/narrativaMadreDesc: debe ser DISTINTA a "narrativaMadreSintesis" — agrupa la vivencia emocional por segmento, no el discurso institucional.
- narrativas (dentro de cartografiaSocioafectiva): 6-8 narrativas propias de esta cartografía, mismo nivel de detalle que las narrativas generales de tensiones. "potencial" debe ser un párrafo (no una etiqueta) de 25-45 palabras describiendo específicamente su alcance de propagación (si ya circula, en qué círculo, con qué velocidad) y, cuando las fuentes lo permitan, mencionar un comentario o reacción real de medios/redes sociales que la ejemplifique; "fuente" siempre presente (medio + fecha aproximada).
- preguntas: EXACTAMENTE 9 pares pregunta/respuesta — diagnóstico ejecutivo completo (qué pasa, por qué, quién gana/pierde emocionalmente, qué hacer, qué NO hacer, ventana de tiempo, riesgo si no se actúa, activo desaprovechado, recomendación final). Cada "respuesta" debe ser un párrafo ejecutivo de 80-130 palabras (nunca 2-4 líneas cortas), con al menos un dato o hecho concreto del territorio que la sustente.`,

  opositor: `
REQUISITOS MÍNIMOS DE CANTIDAD (OPOSITOR · parte 1) — no entregues menos de esto:
- alertas: mínimo 8 (4 por adversario), cada una de 25-50 palabras con dato duro (cifra, fecha, medio).
- recomendaciones: mínimo 5, cada una de 20-40 palabras.
- perfiles: 2 perfiles con mínimo 7 filas cada uno.
- ier: mínimo 4 (2+ por adversario), "promesa" 15-30 palabras, "resultado" 20-45 palabras con cifra/fecha/fuente.
- contradicciones: mínimo 8 (4+ por adversario), "descripcion" 40-70 palabras.
- vulnerabilidades: mínimo 10 (5+ por adversario).
- red: mínimo 10 (5+ por adversario). implicaciones: mínimo 3 por adversario.`,

  opositor2: `
REQUISITOS MÍNIMOS DE CANTIDAD (OPOSITOR · parte 2) — no entregues menos de esto:
- narrativa: 2 (a y b), cada uno con mínimo 3 fortalezas y 3 debilidades.
- disc: 2 (a y b), todos los campos llenos.
- digital: mínimo 6 indicadores.
- vectores: mínimo 8 (4+ por adversario), con verificación 6E completa.
- defensa: mínimo 5.
- comparativo: mínimo 8 dimensiones. indicadores9C: mínimo 5.
- diagnostico9B: los 4 campos llenos (25-45 palabras cada uno).
- bolsillo: 2 tarjetas completas (3 ataques previsibles + 3 ataques propios cada una).
- changelog.activadores: mínimo 5.`,

  sesgo: `
REQUISITOS MÍNIMOS DE CANTIDAD (SESGO) — no entregues menos de esto:
- ranking: mínimo 8, ideal hasta 14, cubriendo al menos 5 de las 8 categorías (I-VIII) del catálogo de referencia. Scores variados y realistas (no todos en el mismo rango).
- segmentos: mínimo 4 perfiles de electorado distintos (ver instrucciones de estructura), cada uno con "lectura" de 20-40 palabras.
- ventanasPersuasion: mínimo 4, cada "recomendacion" de 25-50 palabras, concreta y accionable.
- arquitecturaMensajes: mínimo 4, cubriendo al menos 3 etiquetas distintas, cada "texto" de 25-50 palabras con canal/táctica concreta.
- metricas: los 4 indicadores (sesgosCriticos, sesgosAltos, sri, sistemaDominante) siempre con "detalle" lleno (nunca vacío) y consistentes con el "ranking" (ver instrucciones de estructura).
- resumenEjecutivo: 80-140 palabras, mencionando el sesgo más crítico, el segmento más persuadible y el riesgo cognitivo (SRI) para el actor/partido en el poder.`,

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

};

// =========================================================
// TENSIONES EN DOS LLAMADAS
// El JSON de Tensiones es enorme (8-10 elementos en 9 listas + la
// cartografía socioafectiva). Con el tope de salida del modelo, la
// cartografía (que va al final) llegaba cortada o vacía. Por eso se
// separa: la llamada 1 genera todo Tensiones SIN cartografía y la
// llamada 2 genera SOLO "cartografiaSocioafectiva", recibiendo como
// contexto el ranking/emociones/territorios de la llamada 1.
// =========================================================
{
  const t = JSON.parse(SCHEMAS.tensiones);
  SCHEMAS.tensionesCartografia = JSON.stringify({ cartografiaSocioafectiva: t.cartografiaSocioafectiva }, null, 2);
  delete t.cartografiaSocioafectiva;
  SCHEMAS.tensiones = JSON.stringify(t, null, 2);

  const req = REQUISITOS_MINIMOS.tensiones;
  const corte = req.indexOf('REQUISITOS MÍNIMOS — cartografiaSocioafectiva');
  if (corte > 0) {
    REQUISITOS_MINIMOS.tensionesCartografia = '\n' + req.slice(corte);
    REQUISITOS_MINIMOS.tensiones = req.slice(0, corte)
      .replace(/REGLA ANTI-CORTE[^\n]*\n/, 'REGLA ANTI-CORTE (OBLIGATORIA): este reporte tiene MUCHOS campos. Está PROHIBIDO dejar sin generar o vacíos los campos finales del JSON ("alertas", "hallazgoEmocional", "hallazgoTrayectoria", "resumenEjecutivo"). Si necesitas espacio, acorta párrafos, pero NUNCA omitas elementos ni listas.\n');
  }
}

// Resumen compacto de la llamada 1 para que la cartografía (llamada 2) use
// los mismos nombres de tensiones, emociones y zonas.
function resumenTensionesParaCartografia(p1) {
  if (!p1 || typeof p1 !== 'object') return '';
  const lista = (arr, f) => (Array.isArray(arr) ? arr : []).map(f).filter(Boolean).slice(0, 10);
  const partes = [];
  const rk = lista(p1.ranking, r => r && r.nombre ? `- ${r.nombre} (score ${r.score ?? '?'}; ${r.emocion || ''}; territorio: ${r.territorio || ''}; actor: ${r.actor || ''})` : '');
  if (rk.length) partes.push('Ranking de tensiones (usa ESTOS nombres en "tensionDominante"):\n' + rk.join('\n'));
  const em = lista(p1.emociones, e => e && e.nombre ? `${e.nombre} (${e.porcentaje ?? e.intensidad ?? ''})` : '');
  if (em.length) partes.push('Emociones detectadas: ' + em.join(', '));
  const te = lista(p1.territorios, z => z && z.nombre ? `${z.nombre} — ${z.tension || ''} (${z.color || ''})` : '');
  if (te.length) partes.push('Territorios sensibles:\n- ' + te.join('\n- '));
  const nm = p1.narrativaMadreSintesis && p1.narrativaMadreSintesis.texto;
  if (nm) partes.push(`Narrativa madre de TENSIONES (la tuya debe ser DISTINTA): ${nm}`);
  const na = lista(p1.narrativas, n => n && n.nombre ? n.nombre : '');
  if (na.length) partes.push('Narrativas institucionales ya usadas en Tensiones (no las repitas tal cual): ' + na.join(' | '));
  return partes.join('\n\n');
}

function resumirFuentes(bloque) {
  if (!bloque || !bloque.items || bloque.items.length === 0) {
    return '(No se obtuvieron resultados directos de scraping en vivo; genera el análisis basándote en conocimiento experto del contexto político mexicano respetando estrictamente el esquema JSON proporcionado.)';
  }
  return bloque.items
    .slice(0, 90)
    .map(i => `[${i.fuente}${i.fecha ? ' · ' + String(i.fecha).slice(0, 10) : ''}] ${i.texto.slice(0, 280)}`)
    .join('\n');
}

// Repara un JSON cortado por el tope de tokens de salida: recorta hasta el
// último valor completo y cierra los corchetes/llaves que quedaron abiertos.
// Así se conserva todo lo que el modelo alcanzó a generar en vez de perder
// el análisis completo por un JSON incompleto.
function repararJSONCortado(txt) {
  const s = String(txt || '');
  const ini = s.indexOf('{');
  if (ini < 0) return null;
  const pila = [];
  let enCadena = false, escape = false, ultimoCorte = -1, pilaEnCorte = [];
  for (let k = ini; k < s.length; k++) {
    const c = s[k];
    if (enCadena) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') { enCadena = true; continue; }
    if (c === '{' || c === '[') pila.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      pila.pop();
      ultimoCorte = k + 1; pilaEnCorte = pila.slice();
      if (!pila.length) return s.slice(ini, k + 1); // JSON completo
    } else if (c === ',') {
      ultimoCorte = k; pilaEnCorte = pila.slice(); // antes de la coma: valor previo completo
    }
  }
  if (ultimoCorte < 0) return null;
  return s.slice(ini, ultimoCorte) + pilaEnCorte.slice().reverse().join('');
}

async function callOpenRouter({ system, user }, apiKey, intentos = 2) {
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
  let ultimoError;

  for (let intento = 1; intento <= intentos; intento++) {
    try {
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
          max_tokens: 28000,
          response_format: { type: 'json_object' },
        }),
      });

      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        const err = new Error(`OpenRouter respondió HTTP ${r.status}: ${errText.slice(0, 300)}`);
        // 400/401/402/403: error de configuración (llave, créditos, modelo) -> no tiene caso reintentar.
        if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) throw Object.assign(err, { definitivo: true });
        throw err;
      }

      const data = await r.json();
      if (data && data.error) throw new Error(`OpenRouter devolvió un error: ${JSON.stringify(data.error).slice(0, 300)}`);
      const choice = data?.choices?.[0] || {};
      const raw = choice?.message?.content || '';
      if (!raw.trim()) throw new Error(`OpenRouter devolvió una respuesta vacía (finish_reason: ${choice.finish_reason || 'desconocido'}).`);
      const clean = raw.replace(/```json|```/g, '').trim();

      try {
        return JSON.parse(clean);
      } catch (e) {
        // Respuesta cortada (finish_reason "length") o con basura al final:
        // se intenta rescatar lo generado.
        const reparado = repararJSONCortado(clean);
        if (reparado) {
          try {
            const obj = JSON.parse(reparado);
            console.warn(`[!] JSON de OpenRouter incompleto (finish_reason: ${choice.finish_reason}); se rescataron ${reparado.length} de ${clean.length} caracteres.`);
            return obj;
          } catch (_) { /* sigue al error */ }
        }
        console.error('[-] JSON inválido de OpenRouter (inicio):', clean.slice(0, 300));
        console.error('[-] JSON inválido de OpenRouter (final):', clean.slice(-300));
        throw new Error(`OpenRouter devolvió un JSON con formato inválido (finish_reason: ${choice.finish_reason || 'desconocido'}).`);
      }
    } catch (e) {
      ultimoError = e;
      console.warn(`[!] callOpenRouter intento ${intento}/${intentos} falló:`, e.message);
      if (e.definitivo) break;
      if (intento < intentos) await new Promise(res => setTimeout(res, 2000));
    }
  }
  throw ultimoError;
}
