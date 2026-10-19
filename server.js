import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { AsyncLocalStorage } from 'async_hooks';
import { createRequire } from 'module';

// Variables del archivo .env (si existe y dotenv está instalado). En Hostinger
// también pueden venir del panel; si dotenv no está, el servidor sigue igual.
// Sin "await" a nivel superior: Hostinger carga este archivo con require().
try { createRequire(import.meta.url)('dotenv').config(); } catch (_) { /* sin .env */ }

// Modelo de IA vigente y registro de gasto por investigación.
const modeloIA = () => (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini').trim();
const GASTO_IA = new AsyncLocalStorage();

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
// Un error no capturado en una promesa (p. ej. una respuesta rara de Apify)
// ya no tumba todo el proceso: se registra y el servidor sigue atendiendo.
process.on('unhandledRejection', (e) => console.error('[!] Promesa rechazada sin capturar:', e && e.stack || e));
process.on('uncaughtException', (e) => console.error('[!] Excepción no capturada:', e && e.stack || e));

const JOBS = new Map(); // jobId -> { status: 'processing'|'done'|'error', result?, error? }
const JOB_TTL_MS = 30 * 60 * 1000; // 30 min, luego se limpia de memoria

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
    actoresReferencia = '',
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
  const clienteName = ['opositor', 'emociones'].includes(skill) ? String(cliente || '').trim() : '';
  // Actores de referencia que el analista conoce (ej. aspirantes 2027 de un
  // municipio). Son la fuente más confiable de nombres: el modelo no conoce a
  // los aspirantes locales recientes y Apify no siempre los trae.
  const actoresRef = (Array.isArray(actoresReferencia) ? actoresReferencia : String(actoresReferencia || '').split(/[,;\n]/))
    .map(a => String(a).trim()).filter(Boolean).slice(0, 8);

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
  GASTO_IA.run({ modelo: modeloIA(), llamadas: 0, entrada: 0, salida: 0, costo: 0 },
    () => procesarAnalisis({ jobId, skill, actorName, actor2Name, actoresNombres, mes, anio, periodo, clienteName, actoresRef, APIFY_TOKEN, OPENROUTER_KEY }));

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

async function procesarAnalisis({ jobId, skill, actorName, actor2Name, actoresNombres, mes, anio, periodo, clienteName = '', actoresRef = [], APIFY_TOKEN, OPENROUTER_KEY }) {
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
        scrapeActor(actorName, APIFY_TOKEN, periodo, { contextoActores: ['emociones', 'tensiones', 'sesgo', 'radar'].includes(skill) }),
        actor2Name ? scrapeActor(actor2Name, APIFY_TOKEN, periodo) : Promise.resolve(null),
      ]);
    }

    JOBS.set(jobId, { status: 'processing', progreso: `Estructurando datos con ${modeloIA()} (OpenRouter)...` });

    // 2. Estructuración con OpenRouter
    let structured;
    let basePartes = null;
    if (skill === 'opositor') {
      // Opositor (2 adversarios + cliente) genera un JSON muy grande: se pide
      // en DOS llamadas en paralelo (parte 1 y parte 2) para que el tope de
      // tokens de salida del modelo no corte las últimas pestañas.
      const base = { skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, periodo, clienteName, actoresRef, datosActor1, datosActor2 };
      const [p1, p2] = await Promise.all([
        callOpenRouter(buildPrompt({ ...base, schema: SCHEMAS.opositor, parteOpositor: 1 }), OPENROUTER_KEY),
        callOpenRouter(buildPrompt({ ...base, schema: SCHEMAS.opositor2, parteOpositor: 2 }), OPENROUTER_KEY),
      ]);
      structured = { ...(p2 || {}), ...(p1 || {}) };
    } else if (skill === 'radar') {
      // RADAR v2.1: la parte A (encabezado, KPIs, sentimiento, top of mind y
      // picos) va primero; B (plataformas, nube, narrativas, cruces) y C
      // (riesgos, territorial, módulos, conclusión) van en paralelo después,
      // con los nombres de grupos, temas y nivel de alerta de la parte A para
      // que todas las pestañas usen los mismos segmentos.
      const base = { skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, periodo, clienteName, actoresRef, datosActor1, datosActor2 };
      basePartes = base;
      const pA = await callOpenRouter(buildPrompt({ ...base, schema: subEsquema(skill, null, 'A'), parteEmociones: 'A' }), OPENROUTER_KEY)
        .catch(e => { console.warn('[!] radar parte A falló:', e.message); return {}; });
      JOBS.set(jobId, { status: 'processing', progreso: 'Generando plataformas, narrativas, cruces, riesgos, territorial y conclusión...' });
      const ctxA = resumenRadarParaPartes(pA);
      const [pB, pC] = await Promise.all([
        callOpenRouter(buildPrompt({ ...base, schema: subEsquema(skill, PARTES_B[skill]), parteEmociones: 'B', contextoTensiones: ctxA }), OPENROUTER_KEY)
          .catch(e => { console.warn('[!] radar parte B falló:', e.message); return {}; }),
        callOpenRouter(buildPrompt({ ...base, schema: subEsquema(skill, PARTES_C[skill]), parteEmociones: 'C', contextoTensiones: ctxA }), OPENROUTER_KEY)
          .catch(e => { console.warn('[!] radar parte C falló:', e.message); return {}; }),
      ]);
      structured = { ...(pA || {}), ...(pB || {}), ...(pC || {}) };
      JOBS.set(jobId, { status: 'processing', progreso: 'Verificando que todas las pestañas tengan datos...' });
      structured = await completarFaltantes(skill, structured, base, OPENROUTER_KEY);
    } else if (PARTES_B[skill]) {
      // Emociones genera MUCHOS campos; gpt-4o-mini se salta algunos cuando la
      // respuesta es larga (díadas, pregunta política...). Se divide en dos
      // llamadas en paralelo y después se piden solo los campos que faltaron.
      const base = { skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, periodo, clienteName, actoresRef, datosActor1, datosActor2 };
      basePartes = base;
      const [pA, pB, pC] = await Promise.all([
        callOpenRouter(buildPrompt({ ...base, schema: subEsquema(skill, null, 'A'), parteEmociones: 'A' }), OPENROUTER_KEY)
          .catch(e => { console.warn(`[!] ${skill} parte A falló:`, e.message); return {}; }),
        callOpenRouter(buildPrompt({ ...base, schema: subEsquema(skill, PARTES_B[skill]), parteEmociones: 'B' }), OPENROUTER_KEY)
          .catch(e => { console.warn(`[!] ${skill} parte B falló:`, e.message); return {}; }),
        PARTES_C[skill]
          ? callOpenRouter(buildPrompt({ ...base, schema: subEsquema(skill, PARTES_C[skill]), parteEmociones: 'C' }), OPENROUTER_KEY)
            .catch(e => { console.warn(`[!] ${skill} parte C falló:`, e.message); return {}; })
          : Promise.resolve({}),
      ]);
      structured = { ...(pA || {}), ...(pB || {}), ...(pC || {}) };
      JOBS.set(jobId, { status: 'processing', progreso: 'Verificando que todas las pestañas tengan datos...' });
      structured = await completarFaltantes(skill, structured, base, OPENROUTER_KEY);
    } else if (skill === 'tensiones') {
      const base = { skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, periodo, clienteName, actoresRef, datosActor1, datosActor2 };
      basePartes = base;
      const p1 = await callOpenRouter(buildPrompt({ ...base, schema: SCHEMAS.tensiones, parteTensiones: 1 }), OPENROUTER_KEY);
      JOBS.set(jobId, { status: 'processing', progreso: 'Generando dolores, enemigos, fracturas, segmentación y las 9 preguntas...' });
      const promptCarto = buildPrompt({ ...base, schema: SCHEMAS.tensionesCartografia, parteTensiones: 2, contextoTensiones: resumenTensionesParaCartografia(p1) });
      let carto = null, mejorParcial = null, mejorPuntaje = 0;
      const LISTAS_CARTO = ['dolores', 'enemigos', 'fracturas', 'segmentos', 'preguntas'];
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
      structured = { ...(p1 || {}), ...(carto || {}) };
      JOBS.set(jobId, { status: 'processing', progreso: 'Verificando que todas las pestañas tengan datos...' });
      structured = await completarFaltantes(skill, structured, base, OPENROUTER_KEY);
    } else {
      const schema = SCHEMAS[skill] || SCHEMAS.radar;
      const prompt = buildPrompt({ skill, actorName, actor2Name, actoresNombres: listaActores, datosPorActor, mes, anio, periodo, clienteName, actoresRef, datosActor1, datosActor2, schema });
      structured = await callOpenRouter(prompt, OPENROUTER_KEY);
    }

    // 3. Normalizar respuesta para asegurar que todos los arrays existan
    const ctxNorm = { actorName, actor2Name, actoresNombres: listaActores, clienteName, periodo };
    const copia = (o) => JSON.parse(JSON.stringify(o || {}));
    let normalized = normalizeResponse(copia(structured), skill, ctxNorm);
    // Emociones: si después de limpiar algo quedó vacío o en ceros, se pide de nuevo.
    if (CHEQUEOS_POST[skill] && basePartes) {
      const post = CHEQUEOS_POST[skill];
      const chequeos = Object.fromEntries(Object.keys(post).map(k => [k, () => post[k](normalized)]));
      if (Object.keys(chequeos).some(k => { try { return !chequeos[k](); } catch (_) { return true; } })) {
        JOBS.set(jobId, { status: 'processing', progreso: 'Completando las pestañas que quedaron incompletas...' });
        structured = await completarFaltantes(skill, structured, basePartes, OPENROUTER_KEY, chequeos);
        normalized = normalizeResponse(copia(structured), skill, ctxNorm);
      }
    }

    // Emociones: verificación de actores contra las fuentes reales (ver
    // verificarActoresEmociones). Evita figuras que el modelo "trae de memoria"
    // y que no tienen relación con el territorio analizado.
    // RADAR: el pie de página lista fuentes REALES (URLs efectivamente
    // scrapeadas), nunca enlaces generados por el modelo.
    if (skill === 'radar') normalized.fuentes = fuentesReales(datosActor1, 20);

    if (skill === 'emociones') verificarActoresEmociones(normalized, { territorio: actorName, fuentes: datosActor1, actoresRef });

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
        ia: (g => g ? { modelo: g.modelo, llamadas: g.llamadas, tokensEntrada: g.entrada, tokensSalida: g.salida, costoUSD: Math.round(g.costo * 10000) / 10000 } : undefined)(GASTO_IA.getStore()),
        data: normalized,
      },
    });
    { const g = GASTO_IA.getStore(); if (g) console.log(`[IA] Job ${jobId} (${skill}) terminado con ${g.modelo}: ${g.llamadas} llamadas · ${g.entrada} tokens de entrada · ${g.salida} de salida · costo total $${g.costo.toFixed(4)} USD`); }
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

function construirPeriodoBase(params = {}) {
  const tipo = ['mes', 'rango', 'semana', 'personalizado'].includes(params.periodoTipo) ? params.periodoTipo : 'mes';
  const anio = parseInt(params.anio, 10) || 2026;

  if (tipo === 'personalizado') {
    const ini = new Date(`${params.fechaInicio || ''}T00:00:00Z`);
    const fin = new Date(`${params.fechaFin || ''}T00:00:00Z`);
    if (isNaN(ini) || isNaN(fin)) throw new Error('Selecciona la fecha inicial y la fecha final del periodo.');
    if (fin < ini) throw new Error('La fecha final no puede ser anterior a la fecha inicial.');
    const dias = Math.round((fin - ini) / 86400000) + 1;
    if (dias > 731) throw new Error('El periodo personalizado máximo es de 2 años.');
    const f = (d, conAnio) => `${d.getUTCDate()} ${MESES_CORTOS[d.getUTCMonth()]}${conAnio ? ' ' + d.getUTCFullYear() : ''}`;
    const label = dias === 1 ? `${f(ini, true)}` : `Del ${f(ini, ini.getUTCFullYear() !== fin.getUTCFullYear())} al ${f(fin, true)}`;
    const ventanas = (n) => { // parte el periodo en ventanas de n días
      const out = [];
      for (let t = ini.getTime(), k = 1; t <= fin.getTime(); t += n * 86400000, k++) {
        const a = new Date(t), b = new Date(Math.min(t + (n - 1) * 86400000, fin.getTime()));
        out.push({ a, b, txt: n === 1 ? f(a) : (a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${MESES_CORTOS[b.getUTCMonth()]}` : `${f(a)}–${f(b)}`) });
      }
      return out;
    };
    let cortes, cortesRadar, unidad, pref;
    if (dias <= 14) { cortes = ventanas(1).map(v => v.txt); unidad = 'DIARIOS'; pref = 'D'; }
    else if (dias <= 62) { cortes = ventanas(7).map(v => v.txt); unidad = 'SEMANALES'; pref = 'S'; }
    else {
      cortes = [];
      for (let t = ini.getUTCFullYear() * 12 + ini.getUTCMonth(); t <= fin.getUTCFullYear() * 12 + fin.getUTCMonth(); t++) cortes.push(ini.getUTCFullYear() === fin.getUTCFullYear() ? MESES[t % 12] : `${MESES_CORTOS[t % 12]} ${Math.floor(t / 12)}`);
      unidad = 'MENSUALES'; pref = 'Q';
    }
    // Radar (picos): días si ≤14, semanas si ≤62, quincenas (máx. 24) si es más largo.
    if (pref === 'Q') {
      // quincenas de calendario (1–15 y 16–fin de mes) recortadas al periodo; si son más de 24, cortes mensuales
      const qs = [];
      for (let t = ini.getUTCFullYear() * 12 + ini.getUTCMonth(); t <= fin.getUTCFullYear() * 12 + fin.getUTCMonth(); t++) {
        const y = Math.floor(t / 12), m = t % 12, ult = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        [[1, 15], [16, ult]].forEach(([d1, d2]) => {
          const a = new Date(Math.max(Date.UTC(y, m, d1), ini.getTime())), b = new Date(Math.min(Date.UTC(y, m, d2), fin.getTime()));
          if (a <= b) qs.push(a.getUTCDate() === b.getUTCDate() ? f(a) : `${a.getUTCDate()}–${b.getUTCDate()} ${MESES_CORTOS[m]}`);
        });
      }
      cortesRadar = qs.length <= 24 ? qs.map((q, i) => `Q${i + 1} (${q})`) : cortes.map((c, i) => `M${i + 1} (${c})`);
    }
    else cortesRadar = (pref === 'D' ? ventanas(1) : ventanas(7)).map((v, i) => `${pref}${i + 1} (${v.txt})`);
    return {
      tipo, label, desde: isoFecha(ini), hasta: isoFecha(fin), cortes, dias,
      mes: MESES[ini.getUTCMonth()], anio: String(ini.getUTCFullYear()),
      instruccion: `El periodo es PERSONALIZADO: ${label} (${dias} días, del ${isoFecha(ini)} al ${isoFecha(fin)}). Todo hallazgo, cifra y serie temporal debe referirse a esas fechas; lo anterior es solo antecedente/contexto. Las series de tendencia usan cortes ${unidad}: ${cortes.join(', ')}. En Radar, "quincenas" debe traer EXACTAMENTE un elemento por cada uno de estos cortes, con ese "codigo" y ese "rango": ${cortesRadar.join(', ')}.`,
    };
  }

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

// Cortes de la gráfica/tabla de TRAYECTORIA (Tensiones): siempre varios
// puntos para que la gráfica muestre una línea de evolución, no un punto.
//  - mes:    los 4 meses anteriores + el mes elegido (5 cortes)
//  - rango:  cada mes del rango (si el rango tiene 1 mes, como "mes")
//  - semana: las 4 semanas anteriores + la semana elegida (5 cortes)
function cortesDeTrayectoria(p) {
  if (p.tipo === 'semana') {
    const fin = new Date(`${p.desde}T00:00:00Z`);
    const out = [];
    for (let k = 4; k >= 0; k--) {
      const a = new Date(fin.getTime() - k * 7 * 86400000), b = new Date(a.getTime() + 6 * 86400000);
      out.push(a.getUTCMonth() === b.getUTCMonth()
        ? `${a.getUTCDate()}–${b.getUTCDate()} ${MESES_CORTOS[b.getUTCMonth()]}`
        : `${a.getUTCDate()} ${MESES_CORTOS[a.getUTCMonth()]}–${b.getUTCDate()} ${MESES_CORTOS[b.getUTCMonth()]}`);
    }
    out[out.length - 1] += ' (periodo)';
    return out;
  }
  if (p.tipo === 'personalizado') {
    if (p.dias > 62 && Array.isArray(p.cortes) && p.cortes.length >= 2) return p.cortes.slice();
    // periodo corto: 4 ventanas anteriores de la misma duración + el periodo
    const ini = new Date(`${p.desde}T00:00:00Z`), d = p.dias || 7, out = [];
    const f = (x) => `${x.getUTCDate()} ${MESES_CORTOS[x.getUTCMonth()]}`;
    for (let k = 4; k >= 0; k--) {
      const a = new Date(ini.getTime() - k * d * 86400000), b = new Date(a.getTime() + (d - 1) * 86400000);
      out.push(d === 1 ? f(a) : (a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${MESES_CORTOS[b.getUTCMonth()]}` : `${f(a)}–${f(b)}`));
    }
    out[out.length - 1] += ' (periodo)';
    return out;
  }
  if (p.tipo === 'rango' && Array.isArray(p.cortes) && p.cortes.length >= 2) return p.cortes.slice();
  const [y, mo] = p.desde.split('-').map(Number);
  const total = y * 12 + (mo - 1);
  const cruzaAnio = Math.floor((total - 4) / 12) !== Math.floor(total / 12);
  const out = [];
  for (let t = total - 4; t <= total; t++) {
    const a = Math.floor(t / 12), m = t % 12;
    out.push(cruzaAnio ? `${MESES_CORTOS[m]} ${a}` : MESES[m]);
  }
  return out;
}

function construirPeriodo(params = {}) {
  const p = construirPeriodoBase(params);
  p.cortesTrayectoria = cortesDeTrayectoria(p);
  p.instruccion += ` TRAYECTORIA (Tensiones): "trayectoriaLabels" debe ser EXACTAMENTE ${JSON.stringify(p.cortesTrayectoria)} (${p.cortesTrayectoria.length} cortes; los anteriores al periodo son contexto de comparación) y cada "trayectoria[].valores" debe traer EXACTAMENTE ${p.cortesTrayectoria.length} números (uno por corte, en ese orden), con el último igual al "score" del ranking.`;
  return p;
}

// =========================================================
// VERIFICACIÓN DE ACTORES (Emociones)
// Un actor solo se acepta si:
//   a) lo indicó el analista en "Actores de referencia", o
//   b) su nombre aparece en alguna fuente scrapeada que TAMBIÉN menciona el
//      territorio/persona buscado (co-ocurrencia).
// Si el analista dio actores de referencia, las tarjetas son exactamente esos
// actores (en ese orden); los que el modelo agregó por su cuenta se quitan.
// =========================================================
const normTxt = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP_NOMBRE = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'san', 'santa']);
const tokensNombre = (n) => normTxt(n).split(' ').filter(w => w.length > 2 && !STOP_NOMBRE.has(w));

function nombreCoincide(nombre, texto) {
  const tk = tokensNombre(nombre);
  if (!tk.length) return false;
  const t = ' ' + texto + ' ';
  const presentes = tk.filter(w => t.includes(' ' + w + ' ')).length;
  return tk.length === 1 ? presentes === 1 : presentes >= 2;
}

function verificarActoresEmociones(data, { territorio, fuentes, actoresRef = [] }) {
  if (!data || !Array.isArray(data.actores)) return;
  const textos = ((fuentes && fuentes.items) || []).map(i => normTxt(i.texto));
  const terr = tokensNombre(territorio);
  const mencionaTerritorio = (t) => terr.length && terr.some(w => (' ' + t + ' ').includes(' ' + w + ' '));
  const verificado = (nombre) => textos.some(t => mencionaTerritorio(t) && nombreCoincide(nombre, t));
  const esRef = (nombre) => actoresRef.some(r => nombreCoincide(r, normTxt(nombre)) || nombreCoincide(nombre, normTxt(r)));
  const PAL = ['#C9980A', '#2563eb', '#9d1c3a', '#16a34a', '#7c3aed', '#0891b2'];

  const modelo = data.actores.filter(a => a && a.name);
  const verificados = modelo.filter(a => verificado(a.name));
  const descartados = modelo.filter(a => !verificado(a.name) && !esRef(a.name)).map(a => a.name);
  let actores = [];
  // 1) Primero los actores de referencia del analista (con lo que el modelo escribió de cada uno).
  actoresRef.forEach((ref, i) => {
    const delModelo = modelo.find(a => nombreCoincide(ref, normTxt(a.name)) || nombreCoincide(a.name, normTxt(ref)));
    actores.push(delModelo
      ? { ...delModelo, name: ref }
      : { name: ref, role: 'Actor de referencia indicado por el analista', rows: [['Nota', 'Sin información suficiente en las fuentes del periodo para este actor.']], borderColor: PAL[i % PAL.length] });
  });
  // 2) Después, los actores del modelo que SÍ aparecen en fuentes del territorio (hasta 4 tarjetas en total).
  verificados.forEach(a => {
    if (actores.length >= Math.max(8, actoresRef.length)) return;
    if (!actores.some(x => nombreCoincide(x.name, normTxt(a.name)) || nombreCoincide(a.name, normTxt(x.name)))) actores.push(a);
  });
  if (descartados.length) console.warn('[!] Actores descartados por no aparecer en fuentes del territorio:', descartados.join(', '));
  // 3) Si no quedó ninguno, se conservan los del modelo pero marcados, para no dejar la pestaña vacía.
  if (!actores.length) actores = modelo.map(a => ({ ...a, role: `${a.role || ''} · [NO VERIFICADO en fuentes]`.replace(/^ · /, '') }));
  data.actores = actores;

  // Radar alineado con las tarjetas finales.
  const tk = (t) => normTxt(String(t || '').replace(/\(.*?\)/g, ' ')).split(' ').filter(w => w.length > 2 && !STOP_NOMBRE.has(w));
  const mismoActor = (etq, nombre) => { const a = tk(etq), b = new Set(tk(nombre)); const comun = a.filter(w => b.has(w)); return comun.length >= 2 || comun.some(w => w.length >= 5); };
  // Lectura arquetípica: solo filas de actores que quedaron en las tarjetas.
  if (Array.isArray(data.arqActores) && data.arqActores.length) {
    const fil = data.arqActores.filter(r => actores.some(a => nombreCoincide(a.name, normTxt(r[0])) || nombreCoincide(String(r[0]).replace(/\(.*?\)/g, ''), normTxt(a.name)) || mismoActor(r[0], a.name)));
    if (fil.length) data.arqActores = fil;
  }
  // Radar: se respetan las series del modelo (con sus etiquetas cortas, p. ej. "Ale Castro (PRI)")
  // que correspondan a un actor de las tarjetas; si ninguna corresponde, se arma con las tarjetas.
  const ar = data.actoresRadar || {};
  const clamp6 = (fila) => Array.from({ length: 6 }, (_, k) => Math.max(0, Math.min(100, Number((fila || [])[k]) || 0)));
  const usados = new Set();
  const series = (ar.labels || []).map((l, i) => {
    const j = actores.findIndex((a, k) => !usados.has(k) && mismoActor(l, a.name));
    if (j < 0) return null;
    usados.add(j);
    return { label: String(l), data: clamp6((ar.data || [])[i]), color: (ar.colors || [])[i] || actores[j].borderColor || PAL[j % PAL.length] };
  }).filter(Boolean).slice(0, 6);
  if (series.length) {
    data.actoresRadar = { labels: series.map(x => x.label), data: series.map(x => x.data), colors: series.map(x => x.color) };
  } else {
    const enRadar = actores.slice(0, 6);
    data.actoresRadar = { labels: enRadar.map(a => a.name), colors: enRadar.map((a, i) => a.borderColor || PAL[i % PAL.length]), data: enRadar.map(() => clamp6([])) };
  }
}

// =========================================================
// EMOCIONES EN DOS PARTES + COMPLETAR CAMPOS FALTANTES
// =========================================================
// Skills que se generan en DOS llamadas en paralelo: la parte B son estos
// campos; la parte A es todo lo demás del esquema.
const PARTES_B = {
  emociones: ['preguntaPolitica', 'preguntaDesc', 'govSemaforo', 'partidos', 'partidosChart', 'partidosNote', 'sintesis', 'haidt', 'haidtNote', 'westen', 'westenMeta', 'lakoff', 'lakoffUsar', 'lakoffEvitar', 'transfer', 'transferCliente', 'actores', 'actoresRadar', 'actoresNote', 'encuestasTitulo', 'encuestas', 'encuestasNota', 'tendencia', 'arqActores', 'arqNote'],
  radar: ['plataformas', 'nube', 'hashtags', 'hashtagResumen', 'narrativas', 'cruces'],
};
// Palabras que identifican las reglas (líneas "- ...") de la parte B.
const REGEX_PARTE_B = {
  emociones: /^\s*-\s*"?(preguntaPolitica|preguntaDesc|govSemaforo|partidos|partidosChart|partidosNote|sintesis|haidt|haidtNote|westen|westenMeta|lakoff|lakoffUsar|lakoffEvitar|transfer|transferCliente|actores|actores\.rows|actoresRadar|actoresNote|encuestas|encuestasTitulo|encuestasNota|tendencia|arqActores|arqNote)\b/,
  radar: /^\s*-\s*"?(plataformas|nube|hashtags|hashtagResumen|narrativas|cruces)\b/,
};

// Tercera parte (en paralelo con A y B) para skills muy largas.
const PARTES_C = {
  emociones: ['segIntro', 'segJer', 'segmentos', 'segTabla', 'segTablaNote', 'miedos', 'deseos', 'necesidades'],
  radar: ['riesgos', 'oportunidades', 'alertaSube', 'alertaBaja', 'territorial', 'modulosVariante', 'modulos', 'escenariosHorizonte', 'escenarios', 'dictamen', 'veredicto', 'recomendaciones', 'fuentesTexto', 'fuentesNota'],
};
const REGEX_PARTE_C = {
  emociones: /^\s*-\s*"?(segIntro|segJer|segmentos|segTabla|segTablaNote|miedos|deseos|necesidades)\b/,
  radar: /^\s*-\s*"?(riesgos|oportunidades|alertaSube|alertaBaja|territorial|modulos|modulosVariante|escenarios|escenariosHorizonte|dictamen|veredicto|recomendaciones|fuentesTexto|fuentesNota)\b/,
};
// Reglas generales que van en TODAS las partes.
const REGEX_GENERAL = {
  radar: /^\s*-\s*(Etiquetas de evidencia|NPS-P|Usa los MISMOS|Las cifras de encuestas)/,
};

function subEsquema(skill, campos, parte) {
  const full = skill === 'tensiones' ? { ...JSON.parse(SCHEMAS.tensiones), ...JSON.parse(SCHEMAS.tensionesCartografia) } : JSON.parse(SCHEMAS[skill]);
  const fuera = [...(PARTES_B[skill] || []), ...(PARTES_C[skill] || [])];
  const lista = campos || (parte === 'A' ? Object.keys(full).filter(k => !fuera.includes(k)) : Object.keys(full));
  const sub = {};
  lista.forEach(k => { if (k in full) sub[k] = full[k]; });
  return JSON.stringify(sub, null, 2);
}

// Reglas mínimas por campo: si no se cumplen, el campo se vuelve a pedir.
const largo = (v, n) => String(v || '').trim().length > n;
const CHEQUEOS_FALTANTES = {
  emociones: {
    concept: d => !!String(d.concept || '').trim(),
    conceptDesc: d => String(d.conceptDesc || '').trim().length > 40,
    emotions: d => Array.isArray(d.emotions) && d.emotions.filter(e => e && Number(e.intensity) > 0).length >= 3,
    secondary: d => Array.isArray(d.secondary) && d.secondary.length >= 2,
    problematics: d => Array.isArray(d.problematics) && d.problematics.length >= 4,
    fears: d => Array.isArray(d.fears) && d.fears.length >= 4,
    prides: d => Array.isArray(d.prides) && d.prides.length >= 3,
    quotes: d => Array.isArray(d.quotes) && d.quotes.length >= 4,
    temasChart: d => Array.isArray(d.temasChart) && d.temasChart.length >= 3,
    semaforo: d => Array.isArray(d.semaforo) && d.semaforo.length >= 4,
    dyads: d => Array.isArray(d.dyads) && d.dyads.filter(x => x && x.name && x.text).length >= 3,
    dyadInterp: d => String(d.dyadInterp || '').trim().length > 40,
    preguntaPolitica: d => String(d.preguntaPolitica || '').trim().length > 8,
    preguntaDesc: d => String(d.preguntaDesc || '').trim().length > 40,
    govSemaforo: d => Array.isArray(d.govSemaforo) && d.govSemaforo.length >= 4,
    partidos: d => Array.isArray(d.partidos) && d.partidos.length >= 3,
    actores: d => Array.isArray(d.actores) && d.actores.filter(a => a && (a.name || a.nombre)).length >= 3,
    ive: d => d.ive && Number(d.ive.val ?? d.ive.value) > 0 && Array.isArray(d.ive.parts || d.ive.comps) && (d.ive.parts || d.ive.comps).length >= 3,
    sintesis: d => String(d.sintesis || '').trim().length > 60,
    haidt: d => Array.isArray(d.haidt) && d.haidt.length >= 3,
    westen: d => Array.isArray(d.westen) && d.westen.length >= 3,
    lakoff: d => Array.isArray(d.lakoff) && d.lakoff.length >= 2,
    transfer: d => Array.isArray(d.transfer) && d.transfer.filter(t => t && (t.o || t.origen)).length >= 3,
    transferCliente: d => String(d.transferCliente || '').trim().length > 40,
    codigo: d => String(d.codigo || '').trim().length > 60,
    arqCol: d => Array.isArray(d.arqCol) && d.arqCol.length >= 4,
    arqScores: d => Array.isArray(d.arqScores) && d.arqScores.length >= 6,
    arqIdeal: d => d.arqIdeal && typeof d.arqIdeal === 'object' && !Array.isArray(d.arqIdeal) && String(d.arqIdeal.ganTxt || '').length > 20,
    arqActores: d => Array.isArray(d.arqActores) && d.arqActores.length >= 2,
    segIntro: d => String(d.segIntro || '').trim().length > 40,
    segmentos: d => Array.isArray(d.segmentos) && d.segmentos.filter(x => x && x.nombre && (x.c1 || x.perfil)).length >= 4,
    segTabla: d => Array.isArray(d.segTabla) && d.segTabla.length >= 8,
    miedos: d => Array.isArray(d.miedos) && d.miedos.length >= 8,
    deseos: d => Array.isArray(d.deseos) && d.deseos.length >= 8,
    necesidades: d => Array.isArray(d.necesidades) && d.necesidades.length >= 8,
  },
  tensiones: {
    meta: d => d.meta && typeof d.meta === 'object' && !!String(d.meta.municipio || '').trim(),
    lecturaRadar: d => largo(d.lecturaRadar, 60),
    ranking: d => Array.isArray(d.ranking) && d.ranking.filter(r => r && r.nombre).length >= 5,
    emociones: d => Array.isArray(d.emociones) && d.emociones.filter(e => e && e.nombre).length >= 5,
    hallazgoEmocional: d => largo(d.hallazgoEmocional, 60),
    narrativas: d => Array.isArray(d.narrativas) && d.narrativas.length >= 4,
    territorios: d => Array.isArray(d.territorios) && d.territorios.length >= 4,
    riesgos: d => Array.isArray(d.riesgos) && d.riesgos.length >= 4,
    trayectoria: d => Array.isArray(d.trayectoria) && d.trayectoria.filter(t => t && Array.isArray(t.valores) && t.valores.length >= 2).length >= 4,
    hallazgoTrayectoria: d => largo(d.hallazgoTrayectoria, 60),
    alertas: d => Array.isArray(d.alertas) && d.alertas.filter(a => a && Array.isArray(a.rows) && a.rows.length >= 4).length >= 2,
    dolores: d => Array.isArray(d.dolores) && d.dolores.length >= 4,
    ias: d => d.ias && typeof d.ias === 'object' && Array.isArray(d.ias.componentes) && d.ias.componentes.length >= 3,
    enemigos: d => Array.isArray(d.enemigos) && d.enemigos.length >= 3,
    lecturaEnemigos: d => largo(d.lecturaEnemigos, 40),
    fracturas: d => Array.isArray(d.fracturas) && d.fracturas.length >= 3,
    segmentos: d => Array.isArray(d.segmentos) && d.segmentos.filter(x => x && x.nombre).length >= 4,
    hallazgoSegmentacion: d => largo(d.hallazgoSegmentacion, 40),
    preguntas: d => Array.isArray(d.preguntas) && d.preguntas.filter(q => q && (q.respuesta || q.r)).length >= 7,
  },
  radar: {
    meta: d => d.meta && typeof d.meta === 'object' && !!String(d.meta.nombre || '').trim(),
    npsPartido: d => d.npsPartido && Array.isArray(d.npsPartido.datos) && d.npsPartido.datos.length >= 4,
    npsDemo: d => d.npsDemo && Array.isArray(d.npsDemo.datos) && d.npsDemo.datos.length >= 4,
    ratioPlataforma: d => Array.isArray(d.ratioPlataforma) && d.ratioPlataforma.length >= 3,
    tra: d => d.tra && Array.isArray(d.tra.valores) && d.tra.valores.length >= 4,
    sentimiento: d => d.sentimiento && Array.isArray(d.sentimiento.general) && ['genero', 'edad', 'partido', 'plataforma', 'audiencia'].every(k => Array.isArray(d.sentimiento[k]) && d.sentimiento[k].length >= 2),
    clima: d => d.clima && typeof d.clima === 'object' && Array.isArray(d.clima.general) && d.clima.general.length >= 3,
    hallazgosSent: d => Array.isArray(d.hallazgosSent) && d.hallazgosSent.length >= 3,
    tom: d => d.tom && d.tom.general && Array.isArray(d.tom.general.temas) && d.tom.general.temas.length >= 4 && ['genero', 'edad', 'partido'].every(k => d.tom[k] && Array.isArray(d.tom[k].series) && d.tom[k].series.length >= 2),
    crucesTom: d => Array.isArray(d.crucesTom) && d.crucesTom.length >= 3,
    picos: d => Array.isArray(d.picos) && d.picos.length >= 5,
    cronologia: d => Array.isArray(d.cronologia) && d.cronologia.length >= 4,
    plataformas: d => d.plataformas && ['peso', 'tono', 'edad', 'brecha', 'viral', 'lectura'].every(k => Array.isArray(d.plataformas[k]) && d.plataformas[k].length >= 3),
    nube: d => d.nube && Array.isArray(d.nube.palabras) && d.nube.palabras.length >= 15,
    hashtags: d => Array.isArray(d.hashtags) && d.hashtags.length >= 5,
    narrativas: d => d.narrativas && ['favorables', 'criticas', 'neutras'].every(k => Array.isArray(d.narrativas[k]) && d.narrativas[k].length >= 2),
    cruces: d => d.cruces && ['edadGenero', 'partidoNarrativa', 'partidoEdad', 'zonaGenero', 'interna', 'temaTono'].every(k => d.cruces[k] && typeof d.cruces[k] === 'object'),
    riesgos: d => Array.isArray(d.riesgos) && d.riesgos.length >= 3,
    oportunidades: d => Array.isArray(d.oportunidades) && d.oportunidades.length >= 3,
    alertaSube: d => Array.isArray(d.alertaSube) && d.alertaSube.length >= 3 && Array.isArray(d.alertaBaja) && d.alertaBaja.length >= 3,
    territorial: d => d.territorial && Array.isArray(d.territorial.zonas) && d.territorial.zonas.filter(z => z && /\d/.test(String(z.nps ?? ''))).length >= 4 && Array.isArray(d.territorial.volumen) && d.territorial.volumen.length >= 3,
    modulos: d => Array.isArray(d.modulos) && d.modulos.length >= 4,
    escenarios: d => Array.isArray(d.escenarios) && d.escenarios.length >= 3,
    dictamen: d => largo(d.dictamen, 60),
    veredicto: d => d.veredicto && typeof d.veredicto === 'object' && Object.values(d.veredicto).filter(v => largo(v, 10)).length >= 5,
    recomendaciones: d => Array.isArray(d.recomendaciones) && d.recomendaciones.length >= 3,
  },

};
// Emociones: segunda revisión sobre los datos YA normalizados (lo que la página dibuja).
// Si algo quedó vacío o en ceros, se vuelve a pedir una vez más.
const CHEQUEOS_POST = {
  radar: {
    npsPartido: d => d.npsPartido.datos.length >= 4 && d.npsPartido.datos.some(x => x[1] !== 0),
    tra: d => d.tra.valores.some(v => v !== 0),
    sentimiento: d => d.sentimiento.general.some(v => v > 0) && d.sentimiento.partido.length >= 2 && d.sentimiento.edad.length >= 3,
    clima: d => d.clima.general.some(x => x[1] > 0),
    tom: d => d.tom.general.temas.some(t => t.valor > 0) && ['genero', 'edad', 'partido'].every(k => d.tom[k].series.some(s => s.valores.some(v => v > 0))),
    picos: d => d.picos.length >= 5 && d.picos.some(p => p.volumen > 0),
    plataformas: d => d.plataformas.peso.some(x => x.valor > 0) && d.plataformas.tono.length >= 3 && d.plataformas.lectura.length >= 3,
    nube: d => d.nube.palabras.length >= 15,
    narrativas: d => d.narrativas.favorables.length >= 2 && d.narrativas.criticas.length >= 2,
    cruces: d => d.cruces.edadGenero.filas.length >= 2 && d.cruces.partidoNarrativa.filas.length >= 3 && d.cruces.partidoEdad.series.length >= 2 && d.cruces.zonaGenero.zonas.length >= 3 && d.cruces.interna.series.length >= 2 && d.cruces.temaTono.temas.length >= 3,
    territorial: d => d.territorial.zonas.filter(z => z.nps !== null).length >= 4 && d.territorial.volumen.length >= 3,
    modulos: d => d.modulos.length >= 4,
    escenarios: d => d.escenarios.length >= 3,
    veredicto: d => Object.values(d.veredicto).filter(v => largo(v, 10)).length >= 5,
  },
  tensiones: {
    ranking: d => d.ranking.filter(r => r.score > 0 && r.evidencia.length && largo(r.lectura, 20)).length >= 5,
    emociones: d => d.emociones.filter(e => e.porcentaje > 0).length >= 5,
    narrativas: d => d.narrativas.filter(n => n.potencial > 0).length >= 4,
    territorios: d => d.territorios.length >= 4,
    riesgos: d => d.riesgos.filter(r => r.srr > 0).length >= 4,
    trayectoria: d => d.trayectoria.filter(t => t.valores.some(v => v > 0)).length >= 4,
    alertas: d => d.alertas.filter(a => a.rows.length >= 4).length >= 2,
    dolores: d => d.dolores.filter(x => x.intensidad > 0).length >= 4,
    ias: d => d.ias.componentes.filter(c => c[1] > 0).length >= 3,
    enemigos: d => d.enemigos.filter(x => x.carga > 0).length >= 3,
    fracturas: d => d.fracturas.length >= 3,
    segmentos: d => d.segmentos.filter(x => x.peso > 0).length >= 4,
    preguntas: d => d.preguntas.filter(q => largo(q.respuesta, 20)).length >= 7,
  },
  emociones: {
    emotions: d => d.emotions.filter(e => e.active).length >= 3,
    secondary: d => d.secondary.length >= 2,
    dyads: d => d.dyads.filter(x => x.text).length >= 3,
    problematics: d => d.problematics.length >= 4,
    fears: d => d.fears.length >= 4,
    prides: d => d.prides.length >= 3,
    quotes: d => d.quotes.length >= 4,
    temasChart: d => d.temasChart.length >= 3 && d.temasChart.some(t => t[1] > 0),
    semaforo: d => d.semaforo.length >= 4,
    ive: d => d.ive.parts.length >= 3 && d.ive.val > 0,
    sintesis: d => largo(d.sintesis, 60),
    preguntaPolitica: d => largo(d.preguntaPolitica, 8) && largo(d.preguntaDesc, 40),
    govSemaforo: d => d.govSemaforo.length >= 4,
    partidos: d => d.partidos.length >= 3 && d.partidosChart.some(r => r.some(v => Number(v) > 0)),
    haidt: d => d.haidt.length >= 3,
    westen: d => d.westen.length >= 3,
    lakoff: d => d.lakoff.length >= 2,
    transfer: d => d.transfer.length >= 3 && largo(d.transferCliente, 40),
    actores: d => d.actores.length >= 2 && (d.actoresRadar.data || []).some(r => r.some(v => Number(v) > 0)),
    codigo: d => largo(d.codigo, 60),
    arqCol: d => d.arqCol.filter(a => a[1] && largo(a[2], 15)).length >= 4,
    arqScores: d => d.arqScores.length >= 6 && d.arqScores.some(a => a[1] > 0),
    arqIdeal: d => d.arqIdeal.gan && largo(d.arqIdeal.ganTxt, 20) && d.arqIdeal.seg && largo(d.arqIdeal.segTxt, 20),
    arqActores: d => d.arqActores.length >= 1,
    segIntro: d => largo(d.segIntro, 40),
    segmentos: d => d.segmentos.filter(x => x.c1.length >= 3 && x.c2.length >= 3).length >= 4,
    segTabla: d => d.segTabla.length >= 8,
    miedos: d => d.miedos.length >= 8,
    deseos: d => d.deseos.length >= 8,
    necesidades: d => d.necesidades.length >= 8,
  },
};
// Campos que se piden juntos (si falta uno, se pide también su pareja).
const PAREJAS_FALTANTES = { hashtagResumen: ['hashtags'], alertaSube: ['alertaBaja'], escenarios: ['escenariosHorizonte'], modulos: ['modulosVariante'], veredicto: ['dictamen'], dictamen: ['veredicto'], picos: ['cronologia'], cronologia: ['picos'], ranking: ['trayectoria', 'riesgos'], trayectoria: ['ranking', 'trayectoriaLabels'], enemigos: ['lecturaEnemigos'], ias: ['dolores'], hashtags: ['hashtagsLectura', 'hashtagResumen'], nube: ['hashtags', 'hashtagsLectura', 'hashtagResumen'], tom: ['crucesTom'], segmentos: ['hallazgosSent', 'ratioPlataforma', 'segJer'], riesgos: ['alertaNivel'], dyads: ['dyadInterp'], dyadInterp: ['dyads'], haidt: ['haidtNote'], westen: ['westenMeta'], lakoff: ['lakoffUsar', 'lakoffEvitar'], transfer: ['transferCliente'], codigo: ['codigoTitulo'], arqCol: ['codigoTitulo', 'codigo'], arqScores: ['arqIdeal'], arqIdeal: ['arqScores'], segTabla: ['segTablaNote'], actores: ['actoresRadar', 'arqActores', 'actoresNote'], preguntaPolitica: ['preguntaDesc'], preguntaDesc: ['preguntaPolitica'], partidos: ['partidosChart'], concept: ['conceptDesc'] };

async function completarFaltantes(skill, data, base, apiKey, chequeos = CHEQUEOS_FALTANTES[skill]) {
  if (!chequeos) return data;
  let faltan = Object.keys(chequeos).filter(k => { try { return !chequeos[k](data); } catch (_) { return true; } });
  if (!faltan.length) return data;
  faltan = [...new Set(faltan.flatMap(k => [k, ...(PAREJAS_FALTANTES[k] || [])]))];
  { const enEsquema = Object.keys(JSON.parse(subEsquema(skill, null, 'TODO'))); faltan = faltan.filter(k => enEsquema.includes(k)); }
  console.warn(`[!] ${skill}: campos incompletos, se vuelven a pedir:`, faltan.join(', '));
  const contexto = [
    data.concept ? `Concepto central ya definido: "${data.concept}"` : '',
    Array.isArray(data.emotions) ? `Emociones detectadas: ${data.emotions.filter(e => e && Number(e.intensity) > 0).map(e => `${e.key} (${e.intensity}/3)`).join(', ')}` : '',
    skill === 'radar' ? resumenRadarParaPartes(data) : '',
    Array.isArray(data.actores) && data.actores.length ? `Actores ya identificados: ${data.actores.map(a => a && (a.name || a.nombre)).filter(Boolean).join(', ')}` : '',
  ].filter(Boolean).join('\n');
  // Tensiones: los campos de la parte 2 se piden con sus propias instrucciones.
  const grupos = skill === 'tensiones'
    ? [[faltan.filter(k => !CAMPOS_TENS_P2.includes(k)), 1], [faltan.filter(k => CAMPOS_TENS_P2.includes(k)), 2]].filter(g => g[0].length)
    : [[faltan, 1]];
  const ctxTens = skill === 'tensiones' ? resumenTensionesParaCartografia(data) : '';
  await Promise.all(grupos.map(async ([campos, parteT]) => {
    try {
      const extra = await callOpenRouter(buildPrompt({
        ...base, schema: subEsquema(skill, campos), parteEmociones: 'FALTANTES', parteTensiones: parteT,
        contextoTensiones: `Este es un COMPLEMENTO: genera ÚNICAMENTE estos campos, completos y con la densidad pedida: ${campos.join(', ')}.\n${contexto}${ctxTens ? '\n' + ctxTens : ''}`,
      }), apiKey);
      if (extra && typeof extra === 'object') {
        campos.forEach(k => { if (extra[k] !== undefined && extra[k] !== null) data[k] = extra[k]; });
      }
    } catch (e) {
      console.warn(`[!] No se pudieron completar campos de ${skill}:`, e.message);
    }
  }));
  return data;
}

function fuentesReales(bloque, max = 20) {
  if (!bloque || !Array.isArray(bloque.items)) return [];
  const vistos = new Set(), out = [];
  for (const it of bloque.items) {
    const url = String(it.url || '');
    if (!/^https?:\/\//.test(url) || vistos.has(url)) continue;
    vistos.add(url);
    let medio = '';
    try { medio = new URL(url).hostname.replace(/^www\./, ''); } catch (_) {}
    const titulo = String(it.texto || '').replace(/\s+/g, ' ').trim().slice(0, 90);
    out.push({ titulo: `${medio}${titulo ? ' · ' + titulo : ''}`, url, fuente: it.fuente });
    if (out.length >= max) break;
  }
  return out;
}

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Servidor RADAR activo', modeloIA: modeloIA(), modeloConfigurado: !!process.env.OPENROUTER_MODEL });
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

  // RADAR (v2.1 · estructura RADAR Naucalpan, 12 pestañas)
  // Acepta nombres de campo alternos y deja SIEMPRE la forma que dibuja la plantilla.
  if (skill === 'radar') {
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const txt = (...vals) => { for (const v of vals) if (v !== undefined && v !== null && typeof v !== 'object' && String(v).trim()) return String(v).trim(); return ''; };
    const n0 = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : 0; const m = String(v ?? '').replace(/[−–—]/g, '-').replace(/,/g, '.').match(/[+-]?\d+(\.\d+)?/); return m ? Number(m[0]) : 0; };
    const nN = (v) => (v === null || v === undefined || v === '' || !/\d/.test(String(v))) ? null : n0(v);
    const lim = (v, a, b) => Math.max(a, Math.min(b, n0(v)));
    const lista = (v) => Array.isArray(v) ? v : isObj(v) ? Object.entries(v).map(([k, x]) => isObj(x) ? { grupo: k, nombre: k, ...x } : Array.isArray(x) ? { grupo: k, valores: x } : { grupo: k, valor: x }) : [];
    const objs = (v) => lista(v).filter(isObj);
    const nums = (v) => Array.isArray(v) ? v.map(x => isObj(x) ? n0(x.valor ?? x.v ?? x.pct) : n0(x)) : isObj(v) ? Object.values(v).map(n0) : [];
    const pares = (v) => lista(v).map(p => Array.isArray(p) ? [txt(p[0]), n0(p[1])] : isObj(p) ? [txt(p.etiqueta, p.label, p.grupo, p.nombre, p.plataforma, p.segmento, p.zona, p.tema), n0(p.valor ?? p.v ?? p.nps ?? p.ratio ?? p.pct)] : null).filter(p => p && p[0]);
    const series = (v) => objs(v).map(s => ({ grupo: txt(s.grupo, s.nombre, s.segmento, s.label, s.partido, s.plataforma, s.aspirante), valores: nums(s.valores ?? s.datos ?? s.data ?? s.d) })).filter(s => s.grupo);
    const tarjetas = (v) => objs(v).map(h => ({ titulo: txt(h.titulo, h.ih, h.nombre), texto: txt(h.texto, h.ib, h.descripcion), accion: txt(h.accion, h.im, h.conclusion).replace(/^→\s*/, '') })).filter(h => h.titulo || h.texto);
    const textos = (v) => lista(v).map(x => isObj(x) ? txt(x.texto, x.senal, x.descripcion) : txt(x)).filter(Boolean);
    const sinComillas = (t) => String(t || '').trim().replace(/^["“”']+|["“”']+$/g, '').trim();
    const old = { actor: isObj(data.actor) ? data.actor : {}, alerta: isObj(data.alerta) ? data.alerta : {} };

    // meta
    const mIn = isObj(data.meta) ? data.meta : {};
    const nombre = txt(mIn.nombre, mIn.actor, ctx.actorName);
    const palabras = nombre.split(/\s+/).filter(Boolean);
    const COLORES = ['VERDE', 'AMARILLA', 'NARANJA', 'ROJA'];
    let nivel = Math.round(n0(mIn.nivel ?? old.alerta.nivel));
    const alertaTxt = txt(mIn.alerta, old.alerta.color).toUpperCase();
    const iAl = COLORES.findIndex(c => alertaTxt.includes(c.slice(0, 5)));
    if (!(nivel >= 1 && nivel <= 4)) nivel = iAl >= 0 ? iAl + 1 : 2;
    const meta = {
      nombre, resaltado: txt(mIn.resaltado), nombreCorto: txt(mIn.nombreCorto) || palabras.slice(0, 2).join(' '),
      corto: txt(mIn.corto) || (palabras.length >= 3 ? palabras[palabras.length - 2] : palabras[palabras.length - 1] || ''),
      territorio: txt(mIn.territorio, (txt(old.actor.entidad).split(',')[0] || '').trim()), territorioLargo: txt(mIn.territorioLargo, mIn.territorio),
      gentilicio: txt(mIn.gentilicio), subtitulo: txt(mIn.subtitulo, [old.actor.cargo, old.actor.partido, old.actor.entidad].filter(Boolean).join(' · ')),
      ventana: txt(mIn.ventana, ctx.periodo && ctx.periodo.label), corte: txt(mIn.corte, old.alerta.corte), nivel, alerta: COLORES[nivel - 1],
    };
    if (!meta.resaltado) meta.resaltado = meta.corto;

    const ord = (a) => a.slice().sort((x, y) => y[1] - x[1]);
    const npsP = isObj(data.npsPartido) ? data.npsPartido : { datos: data.npsPartido };
    const npsD = isObj(data.npsDemo) ? data.npsDemo : { datos: data.npsDemo };
    const traIn = isObj(data.tra) ? data.tra : {};
    let traLab = lista(traIn.labels).map(x => txt(x)), traVal = nums(traIn.valores ?? traIn.datos);
    if (!traVal.length && Array.isArray(data.tra)) { const pp = pares(data.tra); traLab = pp.map(p => p[0]); traVal = pp.map(p => p[1]); }
    while (traLab.length < traVal.length) traLab.push(`C${traLab.length + 1}`);

    // sentimiento y clima
    const sIn = isObj(data.sentimiento) ? data.sentimiento : isObj(data.segmentos) ? data.segmentos : {};
    const sent = { general: nums(sIn.general).slice(0, 4) };
    while (sent.general.length < 4) sent.general.push(0);
    ['genero', 'edad', 'partido', 'plataforma', 'audiencia'].forEach(k => {
      sent[k] = series(sIn[k]).map(s => ({ grupo: s.grupo, valores: s.valores.slice(0, k === 'genero' ? 4 : 3) }));
    });
    const cIn = isObj(data.clima) ? data.clima : {};
    const clima = {};
    ['general', 'genero', 'edad', 'partido', 'plataforma', 'audiencia'].forEach(k => {
      clima[k] = pares(cIn[k]);
      // sin clima: se estima con el % positivo de cada grupo de sentimiento
      if (!clima[k].length && k !== 'general' && sent[k].length) clima[k] = sent[k].map(s => [s.grupo, Math.round(n0(s.valores[0]))]);
    });
    if (!clima.general.length && sent.general.some(Boolean)) clima.general = [['Favorable', sent.general[0]], ['Mixto', sent.general[3]], ['Adverso', sent.general[2]], ['Inercial', sent.general[1]]];

    // top of mind
    const tIn = isObj(data.tom) ? data.tom : {};
    const tg = isObj(tIn.general) ? tIn.general : { temas: tIn.general };
    const TONOS = ['positivo', 'negativo', 'neutro', 'polarizado', 'propuesta'];
    let temasG = lista(tg.temas).map((t, i) => isObj(t) ? { tema: txt(t.tema, t.nombre, t.label), valor: n0(t.valor ?? t.peso ?? t.pct), tono: TONOS.includes(txt(t.tono).toLowerCase()) ? txt(t.tono).toLowerCase() : 'neutro' } : { tema: txt(t), valor: n0(lista(tIn.general)[i]), tono: 'neutro' }).filter(t => t.tema);
    const matrizTom = (o, k) => {
      if (!isObj(o)) return { titulo: '', sub: '', temas: [], series: [] };
      let temas = lista(o.temas).map(x => txt(isObj(x) ? (x.tema || x.nombre) : x)).filter(Boolean);
      let ss = series(o.series);
      if (!ss.length && isObj(o.valores)) ss = Object.keys(o.valores).map(g => ({ grupo: g, valores: nums(o.valores[g]) }));
      if (!temas.length && ss.length) temas = temasG.map(t => t.tema);
      return { titulo: txt(o.titulo), sub: txt(o.sub), temas, series: ss.map(s => ({ grupo: s.grupo, valores: temas.map((_, i) => n0(s.valores[i])) })) };
    };
    const tom = { general: { titulo: txt(tg.titulo), sub: txt(tg.sub), temas: temasG } };
    ['genero', 'edad', 'partido'].forEach(k => { tom[k] = matrizTom(tIn[k], k); });

    const picos = objs(data.picos || data.quincenas).map((p, i) => ({ label: txt(p.label, p.fecha, p.rango, p.codigo) || `C${i + 1}`, volumen: lim(p.volumen, 0, 100), nps: lim(p.nps, -100, 100), pico: /neg/i.test(txt(p.pico, p.tono)) && n0(p.volumen) >= 40 ? 'negativo' : /alto|max|pos|si|true/i.test(txt(p.pico)) ? 'alto' : '' }));
    const cronologia = objs(data.cronologia).map(e => ({ fecha: txt(e.fecha, e.td), titulo: txt(e.titulo, e.tt), texto: txt(e.texto, e.tx, e.descripcion), tono: /neg/i.test(txt(e.tono)) ? 'neg' : /pos/i.test(txt(e.tono)) ? 'pos' : 'mix', ev: (txt(e.ev).match(/[VEH]/i) || ['V'])[0].toUpperCase() })).filter(e => e.titulo || e.texto);

    // plataformas
    const pIn = isObj(data.plataformas) ? data.plataformas : {};
    const filasP = (v, f) => objs(v).map(f).filter(x => x.plataforma);
    const ppIn = isObj(pIn.partido) ? pIn.partido : {};
    const plataformas = {
      peso: filasP(pIn.peso, x => ({ plataforma: txt(x.plataforma, x.nombre), valor: n0(x.valor ?? x.peso ?? x.pct) })),
      tono: filasP(pIn.tono, x => ({ plataforma: txt(x.plataforma, x.nombre), pos: n0(x.pos ?? x.positivo), neu: n0(x.neu ?? x.neutro), neg: n0(x.neg ?? x.negativo) })),
      edad: filasP(pIn.edad, x => { const v = nums(x.valores); while (v.length < 4) v.push(0); return { plataforma: txt(x.plataforma, x.nombre), valores: v.slice(0, 4) }; }),
      brecha: filasP(pIn.brecha, x => ({ plataforma: txt(x.plataforma, x.nombre), actual: lim(x.actual, 0, 100), requerido: lim(x.requerido, 0, 100) })),
      viral: filasP(pIn.viral, x => ({ plataforma: txt(x.plataforma, x.nombre), critica: n0(x.critica), propia: n0(x.propia) })),
      partido: { plataformas: lista(ppIn.plataformas).map(x => txt(x)), series: series(ppIn.series) },
      lectura: objs(pIn.lectura || data.lecturaPlataformas).map(l => ({ titulo: txt(l.titulo), texto: txt(l.texto), alerta: l.alerta === true || l.color === 'da' })).filter(l => l.titulo || l.texto),
    };
    if (!plataformas.partido.plataformas.length) plataformas.partido.plataformas = plataformas.tono.map(t => t.plataforma);

    const TON = { favorable: 'positivo', positivo: 'positivo', negativo: 'negativo', neutro: 'neutro', neutral: 'neutro', polarizado: 'polarizado', mixto: 'polarizado' };
    const nIn = isObj(data.nube) ? data.nube : { palabras: data.nube };
    const nube = { palabras: objs(nIn.palabras).map(p => ({ w: txt(p.w, p.word, p.palabra), v: lim(p.v ?? p.weight ?? p.peso, 1, 100), s: TON[txt(p.s, p.sentiment, p.tono).toLowerCase()] || 'neutro' })).filter(p => p.w), lectura: txt(nIn.lectura) };
    const hashtags = objs(data.hashtags).map(h => ({ tag: (t => t.startsWith('#') ? t : '#' + t)(txt(h.tag, h.h, h.hashtag)), indice: n0(h.indice ?? h.f ?? h.apariciones ?? h.valor), tono: TON[txt(h.tono, h.t).toLowerCase()] || 'neutro', plataforma: txt(h.plataforma, h.p), impulso: txt(h.impulso, h.origen, h.i) })).filter(h => h.tag.length > 1).sort((a, b) => b.indice - a.indice);
    const maxH = Math.max(0, ...hashtags.map(h => h.indice));
    if (maxH > 100) hashtags.forEach(h => { h.indice = Math.round(h.indice / maxH * 100); });

    const nrIn = isObj(data.narrativas) ? data.narrativas : {};
    const narr = (v, crit) => objs(v).map((n, i) => {
      let titulo = sinComillas(txt(n.titulo, n.nombre));
      const alerta = n.alerta === true || /^⚠/.test(titulo);
      titulo = titulo.replace(/^⚠\s*/, '');
      return { titulo, ev: (txt(n.ev).match(/[VEH]/i) || ['V'])[0].toUpperCase(), descripcion: txt(n.descripcion, n.desc), tags: lista(n.tags).map(t => typeof t === 'string' ? { texto: t, tipo: '' } : isObj(t) ? { texto: txt(t.texto), tipo: txt(t.tipo) } : null).filter(t => t && t.texto), bivariado: txt(n.bivariado).replace(/^<strong>Bivariado:<\/strong>\s*/i, ''), alerta: crit && alerta };
    }).filter(n => n.titulo);
    const narrativas = { favorables: narr(nrIn.favorables), criticas: narr(nrIn.criticas, true), neutras: narr(nrIn.neutras || nrIn.neutrales) };

    // cruces
    const czIn = isObj(data.cruces) ? data.cruces : {};
    const eg = isObj(czIn.edadGenero) ? czIn.edadGenero : {}, pn = isObj(czIn.partidoNarrativa) ? czIn.partidoNarrativa : {};
    const pe = isObj(czIn.partidoEdad) ? czIn.partidoEdad : {}, zg = isObj(czIn.zonaGenero) ? czIn.zonaGenero : {};
    const it = isObj(czIn.interna) ? czIn.interna : {}, tt = isObj(czIn.temaTono) ? czIn.temaTono : {};
    const filasM = (v, k) => objs(v).map(f => ({ [k]: txt(f[k], f.nombre, f.segmento, f.narrativa, f.label), valores: nums(f.valores) })).filter(f => f[k]).concat(lista(v).filter(Array.isArray).map(f => ({ [k]: txt(f[0]), valores: nums(f[1]) })));
    const cruces = {
      edadGenero: { grupos: lista(eg.grupos).map(x => txt(x)), filas: filasM(eg.filas, 'segmento'), lectura: txt(eg.lectura).replace(/^<strong>Lectura:<\/strong>\s*/i, '') },
      partidoNarrativa: { grupos: lista(pn.grupos).map(x => txt(x)), filas: filasM(pn.filas, 'narrativa').map(f => ({ ...f, valores: f.valores.map(v => Math.max(0, Math.min(100, v))) })) },
      partidoEdad: { sub: txt(pe.sub), grupos: lista(pe.grupos).map(x => txt(x)), series: series(pe.series) },
      zonaGenero: { zonas: lista(zg.zonas).map(x => txt(x)), hombres: nums(zg.hombres), mujeres: nums(zg.mujeres) },
      interna: { titulo: txt(it.titulo), sub: txt(it.sub), segmentos: lista(it.segmentos).map(x => txt(x)), series: series(it.series).map(s => ({ nombre: s.grupo, valores: s.valores })) },
      temaTono: { temas: lista(tt.temas).map(x => txt(x)), positivo: nums(tt.positivo), negativo: nums(tt.negativo) },
      hallazgos: tarjetas(czIn.hallazgos),
    };
    if (!cruces.edadGenero.grupos.length) cruces.edadGenero.grupos = ['18-29', '30-44', '45-59', '60+'];
    if (!cruces.partidoEdad.grupos.length) cruces.partidoEdad.grupos = ['18-29', '30-44', '45-59', '60+'];

    const NIV_R = (v) => { const x = txt(v).toUpperCase(); return /CR[IÍ]T/.test(x) ? 'CRÍTICO' : /ALT/.test(x) ? 'ALTO' : /BAJ/.test(x) ? 'BAJO' : 'MEDIO'; };
    const NIV_O = (v) => { const x = txt(v).toUpperCase(); return /MUY/.test(x) ? 'MUY ALTA' : /ALT/.test(x) ? 'ALTA' : /BAJ/.test(x) ? 'BAJA' : 'MEDIA'; };
    const mr = (v, f) => objs(v).map(r => ({ nivel: f(r.nivel), titulo: txt(r.titulo, r.nombre), descripcion: txt(r.descripcion), bivariado: txt(r.bivariado).replace(/^<strong>Bivariado:<\/strong>\s*/i, '') })).filter(r => r.titulo);
    const oldAN = isObj(data.alertaNivel) ? data.alertaNivel : {};

    // territorial
    const terIn = isObj(data.territorial) ? data.territorial : {};
    const zonas = objs(terIn.zonas).map(z => {
      const nps = nN(z.nps ?? z.npsP ?? z.valor);
      const cl = txt(z.clase, z.clasificacion).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const clase = nps === null ? (/advers/.test(cl) ? 'adversa' : /favor/.test(cl) ? 'favorable' : 'inercial') : /advers/.test(cl) ? 'adversa' : /favor/.test(cl) ? 'favorable' : /inerc|disput/.test(cl) ? 'inercial' : nps >= 10 ? 'favorable' : nps <= -10 ? 'adversa' : 'inercial';
      const etq = txt(z.etiqueta) || { favorable: 'FAVORABLE', inercial: nps !== null && nps > 0 ? 'DISPUTADA' : 'INERCIAL', adversa: 'ADVERSA' }[clase];
      return { nombre: txt(z.nombre, z.zona), nps: nps === null ? null : Math.max(-100, Math.min(100, Math.round(nps))), clase, etiqueta: etq.replace(/^[🟢🟡🔴]\s*/u, ''), nota: txt(z.nota, z.descripcion) };
    }).filter(z => z.nombre);
    const ordC = { favorable: 0, inercial: 1, adversa: 2 };
    zonas.sort((a, b) => ordC[a.clase] - ordC[b.clase]);
    const TIPOS = ['fuerte', 'disputa', 'adversa'];
    const territorial = {
      zonas,
      volumen: objs(terIn.volumen).map(v => ({ zona: txt(v.zona, v.nombre), valor: n0(v.valor ?? v.volumen ?? v.pct) })).filter(v => v.zona).sort((a, b) => b.valor - a.valor),
      bloques: objs(terIn.bloques).map((b, i) => ({ tipo: TIPOS.find(t => txt(b.tipo).toLowerCase().startsWith(t.slice(0, 4))) || TIPOS[i % 3], titulo: txt(b.titulo).replace(/^ZONA (FUERTE|EN DISPUTA|ADVERSA)\s*[—-]\s*/i, ''), zonas: txt(b.zonas), estado: txt(b.estado), texto: txt(b.texto), clave: txt(b.clave), valor: txt(b.valor) })),
    };

    const escenarios = objs(data.escenarios).map(e => ({ nombre: txt(e.nombre).toUpperCase(), prob: Math.round(lim(e.prob ?? e.probabilidad, 0, 100)), nps: Math.round(lim(e.nps, -100, 100)), nivel: txt(e.nivel), detonante: txt(e.detonante), alerta: txt(e.alerta, e.alertaTemprana), texto: txt(e.texto, e.descripcion) })).filter(e => e.nombre);
    const vIn = isObj(data.veredicto) ? data.veredicto : {};
    const veredicto = {}; ['fortaleza', 'vulnerabilidad', 'riesgo', 'narrativa', 'oportunidad', 'final'].forEach(k => { veredicto[k] = txt(vIn[k]); });
    const recomendaciones = objs(data.recomendaciones).map(r => {
      let plazo = txt(r.plazo), titulo = txt(r.titulo);
      if (!plazo && titulo.includes(' · ')) [plazo, titulo] = titulo.split(' · ', 2);
      return { plazo, titulo, texto: txt(r.texto, r.descripcion), objetivo: txt(r.objetivo, r.meta).replace(/^→\s*/, '').replace(/^Objetivo:\s*/i, '') };
    }).filter(r => r.titulo || r.texto);

    const out = {
      meta,
      npsPartido: { sub: txt(npsP.sub), datos: ord(pares(npsP.datos)) },
      npsDemo: { sub: txt(npsD.sub), datos: pares(npsD.datos) },
      ratioPlataforma: ord(pares(data.ratioPlataforma)),
      tra: { titulo: txt(traIn.titulo), labels: traLab.slice(0, traVal.length), valores: traVal },
      sentimiento: sent, clima,
      hallazgosSent: tarjetas(data.hallazgosSent),
      tom, crucesTom: tarjetas(data.crucesTom),
      picos, cronologia, plataformas, nube, hashtags,
      hashtagResumen: txt(data.hashtagResumen, data.hashtagsLectura),
      narrativas, cruces,
      riesgos: mr(data.riesgos, NIV_R), oportunidades: mr(data.oportunidades, NIV_O),
      alertaSube: textos(data.alertaSube || oldAN.sube), alertaBaja: textos(data.alertaBaja || oldAN.baja),
      territorial,
      modulosVariante: txt(data.modulosVariante),
      modulos: objs(data.modulos).map(m => ({ icono: txt(m.icono), titulo: txt(m.titulo, m.nombre), texto: txt(m.texto, m.descripcion) })).filter(m => m.titulo || m.texto),
      escenariosHorizonte: txt(data.escenariosHorizonte),
      escenarios,
      dictamen: txt(data.dictamen, isObj(data.dictamen) ? data.dictamen.texto : ''),
      veredicto, recomendaciones,
      fuentesTexto: txt(data.fuentesTexto), fuentesNota: txt(data.fuentesNota),
    };
    Object.keys(data).forEach(k => { delete data[k]; });
    Object.assign(data, out);
  }


  // EMOCIONES
  if (skill === 'emociones') {
    if (!data.territory) data.territory = 'Sin datos';
    if (!data.subtitle) data.subtitle = '';
    if (!data.date) data.date = '';
    if (!data.riskLevel) data.riskLevel = 'MEDIO';
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
    // Solo se reemplaza si el modelo dejó un placeholder genérico o vacío; si
    // la búsqueda fue un territorio (ej. "La Piedad"), los actores reales que
    // el modelo identificó se respetan.
    const esPlaceholder = (t) => !String(t || '').trim() || /^(competidor|oponente|actor|candidat[oa]|rival)\s*[a-z0-9]?$/i.test(String(t).trim());
    if (ctx.actorName && data.actores[0] && esPlaceholder(data.actores[0].name)) data.actores[0].name = ctx.actorName;

    // Actores: nombre real (no el del territorio buscado), rows como pares
    // [etiqueta, valor] y el radar con las MISMAS etiquetas que las tarjetas.
    const PAL_ACT = ['#C9980A', '#2563eb', '#9d1c3a', '#16a34a', '#7c3aed', '#0891b2'];
    data.actores = data.actores.filter(a => a && typeof a === 'object').map((a, i) => ({
      ...a,
      name: String(a.name || a.nombre || '').trim(),
      role: String(a.role || a.rol || a.cargo || '').trim(),
      borderColor: /^#[0-9a-f]{3,8}$/i.test(String(a.borderColor || '')) ? a.borderColor : PAL_ACT[i % PAL_ACT.length],
      rows: (Array.isArray(a.rows) ? a.rows : []).map(r => Array.isArray(r) ? [String(r[0] ?? ''), String(r[1] ?? '')] : (r && typeof r === 'object' ? [String(r.label ?? r.k ?? ''), String(r.value ?? r.v ?? '')] : null)).filter(Boolean),
    })).filter(a => a.name);
    if (Array.isArray(data.actoresRadar)) {
      const lst = data.actoresRadar.filter(x => x && typeof x === 'object');
      data.actoresRadar = { labels: lst.map(x => String(x.label || x.actor || x.nombre || x.name || '')), data: lst.map(x => Array.isArray(x.data) ? x.data : Array.isArray(x.valores) ? x.valores : Object.values(x).filter(v => typeof v === 'number')), colors: lst.map(x => x.color || '') };
    }
    ensureObject(data, 'actoresRadar', { labels: [], data: [], colors: [] });
    const ar = data.actoresRadar;
    if (Array.isArray(ar.data)) ar.data = ar.data.map(f => Array.isArray(f) ? f : (f && typeof f === 'object' ? Object.values(f).filter(v => /\d/.test(String(v))) : []));
    // El radar puede traer etiquetas cortas y solo los actores principales (hasta 6):
    // solo se arma desde las tarjetas si el modelo no lo mandó.
    if (data.actores.length && !(Array.isArray(ar.labels) && ar.labels.length && Array.isArray(ar.data) && ar.data.length)) {
      const datosRadar = Array.isArray(ar.data) ? ar.data : [];
      ar.labels = data.actores.map(a => a.name);
      ar.colors = data.actores.map(a => a.borderColor);
      ar.data = data.actores.map((_, i) => {
        const fila = Array.isArray(datosRadar[i]) ? datosRadar[i] : [];
        return Array.from({ length: 6 }, (_, k) => Math.max(0, Math.min(100, Number(fila[k]) || 0)));
      });
    }

    // Percepción por partido: las 4 columnas siempre llenas (nombre, emoción,
    // capital, tendencia con flecha) y la gráfica de carga emocional alineada
    // 1 a 1 con la tabla.
    const FLECHA = { baja: '↓', sube: '↑', estable: '→' };
    data.partidos = data.partidos.filter(p => p && typeof p === 'object' && (p.nombre || p.partido)).map(p => {
      let tendencia = String(p.tendencia || '').trim();
      const dir = String(p.direccion || '').toLowerCase();
      if (!/[↑↓→]/.test(tendencia)) tendencia = `${FLECHA[dir] || (/(baj|cae|erosi|pierd|margin)/i.test(tendencia) ? '↓' : /(sub|crec|gan|dispon)/i.test(tendencia) ? '↑' : '→')} ${tendencia || (dir === 'baja' ? 'A la baja' : dir === 'sube' ? 'Al alza' : 'Estable')}`.trim();
      const c = p.cargaEmocional && typeof p.cargaEmocional === 'object' ? p.cargaEmocional : {};
      return {
        ...p,
        nombre: String(p.nombre || p.partido),
        emocion: String(p.emocion || p.emocionDominante || '—'),
        capital: String(p.capital || p.capitalPolitico || '—'),
        tendencia,
        cargaEmocional: { iraAsco: Number(c.iraAsco) || 0, decepcionTristeza: Number(c.decepcionTristeza) || 0, interesDisponible: Number(c.interesDisponible) || 0 },
      };
    });
    const chartPrevio = Array.isArray(data.partidosChart) ? data.partidosChart : [];
    data.partidosChart = data.partidos.map((p, i) => {
      const fila = chartPrevio[i];
      if (Array.isArray(fila) && fila.length >= 3 && fila.some(v => Number(v) > 0)) return fila.slice(0, 3).map(v => Number(String(v).replace(/[^\d.\-]/g, '')) || 0);
      if (fila && typeof fila === 'object' && !Array.isArray(fila)) { const vs = Object.values(fila).map(v => Number(String(v).replace(/[^\d.\-]/g, ''))).filter(v => Number.isFinite(v) && String(v) !== ''); if (vs.length >= 3) return vs.slice(-3); }
      const c = p.cargaEmocional;
      return [c.iraAsco, c.decepcionTristeza, c.interesDisponible];
    });
    ensureObject(data, 'actoresRadar', { labels: [], data: [], colors: [] });
    if (!data.resumenEjecutivo) data.resumenEjecutivo = '';
    // ---------- v5 (estructura EMOCIONES v2 · San Antonio la Isla) ----------
    // Acepta también las respuestas con la forma anterior (v4) y las convierte.
    const T = (v) => (v === undefined || v === null) ? '' : String(v);
    const N = (v) => { const m = String(v ?? '').replace(/[−–]/g, '-').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : 0; };
    const arrO = (v) => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : [];
    const hex = (v, def) => /^#[0-9a-f]{3,8}$/i.test(T(v).trim()) ? T(v).trim() : def;
    const par = (r) => Array.isArray(r) ? [T(r[0]), Array.isArray(r[1]) ? r[1].map(T) : T(r[1])] : (r && typeof r === 'object' ? [T(r.k ?? r.label ?? r.etiqueta ?? Object.keys(r)[0]), T(r.v ?? r.value ?? r.valor ?? Object.values(r)[0])] : null);
    const pares = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.entries(v) : [])).map(par).filter(p => p && (p[0] || p[1]));
    // El modelo a veces manda objetos en vez de listas, con otros nombres de campo:
    // se busca cada columna por sus nombres posibles y, si no, por posición.
    const sinAc = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
    const val = (o, keys) => { if (!o || typeof o !== 'object') return undefined; const m = {}; Object.keys(o).forEach(k => { m[sinAc(k)] = o[k]; });
      for (const k of keys) { const v = m[sinAc(k)]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return undefined; };
    const numDe = (o, keys) => { const v = val(o, keys); if (v !== undefined) return N(v); const n = Object.values(o || {}).find(x => typeof x === 'number' || /^\s*-?\d+(\.\d+)?\s*%?\s*$/.test(String(x))); return n !== undefined ? N(n) : 0; };
    const listaDe = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? (Array.isArray(v.rows) ? v.rows : Array.isArray(v.items) ? v.items : Array.isArray(v.data) ? v.data : Object.values(v).every(x => x && typeof x === 'object') ? Object.values(v) : []) : []);
    const filas = (v, n, spec) => listaDe(v)
      .map(r => Array.isArray(r) ? r : (r && typeof r === 'object' ? (spec ? spec.map((keys, i) => { const x = val(r, keys); return x !== undefined ? x : Object.values(r)[i]; }) : Object.values(r)) : (typeof r === 'string' && r.trim() ? [r] : null)))
      .filter(r => r && r.some(x => T(x).trim()))
      .map(r => { const x = r.slice(0, n).map(c => typeof c === 'number' ? c : (c && typeof c === 'object' ? T(Object.values(c).join(' · ')) : T(c))); while (x.length < n) x.push(''); return x; });
    const etiquetaEv = (v) => { const t = T(v).toLowerCase(); return /^(ver|pub)/.test(t) ? 'ver' : /^ofi/.test(t) ? 'ofi' : 'inf'; };
    data.cliente = T(ctx.clienteName || data.cliente).trim();
    data.anioEleccion = T(data.anioEleccion).trim();
    data.periodoGobierno = T(data.periodoGobierno).trim();

    // Semáforos (sin cambiar el texto del valor: puede traer cifras y flechas)
    const colorVal = (v) => /CR[IÍ]TIC|ROJ|CONFLICT/i.test(v) ? '#ef4444' : /^(ALT|BAJ)/i.test(v) ? '#f97316' : /MEDI|DISPUT|PRUEBA/i.test(v) ? '#eab308' : '#eab308';
    ['semaforo', 'govSemaforo'].forEach(k => {
      data[k] = arrO(data[k]).map(x => ({ label: T(x.label || x.etiqueta), val: T(x.val ?? x.valor), color: hex(x.color, colorVal(T(x.val ?? x.valor))) })).filter(x => x.label);
    });
    data.secondary = arrO(data.secondary).map((x, i) => ({ name: T(x.name || x.nombre), text: T(x.text || x.texto), color: hex(x.color, ['#f97316', '#a78bfa', '#22c55e', '#0E7490'][i % 4]) })).filter(x => x.name);
    data.quotes = data.quotes.map(q => typeof q === 'string' ? { text: q } : q).filter(q => q && typeof q === 'object' && T(q.text || q.texto).trim())
      .map(q => ({ text: T(q.text || q.texto).replace(/^["“«]|["”»]$/g, ''), topic: T(q.topic || q.tema), emotion: T(q.emotion || q.emocion), territory: T(q.territory || q.territorio || q.fuente), para: !!(q.para || /par[aá]frasis/i.test(T(q.tipo))) }));
    data.temasChart = listaDe(data.temasChart).map((t, i) => Array.isArray(t) ? [T(t[0]), N(t[1]), hex(t[2], ['#B91C1C', '#4C1D95', '#0E7490', '#15803D', '#C2410C', '#eab308'][i % 6])] : (t && typeof t === 'object' ? [T(val(t, ['tema', 'nombre', 'label', 'name'])), numDe(t, ['porcentaje', 'valor', 'peso', 'value', 'pct']), hex(val(t, ['color']), ['#B91C1C', '#4C1D95', '#0E7490', '#15803D', '#C2410C', '#eab308'][i % 6])] : null)).filter(t => t && t[0]);
    data.temasTitulo = T(data.temasTitulo);
    const RIESGOS = { CRITICO: 'CRÍTICO', CRÍTICO: 'CRÍTICO', ALTO: 'ALTO', MEDIO: 'MEDIO', BAJO: 'BAJO' };
    data.dyads = arrO(data.dyads).map(d => ({ name: T(d.name || d.nombre), formula: T(d.formula), type: T(d.type || d.tipo) || 'Secundaria', text: T(d.text || d.texto), risk: RIESGOS[T(d.risk || d.riesgo).toUpperCase().trim()] || 'MEDIO', score: Math.max(0, Math.min(100, Math.round(N(d.score)))) })).filter(d => d.name);

    // IVE: [etiqueta, valor, peso]; val = Σ valor × peso
    const iveIn = (data.ive && typeof data.ive === 'object') ? data.ive : { val: data.ivEstimado };
    const PESOS = [0.35, 0.25, 0.20, 0.20];
    const parts = listaDe(iveIn.parts || iveIn.comps || iveIn.componentes).map((c, i) => Array.isArray(c) ? [T(c[0]), Math.max(0, Math.min(100, N(c[1]))), N(c[2]) || PESOS[i] || 0.25] : (c && typeof c === 'object' ? [T(val(c, ['label', 'nombre', 'componente', 'etiqueta', 'detalle'])), Math.max(0, Math.min(100, numDe(c, ['valor', 'value', 'score', 'puntaje']))), N(val(c, ['peso', 'weight', 'ponderacion'])) || PESOS[i] || 0.25] : null)).filter(c => c && c[0]);
    let iveVal = Math.max(0, Math.min(100, Math.round(N(iveIn.val ?? iveIn.value ?? iveIn.valor))));
    if (!iveVal && parts.length) { const sw = parts.reduce((a, c) => a + c[2], 0) || 1; iveVal = Math.round(parts.reduce((a, c) => a + c[1] * c[2], 0) / sw); }
    const iveCls = T(iveIn.cls || iveIn.clasificacion).toUpperCase() || (iveVal >= 80 ? 'CRÍTICO' : iveVal >= 60 ? 'VOLÁTIL' : iveVal >= 40 ? 'MODERADO' : 'ESTABLE');
    data.ive = { val: iveVal, cls: iveCls, hor: T(iveIn.hor || iveIn.horizon || iveIn.horizonte), color: hex(iveIn.color, iveVal >= 80 ? '#ef4444' : iveVal >= 60 ? '#f97316' : iveVal >= 40 ? '#eab308' : '#22c55e'), parts, note: T(iveIn.note || iveIn.text || iveIn.texto) };
    data.ivEstimado = iveVal;
    data.sintesis = T(data.sintesis);

    // Identidad política: Haidt · Westen · Lakoff · Transferencia
    data.partidosNote = T(data.partidosNote);
    data.haidt = filas(data.haidt, 4, [['emocion', 'emotion'], ['fundacion', 'fundacionMoral', 'foundation'], ['valor', 'valorViolado'], ['narrativa', 'narrativaActivada', 'frase']]); data.haidtNote = T(data.haidtNote);
    const ROLCOL = (r) => /villan/i.test(r) ? '#ef4444' : /v[ií]ctim/i.test(r) ? '#a78bfa' : /h[eé]roe/i.test(r) ? '#22c55e' : '#64748b';
    data.westen = filas(data.westen, 4, [['rol', 'role'], ['quien', 'ocupa', 'actor', 'actores', 'texto', 'descripcion'], ['emociones', 'emocion'], ['color']]).map(w => [w[0], w[1], w[2], hex(w[3], ROLCOL(w[0]))]); data.westenMeta = T(data.westenMeta);
    data.lakoff = filas(data.lakoff, 4, [['frame', 'nombre', 'marco'], ['sostiene', 'quien', 'actores', 'sostenidoPor'], ['activa', 'emociones', 'emocion'], ['estado', 'status', 'situacion']]).map(f => [f[0], f[1], f[2], T(f[3]).toUpperCase().trim() || 'MINORITARIO']);
    data.lakoffUsar = T(data.lakoffUsar); data.lakoffEvitar = T(data.lakoffEvitar);
    data.transfer = arrO(Array.isArray(data.transfer) && data.transfer.length ? data.transfer : data.flows).map((f, i) => ({ em: T(f.em || f.emocion), color: hex(f.color, ['#B91C1C', '#15803D', '#4C1D95', '#0E7490'][i % 4]), o: T(f.o || f.origen), c: T(f.c || f.canal), d: T(f.d || f.destino), t: T(f.t || f.tipo) })).filter(f => f.em);
    data.transferCliente = T(data.transferCliente) || pares(data.clientePos).map(p => `<b>${p[0]}</b> ${p[1]}`).join(' · ');
    delete data.flows; delete data.clientePos; delete data.marcos;

    // Actores: nota, sondeos publicados y tendencia (solo si vienen en las fuentes)
    data.actoresNote = T(data.actoresNote);
    data.encuestas = filas(data.encuestas, 5, [['casa', 'encuestadora', 'fuente'], ['levantamiento', 'fecha', 'periodo'], ['metodo', 'metodologia', 'muestra'], ['intencion', 'resultados', 'partidos', 'aprobacion'], ['internas', 'aspirantes']]);
    data.encuestasTitulo = T(data.encuestasTitulo); data.encuestasNota = T(data.encuestasNota);
    const tIn = (data.tendencia && typeof data.tendencia === 'object' && !Array.isArray(data.tendencia)) ? data.tendencia : {};
    const labelsT = (Array.isArray(tIn.labels) ? tIn.labels : []).map(T);
    let series = arrO(tIn.series);
    if (!series.length) series = Object.keys(tIn).filter(k => !['labels', 'titulo', 'series'].includes(k) && Array.isArray(tIn[k])).map(k => ({ label: k, data: tIn[k] }));
    const numONull = (v) => (v === null || v === undefined || v === '' || !/\d/.test(String(v))) ? null : N(v);
    series = series.map((s, i) => ({ label: T(s.label || s.nombre), data: labelsT.map((_, j) => numONull((Array.isArray(s.data) ? s.data : [])[j])), color: hex(s.color, ['#22c55e', '#ef4444', '#8B1E3F', '#00843D', '#3b82f6', '#60a5fa'][i % 6]), dash: !!s.dash })).filter(s => s.label && s.data.some(v => v !== null));
    data.tendencia = { titulo: T(tIn.titulo), labels: series.length ? labelsT : [], series: labelsT.length >= 2 ? series : [] };

    // Arquetipo y código simbólico (acepta la forma anterior: arquetipos / arqIdeal-lista / arqWin)
    const RANGO = [['Dominante', '#ef4444'], ['Secundario', '#3b82f6'], ['Emergente', '#22c55e'], ['Rechazado', '#64748b']];
    const viejoArq = arrO(data.arquetipos);
    data.arqCol = (listaDe(data.arqCol).length ? filas(data.arqCol, 4, [['rango', 'tipo', 'k', 'nivel', 'posicion'], ['nombre', 'arquetipo', 'n', 'name'], ['texto', 'evidencia', 'p', 'descripcion', 'lectura'], ['color', 'c']]) : viejoArq.map(a => [T(a.k), T(a.n || a.nombre), T(a.p || a.texto), T(a.c)]))
      .slice(0, 4).map((a, i) => [T(a[0]).replace(/^Arquetipo( colectivo)?\s*/i, '') || RANGO[i][0], a[1], a[2], hex(a[3], RANGO[i][1])]).map(a => [a[0].charAt(0).toUpperCase() + a[0].slice(1), a[1], a[2], a[3]]);
    const listaArq = data.arqScores && (Array.isArray(data.arqScores) ? data.arqScores.length : Object.keys(data.arqScores).length) ? data.arqScores : (Array.isArray(data.arqIdeal) ? data.arqIdeal : []);
    data.arqScores = (Array.isArray(listaArq) ? listaArq : (listaArq && typeof listaArq === 'object' ? Object.entries(listaArq) : [])).map(a => Array.isArray(a) ? [T(a[0]), Math.max(0, Math.min(100, N(a[1])))] : (a && typeof a === 'object' ? [T(val(a, ['arquetipo', 'nombre', 'name', 'label'])), Math.max(0, Math.min(100, numDe(a, ['resonancia', 'valor', 'score', 'puntaje', 'value'])))] : null)).filter(a => a && a[0]).sort((x, y) => y[1] - x[1]).slice(0, 10);
    const ai0 = (data.arqIdeal && typeof data.arqIdeal === 'object' && !Array.isArray(data.arqIdeal)) ? data.arqIdeal : {};
    const p1 = val(ai0, ['primero', 'ganador', 'primerLugar', '1']) || {}, p2 = val(ai0, ['segundo', 'segundoLugar', '2']) || {};
    const ai = { gan: val(ai0, ['gan', 'ganadorNombre']) || (typeof p1 === 'object' ? val(p1, ['nombre', 'arquetipo', 'name']) : p1), ganTxt: val(ai0, ['ganTxt', 'ganPorque', 'porqueGanador']) || val(p1, ['porque', 'texto', 'why', 'resuena']), ganRiesgo: val(ai0, ['ganRiesgo']) || val(p1, ['riesgo', 'risk', 'sobreactuacion']),
      seg: val(ai0, ['seg', 'segundoNombre']) || (typeof p2 === 'object' ? val(p2, ['nombre', 'arquetipo', 'name']) : p2), segTxt: val(ai0, ['segTxt', 'segPorque']) || val(p2, ['porque', 'texto', 'why', 'resuena']), segRiesgo: val(ai0, ['segRiesgo']) || val(p2, ['riesgo', 'risk', 'sobreactuacion']) };
    const win = arrO(data.arqWin), quitaPos = (t) => T(t).replace(/^\s*\d+\s*[º°o]?\s*[·.\-:]\s*/, '');
    data.arqIdeal = {
      gan: T(ai.gan) || quitaPos((win[0] || {}).pos) || T((data.arqScores[0] || [])[0]), ganTxt: T(ai.ganTxt || (win[0] || {}).why), ganRiesgo: T(ai.ganRiesgo || (win[0] || {}).risk),
      seg: T(ai.seg) || quitaPos((win[1] || {}).pos) || T((data.arqScores[1] || [])[0]), segTxt: T(ai.segTxt || (win[1] || {}).why), segRiesgo: T(ai.segRiesgo || (win[1] || {}).risk),
    };
    delete data.arquetipos; delete data.arqWin;
    const actViejo = (data.arqActores && !Array.isArray(data.arqActores) && Array.isArray(data.arqActores.rows)) ? data.arqActores.rows : null;
    data.arqActores = actViejo ? filas(actViejo, 5).map(r => [r[0], r[1], [r[3], r[4]].filter(Boolean).join(' · ')]) : filas(data.arqActores, 3, [['actor', 'aspirante', 'nombre', 'name'], ['arquetipo', 'proyecta', 'arquetipoProyecta', 'arquetipoQueProyecta'], ['resonancia', 'resonanciaConElIdeal', 'lectura', 'distancia']]);
    data.arqNote = T(data.arqNote);
    data.codigo = T(data.codigo); data.codigoTitulo = T(data.codigoTitulo);

    // Segmentos (acepta también la forma anterior: c3 como objeto, perfil/emocional/palancas)
    data.segIntro = T(data.segIntro);
    data.segmentos = arrO(data.segmentos).map(sg => {
      const pf = sg.perfil || {}, em = sg.emocional || {}, pl = sg.palancas || {}, vc = sg.vector;
      const c1 = pares(sg.c1).length ? pares(sg.c1) : [['Edad y género', pf.edad], ['Zona', pf.zona], ['Ocupación', pf.ocupacion], ['Escolaridad / ingreso', pf.escolaridad], ['Presencia digital', pf.digital], ['Historia electoral', pf.historia]].filter(p => p[1]).map(p => [p[0], T(p[1])]);
      const c2 = pares(sg.c2).length ? pares(sg.c2) : [['Emoción Plutchik', em.emocion], ['Tensión activa', em.tension], ['Dolor profundo', em.dolor], ['Miedo', em.miedo], ['Orgullo', em.orgullo], ['Narrativa maestra', em.narrativa]].filter(p => p[1]).map(p => [p[0], T(p[1])]);
      let c3;
      if (Array.isArray(sg.c3)) c3 = pares(sg.c3);
      else {
        const o = (sg.c3 && typeof sg.c3 === 'object') ? sg.c3 : {};
        const tags = (Array.isArray(o.tags) ? o.tags : Array.isArray(pl.problemas) ? pl.problemas : []).map(T).filter(Boolean);
        c3 = [['Problemas críticos', tags], ['Orgullo comunitario', o.orgullo || pl.orgullo], ['Consumo digital', o.consumo || pl.consumo], ['Lo activa', o.votaria || pl.acerca], ['Lo aleja', o.alejaria || pl.aleja], ['Frame cognitivo', o.frame || pl.frame], ['Palanca', o.palanca || pl.palanca]]
          .filter(p => Array.isArray(p[1]) ? p[1].length : p[1]).map(p => [p[0], Array.isArray(p[1]) ? p[1] : T(p[1])]);
      }
      const vector = typeof vc === 'string' ? vc : (vc && typeof vc === 'object' ? [vc.canal, vc.tono, vc.formato].filter(Boolean).map(T).join(' · ') : '');
      const pesoN = Math.round(N(sg.peso));
      return { tipo: T(sg.tipo), color: hex(sg.color, '#374151'), nombre: T(sg.nombre), sub: T(sg.sub || sg.subtitulo), peso: pesoN + '%', pers: T(sg.pers || sg.persuabilidad).toUpperCase(),
        persBg: hex(sg.persBg, ''), persTx: hex(sg.persTx, ''), frase: T(sg.frase).replace(/^["“«]|["”»]$/g, ''), fraseNota: T(sg.fraseNota), c1, c2, c3, vector };
    }).filter(sg => sg.nombre);
    data.segJer = filas(data.segJer, 4, [['tipo', 'segmento', 'codigo', 'nombre'], ['accion', 'objetivo'], ['puntos', 'prioridad', 'dots', 'nivel'], ['color']]).map((j, i) => [j[0], j[1], j[2] || '●●○○○', hex(j[3], '#374151')]);
    data.segTabla = filas(listaDe(data.segTabla).length ? data.segTabla : data.segTbl, 6, [['eje'], ['segmento', 'perfil'], ['emocion', 'emocionDominante'], ['intensidad'], ['detonante', 'detonantePrincipal'], ['implicacion', 'implicacionParaElCliente', 'lectura']]);
    data.segTablaNote = T(data.segTablaNote);
    delete data.segTbl;

    // Miedos · Deseos · Necesidades: [título, evidencia, lectura, (intensidad), etiqueta]
    const sem = (data.semiotica && typeof data.semiotica === 'object') ? data.semiotica : {};
    const mdn = (v, conScore) => (Array.isArray(v) ? v : []).map(x => {
      let r;
      if (Array.isArray(x)) r = conScore ? [T(x[0]), T(x[1]), T(x[2]), Math.max(0, Math.min(100, N(x[3]))), etiquetaEv(x[4])] : [T(x[0]), T(x[1]), T(x[2]), etiquetaEv(x[3])];
      else if (x && typeof x === 'object') { const base = [T(val(x, ['titulo', 'nombre', 'name', 'miedo', 'deseo', 'necesidad', 'texto'])), T(val(x, ['evidencia', 'fuente', 'dato'])), T(val(x, ['lectura', 'lecturaPolitica', 'significado', 'implicacion']))]; const tg = etiquetaEv(val(x, ['tag', 'etiqueta', 'tipoEvidencia'])); r = conScore ? [...base, Math.max(0, Math.min(100, numDe(x, ['intensidad', 'score', 'valor', 'intensidadSimbolica']))), tg] : [...base, tg]; }
      else if (typeof x === 'string') r = conScore ? [x, '', '', 0, 'inf'] : [x, '', '', 'inf'];
      return r;
    }).filter(x => x && x[0]);
    data.miedos = mdn(listaDe(data.miedos).length ? listaDe(data.miedos) : sem.miedos, true);
    data.deseos = mdn(listaDe(data.deseos).length ? listaDe(data.deseos) : sem.deseos, true);
    data.necesidades = mdn(listaDe(data.necesidades).length ? listaDe(data.necesidades) : sem.necesidades, false).slice(0, 10);
    ['miedos', 'deseos'].forEach(k => {
      // sin intensidad: se reparte de 90 a 40 según el orden
      if (data[k].length && data[k].every(x => !x[3])) data[k].forEach((x, i) => { x[3] = Math.round(90 - i * (50 / Math.max(1, data[k].length - 1))); });
      data[k] = data[k].slice(0, 10);
    });
    delete data.semiotica;

    // Siempre las 8 emociones de Plutchik por "key", intensidad entera 0-3 y "active" coherente.
    const KEYS_PLUTCHIK = ['ira', 'miedo', 'anticipacion', 'tristeza', 'asco', 'alegria', 'confianza', 'sorpresa'];
    const sinAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const porKey = {};
    data.emotions.filter(e => e && typeof e === 'object').forEach(e => {
      const k = KEYS_PLUTCHIK.find(x => sinAcento(e.key) === x || sinAcento(e.key).startsWith(x) || sinAcento(e.label).startsWith(x));
      if (k && !porKey[k]) porKey[k] = e;
    });
    data.emotions = KEYS_PLUTCHIK.map(k => {
      const e = porKey[k] || {};
      const iv = Math.max(0, Math.min(3, Math.round(Number(e.intensity) || 0)));
      const lista = (v) => (Array.isArray(v) ? v : (v ? [v] : [])).map(String).filter(Boolean);
      return { key: k, active: iv > 0 && e.active !== false, intensity: iv, sublabel: T(e.sublabel).trim(), triggers: lista(e.triggers), consequences: lista(e.consequences) };
    });
  }

  // TENSIONES (v3 · estructura Cuautitlán Izcalli)
  // Acepta nombres de campo alternos y la forma anterior (semaforo,
  // cartografiaSocioafectiva...) y deja SIEMPRE la forma que dibuja la plantilla.
  if (skill === 'tensiones') {
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
    const s_ = (...vals) => { for (const v of vals) if (v !== undefined && v !== null && typeof v !== 'object' && String(v).trim()) return String(v).trim(); return ''; };
    const n_ = (v, min = 0, max = 100) => {
      const m = String(v ?? '').replace(/[−–—]/g, '-').replace(',', '.').match(/[+-]?\d+(\.\d+)?/);
      if (!m) return 0; return Math.max(min, Math.min(max, Number(m[0])));
    };
    const lista = (v) => Array.isArray(v) ? v : isObj(v) ? Object.values(v).filter(x => isObj(x) || Array.isArray(x)) : [];
    const objs = (v) => lista(v).filter(isObj);
    const cs = isObj(data.cartografiaSocioafectiva) ? data.cartografiaSocioafectiva : {};
    const de = (k, ...alt) => { for (const key of [k, ...alt]) { if (data[key] !== undefined && data[key] !== null) return data[key]; if (cs[key] !== undefined && cs[key] !== null) return cs[key]; } return undefined; };
    const sinComillas = (t) => String(t || '').trim().replace(/^["“”«']+|["“”»']+$/g, '').trim();
    const PALETA = ['rojo', 'naranja', 'amarillo', 'violeta', 'cian', 'verde'];
    const colorNombre = (c, i) => {
      const x = String(c || '').toLowerCase();
      if (PALETA.includes(x)) return x;
      if (/red|roj|#e2|#c5|#dc|#ef4/.test(x)) return 'rojo';
      if (/orang|naran|#d97|#c05|#f97/.test(x)) return 'naranja';
      if (/yell|amar|ambar|ámbar|#b45|#b77|#ea|#f5/.test(x)) return 'amarillo';
      if (/viol|morad|purp|#7c|#8b|#a7/.test(x)) return 'violeta';
      if (/cian|cyan|azul|blue|#0e|#06|#38/.test(x)) return 'cian';
      if (/verd|green|#16|#22|#10/.test(x)) return 'verde';
      return PALETA[i % PALETA.length];
    };
    const colorEmocion = (nombre, i) => {
      const x = String(nombre || '').toLowerCase();
      if (/ira|indign|enojo|rabia/.test(x)) return 'rojo';
      if (/miedo|temor|ansied|insegur/.test(x)) return 'amarillo';
      if (/desconf|resent|frustr|hartaz/.test(x)) return 'naranja';
      if (/trist|abandon|duelo|desesper/.test(x)) return 'violeta';
      if (/asco|desprecio|cinism/.test(x)) return 'cian';
      if (/solid|esperan|orgull|confian/.test(x)) return 'verde';
      return PALETA[i % PALETA.length];
    };
    const comoTexto = (v) => Array.isArray(v) ? v.map(x => s_(x)).filter(Boolean).join(' · ') : isObj(v) ? s_(v.texto, v.descripcion) : s_(v);

    // meta
    const metaIn = isObj(data.meta) ? data.meta : {};
    const actIn = isObj(data.actor) ? data.actor : {};
    const ventanaPer = (ctx.periodo && ctx.periodo.label) || '';
    const meta = {
      municipio: s_(metaIn.municipio, metaIn.territorio, metaIn.entidad, actIn.entidad, ctx.actorName),
      estado: s_(metaIn.estado, metaIn.entidadFederativa),
      cargo: s_(metaIn.cargo, actIn.cargo),
      actor: s_(metaIn.actor, metaIn.titular, metaIn.gobernante, actIn.nombre, actIn.titular),
      actorCorto: s_(metaIn.actorCorto),
      partido: s_(metaIn.partido, actIn.partido),
      periodoGobierno: s_(metaIn.periodoGobierno, actIn.periodo),
      ventana: s_(metaIn.ventana, ventanaPer),
      ventanaCorta: s_(metaIn.ventanaCorta),
      ventanaMeses: s_(metaIn.ventanaMeses, metaIn.ventana, ventanaPer),
      fuentes: comoTexto(metaIn.fuentes) || comoTexto(data.fuentes),
      stsGlobal: 0,
    };
    if (!meta.actorCorto && meta.actor) { const p = meta.actor.split(/\s+/); meta.actorCorto = p.length >= 3 ? p.slice(-2).join(' ') : meta.actor; }
    if (!meta.ventanaCorta) meta.ventanaCorta = meta.ventanaMeses;

    // ranking
    let ranking = objs(de('ranking', 'tensiones')).map(r => {
      let ev = r.evidencia ?? r.evidencias ?? r.datos;
      ev = Array.isArray(ev) ? ev.map(x => isObj(x) ? s_(x.texto, x.dato) : s_(x)).filter(Boolean)
        : s_(ev) ? s_(ev).split(/\s+[-–—•]\s+(?=[A-ZÁÉÍÓÚÑ0-9“"])|\s*;\s*|\s*\n+\s*/).map(x => x.trim()).filter(Boolean) : [];
      const emo = s_(r.emocion, r.emociones);
      const intEmo = (emo.match(/(\d)\s*\/\s*5/) || [])[1];
      return {
        nombre: s_(r.nombre, r.tension, r.titulo), score: n_(r.score ?? r.sts ?? r.valor), delta: null,
        deltaModelo: r.delta,
        emocion: emo.replace(/\s*·\s*\d\s*\/\s*5\s*$/, ''), intensidad: Math.round(n_(r.intensidad ?? intEmo ?? 3, 1, 5)) || 3,
        narrativa: sinComillas(s_(r.narrativa, r.narrativaDominante, r.frase)), actor: s_(r.actor, r.actores, r.responsable),
        territorio: s_(r.territorio, r.territorios, r.zona), potencial: s_(r.potencial, r.potencialPolitico, r.politica),
        evidencia: ev.slice(0, 6), lectura: s_(r.lectura, r.lecturaEstrategica, r.interpretacion),
      };
    }).filter(r => r.nombre);

    // trayectoria
    const cortesT = (ctx.periodo && ctx.periodo.cortesTrayectoria) || [];
    let labels = lista(de('trayectoriaLabels', 'cortes')).map(x => s_(x)).filter(Boolean);
    let tray = objs(de('trayectoria')).map(t => ({
      nombre: s_(t.nombre, t.tension),
      valores: (Array.isArray(t.valores) ? t.valores : [t.t3, t.t2, t.t1, t.ta].filter(v => v !== undefined)).map(v => v === null || v === '' ? null : n_(v)),
      tipo: s_(t.tipo), velocidad: s_(t.velocidad), ta: t.ta,
    })).filter(t => t.nombre || t.valores.length);
    const nCols = Math.max(labels.length, ...tray.map(t => t.valores.length), 0);
    const consistente = labels.length >= 2 && tray.length && tray.every(t => t.valores.length === labels.length);
    if (cortesT.length >= 2 && !consistente) {
      const n = cortesT.length;
      tray = tray.map(t => {
        const nums = t.valores.filter(v => v !== null);
        let v = new Array(n).fill(null);
        if (nums.length >= n) v = nums.slice(-n); else nums.forEach((x, k) => { v[n - nums.length + k] = x; });
        return { ...t, valores: v };
      });
      labels = cortesT.slice();
    } else if (labels.length < nCols) {
      while (labels.length < nCols) labels.push(cortesT[labels.length] || `Corte ${labels.length + 1}`);
    }
    // trayectoria sigue el orden del ranking (por nombre; si no, por posición)
    const clave = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const parecido = (a, b) => { const x = clave(a), y = clave(b); return x && y && (x === y || x.includes(y.slice(0, 14)) || y.includes(x.slice(0, 14))); };
    const tUsadas = new Set();
    ranking.forEach((r, i) => {
      let j = tray.findIndex((t, k) => !tUsadas.has(k) && parecido(t.nombre, r.nombre));
      if (j < 0 && i < tray.length && !tUsadas.has(i)) j = i;
      if (j < 0) return;
      tUsadas.add(j); r._t = tray[j];
    });
    ranking.forEach(r => {
      const t = r._t; delete r._t;
      const v = t ? t.valores.filter(x => x !== null) : [];
      if (!r.score && v.length) r.score = v[v.length - 1];
      if (t && v.length) { t.valores[t.valores.lastIndexOf(v[v.length - 1])] = r.score; }
      const vv = t ? t.valores.filter(x => x !== null) : [];
      if (vv.length >= 2) r.delta = Math.round(vv[vv.length - 1] - vv[vv.length - 2]);
      else if (r.deltaModelo !== undefined && r.deltaModelo !== null && /\d/.test(String(r.deltaModelo))) r.delta = Math.round(n_(r.deltaModelo, -100, 100));
      else r.delta = 0;
      delete r.deltaModelo;
      r.delta = r.delta > 0 ? '+' + r.delta : String(r.delta);
    });
    ranking.sort((a, b) => b.score - a.score);
    tray = tray.map((t, i) => {
      const v = t.valores.filter(x => x !== null);
      const d = v.length >= 2 ? v[v.length - 1] - v[v.length - 2] : 0;
      const vel = /aceler/i.test(t.velocidad) ? 'Acelerada' : /crec|sub|moder/i.test(t.velocidad) ? 'Creciendo' : /baj|desc/i.test(t.velocidad) ? 'Bajando' : /estab|gradual/i.test(t.velocidad) ? 'Estable'
        : d >= 10 ? 'Acelerada' : d > 0 ? 'Creciendo' : d < 0 ? 'Bajando' : 'Estable';
      const tipo = /persist/i.test(t.tipo) ? 'Persistente' : /recurr/i.test(t.tipo) ? 'Recurrente' : /estac/i.test(t.tipo) ? 'Estacional' : /nuev|emerg/i.test(t.tipo) ? 'Nueva' : (t.valores[0] === null ? 'Nueva' : 'Persistente');
      return { nombre: t.nombre || (ranking[i] && ranking[i].nombre) || `Tensión ${i + 1}`, valores: t.valores, tipo, velocidad: vel };
    });

    const sts = n_(metaIn.stsGlobal ?? metaIn.sts ?? (lista(data.semaforo)[0] || {}).valor);
    meta.stsGlobal = Math.round(sts || (ranking.length ? ranking.slice(0, 3).reduce((a, r) => a + r.score, 0) / Math.min(3, ranking.length) : 0));

    // emociones
    let emociones = objs(de('emociones')).map((e, i) => ({
      nombre: s_(e.nombre, e.emocion), intensidad: Math.round(n_(e.intensidad ?? 3, 1, 5)) || 3,
      porcentaje: Math.round(n_(e.porcentaje ?? e.peso ?? e.valor)),
      color: '', colorIn: e.color,
      tendencia: s_(e.tendencia) || '→ Estable', lectura: s_(e.lectura, e.tendenciaDesc, e.descripcion),
    })).filter(e => e.nombre);
    emociones = emociones.map((e, i) => { const c = e.colorIn ? colorNombre(e.colorIn, i) : colorEmocion(e.nombre, i); delete e.colorIn; return { ...e, color: c }; });
    const totE = emociones.reduce((a, e) => a + e.porcentaje, 0);
    if (!totE && emociones.length) { const tI = emociones.reduce((a, e) => a + e.intensidad, 0); emociones.forEach(e => { e.porcentaje = Math.round(e.intensidad / tI * 100); }); }

    const narrativas = objs(de('narrativas')).map(n => ({
      nombre: sinComillas(s_(n.nombre, n.narrativa, n.n)), potencial: Math.round(n_(typeof n.potencial === 'number' ? n.potencial : (n.potencialNum ?? n.score ?? n.potencial))),
      tema: s_(n.tema), actor: s_(n.actor), politica: s_(n.politica, n.potencialPolitico, typeof n.potencial === 'string' && !/^\s*\d+\s*$/.test(n.potencial) ? n.potencial : ''),
      frase: s_(n.frase, n.cita), origen: s_(n.origen, n.fuente, n.orig),
    })).filter(n => n.nombre).sort((a, b) => b.potencial - a.potencial);

    const nivelTer = (v) => /roj|red|crit/i.test(v) ? 'Rojo' : /amar|yell|bajo|latent/i.test(v) ? 'Amarillo' : 'Naranja';
    const territorios = objs(de('territorios')).map(z => ({
      nombre: s_(z.nombre, z.territorio, z.zona), nivel: nivelTer(s_(z.nivel, z.color)), emocion: s_(z.emocion, z.emocionDominante),
      tension: s_(z.tension, z.tensionDominante), observacion: s_(z.observacion, z.observaciones, z.descripcion, z.lectura),
    })).filter(z => z.nombre);
    const ordNivel = { Rojo: 0, Naranja: 1, Amarillo: 2 };
    territorios.sort((a, b) => ordNivel[a.nivel] - ordNivel[b.nivel]);

    const riesgos = objs(de('riesgos')).map(r => ({
      tension: s_(r.tension, r.nombre), srr: Math.round(n_(r.srr ?? r.score)), actor: s_(r.actor, r.actorExpuesto),
      tipoSenal: s_(r.tipoSenal, r.senal, r.tipo), probabilidad: s_(r.probabilidad, r.probEscalar),
      consecuencia: s_(r.consecuencia, r.accion),
    })).filter(r => r.tension);

    const alertas = objs(de('alertas')).map((a, i) => {
      let rows = lista(a.rows || a.filas).map(r => Array.isArray(r) ? [s_(r[0]), s_(r[1])] : isObj(r) ? [s_(r.k, r.label, r.etiqueta), s_(r.v, r.valor, r.texto)] : null).filter(r => r && r[1]);
      if (!rows.length) rows = Object.keys(a).filter(k => !/titulo|nivel|nombre|color|rows/.test(k) && s_(a[k])).map(k => [k.charAt(0).toUpperCase() + k.slice(1), s_(a[k])]);
      return { titulo: s_(a.titulo, a.nombre, a.tension), nivel: /naran|orange|alto|media/i.test(s_(a.nivel, a.color)) && i > 0 ? 'naranja' : 'rojo', rows };
    }).filter(a => a.titulo || a.rows.length);

    // parte 2
    const dolores = objs(de('dolores')).map(d => ({
      nombre: sinComillas(s_(d.nombre, d.dolor, d.frase, d.f)), intensidad: Math.round(n_(d.intensidad ?? d.valor ?? (String(d.meta || '').match(/(\d)\s*\/\s*5/) || [])[1] * 2, 0, 10)),
      territorio: s_(d.territorio, d.zona), emocion: s_(d.emocion), causa: s_(d.causa, d.meta, d.m), herida: s_(d.herida, d.heridaSimbolica),
      colorIn: d.color,
    })).filter(d => d.nombre).sort((a, b) => b.intensidad - a.intensidad)
      .map((d, i) => { const c = d.colorIn ? colorNombre(d.colorIn, i) : (d.intensidad >= 9 ? 'rojo' : d.intensidad >= 7 ? 'naranja' : d.intensidad >= 5 ? 'amarillo' : 'violeta'); delete d.colorIn; return { ...d, color: c }; });

    const iasIn = isObj(de('ias')) ? de('ias') : {};
    const COMP = ['Intensidad', 'Extensión', 'Culpa asignada', 'Organización', 'Detonante'];
    let comps = lista(iasIn.componentes || iasIn.comps || iasIn.parts).map((c, i) => Array.isArray(c) ? [s_(c[0]) || COMP[i] || `C${i + 1}`, n_(c[1], 0, 10)] : isObj(c) ? [s_(c.label, c.nombre, c.k) || COMP[i] || `C${i + 1}`, n_(c.valor ?? c.v, 0, 10)] : null).filter(Boolean);
    if (!comps.length && isObj(iasIn.componentes)) comps = Object.keys(iasIn.componentes).map(k => [k, n_(iasIn.componentes[k], 0, 10)]);
    let iasVal = n_(iasIn.valor ?? iasIn.val ?? iasIn.indice, 0, 100);
    if (iasVal > 10) iasVal = iasVal / 10;
    if (!iasVal && comps.length) iasVal = comps.reduce((a, c) => a + c[1], 0) / comps.length;
    iasVal = Math.round(iasVal * 10) / 10;
    const ias = { valor: iasVal, nivel: s_(iasIn.nivel) ? s_(iasIn.nivel).toUpperCase() : iasVal >= 7 ? 'ALTA' : iasVal >= 4 ? 'MEDIA' : 'BAJA', componentes: comps.slice(0, 6), nota: s_(iasIn.nota, iasIn.lectura, iasIn.descripcion) };

    const enemigos = objs(de('enemigos', 'enemigosSimbolicos')).map((e, i) => ({
      nombre: s_(e.nombre, e.n, e.titulo), carga: Math.round(n_(e.carga ?? e.valor ?? e.score)), color: '',
      colorIn: e.color, quien: s_(e.quien, e.quienLoNombra), lectura: s_(e.lectura, e.descripcion, e.d),
    })).filter(e => e.nombre).sort((a, b) => b.carga - a.carga)
      .map((e, i) => { const c = e.colorIn ? colorNombre(e.colorIn, i) : (e.carga >= 80 ? 'rojo' : e.carga >= 65 ? 'naranja' : e.carga >= 50 ? 'amarillo' : 'violeta'); delete e.colorIn; return { ...e, color: c }; });

    const fracturas = objs(de('fracturas', 'fracturasSociales')).map(f => {
      let a = s_(f.a, f.poloA), b = s_(f.b, f.poloB);
      if (!a && !b) { const t = s_(f.titulo, f.nombre).split(/\s+(?:vs\.?|⇄|↔|contra|frente a)\s+/i); a = t[0] || ''; b = t[1] || ''; }
      const it = s_(f.intensidad, f.nivel);
      return { a, b, descripcion: s_(f.descripcion, f.d), intensidad: /cr[ií]t/i.test(it) ? 'Crítica' : /media[- ]?alta/i.test(it) ? 'Media-Alta' : /alta/i.test(it) ? 'Alta' : /baja/i.test(it) ? 'Baja' : 'Media' };
    }).filter(f => f.a || f.b);

    let segmentos = objs(de('segmentos', 'segmentacion')).map((g, i) => ({
      nombre: s_(g.nombre, g.segmento), peso: Math.round(n_(g.peso ?? g.porcentaje)), color: '', colorIn: g.color,
      sub: s_(g.sub, g.perfil, g.zonas), frase: s_(g.frase, g.cita), fraseNota: s_(g.fraseNota, g.fuente),
      emocion: s_(g.emocion, g.emocionDominante), dolor: s_(g.dolor), enemigo: s_(g.enemigo), simbolo: s_(g.simbolo),
      detona: s_(g.detona, g.detonante), desactiva: s_(g.desactiva), activacion: n_(g.activacion, 0, 10), confianza: n_(g.confianza, 0, 10),
    })).filter(g => g.nombre);
    const COL_SEG = ['rojo', 'naranja', 'amarillo', 'violeta', 'cian', 'verde'];
    segmentos = segmentos.map((g, i) => { const c = g.colorIn ? colorNombre(g.colorIn, i) : COL_SEG[i % 6]; delete g.colorIn; return { ...g, color: c }; });
    const totS = segmentos.reduce((a, g) => a + g.peso, 0);
    if (!totS && segmentos.length) segmentos.forEach(g => { g.peso = Math.round(100 / segmentos.length); });

    const preguntas = objs(de('preguntas')).map(p => ({ pregunta: s_(p.pregunta, p.q, p.titulo), respuesta: s_(p.respuesta, p.r, p.texto), evidencia: s_(p.evidencia, p.e, p.fuente) })).filter(p => p.pregunta || p.respuesta);

    const txt = (k, ...alt) => { const v = de(k, ...alt); return isObj(v) ? s_(v.texto, v.descripcion) : Array.isArray(v) ? v.map(x => isObj(x) ? s_(x.texto) : s_(x)).filter(Boolean).join(' ') : s_(v); };
    const out = {
      meta,
      lecturaRadar: txt('lecturaRadar', 'resumenEjecutivo', 'narrativaMadreSintesis'),
      ranking, emociones,
      hallazgoEmocional: txt('hallazgoEmocional', 'lecturaPoliticaEmociones'),
      narrativas, territorios, riesgos,
      trayectoriaLabels: labels, trayectoria: tray,
      hallazgoTrayectoria: txt('hallazgoTrayectoria'),
      alertas, dolores, ias, enemigos,
      lecturaEnemigos: txt('lecturaEnemigos'),
      fracturas, segmentos,
      hallazgoSegmentacion: txt('hallazgoSegmentacion', 'narrativaMadreDesc'),
      preguntas,
    };
    ['actor', 'semaforo', 'lecturaPoliticaEmociones', 'narrativaMadreSintesis', 'aprobacion', 'resumenEjecutivo', 'cartografiaSocioafectiva', 'enemigosSimbolicos', 'fracturasSociales', 'segmentacion', 'iasPorZona'].forEach(k => { delete data[k]; });
    Object.assign(data, out);
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

async function scrapeActor(nombre, token, periodo = null, opciones = {}) {
  // Filtro de fechas del periodo (mes, rango o semana). Google acepta los
  // operadores after:/before: y el scraper de X acepta start/end. El resto de
  // plataformas no filtran por fecha en búsqueda: se manda la fecha de cada
  // item al modelo para que distinga lo del periodo de lo que es contexto.
  const filtroGoogle = periodo ? ` after:${periodo.desde} before:${periodo.hasta}` : '';
  const filtroX = periodo ? { start: periodo.desde, end: periodo.hasta } : {};
  const tareas = [];
  // Contexto de actores (Emociones/Tensiones/Sesgo/Radar): una búsqueda SIN
  // filtro de fechas para identificar quiénes son los aspirantes, el titular
  // en turno y la oposición del territorio. Con periodos cortos (una semana)
  // casi no hay notas que los nombren y el modelo terminaba inventando.
  if (opciones.contextoActores) {
    tareas.push(llamarActorApify('apify~google-search-scraper', {
      queries: [
        `"${nombre}" aspirantes presidencia municipal 2027`,
        `"${nombre}" presidente municipal OR alcalde OR alcaldesa`,
        `"${nombre}" encuesta OR sondeo 2027 candidatos`,
      ].join('\n'),
      resultsPerPage: 10,
    }, token, PLATFORM_TIMEOUTS.prensa).then(i => tag(i, 'contexto-actores')));
  }
  tareas.push(
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
  );

  // Promise.allSettled en vez de Promise.all: si un actor revienta con una
  // excepción no controlada, no debe tumbar a los otros 5 que sí llegaron bien.
  const resultados = await Promise.allSettled(tareas);
  const rawItems = resultados
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    // El scraper de Google devuelve UN item por página de resultados, con las
    // notas dentro de "organicResults": se expanden para que cada nota (título
    // + descripción + URL) llegue al modelo como fuente individual.
    .flatMap(i => Array.isArray(i && i.organicResults)
      ? i.organicResults.map(o => ({ ...o, text: [o.title, o.description].filter(Boolean).join(' — '), __fuente: i.__fuente }))
      : [i]);

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
//RADAR (v2.1 · estructura RADAR Naucalpan, 12 pestañas)
const SCHEMAS = {
  radar: JSON.stringify({
    meta: { nombre: "string (nombre completo real del actor)", resaltado: "string (la palabra del nombre que va resaltada, normalmente el primer apellido)", nombreCorto: "string (nombre + primer apellido, ej. 'David Parra')", corto: "string (apellido con que lo nombra la conversación, ej. 'Parra')", territorio: "string (municipio corto, ej. 'Naucalpan')", territorioLargo: "string (nombre oficial, ej. 'Naucalpan de Juárez')", gentilicio: "string (ej. 'naucalpense')", subtitulo: "string (cargo o aspiración · partido · contexto · territorio · Periodo … · Corte dd/mm/aaaa)", ventana: "string (ej. '13 jun – 13 oct 2026')", corte: "string (ej. '13 oct 2026')", nivel: 2, alerta: "VERDE|AMARILLA|NARANJA|ROJA" },
    npsPartido: { sub: "string (lectura corta de la gráfica)", datos: [["string (segmento partidista)", 0]] },
    npsDemo: { sub: "string (lectura corta)", datos: [["18-29", 0], ["30-44", 0], ["45-59", 0], ["60+", 0], ["♂ Hombres", 0], ["♀ Mujeres", 0]] },
    ratioPlataforma: [["string (plataforma)", 0]],
    tra: { titulo: "string (ej. 'TRA — Evolución Semanal (jun–oct 2026)')", labels: ["string (corte)"], valores: [0] },
    sentimiento: {
      general: [0, 0, 0, 0],
      genero: [{ grupo: "Hombres", valores: [0, 0, 0, 0] }, { grupo: "Mujeres", valores: [0, 0, 0, 0] }],
      edad: [{ grupo: "18-29", valores: [0, 0, 0] }],
      partido: [{ grupo: "string (segmento partidista)", valores: [0, 0, 0] }],
      plataforma: [{ grupo: "string (plataforma)", valores: [0, 0, 0] }],
      audiencia: [{ grupo: "string (tipo de audiencia)", valores: [0, 0, 0] }]
    },
    clima: { general: [["Favorable", 0], ["Mixto", 0], ["Adverso", 0], ["Inercial", 0]], genero: [["Hombres", 0], ["Mujeres", 0]], edad: [["18-29", 0]], partido: [["string", 0]], plataforma: [["string", 0]], audiencia: [["string", 0]] },
    hallazgosSent: [{ titulo: "GÉNERO × SENTIMIENTO|PARTIDO × SENTIMIENTO|EDAD × SENTIMIENTO|AUDIENCIA × SENTIMIENTO", texto: "string (con NPS-P por segmento; usa <strong>)", accion: "string (conclusión estratégica de una línea)" }],
    tom: {
      general: { sub: "string (ej. '¿Qué domina la conversación sobre David Parra? (%)')", temas: [{ tema: "string (texto corto)", valor: 0, tono: "positivo|negativo|neutro|polarizado|propuesta" }] },
      genero: { titulo: "Top of Mind × Género", sub: "string (lectura corta)", temas: ["string"], series: [{ grupo: "Hombres", valores: [0] }, { grupo: "Mujeres", valores: [0] }] },
      edad: { titulo: "Top of Mind × Edad", sub: "string", temas: ["string"], series: [{ grupo: "18-29", valores: [0] }] },
      partido: { titulo: "Top of Mind × Partido", sub: "string", temas: ["string"], series: [{ grupo: "string (segmento partidista)", valores: [0] }] }
    },
    crucesTom: [{ titulo: "GÉNERO × TEMA|EDAD × TEMA|PARTIDO × TEMA|TERRITORIO × TEMA", texto: "string (usa <strong> y <br>)", accion: "string" }],
    picos: [{ label: "string (fecha del corte, ej. '11-13 Jul')", volumen: 0, nps: 0, pico: "alto|negativo|" }],
    cronologia: [{ fecha: "string (ej. '11–13 JUL 2026 · PICO MÁXIMO (100)')", titulo: "string", texto: "string (qué pasó, medio, y daño/beneficio)", tono: "pos|neg|mix", ev: "V|E|H" }],
    plataformas: {
      peso: [{ plataforma: "string", valor: 0 }],
      tono: [{ plataforma: "string", pos: 0, neu: 0, neg: 0 }],
      edad: [{ plataforma: "string", valores: [0, 0, 0, 0] }],
      brecha: [{ plataforma: "string", actual: 0, requerido: 0 }],
      viral: [{ plataforma: "string", critica: 0, propia: 0 }],
      partido: { plataformas: ["string"], series: [{ grupo: "string (segmento partidista)", valores: [0] }] },
      lectura: [{ titulo: "string (ej. 'FACEBOOK · ~50% · 40+')", texto: "string (usa <strong>)", alerta: false }]
    },
    nube: { palabras: [{ w: "string", v: 0, s: "positivo|negativo|neutro|polarizado" }], lectura: "string (usa <strong>)" },
    hashtags: [{ tag: "#string", indice: 0, tono: "positivo|negativo|neutro|polarizado", plataforma: "string", impulso: "string (Propio | Orgánico | Orgánico adverso | Institucional | Rival | Medio afín…)" }],
    hashtagResumen: "string (usa <strong>)",
    narrativas: {
      favorables: [{ titulo: "string", ev: "V|E|H", descripcion: "string", tags: [{ texto: "string", tipo: "edad|zona|partido|audiencia|fuente" }], bivariado: "string" }],
      criticas: [{ titulo: "string", ev: "V|E|H", alerta: false, descripcion: "string", tags: [{ texto: "string", tipo: "edad|zona|partido|audiencia|fuente" }], bivariado: "string" }],
      neutras: [{ titulo: "string", ev: "V|E|H", descripcion: "string", tags: [{ texto: "string", tipo: "edad|zona|partido|audiencia|fuente" }], bivariado: "string" }]
    },
    cruces: {
      edadGenero: { grupos: ["18-29", "30-44", "45-59", "60+"], filas: [{ segmento: "♂ Hombres", valores: [0, 0, 0, 0] }, { segmento: "♀ Mujeres", valores: [0, 0, 0, 0] }, { segmento: "Total", valores: [0, 0, 0, 0] }], lectura: "string (usa <strong>)" },
      partidoNarrativa: { grupos: ["string (segmento partidista)"], filas: [{ narrativa: "string", valores: [0] }] },
      partidoEdad: { sub: "string (pregunta que responde la gráfica)", grupos: ["18-29", "30-44", "45-59", "60+"], series: [{ grupo: "string (segmento partidista)", valores: [0, 0, 0, 0] }] },
      zonaGenero: { zonas: ["string"], hombres: [0], mujeres: [0] },
      interna: { titulo: "string (ej. 'Intención interna PAN × Segmento')", sub: "string (de dónde sale la proyección)", segmentos: ["string"], series: [{ nombre: "string (aspirante o 'NS/Otro')", valores: [0] }] },
      temaTono: { temas: ["string"], positivo: [0], negativo: [0] },
      hallazgos: [{ titulo: "string (ej. 'HALLAZGO CRUZADO 1 — …')", texto: "string", accion: "string" }]
    },
    riesgos: [{ nivel: "CRÍTICO|ALTO|MEDIO|BAJO", titulo: "string", descripcion: "string", bivariado: "string" }],
    oportunidades: [{ nivel: "MUY ALTA|ALTA|MEDIA|BAJA", titulo: "string", descripcion: "string", bivariado: "string" }],
    alertaSube: ["string (señal que subiría el nivel de alerta)"],
    alertaBaja: ["string (señal que lo bajaría)"],
    territorial: {
      zonas: [{ nombre: "string (zona o localidad real)", nps: 0, clase: "favorable|inercial|adversa", etiqueta: "string (ej. 'FAVORABLE', 'FAV.-INERCIAL', 'DISPUTADA', 'ADVERSA')", nota: "string (colonias y motivo en una línea)" }],
      volumen: [{ zona: "string (mismas zonas)", valor: 0 }],
      bloques: [{ tipo: "fuerte|disputa|adversa", titulo: "string (ej. 'PUEBLOS Y POPULAR PONIENTE')", zonas: "string", estado: "string (2-3 palabras)", texto: "string", clave: "string (ej. 'Segmento clave', 'Riesgo', 'Estrategia')", valor: "string" }]
    },
    modulosVariante: "string (ej. 'VARIANTE B — ASPIRANTE EN COMPETENCIA' o 'VARIANTE A — GOBERNANTE EN FUNCIONES')",
    modulos: [{ titulo: "string (ej. 'M-A · MONITOREO DE CUENTAS CLAVE')", texto: "string (usa <strong>; cierra con [V], [E] o [H])" }],
    escenariosHorizonte: "string (ej. 'A ENE 2027')",
    escenarios: [{ nombre: "OPTIMISTA|BASE|PESIMISTA", prob: 0, nps: 0, nivel: "string (ej. '🟡 Amarilla')", detonante: "string", alerta: "string (alerta temprana)", texto: "string" }],
    dictamen: "string (párrafo ejecutivo final; usa <strong>)",
    veredicto: { fortaleza: "string", vulnerabilidad: "string", riesgo: "string", narrativa: "string", oportunidad: "string", final: "string (emoji de nivel + veredicto en 1-2 frases)" },
    recomendaciones: [{ plazo: "string (ej. '0–15 DÍAS')", titulo: "string (ej. 'CONTENCIÓN DE LA BASE')", texto: "string", objetivo: "string (meta medible)" }],
    fuentesTexto: "string (medios realmente consultados con tema y fecha, separados por ' · ')",
    fuentesNota: "string (qué es estimación analítica y requiere validación)"
  }, null, 2),
//EMOCIONES
  emociones: JSON.stringify({
    territory: "string (municipio/entidad del estudio, ej. 'San Antonio la Isla' — nunca el país genérico)",
    subtitle: "string (ej. 'Estado de México · Gobierno municipal PRI (Nombre, 2025–2027) · Ventana: 14 abr – 14 oct 2026 · Rumbo a la elección municipal 2027 · Cliente: [cliente]')",
    date: "string (mes y año de corte, ej. 'Octubre 2026')",
    cliente: "string (partido o candidatura para la que se hace el estudio)",
    anioEleccion: "string (año de la próxima elección local, ej. '2027')",
    periodoGobierno: "string (periodo del gobierno municipal en turno, ej. '2025–2027')",
    riskLevel: "CRÍTICO|ALTO|MEDIO|BAJO",
    concept: "string (concepto central del territorio en 2-4 palabras, ej. 'Tres Islas')",
    conceptDesc: "string (párrafo de 90-140 palabras con los hechos que lo sustentan; usa <b> para resaltar)",
    emotions: [
      { key: "ira|miedo|anticipacion|tristeza|asco|alegria|confianza|sorpresa", active: true, intensity: 2,
        sublabel: "string (una línea propia del territorio, ej. 'Ira por trato desigual · San Dimas y San Lucas contra el ayuntamiento')",
        triggers: ["string (hecho concreto con medio y fecha, cerrado con su etiqueta de evidencia, ej. '... (La Jornada Edomex 1-oct) [verificado]')"],
        consequences: ["string"] }
    ],
    secondary: [{ name: "string (ej. 'Agravio territorial')", color: "#hex", text: "string (con evidencia y etiqueta entre corchetes)" }],
    dyads: [{ name: "string", formula: "EmociónA + EmociónB", type: "Primaria|Secundaria", text: "string", risk: "CRÍTICO|ALTO|MEDIO|BAJO", score: 0 }],
    dyadInterp: "string (párrafo 90-140 palabras; usa <b>)",
    problematics: ["string"],
    fears: ["string"],
    prides: ["string"],
    quotes: [{ text: "string (cita textual ciudadana; si es paráfrasis marca para:true)", topic: "string", emotion: "string", territory: "string (zona + medio o grupo donde se dijo + mes)", para: false }],
    temasTitulo: "string (ej. 'Distribución temática del corpus (estimación SIE · ≈230 unidades)')",
    temasChart: [["string (tema)", 0, "#hex"]],
    semaforo: [{ label: "string", val: "string (ALTO|MEDIO-ALTO|MEDIO|BAJO|ALTA|MEDIA|BAJA|CRÍTICO)", color: "#hex" }],
    ive: {
      val: 0, cls: "ESTABLE|MODERADO|VOLÁTIL|CRÍTICO", hor: "string (ej. '30–60 días')", color: "#hex",
      parts: [["A · Emociones de riesgo (detalle de intensidades = X/12)", 0, 0.35], ["B · Díadas de alto riesgo activas (cuáles)", 0, 0.25], ["C · Velocidad de cambio (detalle)", 0, 0.20], ["D · Detonantes (cuáles y cuándo)", 0, 0.20]],
      note: "string (cómo se estimó y sus limitaciones)"
    },
    sintesis: "string (síntesis Plutchik · Haidt · Westen · Lakoff, 100-150 palabras; usa <b>; cierra con 'Concepto refinado: <b>...</b>')",
    preguntaPolitica: "string (la pregunta que decide la elección, ej. '¿Quién gobierna para las tres islas?')",
    preguntaDesc: "string",
    govSemaforo: [{ label: "string (indicador + fuente y fecha, ej. 'Aprobación de la alcaldesa (Quiosco Digital, oct-26)')", val: "string (cifra o nivel, ej. '46% · ↓ de 50%', 'CRÍTICO')", color: "#hex" }],
    partidos: [{ nombre: "string", emocion: "string", capital: "string (rangos de sondeos publicados con su casa, o nivel cualitativo con [inferencia analítica])", tendencia: "string (flecha ↑/↓/→ + frase corta)", color: "#hex (color del partido)" }],
    partidosChart: [[0, 0, 0]],
    partidosNote: "string (de dónde salen las cifras y qué es estimación analítica; usa <b>)",
    haidt: [["string (Emoción (intensidad), ej. 'Ira (3)')", "string (fundación moral)", "string (valor violado)", "string (narrativa activada, síntesis entre «»)"]],
    haidtNote: "string",
    westen: [["Villano|Víctima|Héroe", "string (quién ocupa el rol)", "string (emociones asociadas)", "#hex"]],
    westenMeta: "string (metáfora dominante y principio moral; usa <b>)",
    lakoff: [["string (A · «frame»)", "string (quién lo sostiene)", "string (emociones que activa)", "GANA|DEFIENDE|EMERGENTE|MINORITARIO"]],
    lakoffUsar: "string (lenguaje que activa el frame favorable al cliente)",
    lakoffEvitar: "string (lenguaje que refuerza el frame adverso)",
    transfer: [{ em: "string (EMOCIÓN (intensidad))", color: "#hex", o: "string (origen: hechos)", c: "string (canal: la frase o el medio por donde viaja)", d: "string (destino)", t: "string (tipo: Directa / Circular / Difusa / Destino VACANTE)" }],
    transferCliente: "string (posición del cliente en el mapa de transferencia: destino, captura, bypass y acción; usa <b>)",
    actores: [
      { name: "string (nombre completo real)", role: "string (cargo · partido · rasgo)", partido: "string", borderColor: "#hex",
        rows: [["string (etiqueta, ej. 'Aprobación (Quiosco)')", "string (dato con fuente y etiqueta [verificado]/[publicado]/[inferencia analítica])"]] }
    ],
    actoresRadar: { labels: ["string (nombre corto del actor)"], data: [[0, 0, 0, 0, 0, 0]], colors: ["#hex"] },
    actoresNote: "string (cómo se construyó el radar; usa <b>)",
    encuestasTitulo: "string (ej. 'Sondeos publicados — partidos e internas (jul–oct 2026)')",
    encuestas: [["string (casa encuestadora)", "string (levantamiento)", "string (método y muestra, o 'sin metodología publicada')", "string (intención por partido / aprobación, tal cual se publicó)", "string (internas / aspirantes)"]],
    encuestasNota: "string (advertencias de comparabilidad entre casas)",
    tendencia: { titulo: "string", labels: ["string (mes)"], series: [{ label: "string", data: [0], color: "#hex", dash: false }] },
    segIntro: "string (metodología N × E × I, a quién se asigna el Leal Activo y prioridad de inversión; usa <b>)",
    segJer: [["string (código · tipo, ej. 'T4 · Indeciso Evaluador')", "string (acción, ej. 'PERSUADIR')", "●●●●●|●●●●○|●●●○○|●●○○○|○○○○○", "#hex (color del segmento)"]],
    segmentos: [
      { tipo: "string (ej. 'T4 · INDECISO EVALUADOR')", color: "#hex", nombre: "string (nombre evocador, ej. 'La Mamá del Ex Rancho San Dimas')", sub: "string (una línea)",
        peso: "string (ej. '32%')", pers: "string (ej. 'MUY ALTA · PERSUADIR', 'YA ES NUESTRO · MOVILIZAR', 'NULA · NO INVERTIR')",
        frase: "string (frase arquetípica del segmento)", fraseNota: "string (de qué evidencia se construyó la frase; aclara si no es cita textual)",
        c1: [["Edad y género", "string"], ["Zona", "string"], ["Ocupación", "string"], ["Escolaridad / ingreso", "string"], ["Presencia digital", "string"], ["Historia electoral", "string"]],
        c2: [["Emoción Plutchik", "string"], ["Tensión activa", "string"], ["Dolor profundo", "string"], ["Miedo", "string"], ["Orgullo", "string"], ["Narrativa maestra", "string"]],
        c3: [["Problemas críticos", "tags:Problema|#hex,Problema|#hex,Problema|#hex"], ["Consumo digital", "string"], ["Lo activa", "string"], ["Lo aleja", "string"], ["Frame cognitivo", "string"], ["Palanca", "string"]],
        vector: "string (canal · tono · formato)" }
    ],
    segTabla: [["Género|Generación|Zona|NSE", "string (segmento)", "string (emoción dominante)", "Alta|Media-alta|Media|Baja", "string (detonante)", "string (implicación para el cliente)"]],
    segTablaNote: "string (qué es inferencial y qué segmentos conviene levantar en campo; usa <b>)",
    codigoTitulo: "string (el código simbólico en una frase entre «», ej. '«La isla sin laguna que recibe la basura de otros»')",
    codigo: "string (párrafo del código simbólico, liderazgo que resuena y liderazgo que se rechaza; usa <b>)",
    arqCol: [["Dominante|Secundario|Emergente|Rechazado", "string (arquetipo con descriptor local, ej. 'El Huérfano (vecino abandonado)')", "string (evidencia con medio y fecha)", "#hex"]],
    arqScores: [["string (arquetipo político: Cuidador, Gobernante, Madre protectora, Héroe, Guerrero, Sabio, Rebelde, Padre, Explorador, Mago)", 0]],
    arqIdeal: { gan: "string (1º arquetipo)", ganTxt: "string (por qué resuena)", ganRiesgo: "string (riesgo de sobreactuación)", seg: "string (2º arquetipo)", segTxt: "string", segRiesgo: "string" },
    arqActores: [["string (aspirante, mismo nombre que en 'actores')", "string (arquetipo que proyecta, con su frase o señal)", "string (resonancia con el ideal: Alta/Media/Baja + por qué)"]],
    arqNote: "string (combinación óptima para el cliente; usa <b>)",
    miedos: [["string (miedo)", "string (evidencia concreta con medio y fecha)", "string (lectura política)", 0, "ver|ofi|inf"]],
    deseos: [["string (deseo)", "string (evidencia)", "string (lectura política)", 0, "ver|ofi|inf"]],
    necesidades: [["string (necesidad simbólica)", "string (evidencia)", "string (lectura política)", "ver|ofi|inf"]]
  }, null, 2),

//TENSIONES (v3 · estructura Cuautitlán Izcalli). La parte 2 (socioafectiva) se separa abajo.
  tensiones: JSON.stringify({
    meta: { municipio: "string (municipio/entidad evaluada, ej. 'Cuautitlán Izcalli')", estado: "string (ej. 'Estado de México')", cargo: "string (ej. 'Presidente Municipal')", actor: "string (nombre completo del titular del gobierno)", actorCorto: "string (apellidos, ej. 'Serrano Palacios')", partido: "string (partido o coalición, ej. 'Morena-PT-PVEM')", periodoGobierno: "string (ej. '2025–2027')", ventana: "string (ej. '14 junio – 14 octubre 2026')", ventanaMeses: "string (ej. 'junio–octubre 2026')", ventanaCorta: "string (ej. 'Jun–Oct 2026')", fuentes: "string (medios consultados separados por ' · ')", stsGlobal: 0 },
    lecturaRadar: "string (lectura estratégica del radar: 110-170 palabras, usa <strong> para resaltar)",
    ranking: [
      { nombre: "string (tensión con su referente concreto, ej. 'Agua intermitente, tandeos y pozos fuera de servicio')", emocion: "string (ej. 'Hartazgo + Ira')", intensidad: 4, narrativa: "string (frase ciudadana corta, sin comillas)", actor: "string (actor responsabilizado; cadena 'A — B — C' si hay varios)", territorio: "string (colonias o zonas concretas)", potencial: "string (potencial político de la tensión)", evidencia: ["string (dato con medio, fecha e ICF entre paréntesis, cerrado con [V] o [OFICIAL])"], lectura: "string (lectura estratégica 50-80 palabras)" }
    ],
    emociones: [{ nombre: "string (ej. 'Ira / indignación')", intensidad: 4, porcentaje: 0, color: "rojo|naranja|amarillo|violeta|cian|verde", tendencia: "string (flecha + palabra, ej. '↑ Creciente', '→ Estable alto')", lectura: "string (una línea con su anclaje concreto)" }],
    hallazgoEmocional: "string (100-150 palabras; usa <strong>)",
    narrativas: [{ nombre: "string (la narrativa en voz ciudadana)", potencial: 0, tema: "string", actor: "string", politica: "string (potencial político)", frase: "string (cita textual entre “ ” o 'Paráfrasis:' / 'Síntesis:' si no hay cita literal)", origen: "string (quién/dónde · medio, fecha · ICF)" }],
    territorios: [{ nombre: "string (colonias/zonas concretas)", nivel: "Rojo|Naranja|Amarillo", emocion: "string", tension: "string", observacion: "string (50-90 palabras con hechos, fechas y (medio, ICF))" }],
    riesgos: [{ tension: "string (nombre corto de la tensión)", srr: 0, actor: "string (actor expuesto)", tipoSenal: "string", probabilidad: "string (Alta/Media/Baja + horizonte)", consecuencia: "string (qué pasa si no se atiende)" }],
    trayectoriaLabels: ["string (corte)"],
    trayectoria: [{ nombre: "string (nombre corto, MISMO orden que ranking)", valores: [0], tipo: "Persistente|Recurrente|Estacional|Nueva", velocidad: "Acelerada|Creciendo|Estable|Bajando" }],
    hallazgoTrayectoria: "string (100-150 palabras; usa <strong>)",
    alertas: [{ titulo: "string", nivel: "rojo|naranja", rows: [["Territorio", "string"], ["Emoción", "string"], ["Actor expuesto", "string (incluye SRR)"], ["Qué ocurrió", "string (cronología con fechas)"], ["Narrativa activa", "string"], ["Fuente verificadora", "string (medios, fechas, ICF)"], ["Riesgo", "string (nivel — por qué)"], ["Escalamiento", "string (probabilidad, horizonte y detonante)"]] }],
    dolores: [{ nombre: "string (el dolor en lenguaje ciudadano, ej. 'Que nadie se haga cargo')", intensidad: 0, territorio: "string", emocion: "string", causa: "string (causa percibida)", herida: "string (la herida simbólica)" }],
    ias: { valor: 0, nivel: "ALTA|MEDIA|BAJA", componentes: [["Intensidad", 0], ["Extensión", 0], ["Culpa asignada", 0], ["Organización", 0], ["Detonante", 0]], nota: "string (cómo se calcula y qué componente pesa más/menos)" },
    enemigos: [{ nombre: "string (figura simbólica en lenguaje ciudadano, ej. 'El que se pasa la responsabilidad')", carga: 0, quien: "string (quién lo nombra)", lectura: "string (40-70 palabras)" }],
    lecturaEnemigos: "string (60-90 palabras; usa <strong>)",
    fracturas: [{ a: "string (polo A)", b: "string (polo B)", descripcion: "string (40-70 palabras con evidencia)", intensidad: "Crítica|Alta|Media-Alta|Media|Baja" }],
    segmentos: [{ nombre: "string (nombre evocador, ej. 'La Mamá de la Unidad')", peso: 0, sub: "string (zonas · perfil)", frase: "string (cita “ ” o 'Síntesis: «...»')", fraseNota: "string (fuente o 'Frase arquetípica, no cita textual')", emocion: "string", dolor: "string", enemigo: "string (uno de los enemigos simbólicos)", simbolo: "string", detona: "string", desactiva: "string", activacion: 0, confianza: 0 }],
    hallazgoSegmentacion: "string (90-130 palabras; usa <strong>)",
    preguntas: [{ pregunta: "string", respuesta: "string (2-4 líneas; usa <b>)", evidencia: "string" }]
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

function buildPrompt({ skill, actorName, actor2Name, actoresNombres, datosPorActor, mes, anio, periodo, clienteName = '', parteOpositor = 1, parteTensiones = 1, parteEmociones = '', contextoTensiones = '', actoresRef = [], datosActor1, datosActor2, schema }) {
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
    ? `\nReglas adicionales OBLIGATORIAS para este análisis emocional de ${actorName}:\n- ANCLAJE AL CONTEXTO REAL: antes de redactar, identifica en las fuentes crudas (a) el cargo o aspiración actual de ${actorName}, (b) el municipio/estado/región donde ejerce o compite, y (c) los hechos recientes más repetidos (fechas, lugares, cifras, obras, escándalos, declaraciones, medios que los reportan). TODO el reporte debe girar alrededor de ESOS hechos concretos, no de generalidades sobre "la política en México".\n- PROHIBIDO el texto intercambiable: si una frase podría pegarse tal cual en el reporte de otro político o de otro municipio, está mal. Cada párrafo (subtitle, resumenEjecutivo, dyadInterp, preguntaDesc, textos de díadas, segmentos, semiótica, actores) debe nombrar al menos un hecho, lugar, actor, cifra o medio tomado de las fuentes crudas. Cita el medio o la fecha cuando exista (ej. "según [medio], [mes]").\n- ACTORES REALES DEL TERRITORIO: en "actores", el primer elemento es ${actorName}; los demás deben ser las personas que REALMENTE intervienen en la contienda o en el gobierno de ESE municipio/región: rivales de otros partidos, titular saliente o en turno, dirigentes locales/estatales de los partidos relevantes, o figuras que las fuentes crudas mencionan junto a ${actorName}. Prioriza los nombres que aparecen literalmente en las fuentes crudas. Si hay ACTORES POLÍTICOS DE REFERENCIA indicados por el analista, ESOS son los actores. Si no, usa SOLO nombres que aparezcan literalmente en las fuentes crudas (incluidas las de "contexto-actores": sondeos, encuestas, notas de aspirantes). Tu conocimiento interno sobre aspirantes, alcaldes o regidores locales puede estar DESACTUALIZADO para este periodo: NO lo uses para poner nombres de personas. Si no puedes asegurar un nombre con las fuentes, usa el cargo y partido (ej. "Aspirante de Morena a la alcaldía de [municipio] — sin identificar en fuentes") en vez de inventar o adivinar.\n- "territory" y "subtitle" deben reflejar el municipio/estado y cargo reales detectados (ej. "Michoacán · Candidata a ..."), nunca el país genérico "México".\n- "quotes", "problematics", "fears" y "prides" deben provenir de lo que la ciudadanía y los medios dicen sobre ESE territorio en las fuentes crudas; si una fuente trae una frase textual, úsala (acortada) en vez de parafrasear en genérico.\n- Si las fuentes crudas son escasas para un campo, dilo en el texto en términos cualitativos y prudentes ("las fuentes disponibles apuntan a...") en vez de rellenar con frases de manual o inventar cifras.\n- CLIENTE DEL ESTUDIO: ${clienteName ? `"${clienteName}". Todo lo que diga "cliente" (transferCliente, segmentos c3 "Lo activa", segTabla "implicación para el cliente", segIntro, arqNote, lakoffUsar, subtitle) se refiere a ${clienteName}; escribe "cliente": "${clienteName}".` : 'no se especificó. Toma como cliente al partido que hoy gobierna el territorio (o al partido de ' + actorName + ' si es una persona) y escribe su nombre en "cliente".'}\n- ETIQUETAS DE EVIDENCIA (obligatorias en detonantes, actores, secundarias, sondeos y miedos/deseos): cierra cada dato con su etiqueta entre corchetes: [verificado] = hecho con fuente pública fechada; [publicado] = cifra de un sondeo o encuesta publicada; [declaración oficial] = cifra o dicho del gobierno sin verificación independiente; [señal única] o [fuente única] = aparece en una sola fuente; [señalamiento sin resolución] = acusación no probada; [inferencia analítica] = lectura del equipo SIE. Nunca presentes una inferencia como hecho.\n- CIFRAS DE ENCUESTA: solo las que aparezcan en las fuentes crudas, tal cual se publicaron y con su casa y fecha. PROHIBIDO inventar porcentajes de intención de voto, aprobación o internas; si no hay sondeos, dilo y deja vacíos "encuestas" y "tendencia".\n- SEÑALAMIENTOS GRAVES: denuncias, acusaciones o vínculos con delitos solo si están en las fuentes, marcados como [señalamiento sin resolución]; nunca por parentesco, homonimia o rumor. Si una actora es mujer, no construyas lecturas sobre su género, familia o apariencia (violencia política en razón de género).`
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
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Emociones):\n- "emotions.intensity" es un ENTERO de escala fija 0-3: 0 = inactiva (sin evidencia real), 1 = baja, 2 = media, 3 = alta. DISTRIBUYE intensidades realistas y VARIADAS: 1-2 emociones en 3 (las dominantes), 2-4 en 2, el resto en 1 o 0. PROHIBIDO poner intensity:3 a todas. "emotions.sublabel" es una línea PROPIA del territorio (qué emoción, contra quién y dónde), nunca la definición genérica. Cada trigger cierra con su etiqueta de evidencia entre corchetes.\n- "dyads": OBLIGATORIO, EXACTAMENTE 3. Una díada es la COMBINACIÓN de dos emociones activas que produce una dinámica política nombrable: "name" (ej. "Desprecio", "Resentimiento", "Ansiedad"), "formula" ("Ira + Asco"), "type" ("Primaria" la dominante, "Secundaria" las demás), "text" (mecanismo político de la combinación con hechos y a quién castiga o favorece), "risk" (CRÍTICO/ALTO/MEDIO/BAJO) y "score" 0-100. Constrúyelas con las emociones de mayor "intensity".\n- "dyadInterp": párrafo que interpreta las 3 díadas juntas para el cliente (dónde está el riesgo y dónde la oportunidad), con <b>.\n- "temasChart" es un ARRAY DE ARRAYS ["tema", porcentaje, "#hex"], porcentajes que suman 100.\n- "quotes": usa frases textuales de las fuentes (acortadas) con "territory" = zona + medio o grupo + mes; si una frase es paráfrasis, "para": true.\n- "ive" (Índice de Volatilidad Emocional): "parts" = [etiqueta con detalle, valor 0-100, peso]; la etiqueta A suma las intensidades de Ira, Miedo, Asco y Tristeza (ej. "A · Emociones de riesgo (Ira 3 + Miedo 2 + Asco 2 + Tristeza 2 = 9/12)"); "val" = suma de valor × peso, redondeado; "cls" = ESTABLE (<40), MODERADO (40-59), VOLÁTIL (60-79) o CRÍTICO (80+); "color" acorde (#22c55e, #eab308, #f97316, #ef4444); "note" dice si hay o no un estudio previo comparable y cómo se estimó la velocidad de cambio.\n- "sintesis": integra Plutchik (emoción dominante), Haidt (fundación moral), Westen (villano, víctima, héroe) y Lakoff (frame que gana y frame emergente) en un solo párrafo con <b>; cierra con "Concepto refinado: <b>...</b>".\n- "partidos": "capital" son las cifras de intención de voto de los sondeos publicados en las fuentes, con su casa (ej. "20–22% (Quiosco) · 22.2% (IEP)"); si no hay sondeos, un nivel cualitativo seguido de [inferencia analítica]. "partidosChart" en el MISMO orden, cada fila [ira/asco, decepción/tristeza, interés disponible] en 0-100 (estimación analítica). "partidosNote" aclara de dónde salen las cifras y que la carga emocional es estimación.\n- "haidt": una fila por emoción activa principal [Emoción (intensidad), fundación moral (Cuidado/Daño, Equidad, Lealtad, Autoridad, Santidad/Degradación, Libertad), valor violado, narrativa activada entre «»]; "haidtNote" aclara que las narrativas son síntesis, no citas.\n- "westen": EXACTAMENTE 3 filas [rol, quién lo ocupa con hechos, emociones asociadas, color] con roles Villano (#ef4444), Víctima (#a78bfa) y Héroe (#22c55e); si nadie ocupa el héroe escribe "VACANTE en la política" y quién lo ocupa moralmente. "westenMeta" = metáfora dominante y principio moral.\n- "lakoff": EXACTAMENTE 3 frames [«frame», quién lo sostiene, emociones que activa, estado] con estado GANA (el que domina hoy), DEFIENDE (el del gobierno) y EMERGENTE o MINORITARIO; "lakoffUsar" y "lakoffEvitar" son listas de palabras y fórmulas concretas para el cliente.\n- "transfer": una fila por emoción dominante {em: "IRA (3)", color, o: hechos que la originan, c: la frase o canal por donde viaja entre «», d: a quién llega (primario · secundario), t: tipo (Directa — con nombre y apellido / Circular — puede rebotar / Difusa — riesgo de abstención / Destino político VACANTE)}. "transferCliente" responde, desde la posición de ${clienteName ? clienteName : 'el cliente'}: si es destino de la emoción negativa, qué emociones puede capturar, riesgo de bypass y acción concreta, con <b>.\n- "actores": PROHIBIDO usar placeholders genéricos como "Competidor A". Si "${actorName}" es una PERSONA, "actores[0].name" es EXACTAMENTE "${actorName}"; si es un TERRITORIO, los actores son las personas reales que gobiernan o disputan ese territorio (titular, la candidatura cliente y sus competidores internos, aspirantes de las demás fuerzas), sin poner el nombre del territorio como actor. Tómalos de los ACTORES POLÍTICOS DE REFERENCIA si existen o de las fuentes crudas (incluido "contexto-actores"); NO uses tu memoria para nombres de aspirantes locales. "role" = cargo · partido · rasgo; "rows" = EXACTAMENTE 6 filas [etiqueta propia del dato (ej. "Aprobación (Quiosco)", "Interna PAN (IEP, ago)", "Huella digital", "Agenda", "Pasivos"), valor con cifra, medio y fecha cerrado con su etiqueta de evidencia]; la sexta fila siempre es ["Rol narrativo", "... [inferencia analítica]"]. "borderColor" = color de su partido.\n- "actoresRadar": hasta 6 actores (los más relevantes), "labels" con nombre corto + partido (ej. "Ale Castro (PRI)"), "data" ARRAY DE ARRAYS con 6 valores 0-100 por actor, "colors" del partido. "actoresNote" aclara que el radar es estimación analítica y qué significa "riesgo de castigo".\n- "encuestas" y "tendencia": transcribe ÚNICAMENTE sondeos, encuestas o ejercicios digitales que aparezcan en las fuentes crudas, con su casa, fecha y cifras TAL CUAL se publicaron; PROHIBIDO inventar o estimar cifras de encuesta. Si el ejercicio no es representativo (reacciones, autoselección), dilo en "método". "tendencia" solo si hay 2 o más mediciones de la misma casa: "labels" = meses y una "series" por indicador (aprobación, desaprobación, partidos, aspirante del cliente; "dash": true para partidos); usa null donde no hubo medición. Sin sondeos en las fuentes: "encuestas": [] y "tendencia": {"labels": [], "series": []}.\n- "arqCol" (arquetipo colectivo): EXACTAMENTE 4 filas [rango, arquetipo con descriptor local, evidencia con medio y fecha, color] con rangos Dominante (#ef4444), Secundario (#3b82f6), Emergente (#22c55e) y Rechazado (#64748b — la sombra que la ciudadanía castiga).\n- "arqScores": los 10 arquetipos políticos (Cuidador, Gobernante, Madre protectora, Héroe, Guerrero, Sabio, Rebelde, Padre, Explorador, Mago) con resonancia 0-100, de mayor a menor. "arqIdeal" desarrolla el 1º ("gan") y el 2º ("seg") de "arqScores": por qué resuenan con el arquetipo colectivo y su riesgo de sobreactuación.\n- "codigoTitulo" y "codigo": el código simbólico del territorio (qué significa el lugar hoy, qué liderazgo resuena y cuál se rechaza), con <b>.\n- "arqActores": una fila por aspirante de "actores" [nombre, arquetipo que proyecta con su frase o señal, resonancia con el ideal (Alta/Media-alta/Media/Media-baja/Baja + por qué)]. "arqNote" = combinación óptima de arquetipos para el cliente.\n- "segmentos" (SEGMENTA · Buyer Personas): 4 personas reales y reconocibles del territorio con nombre evocador ("La Mamá del Ex Rancho San Dimas"); "tipo" en mayúsculas con código (T1 · LEAL ACTIVO, T4 · INDECISO EVALUADOR, T6 · APÁTICO POTENCIAL, T5 · ADVERSARIO SIMBÓLICO); "pers" = persuabilidad · acción (YA ES NUESTRO · MOVILIZAR, MUY ALTA · PERSUADIR, ALTA · ACTIVAR CON DOLOR PROPIO, NULA · NO INVERTIR); "peso" en %; "frase" arquetípica y "fraseNota" que explica de qué evidencia se construyó y si no es cita textual; c1/c2/c3 con 6 filas concretas, nunca intercambiables entre segmentos; en c3 la fila "Problemas críticos" usa el formato "tags:Problema|#hex,Problema|#hex"; "vector" = canal · tono · formato.\n- "segJer": las 4 filas del orden de inversión [código · tipo, acción, puntos ●●●●● a ○○○○○, color del segmento], de mayor a menor prioridad (normalmente T4 → T6 → T1 → T5).\n- "segTabla": filas por eje Género (Mujeres, Hombres), Generación (Gen Z 18–26, Millennials 27–42, Gen X 43–58, Boomers 59+), Zona (4 zonas reales del territorio) y NSE, cada una [eje, segmento, emoción dominante, intensidad, detonante, implicación para el cliente]. "segIntro" es el párrafo metodológico N × E × I (a quién se asigna el Leal Activo, cómo se triangularon los pesos). "segTablaNote" aclara que la segmentación es inferencial.\n- "miedos" y "deseos": cada elemento [título, evidencia concreta (cifra, medio, fecha o cita), lectura política, intensidad simbólica 0-100, etiqueta "ver" (verificado) | "ofi" (declaración oficial) | "inf" (inferencia analítica)], ordenados de mayor a menor intensidad. "necesidades": [título, evidencia, lectura política, etiqueta]. Los 30 elementos son distintos entre sí y propios del territorio.`
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
    : skill === 'radar'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (RADAR):
- Etiquetas de evidencia: [V] = verificado en una fuente fechada; [E] = estimación analítica RADAR (NPS-P, pesos, cruces, índices); [H] = hipótesis por validar. Cierra con [V] o [H] los textos que lo requieran; "ev" de "cronologia" y "narrativas" es solo la letra.
- meta: si el actor es una PERSONA, "nombre" es su nombre completo real; "subtitulo" = cargo o aspiración · partido o coordinación · territorio · Periodo <ventana> · Corte dd/mm/aaaa.
- NPS-P (aprobación neta) va de -100 a 100. Los valores de un mismo segmento deben ser coherentes en todas las pestañas (npsPartido, hallazgosSent, narrativas, riesgos, cruces y territorial).
- Usa los MISMOS nombres de grupo en todas las gráficas (ej. "Ex-PRI", "Milit. PAN", "Simp. PAN", "Indep.", "Morena"; "Facebook", "X", "Instagram", "TikTok", "WhatsApp", "YouTube"): el color de cada grupo se asigna por su nombre.
- picos y cronologia: los picos coinciden con eventos fechados de "cronologia"; la fecha de cronología en mayúsculas indica si fue PICO MÁXIMO (100), SEGUNDO PICO, etc.
- cronologia: hechos reales de las fuentes con medio y fecha; el antecedente fuera de periodo, si existe, se marca "· ANTECEDENTE (FUERA DE PERIODO)".
- plataformas: los números son estimación [E] sin acceso a APIs; no inventes seguidores ni handles: si no se identifican cuentas propias, dilo.
- narrativas: "titulo" corto (la narrativa en sí, entre «» si es frase); "descripcion" con el hecho y su fuente; "bivariado" explica en qué segmentos funciona y en cuáles no, con cifras.
- cruces.interna: si el actor compite en una interna, compara a los aspirantes; si gobierna, compara su aprobación contra los principales rivales por segmento ("titulo" y "sub" lo dicen).
- territorial: zonas, colonias o pueblos REALES del municipio, nunca genéricos ("Zona 1").
- modulos: "modulosVariante" = "VARIANTE A — GOBERNANTE EN FUNCIONES" o "VARIANTE B — ASPIRANTE EN COMPETENCIA"; cada módulo con datos concretos (medios, fechas, nombres) y cerrado con [V] o [H].
- escenarios: "nps" es el NPS-P esperado al día 90; "nivel" con emoji (🟢 Estable, 🟡 Amarilla, 🟠 Naranja, 🔴 Roja).
- veredicto.final empieza con el emoji del nivel actual y coincide con "meta.alerta".
- Las cifras de encuestas solo si aparecen en las fuentes, con su casa y fecha; nunca las inventes.`
    : skill === 'tensiones' && parteTensiones === 2
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Tensiones · SOCIOAFECTIVA — pestañas "Dolores, enemigos y fracturas", "Segmentación socioafectiva" y "Las 9 preguntas"):
- En esta llamada generas ÚNICAMENTE los campos de la cartografía socioafectiva (dolores, ias, enemigos, lecturaEnemigos, fracturas, segmentos, hallazgoSegmentacion, preguntas). Tensiones lee el conflicto institucional; la socioafectiva lee la vivencia emocional de la gente y sus heridas.
- "dolores": cada dolor en lenguaje ciudadano ("Pagar y no recibir agua", "Que un hijo salga y no regrese"), con "territorio" concreto, "emocion" (dos emociones con '·'), "causa" percibida con hechos y "herida" simbólica (ej. "Orfandad institucional: la casa no tiene quien la cuide").
- "ias" (Índice de Activación Socioafectiva): 5 componentes 0-10 (Intensidad, Extensión, Culpa asignada, Organización, Detonante) y "valor" = su promedio con un decimal.
- "enemigos": FIGURAS SIMBÓLICAS en lenguaje ciudadano ("La autoridad que levanta o extorsiona", "El que se pasa la responsabilidad", "«Los de antes»"), NUNCA el nombre propio de una persona; "quien" = quiénes lo nombran; "lectura" = por qué concentra el dolor y a quién le cuesta políticamente. "lecturaEnemigos" interpreta el conjunto.
- "fracturas": dos polos concretos del territorio ("Unidades habitacionales" ⇄ "Fraccionamientos de clase media", "Ciudadano" ⇄ "Policía") con descripción y evidencia.
- "segmentos": 6 personas socioafectivas reconocibles con nombre evocador ("La Mamá de la Unidad", "El Joven de Pueblo", "El Leal Institucional"); "sub" = zonas · edad; "frase" textual con su fuente en "fraseNota", o "Síntesis: «…»" con "Frase arquetípica, no cita textual"; "enemigo" debe ser uno de "enemigos"; "activacion" (energía afectiva) y "confianza" (en instituciones) 0-10 con variación real entre segmentos. "hallazgoSegmentacion" compara los segmentos más grandes y el más activado.
- "preguntas": respuestas ejecutivas con <b> en la idea central y "evidencia" concreta (cifras, casos, fechas o referencias a las alertas).
- Usa los MISMOS nombres de tensiones, zonas y actores de la parte 1.
${contextoTensiones ? '\nCONTEXTO DE LA PARTE 1 (Tensiones ya generadas — mantén coherencia de nombres):\n' + contextoTensiones : ''}`
    : skill === 'tensiones'
    ? `\nINSTRUCCIONES DE ESTRUCTURA CRÍTICAS (Tensiones):\n- CONSISTENCIA ENTRE PESTAÑAS (crítico): "ranking", "riesgos" y "trayectoria" hablan de las MISMAS tensiones en el MISMO orden. El último número de "trayectoria[].valores" es el "score" de esa tensión (STS 0-100) y el penúltimo es el del periodo anterior: de ahí sale el "Δ vs. periodo anterior" que se muestra en el ranking. No inventes puntos intermedios sin base: si no hay evidencia para un corte, estima con prudencia (estimación SIE) a partir de los hechos fechados.\n- "ranking[].evidencia" es una LISTA de 2-5 datos; cada uno con cifra, colonia o nombre, entre paréntesis el medio, la fecha y el ICF (Índice de Confiabilidad de Fuente 1-5), y al final [V] si está verificado en una fuente fechada u [OFICIAL] si es cifra o dicho del gobierno no verificado de forma independiente. Ej.: "CFE suspende energía al cárcamo Ex Hacienda San Miguel (corpus de prensa, 25-jun, ICF 3.6) [V]".\n- "ranking[].lectura" es la interpretación estratégica (no repite la evidencia): dónde está el riesgo real, qué la puede escalar y por qué.\n- "ranking[].intensidad" es 1-5 y "ranking[].emocion" dos emociones con '+'.\n- "emociones[].color": rojo (ira), amarillo (miedo), naranja (desconfianza o resentimiento), violeta (tristeza), cian (asco), verde (solidaridad o esperanza).\n- "narrativas[].frase": cita textual entre “ ” cuando exista en las fuentes; si no, empieza con "Paráfrasis:" o "Síntesis:" y aclara que no es cita literal. "origen" = quién la dice o dónde + medio, fecha + ICF.\n- "territorios[].nivel": "Rojo" = hecho violento, pérdida de vidas o tensión con score ≥75; "Naranja" = tensión activa 55-74 o riesgo sostenido; "Amarillo" = tensión latente. "observacion" cierra con (medio, ICF).\n- "riesgos[].tipoSenal" describe el origen de la señal (Orgánica, Dato oficial INEGI + conversación política, Orgánica + colectivos, etc.) y "probabilidad" su probabilidad de escalar con horizonte (ej. "Alta — 30 días").\n- "trayectoria[].velocidad" se asigna por el último cambio: "Acelerada" si subió 10 o más, "Creciendo" si subió de 1 a 9, "Estable" si quedó igual o cambió poco, "Bajando" si bajó. "tipo": Persistente, Recurrente, Estacional o Nueva.\n- "alertas": las 3 tensiones con mayor riesgo de escalar; "Qué ocurrió" es una cronología con fechas; "Escalamiento" dice probabilidad, horizonte y el detonante concreto (con fecha si existe).\n- Las cifras de aprobación o encuestas solo si aparecen en las fuentes, con su casa y fecha; nunca las inventes.`
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
      + '\n- NO generes "dolores", "ias", "enemigos", "lecturaEnemigos", "fracturas", "segmentos", "hallazgoSegmentacion" ni "preguntas" en esta respuesta: se generan en una llamada aparte. Usa todo tu espacio para las 7 primeras pestañas de Tensiones.'
    : txt;
  // Emociones en partes: cada llamada solo recibe las reglas de SUS campos
  // (A = Flor/Mapa/Díadas/Identidad/Actores, B = Segmentos/Semiótica), para
  // no gastar tokens de salida en campos que no le tocan.
  const esLineaB = (l) => (REGEX_PARTE_B[skill] || /$^/).test(l);
  const esLineaC = (l) => (REGEX_PARTE_C[skill] || /$^/).test(l);
  const filtrarEmociones = (txt) => {
    if (!PARTES_B[skill] || !parteEmociones || parteEmociones === 'FALTANTES') return txt;
    return txt.split('\n').filter(l => !/^\s*-\s/.test(l) || (REGEX_GENERAL[skill] || /$^/).test(l)
      || (parteEmociones === 'B' ? esLineaB(l) : parteEmociones === 'C' ? esLineaC(l) : !esLineaB(l) && !esLineaC(l))).join('\n');
  };
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
${filtrarEmociones(requisitosCantidad)}${guardarropaEmociones}${guardarropaOpositor}${guardarropaSesgo}${guardarropaComparativo}${filtrarEmociones(instruccionesTensionesP1(instruccionesEstructura))}${(PARTES_B[skill] || (skill === 'tensiones' && parteTensiones === 1)) && contextoTensiones ? '\n\n' + contextoTensiones : ''}`;

  const bloqueActoresRef = (actoresRef && actoresRef.length)
    ? `\nACTORES POLÍTICOS DE REFERENCIA (indicados por el analista; son los actores REALES de la contienda — úsalos con estos nombres exactos en "actores", "partidos", "segmentos", "ranking" y donde aplique; NO los sustituyas por otros): ${actoresRef.join(' · ')}\n`
    : '';
  const user = `${bloqueActoresRef}Periodo evaluado: ${periodo.label} (del ${periodo.desde} al ${periodo.hasta})
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
REQUISITOS MÍNIMOS DE CANTIDAD (RADAR v2.1) — no entregues menos de esto:
- meta: todos los campos con los datos reales del actor; "nivel" 1-4 (1 VERDE estable, 2 AMARILLA riesgo acumulativo, 3 NARANJA crisis en formación, 4 ROJA crisis activa) coherente con "alerta".
- npsPartido: 5-7 segmentos partidistas reales del territorio (incluye la base propia, la militancia del partido, independientes y el partido rival), NPS-P de -100 a 100, de mayor a menor.
- npsDemo: EXACTAMENTE 6 barras: 18-29, 30-44, 45-59, 60+, ♂ Hombres, ♀ Mujeres.
- ratioPlataforma: 5-6 plataformas (crítica ÷ defensa; >1.5 = riesgo), de mayor a menor.
- tra: 8-18 cortes (semanas o quincenas del periodo) con su valor TRA, y "titulo" con la granularidad y el rango.
- sentimiento: "general" = [positivo, neutro, negativo, polarizado] que suma 100; "genero" con 4 valores (incluye polarizado); "edad" (18-29, 30-44, 45-59, 60+), "partido" (los mismos segmentos de npsPartido, 4-5), "plataforma" (4-5) y "audiencia" (3) con [positivo, neutro, negativo] que suman 100 por grupo.
- clima: % de clima favorable por grupo con los MISMOS grupos de "sentimiento"; "general" = Favorable, Mixto, Adverso, Inercial (suman 100).
- hallazgosSent: EXACTAMENTE 4 (GÉNERO, PARTIDO, EDAD y AUDIENCIA × SENTIMIENTO), con cifras de NPS-P y "accion".
- tom: "general" con 6-8 temas cuyo "valor" suma ~100; "genero", "edad" y "partido" con 5-6 temas y una serie por grupo (mismos grupos de "sentimiento"), con UN número por tema en cada serie.
- crucesTom: EXACTAMENTE 4 (GÉNERO, EDAD, PARTIDO y TERRITORIO × TEMA).
- picos: 10-18 cortes del periodo con "volumen" índice 0-100 (el mayor = 100) y "nps"; marca "alto" en los 1-2 picos principales y "negativo" en el pico de daño.
- cronologia: 7-10 eventos FECHADOS de las fuentes, en orden cronológico, cada uno con medio y si fue daño o beneficio.
- plataformas: "peso" 6 plataformas que suman 100; "tono", "edad" (4 franjas 18-29, 30-44, 45-59, 60+ que suman 100), "brecha", "viral" y "partido" con 5-6 plataformas; "lectura" EXACTAMENTE 6 tarjetas (una por plataforma; "alerta": true en la brecha más crítica).
- nube: 30-40 palabras con peso "v" 9-100; "lectura" obligatoria.
- hashtags: 10-12 con "indice" 0-100 (el mayor = 100); "hashtagResumen" obligatorio.
- narrativas: favorables 5, criticas 4 ("alerta": true solo en la más peligrosa), neutras 4; cada una con 1-3 tags y "bivariado".
- cruces: "edadGenero" 3 filas (♂ Hombres, ♀ Mujeres, Total); "partidoNarrativa" 6 narrativas × 5 segmentos (0-100); "partidoEdad" 4 series; "zonaGenero" 6-7 zonas; "interna" 5-6 segmentos con una serie por aspirante + "NS/Otro" que suman 100 por segmento; "temaTono" 6-7 temas; "hallazgos" EXACTAMENTE 2.
- riesgos: 6 (al menos 2 CRÍTICO o ALTO). oportunidades: 5 (MUY ALTA, ALTA o MEDIA). alertaSube: 5. alertaBaja: 5.
- territorial: "zonas" 8 zonas reales del municipio con "nps" numérico y "clase" coherente (favorable ≥ +10, inercial entre -9 y +9, adversa ≤ -10), ordenadas de favorable a adversa; "volumen" las mismas zonas en % que suman ~100; "bloques" EXACTAMENTE 3 (fuerte, disputa, adversa).
- modulos: EXACTAMENTE 6 (M-A Monitoreo de cuentas clave, M-B Amplificadores críticos, M-C Eventos detonantes, M-D Actores del escenario, M-E Comparativo electoral, M-F Brechas prioritarias).
- escenarios: EXACTAMENTE 3 (OPTIMISTA, BASE, PESIMISTA) con "prob" que suma 100.
- dictamen: 90-140 palabras. veredicto: los 6 campos llenos. recomendaciones: EXACTAMENTE 4 (dos de 0–15 DÍAS y dos de 15–60 DÍAS).
- fuentesTexto: obligatorio, solo con medios que aparezcan en las fuentes crudas.`,

  emociones: `
REQUISITOS MÍNIMOS DE CANTIDAD (EMOCIONES) — no entregues menos de esto:
- emotions: EXACTAMENTE 8 entradas (las 8 emociones base de Plutchik), "active:true" solo en las detectadas; cada activa con "sublabel" propio del territorio, 3-4 triggers (hecho + medio + fecha + etiqueta de evidencia) y 2-3 consequences.
- secondary: EXACTAMENTE 3 emociones secundarias, cada una con "color".
- dyads: EXACTAMENTE 3 díadas.
- problematics: mínimo 6; fears: mínimo 6; prides: mínimo 4 — cada uno anclado en un hecho específico (fecha, colonia, cifra, nombre).
- quotes: mínimo 8 frases ciudadanas, cada una con tema, emoción y lugar/medio/mes donde se dijo.
- temasChart: 6 temas con % que suman 100.
- semaforo: EXACTAMENTE 6 indicadores (estado emocional general, riesgo de voto de castigo, potencial de protesta, capital emocional positivo, legitimidad institucional, disposición al diálogo).
- ive: "val" 0-100 y "parts" con EXACTAMENTE 4 componentes [etiqueta con detalle, valor 0-100, peso] con pesos 0.35, 0.25, 0.20 y 0.20; "val" = suma de valor × peso.
- sintesis: un párrafo de 100-150 palabras.
- govSemaforo: EXACTAMENTE 6 indicadores del gobierno municipal (aprobación con fuente, servicios críticos, conflictos activos).
- partidos: mínimo 4 fuerzas políticas (incluye el gobierno local, la oposición y el espacio independiente / NS-NC); partidosChart con una fila por partido en el MISMO orden.
- haidt: 5 filas (una por emoción activa principal). westen: EXACTAMENTE 3 filas (Villano, Víctima, Héroe). lakoff: EXACTAMENTE 3 frames.
- transfer: 4 flujos (uno por emoción dominante).
- actores: 4 a 8 actores reales (titular del gobierno, la candidatura cliente y sus competidores internos, y los aspirantes de las demás fuerzas), cada uno con EXACTAMENTE 6 filas; la última fila es "Rol narrativo".
- actoresRadar: una serie por actor (máximo 6, los más relevantes) con 6 valores 0-100 en este orden: legitimidad ciudadana, presencia territorial, capital positivo, riesgo de castigo, capacidad de gestión, credibilidad.
- encuestas y tendencia: SOLO con sondeos que aparezcan en las fuentes; si no hay ninguno, "encuestas": [] y "tendencia": {"labels": [], "series": []}.
- arqCol: EXACTAMENTE 4 (Dominante, Secundario, Emergente, Rechazado).
- arqScores: EXACTAMENTE 10 arquetipos políticos con resonancia 0-100, de mayor a menor.
- arqActores: una fila por cada aspirante de "actores" (mismo nombre).
- segJer: 4 filas en orden de inversión. segmentos: EXACTAMENTE 4 buyer personas (T1 Leal Activo, T4 Indeciso Evaluador, T6 Apático Potencial, T5 Adversario Simbólico), "peso" en % que suma ~100, c1, c2 y c3 con 6 filas cada uno.
- segTabla: mínimo 12 filas (2 de Género, 4 de Generación, 4 de Zona, 2-3 de NSE).
- miedos y deseos: EXACTAMENTE 10 cada uno, ordenados por intensidad simbólica (0-100) de mayor a menor. necesidades: EXACTAMENTE 10.`,

  tensiones: `
REGLA ANTI-CORTE (OBLIGATORIA): este reporte tiene MUCHOS campos. Está PROHIBIDO dejar sin generar o vacíos los campos finales del JSON ("alertas", "hallazgoTrayectoria"). Si necesitas espacio, acorta párrafos, pero NUNCA omitas elementos ni listas.

REQUISITOS MÍNIMOS DE CANTIDAD (TENSIONES):
- meta: todos los campos llenos con los datos reales del territorio y del gobierno en turno; "stsGlobal" = score de tensión social del municipio (0-100), coherente con el ranking.
- ranking: 6-8 tensiones sociales distintas, ordenadas de mayor a menor score; cada una con "evidencia" de 2-5 datos y "lectura" propia.
- emociones: 6-8 emociones (ej. Ira / indignación, Miedo, Desconfianza, Resentimiento, Tristeza / abandono, Asco político, Solidaridad defensiva) con "porcentaje" que suma 100 e intensidad 1-5 VARIADA.
- narrativas: 6-8, ordenadas por "potencial" (0-100) de mayor a menor.
- territorios: 6-8 zonas concretas (nunca el municipio completo), con nivel Rojo, Naranja o Amarillo según severidad.
- riesgos: una por cada tensión del ranking, en el MISMO orden, con "srr" 0-100.
- trayectoria: las MISMAS tensiones del ranking en el MISMO orden (nombre corto), "valores" con un número por corte de "trayectoriaLabels"; el último valor es el score de esa tensión en el ranking.
- alertas: EXACTAMENTE 3 alertas prioritarias con las 8 filas del esquema; la primera "rojo" y las demás "rojo" o "naranja" según gravedad.
- lecturaRadar, hallazgoEmocional y hallazgoTrayectoria: párrafos de razonamiento estratégico específico, nunca frases sueltas.

REQUISITOS MÍNIMOS — SOCIOAFECTIVA (pestañas "Dolores, enemigos y fracturas", "Segmentación socioafectiva" y "Las 9 preguntas"):
- dolores: 6-8 dolores sociales con intensidad 1-10 variada, de mayor a menor.
- ias: "valor" 0-10 = promedio simple de los 5 componentes (0-10 cada uno); "nota" explica cuál pesa más y cuál menos.
- enemigos: 5-6 enemigos simbólicos con "carga" afectiva 0-100, de mayor a menor.
- fracturas: 5-7 líneas que dividen al municipio, cada una con su intensidad.
- segmentos: EXACTAMENTE 6 segmentos socioafectivos con "peso" en % que suma 100, "activacion" y "confianza" 0-10.
- preguntas: EXACTAMENTE 9, en este orden: "¿Qué siente la gente?", "¿Cuál es la herida emocional?", "¿A quién culpa?", "¿En quién confía?", "¿Qué teme perder?", "¿Qué desea / qué la uniría?", "¿Qué símbolo puede unirla?", "¿Qué narrativa puede movilizarla?", "¿Qué tema puede detonar crisis?".`,

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
const CAMPOS_TENS_P2 = ['dolores', 'ias', 'enemigos', 'lecturaEnemigos', 'fracturas', 'segmentos', 'hallazgoSegmentacion', 'preguntas'];
{
  const t = JSON.parse(SCHEMAS.tensiones);
  const carto = {};
  for (const k of CAMPOS_TENS_P2) { carto[k] = t[k]; delete t[k]; }
  SCHEMAS.tensionesCartografia = JSON.stringify(carto, null, 2);
  SCHEMAS.tensiones = JSON.stringify(t, null, 2);

  const req = REQUISITOS_MINIMOS.tensiones;
  const corte = req.indexOf('REQUISITOS MÍNIMOS — SOCIOAFECTIVA');
  if (corte > 0) {
    REQUISITOS_MINIMOS.tensionesCartografia = '\n' + req.slice(corte);
    REQUISITOS_MINIMOS.tensiones = req.slice(0, corte);
  }
}

// Resumen compacto de la llamada 1 para que la cartografía (llamada 2) use
// los mismos nombres de tensiones, emociones y zonas.
// Resumen de la parte A de RADAR para las partes B y C (y para completar
// faltantes): mismos grupos, temas y nivel de alerta en todas las pestañas.
function resumenRadarParaPartes(d) {
  if (!d || typeof d !== 'object') return '';
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const nombres = (v) => (Array.isArray(v) ? v : []).map(x => isObj(x) ? (x.grupo || x.nombre || x.tema) : Array.isArray(x) ? x[0] : x).filter(Boolean).map(String);
  const m = isObj(d.meta) ? d.meta : {};
  const s = isObj(d.sentimiento) ? d.sentimiento : {};
  const partes = ['CONTEXTO YA GENERADO (usa EXACTAMENTE estos nombres y este nivel de alerta):'];
  if (m.nombre) partes.push(`Actor: ${m.nombre}${m.territorio ? ' · ' + m.territorio : ''}${m.ventana ? ' · ' + m.ventana : ''}`);
  if (m.nivel || m.alerta) partes.push(`Nivel de alerta: ${m.nivel || ''} ${m.alerta || ''}`.trim());
  const np = isObj(d.npsPartido) ? d.npsPartido.datos : d.npsPartido;
  if (Array.isArray(np) && np.length) partes.push('NPS-P por segmento partidista: ' + np.map(x => Array.isArray(x) ? `${x[0]} ${x[1]}` : '').filter(Boolean).join(', '));
  const sp = nombres(s.partido); if (sp.length) partes.push('Segmentos partidistas: ' + sp.join(', '));
  const sl = nombres(s.plataforma); if (sl.length) partes.push('Plataformas: ' + sl.join(', '));
  const sa = nombres(s.audiencia); if (sa.length) partes.push('Audiencias: ' + sa.join(', '));
  const tg = isObj(d.tom) && isObj(d.tom.general) ? nombres(d.tom.general.temas) : [];
  if (tg.length) partes.push('Temas del Top of Mind: ' + tg.join(' | '));
  const cr = (Array.isArray(d.cronologia) ? d.cronologia : []).filter(isObj).map(e => `${e.fecha || ''}: ${e.titulo || ''}`).slice(0, 10);
  if (cr.length) partes.push('Eventos del periodo:\n- ' + cr.join('\n- '));
  return partes.length > 1 ? partes.join('\n') : '';
}

function resumenTensionesParaCartografia(p1) {
  if (!p1 || typeof p1 !== 'object') return '';
  const lista = (arr, f) => (Array.isArray(arr) ? arr : []).map(f).filter(Boolean).slice(0, 10);
  const partes = [];
  const m = p1.meta || {};
  if (m.municipio) partes.push(`Territorio: ${m.municipio}${m.estado ? ', ' + m.estado : ''} · Gobierno: ${m.actor || ''} (${m.partido || ''}) · Ventana: ${m.ventana || ''}`);
  const rk = lista(p1.ranking, r => r && r.nombre ? `- ${r.nombre} (${r.emocion || ''}; territorio: ${r.territorio || ''}; actor: ${r.actor || ''})` : '');
  if (rk.length) partes.push('Ranking de tensiones:\n' + rk.join('\n'));
  const em = lista(p1.emociones, e => e && e.nombre ? `${e.nombre} (${e.porcentaje ?? e.intensidad ?? ''}%)` : '');
  if (em.length) partes.push('Emociones detectadas: ' + em.join(', '));
  const te = lista(p1.territorios, z => z && z.nombre ? `${z.nombre} — ${z.tension || ''} (${z.nivel || ''})` : '');
  if (te.length) partes.push('Territorios sensibles:\n- ' + te.join('\n- '));
  const al = lista(p1.alertas, a => a && a.titulo ? a.titulo : '');
  if (al.length) partes.push('Alertas prioritarias: ' + al.join(' | '));
  return partes.join('\n\n');
}

function resumirFuentes(bloque) {
  if (!bloque || !bloque.items || bloque.items.length === 0) {
    return '(No se obtuvieron resultados directos de scraping en vivo; genera el análisis basándote en conocimiento experto del contexto político mexicano respetando estrictamente el esquema JSON proporcionado.)';
  }
  return bloque.items
    .slice(0, 90)
    .map(i => `[${i.fuente}${i.fecha ? ' · ' + String(i.fecha).slice(0, 10) : ''}] ${Array.from(String(i.texto)).slice(0, 280).join('')}`)
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

// Limpia el texto que se manda al modelo. Los textos de redes (X, TikTok,
// Instagram...) traen emojis; al recortarlos con .slice() un emoji puede
// quedar partido a la mitad ("surrogate" suelto). JSON.stringify lo escribe
// como \udXXX y el proveedor rechaza el cuerpo con:
//   400 "Invalid body: failed to parse JSON value".
// También se quitan caracteres de control invisibles.
function limpiarTextoParaModelo(t) {
  return String(t || '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '$1')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, ' ');
}

async function callOpenRouter({ system, user }, apiKey, intentos = 2) {
  const model = modeloIA();
  system = limpiarTextoParaModelo(system);
  user = limpiarTextoParaModelo(user);
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
          usage: { include: true },
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
      // Registro de gasto: modelo que REALMENTE respondió, tokens y costo en USD.
      {
        const u = data.usage || {};
        const g = GASTO_IA.getStore();
        const usado = data.model || model;
        if (g) { g.modelo = usado; g.llamadas++; g.entrada += u.prompt_tokens || 0; g.salida += u.completion_tokens || 0; g.costo += Number(u.cost) || 0; }
        console.log(`[IA] ${usado} · entrada ${u.prompt_tokens ?? '?'} tokens · salida ${u.completion_tokens ?? '?'} tokens · costo $${Number(u.cost || 0).toFixed(4)} USD`);
      }
      const choice = data?.choices?.[0] || {};
      const raw = choice?.message?.content || '';
      if (!raw.trim()) throw new Error(`OpenRouter devolvió una respuesta vacía (finish_reason: ${choice.finish_reason || 'desconocido'}).`);
      let clean = raw.replace(/```json|```/g, '').trim();
      // Modelos como Claude a veces escriben una frase antes o después del JSON:
      // se toma solo el objeto (del primer "{" al último "}").
      if (!clean.startsWith('{')) {
        const ini = clean.indexOf('{');
        if (ini >= 0) clean = clean.slice(ini);
      }
      if (!clean.endsWith('}') && choice.finish_reason !== 'length') {
        const fin = clean.lastIndexOf('}');
        if (fin > 0) clean = clean.slice(0, fin + 1);
      }

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
