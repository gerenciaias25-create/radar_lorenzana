/**
 * Estructura de Datos Simulada (JSON procedente del Backend)
 */
const radarData = {
  kpis: {
    seguidores: "245,800",
    aprobacion: "62.4%",
    crisis: "1",
    menciones: "18,450"
  },
  kpis_ampliados: {
    matriz: [
      { metrica: "Alcance Bruto Estimado", valor: "1.2M impresiones", comparativa: "+12%" },
      { metrica: "Menciones Positivas", valor: "11,512", comparativa: "+8%" },
      { metrica: "Menciones Negativas", valor: "3,120", comparativa: "-3%" },
      { metrica: "Índice de Viralidad", valor: "4.2", comparativa: "+0.5" }
    ]
  },
  sentimiento: {
    distribucion: [55, 25, 15, 5], // Positivo, Neutro, Negativo, Polarizado
    resumen: "El sentimiento predominante hacia Daniel Serrano se mantiene mayoritariamente favorable (55%), impulsado por iniciativas locales. Las menciones negativas (15%) se concentran en críticas de la oposición sobre la gestión de servicios."
  },
  top_of_mind: {
    temas: ["Infraestructura Urbana", "Programas Sociales", "Transparencia", "Seguridad Pública", "Política Regional"],
    volumenes: [35, 25, 18, 14, 8]
  },
  plataformas: {
    canales: ["Facebook", "X (Twitter)", "Prensa Web", "Instagram"],
    participacion: [40, 30, 20, 10],
    tono_favorable: [60, 40, 50, 75],
    tono_adiverso: [20, 45, 30, 10]
  },
  narrativas: {
    favorables: [
      { titulo: "Impulso a la Obra Pública", desc: "Destacan la pronta entrega de reencarpetado vial y mejoras de alumbrado." },
      { titulo: "Cercanía Ciudadana", desc: "Buena recepción de los recorridos territoriales y atención directa." }
    ],
    criticas: [
      { titulo: "Cuestionamiento Presupuestal", desc: "Actores de oposición señalan demoras en la ejecución de partidas específicas." }
    ],
    neutras: [
      { titulo: "Cobertura de Eventos Oficiales", desc: "Notas informativas de medios locales sin toma de postura explícita." }
    ],
    cronologia: [
      { fecha: "22 Julio, 2026", titulo: "Inauguración de Centro Comunitario", desc: "Pico de conversación positiva en Facebook." },
      { fecha: "18 Julio, 2026", titulo: "Señalamiento por Tráfico Vial", desc: "Alerta media por embotellamiento derivado de obras." }
    ]
  },
  riesgos_oportunidades: {
    dictamen: "La marca personal de Daniel Serrano mantiene solidez. La principal vulnerabilidad radica en la amplificación de quejas de movilidad urbana en X (Twitter). Existe una oportunidad clara de capitalizar la narrativa de transparencia.",
    riesgos: [
      { nivel: "CRÍTICO", titulo: "Narrativa sobre Movilidad", desc: "Potencial articulación de grupos vecinales en protesta por cierres de calles." },
      { nivel: "MEDIO", titulo: "Ataques de Cuentas Automatizadas", desc: "Incremento leve de bots atacando la gestión." }
    ],
    oportunidades: [
      { nivel: "ALTO", titulo: "Posicionamiento en Transparencia", desc: "Publicar reportes semanales de avances de obras para desactivar críticas." }
    ]
  },
  mapa_territorial: {
    genero: [48, 52], // Hombres, Mujeres
    edades_labels: ["18-24", "25-34", "35-44", "45-54", "55+"],
    edades_aprobacion: [58, 64, 61, 55, 60],
    geografia_texto: "Se detecta un núcleo fuerte de aprobación en la Zona Centro y Norte, mientras que en la Zona Poniente se requiere reforzar la comunicación de avances de servicios públicos."
  }
};

/**
 * Inicialización al cargar el DOM
 */
document.addEventListener("DOMContentLoaded", () => {
  // 1. Ocultar e inyectar valores en los KPIs (extraídos dinámicamente)
  extraerYProcesarKPIs();

  // 2. Cargar componentes visuales por defecto
  renderizarKPIsAmpliados();
  renderizarSentimiento();
  renderizarTopOfMind();
  renderizarPlataformas();
  renderizarNarrativas();
  renderizarRiesgosOportunidades();
  renderizarMapaTerritorial();
});

/**
 * Asigna los valores al DOM (aunque la fila permanezca oculta por CSS)
 */
function extraerYProcesarKPIs() {
  document.getElementById("kpi-seguidores").innerText = radarData.kpis.seguidores;
  document.getElementById("kpi-aprobacion").innerText = radarData.kpis.aprobacion;
  document.getElementById("kpi-crisis").innerText = radarData.kpis.crisis;
  document.getElementById("kpi-menciones").innerText = radarData.kpis.menciones;
}

/**
 * Lógica de Conmutación de Pestañas Principales
 */
function switchMainTab(tabId, element) {
  document.querySelectorAll(".tabs-nav .tab-btn").forEach(btn => btn.classList.remove("active"));
  document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));

  element.classList.add("active");
  document.getElementById(`tab-${tabId}`).classList.add("active");
}

/**
 * Lógica de Conmutación de Subpestañas
 */
function switchSubTab(parentTab, subTabId, element) {
  const parentContainer = document.getElementById(`tab-${parentTab}`);
  parentContainer.querySelectorAll(".subtab-btn").forEach(btn => btn.classList.remove("active"));
  parentContainer.querySelectorAll(".subtab-content").forEach(content => content.classList.remove("active"));

  element.classList.add("active");
  document.getElementById(`subtab-${parentTab}-${subTabId}`).classList.add("active");
}

/* ==========================================
   RENDERIZADO DE COMPONENTES Y GRÁFICOS
========================================== */

function renderizarKPIsAmpliados() {
  const container = document.getElementById("matriz-metricas-container");
  let html = `<table style="width:100%; border-collapse:collapse; color:var(--text-primary);">
    <thead>
      <tr style="border-bottom:1px solid var(--border-color); text-align:left;">
        <th style="padding:10px;">Métrica</th>
        <th style="padding:10px;">Valor Actual</th>
        <th style="padding:10px;">Var. vs Periodo Previo</th>
      </tr>
    </thead>
    <tbody>`;
  
  radarData.kpis_ampliados.matriz.forEach(row => {
    html += `<tr style="border-bottom:1px solid var(--border-color);">
      <td style="padding:10px;">${row.metrica}</td>
      <td style="padding:10px; font-weight:bold;">${row.valor}</td>
      <td style="padding:10px; color:${row.comparativa.includes('+') ? 'var(--color-positive)' : 'var(--color-negative)'};">${row.comparativa}</td>
    </tr>`;
  });
  
  html += `</tbody></table>`;
  container.innerHTML = html;

  // Gráfico Evolución
  const ctx = document.getElementById('chartEvolucion').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'],
      datasets: [{
        label: 'Menciones Totales',
        data: [12000, 14500, 13000, 18450],
        borderColor: '#38bdf8',
        tension: 0.3
      }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#f8fafc' } } } }
  });
}

function renderizarSentimiento() {
  document.getElementById("sentimiento-resumen-texto").innerText = radarData.sentimiento.resumen;

  // Gráfico Dona Sentimiento
  const ctx = document.getElementById('chartSentimientoDona').getContext('2d');
  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Positivo', 'Neutro', 'Negativo', 'Polarizado'],
      datasets: [{
        data: radarData.sentimiento.distribucion,
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
      }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#f8fafc' } } } }
  });

  // Cruces Bivariados
  const container = document.getElementById("cruces-bivariados-list");
  container.innerHTML = `
    <div class="item-box">
      <h4>Eje Infraestructura vs. Tono Favorable</h4>
      <p>El 70% de la conversación vinculada a obras públicas presenta un tono marcadamente positivo.</p>
    </div>
    <div class="item-box">
      <h4>X (Twitter) vs. Tono Adverso</h4>
      <p>El 45% de los comentarios de tinte crítico se concentran exclusivamente en la plataforma X.</p>
    </div>
  `;
}

function renderizarTopOfMind() {
  const ctx = document.getElementById('chartTopMindBar').getContext('2d');
  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: radarData.top_of_mind.temas,
      datasets: [{
        label: 'Volumen de Conversación (%)',
        data: radarData.top_of_mind.volumenes,
        backgroundColor: '#38bdf8'
      }]
    },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { labels: { color: '#f8fafc' } } } }
  });

  const grid = document.getElementById("actores-clave-grid");
  grid.innerHTML = `
    <div class="item-box">
      <h4>Prensa Local</h4>
      <p>Impacto: **Alto** | Tendencia: Neutral-Favorable</p>
    </div>
    <div class="item-box">
      <h4>Oposición Política</h4>
      <p>Impacto: **Medio** | Tendencia: Crítica enfocado en movilidad</p>
    </div>
  `;
}

function renderizarPlataformas() {
  const ctxCanal = document.getElementById('chartPlataformasCanal').getContext('2d');
  new Chart(ctxCanal, {
    type: 'pie',
    data: {
      labels: radarData.plataformas.canales,
      datasets: [{
        data: radarData.plataformas.participacion,
        backgroundColor: ['#1877f2', '#1da1f2', '#64748b', '#e1306c']
      }]
    }
  });

  const ctxTono = document.getElementById('chartTonoPlataforma').getContext('2d');
  new Chart(ctxTono, {
    type: 'bar',
    data: {
      labels: radarData.plataformas.canales,
      datasets: [
        { label: '% Favorable', data: radarData.plataformas.tono_favorable, backgroundColor: '#10b981' },
        { label: '% Adverso', data: radarData.plataformas.tono_adiverso, backgroundColor: '#ef4444' }
      ]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#f8fafc' } } } }
  });

  document.getElementById("monitoreo-directo-container").innerHTML = `
    <p style="font-size:0.9rem; color:var(--text-secondary);">Listado de publicaciones capturadas en las últimas 24 horas...</p>
  `;
}

function renderizarNarrativas() {
  const favContainer = document.getElementById("narrativas-favorables");
  radarData.narrativas.favorables.forEach(item => {
    favContainer.innerHTML += `<div class="item-box"><h4>${item.titulo}</h4><p>${item.desc}</p></div>`;
  });

  const critContainer = document.getElementById("narrativas-criticas");
  radarData.narrativas.criticas.forEach(item => {
    critContainer.innerHTML += `<div class="item-box"><h4>${item.titulo}</h4><p>${item.desc}</p></div>`;
  });

  const neuContainer = document.getElementById("narrativas-neutras");
  radarData.narrativas.neutras.forEach(item => {
    neuContainer.innerHTML += `<div class="item-box"><h4>${item.titulo}</h4><p>${item.desc}</p></div>`;
  });

  const timeContainer = document.getElementById("timeline-container");
  radarData.narrativas.cronologia.forEach(item => {
    timeContainer.innerHTML += `
      <div class="timeline-item">
        <div class="timeline-date">${item.fecha}</div>
        <h4>${item.titulo}</h4>
        <p style="font-size:0.85rem; color:var(--text-secondary);">${item.desc}</p>
      </div>
    `;
  });
}

function renderizarRiesgosOportunidades() {
  document.getElementById("dictamen-estrategico-texto").innerHTML = `<p>${radarData.riesgos_oportunidades.dictamen}</p>`;

  const riesgosContainer = document.getElementById("lista-riesgos");
  radarData.riesgos_oportunidades.riesgos.forEach(item => {
    const claseBadge = item.nivel.toLowerCase();
    riesgosContainer.innerHTML += `
      <div class="item-box">
        <span class="badge-risk ${claseBadge}">${item.nivel}</span>
        <h4>${item.titulo}</h4>
        <p>${item.desc}</p>
      </div>
    `;
  });

  const oportContainer = document.getElementById("lista-oportunidades");
  radarData.riesgos_oportunidades.oportunidades.forEach(item => {
    oportContainer.innerHTML += `
      <div class="item-box">
        <span class="badge-risk medio">OPORTUNIDAD</span>
        <h4>${item.titulo}</h4>
        <p>${item.desc}</p>
      </div>
    `;
  });
}

function renderizarMapaTerritorial() {
  const ctxGenero = document.getElementById('chartDemografiaGenero').getContext('2d');
  new Chart(ctxGenero, {
    type: 'doughnut',
    data: {
      labels: ['Hombres', 'Mujeres'],
      datasets: [{
        data: radarData.mapa_territorial.genero,
        backgroundColor: ['#0284c7', '#ec4899']
      }]
    }
  });

  const ctxEdad = document.getElementById('chartDemografiaEdad').getContext('2d');
  new Chart(ctxEdad, {
    type: 'bar',
    data: {
      labels: radarData.mapa_territorial.edades_labels,
      datasets: [{
        label: '% Aprobación',
        data: radarData.mapa_territorial.edades_aprobacion,
        backgroundColor: '#38bdf8'
      }]
    }
  });

  document.getElementById("analisis-geografico-texto").innerHTML = `
    <p style="line-height:1.6; font-size:0.95rem;">${radarData.mapa_territorial.geografia_texto}</p>
  `;
}
