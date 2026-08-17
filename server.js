import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '10mb' }));

// Servir archivos estáticos (skills, assets)
app.use(express.static(__dirname));

// Servir la vista principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint principal de análisis — POST exclusivo
app.post('/api/analizar', async (req, res) => {
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

  try {
    console.log(`[+] Iniciando análisis: skill=${skill} | actor=${actorName} | actor2=${actor2Name || 'N/A'} | periodo=${mes} ${anio}`);

    // 1. Scraping masivo (6 fuentes en paralelo)
    console.log('[1/3] Scraping fuentes con Apify...');
    const [datosActor1, datosActor2] = await Promise.all([
      scrapeActor(actorName, APIFY_TOKEN),
      actor2Name ? scrapeActor(actor2Name, APIFY_TOKEN) : Promise.resolve(null),
    ]);

    const totalFuentes = (datosActor1?.count || 0) + (datosActor2?.count || 0);
    console.log(`[1/3] Fuentes obtenidas: ${totalFuentes} items`);

    // 2. Estructuración con OpenRouter
    console.log('[2/3] Estructurando datos con OpenRouter...');
    const schema = SCHEMAS[skill] || SCHEMAS.radar;
    const prompt = buildPrompt({ skill, actorName, actor2Name, mes, anio, datosActor1, datosActor2, schema });
    
    let structured;
    try {
      structured = await callOpenRouter(prompt, OPENROUTER_KEY);
    } catch (openRouterErr) {
      console.error('[-] Error en OpenRouter:', openRouterErr.message);
      // Si falla OpenRouter, devolvemos el fallback para que el frontend no se rompa
      structured = buildFallback(skill, actorName, actor2Name, mes, anio);
    }

    // Validar que la respuesta tenga la estructura mínima
    if (!structured || typeof structured !== 'object') {
      throw new Error('La respuesta de OpenRouter no es un objeto válido.');
    }

    console.log('[3/3] Enviando respuesta al frontend.');

    return res.status(200).json({
      skill,
      actor: actorName,
      actor2: actor2Name || null,
      periodo: `${mes} ${anio}`,
      fuentesEncontradas: totalFuentes,
      data: structured,
    });
  } catch (err) {
    console.error('[-] Error en /api/analizar:', err);
    return res.status(500).json({
      error: 'Error procesando el análisis.',
      detail: String(err.message || err),
    });
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Servidor RADAR activo', timestamp: new Date().toISOString() });
});

// Puerto
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Servidor RADAR escuchando en el puerto ${PORT}`);
  console.log(`📁 Directorio base: ${__dirname}`);
});

server.timeout = 180000;

// =========================================================
// APIFY: SCRAPING
// =========================================================

async function llamarActorApify(actorPath, payload, token, timeoutMs = 35000) {
  if (!token) {
    console.warn(`[!] Sin token de Apify, omitiendo ${actorPath}`);
    return [];
  }
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

    if (!r.ok) {
      console.warn(`[!] Apify actor ${actorPath} respondió ${r.status}`);
      return [];
    }
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
      queries: [`"${nombre}" noticias OR opinión OR declaraciones`],
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
// FALLBACKS POR SKILL (si OpenRouter falla)
// =========================================================

function buildFallback(skill, actor, actor2, mes, anio) {
  const periodo = `${mes} ${anio}`;
  const base = {
    actor: { cargo: 'Servidor(a) Público(a)', entidad: 'México', partido: '—', periodo },
    resumenEjecutivo: `Análisis de ${actor} para ${periodo}. Los datos de fuentes en vivo no pudieron ser estructurados por IA en este momento, pero el sistema está operativo.`
  };

  if (skill === 'radar') {
    return {
      ...base,
      kpis: {
        npsPartido: [{ label: 'Sin datos', valor: 0 }],
        npsDemografico: [{ label: 'Sin datos', valor: 0 }],
        ratioAtaqueDefensa: [{ plataforma: 'Sin datos', ratio: 0 }],
        traSemanal: { labels: ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'], valores: [0, 0, 0, 0] }
      },
      sentimiento: {
        general: { labels: ['Positivo', 'Neutro', 'Negativo', 'Muy Negativo'], valores: [25, 25, 25, 25] },
        genero: { labels: ['Hombres', 'Mujeres'], valores: [10, -10] },
        edad: { labels: ['18-29', '30-44', '45-59', '60+'], valores: [5, 8, -3, -5] },
        partido: { labels: ['Partido A', 'Partido B', 'Independientes'], valores: [15, -10, 0] },
        hallazgos: [{ titulo: 'Sin hallazgos', texto: 'No se pudieron generar hallazgos bivariados.', accion: 'Reintentar análisis más tarde.' }]
      },
      topOfMind: {
        general: { temas: ['Sin datos'], valores: [100] },
        genero: { temas: ['Sin datos'], series: [{ nombre: 'Hombres', valores: [50] }, { nombre: 'Mujeres', valores: [50] }] },
        edad: { temas: ['Sin datos'], series: [{ nombre: '18-29', valores: [100] }] },
        partido: { temas: ['Sin datos'], series: [{ nombre: 'Independientes', valores: [100] }] },
        cruces: []
      },
      plataformas: {
        alcance: [{ plataforma: 'X/Twitter', valor: 40 }, { plataforma: 'Facebook', valor: 30 }, { plataforma: 'Instagram', valor: 20 }, { plataforma: 'TikTok', valor: 10 }],
        tono: [{ plataforma: 'X/Twitter', positivo: 20, negativo: 40 }, { plataforma: 'Facebook', positivo: 30, negativo: 30 }],
        porEdad: [
          { plataforma: 'X/Twitter', series: [{ nombre: '18-29', valor: 40 }, { nombre: '30-44', valor: 30 }, { nombre: '45+', valor: 30 }] },
          { plataforma: 'Facebook', series: [{ nombre: '18-29', valor: 20 }, { nombre: '30-44', valor: 40 }, { nombre: '45+', valor: 40 }] }
        ],
        viralizacion: [{ plataforma: 'X/Twitter', critica: 2, propia: 8 }, { plataforma: 'Facebook', critica: 4, propia: 12 }],
        lecturaEstrategica: [{ titulo: 'Sin lectura disponible', texto: 'Reintentar análisis.', alerta: false }]
      },
      narrativas: { favorables: [], criticas: [], neutras: [] },
      riesgosOportunidades: { riesgos: [], oportunidades: [] },
      territorial: { zonas: [], volumenPorZona: [] }
    };
  }

  if (skill === 'emociones') {
    return {
      territory: actor,
      subtitle: `Análisis emocional de ${actor}`,
      date: periodo,
      riskLevel: 'MEDIO',
      ivEstimado: 45,
      concept: 'Contexto político en evaluación',
      conceptDesc: 'No se pudieron estructurar los datos emocionales en este momento. El sistema operó con fallback de seguridad.',
      emotions: [
        { key: 'ira', active: true, intensity: 2, triggers: ['Polarización política'], consequences: ['Desmovilización'] },
        { key: 'miedo', active: true, intensity: 1, triggers: ['Incertidumbre económica'], consequences: ['Ahorro de voto'] }
      ],
      secondary: [{ name: 'Cautela', text: 'Emoción latente detectada.', color: '#64748b' }],
      problematics: ['Falta de datos estructurados'],
      fears: ['Desinformación'],
      prides: ['Identidad local'],
      quotes: [{ text: 'Sin frases disponibles.', topic: 'General', emotion: 'Neutro', territory: 'Nacional' }],
      temasChart: [['Seguridad', 30, '#3b82f6'], ['Economía', 25, '#f97316'], ['Salud', 20, '#22c55e'], ['Educación', 15, '#a855f7'], ['Otro', 10, '#64748b']],
      semaforo: [{ label: 'Estabilidad emocional', val: 'Media', estado: 'atencion', color: '#eab308' }],
      dyads: [{ name: 'Ira + Miedo', formula: 'Ira + Miedo', type: 'Primaria', text: 'Combinación volátil.', risk: 'ALTO', score: 65 }],
      dyadInterp: 'Sin interpretación detallada disponible.',
      preguntaPolitica: '¿Cuál es el estado emocional del territorio?',
      preguntaDesc: 'No se pudo determinar la pregunta política central.',
      govSemaforo: [{ label: 'Gestión', val: 'Regular', estado: 'atencion', color: '#eab308' }],
      partidos: [
        { nombre: 'Partido A', emocion: 'Esperanza', capital: 'Medio', tendencia: '→ Estable', direccion: 'estable', cargaEmocional: { iraAsco: 30, decepcionTristeza: 20, interesDisponible: 50 } }
      ],
      partidosChart: [[30, 20, 50]],
      actores: [
        { name: actor, role: 'Principal', rows: [['Cargo', 'Servidor Público']], radar: [50, 50, 50, 50, 50, 50], borderColor: '#3b82f6' }
      ],
      actoresRadar: { labels: [actor], data: [[50, 50, 50, 50, 50, 50]], colors: ['#3b82f6'] },
      alertaEstrategica: 'Sin alerta disponible.',
      alertaDesc: 'Reintentar análisis para obtener alertas estratégicas.',
      recs: [{ urgencia: 'mediano', text: 'Reintentar análisis con más fuentes.', label: 'MEDIANO', bg: '#fef9c3', tx: '#854d0e' }],
      evitar: ['Mensajes polarizantes'],
      gestionPrioridad: [['Comunicación', 60, '#3b82f6'], ['Presencia', 40, '#22c55e']],
      resumenEjecutivo: base.resumenEjecutivo
    };
  }

  if (skill === 'tensiones') {
    return {
      actor: { entidad: 'México', cargo: 'Servidor Público', periodo },
      ranking: [
        { nombre: 'Sin datos de tensión', score: 50, color: '#C05621', nivel: 'MEDIO', emocion: 'Incertidumbre', narrativa: 'Falta de información', actor: actor, territorio: 'Nacional', politica: 'Neutral', recomendacion: 'Reintentar análisis.' }
      ],
      emociones: [
        { nombre: 'Preocupación', intensidad: 3, color: '#C05621', porcentaje: 40 },
        { nombre: 'Esperanza', intensidad: 2, color: '#2F855A', porcentaje: 30 },
        { nombre: 'Indiferencia', intensidad: 1, color: '#6B7280', porcentaje: 30 }
      ],
      narrativas: [
        { nombre: 'Narrativa por defecto', tema: 'General', actor: actor, politica: 'Sin impacto', frase: 'Sin frases detectadas.' }
      ],
      territorios: [
        { nombre: 'Nacional', tension: 'Media', emocion: 'Neutro', observaciones: 'Sin observaciones territoriales.' }
      ],
      riesgos: [
        { nombre: 'Riesgo por defecto', srr: 50, accion: 'Monitorear', color: '#C05621' }
      ],
      trayectoria: [
        { nombre: 'Tensión General', t3: 40, t2: 45, t1: 48, ta: 50, tipo: 'Estable', velocidad: 'Lenta' }
      ],
      alertas: [
        { titulo: 'Alerta por defecto', rows: [['Estado', 'Sin alertas reales'], ['Recomendación', 'Reintentar']] }
      ],
      hallazgoEmocional: 'Sin hallazgos emocionales disponibles.',
      hallazgoTrayectoria: 'Sin datos de trayectoria.',
      resumenEjecutivo: base.resumenEjecutivo
    };
  }

  if (skill === 'opositor') {
    return {
      actor: { cargo: 'Servidor(a) Público(a)', partido: '—', periodo, aspiracion: '' },
      vulnerabilidades: [{ titulo: 'Sin vulnerabilidades detectadas', nivel: 'MEDIO', bullets: ['No se obtuvieron datos suficientes'], score: 5 }],
      fortalezas: [{ titulo: 'Sin fortalezas registradas', texto: 'No se obtuvieron datos suficientes.' }],
      perfil: {
        rows: [{ label: 'Cargo', value: 'Servidor Público' }],
        cronologia: [{ periodo: 'Actual', titulo: 'Periodo actual', descripcion: 'Sin datos de cronología.' }],
        ierPorCargo: [{ cargo: 'Actual', valor: 5 }]
      },
      contradicciones: {
        ranking: [],
        destacados: [],
        tabla: []
      },
      vectoresAtaque: [],
      redDePoder: {
        radar: [5, 5, 5, 5, 5, 5],
        alertas: [],
        tabla: []
      }
    };
  }

  return base;
}

// =========================================================
// SCHEMAS SINCRONIZADOS CON LAS PLANTILLAS HTML
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
    secondary: [{ name: "string", text: "string", color: "string" }],
    problematics: ["string"],
    fears: ["string"],
    prides: ["string"],
    quotes: [{ text: "string", topic: "string", emotion: "string", territory: "string" }],
    temasChart: [["tema", 0, "#color"]],
    semaforo: [{ label: "string", val: "string", estado: "positivo|atencion|critico", color: "string" }],
    dyads: [{ name: "string", formula: "string", type: "Primaria|Secundaria", text: "string", risk: "CRÍTICO|ALTO|MEDIO|BAJO", score: 0 }],
    dyadInterp: "string",
    preguntaPolitica: "string",
    preguntaDesc: "string",
    govSemaforo: [{ label: "string", val: "string", estado: "positivo|atencion|critico", color: "string" }],
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
        radar: [0, 0, 0, 0, 0, 0],
        borderColor: "string"
      }
    ],
    actoresRadar: { labels: ["string"], data: [[0, 0, 0, 0, 0, 0]], colors: ["string"] },
    alertaEstrategica: "string",
    alertaDesc: "string",
    recs: [{ urgencia: "urgente|corto|mediano|permanente", text: "string", label: "string", bg: "string", tx: "string" }],
    evitar: ["string"],
    gestionPrioridad: [["label", 0, "#color"]],
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
    }
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
    ? `\nREGLAS ADICIONALES OBLIGATORIAS para expediente de oposición:\n- Basa cualquier señalamiento grave ÚNICAMENTE en las fuentes crudas proporcionadas.\n- NO inventes números de expediente ni fechas falsas.\n- Si no hay información suficiente, marca como "área de riesgo reputacional" con score bajo.`
    : '';

  const system = `Eres un analista senior de inteligencia político-electoral en México. Tu trabajo es producir un análisis estructurado ÚNICAMENTE en formato JSON válido, sin texto adicional, sin markdown, sin backticks.

REGLAS ESTRICTAS:
1. Responde EXCLUSIVAMENTE con un objeto JSON válido que respete EXACTAMENTE este esquema (mismos nombres de propiedades, mismos tipos de datos):
${schema}

2. Todos los arrays DEBEN tener al menos un elemento. NUNCA devuelvas arrays vacíos.

3. Si no hay datos crudos suficientes para algún campo, genera valores realistas y coherentes basados en el contexto político mexicano actual, pero SIEMPRE respeta los nombres de propiedades del esquema.

4. Todos los textos en español de México.

5. Los campos numéricos deben ser números (int o float), NUNCA strings.

6. Para campos de color en hex, usa valores realistas como "#C05621", "#2F855A", etc.

7. Para "temasChart" en skill emociones, usa formato: [["tema", porcentaje, "#color"], ...]

8. Para "recs" en skill emociones, incluye los campos: urgencia, text, label, bg (hex fondo), tx (hex texto).

9. Para "partidosChart" en skill emociones, usa formato: [[iraAsco, decepcionTristeza, interesDisponible], ...] una entrada por partido.

10. Para "actoresRadar" en skill emociones, usa: { labels: ["nombre"], data: [[v1,v2,v3,v4,v5,v6]], colors: ["#hex"] }${guardarropaOpositor}`;

  const user = `Periodo evaluado: ${mes} ${anio}\nSkill solicitada: ${skill}\n\n${contexto}\n\nGenera el JSON completo con el esquema indicado. No omitas NINGUNA propiedad. Asegúrate de que TODOS los arrays tengan al menos un elemento.`;

  return { system, user };
}

function resumirFuentes(bloque) {
  if (!bloque || !bloque.items || bloque.items.length === 0) {
    return '(No se obtuvieron resultados directos de scraping en vivo; genera el análisis basándote en conocimiento experto del contexto político mexicano respetando estrictamente el esquema JSON proporcionado. ASEGÚRATE de que TODOS los arrays tengan al menos un elemento.)';
  }
  return bloque.items
    .slice(0, 50)
    .map(i => `[${i.fuente}] ${i.texto.slice(0, 200)}`)
    .join('\n');
}

async function callOpenRouter({ system, user }, apiKey) {
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

  console.log(`[OpenRouter] Usando modelo: ${model}`);
  console.log(`[OpenRouter] Longitud del prompt: ${system.length + user.length} chars`);

  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': process.env.SITE_URL || 'https://radar-politico.com',
      'X-Title': 'RADAR Intelligence',
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
    const parsed = JSON.parse(clean);
    console.log('[OpenRouter] JSON parseado correctamente. Keys:', Object.keys(parsed).join(', '));
    return parsed;
  } catch (e) {
    console.error('[-] JSON inválido de OpenRouter:', clean.slice(0, 500));
    throw new Error('OpenRouter devolvió un JSON con formato inválido.');
  }
}
