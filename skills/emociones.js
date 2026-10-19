(function(){
/* EMOCIONES · SEGMENTA · SEMIÓTICA — v5 (estructura EMOCIONES v2 · San Antonio la Isla, 7 pestañas).
   Lee window.DATA (lo arma server.js) y window.DATA_META (actor, periodo, cliente). */
const D = (window.DATA && typeof window.DATA === 'object') ? window.DATA : {};
// Compatibilidad: datos con la forma de la versión anterior (v4) → forma v5.
(function compat(){
  const arr = (v) => Array.isArray(v) ? v : [];
  if (!arr(D.arqCol).length && arr(D.arquetipos).length) D.arqCol = D.arquetipos.map(a => [String(a.k || '').replace(/^Arquetipo( colectivo)?\s*/i, ''), a.n, a.p, a.c]);
  if (!arr(D.arqScores).length && Array.isArray(D.arqIdeal)) { D.arqScores = D.arqIdeal; D.arqIdeal = {}; }
  if ((!D.arqIdeal || Array.isArray(D.arqIdeal) || !D.arqIdeal.gan) && arr(D.arqWin).length) { const w = D.arqWin, q = (t) => String(t || '').replace(/^\s*\d+\s*[º°o]?\s*[·.\-:]\s*/, ''); D.arqIdeal = { gan: q(w[0].pos), ganTxt: w[0].why, ganRiesgo: w[0].risk, seg: w[1] ? q(w[1].pos) : '', segTxt: w[1] ? w[1].why : '', segRiesgo: w[1] ? w[1].risk : '' }; }
  if (D.arqActores && !Array.isArray(D.arqActores) && Array.isArray(D.arqActores.rows)) D.arqActores = D.arqActores.rows.map(r => [r[0], r[1], [r[3], r[4]].filter(Boolean).join(' · ')]);
  if (D.ive && D.ive.val === undefined && D.ive.value !== undefined) D.ive = { val: D.ive.value, cls: D.ive.cls, hor: D.ive.horizon, parts: arr(D.ive.comps).map((c, i) => [c[0], c[1], [0.35, 0.25, 0.2, 0.2][i] || 0.25]), note: D.ive.text };
  if (!arr(D.transfer).length && arr(D.flows).length) D.transfer = D.flows.map(f => ({ em: f.em, color: f.color, o: f.origen, c: f.canal, d: f.destino, t: f.tipo }));
  if (!D.transferCliente && arr(D.clientePos).length) D.transferCliente = D.clientePos.map(p => `<b>${p[0]}</b> ${p[1]}`).join(' · ');
  if (!arr(D.segTabla).length && D.segTbl && arr(D.segTbl.rows).length) D.segTabla = D.segTbl.rows;
})();
const META = window.DATA_META || {};
const root = document.getElementById('emo-root');
const $ = (id) => document.getElementById(id);
const A = (v) => Array.isArray(v) ? v : [];
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const S = (v) => (v === undefined || v === null) ? '' : String(v);
const N = (v) => { const x = Number(String(v ?? '').replace(/[^\d.\-]/g, '')); return Number.isFinite(x) ? x : 0; };
const put = (id, html) => { const el = $(id); if (el) el.innerHTML = html; };
const txt = (id, t) => { const el = $(id); if (el) el.textContent = t; };
const ocultar = (id) => { const el = $(id); if (el) el.classList.add('hidden'); };
const vacio = (t) => `<div style="font-size:12px;color:var(--tx3);padding:6px 0">${t || 'Sin datos suficientes en las fuentes del periodo.'}</div>`;

// 8 emociones de Plutchik: geometría y color fijos (la IA da intensidad, subtítulo, detonantes y consecuencias).
const EMOTION_META = [
  {key:'ira',          label:'Ira / Furia',     sublabel:'Furia · Ira · Enfado',                deg:180, color:['#FEE2E2','#FCA5A5','#B91C1C']},
  {key:'miedo',        label:'Miedo / Temor',   sublabel:'Terror · Miedo · Temor',              deg:0,   color:['#CFFAFE','#67E8F9','#0E7490']},
  {key:'anticipacion', label:'Anticipación',    sublabel:'Vigilancia · Anticipación · Interés', deg:225, color:['#FFEDD5','#FDBA74','#C2410C']},
  {key:'tristeza',     label:'Tristeza',        sublabel:'Aflicción · Tristeza · Melancolía',   deg:90,  color:['#EDE9FE','#A78BFA','#4C1D95']},
  {key:'asco',         label:'Asco / Aversión', sublabel:'Aversión · Asco · Aburrimiento',      deg:135, color:['#DCFCE7','#86EFAC','#15803D']},
  {key:'alegria',      label:'Alegría',         sublabel:'Éxtasis · Alegría · Serenidad',       deg:-90, color:['#FFF9C4','#FFF176','#F9A825']},
  {key:'confianza',    label:'Confianza',       sublabel:'Admiración · Confianza · Aceptación', deg:-45, color:['#D1FAE5','#6EE7B7','#059669']},
  {key:'sorpresa',     label:'Sorpresa',        sublabel:'Asombro · Sorpresa · Distracción',    deg:45,  color:['#DBEAFE','#93C5FD','#2563EB']},
];
const emotions = EMOTION_META.map(m => {
  const d = A(D.emotions).find(e => e && e.key === m.key) || {};
  const iv = Math.max(0, Math.min(3, Math.round(N(d.intensity))));
  return {...m, sublabel: S(d.sublabel).trim() || m.sublabel, active: d.active !== false && iv > 0, intensity: iv, triggers: A(d.triggers).map(S), consequences: A(d.consequences).map(S)};
});
const activas = () => emotions.filter(e => e.active);
const cliente = S(META.cliente || D.cliente).trim();
const territorio = S(D.territory || META.actor || 'Sin datos');
const terrCorto = territorio.split(/[,·]/)[0].trim() || S(META.actor);
const fecha = S(D.date || META.periodo || [META.mes, META.anio].filter(Boolean).join(' '));
const anioElec = S(D.anioEleccion).trim();
const RISK = {CRÍTICO:'#ef4444', ALTO:'#f97316', MEDIO:'#eab308', BAJO:'#22c55e'};
const RISK_BG = {CRÍTICO:'#fee2e2', ALTO:'#ffedd5', MEDIO:'#fef9c3', BAJO:'#dcfce7'};
const PAL = ['#1A3A5C','#2563eb','#C9980A','#374151','#16a34a','#7c3aed'];
// Colores de series: si el modelo manda un color inválido, gris o repetido, se usa uno vivo distinto.
const VIVOS = ['#2563eb','#dc2626','#16a34a','#C9980A','#7c3aed','#0891b2','#db2777','#ea580c'];
const colorSerie = (c, i, usados) => {
  let x = String(c || '').trim();
  const m = x.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  let gris = true;
  if (m) { const h = m[1].length === 3 ? m[1].split('').map(d => d + d).join('') : m[1]; const v = [0, 2, 4].map(k => parseInt(h.substr(k, 2), 16)); gris = Math.max(...v) - Math.min(...v) < 40; x = '#' + h; }
  if (!m || gris || usados.has(x.toLowerCase())) x = VIVOS.find(v => !usados.has(v.toLowerCase())) || VIVOS[i % VIVOS.length];
  usados.add(x.toLowerCase());
  return x;
};
// Etiquetas largas del eje: se quita lo que va entre paréntesis y se parten en renglones cortos.
const envolver = (t, n = 16, max = 3) => {
  let s = String(t || '').trim();
  if (s.length > 24) s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  const out = []; let linea = '';
  s.split(/\s+/).forEach(w => { if ((linea + ' ' + w).trim().length > n && linea) { out.push(linea); linea = w; } else linea = (linea + ' ' + w).trim(); });
  if (linea) out.push(linea);
  if (out.length > max) { out.length = max; out[max - 1] = out[max - 1].replace(/\s*\S*$/, '') + '…'; }
  return out.length > 1 ? out : (out[0] || '');
};

// ---------- pestañas ----------
window.emST = function(id, el){
  root.querySelectorAll('.pnl').forEach(p => p.classList.remove('on'));
  root.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  const p = $('empnl-' + id); if (p) p.classList.add('on');
  if (el) el.classList.add('on');
  if (window.Chart) requestAnimationFrame(() => Object.values(Chart.instances || {}).forEach(c => { try { c.resize(); c.update(); } catch (e) {} }));
};
window.emToggleEm = function(key){
  const d = $('emd-' + key); if (!d) return;
  const o = d.classList.contains('open');
  root.querySelectorAll('.emd-box').forEach(x => x.classList.remove('open'));
  if (!o) d.classList.add('open');
};

// ---------- rueda de Plutchik ----------
const CX = 220, CY = 220, R = [62,108,154,200], GAP = 1.4;
const rad = d => d * Math.PI / 180, pt = (r, d) => [CX + r * Math.cos(rad(d)), CY + r * Math.sin(rad(d))];
function arc(r1, r2, s, e){ const a = s + GAP, b = e - GAP; const [x1,y1] = pt(r1,a), [x2,y2] = pt(r2,a), [x3,y3] = pt(r2,b), [x4,y4] = pt(r1,b);
  return `M${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}A${r2},${r2} 0 0,1 ${x3.toFixed(2)},${y3.toFixed(2)}L${x4.toFixed(2)},${y4.toFixed(2)}A${r1},${r1} 0 0,0 ${x1.toFixed(2)},${y1.toFixed(2)}Z`; }
const IN = ['#c4bfbf','#bab5b5','#b0abab'];
function buildWheel(){ let p = '';
  emotions.forEach(em => { const {active:ac, intensity:iv, color, deg, key, label} = em;
    [1,2,3].forEach(i => { const fill = ac && iv >= i ? color[i-1] : IN[i-1];
      p += `<path d="${arc(R[i-1],R[i],deg,deg+45)}" fill="${fill}" stroke="#d5d1d1" stroke-width="2" ${ac ? `onclick="emToggleEm('${key}')" style="cursor:pointer"` : ''}/>`; });
    const md = deg + 22.5, [lx,ly] = pt(R[3]+23, md);
    const an = Math.cos(rad(md)) > .12 ? 'start' : Math.cos(rad(md)) < -.12 ? 'end' : 'middle';
    p += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${an}" dominant-baseline="middle" font-size="11" font-family="-apple-system,sans-serif" fill="${ac ? '#1C2738' : '#64748B'}" font-weight="${ac ? '700' : '400'}" style="pointer-events:none">${label}</text>`;
    if (ac && iv === 3){ const [bx,by] = pt(R[3]+6, md); p += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5" fill="${color[2]}" style="pointer-events:none"><animate attributeName="opacity" values="1;.25;1" dur="1.6s" repeatCount="indefinite"/></circle>`; }
  });
  return `<svg width="560" height="450" viewBox="-110 -5 660 450" role="img" aria-label="Rueda de Plutchik">${p}<circle cx="${CX}" cy="${CY}" r="${R[0]-4}" fill="#ffffff" stroke="#bdb8b8" stroke-width="1.5"/><text x="${CX}" y="${CY-7}" text-anchor="middle" font-size="9.5" font-family="-apple-system,sans-serif" fill="#4a5a72" font-weight="700" letter-spacing="2">HUMOR</text><text x="${CX}" y="${CY+7}" text-anchor="middle" font-size="9.5" font-family="-apple-system,sans-serif" fill="#4a5a72" font-weight="700" letter-spacing="2">SOCIAL</text></svg>`; }

const CD = {responsive:true, maintainAspectRatio:false,
  plugins:{legend:{display:false}, tooltip:{backgroundColor:'#1a2236', titleColor:'#e2e8f0', bodyColor:'#8899aa', borderColor:'#1e2d45', borderWidth:1}},
  scales:{x:{ticks:{color:'#475569', font:{size:11}}, grid:{color:'rgba(28,39,56,.12)'}}, y:{ticks:{color:'#475569', font:{size:11}}, grid:{color:'rgba(28,39,56,.12)'}}}};

// Etiquetas de evidencia: verificado / declaración oficial / inferencia analítica
function tagOf(k){ const t = S(k).toLowerCase();
  return /^(ver|pub)/.test(t) ? '<span class="tag t-ver">verificado</span>' : /^ofi/.test(t) ? '<span class="tag t-ofi">declaración oficial</span>' : '<span class="tag t-inf">inferencia analítica</span>'; }
function tagsHTML(v){ const lista = Array.isArray(v) ? v : S(v).replace(/^tags:/, '').split(',');
  return lista.map(t => { const [a, c0] = S(t).split('|'); const c = /^#[0-9a-f]{3,8}$/i.test(S(c0).trim()) ? c0.trim() : '#475569'; return a.trim() ? `<span class="tag" style="background:${c}22;color:#e2e8f0;border-color:${c}">${a.trim()}</span>` : ''; }).join(''); }
const tabla = (head, rows, fmt) => A(rows).length ? `<table class="tbl"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${A(rows).map(r => `<tr>${head.map((_, i) => `<td>${fmt ? fmt(A(r)[i], i) : S(A(r)[i])}</td>`).join('')}</tr>`).join('')}</table>` : vacio();

// Cada sección se dibuja por separado: si una falla, las demás se dibujan igual.
function seccion(nombre, fn){ try { fn(); } catch (e) { console.error('[emociones] sección ' + nombre + ':', e); } }
const act = activas();
const TD = O(D.tendencia), TS = A(TD.series).filter(s => A(s.data).some(v => v !== null && v !== undefined && v !== ''));
const SEGS = A(D.segmentos);
const sem = (arr, id) => put(id, A(arr).map(s => `<div class="sem"><div class="semd" style="background:${S(s.color)}"></div><div class="seml">${S(s.label)}</div><div class="semv" style="color:${S(s.color)}">${S(s.val)}</div></div>`).join('') || vacio());
function init(){
  seccion('encabezado', () => {
  /* ---------- encabezado ---------- */
  put('em-hdr-meta', `<div>● MONITOREO ACTIVO · ${fecha}</div><div style="color:var(--tx3)">${territorio.toUpperCase()}</div>`);
  txt('em-hdr-date', fecha);
  txt('em-whl-territory', territorio);
  put('em-hdr-title', territorio.replace(/(\S+)/, m => `<span style="color:var(--blue2)">${m}</span>`));
  txt('em-hdr-sub', S(D.subtitle));
  const NEG = ['miedo','ira','tristeza','asco'], POS = ['alegria','confianza','anticipacion'];
  const negI = act.filter(e => NEG.includes(e.key)).reduce((t, e) => t + e.intensity, 0), posI = act.filter(e => POS.includes(e.key)).reduce((t, e) => t + e.intensity, 0);
  const cap = negI + posI > 0 ? Math.round(posI / (negI + posI) * 100) : 0;
  const hiEms = act.filter(e => e.intensity === 3).map(e => e.label).join(' + ');
  put('em-hdr-badges', `<span class="badge b-red pulse">● ${S(D.riskLevel)}</span>${hiEms ? `<span class="badge b-red">${hiEms}: DOMINANTES</span>` : ''}<span class="badge b-org">DÍADAS: ${A(D.dyads).filter(d => d.risk === 'CRÍTICO').length} CRÍTICAS</span><span class="badge b-blu">CAPITAL POSITIVO: ${cap}%</span><span class="badge b-pur">CONCEPTO: ${S(D.concept).toUpperCase()}</span>`);
  if (anioElec) { txt('em-tab-actores', 'Actores ' + anioElec); txt('em-actradar-t', 'Mapa de Posicionamiento Emocional de Actores ' + anioElec); }

  });
  seccion('flor', () => {
  /* ---------- flor ---------- */
  put('em-wheel-wrap', buildWheel());
  const hi = act.find(e => e.intensity === 3), md = act.find(e => e.intensity === 2);
  if (hi) $('em-leg-hi').style.background = hi.color[2];
  if (md) $('em-leg-md').style.background = md.color[1];
  put('em-list', [...act].sort((a, b) => b.intensity - a.intensity).map(em => { const iv = em.intensity;
    const riskTx = iv === 3 ? 'var(--red-s)' : iv === 2 ? 'var(--org-s)' : 'var(--ylw)';
    return `<div class="emr" onclick="emToggleEm('${em.key}')"><div class="emh">
      <div style="width:10px;height:10px;border-radius:50%;background:${em.color[2]};box-shadow:0 0 6px ${em.color[2]}55;flex-shrink:0"></div>
      <span style="font-size:13px;font-weight:700;color:var(--tx1)">${em.label}</span>
      <span style="margin-left:auto;font-size:13px;color:${riskTx}">${'●'.repeat(iv)}<span style="color:#374151">${'○'.repeat(3 - iv)}</span></span></div>
      <div style="font-size:10.5px;color:var(--tx3);margin-top:2px;margin-left:17px">${em.sublabel}</div>
      <div class="emd-box" id="emd-${em.key}">${em.triggers.length ? `<div class="edk">Detonantes:</div><div class="edv">${em.triggers.join(' · ')}</div>` : ''}
      ${em.consequences.length ? `<div class="edk" style="margin-top:5px">Consecuencias:</div><div class="edv">${em.consequences.join(' · ')}</div>` : ''}</div></div>`; }).join('') || vacio('Sin emociones activas detectadas en el periodo.'));
  put('em-sec', A(D.secondary).map(s => `<div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--brd)"><div style="width:7px;height:7px;border-radius:50%;background:${S(s.color) || '#64748b'};flex-shrink:0;margin-top:4px"></div><div><div style="font-size:12px;font-weight:700;color:var(--tx1)">${S(s.name)}</div><div style="font-size:11px;color:var(--tx3);margin-top:2px;line-height:1.55">${S(s.text)}</div></div></div>`).join('') || vacio());
  put('em-concepto-box', `<div class="cbox-label">Concepto Central del Territorio</div><div class="cbox-name">"${S(D.concept)}"</div><div class="cbox-text">${S(D.conceptDesc)}</div>`);
  const I = O(D.ive), iv = Math.round(N(I.val)), ivCol = S(I.color) || (iv >= 80 ? '#ef4444' : iv >= 60 ? '#f97316' : iv >= 40 ? '#eab308' : '#22c55e');
  const ivIco = iv >= 80 ? '🔴' : iv >= 60 ? '🟠' : iv >= 40 ? '🟡' : '🟢';
  put('em-ive-box', `<div class="sl">Índice de Volatilidad Emocional (IVE)</div>
    <div style="display:flex;align-items:baseline;gap:.6rem;flex-wrap:wrap"><div class="cval" style="color:${ivCol}">${iv}</div><div style="font-size:13px;font-weight:800;color:${ivCol}">${ivIco} ${S(I.cls)}</div><div class="csub">Horizonte: ${S(I.hor) || '—'}</div></div>
    <div class="ive-bar"><div class="ive-fill" style="width:${Math.max(0, Math.min(100, iv))}%;background:linear-gradient(90deg,#22c55e,#eab308 35%,#f97316 60%,#ef4444)"></div></div>
    ${A(I.parts).map(p => { const [l, v, w] = A(p); const vv = N(v), ww = N(w); return `<div style="display:flex;justify-content:space-between;gap:.5rem;font-size:11px;color:var(--tx2);padding:4px 0;border-bottom:1px solid var(--brd)"><span>${S(l)}</span><span style="white-space:nowrap;color:var(--tx1);font-weight:700">${vv}${ww ? ` × ${ww} = ${(vv * ww).toFixed(1)}` : ''}</span></div>`; }).join('')}
    <div style="font-size:10.5px;color:var(--tx3);margin-top:.5rem;line-height:1.55">${S(I.note)}</div>`);
  put('em-sintesis', S(D.sintesis) || vacio('Sin síntesis disponible.'));

  });
  seccion('mapa', () => {
  /* ---------- mapa social ---------- */
  const mk = (arr, dc) => A(arr).map(t => `<div class="mpi"><div class="mpd" style="background:${dc}"></div>${S(t)}</div>`).join('') || vacio();
  put('em-mapa-cols', `<div class="mpc"><div class="mptt" style="color:#eab308">⚠ Problemáticas</div>${mk(D.problematics, '#eab308')}</div>
    <div class="mpc"><div class="mptt" style="color:#ef4444">⬡ Miedos</div>${mk(D.fears, '#ef4444')}</div>
    <div class="mpc"><div class="mptt" style="color:#22c55e">★ Orgullos</div>${mk(D.prides, '#22c55e')}</div>`);
  put('em-quotes', A(D.quotes).map(q => `<div class="qi"><div class="qt${q.para ? ' para' : ''}">${S(q.text)}</div><div class="qm">${[q.topic, q.emotion, q.territory].filter(Boolean).map(S).join(' · ')}</div></div>`).join('') || vacio());
  if (D.temasTitulo) txt('em-temas-t', S(D.temasTitulo));
  sem(D.semaforo, 'em-semaforo');

  });
  seccion('diadas', () => {
  /* ---------- díadas ---------- */
  put('em-dyad-cards', A(D.dyads).map(d => `<div class="dyc" style="border-top-color:${RISK[d.risk] || '#64748b'}"><span class="dybadge" style="background:${RISK_BG[d.risk] || '#f1f5f9'};color:${RISK[d.risk] || '#64748b'}">${S(d.risk)}</span><div class="dyn" style="color:${RISK[d.risk] || 'var(--tx1)'}">${S(d.name)}</div><div class="dyf">Díada ${S(d.type)} · ${S(d.formula)}</div><div class="dyt">${S(d.text)}</div></div>`).join('') || `<div class="dyc">${vacio('Sin díadas detectadas.')}</div>`);
  put('em-dyad-interp', S(D.dyadInterp) || 'Sin interpretación disponible.');

  });
  seccion('identidad', () => {
  /* ---------- identidad política ---------- */
  put('em-id-pregunta', `<div class="cbox-label">Pregunta Política del Territorio</div><div class="cbox-name" style="font-size:18px">"${S(D.preguntaPolitica)}"</div><div class="cbox-text">${S(D.preguntaDesc)}</div>`);
  if (D.periodoGobierno) txt('em-gov-t', `Percepción del Gobierno Municipal ${S(D.periodoGobierno)}`);
  sem(D.govSemaforo, 'em-gov-sem');
  put('em-partidos-tbl', A(D.partidos).map(p => { const t = S(p.tendencia); return `<div style="display:grid;grid-template-columns:1.2fr 2fr 1fr 1fr;gap:.5rem;padding:8px 0;border-bottom:1px solid var(--brd);font-size:12px">
    <div style="font-weight:700;color:var(--tx1)">${S(p.nombre)}</div><div style="color:var(--tx2)">${S(p.emocion)}</div><div style="color:var(--tx3)">${S(p.capital)}</div>
    <div style="color:${t.includes('↓') ? '#ef4444' : t.includes('↑') ? '#22c55e' : '#94a3b8'};font-weight:600">${t}</div></div>`; }).join('') || vacio());
  put('em-partidos-note', S(D.partidosNote));
  put('em-haidt-tbl', tabla(['Emoción', 'Fundación', 'Valor violado', 'Narrativa activada'], D.haidt, (c, i) => i === 0 ? `<b>${S(c)}</b>` : i === 3 ? `<i>${S(c)}</i>` : S(c)) + (D.haidtNote ? `<div style="font-size:10.5px;color:var(--tx3);margin-top:.5rem">${S(D.haidtNote)}</div>` : ''));
  put('em-westen', A(D.westen).map(w => { w = A(w); return `<div class="mpi" style="display:block"><div style="font-size:11px;font-weight:800;color:${S(w[3]) || 'var(--tx1)'};letter-spacing:.06em;text-transform:uppercase">${S(w[0])} <span style="color:var(--tx3);font-weight:600;text-transform:none;letter-spacing:0">· ${S(w[2])}</span></div><div style="margin-top:2px">${S(w[1])}</div></div>`; }).join('') + (D.westenMeta ? `<div style="font-size:11.5px;color:var(--tx2);margin-top:.6rem;line-height:1.6">${S(D.westenMeta)}</div>` : '') || vacio());
  const fc = {GANA:'#ef4444', DEFIENDE:'#f97316', MINORITARIO:'#64748b'};
  put('em-lakoff', A(D.lakoff).map(f => { f = A(f); const est = S(f[3]).toUpperCase(); return `<div class="mpi" style="display:block"><div style="display:flex;justify-content:space-between;gap:.4rem"><b style="color:var(--tx1);font-size:12px">${S(f[0])}</b><span class="tag" style="color:${fc[est] || 'var(--tx1)'};border-color:${fc[est] || 'var(--tx1)'}">${est}</span></div><div style="font-size:11px;color:var(--tx3);margin-top:2px">Sostiene: ${S(f[1])} · Activa: ${S(f[2])}</div></div>`; }).join('')
    + (D.lakoffUsar ? `<div style="font-size:11.5px;color:#86efac;margin-top:.6rem;line-height:1.55">✓ ${S(D.lakoffUsar)}</div>` : '') + (D.lakoffEvitar ? `<div style="font-size:11.5px;color:#fca5a5;margin-top:.35rem;line-height:1.55">✕ ${S(D.lakoffEvitar)}</div>` : '') || vacio());
  put('em-transfer', A(D.transfer).map(t => `<div style="font-size:11px;font-weight:800;color:${S(t.color) || 'var(--tx1)'};letter-spacing:.08em;margin-top:.4rem">${S(t.em)}</div><div class="flow"><div class="flow-s"><b>Origen</b>${S(t.o)}</div><div class="flow-a">→</div><div class="flow-s"><b>Canal</b>${S(t.c)}</div><div class="flow-a">→</div><div class="flow-s"><b>Destino</b>${S(t.d)}</div><div class="flow-a">→</div><div class="flow-s"><b>Tipo</b>${S(t.t)}</div></div>`).join('')
    + (D.transferCliente ? `<div class="cbox" style="margin-top:.4rem;padding:.9rem 1rem"><div class="cbox-text">${S(D.transferCliente)}</div></div>` : '') || vacio());

  });
  seccion('actores', () => {
  /* ---------- actores ---------- */
  put('em-actores-grid', A(D.actores).map((a, i) => `<div class="ac"><div class="ach" style="border-left:4px solid ${S(a.borderColor) || PAL[i % PAL.length]}"><div class="acn">${S(a.name)}</div><div class="acr">${S(a.role)}</div></div><div class="acb">${A(a.rows).map(r => `<div class="acrow"><span class="ack">${S(A(r)[0])}</span><span class="acv">${S(A(r)[1])}</span></div>`).join('')}</div></div>`).join('') || `<div class="ac"><div class="acb">${vacio('Sin actores disponibles.')}</div></div>`);
  put('em-actores-note', S(D.actoresNote));
  const ENC = A(D.encuestas).filter(r => A(r).some(Boolean));
  if (ENC.length) {
    if (D.encuestasTitulo) txt('em-enc-t', S(D.encuestasTitulo));
    put('em-encuestas-tbl', tabla(['Casa', 'Levantamiento', 'Método', 'Intención por partido / aprobación', 'Internas / aspirantes'], ENC, (c, i) => i === 0 ? `<b>${S(c)}</b>` : S(c)) + (D.encuestasNota ? `<div style="font-size:10.5px;color:var(--tx3);margin-top:.5rem;line-height:1.6">${S(D.encuestasNota)}</div>` : ''));
  } else ocultar('em-enc-card');
  if (A(TD.labels).length >= 2 && TS.length) { if (TD.titulo) txt('em-tend-t', S(TD.titulo)); } else ocultar('em-tend-card');

  });
  seccion('segmentos', () => {
  /* ---------- segmentos ---------- */
  put('em-seg-intro', `<div class="cbox-label">SEGMENTA v2.1 · Eje N × E × I</div><div class="cbox-name">${SEGS.length || 4} Buyer Personas electorales de ${terrCorto}</div><div class="cbox-text">${S(D.segIntro)}</div>`);
  const prio = (t0) => { const t = S(t0).split('·').pop(); return /PERSUAD/i.test(t) ? [1,'●●●●●'] : /ACTIV/i.test(t) ? [2,'●●●●○'] : /MOVILIZ/i.test(t) ? [3,'●●●○○'] : /CONTEN/i.test(t) ? [4,'●●○○○'] : /IGNOR|NO INVERT/i.test(t) ? [5,'○○○○○'] : [4,'●●○○○']; };
  let JER = A(D.segJer).filter(j => A(j)[0]);
  if (!JER.length) JER = SEGS.map(s => ({s, p: prio(s.pers + ' · ' + s.tipo)})).sort((a, b) => a.p[0] - b.p[0]).map(x => [S(x.s.tipo).split('·').slice(0, 2).join('·').trim(), S(x.s.pers).split('·').pop().trim(), x.p[1], x.s.color]);
  put('em-seg-jer', JER.map(j => { j = A(j); return `<div class="sem"><div class="semd" style="background:${S(j[3])}"></div><div class="seml"><b style="color:var(--tx1)">${S(j[0])}</b><br><span style="font-size:11px">${S(j[1])}</span></div><div class="semv" style="color:${S(j[3]) === '#374151' ? '#94a3b8' : S(j[3])};letter-spacing:.1em">${S(j[2])}</div></div>`; }).join('') + (JER.length ? `<div style="font-size:10.5px;color:var(--tx3);margin-top:.5rem">Orden de inversión SEGMENTA: ${JER.map(j => S(A(j)[0]).split('·')[0].trim()).join(' → ')}.</div>` : '') || vacio());
  const persCol = (p) => /NUESTRO/i.test(p) ? ['#dbeafe','#1e3a8a'] : /MUY ALTA/i.test(p) ? ['#dcfce7','#166534'] : /ALTA/i.test(p) ? ['#fef9c3','#854d0e'] : /MEDIA/i.test(p) ? ['#ffedd5','#9a3412'] : ['#e5e7eb','#374151'];
  put('em-seg-cards', SEGS.map(g => {
    const col = (t, c, rows) => `<div><div class="bp-ct" style="color:${c}">${t}</div>${A(rows).map(r => { const [k, v] = A(r); return `<div class="bp-r"><b>${S(k)}:</b> ${Array.isArray(v) || S(v).startsWith('tags:') ? tagsHTML(v) : S(v)}</div>`; }).join('')}</div>`;
    const lc = g.color === '#374151' ? '#9ca3af' : g.color === '#1A3A5C' ? '#60a5fa' : (S(g.color) || '#475569');
    const pc = persCol(S(g.pers)), bg = S(g.persBg) || pc[0], tx = S(g.persTx) || pc[1];
    const peso = S(g.peso).includes('%') ? S(g.peso) : `${N(g.peso)}%`;
    return `<div class="bp"><div class="bp-h" style="background:linear-gradient(135deg,${S(g.color) || '#374151'},${S(g.color) || '#374151'}99)">
      <div class="bp-w">Peso estimado<strong>${peso}</strong></div>
      <div class="bp-tipo">${S(g.tipo)}</div><div class="bp-n">${S(g.nombre)}</div><div class="bp-s">${S(g.sub)}</div></div>
      <div class="bp-q" style="border-left-color:${lc}">«${S(g.frase)}»${g.fraseNota ? `<div style="font-size:10px;font-style:normal;color:var(--tx3);margin-top:4px">${S(g.fraseNota)}</div>` : ''}</div>
      <div class="bp-b">${col('Perfil sociodemográfico', lc, g.c1)}${col('Mundo emocional y tensiones', lc, g.c2)}${col('Problemáticas, orgullos y palancas', lc, g.c3)}</div>
      <div class="bp-f"><span><b style="color:var(--tx1)">Vector:</b> ${S(g.vector)}</span><span class="bp-badge" style="background:${bg};color:${tx}">${S(g.pers)}</span></div></div>`; }).join(''));
  put('em-seg-tbl', tabla(['Eje', 'Segmento', 'Emoción dominante', 'Intensidad', 'Detonante', 'Implicación'], D.segTabla, (c, i) => i === 1 ? `<b>${S(c)}</b>` : S(c)));
  put('em-seg-tbl-note', S(D.segTablaNote));

  });
  seccion('semiotica', () => {
  /* ---------- semiótica: arquetipo + miedos/deseos/necesidades ---------- */
  put('em-sem-codigo', `<div class="cbox-label">Código simbólico de ${terrCorto}</div>${D.codigoTitulo ? `<div class="cbox-name">${S(D.codigoTitulo)}</div>` : ''}<div class="cbox-text">${S(D.codigo) || 'Sin código simbólico disponible para este periodo.'}</div>`);
  const RANGOS = [['Dominante', '#ef4444'], ['Secundario', '#3b82f6'], ['Emergente', '#22c55e'], ['Rechazado', '#64748b']];
  const COL = A(D.arqCol).map(A).filter(a => S(a[1]).trim() || S(a[2]).trim());
  put('em-arq-col', COL.length ? COL.map((a, i) => `<div class="arq" style="border-top-color:${S(a[3]) || (RANGOS[i] || RANGOS[3])[1]}"><div class="arq-l">${S(a[0]) || (RANGOS[i] || RANGOS[3])[0]}</div><div class="arq-n">${S(a[1]) || '—'}</div><div class="arq-t">${S(a[2]) || 'Sin evidencia suficiente en las fuentes del periodo.'}</div></div>`).join('')
    : `<div class="arq" style="grid-column:1/-1">${vacio('No se identificó el arquetipo colectivo con las fuentes del periodo.')}</div>`);
  const AS0 = A(D.arqScores).map(A).filter(a => a[0]).sort((x, y) => N(y[1]) - N(x[1]));
  const AI = Object.assign({}, O(D.arqIdeal));
  if (!AI.gan && AS0[0]) AI.gan = S(AS0[0][0]);
  if (!AI.seg && AS0[1]) AI.seg = S(AS0[1][0]);
  if (!AI.ganTxt && AI.gan) AI.ganTxt = `Arquetipo con mayor resonancia en el territorio${AS0[0] ? ` (${N(AS0[0][1])}/100)` : ''}.`;
  if (!AI.segTxt && AI.seg) AI.segTxt = `Segundo arquetipo con mayor resonancia${AS0[1] ? ` (${N(AS0[1][1])}/100)` : ''}.`;
  put('em-arq-ideal', !AI.gan ? `<div class="sl">Arquetipo político ideal</div>${vacio('Sin arquetipo ideal identificado en este análisis.')}` : `<div class="sl">Arquetipo político ideal</div>
    <div class="arq" style="border-top-color:#22c55e;margin-bottom:.7rem"><div class="arq-l">1º · Mayor resonancia</div><div class="arq-n">${S(AI.gan)}</div><div class="arq-t">${S(AI.ganTxt)}</div>${AI.ganRiesgo ? `<div class="arq-t" style="margin-top:6px;color:#fca5a5"><b>Riesgo de sobreactuación:</b> ${S(AI.ganRiesgo)}</div>` : ''}</div>
    <div class="arq" style="border-top-color:#60a5fa"><div class="arq-l">2º lugar</div><div class="arq-n">${S(AI.seg) || '—'}</div><div class="arq-t">${S(AI.segTxt)}</div>${AI.segRiesgo ? `<div class="arq-t" style="margin-top:6px;color:#fca5a5"><b>Riesgo de sobreactuación:</b> ${S(AI.segRiesgo)}</div>` : ''}</div>`);
  put('em-arq-act', tabla(['Aspirante', 'Arquetipo que proyecta', 'Resonancia con el ideal'], D.arqActores, (c, i) => i === 0 ? `<b>${S(c)}</b>` : S(c)) + (D.arqNote ? `<div style="font-size:11.5px;color:var(--tx2);margin-top:.6rem;line-height:1.6">${S(D.arqNote)}</div>` : ''));
  const mdn = (arr, id) => put(id, A(arr).map((m, i) => { m = A(m); return `<div class="mdn"><div class="mdn-h"><span class="mdn-i">${i + 1}</span><span class="mdn-n">${S(m[0])}</span></div><div class="mdn-e">Evidencia: ${S(m[1])} ${tagOf(m[m.length - 1])}</div><div class="mdn-p">→ ${S(m[2])}</div></div>`; }).join('') || vacio());
  mdn(D.miedos, 'em-sem-miedos'); mdn(D.deseos, 'em-sem-deseos'); mdn(D.necesidades, 'em-sem-neces');

  });
  seccion('graficas', () => {
  /* ---------- gráficas ---------- */
  if (typeof Chart === 'undefined') { root.querySelectorAll('canvas').forEach(c => { if (c.parentElement) c.parentElement.innerHTML = '<div style="font-size:12px;color:var(--tx3);padding:1rem;text-align:center">No se pudo cargar la librería de gráficas (Chart.js). Revisa la conexión a internet y vuelve a abrir el reporte.</div>'; }); return; }
  const sinDatos = (id, t) => { const c = $(id); if (c && c.parentElement) c.parentElement.innerHTML = `<div style="height:100%;min-height:120px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12px;color:var(--tx3);border:1px dashed var(--brd2);border-radius:8px;padding:1rem">${t || 'Sin datos suficientes para esta gráfica en el periodo analizado.'}</div>`; };
  const tieneValores = (cfg) => A(O(cfg.data).datasets).some(ds => A(ds.data).some(v => v !== null && v !== undefined && Number(v) > 0));
  const mkc = (id, cfg) => { const c = $(id); if (!c) return; if (!tieneValores(cfg)) return sinDatos(id); try { new Chart(c, cfg); } catch (e) { console.warn('[emociones] gráfica', id, e); sinDatos(id); } };
  mkc('em-ch-intens', {type:'bar', data:{labels:act.map(e => e.label), datasets:[{data:act.map(e => e.intensity), backgroundColor:act.map(e => e.color[2] + 'cc'), borderColor:act.map(e => e.color[2]), borderWidth:1, borderRadius:5, borderSkipped:false}]},
    options:{...CD, indexAxis:'y', plugins:{...CD.plugins, tooltip:{...CD.plugins.tooltip, callbacks:{label:c => ' ' + ['Inactiva','Baja','Media','Alta'][c.raw]}}}, scales:{x:{...CD.scales.x, min:0, max:3, ticks:{...CD.scales.x.ticks, stepSize:1, callback:v => ['○○○','●○○','●●○','●●●'][v]}}, y:{...CD.scales.y}}}});
  const temas = A(D.temasChart).filter(t => Array.isArray(t) && t.length >= 2);
  mkc('em-ch-temas', {type:'doughnut', data:{labels:temas.map(t => S(t[0])), datasets:[{data:temas.map(t => N(t[1])), backgroundColor:temas.map((t, i) => S(t[2]) || PAL[i % PAL.length]), borderColor:'#111827', borderWidth:2}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true, position:'right', labels:{color:'#334155', font:{size:11}, boxWidth:12, padding:10}}, tooltip:{...CD.plugins.tooltip, callbacks:{label:c => ' ' + c.label + ': ' + c.raw + '%'}}}}});
  const dy = A(D.dyads);
  mkc('em-ch-diadas', {type:'bar', data:{labels:dy.map(d => envolver(S(d.name))), datasets:[{label:'Score de riesgo', data:dy.map(d => N(d.score)), backgroundColor:dy.map(d => (RISK[d.risk] || '#64748b') + 'cc'), borderColor:dy.map(d => RISK[d.risk] || '#64748b'), borderWidth:1, borderRadius:6, borderSkipped:false}]},
    options:{...CD, scales:{x:{...CD.scales.x}, y:{...CD.scales.y, min:0, max:100, ticks:{...CD.scales.y.ticks, callback:v => v + '/100'}}}}});
  const pc = A(D.partidosChart);
  mkc('em-ch-partidos', {type:'bar', data:{labels:A(D.partidos).map(p => envolver(S(p.nombre))), datasets:[
      {label:'Ira/Asco', data:pc.map(x => N(A(x)[0])), backgroundColor:'#B91C1Caa', borderRadius:4, borderSkipped:false},
      {label:'Decepción/Tristeza', data:pc.map(x => N(A(x)[1])), backgroundColor:'#4C1D95aa', borderRadius:4, borderSkipped:false},
      {label:'Interés disponible', data:pc.map(x => N(A(x)[2])), backgroundColor:'#059669aa', borderRadius:4, borderSkipped:false}]},
    options:{...CD, plugins:{...CD.plugins, legend:{display:true, labels:{color:'#334155', font:{size:10}, boxWidth:10}}}, scales:{x:{...CD.scales.x}, y:{...CD.scales.y, min:0, max:100, ticks:{...CD.scales.y.ticks, callback:v => v + '%'}}}}});
  const ar = O(D.actoresRadar);
  if (!A(ar.labels).length) sinDatos('em-ch-actores'); else mkc('em-ch-actores', {type:'radar', data:{labels:['Legitimidad ciudadana','Presencia territorial','Capital positivo','Riesgo castigo','Cap. gestión','Credibilidad'],
      datasets:(u => A(ar.labels).map((l, i) => { const c = colorSerie(A(ar.colors)[i], i, u); return {label:S(l), data:A(A(ar.data)[i]).map(N), borderColor:c, backgroundColor:c + '22', pointBackgroundColor:c, pointRadius:4, borderWidth:2}; }))(new Set())},
    options:{responsive:true, maintainAspectRatio:false, scales:{r:{ticks:{color:'#475569', font:{size:9}, stepSize:20, backdropColor:'transparent'}, grid:{color:'rgba(28,39,56,.15)'}, pointLabels:{color:'#334155', font:{size:10}}, angleLines:{color:'rgba(28,39,56,.12)'}, min:0, max:100}},
      plugins:{legend:{display:true, labels:{color:'#334155', font:{size:11}, boxWidth:10}}, tooltip:{...CD.plugins.tooltip}}}});
  if (A(TD.labels).length >= 2 && TS.length) mkc('em-ch-tend', {type:'line', data:{labels:A(TD.labels).map(S), datasets:TS.map((s, i) => { const c = S(s.color) || PAL[i % PAL.length]; return {label:S(s.label), data:A(s.data).map(v => (v === null || v === undefined || v === '') ? null : N(v)), borderColor:c, backgroundColor:c, borderDash:s.dash ? [5,4] : undefined, spanGaps:true, tension:.3}; })},
    options:{...CD, plugins:{...CD.plugins, legend:{display:true, labels:{color:'#334155', font:{size:10}, boxWidth:10}}, tooltip:{...CD.plugins.tooltip, callbacks:{label:c => ' ' + c.dataset.label + ': ' + c.raw + '%'}}}, scales:{x:{...CD.scales.x}, y:{...CD.scales.y, min:0, suggestedMax:60, ticks:{...CD.scales.y.ticks, callback:v => v + '%'}}}}});
  if (!SEGS.length) sinDatos('em-ch-seg'); else mkc('em-ch-seg', {type:'doughnut', data:{labels:SEGS.map(g => S(g.nombre) + ' (' + S(g.tipo).split('·')[0].trim() + ')'), datasets:[{data:SEGS.map(g => N(g.peso)), backgroundColor:SEGS.map((g, i) => S(g.color) || PAL[i % PAL.length]), borderColor:'#111827', borderWidth:2}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true, position:'bottom', labels:{color:'#334155', font:{size:10.5}, boxWidth:10, padding:8}}, tooltip:{...CD.plugins.tooltip, callbacks:{label:c => ' ' + c.raw + '% (estimación)'}}}}});
  const AS = A(D.arqScores).filter(a => A(a)[0]);
  if (!AS.length) sinDatos('em-ch-arq'); else mkc('em-ch-arq', {type:'bar', data:{labels:AS.map(a => S(a[0])), datasets:[{data:AS.map(a => N(a[1])), backgroundColor:AS.map(a => N(a[1]) >= 75 ? '#22c55ecc' : N(a[1]) >= 50 ? '#eab308aa' : N(a[1]) >= 30 ? '#f97316aa' : '#ef4444aa'), borderRadius:5, borderSkipped:false}]},
    options:{...CD, indexAxis:'y', scales:{x:{...CD.scales.x, min:0, max:100}, y:{...CD.scales.y, ticks:{...CD.scales.y.ticks, color:'#334155', autoSkip:false}}}}});
  const MI = A(D.miedos), DE = A(D.deseos);
  if (!MI.length && !DE.length) sinDatos('em-ch-mdn'); else mkc('em-ch-mdn', {type:'bar', data:{labels:[...MI.map((m, i) => 'M' + (i + 1) + ' · ' + S(A(m)[0])), ...DE.map((m, i) => 'D' + (i + 1) + ' · ' + S(A(m)[0]))], datasets:[{label:'Intensidad simbólica', data:[...MI.map(m => N(A(m)[3])), ...DE.map(m => N(A(m)[3]))], backgroundColor:[...MI.map(() => '#ef4444aa'), ...DE.map(() => '#22c55eaa')], borderRadius:4, borderSkipped:false}]},
    options:{...CD, indexAxis:'y', plugins:{...CD.plugins, legend:{display:false}}, scales:{x:{...CD.scales.x, min:0, max:100}, y:{...CD.scales.y, ticks:{...CD.scales.y.ticks, color:'#334155', font:{size:10}, autoSkip:false}}}}});
  });
}
init();
})();
