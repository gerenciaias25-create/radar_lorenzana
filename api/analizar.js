export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Usa POST.' });
  }

  const { nombre, fecha } = req.body;

  if (!nombre) {
    return res.status(400).json({ error: 'El nombre es un campo obligatorio.' });
  }

  try {
    // Simulación de respuesta estructurada o llamada a modelo de IA (p. ej., OpenAI/Gemini)
    const mockData = {
      nombre: nombre,
      cargo: "Especialista en Estrategia Digital y Comunicación",
      fecha_consulta: fecha || "Julio 2026",
      resumen_ejecutivo: `Durante el periodo de ${fecha || 'Julio 2026'}, ${nombre} presentó un volumen de conversación positivo en medios digitales. Su presencia destaca principalmente por colaboraciones institucionales y menciones de liderazgo de opinión.`,
      explicacion_ecosistema: `El ecosistema digital de ${nombre} se concentra en un 65% en LinkedIn y X (Twitter). El sentimiento general refleja una baja controversia con un enfoque principalmente institucional.`,
      menciones: 340,
      alcance: 125,
      interacciones: 890,
      sentimiento: {
        positivo: 65,
        neutro: 25,
        negativo: 10
      }
    };

    // Respuesta limpia
    return res.status(200).json(mockData);

  } catch (error) {
    return res.status(500).json({ 
      error: 'Error interno procesando los datos.',
      details: error.message 
    });
  }
}
