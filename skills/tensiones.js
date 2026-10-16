(function(){
/* TENSIONES + SOCIOAFECTIVA — v3 (estructura TENSIONES · Cuautitlán Izcalli, 10 pestañas).
   Lee window.DATA (lo arma server.js) y window.DATA_META (actor, periodo). */
const D = (window.DATA && typeof window.DATA === 'object') ? window.DATA : {};
const META = window.DATA_META || {};
const root = document.getElementById('tensiones-root');
const $ = (id) => document.getElementById(id);
const A = (v) => Array.isArray(v) ? v : [];
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const S = (v) => (v === undefined || v === null) ? '' : String(v);
const N = (v) => { const x = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(x) ? x : 0; };
const put = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const vacio = (t) => `<div class="dempty">${t || 'Sin datos suficientes en las fuentes del periodo.'}</div>`;
function seccion(nombre, fn){ try { fn(); } catch (e) { console.error('[tensiones] sección ' + nombre + ':', e); } }

// Paleta de la referencia (el tema claro la oscurece con reglas CSS por color)
const C = {red:'#E24B4A', org:'#EF9F27', yel:'#FAC775', grn:'#4ADE80', cyan:'#22D3EE', vio:'#A78BFA'};
const NOMBRE_COLOR = {rojo:C.red, naranja:C.org, amarillo:C.yel, verde:C.grn, cian:C.cyan, violeta:C.vio, morado:C.vio, azul:C.cyan};
const col = (v, def) => { const t = S(v).trim(); if (/^#[0-9a-f]{3,8}$/i.test(t)) return t; return NOMBRE_COLOR[t.toLowerCase()] || def; };
function lvl(s){ return s >= 76 ? {c:C.red, bg:'rgba(226,75,74,.12)', br:'rgba(226,75,74,.35)', n:'Crítico'} : s >= 61 ? {c:C.org, bg:'rgba(239,159,39,.12)', br:'rgba(239,159,39,.35)', n:'Alto'} : {c:C.yel, bg:'rgba(250,199,117,.10)', br:'rgba(250,199,117,.30)', n:'Relevante'}; }
function short(s, n){ s = S(s); return s.length > n ? s.substring(0, n) + '…' : s; }
function tagEv(x){ return S(x).replace(/\[V(ERIFICADO)?\]/gi, '<span class="lbl lv">V</span>').replace(/\[OFICIAL\]/gi, '<span class="lbl lo">OFICIAL</span>'); }

const M = O(D.meta);
const T = A(D.ranking), E = A(D.emociones), NAR = A(D.narrativas), TER = A(D.territorios), RG = A(D.riesgos);
const TRAJ = A(D.trayectoria), TL = A(D.trayectoriaLabels).map(S), ALRT = A(D.alertas);
const DOL = A(D.dolores), ENEM = A(D.enemigos), FRAC = A(D.fracturas), SEG = A(D.segmentos), Q9 = A(D.preguntas);
const IAS = O(D.ias);
const municipio = S(M.municipio || META.actor || 'Sin datos');
const ventana = S(M.ventana || META.periodo);
const ventanaCorta = S(M.ventanaCorta || META.periodo || ventana);
const ventanaMeses = S(M.ventanaMeses || ventana);
const MESES_L = {enero:'Ene',febrero:'Feb',marzo:'Mar',abril:'Abr',mayo:'May',junio:'Jun',julio:'Jul',agosto:'Ago',septiembre:'Sep',octubre:'Oct',noviembre:'Nov',diciembre:'Dic'};
const corto = (l) => MESES_L[S(l).toLowerCase().trim()] || S(l);

// ---------- pestañas y gráficas (se dibujan al abrir cada pestaña) ----------
const CR = {};
const tk = {color:'#475569', font:{size:11}}, gr = {color:'rgba(28,39,56,.12)'};
const sinDatos = (id) => { const c = $(id); if (c && c.parentElement) c.parentElement.innerHTML = '<div style="height:100%;min-height:120px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;color:var(--dim);border:1px dashed var(--border2);border-radius:8px;padding:1rem">Sin datos suficientes para esta gráfica en el periodo analizado.</div>'; };
function chart(key, id, cfg){
  if (CR[key] || typeof Chart === 'undefined') return;
  const ctx = $(id); if (!ctx) return;
  const ok = A(O(cfg.data).datasets).some(ds => A(ds.data).some(v => v !== null && v !== undefined && Number(v) > 0));
  if (!ok) { CR[key] = 'vacio'; return sinDatos(id); }
  try { CR[key] = new Chart(ctx, cfg); } catch (e) { console.warn('[tensiones] gráfica', id, e); }
}
function hbar(id, key, labels, data, colors, max, lab){
  chart(key, id, {type:'bar', data:{labels:labels, datasets:[{data:data, backgroundColor:colors, borderRadius:5, borderSkipped:false}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}, tooltip:{callbacks:{label:c => ' ' + lab + ': ' + c.raw + ' / ' + max}}},
      scales:{x:{min:0, max:max, ticks:tk, grid:gr}, y:{ticks:tk, grid:{display:false}}}}});
}
function buildTensH(){
  chart('tensH', 't-cTensH', {type:'bar', data:{labels:T.map(t => short(t.nombre, 42)), datasets:[{data:T.map(t => N(t.score)), backgroundColor:T.map(t => lvl(N(t.score)).c), borderRadius:5, borderSkipped:false}]},
    options:{indexAxis:'y', responsive:true, maintainAspectRatio:false,
      onClick:(evt, els) => { if (!els.length) return; $('t-panel-narrv').textContent = 'Narrativa dominante: “' + S(T[els[0].index].narrativa) + '”'; },
      plugins:{legend:{display:false}, tooltip:{callbacks:{title:c => S(T[c[0].dataIndex].nombre), label:c => ' STS: ' + c.raw + ' / 100'}}},
      scales:{x:{min:0, max:100, ticks:tk, grid:gr}, y:{ticks:tk, grid:{display:false}}}}});
}
function buildEmoD(){
  chart('emoD', 't-cEmoD', {type:'doughnut', data:{labels:E.map(e => S(e.nombre)), datasets:[{data:E.map(e => N(e.porcentaje)), backgroundColor:E.map((e, i) => col(e.color, Object.values(C)[i % 6])), borderWidth:2, borderColor:'#141720'}]},
    options:{responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{legend:{position:'right', labels:{color:'#334155', font:{size:11}, boxWidth:10, padding:10}}, tooltip:{callbacks:{label:c => ' ' + c.label + ': ' + c.raw + '%'}}}}});
}
function buildNar(){ hbar('t-cNar', 'nar', NAR.map(n => short(n.nombre, 32)), NAR.map(n => N(n.potencial)), NAR.map(n => lvl(N(n.potencial)).c), 100, 'Potencial'); }
function buildSRR(){ hbar('t-cSRR', 'srr', RG.map(r => S(r.tension)), RG.map(r => N(r.srr)), RG.map(r => lvl(N(r.srr)).c), 100, 'SRR'); }
function buildTraj(){
  const pal = ['#E24B4A','#EF9F27','#22D3EE','#FAC775','#A78BFA','#818CF8','#4ADE80','#F472B6','#94A3B8','#2DD4BF'];
  const todos = TRAJ.flatMap(r => A(r.valores)).filter(v => v !== null && v !== undefined && v !== '').map(N);
  const minY = todos.length ? Math.max(0, Math.floor((Math.min(...todos) - 10) / 10) * 10) : 0;
  chart('traj', 't-cTraj', {type:'line', data:{labels:TL, datasets:TRAJ.map((r, i) => ({label:S(r.nombre), data:A(r.valores).map(v => (v === null || v === undefined || v === '') ? null : N(v)), borderColor:pal[i % pal.length], backgroundColor:'transparent', tension:.3, borderWidth:2, pointRadius:3, spanGaps:true}))},
    options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, plugins:{legend:{position:'bottom', labels:{color:'#334155', font:{size:10}, boxWidth:10}}},
      scales:{x:{ticks:tk, grid:{display:false}}, y:{min:minY, max:100, ticks:tk, grid:gr}}}});
}
const colDolor = (d) => col(d.color, N(d.intensidad) >= 9 ? C.red : N(d.intensidad) >= 7 ? C.org : C.yel);
const colEnem = (e, i) => col(e.color, [C.red, C.org, C.org, C.cyan, C.yel, C.vio][i % 6]);
const colSeg = (s, i) => col(s.color, [C.vio, C.org, C.red, C.yel, C.grn, C.cyan][i % 6]);
function buildDol(){
  hbar('t-cDol', 'dol', DOL.map(d => short(d.nombre, 30)), DOL.map(d => N(d.intensidad)), DOL.map(colDolor), 10, 'Intensidad');
  hbar('t-cEnem', 'enem', ENEM.map(e => short(e.nombre, 30)), ENEM.map(e => N(e.carga)), ENEM.map(colEnem), 100, 'Carga afectiva');
}
function buildSeg(){
  chart('seg', 't-cSeg', {type:'doughnut', data:{labels:SEG.map(s => S(s.nombre)), datasets:[{data:SEG.map(s => N(s.peso)), backgroundColor:SEG.map(colSeg), borderWidth:2, borderColor:'#141720'}]},
    options:{responsive:true, maintainAspectRatio:false, cutout:'62%', plugins:{legend:{position:'right', labels:{color:'#334155', font:{size:11}, boxWidth:10, padding:10}}, tooltip:{callbacks:{label:c => ' ' + c.label + ': ≈' + c.raw + '%'}}}}});
  chart('segB', 't-cSegB', {type:'bar', data:{labels:SEG.map(s => short(S(s.nombre).replace(/^(La|El) /, ''), 20)), datasets:[{label:'Activación afectiva', data:SEG.map(s => N(s.activacion)), backgroundColor:'#A78BFA', borderRadius:4}, {label:'Confianza institucional', data:SEG.map(s => N(s.confianza)), backgroundColor:'#4ADE80', borderRadius:4}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom', labels:{color:'#334155', font:{size:10}, boxWidth:10}}, tooltip:{callbacks:{label:c => ' ' + c.dataset.label + ': ' + c.raw + ' / 10'}}},
      scales:{x:{ticks:{color:'#475569', font:{size:10}}, grid:{display:false}}, y:{min:0, max:10, ticks:tk, grid:gr}}}});
}
const BUILD = {tensiones:buildTensH, emociones:buildEmoD, narrativas:buildNar, riesgos:buildSRR, trayectoria:buildTraj, dolores:buildDol, segmentacion:buildSeg};
window.tensTab = function(btn, id){
  root.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
  const v = $('tv-' + id); if (v) v.classList.add('on');
  root.querySelectorAll('.nb').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  if (BUILD[id]) setTimeout(() => { try { BUILD[id](); } catch (e) { console.error('[tensiones] gráfica ' + id, e); } }, 50);
};
// Acordeones (narrativas, territorios, alertas): flecha según el estado.
window.tnArr = function(h){ const b = h.nextElementSibling, a = h.querySelector('.ter-arr,.nar-arr,.abox-arr'); if (a && b) a.innerHTML = b.classList.contains('op') ? '&#9650;' : '&#9660;'; };
window.tnSel = function(i){
  root.querySelectorAll('#t-tens-list .trow').forEach(r => r.classList.toggle('sel', +r.dataset.idx === i));
  const t = T[i]; if (!t) return;
  const L = lvl(N(t.score));
  const ev = (Array.isArray(t.evidencia) ? t.evidencia : S(t.evidencia).split(' · ')).filter(x => S(x).trim()).map(x => '<div style="margin-bottom:4px">• ' + tagEv(x) + '</div>').join('');
  put('t-tens-detail', '<div class="card" style="border-color:' + L.br + ';animation:tnFade .2s ease">'
    + '<div class="ctit" style="color:' + L.c + '"><span style="width:5px;height:5px;border-radius:50%;background:' + L.c + ';display:inline-block"></span>&nbsp;' + S(t.nombre) + ' &mdash; STS ' + N(t.score) + '</div>'
    + '<div class="dg"><span class="dk">Nivel</span><span class="dv" style="color:' + L.c + ';font-weight:600">' + L.n + ' &middot; ' + N(t.score) + '/100' + (S(t.delta) ? ' &middot; &Delta; ' + S(t.delta) : '') + '</span>'
    + '<span class="dk">Emoci&oacute;n</span><span class="dv">' + S(t.emocion) + (t.intensidad ? ' &middot; ' + N(t.intensidad) + '/5' : '') + '</span>'
    + '<span class="dk">Narrativa</span><span class="dv">' + S(t.narrativa) + '</span>'
    + '<span class="dk">Actor</span><span class="dv">' + S(t.actor) + '</span>'
    + '<span class="dk">Territorio</span><span class="dv">' + S(t.territorio) + '</span>'
    + '<span class="dk">Potencial</span><span class="dv">' + S(t.potencial) + '</span>'
    + '<span class="dk">Evidencia</span><span class="dv" style="font-size:11.5px">' + (ev || '—') + '</span></div>'
    + (S(t.lectura) ? '<div class="drec"><b style="color:var(--org)">Lectura estrat&eacute;gica:</b> ' + S(t.lectura) + '</div>' : '') + '</div>');
};

function init(){
  seccion('encabezado', () => {
    const sts = N(M.stsGlobal) || (T.length ? Math.round(T.slice(0, 5).reduce((a, t) => a + N(t.score), 0) / Math.min(5, T.length)) : 0);
    put('t-top-linea', [S(M.actorCorto || M.actor), municipio, ventanaCorta].filter(Boolean).map(x => x.toUpperCase()).join(' &middot; '));
    put('t-top-pill', 'STS ' + sts + ' &middot; NIVEL ' + lvl(sts).n.toUpperCase() + (IAS.valor ? ' &middot; IAS ' + N(IAS.valor).toFixed(1) : ''));
    put('t-h1', municipio + (M.estado ? ', <em>' + S(M.estado) + '</em>' : ''));
    put('t-hsub', [M.actor ? S(M.cargo || 'Titular') + ': ' + S(M.actor) : '', S(M.partido), M.periodoGobierno ? 'Periodo ' + S(M.periodoGobierno) : '', ventana ? 'Ventana analizada: ' + ventana : ''].filter(Boolean).join(' &middot; '));
    put('t-fuentes', M.fuentes ? 'Fuentes: ' + S(M.fuentes) + ' &middot; ' : '');
    const meses = TL.length && TL.every(l => /(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/i.test(l));
    put('t-eyebrow-per', '&Uacute;LTIMOS ' + (TL.length || 4) + ' ' + (meses ? 'MESES' : 'PERIODOS'));
  });
  seccion('tensiones', () => {
    put('t-stit-rank', 'Ranking de tensiones sociales &middot; clic en una fila para el an&aacute;lisis completo &middot; &Delta; vs. periodo anterior' + (TL.length >= 2 ? ' (' + S(TL[TL.length - 2]).toLowerCase() + ')' : ''));
    put('t-sts-t', 'Scores de tensi&oacute;n social &mdash; ' + municipio + (ventanaMeses ? ', ' + ventanaMeses : ''));
    put('t-tens-list', T.map((t, i) => { const s = N(t.score), L = lvl(s), d = parseInt(S(t.delta), 10), dc = d >= 10 ? C.red : d > 0 ? C.org : d < 0 ? C.grn : 'var(--muted)';
      return '<div class="trow" data-idx="' + i + '" onclick="tnSel(' + i + ')"><span class="tnum">' + (i + 1) + '</span><span class="tname">' + S(t.nombre) + '</span><span class="tdelta" style="color:' + dc + '">' + S(t.delta) + '</span><span class="tbar"><span class="tbar-f" style="width:' + s + '%;background:' + L.c + '"></span></span><span class="tsco" style="color:' + L.c + '">' + s + '</span><span class="tniv" style="background:' + L.bg + ';color:' + L.c + ';border:1px solid ' + L.br + '">' + L.n + '</span></div>'; }).join('') || vacio('Sin tensiones registradas en el periodo.'));
    put('t-lectura-radar', S(D.lecturaRadar) || 'Sin lectura disponible.');
    if (T.length) tnSel(0);
  });
  seccion('emociones', () => {
    put('t-emo-bars', E.map((e, i) => { const n = Math.max(0, Math.min(5, Math.round(N(e.intensidad)))), c = col(e.color, Object.values(C)[i % 6]); let d = ''; for (let k = 1; k <= 5; k++) d += k <= n ? '●' : '○';
      return '<div class="ebar"><span class="enam">' + S(e.nombre) + '</span><span class="ebg"><span class="efill" style="width:' + (n * 20) + '%;background:' + c + '"></span></span><span class="epts" style="color:' + c + '">' + d + '</span></div><div class="elec"><span style="color:' + c + ';font-weight:600">' + S(e.tendencia) + '</span>' + (S(e.lectura) ? ' &middot; ' + S(e.lectura) : '') + '</div>'; }).join('') || vacio());
    put('t-hallazgo-emo', S(D.hallazgoEmocional) || 'Sin hallazgo disponible.');
  });
  seccion('narrativas', () => {
    put('t-nar-list', NAR.map((n, i) => { const L = lvl(N(n.potencial));
      return '<div class="nar"><div class="nar-h" onclick="this.nextElementSibling.classList.toggle(\'op\');tnArr(this)"><div class="nar-info"><div class="nar-name">' + S(n.nombre) + '</div><div class="nar-meta">' + [S(n.tema), n.actor ? 'Actor: ' + S(n.actor) : ''].filter(Boolean).join(' &middot; ') + '</div></div><span class="nar-pot" style="color:' + L.c + '">' + N(n.potencial) + '</span><span class="nar-arr">&#9660;</span></div>'
        + '<div class="nar-body"><div><b style="color:var(--text)">Potencial pol&iacute;tico:</b> ' + S(n.politica) + '</div>' + (S(n.frase) ? '<div class="nfrase">' + S(n.frase) + '</div>' : '') + (S(n.origen) ? '<div class="src">Origen: ' + S(n.origen) + '</div>' : '') + '</div></div>'; }).join('') || vacio());
  });
  seccion('territorios', () => {
    const half = Math.ceil(TER.length / 2);
    const nivelC = (s) => /roj/i.test(s) ? C.red : /naranj/i.test(s) ? C.org : C.yel;
    ['a', 'b'].forEach((s, si) => {
      put('t-ter-' + s, TER.slice(si * half, (si + 1) * half).map(z => { const c = nivelC(S(z.nivel)), L = c === C.red ? lvl(80) : c === C.org ? lvl(65) : lvl(50);
        return '<div class="ter" style="border-color:' + L.br + ';background:' + L.bg + '"><div class="ter-h" onclick="this.nextElementSibling.classList.toggle(\'op\');tnArr(this)"><div class="ter-info"><div class="ter-name" style="color:' + c + '">' + S(z.nombre) + '</div><div class="ter-sub" style="color:' + c + '">' + [S(z.tension), S(z.emocion)].filter(Boolean).join(' &middot; ') + '</div></div><span class="tniv" style="background:' + L.bg + ';color:' + c + ';border:1px solid ' + L.br + '">' + S(z.nivel) + '</span><span class="ter-arr">&#9660;</span></div><div class="ter-body">' + S(z.observacion) + '</div></div>'; }).join('') || (si === 0 ? vacio() : ''));
    });
  });
  seccion('riesgos', () => {
    const rh = Math.ceil(RG.length / 2);
    ['a', 'b'].forEach((s, si) => {
      put('t-riesgo-' + s, RG.slice(si * rh, (si + 1) * rh).map(r => { const L = lvl(N(r.srr));
        return '<div class="card rcard"><div class="dg"><span class="dk">Tensi&oacute;n</span><span class="dv" style="font-weight:600">' + S(r.tension) + '</span><span class="dk">SRR</span><span class="dv" style="color:' + L.c + ';font-weight:700">' + N(r.srr) + ' / 100</span><span class="dk">Actor expuesto</span><span class="dv">' + S(r.actor) + '</span><span class="dk">Tipo de se&ntilde;al</span><span class="dv">' + S(r.tipoSenal) + '</span><span class="dk">Prob. de escalar</span><span class="dv">' + S(r.probabilidad) + '</span></div><div class="drec" style="border-left-color:' + L.c + '"><b style="color:' + L.c + '">Consecuencia si no se atiende:</b> ' + S(r.consecuencia) + '</div></div>'; }).join('') || (si === 0 ? vacio() : ''));
    });
  });
  seccion('trayectoria', () => {
    const n = TL.length;
    put('t-traj-t', 'Trayectoria de tensiones &middot; ' + n + ' periodos' + (ventanaMeses ? ', ' + ventanaMeses : ''));
    put('t-evol-t', 'Evoluci&oacute;n comparada' + (ventanaMeses ? ' &mdash; ' + ventanaMeses.replace(/–/, ' a ') : ''));
    put('t-traj-head', '<th>Tensi&oacute;n</th>' + TL.map(l => '<th>' + corto(l) + '</th>').join('') + '<th>&Delta; periodo</th><th>Velocidad</th><th>Tipo</th>');
    put('t-traj-body', TRAJ.map(j => { const v = A(j.valores), ult = N(v[n - 1]), pen = v[n - 2], d = (pen === null || pen === undefined || pen === '') ? 0 : ult - N(pen);
      const ds = d > 0 ? '+' + d : String(d), ar = d >= 10 ? '↑' : d > 0 ? '↗' : d < 0 ? '↘' : '→', dc = d >= 10 ? C.red : d > 0 ? C.org : d < 0 ? C.grn : 'var(--muted)';
      const vel = S(j.velocidad), tipo = S(j.tipo);
      const vc = vel === 'Acelerada' ? 'vrr' : vel === 'Creciendo' ? 'vr' : vel === 'Bajando' ? 'vg' : 'vo', tc = tipo === 'Nueva' ? 'vr' : tipo === 'Recurrente' ? 'vb' : tipo === 'Estacional' ? 'vg' : 'vo';
      return '<tr><td>' + S(j.nombre) + '</td>' + TL.map((_, k) => { const x = v[k], vacioX = (x === null || x === undefined || x === ''); return k === n - 1 ? '<td style="font-weight:700;color:' + lvl(ult).c + '">' + (vacioX ? '—' : ult) + '</td>' : '<td>' + (vacioX ? '—' : N(x)) + '</td>'; }).join('')
        + '<td style="font-weight:700;color:' + dc + '">' + ar + ' ' + ds + '</td><td><span class="vchip ' + vc + '">' + vel + '</span></td><td><span class="vchip ' + tc + '">' + tipo + '</span></td></tr>'; }).join('') || '<tr><td colspan="' + (n + 4) + '">' + vacio() + '</td></tr>');
    put('t-hallazgo-traj', S(D.hallazgoTrayectoria) || 'Sin hallazgo disponible.');
  });
  seccion('alertas', () => {
    put('t-alertas-list', ALRT.map((a, i) => { const o = /naranj|^o$/i.test(S(a.nivel));
      const rows = A(a.rows).map(r => '<span class="ak">' + S(A(r)[0]) + '</span><span class="av">' + S(A(r)[1]) + '</span>').join('');
      return '<div class="abox' + (o ? ' o' : '') + '"><div class="abox-h" onclick="this.nextElementSibling.classList.toggle(\'op\');tnArr(this)"><div class="abox-t"><span class="pulse"' + (o ? ' style="background:var(--org)"' : '') + '></span>Alerta ' + (i + 1) + ' &mdash; ' + S(a.titulo) + '</div><span class="abox-arr">' + (i === 0 ? '&#9650;' : '&#9660;') + '</span></div><div class="abox-body' + (i === 0 ? ' op' : '') + '"><div class="ag">' + rows + '</div></div></div>'; }).join('') || vacio('Sin alertas prioritarias en el periodo.'));
  });
  seccion('dolores', () => {
    put('t-dol-list', DOL.map(d => { const c = colDolor(d), s = N(d.intensidad);
      return '<div class="dolor" style="border-left:3px solid ' + c + '"><div class="dol-h"><span class="dol-n">' + S(d.nombre) + '</span><span class="dol-sc" style="color:' + c + '">' + s + '/10</span></div><div class="dol-bar"><div class="dol-f" style="width:' + (s * 10) + '%;background:' + c + '"></div></div><div class="dol-g"><span class="k">Territorio</span><span class="v">' + S(d.territorio) + '</span><span class="k">Emoci&oacute;n</span><span class="v">' + S(d.emocion) + '</span><span class="k">Causa percibida</span><span class="v">' + S(d.causa) + '</span><span class="k">Herida</span><span class="v" style="color:var(--text)">' + S(d.herida) + '</span></div></div>'; }).join('') || vacio());
    const comps = A(IAS.componentes).filter(c => A(c)[0]);
    put('t-ias', IAS.valor || comps.length ? '<div class="ias"><div><div class="ias-v">' + N(IAS.valor).toFixed(1) + '</div><div style="font-size:11px;color:var(--dim);margin-top:4px">/ 10 &middot; ' + S(IAS.nivel || (N(IAS.valor) >= 7 ? 'ALTA' : N(IAS.valor) >= 4 ? 'MEDIA' : 'BAJA')) + '</div></div>'
      + '<div class="ias-c">' + comps.map(c => '<div class="ias-i"><div class="ias-l">' + S(c[0]) + '</div><div class="ias-n">' + N(c[1]).toFixed(1) + '</div></div>').join('') + '</div></div>' + (S(IAS.nota) ? '<div class="src">' + S(IAS.nota) + '</div>' : '') : vacio('Sin índice de activación disponible.'));
    put('t-enem-list', ENEM.map((e, i) => { const c = colEnem(e, i);
      return '<div class="enem" style="border-left-color:' + c + '"><div style="display:flex;justify-content:space-between;gap:8px"><span class="en-n" style="color:' + c + '">' + S(e.nombre) + '</span><span style="font-size:12px;font-weight:700;color:' + c + '">' + N(e.carga) + '</span></div>' + (S(e.quien) ? '<div class="en-m">Lo nombran: ' + S(e.quien) + '</div>' : '') + '<div class="en-x">' + S(e.lectura) + '</div></div>'; }).join('') || vacio());
    put('t-lectura-enem', S(D.lecturaEnemigos) || 'Sin lectura disponible.');
    put('t-frac-list', FRAC.map(f => { const iv = S(f.intensidad), ic = iv === 'Crítica' ? C.red : iv === 'Alta' ? C.org : iv === 'Media-Alta' ? C.yel : '#8892AA';
      return '<div class="frac"><div class="fr-a">' + S(f.a) + '</div><div class="fr-x">&#8644;</div><div class="fr-b">' + S(f.b) + '</div><div class="fr-d"><span class="vchip" style="color:' + ic + ';border:1px solid ' + ic + ';margin-right:6px">' + iv + '</span>' + S(f.descripcion) + '</div></div>'; }).join('') || vacio());
  });
  seccion('segmentacion', () => {
    put('t-stit-seg', 'Segmentaci&oacute;n socioafectiva &middot; ' + (SEG.length || 6) + ' segmentos por posici&oacute;n emocional frente al territorio');
    put('t-seg-grid', SEG.map((s, i) => { const c = colSeg(s, i);
      return '<div class="seg" style="border-top-color:' + c + '"><div class="seg-h"><span class="seg-n" style="color:' + c + '">' + S(s.nombre) + '</span><span class="seg-p" style="color:' + c + '">≈' + N(s.peso) + '%</span></div><div class="seg-s">' + S(s.sub) + '</div><div class="seg-f">' + S(s.frase) + '<small>' + S(s.fraseNota) + '</small></div><div class="seg-g"><span class="k">Emoci&oacute;n</span><span class="v">' + S(s.emocion) + '</span><span class="k">Dolor</span><span class="v">' + S(s.dolor) + '</span><span class="k">Enemigo</span><span class="v">' + S(s.enemigo) + '</span><span class="k">S&iacute;mbolo</span><span class="v">' + S(s.simbolo) + '</span><span class="k">Lo detona</span><span class="v">' + S(s.detona) + '</span><span class="k">Lo desactiva</span><span class="v">' + S(s.desactiva) + '</span><span class="k">Activaci&oacute;n</span><span class="v" style="font-weight:700">' + N(s.activacion) + ' / 10</span></div></div>'; }).join('') || vacio());
    put('t-hallazgo-seg', S(D.hallazgoSegmentacion) || 'Sin hallazgo disponible.');
  });
  seccion('preguntas', () => {
    put('t-q9', Q9.map((x, i) => '<div class="qc"><div class="qn">' + String(i + 1).padStart(2, '0') + '</div><div class="qq">' + S(x.pregunta) + '</div><div class="qa">' + S(x.respuesta) + '</div>' + (S(x.evidencia) ? '<div class="qe">Evidencia: ' + S(x.evidencia) + '</div>' : '') + '</div>').join('') || vacio());
  });
  if (typeof Chart === 'undefined') root.querySelectorAll('canvas').forEach(c => { if (c.parentElement) c.parentElement.innerHTML = '<div class="dempty" style="text-align:center">No se pudo cargar la librería de gráficas (Chart.js). Revisa la conexión a internet y vuelve a abrir el reporte.</div>'; });
  setTimeout(buildTensH, 80);
}
init();
})();
