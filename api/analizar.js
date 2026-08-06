const https = require('https');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { skill = 'emociones', actor = 'Personaje', mes = 'Agosto', anio = '2026' } = req.query;

  if (!actor) {
    return res.status(400).json({ error: 'El parámetro "actor" es requerido.' });
  }

  const apifyToken = process.env.APIFY_API_TOKEN || process.env.APIFY_TOKEN;
  let rawItems = [];

  // Función auxiliar para llamar a Apify sin depender de fetch
  async function consultarApify(query, token) {
    return new Promise((resolve) => {
      if (!token) return resolve([]);
      
      const postData = JSON.stringify({
        queries: `"${query}" noticias opinion`,
        maxPagesPerQuery: 1
      });

      const options = {
        hostname: 'api.apify.com',
        port: 443,
        path: `/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${token}&timeout=20`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const reqApify = https.request(options, (resApify) => {
        let body = '';
        resApify.on('data', (chunk) => body += chunk);
        resApify.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(Array.isArray(data) ? data : []);
          } catch (e) {
            resolve([]);
          }
        });
      });

      reqApify.on('error', () => resolve([]));
      reqApify.setTimeout(20000, () => { reqApify.destroy(); resolve([]); });
      reqApify.write(postData);
      reqApify.end();
    });
  }

  try {
    rawItems = await consultarApify(actor, apifyToken);
  } catch (err) {
    console.error("Error Apify:", err);
  }

  // Extracción de datos
  const extractedTexts = rawItems
    .map(i => i.snippet || i.description || i.title)
    .filter(t => t && typeof t === 'string' && t.length > 10);

  const prob1 = extractedTexts[0] || `Análisis de la presencia digital y cobertura mediática de ${actor}.`;
  const prob2 = extractedTexts[1] || `Atención a declaraciones y posicionamiento político de ${actor}.`;
  const prob3 = extractedTexts[2] || `Debate y conversación en redes sociales sobre ${actor}.`;

  const cita1 = extractedTexts[3] || prob1;
  const cita2 = extractedTexts[4] || prob2;

  const fear1 = extractedTexts[5] || `Exposición a señalamientos u opiniones críticas respecto a ${actor}.`;
  const fear2 = extractedTexts[6] || `Riesgo de desgaste de narrativa en temas de agenda pública.`;

  const pride1 = extractedTexts[7] || `Respaldo e interacciones de sectores afines a ${actor}.`;
  const pride2 = extractedTexts[8] || `Posicionamiento en medios locales y digitales.`;

  const emotionsData = [
    { key: "joy", label: "Alegría", active: true, intensity: 2, color: ["#fef08a", "#fde047", "#eab308"], deg: 0, triggers: ["Aceptación pública", "Cobertura positiva"] },
    { key: "trust", label: "Confianza", active: true, intensity: 3, color: ["#bbf7d0", "#86efac", "#22c55e"], deg: 45, triggers: ["Respaldos clave", "Presencia institucional"] },
    { key: "fear", label: "Miedo", active: false, intensity: 1, color: ["#bfdbfe", "#93c5fd", "#3b82f6"], deg: 90, triggers: [] },
    { key: "surprise", label: "Sorpresa", active: true, intensity: 2, color: ["#ddd6fe", "#c084fc", "#a855f7"], deg: 135, triggers: ["Nuevos posicionamientos"] },
    { key: "sadness", label: "Tristeza", active: false, intensity: 1, color: ["#fed7aa", "#fdba74", "#f97316"], deg: 180, triggers: [] },
    { key: "disgust", label: "Aversión", active: true, intensity: 2, color: ["#fecdd3", "#fda4af", "#f43f5e"], deg: 225, triggers: ["Críticas mediáticas"] },
    { key: "anger", label: "Ira", active: true, intensity: 3, color: ["#fecaca", "#fca5a5", "#ef4444"], deg: 270, triggers: ["Polarización en redes"] },
    { key: "anticipation", label: "Anticipación", active: true, intensity: 2, color: ["#fef9c3", "#fef08a", "#ca8a04"], deg: 315, triggers: ["Expectativa de agenda"] }
  ];

  const dyadList = [
    { name: "Agresividad / Confrontación", formula: "Ira + Anticipación", text: `Tensión detectada en entorno digital para ${actor}: ${prob1}` },
    { name: "Alevosía / Contraste", formula: "Aversión + Ira", text: `Señalamientos y posturas opositoras hacia ${actor}: ${prob2}` },
    { name: "Optimismo / Aceptación", formula: "Alegría + Anticipación", text: `Recepción de propuestas y agenda de ${actor}: ${prob3}` }
  ];

  return res.status(200).json({
    concept: `Humor Social: ${actor}`,
    conceptDesc: rawItems.length > 0 
      ? `Se extrajeron ${rawItems.length} entradas en vivo desde Apify para este análisis.`
      : `Análisis procesado para ${actor} (${mes} ${anio}).`,
    emotions: emotionsData,
    emociones: emotionsData,
    secondary: [
      { name: "Optimismo", text: "Percepción favorable en sectores afines", color: "#22c55e" },
      { name: "Tensión Mediática", text: "Confrontación en debate público", color: "#ef4444" }
    ],
    problematics: [prob1, prob2, prob3],
    problematicas: [prob1, prob2, prob3],
    fears: [fear1, fear2],
    temores: [fear1, fear2],
    prides: [pride1, pride2],
    orgullos: [pride1, pride2],
    quotes: [
      { text: cita1, topic: "Prensa / Redes", emotion: "Crítica / Tensión" },
      { text: cita2, topic: "Medios Informativos", emotion: "Confianza" }
    ],
    dyads: dyadList,
    diadas: dyadList
  });
}
