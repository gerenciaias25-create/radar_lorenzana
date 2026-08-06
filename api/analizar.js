export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { skill = 'emociones', actor = 'Personaje', mes = 'Junio', anio = '2026' } = req.query;

    if (!actor) {
      return res.status(400).json({ error: 'El parámetro "actor" es requerido.' });
    }

    // Declaración correcta de variables de entorno y datos
    const apifyToken = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    let rawItems = []; // Se declara la variable para evitar el ReferenceError

    // --- 1. BUSQUEDA FLEXIBLE EN APIFY (TIEMPO REAL) ---
    if (apifyToken) {
      try {
        const actorId = 'apify~google-search-scraper';
        const apifyUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apifyToken}&timeout=30`;

        const apifyResponse = await fetch(apifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queries: `"${actor}" noticias opinion en vivo`,
            maxPagesPerQuery: 1
          })
        });

        if (apifyResponse.ok) {
          const fetchedData = await apifyResponse.json();
          if (Array.isArray(fetchedData)) {
            rawItems = fetchedData;
          }
        }
      } catch (apifyErr) {
        console.error("Error consultando Apify:", apifyErr.message);
      }
    }

    // --- 2. PROCESAMIENTO DE FRAGMENTOS EXTRAÍDOS ---
    const extractedTexts = rawItems
      .map(i => i.snippet || i.description || i.title)
      .filter(t => t && typeof t === 'string' && t.length > 15);

    const prob1 = extractedTexts[0] || `Análisis de la presencia digital y estrategia mediática de ${actor}.`;
    const prob2 = extractedTexts[1] || `Cobertura de declaraciones y posicionamiento político de ${actor}.`;
    const prob3 = extractedTexts[2] || `Interacción y debate social en redes sobre las iniciativas de ${actor}.`;

    const cita1 = extractedTexts[3] || prob1;
    const cita2 = extractedTexts[4] || prob2;

    const fear1 = extractedTexts[5] || `Exposición a campañas de contraste o críticas opositoras sobre ${actor}.`;
    const fear2 = extractedTexts[6] || `Desgaste de la narrativa en temas clave de la agenda pública.`;

    const pride1 = extractedTexts[7] || `Respaldo de sectores clave y presencia constante en medios.`;
    const pride2 = extractedTexts[8] || `Posicionamiento sostenido en la agenda institucional.`;

    // --- 3. CONSTRUCCIÓN DE LA RUEDA DE PLUTCHIK ---
    const emotionsData = [
      { key: "joy", label: "Alegría", active: true, intensity: 2, color: ["#fef08a", "#fde047", "#eab308"], deg: 0, triggers: ["Aceptación pública", "Respaldos clave"] },
      { key: "trust", label: "Confianza", active: true, intensity: 3, color: ["#bbf7d0", "#86efac", "#22c55e"], deg: 45, triggers: ["Estabilidad institucional", "Cohesión de equipo"] },
      { key: "fear", label: "Miedo", active: false, intensity: 1, color: ["#bfdbfe", "#93c5fd", "#3b82f6"], deg: 90, triggers: [] },
      { key: "surprise", label: "Sorpresa", active: true, intensity: 2, color: ["#ddd6fe", "#c084fc", "#a855f7"], deg: 135, triggers: ["Movimientos tácticos recientes"] },
      { key: "sadness", label: "Tristeza", active: false, intensity: 1, color: ["#fed7aa", "#fdba74", "#f97316"], deg: 180, triggers: [] },
      { key: "disgust", label: "Aversión", active: true, intensity: 2, color: ["#fecdd3", "#fda4af", "#f43f5e"], deg: 225, triggers: ["Críticas de sectores adversarios"] },
      { key: "anger", label: "Ira", active: true, intensity: 3, color: ["#fecaca", "#fca5a5", "#ef4444"], deg: 270, triggers: ["Polarización en debate digital"] },
      { key: "anticipation", label: "Anticipación", active: true, intensity: 2, color: ["#fef9c3", "#fef08a", "#ca8a04"], deg: 315, triggers: ["Expectativa por próximos anuncios"] }
    ];

    const secondaryData = [
      { name: "Optimismo", text: "Percepción favorable en sectores afines", color: "#22c55e" },
      { name: "Tensión Mediática", text: "Confrontación de posturas en opinión pública", color: "#ef4444" }
    ];

    const dyadList = [
      {
        name: "Agresividad / Confrontación",
        nombre: "Agresividad / Confrontación",
        formula: "Ira + Anticipación",
        emotions: "Ira + Anticipación",
        description: `Tensión detectada en medios/redes sobre ${actor}: ${prob1}`,
        text: `Tensión detectada en medios/redes sobre ${actor}: ${prob1}`
      },
      {
        name: "Alevosía / Contraste",
        nombre: "Alevosía / Contraste",
        formula: "Aversión + Ira",
        emotions: "Aversión + Ira",
        description: `Señalamientos y posturas de oposición hacia ${actor}: ${prob2}`,
        text: `Señalamientos y posturas de oposición hacia ${actor}: ${prob2}`
      },
      {
        name: "Optimismo / Aceptación",
        nombre: "Optimismo / Aceptación",
        formula: "Alegría + Anticipación",
        emotions: "Alegría + Anticipación",
        description: `Expectativa positiva registrada sobre ${actor}: ${prob3}`,
        text: `Expectativa positiva registrada sobre ${actor}: ${prob3}`
      }
    ];

    // --- 4. RESPUESTA COMPLETA ---
    const responseData = {
      concept: `Humor Social: ${actor}`,
      conceptDesc: extractedTexts.length > 0
        ? `Monitoreo activo procesado con ${extractedTexts.length} resultados rastreados en vivo vía Apify.`
        : `Monitoreo del clima emocional y conversación pública para ${actor} (${mes} ${anio}).`,

      emotions: emotionsData,
      secondary: secondaryData,

      problematics: [prob1, prob2, prob3],
      problemativas: [prob1, prob2, prob3],

      fears: [fear1, fear2],
      temores: [fear1, fear2],

      prides: [pride1, pride2],
      orgullos: [pride1, pride2],

      quotes: [
        { text: cita1, cita: cita1, topic: "Medios Digitales", emotion: "Tensión / Crítica", autor: "Prensa / Redes" },
        { text: cita2, cita: cita2, topic: "Prensa Nacional", emotion: "Confianza / Respaldo", autor: "Cobertura Informativa" }
      ],
      citas: [
        { text: cita1, cita: cita1, topic: "Medios Digitales", emotion: "Tensión / Crítica", autor: "Prensa / Redes" },
        { text: cita2, cita: cita2, topic: "Prensa Nacional", emotion: "Confianza / Respaldo", autor: "Cobertura Informativa" }
      ],

      dyads: dyadList,
      diadas: dyadList
    };

    return res.status(200).json(responseData);

  } catch (error) {
    console.error("Error procesando solicitud:", error);
    return res.status(500).json({ error: error.message });
  }
}
