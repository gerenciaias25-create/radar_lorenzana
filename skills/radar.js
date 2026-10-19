(function(){
/* RADAR v2.1 · Análisis bivariado — estructura RADAR Naucalpan (11 pestañas, sin Conclusión).
   Lee window.DATA (lo llena el servidor). Cada sección se dibuja aislada:
   si un bloque viene vacío o con error, las demás pestañas siguen funcionando. */
const D = (window.DATA && typeof window.DATA === 'object') ? window.DATA : {};
const META = window.DATA_META || {};
const root = document.getElementById('radar-root');
if (!root) return;
const $ = (id) => document.getElementById(id);
const A = (v) => Array.isArray(v) ? v : [];
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const S = (v) => (v === undefined || v === null) ? '' : String(v);
const N = (v) => { if (typeof v === 'number') return Number.isFinite(v) ? v : 0; const m = S(v).replace(/[−–]/g, '-').match(/[+-]?\d+(\.\d+)?/); return m ? Number(m[0]) : 0; };
const esc = (v) => S(v).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Texto del modelo: admite <strong>/<b>/<br> y convierte [V] [E] [H] en las etiquetas de evidencia.
const H = (v) => S(v).replace(/\s?\[(V|E|H)\]/g, (m, x) => ' <span class="sv ' + x.toLowerCase() + '">' + x + '</span>');
const put = (id, html) => { const e = $(id); if (e) e.innerHTML = html; };
const vacio = (t) => '<div class="sindatos">' + esc(t || 'Sin datos suficientes en el periodo.') + '</div>';
function seccion(nombre, fn) { try { fn(); } catch (e) { console.warn('[RADAR] sección ' + nombre + ':', e); } }

const C = {ac:'#00C2D4',go:'#F4C430',da:'#E63946',su:'#2EC4B6',ne:'#8FA3B1',bl:'#1B4F8A',or:'#E67E22',lb:'#7eb8f7'};
const EXTRA = {osc:'#AA0000', muj:'rgba(230,57,70,.7)', da75:'rgba(230,57,70,.75)', gris:'rgba(143,163,177,.5)'};
const SENT_COLOR = {positivo:'#2EC4B6',negativo:'#E63946',neutro:'#8FA3B1',polarizado:'#F4C430'};
const TONO_TEMA = {positivo:C.su,negativo:C.da,neutro:C.ne,polarizado:C.go,propuesta:C.ac};
if (window.Chart) { Chart.defaults.color = '#334155'; Chart.defaults.font.family = 'system-ui,sans-serif'; Chart.defaults.font.size = 12; Chart.defaults.maintainAspectRatio = true; Chart.defaults.borderColor = 'rgba(0,0,0,0.1)'; }
const G = 'rgba(28,39,56,.12)';
const sgn = v => (v > 0 ? '+' : '') + v;
const sgnU = v => (v > 0 ? '+' + v : v < 0 ? '−' + Math.abs(v) : '0');
const CH = {};
function mk(id, cfg) {
  if (!window.Chart) return;
  if (CH[id]) CH[id].destroy();
  const c = $(id); if (!c) return;
  const tiene = A(cfg.data && cfg.data.datasets).some(d => A(d.data).some(v => v !== null && v !== 0 && v !== undefined));
  const prev = c.previousElementSibling;
  if (prev && prev.classList.contains('sindatos')) prev.remove();
  if (!tiene) { c.style.display = 'none'; c.insertAdjacentHTML('beforebegin', vacio('Sin datos para esta gráfica en el periodo.')); return; }
  c.style.display = '';
  CH[id] = new Chart(c, cfg);
}

/* ---------- Colores por grupo (mismo color para el mismo grupo en todas las gráficas) ---------- */
const clave = (t) => S(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+]/g, '');
const resolver = (c) => { const x = S(c).trim(); if (!x) return ''; if (C[x]) return C[x]; if (EXTRA[x]) return EXTRA[x]; if (/^(#|rgb)/i.test(x)) return x; return ''; };
const PLAT = (n) => { const k = clave(n); if (/facebook|^fb/.test(k)) return C.ac; if (/whats/.test(k)) return C.su; if (/insta/.test(k)) return C.go; if (/tiktok/.test(k)) return C.da; if (/youtube|video/.test(k)) return C.ne; if (/^x$|twitter|^x\W?|xtwitter/.test(k)) return C.bl; if (/medio|prensa|portal|digital/.test(k)) return C.or; return ''; };
const GEN = (n) => { const k = clave(n); if (/hombre|mascul/.test(k)) return C.bl; if (/mujer|femen/.test(k)) return EXTRA.muj; return ''; };
const REG = {};
const reg = (n, c) => { const k = clave(n); if (k && c && !REG[k]) REG[k] = c; };
const colorDe = (n, i, pal) => resolver(O(n).c) || REG[clave(typeof n === 'object' ? (n.grupo || n.nombre) : n)] || GEN(typeof n === 'object' ? n.grupo : n) || pal[i % pal.length];
const PAL_PART = [C.su, C.da, C.ac, C.go, EXTRA.osc, C.bl, C.or, C.lb];
const PAL_EDAD = [C.da, C.go, C.su, C.ac, C.bl, C.ne];
const PAL_AUD = [C.su, C.go, C.da, C.ac, C.bl, C.ne];
const PAL_GEN = [C.ac, C.go, C.su, C.da, C.bl, C.ne];

const meta = O(D.meta);
const nombre = S(meta.nombre || META.actor || 'Actor').trim();
const nombreCorto = S(meta.nombreCorto) || nombre.split(/\s+/).slice(0, 2).join(' ');
const corto = S(meta.corto) || (nombre.split(/\s+/).length >= 3 ? nombre.split(/\s+/).slice(-2, -1)[0] : nombre.split(/\s+/).slice(-1)[0]);
const territorio = S(meta.territorio || META.territorio);
const NIVELES = {1:['VERDE','#22c55e','🟢','ESTABLE'], 2:['AMARILLA','#eab308','🟡','AMARILLA'], 3:['NARANJA','#E67E22','🟠','NARANJA'], 4:['ROJA','#E63946','🔴','ROJA']};
const nivel = Math.max(1, Math.min(4, Math.round(N(meta.nivel)) || 2));

/* ---------- ENCABEZADO ---------- */
seccion('encabezado', () => {
  const nv = NIVELES[nivel];
  root.style.setProperty('--al', nv[1]);
  const alerta = S(meta.alerta || nv[0]).toUpperCase();
  const linea2 = [corto, territorio, meta.ventana || META.periodo].filter(Boolean).map(x => esc(S(x).toUpperCase())).join(' · ');
  put('r-meta', '<span class="pulse"></span><span style="color:var(--al)">NIVEL ' + nivel + ' · ALERTA ' + esc(alerta) + '</span> · BIVARIADO ACTIVO<br>' + linea2);
  const res = clave(meta.resaltado || corto);
  put('r-nombre', nombre.split(/\s+/).map(p => clave(p) === res ? '<span>' + esc(p.toUpperCase()) + '</span>' : esc(p.toUpperCase())).join(' '));
  put('r-sub', esc(meta.subtitulo || [meta.cargo, territorio, meta.ventana].filter(Boolean).join(' · ')));
  put('r-foot', ['RADAR', esc(S(meta.territorioLargo || territorio).toUpperCase()), 'ESTUDIO CONFIDENCIAL'].filter(Boolean).join(' · '));
});

/* ---------- Registro de colores por grupo ---------- */
seccion('colores', () => {
  const sent = O(D.sentimiento);
  A(sent.genero).forEach((s, i) => reg(s.grupo, resolver(s.c) || GEN(s.grupo) || [C.bl, EXTRA.muj][i % 2]));
  A(sent.edad).forEach((s, i) => reg(s.grupo, resolver(s.c) || PAL_EDAD[i % PAL_EDAD.length]));
  A(sent.partido).forEach((s, i) => reg(s.grupo, resolver(s.c) || PAL_PART[i % PAL_PART.length]));
  A(sent.plataforma).forEach((s, i) => reg(s.grupo, resolver(s.c) || PLAT(s.grupo) || PAL_GEN[i % PAL_GEN.length]));
  A(sent.audiencia).forEach((s, i) => reg(s.grupo, resolver(s.c) || PAL_AUD[i % PAL_AUD.length]));
});

const tarjetas = (lista, pal) => A(lista).map((h, i) => {
  const col = ['ac','go','su','bl','da','or'].includes(h.color) ? h.color : pal[i % pal.length];
  return '<div class="ic ' + col + '"><div class="ih">' + esc(h.titulo) + '</div><div class="ib">' + H(h.texto) + '</div>' + (S(h.accion) ? '<div class="im">→ ' + H(h.accion) + '</div>' : '') + '</div>';
}).join('');

/* ---------- KPIs bivariados ---------- */
const barNps = (id, labels, data, opts = {}) => mk(id, {type:'bar', data:{labels, datasets:[{data, backgroundColor:data.map(v => v >= 15 ? C.su : v >= 0 ? C.go : v > -20 ? C.da : '#AA0000'), borderRadius:2, borderWidth:0}]}, options:{indexAxis:opts.h ? 'y' : 'x', responsive:true, plugins:{legend:{display:false}}, scales:{[opts.h ? 'x' : 'y']:{grid:{color:G}, ticks:{callback:sgn}}, [opts.h ? 'y' : 'x']:{grid:{display:false}, ticks:{font:{size:9}}}}}});
const pares = (v) => A(v).map(p => Array.isArray(p) ? [S(p[0]), N(p[1])] : [S(O(p).etiqueta || O(p).label || O(p).grupo || O(p).plataforma), N(O(p).valor)]).filter(p => p[0]);
function rKpis() {
  const np = O(D.npsPartido), nd = O(D.npsDemo);
  put('r-npspar-s', esc(np.sub || ('El apoyo real según afinidad política del electorado' + (meta.gentilicio ? ' ' + meta.gentilicio : territorio ? ' de ' + territorio : ''))));
  put('r-npsdemo-s', esc(nd.sub || 'Brecha demográfica por edad y género'));
  const p1 = pares(np.datos); barNps('r-c-npspar', p1.map(x => x[0]), p1.map(x => x[1]));
  const p2 = pares(nd.datos); barNps('r-c-npsdemo', p2.map(x => x[0]), p2.map(x => x[1]));
  const r = pares(D.ratioPlataforma);
  mk('r-c-ratiopl', {type:'bar', data:{labels:r.map(x => x[0]), datasets:[{data:r.map(x => x[1]), backgroundColor:r.map(x => x[1] >= 1.6 ? C.da : x[1] >= 1.3 ? C.or : x[1] >= 1 ? C.go : C.su), borderRadius:2, borderWidth:0}]}, options:{indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{grid:{color:G}, ticks:{callback:v => v + 'x'}}, y:{grid:{display:false}, ticks:{font:{size:9}}}}}});
  const t = O(D.tra);
  put('r-tra-t', esc(t.titulo || 'TRA — Evolución' + (meta.ventana ? ' (' + meta.ventana + ')' : '')));
  mk('r-c-tra', {type:'line', data:{labels:A(t.labels).map(S), datasets:[{label:'TRA', data:A(t.valores).map(N), borderColor:C.ac, backgroundColor:'rgba(0,194,212,.07)', fill:true, tension:.4, borderWidth:2, pointRadius:3}]}, options:{responsive:true, plugins:{legend:{display:false}}, scales:{y:{grid:{color:G}, ticks:{callback:sgn}}, x:{grid:{display:false}, ticks:{font:{size:8}}}}}});
}

/* ---------- Sentimiento ---------- */
const SENT_T = {general:'Sentimiento General', genero:'Sentimiento por Género', edad:'Sentimiento por Edad', partido:'Sentimiento por Partido', plataforma:'Sentimiento por Plataforma', audiencia:'Sentimiento por Audiencia'};
const PAL_DIM = {genero:[C.bl, EXTRA.muj], edad:PAL_EDAD, partido:PAL_PART, plataforma:PAL_GEN, audiencia:PAL_AUD};
function rSent(k) {
  const sent = O(D.sentimiento);
  if (k === 'general') {
    const g = A(sent.general).map(N);
    const l = ['Positivo', 'Neutro/Inercial', 'Negativo', 'Polarizado'].slice(0, Math.max(3, g.length));
    mk('r-c-sent', {type:'doughnut', data:{labels:l, datasets:[{data:g, backgroundColor:[C.su, C.ne, C.da, C.go], borderWidth:0, hoverOffset:6}]}, options:{responsive:true, cutout:'58%', plugins:{legend:{position:'bottom', labels:{font:{size:9}, padding:8}}}}});
  } else {
    const ss = A(sent[k]).filter(s => s && s.grupo);
    const n = Math.max(0, ...ss.map(s => A(s.valores).length));
    const l = n >= 4 ? ['Positivo', 'Neutro', 'Negativo', 'Polarizado'] : ['Positivo', 'Neutro', 'Negativo'];
    mk('r-c-sent', {type:'bar', data:{labels:l, datasets:ss.map((s, i) => ({label:S(s.grupo), data:A(s.valores).map(N).slice(0, l.length), backgroundColor:colorDe(s, i, PAL_DIM[k] || PAL_GEN), borderRadius:2}))}, options:{responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{y:{max:100, grid:{color:G}, ticks:{callback:v => v + '%'}}, x:{grid:{display:false}}}}});
  }
  const cl = pares(O(D.clima)[k]);
  const cols = k === 'general' ? cl.map((x, i) => [C.su, C.go, C.da, C.ne][i % 4]) : cl.map((x, i) => colorDe(x[0], i, PAL_DIM[k] || PAL_GEN));
  mk('r-c-clima', {type:'bar', data:{labels:cl.map(x => x[0]), datasets:[{data:cl.map(x => x[1]), backgroundColor:cols, borderRadius:2, borderWidth:0}]}, options:{responsive:true, plugins:{legend:{display:false}}, scales:{y:{max:100, grid:{color:G}, ticks:{callback:v => v + '%'}}, x:{grid:{display:false}, ticks:{font:{size:9}}}}}});
  put('r-sent-t', SENT_T[k]);
}
window.radarUpdSent = function (btn, k) { root.querySelectorAll('#rtab-sent .bb').forEach(b => b.classList.remove('act')); btn.classList.add('act'); seccion('sentimiento', () => rSent(k)); };

/* ---------- Top of Mind ---------- */
const TOM_T = {general:['Top de Temas — General', '¿Qué domina la conversación sobre ' + nombreCorto + '? (%)'], genero:['Top of Mind × Género', 'Agenda diferenciada por género'], edad:['Top of Mind × Edad', 'Saliencia de los temas por generación'], partido:['Top of Mind × Partido', 'Cada segmento lee un actor distinto']};
function rTom(k) {
  const t = O(O(D.tom)[k]);
  if (k === 'general') {
    const tm = A(t.temas).filter(x => x && (x.tema || x.nombre));
    mk('r-c-tom', {type:'bar', data:{labels:tm.map(x => S(x.tema || x.nombre)), datasets:[{data:tm.map(x => N(x.valor)), backgroundColor:tm.map((x, i) => resolver(x.c) || TONO_TEMA[S(x.tono).toLowerCase()] || C.ne), borderRadius:2, borderWidth:0}]}, options:{indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{grid:{color:G}, ticks:{callback:v => v + '%'}}, y:{grid:{display:false}, ticks:{font:{size:10}}}}}});
  } else {
    const ss = A(t.series).filter(s => s && s.grupo);
    mk('r-c-tom', {type:'bar', data:{labels:A(t.temas).map(S), datasets:ss.map((s, i) => ({label:S(s.grupo), data:A(s.valores).map(N), backgroundColor:colorDe(s, i, PAL_DIM[k] || PAL_GEN), borderRadius:2}))}, options:{indexAxis:'y', responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{x:{grid:{color:G}, ticks:{callback:v => v + '%'}}, y:{grid:{display:false}, ticks:{font:{size:9}}}}}});
  }
  $('r-tom-t').textContent = S(t.titulo) || TOM_T[k][0];
  $('r-tom-s').textContent = S(t.sub) || TOM_T[k][1];
}
window.radarUpdTom = function (btn, k) { root.querySelectorAll('#rtab-tom .bb').forEach(b => b.classList.remove('act')); btn.classList.add('act'); seccion('tom', () => rTom(k)); };

/* ---------- Picos ---------- */
function rPic() {
  const pk = A(D.picos).filter(p => p && typeof p === 'object');
  const labels = pk.map(p => S(p.label || p.fecha));
  mk('r-c-picos', {type:'bar', data:{labels, datasets:[
    {type:'bar', label:'Volumen (índice)', data:pk.map(p => N(p.volumen)), backgroundColor:pk.map(p => /neg/i.test(p.pico) ? 'rgba(230,57,70,.7)' : /alto|pos|max|si|true/i.test(S(p.pico)) ? 'rgba(0,194,212,.75)' : 'rgba(0,194,212,.3)'), borderRadius:2, yAxisID:'y'},
    {type:'line', label:'NPS-P', data:pk.map(p => N(p.nps)), borderColor:C.go, backgroundColor:C.go, tension:.35, pointRadius:3, yAxisID:'y1'}
  ]}, options:{responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{y:{position:'left', max:110, grid:{color:G}, title:{display:true, text:'Volumen', font:{size:9}}}, y1:{position:'right', grid:{display:false}, ticks:{callback:sgn}, title:{display:true, text:'NPS-P', font:{size:9}}}, x:{grid:{display:false}, ticks:{font:{size:8}}}}}});
}

/* ---------- Plataformas ---------- */
function rPlat() {
  const P = O(D.plataformas);
  const peso = A(P.peso).filter(x => x && x.plataforma);
  mk('r-c-plalc', {type:'doughnut', data:{labels:peso.map(x => S(x.plataforma)), datasets:[{data:peso.map(x => N(x.valor)), backgroundColor:peso.map((x, i) => resolver(x.c) || PLAT(x.plataforma) || PAL_GEN[i % 6]), borderWidth:0, hoverOffset:6}]}, options:{responsive:true, cutout:'55%', plugins:{legend:{position:'bottom', labels:{font:{size:9}, padding:8}}}}});
  const to = A(P.tono).filter(x => x && x.plataforma);
  const pct = {responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{y:{stacked:true, max:100, grid:{color:G}, ticks:{callback:v => v + '%'}}, x:{stacked:true, grid:{display:false}, ticks:{font:{size:9}}}}};
  mk('r-c-pltono', {type:'bar', data:{labels:to.map(x => S(x.plataforma)), datasets:[{label:'% Positivo', data:to.map(x => N(x.pos)), backgroundColor:C.su, borderRadius:2}, {label:'% Neutro', data:to.map(x => N(x.neu)), backgroundColor:C.ne, borderRadius:2}, {label:'% Negativo', data:to.map(x => N(x.neg)), backgroundColor:C.da, borderRadius:2}]}, options:pct});
  put('r-pledad-s', 'Composición etaria de la audiencia por canal' + (territorio ? ' (' + esc(territorio) + ')' : ''));
  const ed = A(P.edad).filter(x => x && x.plataforma);
  const grupos = A(P.edadGrupos).length ? A(P.edadGrupos).map(S) : ['18-29', '30-44', '45-59', '60+'];
  const colE = [EXTRA.da75, C.go, C.su, C.ne, C.ac, C.bl];
  mk('r-c-pledad', {type:'bar', data:{labels:ed.map(x => S(x.plataforma)), datasets:grupos.map((g, j) => ({label:g, data:ed.map(x => N(A(x.valores)[j])), backgroundColor:colE[j % colE.length], borderRadius:2}))}, options:pct});
  const br = A(P.brecha).filter(x => x && x.plataforma);
  mk('r-c-plgap', {type:'radar', data:{labels:br.map(x => S(x.plataforma)), datasets:[{label:'Presencia actual', data:br.map(x => N(x.actual)), backgroundColor:'rgba(230,57,70,.15)', borderColor:C.da, pointBackgroundColor:C.da}, {label:'Nivel requerido', data:br.map(x => N(x.requerido)), backgroundColor:'rgba(0,194,212,.08)', borderColor:C.ac, pointBackgroundColor:C.ac}]}, options:{responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{r:{min:0, max:100, ticks:{display:false}, grid:{color:'rgba(28,39,56,.15)'}, angleLines:{color:'rgba(28,39,56,.12)'}, pointLabels:{color:'#334155', font:{size:9}}}}}});
  const vi = A(P.viral).filter(x => x && x.plataforma);
  mk('r-c-plviral', {type:'bar', data:{labels:vi.map(x => S(x.plataforma)), datasets:[{label:'Crítica (h)', data:vi.map(x => N(x.critica)), backgroundColor:C.da, borderRadius:2}, {label:'Propia (h)', data:vi.map(x => N(x.propia)), backgroundColor:C.su, borderRadius:2}]}, options:{indexAxis:'y', responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{x:{grid:{color:G}, ticks:{callback:v => v + 'h'}}, y:{grid:{display:false}, ticks:{font:{size:9}}}}}});
  put('r-plpar-s', '¿Qué segmento partidista habla de ' + esc(corto) + ' en cada canal?');
  const pp = O(P.partido);
  mk('r-c-plpar', {type:'bar', data:{labels:A(pp.plataformas).map(S), datasets:A(pp.series).filter(s => s && s.grupo).map((s, i) => ({label:S(s.grupo), data:A(s.valores).map(N), backgroundColor:colorDe(s, i, PAL_PART), borderRadius:2}))}, options:pct});
}

/* ---------- Nube ---------- */
function buildCloud(words) {
  if (!words.length) return vacio('Sin palabras suficientes para la nube en el periodo.');
  const max = Math.max(...words.map(w => w.weight)); const min = Math.min(...words.map(w => w.weight));
  const shuffled = [...words].sort((a, b) => ((a.word.length * 7 + a.weight) % 11) - ((b.word.length * 7 + b.weight) % 11));
  return shuffled.map(w => { const t = (w.weight - min) / ((max - min) || 1); const size = (12 + t * 30).toFixed(0); const color = SENT_COLOR[w.sentiment] || '#8FA3B1'; const fw = t > 0.6 ? 800 : t > 0.3 ? 700 : 500;
    return `<span style="font-size:${size}px;color:${color};font-weight:${fw};margin:4px 8px;display:inline-block" title="${esc(w.word)} · peso ${w.weight} · ${w.sentiment}">${esc(w.word)}</span>`; }).join(' ');
}
function rNube() {
  const nb = O(D.nube);
  put('r-cloud', buildCloud(A(nb.palabras).filter(p => p && (p.w || p.word)).map(p => ({word:S(p.w || p.word), weight:N(p.v ?? p.weight), sentiment:S(p.s || p.sentiment).toLowerCase()}))));
  const HS = A(D.hashtags).filter(x => x && x.tag);
  mk('r-c-hash', {type:'bar', data:{labels:HS.map(x => S(x.tag)), datasets:[{data:HS.map(x => N(x.indice)), backgroundColor:HS.map(x => SENT_COLOR[S(x.tono).toLowerCase()] || C.ne), borderRadius:2, borderWidth:0}]}, options:{indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{max:100, grid:{color:G}}, y:{grid:{display:false}, ticks:{font:{size:9}}}}}});
  put('r-hash-tb', HS.map(x => `<tr><td>${esc(x.tag)}</td><td class="c">${N(x.indice)}</td><td style="color:${SENT_COLOR[S(x.tono).toLowerCase()] || C.ne}">${esc(x.tono)}</td><td>${esc(x.plataforma)}</td><td>${esc(x.impulso)}</td></tr>`).join('') || '<tr><td colspan="5">Sin hashtags relevantes en el periodo.</td></tr>');
}

/* ---------- Cruces ---------- */
function heat(v, neg) {
  if (neg) { const a = Math.min(Math.abs(v) / 35, 1); return v >= 0 ? `rgba(46,196,182,${.12 + a * .5})` : `rgba(230,57,70,${.12 + a * .5})`; }
  const a = v / 100; return `rgba(0,194,212,${.06 + a * .55})`;
}
function rCruz() {
  const cz = O(D.cruces);
  const pctOpts = {responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{y:{max:100, grid:{color:G}, ticks:{callback:v => v + '%'}}, x:{grid:{display:false}, ticks:{font:{size:9}}}}};
  const pd = O(cz.partidoEdad);
  put('r-paredad-s', esc(pd.sub || '¿La fractura partidista es generacional?'));
  mk('r-c-paredad', {type:'bar', data:{labels:A(pd.grupos).map(S), datasets:A(pd.series).filter(s => s && s.grupo).map((s, i) => ({label:S(s.grupo), data:A(s.valores).map(N), backgroundColor:colorDe(s, i, PAL_PART), borderRadius:2}))}, options:{responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{y:{grid:{color:G}, ticks:{callback:sgn}}, x:{grid:{display:false}}}}});
  const zg = O(cz.zonaGenero);
  mk('r-c-zongen', {type:'bar', data:{labels:A(zg.zonas).map(S), datasets:[{label:'Hombres', data:A(zg.hombres).map(N), backgroundColor:C.bl, borderRadius:2}, {label:'Mujeres', data:A(zg.mujeres).map(N), backgroundColor:EXTRA.muj, borderRadius:2}]}, options:pctOpts});
  const it = O(cz.interna);
  put('r-interna-t', esc(it.titulo || 'Preferencia entre aspirantes × Segmento'));
  put('r-interna-s', esc(it.sub || 'Preferencia relativa entre aspirantes por tipo de votante'));
  const PAL_INT = [C.ac, C.go, C.lb, C.su, C.da, C.bl];
  let ci = 0;
  mk('r-c-interna', {type:'bar', data:{labels:A(it.segmentos).map(S), datasets:A(it.series).filter(s => s && (s.nombre || s.grupo)).map(s => ({label:S(s.nombre || s.grupo), data:A(s.valores).map(N), backgroundColor:resolver(s.c) || (/^(ns|nc|otro|ninguno|indecis)/i.test(S(s.nombre || s.grupo)) ? EXTRA.gris : PAL_INT[ci++ % PAL_INT.length]), borderRadius:2}))}, options:{responsive:true, plugins:{legend:{position:'bottom', labels:{font:{size:9}}}}, scales:{y:{stacked:true, max:100, grid:{color:G}, ticks:{callback:v => v + '%'}}, x:{stacked:true, grid:{display:false}, ticks:{font:{size:9}}}}}});
  const tt = O(cz.temaTono);
  put('r-tematono-s', '% positivo vs. negativo cuando ' + esc(corto) + ' aparece asociado a cada tema');
  mk('r-c-tematono', {type:'bar', data:{labels:A(tt.temas).map(S), datasets:[{label:'% Positivo', data:A(tt.positivo).map(N), backgroundColor:C.su, borderRadius:2}, {label:'% Negativo', data:A(tt.negativo).map(N), backgroundColor:C.da, borderRadius:2}]}, options:pctOpts});
}

/* ---------- Territorial ---------- */
function rTer() {
  const T = O(D.territorial);
  const zs = A(T.zonas).filter(z => z && z.nombre && z.nps !== null && z.nps !== undefined).slice().sort((a, b) => N(b.nps) - N(a.nps));
  barNps('r-c-ternps', zs.map(z => S(z.nombre)), zs.map(z => N(z.nps)), {h:true});
  const clase = {}; A(T.zonas).forEach(z => { clase[clave(z.nombre)] = z; });
  const vol = A(T.volumen).filter(v => v && v.zona).slice().sort((a, b) => N(b.valor) - N(a.valor));
  mk('r-c-tervol', {type:'bar', data:{labels:vol.map(v => S(v.zona)), datasets:[{data:vol.map(v => N(v.valor)), backgroundColor:vol.map(v => { const z = clase[clave(v.zona)]; if (!z) return C.ne; return z.clase === 'favorable' ? C.su : z.clase === 'adversa' ? C.da : N(z.nps) > 0 ? C.go : C.ne; }), borderRadius:2, borderWidth:0}]}, options:{indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{grid:{color:G}, ticks:{callback:v => v + '%'}}, y:{grid:{display:false}, ticks:{font:{size:9}}}}}});
}

function rCharts(t) {
  seccion('graficas ' + t, () => {
    if (t === 'kpis') rKpis();
    if (t === 'sent') rSent('general');
    if (t === 'tom') rTom('general');
    if (t === 'pic') rPic();
    if (t === 'plat') rPlat();
    if (t === 'nube') rNube();
    if (t === 'cruz') rCruz();
    if (t === 'ter') rTer();
  });
  if (t === 'sent') root.querySelectorAll('#rtab-sent .bb').forEach((b, i) => b.classList.toggle('act', i === 0));
  if (t === 'tom') root.querySelectorAll('#rtab-tom .bb').forEach((b, i) => b.classList.toggle('act', i === 0));
}
window.radarTab = function (btn, id) {
  root.querySelectorAll('.tsec').forEach(s => s.classList.remove('show'));
  root.querySelectorAll('.tb').forEach(t => t.classList.remove('act'));
  const t = $('rtab-' + id); if (t) t.classList.add('show');
  btn.classList.add('act');
  setTimeout(() => rCharts(id), 60);
};

/* ======================= CONTENIDO DE TEXTO (se dibuja una vez) ======================= */
seccion('hallazgos sentimiento', () => put('r-hsent', tarjetas(D.hallazgosSent, ['ac', 'go', 'su', 'bl']) || vacio()));
seccion('cruces tom', () => put('r-ctom', tarjetas(D.crucesTom, ['ac', 'go', 'da', 'bl']) || vacio()));
seccion('cronologia', () => put('r-crono', A(D.cronologia).filter(e => e && (e.titulo || e.texto)).map(e => {
  const tono = ['pos', 'neg', 'mix'].includes(e.tono) ? e.tono : /neg/i.test(e.tono) ? 'neg' : /pos/i.test(e.tono) ? 'pos' : 'mix';
  const ev = /^[VEH]$/i.test(S(e.ev)) ? ' <span class="sv ' + S(e.ev).toLowerCase() + '">' + S(e.ev).toUpperCase() + '</span>' : '';
  return '<div class="te ' + tono + '"><div class="td">' + esc(S(e.fecha).toUpperCase()) + ev + '</div><div class="tt">' + esc(e.titulo) + '</div><div class="tx">' + H(e.texto) + '</div></div>';
}).join('') || vacio('Sin eventos fechados en el periodo.')));
seccion('lectura plataformas', () => put('r-plect', A(D.plataformas && D.plataformas.lectura).filter(x => x && (x.titulo || x.texto)).map(x => x.alerta
  ? '<div class="mc" style="border-top:3px solid var(--da)"><div class="mn2" style="color:var(--da)">' + esc(x.titulo) + '</div><div class="md2">' + H(x.texto) + '</div></div>'
  : '<div class="mc"><div class="mn2">' + esc(x.titulo) + '</div><div class="md2">' + H(x.texto) + '</div></div>').join('') || vacio()));
seccion('nube lectura', () => { const nb = O(D.nube); put('r-nube-lect', H(nb.lectura) || 'Sin lectura semántica.'); put('r-hash-res', H(D.hashtagResumen) || 'Sin hashtag dominante en el periodo.'); });

const TAGC = {edad:'bage', zona:'bloc', territorio:'bloc', partido:'bpar', genero:'bgen', audiencia:'bgen', fuente:'bsrc', plataforma:'bsrc', medio:'bsrc'};
const narHtml = (lista, tipo) => A(lista).filter(n => n && n.titulo).map(n => {
  const ev = /^[VEH]$/i.test(S(n.ev)) ? ' <span class="sv ' + S(n.ev).toLowerCase() + '">' + S(n.ev).toUpperCase() + '</span>' : '';
  const titulo = n.alerta && tipo === 'crit' ? '<div class="nit" style="color:var(--da)">⚠ ' + esc(n.titulo) + ev + '</div>' : '<div class="nit">' + esc(n.titulo) + ev + '</div>';
  const tags = A(n.tags).map(t => typeof t === 'string' ? {texto:t, tipo:''} : O(t)).filter(t => t.texto).map(t => '<span class="btag ' + (TAGC[clave(t.tipo)] || 'bgen') + '">' + esc(t.texto) + '</span>').join('');
  return '<div class="ni">' + titulo + '<div class="nd">' + H(n.descripcion) + '</div>' + tags + (S(n.bivariado) ? '<div class="bi' + (tipo === 'crit' ? ' neg' : tipo === 'neu' ? ' ntr' : '') + '"><strong>Bivariado:</strong> ' + H(n.bivariado) + '</div>' : '') + '</div>';
}).join('') || vacio('Sin narrativas de este tipo en el periodo.');
seccion('narrativas', () => { const nr = O(D.narrativas); put('r-nar-fav', narHtml(nr.favorables, 'fav')); put('r-nar-crit', narHtml(nr.criticas, 'crit')); put('r-nar-neu', narHtml(nr.neutras, 'neu')); });

seccion('matrices', () => {
  const cz = O(D.cruces), eg = O(cz.edadGenero), pn = O(cz.partidoNarrativa);
  const ge = A(eg.grupos).length ? A(eg.grupos).map(S) : ['18-29', '30-44', '45-59', '60+'];
  put('r-mx-eg-h', '<th>SEGMENTO</th>' + ge.map(g => '<th>' + esc(g.toUpperCase()) + '</th>').join(''));
  put('r-mx-eg', A(eg.filas).filter(f => f && f.segmento).map(r => `<tr><td>${esc(r.segmento)}</td>${A(r.valores).map(N).map(v => `<td class="c" style="background:${heat(v, true)}">${sgn(v)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="5">Sin datos.</td></tr>');
  put('r-mx-eg-l', S(eg.lectura) ? '<strong>Lectura:</strong> ' + H(eg.lectura) : '');
  const gp = A(pn.grupos).map(S);
  put('r-mx-pn-h', '<th>NARRATIVA</th>' + gp.map(g => '<th>' + esc(g.toUpperCase()) + '</th>').join(''));
  put('r-mx-pn', A(pn.filas).filter(f => f && f.narrativa).map(r => `<tr><td>${esc(r.narrativa)}</td>${A(r.valores).map(N).map(v => `<td class="c" style="background:${heat(v)}">${v}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="6">Sin datos.</td></tr>');
  put('r-hcruz', tarjetas(cz.hallazgos, ['or', 'su', 'ac', 'go']));
});

const LV_R = {'CRÍTICO':'lc', 'CRITICO':'lc', 'ALTO':'la', 'MEDIO':'lm', 'BAJO':'lb'};
const LV_O = {'MUY ALTA':'lo1', 'ALTA':'lo2', 'MEDIA':'lm', 'BAJA':'lb'};
const mrHtml = (lista, mapa, neg) => A(lista).filter(r => r && r.titulo).map(r => {
  const nv = S(r.nivel).toUpperCase().trim();
  return '<div class="mr"><div class="mt"><span class="lv ' + (mapa[nv] || 'lm') + '">' + esc(nv || 'MEDIO') + '</span><span class="mn">' + esc(r.titulo) + '</span></div><div class="md">' + H(r.descripcion) + '</div>' + (S(r.bivariado) ? '<div class="bi' + (neg ? ' neg' : '') + '"><strong>Bivariado:</strong> ' + H(r.bivariado) + '</div>' : '') + '</div>';
}).join('') || vacio();
seccion('riesgos', () => {
  put('r-riesgos', mrHtml(D.riesgos, LV_R, true));
  put('r-oport', mrHtml(D.oportunidades, LV_O, false));
  const up = NIVELES[Math.min(4, nivel + 1)], dn = NIVELES[Math.max(1, nivel - 1)];
  put('r-sube-t', nivel >= 4 ? '▲ SEÑALES QUE AGRAVARÍAN LA ALERTA 🔴 ROJA' : '▲ SEÑALES QUE SUBIRÍAN A ' + up[2] + ' ' + up[3]);
  put('r-baja-t', nivel <= 1 ? '▼ SEÑALES QUE CONSOLIDARÍAN 🟢 ESTABLE' : '▼ SEÑALES QUE BAJARÍAN A ' + dn[2] + ' ' + dn[3]);
  put('r-sube', A(D.alertaSube).map(x => '<li>' + H(x) + '</li>').join('') || '<li>Sin señales identificadas.</li>');
  put('r-baja', A(D.alertaBaja).map(x => '<li>' + H(x) + '</li>').join('') || '<li>Sin señales identificadas.</li>');
});

seccion('territorial', () => {
  const T = O(D.territorial);
  const EMO = {favorable:['fav', '🟢'], inercial:['ine', '🟡'], adversa:['adv', '🔴']};
  put('r-hm', A(T.zonas).filter(z => z && z.nombre).map(z => {
    const cl = EMO[z.clase] || EMO.inercial;
    const sinDato = z.nps === null || z.nps === undefined || z.nps === '';
    return '<div class="hz ' + cl[0] + '"><div class="hzn">' + esc(z.nombre) + '</div><div class="hzs">' + (sinDato ? 'n/d' : sgnU(N(z.nps))) + '</div><div class="hzl">' + cl[1] + ' ' + esc(S(z.etiqueta || z.clase).toUpperCase()) + '</div><div class="hzd">' + H(z.nota) + '</div></div>';
  }).join('') || vacio('Sin zonas con conversación identificable.'));
  const BQ = {fuerte:['rgba(46,196,182,.15)', 'var(--su)', 'ZONA FUERTE', 'var(--go)'], disputa:['rgba(244,196,48,.1)', 'var(--go)', 'ZONA EN DISPUTA', 'var(--da)'], adversa:['rgba(230,57,70,.15)', 'var(--da)', 'ZONA ADVERSA', 'var(--ac)']};
  put('r-terblq', A(T.bloques).filter(b => b && (b.titulo || b.zonas)).map((b, i) => {
    const q = BQ[b.tipo] || BQ[['fuerte', 'disputa', 'adversa'][i % 3]];
    return '<div class="ec"><div class="eh" style="background:' + q[0] + ';color:' + q[1] + '">' + q[2] + (b.titulo ? ' — ' + esc(S(b.titulo).toUpperCase()) : '') + '</div><div class="eb"><div class="er"><span>' + esc(b.zonas) + '</span><span style="color:' + q[1] + '">' + esc(b.estado) + '</span></div><div class="ek">' + H(b.texto) + '</div>' + (S(b.clave) ? '<div class="er" style="margin-top:8px"><span>' + esc(b.clave) + '</span><span style="color:' + q[3] + '">' + esc(b.valor) + '</span></div>' : '') + '</div></div>';
  }).join(''));
});

seccion('modulos', () => {
  const COLS = ['var(--ac)', 'var(--da)', 'var(--go)', '#7eb8f7', 'var(--su)', 'var(--or)'];
  const ICON = ['📡', '🔥', '⚡', '🗺️', '📊', '🎯'];
  put('r-mod-t', 'MÓDULOS ESPECIALIZADOS' + (D.modulosVariante ? ' (' + esc(S(D.modulosVariante).toUpperCase()) + ')' : ''));
  put('r-mod', A(D.modulos).filter(m => m && (m.titulo || m.texto)).map((m, i) => '<div class="mc" style="border-top:3px solid ' + COLS[i % 6] + '"><div class="mi">' + esc(m.icono || ICON[i % 6]) + '</div><div class="mn2">' + esc(S(m.titulo).toUpperCase()) + '</div><div class="md2">' + H(m.texto) + '</div></div>').join('') || vacio());
});

/* Primera pestaña */
setTimeout(() => rCharts('kpis'), 100);
})();
