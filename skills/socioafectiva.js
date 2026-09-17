(function(){
const D_RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('sa-root');

const FALLBACK = {
  meta: { territorio: META.actor || 'Sin territorio', ventana: '', modalidad: '', fuentesRevisadas: 0, corte: '' },
  indice: { valor: 0, lecturaBrutal: 'Sin datos disponibles.' },
  issues: [], radiografia: [], hallazgos: [],
  emociones: [],
  sintesisEmocional: { dominante: '—', secundaria: '—', masPeligrosa: '—', masPeligrosaRiesgo: '', masMovilizable: '—', masMovilizableEvidencia: '', masDesaprovechada: '—', masDesaprovechadaEvidencia: '' },
  dolores: [], simbolos: [], zonas: [], enemigos: [],
  segmentos: [], actores: [], narrativas: [],
  narrativaMadre: { fraseRectora: '', heridaCentral: '', enemigoSimbolico: '', promesaEmocional: '', protagonista: '', futuroDeseado: '', tonoNarrativo: '', simbolosUsar: '', simbolosEvitar: '', mensajesFuerza: [] },
  riesgos: [], oportunidades: [], recomendaciones: [], preguntas9: [],
  fuentes: [],
  conclusionEjecutiva: 'Sin conclusión disponible.'
};
function pick(v, fb){
  if (v === undefined || v === null) return fb;
  if (Array.isArray(v)) return v.length ? v : fb;
  if (typeof v === 'object') return Object.keys(v).length ? v : fb;
  return v;
}
const D = {};
Object.keys(FALLBACK).forEach(k => { D[k] = pick(D_RAW && D_RAW[k], FALLBACK[k]); });
Object.keys(FALLBACK.meta).forEach(k => { D.meta[k] = pick(D.meta[k], FALLBACK.meta[k]); });
Object.keys(FALLBACK.indice).forEach(k => { D.indice[k] = pick(D.indice[k], FALLBACK.indice[k]); });
Object.keys(FALLBACK.sintesisEmocional).forEach(k => { D.sintesisEmocional[k] = pick(D.sintesisEmocional[k], FALLBACK.sintesisEmocional[k]); });
Object.keys(FALLBACK.narrativaMadre).forEach(k => { D.narrativaMadre[k] = pick(D.narrativaMadre[k], FALLBACK.narrativaMadre[k]); });

// ---------- tabs ----------
window.saShow = function(id, btn){
  root.querySelectorAll('.tab-panel').forEach(s=>s.classList.remove('active'));
  root.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
};

// ---------- helpers ----------
function esc(s){ return (s==null?'':String(s)); }
function normPill(s){ return (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s-]/g,''); }
function scoreVar(score, hi=8, mid=6){ return score>=hi ? 'var(--critical)' : score>=mid ? 'var(--serious)' : 'var(--warning)'; }
function trustVar(score){ return score>=7 ? 'var(--good)' : score>=4 ? 'var(--warning)' : 'var(--critical)'; }
function quoted(s){ s=(s||'').trim(); return /^["“]/.test(s) ? s : `"${s}"`; }

// ---------- header / meta ----------
document.getElementById('sa-brand-territorio').textContent = '· ' + D.meta.territorio;
document.getElementById('sa-brand-tag').textContent = `Cartografía del clima emocional colectivo${D.meta.corte ? ' · corte ' + D.meta.corte : ''}`;
document.getElementById('sa-hero-title').textContent = `Lo que ${D.meta.territorio} siente frente a sus problemas centrales`;
document.getElementById('sa-hero-sub').textContent = `Diagnóstico del clima emocional colectivo de ${D.meta.territorio} frente a sus ${(D.issues||[]).length || 'principales'} problemas prioritarios, traducido en arquitectura narrativa accionable para gobierno, campaña o consultoría.`;
document.getElementById('sa-meta-territorio').textContent = D.meta.territorio;
document.getElementById('sa-meta-ventana').textContent = D.meta.ventana || '—';
document.getElementById('sa-meta-modalidad').textContent = D.meta.modalidad || '—';
document.getElementById('sa-meta-fuentes').textContent = D.meta.fuentesRevisadas || 0;
document.getElementById('sa-ftr-l').textContent = 'Radar - Socioafectiva · ' + (META.actor || D.meta.territorio || '');

// ---------- gauge / índice ----------
const CIRC = 2 * Math.PI * 62;
const valor = Math.max(0, Math.min(10, Number(D.indice.valor) || 0));
let banda, bandaColor, bandaEmoji;
if (valor >= 8) { banda = 'Crítica'; bandaColor = 'critical'; bandaEmoji = '🔴'; }
else if (valor >= 6) { banda = 'Alta'; bandaColor = 'serious'; bandaEmoji = '🟠'; }
else if (valor >= 4) { banda = 'Media'; bandaColor = 'warning'; bandaEmoji = '🟡'; }
else { banda = 'Baja'; bandaColor = 'good'; bandaEmoji = '🟢'; }
const arc = document.getElementById('sa-gauge-arc');
arc.style.strokeDasharray = CIRC;
arc.style.strokeDashoffset = CIRC * (1 - valor / 10);
arc.style.stroke = `var(--${bandaColor})`;
const gaugeNum = document.getElementById('sa-gauge-num');
gaugeNum.textContent = valor.toFixed(1);
gaugeNum.style.color = `var(--${bandaColor})`;
const chip = document.getElementById('sa-band-chip');
chip.textContent = `${bandaEmoji} Banda ${banda}`;
chip.style.background = `var(--${bandaColor}-soft)`;
chip.style.color = `var(--${bandaColor})`;
document.getElementById('sa-brutal-text').innerHTML = D.indice.lecturaBrutal;

// ---------- 01 issues ----------
document.getElementById('sa-issue-grid').innerHTML = (D.issues||[]).map((it,i)=>`
  <div class="issue-card">
    <div class="issue-top"><h4>${esc(it.titulo)}</h4><span class="issue-idx">0${i+1}</span></div>
    <div class="quote">${quoted(it.frase)}</div>
    <div class="issue-meta">
      <span style="background:var(--serious-soft);color:var(--serious)">${esc(it.emocion)}</span>
      <span style="background:#c4c0c0;color:var(--text-primary)">${it.score}/10</span>
    </div>
  </div>`).join('') || '<div class="issue-card">Sin issues detectados.</div>';

// ---------- 02 radiografía ----------
document.getElementById('sa-radiografia-body').innerHTML = (D.radiografia||[]).map(r=>
  `<tr><td style="width:230px">${esc(r.label)}</td><td>${esc(r.valor)}</td></tr>`).join('') || '<tr><td>Sin datos.</td></tr>';

// ---------- 03 hallazgos ----------
document.getElementById('sa-hallazgos-body').innerHTML = (D.hallazgos||[]).map(h=>
  `<tr><td style="width:280px">${esc(h.hallazgo)}</td><td>${esc(h.lectura)}</td></tr>`).join('') || '<tr><td colspan="2">Sin hallazgos.</td></tr>';

// ---------- 04 emociones ----------
document.getElementById('sa-emo-list').innerHTML = (D.emociones||[]).map(e=>`
  <div class="emo-row">
    <div class="emo-name"><span class="emo-dot" style="background:var(--${e.color||'muted'})"></span>${esc(e.nombre)}</div>
    <div class="emo-track"><div class="emo-fill" style="width:${(e.score||0)*10}%;background:var(--${e.color||'muted'})"></div></div>
    <div class="emo-score">${e.score}/10</div>
    <div class="emo-detail">${esc(e.grupo)} · ${esc(e.detonante)}</div>
  </div>`).join('') || '<div class="emo-row">Sin emociones detectadas.</div>';

const se = D.sintesisEmocional;
document.getElementById('sa-emo-synth').innerHTML = `<b>Lectura emocional:</b> dominante = <b>${esc(se.dominante)}</b>; secundaria = <b>${esc(se.secundaria)}</b>; la más peligrosa = <b>${esc(se.masPeligrosa)}</b> (${esc(se.masPeligrosaRiesgo)}); la más movilizable = <b>${esc(se.masMovilizable)}</b> (${esc(se.masMovilizableEvidencia)}); la más desaprovechada = <b>${esc(se.masDesaprovechada)}</b> — ${esc(se.masDesaprovechadaEvidencia)}`;

// ---------- 05 dolores ----------
document.getElementById('sa-pain-grid').innerHTML = (D.dolores||[]).map(d=>`
  <div class="pain-card">
    <div class="pain-top"><b>${esc(d.titulo)}</b><span class="pain-score" style="color:${scoreVar(d.score)}">${d.score}/10</span></div>
    <div class="quote">${quoted(d.frase)}</div>
    <div class="pain-tags">${(d.tags||[]).map(t=>`<span>${esc(t)}</span>`).join('')}</div>
  </div>`).join('') || '<div class="pain-card">Sin dolores detectados.</div>';

// ---------- 06 símbolos ----------
document.getElementById('sa-symbol-body').innerHTML = (D.simbolos||[]).map(s=>
  `<tr><td style="width:220px">${esc(s.simbolo)}</td><td style="width:170px">${esc(s.emocion)}</td><td>${esc(s.usoEstrategico)}</td></tr>`).join('') || '<tr><td colspan="3">Sin símbolos detectados.</td></tr>';

// ---------- 07 zonas ----------
const zonasOrdenadas = (D.zonas||[]).slice().sort((a,b)=>(b.tension||0)-(a.tension||0));
document.getElementById('sa-zone-grid').innerHTML = zonasOrdenadas.map(z=>`
  <div class="zone-row">
    <div class="zone-name">${esc(z.nombre)}<span>${esc(z.subzona)}</span></div>
    <div class="zone-dolor">${esc(z.dolor)}</div>
    <div class="zone-tension"><span class="lbl">Tensión</span><div class="tbar-mini"><i style="width:${(z.tension||0)*10}%;background:${scoreVar(z.tension)}"></i></div></div>
    <div class="zone-score" style="color:${scoreVar(z.tension)}">${z.tension}</div>
  </div>`).join('') || '<div class="zone-row">Sin zonas detectadas.</div>';

// ---------- 08 enemigos ----------
document.getElementById('sa-enemy-body').innerHTML = (D.enemigos||[]).map(e=>
  `<tr><td style="width:280px">${esc(e.nombre)}</td><td style="width:260px">${esc(e.riesgo)}</td><td>${esc(e.neutralizacion)}</td></tr>`).join('') || '<tr><td colspan="3">Sin enemigos simbólicos detectados.</td></tr>';

// ---------- 09 segmentos ----------
document.getElementById('sa-seg-grid').innerHTML = (D.segmentos||[]).map(s=>`
  <div class="seg-card">
    <h4>${esc(s.titulo)}</h4>
    <div class="profile">${esc(s.perfil)}</div>
    <div class="seg-row"><b>Dolor</b>${esc(s.dolor)}</div>
    <div class="seg-row"><b>Deseo</b>${esc(s.deseo)}</div>
    <div class="seg-row"><b>Miedo</b>${esc(s.miedo)}</div>
    <div class="seg-row"><b>Narrativa</b>${esc(s.narrativa)}</div>
  </div>`).join('') || '<div class="seg-card">Sin segmentos detectados.</div>';

// ---------- 10 actores ----------
document.getElementById('sa-actor-body').innerHTML = (D.actores||[]).map(a=>`
  <tr>
    <td>${esc(a.nombre)}</td>
    <td><span class="trust-bar"><i style="width:${(a.confianza||0)*10}%;background:${trustVar(a.confianza)}"></i></span>${a.confianza}/10</td>
    <td>${esc(a.emocion)}</td>
    <td>${esc(a.potencial)}</td>
  </tr>`).join('') || '<tr><td colspan="4">Sin actores detectados.</td></tr>';

// ---------- 11 narrativas ----------
document.getElementById('sa-narr-body').innerHTML = (D.narrativas||[]).map(n=>
  `<tr><td>${esc(n.tipo)}</td><td>${esc(n.impulsor)}</td><td class="quote-cell">${quoted(n.frase)}</td><td class="tabular">${n.penetracion}/10</td><td>${esc(n.oportunidad)}</td></tr>`).join('') || '<tr><td colspan="5">Sin narrativas detectadas.</td></tr>';

// ---------- 12 narrativa madre ----------
const nm = D.narrativaMadre;
document.getElementById('sa-mother-quote').textContent = quoted(nm.fraseRectora);
const motherFields = [
  ['Herida central', nm.heridaCentral], ['Enemigo simbólico', nm.enemigoSimbolico],
  ['Promesa emocional', nm.promesaEmocional], ['Protagonista', nm.protagonista],
  ['Futuro deseado', nm.futuroDeseado], ['Tono narrativo', nm.tonoNarrativo],
  ['Símbolos a usar', nm.simbolosUsar], ['Símbolos a evitar', nm.simbolosEvitar],
];
document.getElementById('sa-mother-grid').innerHTML = motherFields.map(([lbl,val])=>`<div><b>${lbl}</b>${esc(val)}</div>`).join('');
document.getElementById('sa-force-msgs').innerHTML = (nm.mensajesFuerza||[]).map(m=>`<li>${quoted(m)}</li>`).join('') || '<li>Sin mensajes de fuerza disponibles.</li>';

// ---------- 13 riesgos ----------
document.getElementById('sa-risk-body').innerHTML = (D.riesgos||[]).map(r=>`
  <tr>
    <td>${esc(r.riesgo)}</td>
    <td><span class="pill ${normPill(r.probabilidad)}">${esc(r.probabilidad)}</span></td>
    <td><span class="pill ${normPill(r.impacto)}">${esc(r.impacto)}</span></td>
    <td>${esc(r.detonante)}</td>
    <td>${esc(r.recomendacion)}</td>
  </tr>`).join('') || '<tr><td colspan="5">Sin riesgos detectados.</td></tr>';

// ---------- 14 oportunidades ----------
document.getElementById('sa-opp-grid').innerHTML = (D.oportunidades||[]).map(o=>
  `<div class="opp-card"><b>${esc(o.titulo)}</b><p>${esc(o.texto)}</p></div>`).join('') || '<div class="opp-card">Sin oportunidades detectadas.</div>';

// ---------- 15 recomendaciones ----------
document.getElementById('sa-reco-grid').innerHTML = (D.recomendaciones||[]).map(r=>
  `<div class="reco-card"><div class="dim">${esc(r.dimension)}</div><p>${esc(r.accion)}</p><span>${esc(r.publico)} · atiende: ${esc(r.atiende)}</span></div>`).join('') || '<div class="reco-card">Sin recomendaciones disponibles.</div>';

// ---------- 16 preguntas / conclusión ----------
document.getElementById('sa-qa-grid').innerHTML = (D.preguntas9||[]).map(q=>
  `<div class="qa-card"><div class="q">${esc(q.pregunta)}</div><div class="a">${esc(q.respuesta)}</div></div>`).join('') || '<div class="qa-card">Sin preguntas disponibles.</div>';
document.getElementById('sa-conclusion').textContent = D.conclusionEjecutiva;

// ---------- 17 fuentes ----------
document.getElementById('sa-sources-grid').innerHTML = (D.fuentes||[]).map((s,i)=>`
  <div class="source-item"><span class="n mono">${String(i+1).padStart(2,'0')}</span><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.titulo)}${s.fuente?` <span style="color:var(--text-muted)">· ${esc(s.fuente)}</span>`:''}</a></div>`).join('') || '<div class="source-item">No se obtuvieron fuentes verificables en este análisis.</div>';
})();
