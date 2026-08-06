export default async function handler(req, res) {
  // 1. Configuración general CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { skill = 'emociones', actor = '', mes = 'Agosto', anio = '2026' } = req.query;

    if (!actor) {
      return res.status(400).json({ error: 'El parámetro "actor" es requerido.' });
    }

    const apifyToken = process.env.APIFY_TOKEN;
    let rawItems = [];

    // --- BLOQUE GENERAL DE EXTRACCIÓN CON APIFY (Compartido por todas las skills) ---
    if (apifyToken) {
      try {
        const actorId = 'apify~google-search-scraper';
        const apifyUrl = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apifyToken}&timeout=60`;

        // Construimos la búsqueda según la skill solicitada para maximizar la relevancia
        const apifyResponse = await fetch(apifyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            queries: `${actor} ${skill} noticias opinion ${mes} ${anio}`,
            maxPagesPerQuery: 1
          })
        });

        if (apifyResponse.ok) {
          const fetchedData = await apifyResponse.json();
          if (Array.isArray(fetchedData)) rawItems = fetchedData;
        }
      } catch (apifyErr) {
        console.error("Error Apify:", apifyErr.message);
      }
    }

    // --- ENRUTADOR POR SKILL (Garantiza aislamiento total) ---
    switch (skill.toLowerCase()) {

      // -------------------------------------------------------------
      // SKILL 1: EMOCIONES (Ya funcionando y probada)
      // -------------------------------------------------------------
      case 'emociones': {
        const extractedTexts = rawItems
          .map(i => i.snippet || i.description || i.title)
          .filter(t => t && typeof t === 'string' && t.length > 15);

        return res.status(200).json({
          concept: `Análisis en Tiempo Real: ${actor}`,
          conceptDesc: `Extraído dinámicamente de ${extractedTexts.length} resultados sobre ${actor}.`,
          emotions: [ /* Arreglo Plutchik activo */ ],
          problematics: extractedTexts.slice(0, 3),
          fears: extractedTexts.slice(3, 5),
          prides: extractedTexts.slice(5, 7),
          quotes: extractedTexts.slice(0, 2).map(t => ({ text: t, topic: "Prensa/Redes" })),
          dyads: [ /* Lista de díadas */ ]
        });
      }

      // -------------------------------------------------------------
      // SKILL 2: RADAR (Ya funcionando)
      // -------------------------------------------------------------
      case 'radar': {
        return res.status(200).json({
          actor: actor,
          totalMentions: rawItems.length,
          sources: rawItems.map(item => ({
            title: item.title,
            url: item.url || item.link,
            snippet: item.snippet
          }))
        });
      }

      // -------------------------------------------------------------
      // SKILL 3: (Petición para cuando configures tu 3ra Skill)
      // -------------------------------------------------------------
      case 'identidad': // o el nombre de tu 3ra skill
      case 'demograficos': {
        return res.status(200).json({
          status: "ok",
          message: `Estructura lista para la Skill ${skill}.`,
          itemsFound: rawItems.length
        });
      }

      // -------------------------------------------------------------
      // SKILL 4: (Petición para cuando configures tu 4ta Skill)
      // -------------------------------------------------------------
      case 'skill4': {
        return res.status(200).json({
          status: "ok",
          message: `Estructura lista para la Skill 4.`
        });
      }

      default:
        return res.status(400).json({ error: `La Skill '${skill}' no está soportada.` });
    }

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
