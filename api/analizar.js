async function cacheGet(key) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;

    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', key])
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.result ? JSON.parse(data.result) : null;
  } catch (e) {
    console.error('Cache GET error:', e.message);
    return null;
  }
}

async function cacheSet(key, value, ttlSeconds) {
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return;

    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', key, JSON.stringify(value), 'EX', String(ttlSeconds)])
    });
  } catch (e) {
    console.error('Cache SET error:', e.message);
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { nombre, fecha, forceRefresh } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });

  const fechaCtx = fecha || 'julio 2026';
  const CACHE_TTL_SECONDS = 6 * 60 * 60;
  const cacheKey = `radar:${nombre.trim().toLowerCase()}:${fechaCtx.trim().toLowerCase()}`;

  if (!forceRefresh) {
    const cached = await cacheGet(cacheKey);
    if (cached) return res.status(200).json({ ...cached, _cache: 'HIT' });
  }

  let contextoReal = '';
  try {
    const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

    const tweetsPromise = fetch(
      `https://api.apify.com/v2/acts/apidojo~twitter-scraper-lite/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchTerms: [`${nombre}`, `${nombre} oposicion`, `${nombre} gobierno`],
          sort: 'Latest',
          maxItems: 30,
          tweetLanguage: 'es'
        })
      }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    const noticiasPromise = fetch(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: `${nombre} columna opinion NOTICIAS ${fechaCtx}\n${nombre} oposicion denuncias edomex mexico`,
          resultsPerPage: 20,
          maxPagesPerQuery: 1,
          languageCode: 'es',
          countryCode: 'mx'
        })
      }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    const facebookPromise = fetch(
      `https://api.apify.com/v2/acts/apify~facebook-posts-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchTerm: nombre, maxPosts: 20 })
      }
    ).then(r => r.ok ? r.json() : []).catch(() => []);

    const [tweetsData, noticiasData, facebookData] = await Promise.all([
      tweetsPromise, noticiasPromise, facebookPromise
    ]);

    const tweetsTexto = (tweetsData || []).slice(0, 25).map(t =>
      `TWEET de @${t.author?.userName || 'usuario'} (${t.createdAt || 's/f'}): ${t.text || t.fullText || ''}\nLikes: ${t.likeCount ?? 0} | RTs: ${t.retweetCount ?? 0}`
    ).join('\n\n');

    const organicResults = (noticiasData || []).flatMap(item => item.organicResults || []);
    const noticiasTexto = organicResults.slice(0, 20).map(r =>
      `TITULAR: ${r.title}\nURL: ${r.url}\nRESUMEN: ${r.description || ''}`
    ).join('\n\n---\n\n');

    const fbTexto = (facebookData || []).slice(0, 20).map(f =>
      `POST FB (${f.user?.name || 'Página/Usuario'}): ${f.text || f.caption || ''}\nReacciones: ${f.likes || 0} | Compartidos: ${f.shares || 0}`
    ).join('\n\n');

    contextoReal = `DATOS MULTI-PLATAFORMA EXTRAÍDOS:\n\n` +
      `=== X / TWITTER (${tweetsData?.length || 0} publicaciones) ===\n${tweetsTexto || 'Sin datos directos.'}\n\n` +
      `=== MEDIOS DIGITALES Y PRENSA (${organicResults.length} artículos) ===\n${noticiasTexto || 'Sin datos directos.'}\n\n` +
      `=== FACEBOOK (${facebookData?.length || 0} publicaciones) ===\n${fbTexto || 'Sin datos directos.'}`;

  } catch (e) {
    console.error('Apify exception:', e.message);
    contextoReal = 'Conexión parcial a fuentes. Generando análisis deductivo amplio.';
  }

  const prompt = `Eres un Director General de Inteligencia Político-Digital. La fecha actual del reporte es: ${fechaCtx}.

INFORMACIÓN EXTRAÍDA DE FUENTES PARA "${nombre}":
${contextoReal}

INSTRUCCIÓN CRÍTICA DE EXTENSIÓN Y PROFUNDIDAD:
Tu cliente exige un INFORME EJECUTIVO DENSEMENTE DETALLADO. No omitas explicaciones ni resumas de forma escueta. En cada sección del JSON debes proveer análisis cualitativos extensos, contexto estratégico, desgloses exhaustivos y métricas comparativas.

Debes estructurar obligatoriamente el JSON con esta estructura exacta:

{
  "nombre": "Nombre oficial completo",
  "cargo": "Cargo exacto a ${fechaCtx} · Partido Político / Entidad",
  "fecha_analisis": "${fechaCtx}",
  "tags": ["Tag1", "Tag2", "Tag3", "Tag4", "Tag5"],
  "kpis": [
    {"label": "SEGUIDORES TOTALES", "valor": "X.XM", "nota": "Alcance bruto consolidado", "tipo": "acc"},
    {"label": "APROBACIÓN DIGITAL", "valor": "XX%", "nota": "Proporción favorable neta", "tipo": "suc"},
    {"label": "PANTALLAS DE CRISIS", "valor": "X", "nota": "Eventos de alta volatilidad", "tipo": "dan"},
    {"label": "MECANISMO NARRATIVO", "valor": "XX/XX", "nota": "Propia vs Impuesta", "tipo": "gld"},
    {"label": "SENTIMIENTO POSITIVO", "valor": "XX%", "nota": "Conversación a favor", "tipo": "suc"},
    {"label": "TENDENCIA DE VOLUMEN", "valor": "Alta / Estable", "nota": "Variación vs periodo previo", "tipo": "acc"}
  ],
  "vision_general": {
    "resumen_ejecutivo": "Escribe un análisis de 2 a 3 párrafos completos explicando a fondo la situación digital global del actor político, la dinámica de su ecosistema, los ataques o apoyos principales y el balance general de su imagen a la fecha de ${fechaCtx}.",
    "sentimiento": [
      {"label": "Positivo", "pct": 38},
      {"label": "Neutro/Informativo", "pct": 30},
      {"label": "Negativo", "pct": 22},
      {"label": "Polarizado", "pct": 10}
    ],
    "temas": [
      {"tema": "Tema principal 1", "pct": 35},
      {"tema": "Tema principal 2", "pct": 22},
      {"tema": "Tema principal 3", "pct": 15},
      {"tema": "Tema principal 4", "pct": 12},
      {"tema": "Tema principal 5", "pct": 9},
      {"tema": "Tema principal 6", "pct": 7}
    ],
    "plataformas": [
      {"nombre": "Facebook", "pct": 38, "tono_positivo": 45, "tono_negativo": 30},
      {"nombre": "X/Twitter", "pct": 28, "tono_positivo": 25, "tono_negativo": 60},
      {"nombre": "Noticias/Medios", "pct": 18, "tono_positivo": 30, "tono_negativo": 45},
      {"nombre": "Google Search", "pct": 10, "tono_positivo": 40, "tono_negativo": 35},
      {"nombre": "Instagram", "pct": 6, "tono_positivo": 50, "tono_negativo": 20}
    ]
  },
  "actores_politicos": {
    "explicacion_ecosistema": "Escribe un análisis exhaustivo sobre la relación del actor político con los principales poderes de mediación (prensa nacional, oposiciones territoriales, líderes de opinión y movilización en redes).",
    "analisis_actores": [
      {
        "categoria": "Prensa Nacional & Columnistas",
        "impacto": "Alto",
        "narrativa_dominante": "Explicación extensa del tratamiento mediático por parte de grandes editoriales y plumas nacionales.",
        "tendencia_actitud": "Desfavorable (60%) / Neutro (40%)"
      },
      {
        "categoria": "Prensa Local & Portales Regionales",
        "impacto": "Medio",
        "narrativa_dominante": "Explicación extensa sobre la cobertura institucional y local en regiones de influencia.",
        "tendencia_actitud": "Favorable (70%)"
      },
      {
        "categoria": "Oposición & Voceros Críticos",
        "impacto": "Crítico",
        "narrativa_dominante": "Explicación detallada de las estrategias de ataque, voceros de oposición y líneas de denuncia.",
        "tendencia_actitud": "Adverso (90%)"
      },
      {
        "categoria": "Ecosistema Ciudadano & Algorítmico",
        "impacto": "Alto",
        "narrativa_dominante": "Análisis del sentimiento orgánico sin mediación, comentarios en plataformas masivas como TikTok y FB.",
        "tendencia_actitud": "Dividido / Polarizado"
      }
    ],
    "cruces_bivariados": [
      {
        "eje_x": "Plataforma (X vs Facebook)",
        "eje_y": "Inclinación del Tono",
        "hallazgo": "Explicación detallada de por qué el tono varía drásticamente según el algoritmo y tipo de usuario de cada plataforma."
      },
      {
        "eje_x": "Sentimiento",
        "eje_y": "Ejes Temáticos Clave",
        "hallazgo": "Análisis explícito sobre qué temas específicos generan rechazo y cuáles generan respaldo popular."
      }
    ]
  },
  "segmentacion_demografica": {
    "analisis_demografico": "Escribe un análisis detallado sobre el perfil sociodemográfico de la audiencia que apoya o ataca al personaje político, diferenciando por género, rango etario y nivel socioeconómico.",
    "por_genero": [
      {"segmento": "Hombres", "positivo": 35, "neutro": 30, "negativo": 35},
      {"segmento": "Mujeres", "positivo": 30, "neutro": 28, "negativo": 42}
    ],
    "por_edad": [
      {"segmento": "18-29 años", "positivo": 25, "neutro": 25, "negativo": 50},
      {"segmento": "30-44 años", "positivo": 35, "neutro": 30, "negativo": 35},
      {"segmento": "45-59 años", "positivo": 45, "neutro": 30, "negativo": 25},
      {"segmento": "60+ años", "positivo": 50, "neutro": 28, "negativo": 22}
    ]
  },
  "mapa_narrativas": {
    "explicacion_narrativas": "Análisis exhaustivo del combate ideológico y narrativo. Explica la efectividad del discurso oficial vs las contra-narrativas de la oposición.",
    "favorables": [
      {"titulo": "Narrativa A favor 1", "descripcion": "Texto extenso explicando el impacto, fuentes e impulsores de este argumento positivo."},
      {"titulo": "Narrativa A favor 2", "descripcion": "Texto extenso explicando el impacto, fuentes e impulsores de este argumento positivo."},
      {"titulo": "Narrativa A favor 3", "descripcion": "Texto extenso explicando el impacto, fuentes e impulsores de este argumento positivo."}
    ],
    "criticas": [
      {"titulo": "Narrativa En contra 1", "descripcion": "Texto extenso explicando el impacto, fuentes e impulsores de esta línea crítica."},
      {"titulo": "Narrativa En contra 2", "descripcion": "Texto extenso explicando el impacto, fuentes e impulsores de esta línea crítica."},
      {"titulo": "Narrativa En contra 3", "descripcion": "Texto extenso explicando el impacto, fuentes e impulsores de esta línea crítica."}
    ],
    "neutras": [
      {"titulo": "Narrativa Neutra 1", "descripcion": "Texto extenso sobre coyunturas informativas o debates sin inclinación clara."},
      {"titulo": "Narrativa Neutra 2", "descripcion": "Texto extenso sobre coyunturas informativas o debates sin inclinación clara."}
    ]
  },
  "cronologia_eventos": {
    "analisis_coyuntural": "Explicación extensa sobre cómo los eventos recientes han moldeado la curva de reputación del personaje a lo largo del tiempo.",
    "eventos": [
      {"fecha": "Fecha/Periodo", "badge": "EVENTO DESTACADO", "evento": "Título del hito", "lectura": "Explicación estratégica profunda de los efectos de este evento en la conversación pública."},
      {"fecha": "Fecha/Periodo", "badge": "PANTALLA DE CRISIS", "evento": "Título del evento adverso", "lectura": "Explicación estratégica profunda de la contención o daños causados por esta crisis."},
      {"fecha": "Fecha/Periodo", "badge": "EVENTO DESTACADO", "evento": "Título del hito", "lectura": "Explicación estratégica profunda."},
      {"fecha": "Fecha/Periodo", "badge": "PANTALLA DE CRISIS", "evento": "Título del hecho", "lectura": "Explicación estratégica profunda."}
    ]
  },
  "riesgos_oportunidades": {
    "dictamen_estrategico": "Evaluación final de vulnerabilidades de reputación y vetas de crecimiento para la comunicación institucional.",
    "riesgos": [
      {"nivel": "CRÍTICO", "titulo": "Riesgo Principal 1", "descripcion": "Análisis extenso de la amenaza, alcance de daño reputacional y probabilidad de escalamiento."},
      {"nivel": "ALTO", "titulo": "Riesgo Principal 2", "descripcion": "Análisis extenso de la amenaza, alcance de daño reputacional y probabilidad de escalamiento."},
      {"nivel": "MEDIO", "titulo": "Riesgo Principal 3", "descripcion": "Análisis extenso de la amenaza, alcance de daño reputacional y probabilidad de escalamiento."}
    ],
    "oportunidades": [
      {"nivel": "ALTO", "titulo": "Oportunidad Clave 1", "descripcion": "Análisis de la veta aprovechable, temas de vinculación social y rentabilidad de agenda."},
      {"nivel": "MEDIO", "titulo": "Oportunidad Clave 2", "descripcion": "Análisis de la veta aprovechable, temas de vinculación social y rentabilidad de agenda."}
    ]
  }
}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://radar-politico.vercel.app',
        'X-Title': 'RADAR Politico'
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        max_tokens: 7500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Error de API: ' + err });
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '';

    let cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Respuesta no válida', raw: rawText.substring(0, 300) });

    cleaned = jsonMatch[0].replace(/:\s*\+(\d)/g, ': $1').replace(/,\s*([}\]])/g, '$1');

    try {
      const parsed = JSON.parse(cleaned);
      await cacheSet(cacheKey, parsed, CACHE_TTL_SECONDS);
      return res.status(200).json({ ...parsed, _cache: 'MISS' });
    } catch(e) {
      return res.status(500).json({ error: 'JSON inválido: ' + e.message, raw: rawText.substring(0, 500) });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
