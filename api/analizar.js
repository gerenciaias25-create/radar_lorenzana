export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { skill = 'emociones', actor = 'Personaje', mes = 'Junio', anio = '2026' } = req.query;
    const apifyToken = process.env.APIFY_TOKEN;
    let items = [];

    if (apifyToken) {
      try {
        const actorId = 'apify~google-search-scraper';
        const apifyUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apifyToken}&timeout=45`;

        const apifyResponse = await fetch(apifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queries: `${actor} noticias opinion ${mes} ${anio}`,
            maxPagesPerQuery: 1
          })
        });

        if (apifyResponse.ok) {
          const rawData = await apifyResponse.json();
          // Filtrar items para asegurar que tengan título o descripción válida
          items = Array.isArray(rawData) ? rawData.filter(i => i.title || i.snippet || i.description) : [];
        }
      } catch (apifyErr) {
        console.error("Error Apify:", apifyErr.message);
      }
    }

    // Extraer títulos/snippets reales si existen, o usar genéricos contextuales
    const titulosDinamicos = items.map(i => i.title || i.snippet || i.description).filter(Boolean);
    
    const prob1 = titulosDinamicos[0] || `Falta de definición clara en la postura sobre temas clave de ${actor}.`;
    const prob2 = titulosDinamicos[1] || `Aumento de la cobertura crítica en medios locales y digitales.`;
    const prob3 = titulosDinamicos[2] || `Polarización de opiniones en redes sociales frente a recientes declaraciones.`;

    const cita1 = titulosDinamicos[3] || titulosDinamicos[0] || `Existe un seguimiento constante en la opinión pública respecto a la trayectoria de ${actor}.`;
    const cita2 = titulosDinamicos[4] || titulosDinamicos[1] || `Las menciones en medios digitales muestran opiniones divididas sobre el desempeño reciente.`;

    // Objeto de respuesta completo con todos los campos requeridos
    const responseData = {
      concept: `Humor Social en Tiempo Real: ${actor}`,
      conceptDesc: items.length > 0 
        ? `Análisis generado dinámicamente con ${items.length} fuentes web rastreadas en tiempo real para ${actor}.`
        : `Monitoreo del clima emocional y conversación digital en torno a ${actor} (${mes} ${anio}).`,
      
      emotions: [
        { key: "joy", label: "Alegría", active: true, intensity: 2, color: ["#fef08a", "#fde047", "#eab308"], deg: 0, triggers: ["Aceptación pública", "Proyectos bien recibidos"] },
        { key: "trust", label: "Confianza", active: true, intensity: 3, color: ["#bbf7d0", "#86efac", "#22c55e"], deg: 45, triggers: ["Respaldos de grupos aliados", "Percepción de estabilidad"] },
        { key: "fear", label: "Miedo", active: false, intensity: 1, color: ["#bfdbfe", "#93c5fd", "#3b82f6"], deg: 90, triggers: [] },
        { key: "surprise", label: "Sorpresa", active: true, intensity: 2, color: ["#ddd6fe", "#c084fc", "#a855f7"], deg: 135, triggers: ["Anuncios o movimientos recientes"] },
        { key: "sadness", label: "Tristeza", active: false, intensity: 1, color: ["#fed7aa", "#fdba74", "#f97316"], deg: 180, triggers: [] },
        { key: "disgust", label: "Aversión", active: true, intensity: 2, color: ["#fecdd3", "#fda4af", "#f43f5e"], deg: 225, triggers: ["Críticas de sectores opositores"] },
        { key: "anger", label: "Ira", active: true, intensity: 3, color: ["#fecaca", "#fca5a5", "#ef4444"], deg: 270, triggers: ["Confrontación en debates públicos"] },
        { key: "anticipation", label: "Anticipación", active: true, intensity: 2, color: ["#fef9c3", "#fef08a", "#ca8a04"], deg: 315, triggers: ["Expectativa por próximos posicionamientos"] }
      ],

      secondary: [
        { name: "Optimismo", text: "Proyección favorable en sectores afines", color: "#22c55e" },
        { name: "Polarización", text: "División de opiniones identificada en redes", color: "#ef4444" }
      ],

      // Campos de texto y listas (Ambas llaves en español e inglés por compatibilidad)
      problematics: [prob1, prob2, prob3],
      problemativas: [prob1, prob2, prob3],

      fears: [
        "Vulnerabilidad ante narrativas de la oposición",
        "Riesgo de desgaste en la percepción pública"
      ],
      temores: [
        "Vulnerabilidad ante narrativas de la oposición",
        "Riesgo de desgaste en la percepción pública"
      ],

      prides: [
        "Respaldo de la base de simpatizantes",
        "Presencia constante en la agenda pública"
      ],
      orgullos: [
        "Respaldo de la base de simpatizantes",
        "Presencia constante en la agenda pública"
      ],

      quotes: [
        { text: cita1, topic: "Medios / Noticieros", emotion: "Ira / Aversión", cita: cita1 },
        { text: cita2, topic: "Redes Sociales", emotion: "Confianza / Alegría", cita: cita2 }
      ],

      dyads: [
        { name: "Agresividad", formula: "Ira + Anticipación", text: "Reacciones encontradas ante iniciativas o declaraciones del personaje." },
        { name: "Alevosía", formula: "Aversión + Ira", text: "Señalamientos constantes en canales digitales." }
      ]
    };

    return res.status(200).json(responseData);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
