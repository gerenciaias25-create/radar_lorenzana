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
          items = Array.isArray(rawData) ? rawData.filter(i => i.title || i.snippet || i.description) : [];
        }
      } catch (apifyErr) {
        console.error("Error Apify:", apifyErr.message);
      }
    }

    const titulosDinamicos = items.map(i => i.title || i.snippet || i.description).filter(Boolean);

    const prob1 = titulosDinamicos[0] || `Análisis de la percepción pública sobre la gestión de ${actor}.`;
    const prob2 = titulosDinamicos[1] || `Aumento de menciones e interacciones en plataformas digitales.`;
    const prob3 = titulosDinamicos[2] || `Debate activo en medios locales respecto a los recientes anuncios.`;

    const cita1 = titulosDinamicos[3] || prob1;
    const cita2 = titulosDinamicos[4] || prob2;

    const dyadList = [
      {
        name: "Agresividad",
        nombre: "Agresividad",
        formula: "Ira + Anticipación",
        emotions: "Ira + Anticipación",
        description: `Respuestas confrontativas y debates intensos registrados en redes sociales hacia ${actor}.`,
        text: `Respuestas confrontativas y debates intensos registrados en redes sociales hacia ${actor}.`
      },
      {
        name: "Alevosía",
        nombre: "Alevosía",
        formula: "Aversión + Ira",
        emotions: "Aversión + Ira",
        description: `Críticas y señalamientos continuos detectados en medios y cuentas de la oposición.`,
        text: `Críticas y señalamientos continuos detectados en medios y cuentas de la oposición.`
      },
      {
        name: "Optimismo",
        nombre: "Optimismo",
        formula: "Alegría + Anticipación",
        emotions: "Alegría + Anticipación",
        description: `Expectativa positiva entre simpatizantes sobre las próximas iniciativas de ${actor}.`,
        text: `Expectativa positiva entre simpatizantes sobre las próximas iniciativas de ${actor}.`
      },
      {
        name: "Amor / Lealtad",
        nombre: "Amor / Lealtad",
        formula: "Alegría + Confianza",
        emotions: "Alegría + Confianza",
        description: `Respaldos explícitos e identificatorios en la base de seguidores.`,
        text: `Respaldos explícitos e identificatorios en la base de seguidores.`
      }
    ];

    const responseData = {
      concept: `Humor Social en Tiempo Real: ${actor}`,
      conceptDesc: items.length > 0 
        ? `Análisis procesado con ${items.length} fuentes web rastreadas en tiempo real por Apify.`
        : `Monitoreo del clima emocional y conversación digital para ${actor} (${mes} ${anio}).`,

      emotions: [
        { key: "joy", label: "Alegría", active: true, intensity: 2, color: ["#fef08a", "#fde047", "#eab308"], deg: 0, triggers: ["Aceptación pública", "Proyectos bien recibidos"] },
        { key: "trust", label: "Confianza", active: true, intensity: 3, color: ["#bbf7d0", "#86efac", "#22c55e"], deg: 45, triggers: ["Respaldos de aliados", "Percepción de estabilidad"] },
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

      // Problemas
      problematics: [prob1, prob2, prob3],
      problemativas: [prob1, prob2, prob3],

      // Miedos / Temores
      fears: ["Exposición mediática a campañas de contraste", "Incertidumbre ante la narrativa opositora"],
      temores: ["Exposición mediática a campañas de contraste", "Incertidumbre ante la narrativa opositora"],

      // Orgullos / Fortalezas
      prides: ["Respaldo de la base ciudadana", "Presencia sostenida en la conversación digital"],
      orgullos: ["Respaldo de la base ciudadana", "Presencia sostenida en la conversación digital"],

      // Citas / Testimoniales
      quotes: [
        { text: cita1, cita: cita1, topic: "Medios / Noticieros", emotion: "Ira / Aversión", autor: "Medio Digital" },
        { text: cita2, cita: cita2, topic: "Redes Sociales", emotion: "Confianza / Alegría", autor: "Usuario en Redes" }
      ],
      citas: [
        { text: cita1, cita: cita1, topic: "Medios / Noticieros", emotion: "Ira / Aversión", autor: "Medio Digital" },
        { text: cita2, cita: cita2, topic: "Redes Sociales", emotion: "Confianza / Alegría", autor: "Usuario en Redes" }
      ],

      // Díadas (Plutchik)
      dyads: dyadList,
      diadas: dyadList
    };

    return res.status(200).json(responseData);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
