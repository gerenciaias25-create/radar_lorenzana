(function(){
const D_RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('op-root');

const NIVEL_CLASS = {"CRÍTICO":"r","ALTO":"y","MEDIO":"o","BAJO":"g"};
const NIVEL_ALCLASS = {"CRÍTICO":"al-r","ALTO":"al-y","MEDIO":"al-o","BAJO":"al-g"};
const NIVEL_TAG = {"CRÍTICO":"tr","ALTO":"ty","MEDIO":"to","BAJO":"tg"};
const NIVEL_BAR = {"CRÍTICO":"var(--red2)","ALTO":"var(--yellow)","MEDIO":"var(--orange)","BAJO":"var(--green)"};

const FALLBACK = {
  actor: {cargo:'Servidor(a) Público(a)', partido:'—', periodo:(META.mes||'')+' '+(META.anio||''), aspiracion:''},
  vulnerabilidades: [], fortalezas: [],
  perfil: {rows:[], cronologia:[], ierPorCargo:[]},
  contradicciones: {ranking:[], destacados:[], tabla:[]},
  vectoresAtaque: [],
  redDePoder: {radar:[0,0,0,0,0,0], alertas:[], tabla:[]},
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

// ---------- header ----------
document.getElementById('op-hdr-name').innerHTML = (META.actor || 'OBJETIVO').toUpperCase();
document.getElementById('op-hdr-sub').textContent = [D.actor.cargo, D.actor.partido, D.actor.periodo, D.actor.aspiracion ? ('Aspirante: '+D.actor.aspiracion) : ''].filter(Boolean).join(' · ');
document.getElementById('op-ftr-l').textContent = 'Radar - Opositor · ' + (META.actor || '');

// ---------- tabs ----------
window.opShow = function(id, btn){
  root.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  root.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
};
window.opTv = function(el){ el.classList.toggle('expanded'); el.querySelector('.varr').textContent = el.classList.contains('expanded') ? '▲' : '▼'; };

// ---------- VULNERABILIDADES (ov) ----------
document.getElementById('op-ov-alerts').innerHTML = (D.vulnerabilidades||[]).map(v=>`
  <div class="al ${NIVEL_ALCLASS[v.nivel]||'al-o'}">
    <h4 class="${NIVEL_CLASS[v.nivel]||'o'}">${v.nivel==='CRÍTICO'?'🔴':'🟡'} ${v.nivel} — ${v.titulo}</h4>
    <ul>${(v.bullets||[]).map(b=>`<li>${b}</li>`).join('')}</ul>
  </div>`).join('') || '<div class="al al-o">Sin vulnerabilidades detectadas.</div>';

document.getElementById('op-ov-ranking').innerHTML = (D.vulnerabilidades||[]).map(v=>`
  <div class="pw"><div class="pl"><span>${v.titulo}</span><span class="${NIVEL_CLASS[v.nivel]||'o'}">${v.score}/10</span></div>
  <div class="pb"><div class="pf" style="width:${(v.score/10)*100}%;background:${NIVEL_BAR[v.nivel]||'var(--orange)'}"></div></div></div>`).join('') || '<div class="pw">Sin datos.</div>';

document.getElementById('op-ov-fortalezas').innerHTML = (D.fortalezas||[]).map(f=>`
  <div class="al al-g" style="margin-bottom:8px"><h4 class="g">${f.titulo}</h4><p>${f.texto}</p></div>`).join('') || '<div class="al al-g">Sin fortalezas registradas.</div>';

// ---------- PERFIL (pf) ----------
document.getElementById('op-pf-nombre').textContent = META.actor || '';
document.getElementById('op-pf-rol').textContent = [D.actor.cargo, D.actor.partido].filter(Boolean).join(' · ');
document.getElementById('op-pf-rows').innerHTML = (D.perfil.rows||[]).map(r=>`<div class="ps"><strong>${r.label}</strong><span>${r.value}</span></div>`).join('') || '<div class="ps">Sin datos.</div>';
document.getElementById('op-pf-cron').innerHTML = (D.perfil.cronologia||[]).map(c=>`
  <div class="ti"><div class="ty2">${c.periodo}</div><div class="tt">${c.titulo}</div><div class="td">${c.descripcion}</div></div>`).join('') || '<div class="ti"><div class="td">Sin cronología disponible.</div></div>';

// ---------- CONTRADICCIONES (co) ----------
document.getElementById('op-co-sub').textContent = `${(D.contradicciones.tabla||[]).length} contradicciones verificadas en fuentes públicas y de investigación digital del período.`;
document.getElementById('op-co-ranking').innerHTML = (D.contradicciones.ranking||[]).map(r=>`
  <div class="pw"><div class="pl"><span>${r.codigo} · ${r.titulo}</span><span class="${NIVEL_CLASS[r.nivel]||'o'}">${r.score}/10</span></div>
  <div class="pb"><div class="pf" style="width:${(r.score/10)*100}%;background:${NIVEL_BAR[r.nivel]||'var(--orange)'}"></div></div></div>`).join('') || '<div class="pw">Sin datos.</div>';
document.getElementById('op-co-destacados').innerHTML = (D.contradicciones.destacados||[]).map(d=>`
  <div class="al ${NIVEL_ALCLASS[d.nivel]||'al-o'}"><h4 class="${NIVEL_CLASS[d.nivel]||'o'}">${d.titulo}</h4><p>${d.texto}</p></div>`).join('') || '<div class="al al-o">Sin hallazgos destacados.</div>';
document.getElementById('op-co-tbl').innerHTML = (D.contradicciones.tabla||[]).map(t=>`
  <tr class="${(t.dano==='CRÍTICO')?'cr':''}">
    <td><strong class="${NIVEL_CLASS[t.dano]||'o'}">${t.codigo}</strong></td>
    <td>${t.tipo}</td><td>${t.declaracion}</td><td>${t.realidad}</td>
    <td><span class="tag ${NIVEL_TAG[t.dano]||'to'}">${t.dano}</span></td><td>${t.canal}</td>
  </tr>`).join('') || '<tr><td colspan="6">Sin datos.</td></tr>';

// ---------- VECTORES DE ATAQUE (va) ----------
document.getElementById('op-va-list').innerHTML = (D.vectoresAtaque||[]).map(v=>`
  <div class="vc" onclick="opTv(this)">
    <div class="vh">
      <div class="vnum">${v.codigo}</div>
      <div class="vt">${v.titulo}</div>
      <span class="tag ${NIVEL_TAG[v.nivel]||'to'}">${v.nivel}</span>
      <span class="tag ${NIVEL_TAG[v.nivel]||'to'}">${v.fuenteTag||''}</span>
      <div class="varr">▼</div>
    </div>
    <div class="vb">
      <p><strong>Argumento central:</strong> ${v.argumento||''}</p>
      ${(v.evidencias||[]).map((e,i)=>`<p><strong>Evidencia ${i+1}:</strong> ${e}</p>`).join('')}
      ${v.fraseLista?`<p><strong>Frase lista:</strong> <em>"${v.fraseLista}"</em></p>`:''}
    </div>
  </div>`).join('') || '<div class="vc">Sin vectores de ataque disponibles.</div>';

// ---------- RED DE PODER (red) ----------
document.getElementById('op-red-alertas').innerHTML = (D.redDePoder.alertas||[]).map(a=>`
  <div class="al ${NIVEL_ALCLASS[a.nivel]||'al-o'}" style="margin-bottom:8px"><h4 class="${NIVEL_CLASS[a.nivel]||'o'}">${a.nivel==='CRÍTICO'?'⚠️':'🔗'} ${a.titulo}</h4><ul>${(a.bullets||[]).map(b=>`<li>${b}</li>`).join('')}</ul></div>`).join('') || '<div class="al al-o">Sin alertas de red registradas.</div>';
document.getElementById('op-red-tbl').innerHTML = (D.redDePoder.tabla||[]).map(t=>`
  <tr><td><strong>${t.actor}</strong></td><td>${t.vinculo}</td><td>${t.riesgoOportunidad}</td></tr>`).join('') || '<tr><td colspan="3">Sin datos.</td></tr>';

/* CHARTS */
const ier = D.perfil.ierPorCargo || [];
const ierCanvas = document.getElementById('op-ierChart');
if(ierCanvas && ier.length > 0){
  new Chart(ierCanvas.getContext('2d'), {
    type: 'bar',
    data: { labels: ier.map(x=>x.cargo), datasets: [{ label:'IER (0-10)', data: ier.map(x=>x.valor),
      backgroundColor: ier.map(x=>x.valor<=2.5?'rgba(183,28,28,.9)':x.valor<=4?'rgba(249,168,37,.7)':'rgba(46,125,50,.7)'),
      borderColor: ier.map(x=>x.valor<=2.5?'#b71c1c':x.valor<=4?'#f9a825':'#2e7d32'), borderWidth:2, borderRadius:5 }] },
    options: { responsive:true, maintainAspectRatio:false, scales:{ y:{beginAtZero:true,max:10,ticks:{color:'#1a1a1a'},grid:{color:'rgba(0,0,0,.05)'}}, x:{ticks:{color:'#1a1a1a',font:{size:9}},grid:{display:false}} }, plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>`IER: ${c.raw}/10`}} } }
  });
}

const radarCanvas = document.getElementById('op-radarChart');
const radarData = D.redDePoder.radar || [0,0,0,0,0,0];
if(radarCanvas && Array.isArray(radarData) && radarData.length === 6){
  new Chart(radarCanvas.getContext('2d'), {
    type: 'radar',
    data: { labels:["Trayectoria","Consistencia Ética","Fortaleza Territorial","Control Narrativo","Vulnerabilidad Reputacional","Riesgo de Fractura Interna"],
      datasets:[{ label: META.actor||'Objetivo', data: radarData, fill:true, backgroundColor:'rgba(183,28,28,.15)', borderColor:'rgba(183,28,28,.8)', pointBackgroundColor:'rgba(183,28,28,1)', pointBorderColor:'#fff' }] },
    options: { responsive:true, maintainAspectRatio:false, scales:{ r:{beginAtZero:true,max:10,ticks:{color:'#4a4a4a',backdropColor:'transparent',stepSize:2},grid:{color:'rgba(0,0,0,.1)'},pointLabels:{color:'#1a1a1a',font:{size:10}},angleLines:{color:'rgba(0,0,0,.1)'}} }, plugins:{legend:{display:false}} }
  });
}
})();
