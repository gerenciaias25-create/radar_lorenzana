(function(){
/* EMOCIONES · SEGMENTA · SEMIÓTICA — v4 (estructura EMOCIONES-XONA, 8 pestañas). */
const RAW = (window.DATA && typeof window.DATA === 'object') ? window.DATA : {};
const META = window.DATA_META || {};
const root = document.getElementById('emo-root');
const $ = (id) => document.getElementById(id);
const A = (v) => Array.isArray(v) ? v : [];
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const S = (v) => (v === undefined || v === null) ? '' : String(v);
const N = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

// 8 emociones de Plutchik: geometría y color fijos (la IA solo da intensidad, detonantes y consecuencias).
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
const RADAR_LABELS = ['Legitimidad ciudadana','Presencia territorial','Capital positivo','Riesgo de castigo','Capacidad de gestión','Credibilidad'];
const PALETTE = ['#FF8300','#22c55e','#ef4444','#f472b6','#3b82f6','#a855f7'];

const D = RAW;
const emotions = EMOTION_META.map(m => {
  const d = A(D.emotions).find(e => e && e.key === m.key) || {};
  const iv = Math.max(0, Math.min(3, Math.round(N(d.intensity))));
  return {...m, active: !!d.active && iv > 0, intensity: iv, triggers: A(d.triggers), consequences: A(d.consequences)};
});
const activeEm = emotions.filter(e => e.active);
const ive = O(D.ive);
const cliente = S(META.cliente || D.cliente).trim();
const clienteCorto = cliente ? (cliente.match(/\(([^)]+)\)/) || [])[1] || cliente : 'el cliente';
const territorio = S(D.territory || META.actor || 'Sin datos');
const terrCorto = territorio.split(/[,·]/)[0].trim() || S(META.actor);
const periodoTxt = S(META.periodo || D.date || [META.mes, META.anio].filter(Boolean).join(' '));
const fecha = S(D.date || periodoTxt);
const anioElec = S(D.anioEleccion);

// ---------- pestañas ----------
window.emST = function(id, el){
  root.querySelectorAll('.pnl').forEach(p => p.classList.remove('on'));
  root.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  const p = $('empnl-' + id); if (p) p.classList.add('on');
  el.classList.add('on');
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
const IN = ['#cbd5e1','#94a3b8','#64748b'];
function buildWheel(){ let p = '';
  emotions.forEach(em => { const {active:ac, intensity:iv, color, deg, key, label} = em;
    [1,2,3].forEach(i => { const fill = ac && iv >= i ? color[i-1] : IN[i-1];
      p += `<path d="${arc(R[i-1],R[i],deg,deg+45)}" fill="${fill}" stroke="#f8fafc" stroke-width="2" ${ac ? `onclick="emToggleEm('${key}')" style="cursor:pointer"` : ''}/>`; });
    const md = deg + 22.5, [lx,ly] = pt(R[3]+23, md);
    const an = Math.cos(rad(md)) > .12 ? 'start' : Math.cos(rad(md)) < -.12 ? 'end' : 'middle';
    p += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${an}" dominant-baseline="middle" font-size="11" font-family="-apple-system,sans-serif" fill="${ac ? '#0f172a' : '#94a3b8'}" font-weight="${ac ? '700' : '400'}" style="pointer-events:none">${label}</text>`;
    if (ac && iv === 3){ const [bx,by] = pt(R[3]+6, md); p += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5" fill="${color[2]}" style="pointer-events:none"><animate attributeName="opacity" values="1;.25;1" dur="1.6s" repeatCount="indefinite"/></circle>`; }
  });
  return `<svg viewBox="-70 0 580 440" role="img" aria-label="Rueda de Plutchik">${p}<circle cx="${CX}" cy="${CY}" r="${R[0]-4}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5"/><text x="${CX}" y="${CY-7}" text-anchor="middle" font-size="9.5" fill="#64748b" font-weight="700" letter-spacing="2">HUMOR</text><text x="${CX}" y="${CY+7}" text-anchor="middle" font-size="9.5" fill="#64748b" font-weight="700" letter-spacing="2">SOCIAL</text></svg>`; }

const CD = {responsive:true, maintainAspectRatio:false,
  plugins:{legend:{display:false}, tooltip:{backgroundColor:'#1C2738', titleColor:'#ffffff', bodyColor:'#cbd5e1', borderColor:'#334155', borderWidth:1}},
  scales:{x:{ticks:{color:'#334155', font:{size:11}}, grid:{color:'rgba(0,0,0,.05)'}}, y:{ticks:{color:'#334155', font:{size:11}}, grid:{color:'rgba(0,0,0,.05)'}}}};
const kv = (arr) => A(arr).map(r => `<div class="kv"><b>${S(r[0])}</b>${S(r[1])}</div>`).join('');
const vacio = (t) => `<div style="font-size:12px;color:var(--tx3);padding:6px 0">${t || 'Sin datos suficientes en las fuentes del periodo.'}</div>`;

function init(){
  /* ---------- encabezado ---------- */
  $('em-hdr-meta').innerHTML = `<div>● MONITOREO ACTIVO · ${fecha}</div><div style="color:#94a3b8">${territorio.toUpperCase()}</div>`;
  $('em-hdr-date').textContent = fecha.toUpperCase();
  $('em-whl-territory').textContent = terrCorto;
  $('em-hdr-title').innerHTML = territorio.replace(/(\S+)/, m => `<span style="color:#60a5fa">${m}</span>`);
  $('em-hdr-sub').textContent = S(D.subtitle);
  const tot = activeEm.reduce((s, e) => s + e.intensity, 0) || 1;
  const cap = Math.round(activeEm.filter(e => ['alegria','confianza'].includes(e.key)).reduce((s, e) => s + e.intensity, 0) / tot * 100);
  const hiEms = activeEm.filter(e => e.intensity === 3).map(e => e.label).join(' + ');
  $('em-hdr-badges').innerHTML = `<span class="badge b-red pulse">● RIESGO ${S(D.riskLevel)}</span>${hiEms ? `<span class="badge b-red">${hiEms}: DOMINANTES</span>` : ''}
    <span class="badge b-org">IVE ${N(ive.value)} · ${S(ive.cls)}</span><span class="badge b-blu">CAPITAL POSITIVO: ${cap}%</span>
    <span class="badge b-pur">CONCEPTO: ${S(D.concept).toUpperCase()}</span>${cliente ? `<span class="badge b-mc">CLIENTE: ${cliente.toUpperCase()}</span>` : ''}`;
  if (anioElec) $('em-tab-actores').textContent = 'Actores ' + anioElec;
  $('em-ftr-r').textContent = [territorio, (fecha.match(/\d{4}/) || [META.anio || ''])[0]].filter(Boolean).join(' · ');

  /* ---------- flor ---------- */
  $('em-wheel-wrap').innerHTML = buildWheel();
  const hi = activeEm.find(e => e.intensity === 3) || activeEm[0], md = activeEm.find(e => e.intensity === 2) || hi;
  $('em-leg-hi').style.background = hi ? hi.color[2] : '#B91C1C';
  $('em-leg-md').style.background = md ? md.color[1] : '#67E8F9';
  $('em-list').innerHTML = [...activeEm].sort((a, b) => b.intensity - a.intensity).map(em => { const iv = em.intensity;
    const riskTx = iv === 3 ? 'var(--red-s)' : iv === 2 ? 'var(--org-s)' : 'var(--ylw)';
    return `<div class="emr" onclick="emToggleEm('${em.key}')"><div class="emh">
      <div style="width:10px;height:10px;border-radius:50%;background:${em.color[2]};box-shadow:0 0 6px ${em.color[2]}55;flex-shrink:0"></div>
      <span style="font-size:13px;font-weight:700">${em.label}</span>
      <span style="margin-left:auto;font-size:13px;color:${riskTx}">${'●'.repeat(iv)}<span style="color:#94a3b8">${'○'.repeat(3 - iv)}</span></span></div>
      <div style="font-size:10.5px;color:var(--tx3);margin-top:2px;margin-left:17px">${em.sublabel}</div>
      <div class="emd-box" id="emd-${em.key}">${em.triggers.length ? `<div class="edk">Detonantes:</div><div class="edv">${em.triggers.join(' · ')}</div>` : ''}
      ${em.consequences.length ? `<div class="edk" style="margin-top:5px">Consecuencias:</div><div class="edv">${em.consequences.join(' · ')}</div>` : ''}</div></div>`; }).join('') || vacio('Sin emociones activas detectadas en el periodo.');
  $('em-sec').innerHTML = A(D.secondary).map(s => `<div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--brd)"><div style="width:7px;height:7px;border-radius:50%;background:${s.color};flex-shrink:0;margin-top:5px"></div><div><div style="font-size:12px;font-weight:700">${S(s.name)}</div><div style="font-size:11.5px;color:var(--tx2);margin-top:2px;line-height:1.55">${S(s.text)}</div></div></div>`).join('') || vacio();
  $('em-concepto-box').innerHTML = `<div class="cbox-label">Concepto Central del Territorio</div><div class="cbox-name">"${S(D.concept)}"</div><div class="cbox-text">${S(D.conceptDesc)}</div>`;

  /* ---------- mapa social ---------- */
  const mk = (arr, dc) => A(arr).map(t => `<div class="mpi"><div class="mpd" style="background:${dc}"></div>${S(t)}</div>`).join('') || vacio();
  $('em-mapa-cols').innerHTML = `<div class="mpc"><div class="mptt" style="color:#ca8a04">⚠ Problemáticas</div>${mk(D.problematics, '#ca8a04')}</div>
    <div class="mpc"><div class="mptt" style="color:#dc2626">⬡ Miedos</div>${mk(D.fears, '#dc2626')}</div>
    <div class="mpc"><div class="mptt" style="color:#16a34a">★ Orgullos</div>${mk(D.prides, '#16a34a')}</div>`;
  $('em-quotes').innerHTML = A(D.quotes).map(q => `<div class="qi"><div class="qt">${S(q.text)}</div><div class="qm">${[q.topic, q.emotion, q.territory].filter(Boolean).join(' · ')}</div></div>`).join('') || vacio();
  if (periodoTxt) $('em-temas-t').textContent = `Peso de la conversación por temática (${periodoTxt})`;
  const sem = (arr, id) => { $(id).innerHTML = A(arr).map(s => `<div class="sem"><div class="semd" style="background:${s.color}"></div><div class="seml">${S(s.label)}</div><div class="semv" style="color:${s.color}">${S(s.val)}</div></div>`).join('') || vacio(); };
  sem(D.semaforo, 'em-semaforo');

  /* ---------- díadas · IVE · transferencia ---------- */
  const rh = {CRÍTICO:'#dc2626', ALTO:'#ea580c', MEDIO:'#ca8a04', BAJO:'#64748b'}, rb = {CRÍTICO:'#fee2e2', ALTO:'#ffedd5', MEDIO:'#fef9c3', BAJO:'#f1f5f9'};
  $('em-dyad-cards').innerHTML = A(D.dyads).map(d => `<div class="dyc" style="border-top-color:${rh[d.risk] || '#64748b'}"><span class="dybadge" style="background:${rb[d.risk] || '#f1f5f9'};color:${rh[d.risk] || '#64748b'}">${S(d.risk)}</span><div class="dyn" style="color:${rh[d.risk] || 'var(--tx1)'}">${S(d.name)}</div><div class="dyf">Díada ${S(d.type)} · ${S(d.formula)}</div><div class="dyt">${S(d.text)}</div></div>`).join('') || `<div class="dyc">${vacio('Sin díadas detectadas.')}</div>`;
  $('em-dyad-interp').innerHTML = S(D.dyadInterp) || 'Sin interpretación disponible.';
  const iv = N(ive.value), ivCol = iv >= 80 ? '#dc2626' : iv >= 60 ? 'var(--org)' : iv >= 40 ? '#ca8a04' : '#16a34a';
  const ivIco = iv >= 80 ? '🔴' : iv >= 60 ? '🟠' : iv >= 40 ? '🟡' : '🟢';
  $('em-ive-box').innerHTML = `<div class="sl">Índice de Volatilidad Emocional</div><div class="ive"><div class="ive-n" style="color:${ivCol}">${iv}</div><div><div style="font-weight:800;color:${ivCol}">${ivIco} ${S(ive.cls)}</div><div class="csub">Horizonte de cambio: ${S(ive.horizon) || '—'}</div></div></div>
    <div style="margin-top:.8rem">${A(ive.comps).map(c => { const v = N(c[1]); return `<div class="comp"><div>${S(c[0])}<div class="bar"><span style="width:${v}%;background:${v >= 75 ? '#dc2626' : v >= 60 ? '#ea580c' : '#ca8a04'}"></span></div></div><div style="text-align:right;font-weight:700;color:var(--tx1);font-variant-numeric:tabular-nums">${v}</div></div>`; }).join('')}</div>
    <div class="csub" style="line-height:1.6;margin-top:.5rem">${S(ive.text)}</div>`;
  $('em-cliente-t').textContent = `Posición de ${cliente || 'el cliente'} en el mapa de transferencia`;
  $('em-cliente-pos').innerHTML = A(D.clientePos).map(r => `<div class="kv" style="border-bottom:1px solid var(--brd);padding:7px 0"><b style="color:var(--org)">${S(r[0])}</b>${S(r[1])}</div>`).join('') || vacio();
  $('em-flows').innerHTML = A(D.flows).map(f => `<div class="flow"><div class="fem" style="border-color:${f.color};background:${f.color}22">${S(f.em)}</div><div><span class="fk">Origen</span>${S(f.origen)}</div><div><span class="fk">Canal</span>${S(f.canal)}</div><div><span class="fk">Destino</span>${S(f.destino)}</div><div><span class="fk">Tipo</span><b style="color:var(--tx1)">${S(f.tipo)}</b></div></div>`).join('') || vacio();

  /* ---------- identidad política ---------- */
  $('em-id-pregunta').innerHTML = `<div class="cbox-label">Pregunta Política del Territorio</div><div class="cbox-name" style="font-size:18px">"${S(D.preguntaPolitica)}"</div><div class="cbox-text">${S(D.preguntaDesc)}</div>`;
  if (D.periodoGobierno) $('em-gov-t').textContent = `Percepción del Gobierno Municipal ${D.periodoGobierno}`;
  sem(D.govSemaforo, 'em-gov-sem');
  $('em-partidos-tbl').innerHTML = A(D.partidos).map(p => { const t = S(p.tendencia); return `<div style="display:grid;grid-template-columns:1.2fr 2fr .8fr 1.1fr;gap:.6rem;padding:8px 0;border-bottom:1px solid var(--brd);font-size:12px">
    <div style="font-weight:700;color:${p.color || 'var(--tx1)'}">${S(p.nombre)}</div><div style="color:var(--tx2)">${S(p.emocion)}</div><div style="color:var(--tx2)">${S(p.capital)}</div>
    <div style="color:${t.includes('↓') ? '#dc2626' : t.includes('↑') ? '#16a34a' : '#64748b'};font-weight:600">${t}</div></div>`; }).join('') || vacio();
  $('em-marcos').innerHTML = A(D.marcos).map(m => `<div class="card" style="border-top:3px solid ${m.c}"><div class="sl" style="color:${m.c}">${S(m.k)}</div><div style="font-size:12px;color:var(--tx2);line-height:1.65">${S(m.t).replace(/<b>/g, '<b style="color:var(--tx1)">')}</div></div>`).join('');
  $('em-sintesis').innerHTML = `<div class="cbox-label" style="color:var(--org)">Síntesis integrada Plutchik · Haidt · Westen · Lakoff</div><div class="cbox-text">${S(D.sintesis) || 'Sin síntesis disponible.'}</div>`;

  /* ---------- actores ---------- */
  $('em-actores-grid').innerHTML = A(D.actores).map((a, i) => `<div class="ac"><div class="ach" style="border-left:4px solid ${a.borderColor || PALETTE[i % PALETTE.length]}"><div class="acn">${S(a.name)}</div><div class="acr">${S(a.role)}</div></div><div class="acb">${A(a.rows).map(r => `<div class="acrow"><span class="ack">${S(r[0])}</span><span class="acv">${S(r[1])}</span></div>`).join('')}</div></div>`).join('') || `<div class="ac"><div class="acb">${vacio('Sin actores disponibles.')}</div></div>`;

  /* ---------- segmentos ---------- */
  $('em-seg-intro').innerHTML = `<div class="cbox-label" style="color:var(--org)">SEGMENTA v2.1 · Buyer Personas Electorales</div><div class="cbox-text">${S(D.segIntro)}</div>`;
  const SEGS = A(D.segmentos);
  const prio = (t0) => { const t = S(t0).split('·').pop(); return /PERSUAD/i.test(t) ? [1,'●●●●●'] : /ACTIV/i.test(t) ? [2,'●●●●○'] : /MOVILIZ/i.test(t) ? [3,'●●●○○'] : /CONTEN/i.test(t) ? [4,'●●○○○'] : /IGNOR/i.test(t) ? [5,'○○○○○'] : [4,'●●○○○']; };
  const tipoCorto = (t) => { const p = S(t).split('·').map(x => x.trim()); return [p[0], p[p.length - 1]].filter(Boolean).join(' · '); };
  $('em-seg-inv').innerHTML = SEGS.map(s => ({s, p: prio(s.tipo)})).sort((a, b) => a.p[0] - b.p[0]).map((x, i) => { const c = /IGNOR/i.test(x.s.tipo) ? '#6b7280' : x.s.color;
    return `<div class="sem"><div style="font-weight:800;color:${c};width:18px">${i + 1}</div><div class="seml"><b style="color:var(--tx1)">${S(x.s.nombre)}</b><br><span style="font-size:10.5px;color:var(--tx3)">${tipoCorto(x.s.tipo)}</span></div><div class="semv" style="color:${c};letter-spacing:2px">${x.p[1]}</div></div>`; }).join('') || vacio();
  $('em-bp-list').innerHTML = SEGS.map(s => { const c3 = O(s.c3); return `<div class="bp">
    <div class="bph" style="background:linear-gradient(120deg,${s.color},${s.color}dd)"><div><div class="bpt">${S(s.tipo)}</div><div class="bpn">${S(s.nombre)}</div><div class="bps">${S(s.sub)}</div></div><div class="bpw"><b>${N(s.peso)}%</b><span>peso estimado</span></div></div>
    <div class="bpq" style="border-left-color:${s.color === '#374151' ? '#6b7280' : s.color}">"${S(s.frase)}"</div>
    <div class="bpb">
      <div class="bpc"><h4 style="color:#1d4ed8">Perfil sociodemográfico</h4>${kv(s.c1)}</div>
      <div class="bpc"><h4 style="color:#991b1b">Mundo emocional y tensiones</h4>${kv(s.c2)}</div>
      <div class="bpc"><h4 style="color:#15803d">Problemáticas, orgullos y palancas</h4>
        <div class="kv"><b>Problemas críticos</b><div class="tags">${A(c3.tags).map(t => `<span class="tag" style="color:#c2410c;border-color:#ea580c;background:rgba(234,88,12,.1)">${S(t)}</span>`).join('')}</div></div>
        ${kv([['Orgullo comunitario', c3.orgullo], ['Consumo digital', c3.consumo], [`Qué lo haría votar por ${clienteCorto}`, c3.votaria], ['Qué lo alejaría', c3.alejaria], ['Frame cognitivo', c3.frame], ['Palanca', c3.palanca]].filter(r => r[1]))}</div>
    </div>
    <div class="bpf"><span><b style="color:var(--tx1)">Vector:</b> ${S(s.vector)}</span><span class="pb" style="background:${s.color};color:#fff">PERSUABILIDAD: ${S(s.pers)}</span></div></div>`; }).join('');
  const tabla = (t) => { t = O(t); return `<thead><tr>${A(t.head).map(h => `<th>${S(h).replace(/el cliente/i, clienteCorto)}</th>`).join('')}</tr></thead><tbody>${A(t.rows).map(r => `<tr>${A(r).map(c => `<td>${S(c)}</td>`).join('')}</tr>`).join('')}</tbody>`; };
  $('em-seg-tbl').innerHTML = tabla(D.segTbl);

  /* ---------- arquetipo ---------- */
  $('em-arq-cards').innerHTML = A(D.arquetipos).map(a => `<div class="arq" style="border-top:3px solid ${a.c}"><div class="k" style="color:${a.c}">${S(a.k)}</div><div class="n">${S(a.n)}</div><p>${S(a.p)}</p></div>`).join('');
  $('em-arq-win').innerHTML = A(D.arqWin).map(w => `<div style="padding:8px 0;border-bottom:1px solid var(--brd)"><div style="font-weight:800;color:${w.c};font-size:14px">${S(w.pos)}</div><div class="kv"><b>Por qué resuena</b>${S(w.why)}</div><div class="kv"><b style="color:#991b1b">Riesgo de sobreactuación</b>${S(w.risk)}</div></div>`).join('') || vacio();
  if (anioElec) $('em-arqact-t').textContent = `Lectura arquetípica de los actores ${anioElec}`;
  $('em-arq-act').innerHTML = tabla(D.arqActores);
  $('em-arq-codigo').innerHTML = `<div class="cbox-label">Código simbólico de ${terrCorto}</div><div class="cbox-text">${S(D.codigo).replace(/<b>/g, '<b style="color:var(--tx1)">')}</div>`;

  /* ---------- miedos · deseos · necesidades ---------- */
  const L = (arr, c, withScore) => A(arr).map((x, i) => `<div class="mdn"><div class="h"><span class="i">${String(i + 1).padStart(2, '0')}</span><span class="t">${S(x[0])}</span>${withScore ? `<span style="margin-left:auto;font-size:11px;font-weight:800;color:${c};font-variant-numeric:tabular-nums">${N(x[3])}</span>` : ''}</div><div class="e">${S(x[1])}</div><div class="p"><b>Lectura política:</b> ${S(x[2])}</div></div>`).join('') || vacio();
  $('em-l-miedos').innerHTML = L(D.miedos, '#991b1b', true);
  $('em-l-deseos').innerHTML = L(D.deseos, '#15803d', true);
  $('em-l-necesidades').innerHTML = L(D.necesidades, '#1d4ed8', false);

  /* ---------- gráficas ---------- */
  if (typeof Chart === 'undefined') return;
  const mkc = (id, cfg) => { const c = $(id); if (c) new Chart(c, cfg); };
  mkc('em-ch-intens', {type:'bar', data:{labels:activeEm.map(e => e.label), datasets:[{data:activeEm.map(e => e.intensity), backgroundColor:activeEm.map(e => e.color[2] + 'dd'), borderColor:activeEm.map(e => e.color[2]), borderWidth:1, borderRadius:5, borderSkipped:false}]},
    options:{...CD, indexAxis:'y', plugins:{...CD.plugins, tooltip:{...CD.plugins.tooltip, callbacks:{label:c => ' ' + ['Inactiva','Baja','Media','Alta'][c.raw]}}}, scales:{x:{...CD.scales.x, min:0, max:3, ticks:{...CD.scales.x.ticks, stepSize:1, callback:v => ['○○○','●○○','●●○','●●●'][v]}}, y:{...CD.scales.y}}}});
  const temas = A(D.temasChart).filter(t => Array.isArray(t) && t.length >= 2);
  mkc('em-ch-temas', {type:'doughnut', data:{labels:temas.map(t => t[0]), datasets:[{data:temas.map(t => N(t[1])), backgroundColor:temas.map((t, i) => t[2] || PALETTE[i % PALETTE.length]), borderColor:'#ffffff', borderWidth:2}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true, position:'bottom', labels:{color:'#334155', font:{size:11}, boxWidth:12, padding:8}}, tooltip:{...CD.plugins.tooltip, callbacks:{label:c => ' ' + c.label + ': ' + c.raw + '%'}}}}});
  const dy = A(D.dyads);
  mkc('em-ch-diadas', {type:'bar', data:{labels:dy.map(d => d.name), datasets:[{data:dy.map(d => N(d.score)), backgroundColor:dy.map(d => (rh[d.risk] || '#64748b') + 'cc'), borderColor:dy.map(d => rh[d.risk] || '#64748b'), borderWidth:1, borderRadius:6, borderSkipped:false}]},
    options:{...CD, scales:{x:{...CD.scales.x}, y:{...CD.scales.y, min:0, max:100, ticks:{...CD.scales.y.ticks, callback:v => v + '/100'}}}}});
  const pc = A(D.partidosChart);
  mkc('em-ch-partidos', {type:'bar', data:{labels:A(D.partidos).map(p => p.corto || p.nombre), datasets:[
      {label:'Ira / Asco', data:pc.map(x => N(A(x)[0])), backgroundColor:'#B91C1Ccc', borderRadius:4, borderSkipped:false},
      {label:'Decepción / Tristeza', data:pc.map(x => N(A(x)[1])), backgroundColor:'#7c3aedcc', borderRadius:4, borderSkipped:false},
      {label:'Interés / apoyo', data:pc.map(x => N(A(x)[2])), backgroundColor:'#059669cc', borderRadius:4, borderSkipped:false}]},
    options:{...CD, plugins:{...CD.plugins, legend:{display:true, labels:{color:'#334155', font:{size:10}, boxWidth:10}}}, scales:{x:{...CD.scales.x}, y:{...CD.scales.y, min:0, max:100, ticks:{...CD.scales.y.ticks, callback:v => v + '%'}}}}});
  const ar = O(D.actoresRadar);
  if (A(ar.labels).length) mkc('em-ch-actores', {type:'radar', data:{labels:RADAR_LABELS,
      datasets:A(ar.labels).map((l, i) => { const c = A(ar.colors)[i] || PALETTE[i % PALETTE.length]; return {label:l, data:A(A(ar.data)[i]).map(N), borderColor:c, backgroundColor:c + '22', pointBackgroundColor:c, pointRadius:3, borderWidth:2}; })},
    options:{responsive:true, maintainAspectRatio:false, scales:{r:{min:0, max:100, ticks:{color:'#64748b', backdropColor:'transparent', font:{size:9}, stepSize:20}, grid:{color:'rgba(0,0,0,.08)'}, angleLines:{color:'rgba(0,0,0,.08)'}, pointLabels:{color:'#334155', font:{size:10.5}}}},
      plugins:{legend:{display:true, position:'bottom', labels:{color:'#334155', font:{size:11}, boxWidth:10}}, tooltip:{...CD.plugins.tooltip}}}});
  if (SEGS.length) mkc('em-ch-seg', {type:'doughnut', data:{labels:SEGS.map(s => s.nombre), datasets:[{data:SEGS.map(s => N(s.peso)), backgroundColor:SEGS.map(s => s.color), borderColor:'#ffffff', borderWidth:2}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:true, position:'right', labels:{color:'#334155', font:{size:11}, boxWidth:12}}, tooltip:{...CD.plugins.tooltip, callbacks:{label:c => ' ' + c.label + ': ' + c.raw + '%'}}}}});
  const AI = A(D.arqIdeal);
  const rech = S((A(D.arquetipos)[3] || {}).n) + ' ' + S((A(D.arquetipos)[3] || {}).p);
  const esRech = (l) => { const w = S(l).split(/[\s(]/)[0]; return w.length > 3 && new RegExp(w, 'i').test(rech); };
  if (AI.length) mkc('em-ch-arq', {type:'bar', data:{labels:AI.map(a => a[0]), datasets:[{data:AI.map(a => N(a[1])), backgroundColor:AI.map((a, i) => i === 0 ? '#16a34acc' : i === 1 ? '#2563ebcc' : esRech(a[0]) ? '#dc2626aa' : '#475569cc'), borderRadius:4, borderSkipped:false}]},
    options:{...CD, indexAxis:'y', scales:{x:{...CD.scales.x, min:0, max:100}, y:{...CD.scales.y, ticks:{...CD.scales.y.ticks, color:'#334155', autoSkip:false}}}}});
  const MI = A(D.miedos), DE = A(D.deseos), nMD = Math.max(MI.length, DE.length);
  if (nMD) mkc('em-ch-mdn', {type:'bar', data:{labels:Array.from({length:nMD}, (_, i) => String(i + 1).padStart(2, '0')), datasets:[
      {label:'Miedos', data:MI.map(m => N(m[3])), backgroundColor:'#dc2626bb', borderRadius:4, borderSkipped:false},
      {label:'Deseos', data:DE.map(d => N(d[3])), backgroundColor:'#16a34abb', borderRadius:4, borderSkipped:false}]},
    options:{...CD, plugins:{...CD.plugins, legend:{display:true, labels:{color:'#334155', font:{size:11}, boxWidth:10}}, tooltip:{...CD.plugins.tooltip, callbacks:{title:c => { const arr = c[0].datasetIndex === 0 ? MI : DE; return S((arr[c[0].dataIndex] || [])[0]); }}}},
      scales:{x:{...CD.scales.x, title:{display:true, text:'Posición en el ranking', color:'#64748b'}}, y:{...CD.scales.y, min:0, max:100, title:{display:true, text:'Intensidad simbólica (0–100)', color:'#64748b'}}}}});
}
init();
})();
