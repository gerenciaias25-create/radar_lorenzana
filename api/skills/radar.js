const datosRadar = {
  header: {
    nombre: "DANIEL SERRANO PALACIOS",
    puesto: "Presidente Municipal · Cuautitlán Izcalli · Morena · 1 Ene – 12 Abr 2026"
  },
  kpis: {
    npsPartido: {
      labels: ['Base Morena', 'Morena dis.', 'Independ.', 'Op. blanda', 'Op. dura'],
      data: [28, -8, -12, -31, -58]
    },
    npsDemo: {
      labels: ['H18-29', 'M18-29', 'H30-44', 'M30-44', 'H45-59', 'M45-59', 'H60+', 'M60+'],
      data: [-10, -26, 6, -12, 22, 10, 18, 12]
    },
    ratioPlataformas: {
      labels: ['Twitter/X', 'WhatsApp', 'TikTok', 'Facebook', 'Instagram', 'Medios'],
      data: [3.8, 3.2, 2.9, 1.8, 1.4, 1.1]
    },
    traEvolucion: {
      labels: ['E1', 'E2', 'E3', 'E4', 'F1', 'F2', 'F3', 'F4', 'M1', 'M2', 'M3', 'M4', 'A1'],
      data: [12, 14, 12, 10, 8, 2, -4, -2, 4, 6, 2, 4, 6]
    }
  },
  sentimiento: {
    general: { labels: ['Positivo', 'Neutro', 'Negativo', 'Polarizado'], data: [34, 28, 26, 12] },
    genero: { labels: ['H Pos', 'H Neu', 'H Neg', 'M Pos', 'M Neu', 'M Neg'], data: [42, 30, 18, 26, 26, 38] },
    edad: { labels: ['18-29', '30-44', '45-59', '60+'], data: [-18, 4, 22, 15] },
    partido: { labels: ['Base Morena', 'Indep.', 'Op. blanda', 'Op. dura'], data: [28, -12, -31, -58] }
  },
  topOfMind: {
    general: {
      labels: ['Seguridad', 'Masacre/Violencia', 'Día del Pueblo', 'Datos manipulados', 'TEEM/Cabildo', 'Territorio', 'Cultura'],
      data: [42, 18, 12, 11, 8, 5, 4]
    },
    genero: {
      labels: ['Seguridad', 'Agua/Servicios', 'Cultura', 'Masacre', 'Alumbrado', 'Obras'],
      hombres: [52, 10, 12, 20, 3, 14],
      mujeres: [34, 38, 8, 24, 16, 10]
    },
    edad: {
      grupos: ['18-29', '30-44', '45-59', '60+'],
      labels: ['Seguridad', 'Cultura', 'Empleo', 'Agua/Serv.'],
      data: [[28, 42, 48, 44], [41, 22, 8, 4], [28, 18, 6, 4], [8, 20, 28, 32]]
    },
    partido: {
      labels: ['Seguridad', 'Principios 4T', 'Transparencia', 'Obras', 'Predial/Agua', 'Territorio'],
      base: [44, 10, 5, 26, 8, 7],
      fsai: [12, 62, 21, 2, 14, 6],
      indep: [32, 8, 10, 20, 22, 8]
    }
  },
  plataformas: {
    alcance: { labels: ['Facebook', 'Twitter/X', 'Instagram', 'Medios', 'WhatsApp', 'TikTok'], data: [48, 22, 12, 11, 5, 2] },
    tono: {
      labels: ['Facebook', 'Twitter/X', 'Instagram', 'Medios', 'WhatsApp', 'TikTok'],
      pos: [52, 22, 38, 18, 28, 32],
      neg: [24, 58, 32, 61, 52, 41]
    },
    edad: {
      labels: ['Facebook', 'Twitter/X', 'Instagram', 'TikTok', 'WhatsApp'],
      g18_29: [12, 38, 52, 82, 28],
      g30_44: [28, 34, 34, 12, 42],
      g45_59: [42, 20, 10, 4, 24],
      g60: [18, 8, 4, 2, 6]
    },
    viralidad: {
      labels: ['TikTok', 'Twitter/X', 'WhatsApp', 'Instagram', 'Facebook', 'Medios'],
      critica: [1.2, 2.4, 3.1, 5.8, 8.2, 12.4],
      propia: [18, 6.2, 14, 22, 9.4, 36]
    }
  },
  narrativas: {
    favorables: [
      { titulo: "Seguridad en descenso", desc: "Datos SESNSP avalan reducción delictiva.", tags: [{t:"♂ H 45-59", c:"bgen"}, {t:"Zonas norte", c:"bloc"}, {t:"Base Morena", c:"bpar"}], detalle: "<strong>Bivariado:</strong> H 45-59 la amplifican 2.3x más que la media." },
      { titulo: "Alcalde en campo", desc: "'Día del Pueblo' refuerza imagen de proximidad.", tags: [{t:"♀ M 30-44", c:"bgen"}, {t:"San Antonio", c:"bloc"}], detalle: "<strong>Bivariado:</strong> Mujeres 30-44 son las principales amplificadoras." }
    ],
    criticas: [
      { titulo: "⚠ Manipulación de datos", desc: "Omisión de homicidios culposos. Riesgo CRÍTICO.", tags: [{t:"Medios indep.", c:"bsrc"}, {t:"♀ Mujeres", c:"bgen"}], detalle: "<strong>Bivariado:</strong> Instalada por medios independientes → daño estructural.", esCritica: true },
      { titulo: "Masacre La Quebrada", desc: "≥5 muertos el 18-feb. Omitido en datos oficiales.", tags: [{t:"La Quebrada", c:"bloc"}], detalle: "<strong>Bivariado:</strong> NPS-P en La Quebrada: −42.", esCritica: true }
    ],
    neutras: [
      { titulo: "Obras y servicios", desc: "Bacheo, agua, drenaje. Alta frecuencia, baja emocionalidad.", tags: [{t:"♀ M 45+", c:"bgen"}], detalle: "<strong>Bivariado:</strong> Receptividad alta en M 45+ pero no genera adhesión emocional." }
    ]
  },
  riesgos: [
    { nivel: "CRÍTICO", nivelClase: "lc", titulo: "Manipulación de datos de seguridad", desc: "Documentado por medios independientes. Si escala nacional, daño irreversible.", detalle: "<strong>Bivariado:</strong> Universal pero más intenso en mujeres (−38pp NPS-P)." },
    { nivel: "ALTO", nivelClase: "la", titulo: "Narrativa de 'autoritarismo' institucional", desc: "TEEM instaló el frame.", detalle: "<strong>Bivariado:</strong> Más peligroso en Twitter/X entre 18-44 años." }
  ],
  oportunidades: [
    { nivel: "ALTO", nivelEstilo: "background:#008080;color:#fff", titulo: "Disputa territorial Teoloyucan", desc: "Narrativa de defensa del territorio puede unir más allá de la base.", detalle: "<strong>Bivariado:</strong> Único tema transpartidista: 34% de independientes lo valoran." },
    { nivel: "MEDIO", nivelEstilo: "background:rgba(0,194,212,.8);color:#fff", titulo: "Festival cultural como narrativa identitaria", desc: "Arte, Queso y Vino puede posicionar Izcalli.", detalle: "<strong>Bivariado:</strong> Resonancia en jóvenes 25-40." }
  ],
  territorial: {
    zonas: [
      { nombre: "Centro Urbano", nps: "-5", estado: "🟡 INERCIAL", clase: "ine", desc: "Comercio informal domina" },
      { nombre: "La Quebrada", nps: "-42", estado: "🔴 ADVERSA CRÍTICA", clase: "adv", desc: "Masacre feb. Sin respuesta" },
      { nombre: "San Antonio", nps: "+24", estado: "🟢 FAVORABLE", clase: "fav", desc: "Post Día del Pueblo" },
      { nombre: "Zona Industrial", nps: "+3", estado: "🟡 INERCIAL", clase: "ine", desc: "Baja conversación política" }
    ],
    nps: { labels: ['San Antonio', 'Prado Iz.', 'Centro', 'La Quebrada'], data: [24, 8, -5, -42] },
    volumen: { labels: ['La Quebrada', 'Centro', 'San Antonio'], data: [28, 22, 18] }
  }
};
