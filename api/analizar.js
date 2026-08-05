import { ApifyClient } from 'apify-client';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Recibimos 'skill' en la URL (ej: /api/analizar?skill=emociones&actor=...)
  const { skill = 'emociones', actor, mes = 'Agosto', anio = '2026' } = req.query;

  if (!actor) {
    return res.status(400).json({ error: 'El parámetro "actor" es requerido.' });
  }

  const apifyToken = process.env.APIFY_TOKEN;
  if (!apifyToken) {
    return res.status(500).json({ error: 'Falta la variable APIFY_TOKEN en Vercel.' });
  }

  try {
    const client = new ApifyClient({ token: apifyToken });

    // 1. Scraping general con Apify
    const run = await client.actor('apify/google-search-scraper').call({
      queries: `${actor} ${skill} noticias opinion ${mes} ${ANIO}`,
      maxPagesPerQuery: 1,
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    // 2. Enrutador según la Skill solicitada
    let responseData = {};

    switch (skill) {
      case 'emociones':
        responseData = {
          concept: `Emociones de ${actor}`,
          conceptDesc: `Procesado para la skill Emociones.`,
          emotions: [ /* Estructura Plutchik */ ],
          problematics: items.slice(0, 3).map(i => i.title),
          // ...resto de campos de Emociones
        };
        break;

      case 'radar':
        responseData = {
          actor: actor,
          radarMetrics: [ /* Métricas para la skill Radar */ ],
          sources: items.map(i => i.url)
        };
        break;

      default:
        return res.status(400).json({ error: `La skill '${skill}' no está registrada.` });
    }

    return res.status(200).json(responseData);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
