(function(){
const D_RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('sg-root');

const FALLBACK = {
  meta: { entidad: META.actor || 'Sin entidad', segmento: 'Electorado general', periodo: (META.mes||'')+' '+(META.anio||''), fuentes: 0, estado: 'LIMITADO', ventanaPersuasion: 'Entreabierta' },
  metricas: {
    sesgosCriticos: { valor: 0, detalle: 'Sin datos disponibles.' },
    sesgosAltos: { valor: 0, detalle: 'Sin datos disponibles.' },
    sri: { valor: 0, nivel: 'Medio', detalle: 'Sin datos disponibles.' },
    sistemaDominante: { valor: 'Sistema 1', detalle: 'Sin datos disponibles.' }
  },
  ranking: [], segmentos: [], ventanasPersuasion: [], arquitecturaMensajes: [],
  resumenEjecutivo: ''
};
function pick(v, fb){
  if (v === undefined || v === null) return fb;
  if (Array.isArray(v)) return v.length ? v : fb;
  if (typeof v === 'object') return Object.keys(v).length ? v : fb;
  return v;
}
const D = {};
Object.keys(FALLBACK).forEach(k => { D[k] = pick(D_RAW && D_RAW[k], FALLBACK[k]); });
// metricas es objeto anidado: si vino parcialmente lleno, completa cada sub-indicador con su fallback.
Object.keys(FALLBACK.metricas).forEach(k => {
  D.metricas[k] = pick(D.metricas[k], FALLBACK.metricas[k]);
});

// ---------- paletas ----------
const CAT_COLOR = {"I":"#6366F1","II":"#0EA5E9","III":"#10B981","IV":"#F59E0B","V":"#EF4444","VI":"#8B5CF6","VII":"#EC4899","VIII":"#64748B"};
const SEG_COLOR = {"verde":"#15803D","azul":"#1D4ED8","ambar":"#B45309","gris":"#475569"};
const VP_PALETTE = ["#16A34A","#2563EB","#D97706","#DC2626","#7C3AED","#0EA5E9"];
const AM_TAG = {
  "Diferenciación": {bg:"#FEF3C7", tx:"#92400E"},
  "Posicionamiento": {bg:"#DBEAFE", tx:"#1E40AF"},
  "Lanzamiento": {bg:"#EDE9FE", tx:"#4C1D95"},
  "Contención": {bg:"#FEE2E2", tx:"#991B1B"},
  "Movilización": {bg:"#DCFCE7", tx:"#166534"}
};
function nivelClass(nivel){
  const n = (nivel||'').toLowerCase();
  if (n.indexOf('crít') === 0 || n.indexOf('crit') === 0) return 'lvl-critico';
  if (n.indexOf('alt') === 0) return 'lvl-alto';
  if (n.indexOf('med') === 0) return 'lvl-medio';
  return 'lvl-bajo';
}
function scoreColor(score){
  if (score >= 81) return '#DC2626';
  if (score >= 61) return '#D97706';
  if (score >= 41) return '#2563EB';
  return '#16A34A';
}
function estadoColor(estado){
  const e = (estado||'').toUpperCase();
  if (e === 'ROBUSTO') return '#4ADE80';
  if (e === 'MODERADO') return '#FBBF24';
  return '#F87171';
}
function ventanaColor(v){
  const s = (v||'').toLowerCase();
  if (s === 'abierta') return '#4ADE80';
  if (s === 'entreabierta') return '#FBBF24';
  return '#F87171';
}

// ---------- header ----------
document.getElementById('sg-hdr-sub').textContent = [D.meta.entidad, D.meta.segmento].filter(Boolean).join(' · ');
document.getElementById('sg-hdr-meta').innerHTML = `Periodo: ${D.meta.periodo || '—'} · Fuentes: ${D.meta.fuentes || 0} · <span class="status-badge" style="color:${estadoColor(D.meta.estado)}">${D.meta.estado || '—'}</span>`;
const pv = document.getElementById('sg-persuasion-val');
pv.textContent = D.meta.ventanaPersuasion || '—';
pv.style.color = ventanaColor(D.meta.ventanaPersuasion);
document.getElementById('sg-ftr-l').textContent = 'Radar - Sesgo · ' + (META.actor || D.meta.entidad || '');

// ---------- métricas ----------
document.getElementById('sg-m-criticos-val').textContent = D.metricas.sesgosCriticos.valor;
document.getElementById('sg-m-criticos-det').textContent = D.metricas.sesgosCriticos.detalle;
document.getElementById('sg-m-altos-val').textContent = D.metricas.sesgosAltos.valor;
document.getElementById('sg-m-altos-det').textContent = D.metricas.sesgosAltos.detalle;
const sriColor = D.metricas.sri.nivel === 'Alto' ? '#DC2626' : (D.metricas.sri.nivel === 'Medio' ? '#D97706' : '#16A34A');
const sriVal = document.getElementById('sg-m-sri-val');
sriVal.textContent = `${D.metricas.sri.valor} · ${D.metricas.sri.nivel}`;
sriVal.style.color = sriColor;
document.getElementById('sg-m-sri-det').textContent = D.metricas.sri.detalle;
const sisVal = document.getElementById('sg-m-sistema-val');
const esSistema1 = /1/.test(D.metricas.sistemaDominante.valor);
sisVal.innerHTML = `${D.metricas.sistemaDominante.valor} ${esSistema1?'🔴':'🟢'}`;
sisVal.style.color = esSistema1 ? '#DC2626' : '#16A34A';
document.getElementById('sg-m-sistema-det').textContent = D.metricas.sistemaDominante.detalle;

// ---------- ranking ----------
const rankingOrdenado = (D.ranking||[]).slice().sort((a,b)=>(b.score||0)-(a.score||0));
document.getElementById('sg-ranking').innerHTML = rankingOrdenado.map(r=>`
  <div class="row">
    <div class="cat-badge" style="background:${CAT_COLOR[r.categoria]||'#64748B'}">${r.categoria||'—'}</div>
    <div style="flex:1;min-width:0">
      <div class="row-name">${r.codigo?r.codigo+' ':''}${r.nombre}</div>
      <div class="row-desc">${r.descripcion||''}</div>
    </div>
    <div class="row-score" style="color:${scoreColor(r.score)}">${r.score}</div>
    <div class="lvl-pill ${nivelClass(r.nivel)}">${r.nivel||'—'}</div>
  </div>`).join('') || '<div class="row">Sin sesgos detectados.</div>';

// ---------- segmentos ----------
document.getElementById('sg-segmentos').innerHTML = (D.segmentos||[]).map(s=>`
  <div class="card">
    <div class="seg-lbl" style="color:${SEG_COLOR[s.color]||'#475569'}">${s.perfil}</div>
    <div class="seg-main">${s.sesgoPrincipal||''}</div>
    <div class="seg-sub">${s.sesgoSecundario||''}</div>
    <div class="seg-read">${s.lectura||''}</div>
  </div>`).join('') || '<div class="card">Sin segmentos disponibles.</div>';

// ---------- ventanas de persuasión ----------
document.getElementById('sg-ventanas').innerHTML = (D.ventanasPersuasion||[]).map((v,i)=>`
  <div class="card">
    <div class="vp-item">
      <div class="vp-num" style="background:${VP_PALETTE[i%VP_PALETTE.length]}"><span>${i+1}</span></div>
      <div>
        <div class="vp-seg">${v.segmento||''}</div>
        <div class="vp-sesgo">Sesgo activo: ${v.sesgoActivo||''} · IVP: ${v.ivp||''}</div>
        <div class="vp-rec">${v.recomendacion||''}</div>
      </div>
    </div>
  </div>`).join('') || '<div class="card">Sin ventanas de persuasión detectadas.</div>';

// ---------- arquitectura de mensajes ----------
document.getElementById('sg-mensajes').innerHTML = (D.arquitecturaMensajes||[]).map(m=>{
  const tag = AM_TAG[m.etiqueta] || {bg:'#E2E8F0', tx:'#334155'};
  return `<div class="card">
    <div class="am-item">
      <span class="am-tag" style="background:${tag.bg};color:${tag.tx}">${m.etiqueta||''}</span>
      <div>
        <div class="am-title">${m.titulo||''}</div>
        <div class="am-text">${m.texto||''}</div>
      </div>
    </div>
  </div>`;
}).join('') || '<div class="card">Sin arquitectura de mensajes disponible.</div>';

// ---------- resumen ejecutivo ----------
document.getElementById('sg-resumen').textContent = D.resumenEjecutivo || 'Sin resumen ejecutivo disponible.';

/* CHART: top sesgos por SAS, coloreado por umbral */
const chartCanvas = document.getElementById('sg-chart');
const top = rankingOrdenado.slice(0, 10);
if (chartCanvas && top.length > 0){
  new Chart(chartCanvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: top.map(r => `${r.codigo?r.codigo+' ':''}${r.nombre}`),
      datasets: [{
        label: 'SAS',
        data: top.map(r => r.score),
        backgroundColor: top.map(r => scoreColor(r.score)),
        borderRadius: 5,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ' SAS: ' + c.raw + ' / 100' } }
      },
      scales: {
        x: { min: 0, max: 100, ticks: { color: '#475569', font: { size: 11 }, stepSize: 20 }, grid: { color: 'rgba(0,0,0,.08)' } },
        y: { ticks: { color: '#1C2738', font: { size: 11, weight: '600' } }, grid: { display: false } }
      }
    }
  });
}
})();
