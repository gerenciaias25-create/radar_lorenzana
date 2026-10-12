(function(){
/* RADAR v2.0 · Análisis bivariado — estructura RADAR_KinoRuiz_Xonacatlan v3 (9 pestañas). */
const D = (window.DATA && typeof window.DATA === 'object') ? window.DATA : {};
const META = window.DATA_META || {};
const root = document.getElementById('radar-root');
const $ = (id) => document.getElementById(id);
const A = (v) => Array.isArray(v) ? v : [];
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const S = (v) => (v === undefined || v === null) ? '' : String(v);
const N = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const esc = (v) => S(v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const C = {ac:'#00C2D4',go:'#F4C430',da:'#E63946',su:'#2EC4B6',ne:'#8FA3B1',bl:'#1B4F8A',or:'#E67E22'};
const SENT_COLOR = {positivo:C.su,negativo:C.da,neutro:C.ne,polarizado:C.go};
const G = 'rgba(255,255,255,.05)';
if (window.Chart) { Chart.defaults.color='#8FA3B1'; Chart.defaults.font.family='system-ui,sans-serif'; Chart.defaults.font.size=10; Chart.defaults.maintainAspectRatio=false; }
const sg = v => (v > 0 ? '+' : '') + v;
const nps = d => { const den = N(d[0]) + N(d[2]); return den ? Math.round((N(d[0]) - N(d[2])) / den * 100) : 0; };
const npsCol = v => v >= 20 ? C.su : v >= 0 ? C.go : v > -30 ? C.da : '#AA0000';
const evSpan = (e) => e ? ` <span class="ev">${esc(e)}</span>` : '';

const actor = O(D.actor), alerta = O(D.alerta);
const SEG = O(D.segmentos);
SEG.general = A(SEG.general).length ? SEG.general : [0,0,0,0];
['edad','genero','partido','plataforma'].forEach(k => { SEG[k] = O(SEG[k]); });
const TOMD = O(D.tom);
const TOPICS = A(TOMD.temas);
const Q = A(D.quincenas);
const esSemana = META.periodoTipo === 'semana' || Q.some(q => /^D\d/i.test(S(q.codigo)));
const periodo = META.periodo || actor.periodo || [META.mes, META.anio].filter(Boolean).join(' ');

/* ---------- ENCABEZADO ---------- */
const nombre = S(META.actor || 'PERSONAJE').trim();
const partes = nombre.split(/\s+/);
const corte = partes.length > 2 ? Math.ceil(partes.length / 2) : 1;
$('r-hdr-name').innerHTML = esc(partes.slice(0, corte).join(' ').toUpperCase()) + (partes.length > 1 ? ' <span>' + esc(partes.slice(corte).join(' ').toUpperCase()) + '</span>' : '');
$('r-hdr-sub').textContent = [actor.cargo, actor.entidad, actor.partido, actor.periodo || periodo].filter(Boolean).join(' · ');
const nivel = N(alerta.nivel) || 2, color = S(alerta.color || 'AMARILLA').toUpperCase();
const territorio = S(actor.entidad).split(',')[0].trim();
$('r-meta').innerHTML = `<span class="pulse"></span>BIVARIADO ACTIVO · ${esc(S(periodo).toUpperCase())} · ${esc(nombre.toUpperCase())}${territorio ? ' · ' + esc(territorio.toUpperCase()) : ''}<br><span class="alert">⚡ NIVEL ${nivel} · ALERTA ${esc(color)}${alerta.corte ? ' · CORTE ' + esc(S(alerta.corte).toUpperCase()) : ''}</span>`;
const kpiVal = (pref) => { const k = A(D.kpis).find(x => S(x.clave).toUpperCase().startsWith(pref)); return k ? S(k.valor) : 'n/d'; };
const npsTxt = kpiVal('NPS'), irr = kpiVal('IRR'), icn = kpiVal('ICN');
const negativo = (t) => /^[−-]/.test(t.trim());
$('r-tags').innerHTML = `<span class="tag ta">ANÁLISIS BIVARIADO</span>${actor.cargo ? `<span class="tag tn">${esc(S(actor.cargo).toUpperCase())}</span>` : ''}`
  + `<span class="tag tg">ALERTA: ${esc(color)}</span><span class="tag ${negativo(npsTxt) ? 'td' : 'ta'}">NPS-P: ${esc(npsTxt)}</span><span class="tag td">IRR: ${esc(irr)}</span><span class="tag ta">ICN: ${esc(icn)}</span>`;
$('r-metodo').innerHTML = S(D.metodo);
$('r-ftr-l').textContent = `RADAR v2.0 · ANÁLISIS BIVARIADO · ESTUDIO CONFIDENCIAL${territorio ? ' · ' + territorio.toUpperCase() : ''}${periodo ? ' · ' + S(periodo).toUpperCase() : ''}`;
$('r-fuentes').innerHTML = A(D.fuentes).filter(f => f && /^https?:\/\//.test(S(f.url))).map(f => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.titulo || f.url)}</a></li>`).join('') || '<li>Sin fuentes con enlace verificable en el periodo.</li>';

/* ---------- PESTAÑAS ---------- */
window.radarTab = function(btn, id){
  root.querySelectorAll('.tsec').forEach(s => s.classList.remove('show'));
  root.querySelectorAll('.tb').forEach(t => t.classList.remove('act'));
  const t = $('rtab-' + id); if (t) t.classList.add('show');
  btn.classList.add('act');
  setTimeout(() => rCharts(id), 40);
};
const CH = {};
function mk(id, cfg){ if (!window.Chart) return; if (CH[id]) CH[id].destroy(); const c = $(id); if (!c) return; CH[id] = new Chart(c, cfg); }
const yPct = {grid:{color:G},ticks:{callback:v=>v+'%'}};
const yNps = {grid:{color:G},min:-100,max:100,ticks:{callback:sg}};
const xOff = {grid:{display:false},ticks:{font:{size:9}}};
const legB = {position:'bottom',labels:{font:{size:9},padding:8,boxWidth:10}};
function npsBar(id, labels, vals, horiz){ mk(id,{type:'bar',data:{labels,datasets:[{data:vals,backgroundColor:vals.map(npsCol),borderRadius:2,borderWidth:0}]},options:{indexAxis:horiz?'y':'x',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'NPS-P '+sg(c.raw)}}},scales:horiz?{x:{...yNps},y:xOff}:{y:{...yNps},x:xOff}}}); }
const tarjeta = (h, cls) => `<div class="ic ${cls}"><div class="ih">${esc(h.titulo)}${evSpan(h.ev)}</div><div class="ib">${S(h.texto)}</div>${h.accion ? `<div class="im">→ ${S(h.accion).replace(/^→\s*/, '')}</div>` : ''}</div>`;
const CLS4 = ['go','ac','su','da'];

/* ---------- KPIs ---------- */
$('r-kpis').innerHTML = A(D.kpis).map(k => `<div class="kpi ${esc(k.color || 'ac')}"><div class="kl">${esc(k.clave)}${evSpan(k.ev)}</div><div class="kv">${esc(k.valor || 'n/d')}</div><div class="kn">${S(k.nota)}</div></div>`).join('');
const ratioLine = {id:'rl',afterDraw(c){const s=c.scales.x;if(!s)return;const x=s.getPixelForValue(1.5);const {top,bottom}=c.chartArea;const g=c.ctx;g.save();g.strokeStyle=C.or;g.setLineDash([4,4]);g.beginPath();g.moveTo(x,top);g.lineTo(x,bottom);g.stroke();g.fillStyle=C.or;g.font='9px monospace';g.fillText('1.5',x+3,top+10);g.restore();}};
function rKpis(){
  const p = SEG.partido; npsBar('rc-npspar', Object.keys(p), Object.keys(p).map(k => nps(p[k])));
  const lab = [...Object.keys(SEG.edad), ...Object.keys(SEG.genero)];
  const val = [...Object.values(SEG.edad), ...Object.values(SEG.genero)].map(nps);
  npsBar('rc-npsdemo', lab, val);
  const rr = A(D.ratioPlataforma).filter(r => typeof r.valor === 'number');
  mk('rc-ratiopl',{type:'bar',data:{labels:rr.map(r=>r.etiqueta),datasets:[{data:rr.map(r=>Math.min(r.valor,4)),backgroundColor:rr.map(r=>r.valor>1.5?C.da:r.valor>1?C.go:C.su),borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>rr[c.dataIndex].valor+'x'+(rr[c.dataIndex].valor>4?' (barra truncada en 4x)':'')}}},scales:{x:{grid:{color:G},min:0,max:4,ticks:{callback:v=>v+'x'}},y:xOff}},plugins:[ratioLine]});
  const pl = SEG.plataforma; npsBar('rc-npspla', Object.keys(pl), Object.keys(pl).map(k => nps(pl[k])), true);
}

/* ---------- SENTIMIENTO ---------- */
$('r-hallazgos').innerHTML = A(D.hallazgosSent).map((h, i) => tarjeta(h, CLS4[i % 4])).join('');
function rSent(k){
  const s = k === 'general' ? {'General': SEG.general} : SEG[k]; const labels = Object.keys(s);
  if (k === 'general') {
    mk('rc-sent',{type:'doughnut',data:{labels:['Positivo','Neutro','Negativo','Polarizado'],datasets:[{data:SEG.general,backgroundColor:[C.su,C.ne,C.da,C.go],borderWidth:0,hoverOffset:6}]},options:{cutout:'58%',plugins:{legend:legB,tooltip:{callbacks:{label:c=>c.label+': '+c.raw+'%'}}}}});
  } else {
    mk('rc-sent',{type:'bar',data:{labels,datasets:['positivo','neutro','negativo','polarizado'].map((n,i)=>({label:n,data:labels.map(l=>s[l][i]),backgroundColor:SENT_COLOR[n],borderWidth:0}))},options:{indexAxis:'y',plugins:{legend:legB,tooltip:{callbacks:{label:c=>c.dataset.label+': '+c.raw+'%'}}},scales:{x:{...yPct,stacked:true,max:100},y:{...xOff,stacked:true}}}});
  }
  const segs = k === 'general' ? {...SEG.edad, ...SEG.genero} : s;
  npsBar('rc-sentnps', Object.keys(segs), Object.values(segs).map(nps));
}
let sentK = 'general', tomK = 'general';
window.radarUpdSent = function(btn, k){
  root.querySelectorAll('#rtab-sent .bb').forEach(b => b.classList.remove('act')); btn.classList.add('act'); sentK = k;
  const t = {general:'Sentimiento General',edad:'Sentimiento por Edad',genero:'Sentimiento por Género',partido:'Sentimiento por Partido',plataforma:'Sentimiento por Plataforma'};
  $('r-sent-t').textContent = t[k];
  $('r-sent-s').textContent = k === 'general' ? 'Distribución del tono en el periodo (%)' : 'Distribución del tono por segmento (%) · estimación modelada';
  $('r-nps-t').textContent = k === 'general' ? 'NPS-P por Edad y Género' : 'NPS-P por ' + t[k].replace('Sentimiento por ', '');
  rSent(k);
};

/* ---------- TOP OF MIND ---------- */
const PAL5 = [C.da,C.go,C.su,C.ac,'#7eb8f7'];
const palabras = A(O(D.nube).palabras);
const norm = (t) => S(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const TCOL = TOPICS.map(t => {
  const toks = norm(t).split(/[^a-z0-9ñ]+/).filter(w => w.length > 3);
  const m = palabras.find(p => toks.some(w => norm(p.w).includes(w)));
  return m ? (SENT_COLOR[m.s] || C.ac) : C.ac;
});
const tomMat = (o) => ({ g: A(O(o).grupos), d: A(O(o).valores) });
function rTom(k){
  if (k === 'general') { mk('rc-tom',{type:'bar',data:{labels:TOPICS,datasets:[{data:A(TOMD.general),backgroundColor:TCOL,borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+'%'}}},scales:{x:yPct,y:{grid:{display:false},ticks:{font:{size:10}}}}}}); return; }
  if (k === 'genero') { const g = O(TOMD.genero); mk('rc-tom',{type:'bar',data:{labels:TOPICS,datasets:[{label:'Mujeres',data:A(g.mujeres),backgroundColor:'rgba(230,57,70,.75)',borderRadius:2},{label:'Hombres',data:A(g.hombres),backgroundColor:C.bl,borderRadius:2}]},options:{indexAxis:'y',plugins:{legend:legB},scales:{x:{grid:{color:G},max:100,title:{display:true,text:'saliencia 0-100'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}}); return; }
  const d = tomMat(TOMD[k]); const isSal = k === 'edad';
  mk('rc-tom',{type:'bar',data:{labels:TOPICS,datasets:d.g.map((g,i)=>({label:g,data:d.d.map(r=>A(r)[i]),backgroundColor:PAL5[i%5],borderRadius:2}))},options:{indexAxis:'y',plugins:{legend:legB},scales:{x:isSal?{grid:{color:G},max:100,title:{display:true,text:'saliencia 0-100'}}:yPct,y:{grid:{display:false},ticks:{font:{size:9}}}}}});
}
window.radarUpdTom = function(btn, k){
  root.querySelectorAll('#rtab-tom .bb').forEach(b => b.classList.remove('act')); btn.classList.add('act'); tomK = k;
  const t = {general:'Top de Temas — General',edad:'Top of Mind por Edad',genero:'Top of Mind por Género',partido:'Top of Mind por Partido',plataforma:'Top of Mind por Plataforma'};
  const s = {general:'Peso de cada tema en la conversación del periodo (%)',edad:'Saliencia de cada tema por grupo de edad (0-100) · estimación',genero:'Saliencia de cada tema por género (0-100) · estimación',partido:'% de la conversación de cada identidad partidista dedicada a cada tema · estimación',plataforma:'% de la conversación de cada plataforma dedicada a cada tema'};
  $('r-tom-t').textContent = t[k]; $('r-tom-s').textContent = s[k]; rTom(k);
};
$('r-cruces').innerHTML = A(D.crucesTom).map((h, i) => tarjeta(h, ['go','ac','su','bl'][i % 4])).join('');

/* ---------- PICOS ---------- */
const unidad = esSemana ? 'DIARIA' : 'QUINCENAL';
$('r-tab-picos').textContent = esSemana ? 'PICOS DIARIOS' : 'PICOS QUINCENALES';
$('r-picos-t').textContent = `PICOS DE CONVERSACIÓN — LECTURA ${unidad}`;
$('r-picos-ct').innerHTML = `NPS-P ${esSemana ? 'Diario' : 'Quincenal'} Estimado <span class="ev">I</span>`;
$('r-picos-cs').textContent = `${Q.length} ${esSemana ? 'días' : 'quincenas'} · puntos rojos = picos negativos`;
const qMax = Q.reduce((m, q) => N(q.volumen) > N(m.volumen) ? q : m, Q[0] || {});
$('r-picvol-cs').textContent = `Índice 100 = ${esSemana ? 'día' : 'quincena'} de mayor conversación${qMax.rango ? ' (' + qMax.rango + ')' : ''}`;
$('r-crono-t').textContent = `CRONOLOGÍA INTERPRETADA POR ${esSemana ? 'DÍA' : 'QUINCENA'}`;
$('r-tl').innerHTML = Q.map(q => `<div class="tq ${esc(q.tono)}"><div class="tqd">${esc(q.codigo)} · ${esc(q.rango)}${q.ev ? `<br><span class="ev">${esc(q.ev)}</span>` : ''}</div><div class="tqn">${sg(N(q.nps))}</div><div><div class="tqt">${esc(q.titulo)}</div><div class="tqb">${S(q.texto)}</div></div></div>`).join('');
function rPicos(){
  const v = Q.map(q => N(q.nps));
  const lo = Math.max(-100, Math.floor((Math.min(0, ...v) - 10) / 10) * 10), hi = Math.min(100, Math.ceil((Math.max(0, ...v) + 10) / 10) * 10);
  mk('rc-picos',{type:'line',data:{labels:Q.map(q=>q.codigo),datasets:[{data:v,borderColor:C.ac,backgroundColor:'rgba(0,194,212,.08)',fill:'origin',tension:.35,borderWidth:2,pointRadius:v.map(x=>x<=-25?6:3),pointBackgroundColor:v.map(x=>x<=-25?C.da:x>=0?C.su:C.go)}]},options:{plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>Q[c[0].dataIndex].codigo+' · '+Q[c[0].dataIndex].rango,label:c=>'NPS-P '+sg(c.raw)+' · '+Q[c.dataIndex].titulo}}},scales:{y:{grid:{color:G},min:lo,max:hi,ticks:{callback:sg}},x:xOff}}});
  mk('rc-picvol',{type:'bar',data:{labels:Q.map(q=>q.codigo),datasets:[{data:Q.map(q=>N(q.volumen)),backgroundColor:Q.map(q=>q.tono==='neg'?C.da:q.tono==='pos'?C.su:C.go),borderRadius:2,borderWidth:0}]},options:{plugins:{legend:{display:false},tooltip:{callbacks:{title:c=>Q[c[0].dataIndex].rango,label:c=>'Índice '+c.raw}}},scales:{y:{grid:{color:G},min:0,max:100},x:xOff}}});
}

/* ---------- PLATAFORMAS ---------- */
const TIPO_COL = {vecinal:C.bl,propia:C.ac,instagram:C.go,tiktok:C.da,medio:C.ne};
$('r-lect').innerHTML = A(D.lecturaPlataformas).map(l => `<div class="ic ${esc(l.color)}"${l.color === 'ne' ? ' style="border-left:3px solid var(--ne)"' : ''}><div class="ih">${esc(l.titulo)}</div><div class="ib">${S(l.texto)}</div></div>`).join('');
function rPlat(){
  const Au = A(D.audiencia);
  mk('rc-plalc',{type:'bar',data:{labels:Au.map(a=>a.cuenta),datasets:[{data:Au.map(a=>N(a.miles)),backgroundColor:Au.map(a=>TIPO_COL[S(a.tipo).toLowerCase()]||C.ac),borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+' mil'}}},scales:{x:{grid:{color:G},ticks:{callback:v=>v+'K'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  const pl = SEG.plataforma; const L = Object.keys(pl);
  const mx = Math.max(60, Math.ceil(Math.max(0, ...L.map(l => Math.max(N(pl[l][0]), N(pl[l][2])))) / 10) * 10);
  mk('rc-pltono',{type:'bar',data:{labels:L,datasets:[{label:'% Positivo',data:L.map(l=>pl[l][0]),backgroundColor:C.su,borderRadius:2},{label:'% Negativo',data:L.map(l=>pl[l][2]),backgroundColor:C.da,borderRadius:2}]},options:{plugins:{legend:legB},scales:{y:{...yPct,max:Math.min(100,mx)},x:xOff}}});
  const E = A(D.plataformaEdad); const ag = ['18-24','25-34','35-44','45-59','60+'];
  mk('rc-pledad',{type:'bar',data:{labels:E.map(e=>e.plataforma),datasets:ag.map((a,i)=>({label:a,data:E.map(e=>A(e.valores)[i]),backgroundColor:['rgba(230,57,70,.75)',C.go,C.ac,C.su,C.ne][i],borderRadius:2}))},options:{plugins:{legend:legB},scales:{y:{...yPct,stacked:true,max:100},x:{...xOff,stacked:true}}}});
  const V = A(D.alcancePieza);
  mk('rc-plviral',{type:'bar',data:{labels:V.map(v=>v.metrica),datasets:[{label:'Pieza crítica',data:V.map(v=>N(v.critica)),backgroundColor:C.da,borderRadius:2},{label:'Pieza propia / favorable',data:V.map(v=>N(v.propia)),backgroundColor:C.su,borderRadius:2}]},options:{plugins:{legend:legB,tooltip:{callbacks:{label:c=>c.dataset.label+': '+(/÷\s*10/.test(S(V[c.dataIndex].metrica))?Math.round(c.raw*10)+' vistas':c.raw)}}},scales:{y:{grid:{color:G},min:0},x:xOff}}});
}

/* ---------- NUBE Y HASHTAGS ---------- */
function buildCloud(words){
  if (!words.length) return '<span style="color:var(--ne)">Sin términos suficientes en la muestra.</span>';
  const max = Math.max(...words.map(w => w.weight)), min = Math.min(...words.map(w => w.weight));
  const order = [...words].sort((a, b) => ((a.word.length * 7) % 11) - ((b.word.length * 7) % 11));
  return order.map(w => { const t = (w.weight - min) / ((max - min) || 1); const size = (12 + t * 30).toFixed(0); const color = SENT_COLOR[w.sentiment] || '#8FA3B1'; const fw = t > 0.6 ? 800 : t > 0.3 ? 700 : 500;
    return `<span style="font-size:${size}px;color:${color};font-weight:${fw};margin:4px 8px;display:inline-block" title="${esc(w.word)} · peso ${w.weight} · ${w.sentiment}">${esc(w.word)}</span>`; }).join(' ');
}
$('r-cloud').innerHTML = buildCloud(palabras.map(p => ({word:S(p.w), weight:N(p.v), sentiment:S(p.s)})));
const conLectura = (t) => t ? (/^\s*<strong>/.test(t) ? t : '<strong>Lectura:</strong> ' + t) : '';
$('r-cloud-lect').innerHTML = conLectura(S(O(D.nube).lectura));
const HASH = A(D.hashtags);
$('r-hashT').innerHTML = '<tr><th>HASHTAG</th><th>APAR.</th><th>TONO</th><th>PLATAFORMA</th><th>ORIGEN</th></tr>' + HASH.map(h => `<tr><td>${esc(h.tag)}</td><td class="n">${N(h.apariciones)}</td><td style="color:${SENT_COLOR[h.tono] || C.ne}">${esc(h.tono)}</td><td>${esc(h.plataforma)}</td><td>${esc(h.origen)}</td></tr>`).join('');
$('r-hash-lect').innerHTML = conLectura(S(D.hashtagsLectura));
function rNube(){ mk('rc-hash',{type:'bar',data:{labels:HASH.map(h=>h.tag),datasets:[{data:HASH.map(h=>N(h.apariciones)),backgroundColor:HASH.map(h=>SENT_COLOR[h.tono]||C.ne),borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+' apariciones'}}},scales:{x:{grid:{color:G},ticks:{stepSize:1}},y:{grid:{display:false},ticks:{font:{size:9}}}}}}); }

/* ---------- NARRATIVAS ---------- */
const TAGC = {genero:'bgen',edad:'bage',partido:'bpar',plataforma:'bpla',fuente:'bsrc'};
const NAR = O(D.narrativas);
const bivar = (t) => t ? (/^\s*<strong>/.test(t) ? t : '<strong>Bivariado:</strong> ' + t) : '';
const narItem = (n, biCls, crit) => {
  const alertaN = crit && (n.alerta === true || n.alerta === 'true');
  const tit = alertaN ? `<div class="nit" style="color:var(--da)">⚠ ${esc(S(n.titulo).replace(/^⚠\s*/, ''))}</div>` : `<div class="nit">${esc(n.titulo)}</div>`;
  return `<div class="ni">${tit}<div class="nd">${S(n.descripcion)}</div>${A(n.tags).map(t => `<span class="btag ${TAGC[S(t.tipo).toLowerCase()] || 'bsrc'}">${esc(t.texto)}</span>`).join('')}${n.bivariado ? `<div class="bi${biCls}">${bivar(S(n.bivariado))}</div>` : ''}</div>`;
};
$('r-nar-fav').innerHTML = A(NAR.favorables).map(n => narItem(n, '', false)).join('');
$('r-nar-crit').innerHTML = A(NAR.criticas).map(n => narItem(n, ' neg', true)).join('');
$('r-nar-neu').innerHTML = A(NAR.neutras).map(n => narItem(n, ' ntr', false)).join('');

/* ---------- RIESGOS ---------- */
const LV_R = {'CRÍTICO':'lc','ALTO':'la','MEDIO':'lm','BAJO':'lb'}, LV_O = {'ALTO':'lo','MEDIO':'lb','BAJO':'lb'};
const mr = (r, lv, neg) => `<div class="mr"><div class="mt"><span class="lv ${lv}">${esc(r.nivel)}</span><span class="mn">${esc(r.titulo)}</span></div><div class="md">${S(r.descripcion)}</div>${r.bivariado ? `<div class="bi${neg ? ' neg' : ''}">${bivar(S(r.bivariado))}</div>` : ''}</div>`;
$('r-riesgos').innerHTML = A(D.riesgos).map(r => mr(r, LV_R[r.nivel] || 'lm', true)).join('');
$('r-oport').innerHTML = A(D.oportunidades).map(r => mr(r, LV_O[r.nivel] || 'lb', false)).join('');
const AN = O(D.alertaNivel);
const COLN = {VERDE:'su', AMARILLA:'go', NARANJA:'go', ROJA:'da'};
const cN = COLN[color] || 'go';
$('r-alerta-box').className = 'ic ' + cN;
const txtA = S(AN.texto);
$('r-alerta-txt').innerHTML = /⚡/.test(txtA) ? txtA : `<strong style="color:var(--${cN})">⚡ NIVEL ${nivel} · ALERTA ${esc(color)}.</strong> ${txtA}`;
const NIV = ['Verde','Amarilla','Naranja','Roja'];
const arriba = NIV.slice(nivel);
const abajo = nivel > 1 ? NIV[nivel - 2] : '';
$('r-sube-t').textContent = '▲ Lo subiría' + (arriba.length ? ' a ' + arriba.join(' / ') : '');
$('r-baja-t').textContent = '▼ Lo bajaría' + (abajo ? ' a ' + abajo : '');
$('r-sube').innerHTML = A(AN.sube).map(x => `<li>${S(x)}</li>`).join('');
$('r-baja').innerHTML = A(AN.baja).map(x => `<li>${S(x)}</li>`).join('');

/* ---------- TERRITORIAL ---------- */
const TER = O(D.territorial);
const Z = A(TER.zonas);
const HZ = {favorable:['fav','🟢','FAVORABLE'], adversa:['adv','🔴','ADVERSA'], inercial:['ine','🟡','INERCIAL'], sin_datos:['nd','⚪','SIN DATOS']};
$('r-hm').innerHTML = Z.map(z => { const h = HZ[z.clasificacion] || HZ.inercial; return `<div class="hz ${h[0]}"><div class="hzn">${esc(z.nombre)}</div><div class="hzs">${z.nps === null || z.nps === undefined ? 'n/d' : sg(N(z.nps))}</div><div class="hzl">${h[1]} ${esc(S(z.etiqueta || h[2]).toUpperCase())}</div><div class="hzd">${esc(z.nota)}</div></div>`; }).join('');
$('r-ter-lect').innerHTML = conLectura(S(TER.lectura));
const ult = (t) => norm(t).split(/[^a-z0-9ñ]+/).filter(Boolean).pop() || '';
const zonaCol = (nom) => { const z = Z.find(x => norm(x.nombre).includes(norm(nom)) || norm(nom).includes(norm(x.nombre))) || Z.find(x => ult(x.nombre) && ult(x.nombre) === ult(nom)); const c = z ? z.clasificacion : ''; return c === 'adversa' ? C.da : c === 'favorable' ? C.su : c === 'inercial' ? C.go : C.ne; };
function rTer(){
  const T = Z.filter(z => z.nps !== null && z.nps !== undefined).map(z => [z.nombre, N(z.nps)]).sort((a, b) => b[1] - a[1]);
  npsBar('rc-ternps', T.map(t => t[0]), T.map(t => t[1]), true);
  if (CH['rc-ternps'] && T.length) { const v = T.map(t => t[1]); CH['rc-ternps'].options.scales.x.min = Math.max(-100, Math.floor((Math.min(0, ...v) - 10) / 10) * 10); CH['rc-ternps'].options.scales.x.max = Math.min(100, Math.ceil((Math.max(0, ...v) + 10) / 10) * 10); CH['rc-ternps'].update(); }
  const Vt = A(TER.volumen).slice().sort((a, b) => N(b.valor) - N(a.valor));
  const mx = Math.min(100, Math.max(40, Math.ceil(Math.max(0, ...Vt.map(v => N(v.valor))) / 10) * 10));
  mk('rc-tervol',{type:'bar',data:{labels:Vt.map(v=>v.zona),datasets:[{data:Vt.map(v=>N(v.valor)),backgroundColor:Vt.map(v=>zonaCol(v.zona)),borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.raw+'%'}}},scales:{x:{...yPct,max:mx},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
}

function rCharts(t){
  try {
    if (t === 'kpis') rKpis(); if (t === 'sent') rSent(sentK); if (t === 'tom') rTom(tomK);
    if (t === 'picos') rPicos(); if (t === 'plat') rPlat(); if (t === 'nube') rNube(); if (t === 'ter') rTer();
  } catch (e) { console.warn('radar', t, e); }
}
if (window.Chart) rCharts('kpis'); else window.addEventListener('load', () => rCharts('kpis'));
})();
