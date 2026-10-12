(function(){
/* RADAR · Análisis bivariado — estructura de RADAR_LA_PIEDAD (9 pestañas). */
const RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : {};
const META = window.DATA_META || {};
const root = document.getElementById('radar-root');
const $ = (id) => document.getElementById(id);
const A = (v) => Array.isArray(v) ? v : [];
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const S = (v) => (v === undefined || v === null) ? '' : String(v);
const C = {ac:'#0097A7',go:'#D97706',da:'#DC2626',su:'#0D9488',ne:'#64748B',bl:'#1E40AF'};
const GRID = {color:'rgba(0,0,0,.05)'};
const signo = v => (typeof v === 'number' && v > 0 ? '+' : '') + v;

const D = {
  actor: O(RAW.actor), kpis: O(RAW.kpis), sentimiento: O(RAW.sentimiento), topOfMind: O(RAW.topOfMind),
  plataformas: O(RAW.plataformas), nube: O(RAW.nube), hashtags: A(RAW.hashtags), hashtagsLectura: S(RAW.hashtagsLectura),
  narrativas: O(RAW.narrativas), riesgosOportunidades: O(RAW.riesgosOportunidades), territorial: O(RAW.territorial),
  modulos: A(RAW.modulos)
};
const periodo = META.periodo || D.actor.periodo || [META.mes, META.anio].filter(Boolean).join(' ');

/* ---------- HERO ---------- */
const nombre = META.actor || 'PERSONAJE';
const partes = nombre.trim().split(/\s+/);
const corte = partes.length > 2 ? Math.ceil(partes.length / 2) : 1;
$('r-hdr-name').innerHTML = partes.slice(0, corte).join(' ').toUpperCase() + ' <span>' + partes.slice(corte).join(' ').toUpperCase() + '</span>';
$('r-hdr-sub').textContent = [D.actor.cargo, D.actor.entidad, D.actor.partido, periodo].filter(Boolean).join(' · ');
$('r-meta').innerHTML = `<span class="pulse"></span>BIVARIADO ACTIVO · ${S(periodo).toUpperCase()}<br>${nombre.toUpperCase()}${D.actor.entidad ? ' · ' + S(D.actor.entidad).toUpperCase() : ''}`;
const T = O(D.kpis.tarjetas);
$('r-tags').innerHTML = `<span class="tag ta">ANÁLISIS BIVARIADO</span><span class="tag tg">CLIMA: ${S(T.clima || '—')}</span><span class="tag ts">NPS-P: ${S(T.nps || '—')}</span><span class="tag ta">SOV: ${S(T.sov || '—')}</span>`;
$('r-ftr-l').textContent = `RADAR · ESTUDIO CONFIDENCIAL · ${S(D.actor.entidad).toUpperCase()}${periodo ? ' · ' + S(periodo).toUpperCase() : ''}`;
$('r-tra-t').textContent = 'TRA — Evolución del Periodo' + (periodo ? ` (${periodo})` : '');

/* ---------- TABS ---------- */
window.radarTab = function(btn, id){
  root.querySelectorAll('.tsec').forEach(s=>s.classList.remove('show'));
  root.querySelectorAll('.tb').forEach(t=>t.classList.remove('act'));
  const t = $('rtab-'+id); if(t) t.classList.add('show');
  btn.classList.add('act');
  setTimeout(()=>radarCharts(id), 60);
};
const CH = {};
function mk(id, cfg){ if(CH[id]) CH[id].destroy(); const c = $(id); if(!c) return; CH[id] = new Chart(c, cfg); }
if (window.Chart) { Chart.defaults.color = '#475569'; Chart.defaults.font.family = 'system-ui,sans-serif'; }

/* ---------- KPIs ---------- */
$('r-kpi-cards').innerHTML = [
  ['ac','NPS POLÍTICO',T.nps,T.npsNota],['da','SHARE OF VOICE',T.sov,T.sovNota],['su','RATIO ATAQUE/DEF.',T.ratio,T.ratioNota],
  ['go','TRA ACUMULADA',T.tra,T.traNota],['bl','ALCANCE ESTIMADO',T.alcance,T.alcanceNota]
].map(([c,l,v,n])=>`<div class="kpi ${c}"><div class="kl">${l}</div><div class="kv">${S(v)||'—'}</div><div class="kn">${S(n)}</div></div>`).join('');
function rKpis(){
  const p = A(D.kpis.npsPartido), dm = A(D.kpis.npsDemografico), tra = O(D.kpis.traSemanal);
  const ra = A(D.kpis.ratioPorAfiliacion).length ? A(D.kpis.ratioPorAfiliacion) : A(D.kpis.ratioAtaqueDefensa).map(r=>({segmento:r.plataforma||r.label,ratio:r.ratio}));
  if(p.length) mk('rc-npspar',{type:'bar',data:{labels:p.map(x=>x.label),datasets:[{label:'NPS-P',data:p.map(x=>Number(x.valor)||0),backgroundColor:d=>d.raw>=10?C.su:d.raw>=0?C.go:C.da,borderRadius:2,borderWidth:0}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{grid:GRID,ticks:{callback:signo}},x:{grid:{display:false},ticks:{font:{size:9}}}}}});
  if(dm.length) mk('rc-npsdemo',{type:'bar',data:{labels:dm.map(x=>x.label),datasets:[{label:'NPS-P',data:dm.map(x=>Number(x.valor)||0),backgroundColor:d=>d.raw>=0?C.su:C.da,borderRadius:2,borderWidth:0}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{grid:GRID,ticks:{callback:signo}},x:{grid:{display:false},ticks:{font:{size:8}}}}}});
  if(ra.length) mk('rc-ratiopl',{type:'bar',data:{labels:ra.map(x=>x.segmento),datasets:[{label:'Ratio',data:ra.map(x=>Number(x.ratio)||0),backgroundColor:d=>d.raw>1?C.da:d.raw>0.7?C.go:C.su,borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:GRID},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  if(A(tra.labels).length) mk('rc-tra',{type:'line',data:{labels:tra.labels,datasets:[{label:'TRA',data:A(tra.valores),borderColor:C.ac,backgroundColor:'rgba(0,151,167,.1)',fill:true,tension:.4,borderWidth:2,pointRadius:3}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{suggestedMin:0,suggestedMax:10,grid:GRID,ticks:{callback:signo}},x:{grid:{display:false},ticks:{font:{size:9}}}}}});
}

/* ---------- SENTIMIENTO ---------- */
const COL_SENT = {favorable:C.su,fav:C.su,neutro:C.ne,neu:C.ne,negativo:C.da,neg:C.da,polarizado:C.go,pol:C.go,mixto:C.go,adverso:C.da,inercial:C.ne};
const colorPorLabel = (l, i, fallback) => { const k = S(l).toLowerCase().split(' ').pop(); return COL_SENT[k] || fallback[i % fallback.length]; };
function rSent(k){
  const d = O(O(D.sentimiento)[k]), cl = O(O(D.sentimiento.clima)[k]);
  if(A(d.labels).length){
    const isBar = k !== 'general';
    const cols = k==='genero' ? A(d.labels).map((l,i)=>{const c=colorPorLabel(l,i,[C.su,C.ne,C.da,C.go]); return /^H/i.test(l) ? c+'80' : c;})
      : k==='general' ? A(d.labels).map((l,i)=>colorPorLabel(l,i,[C.su,C.ne,C.da,C.go]))
      : A(d.valores).map(v=>Number(v)>=10?C.su:Number(v)>=0?C.go:C.da);
    mk('rc-sent',{type:isBar?'bar':'doughnut',data:{labels:d.labels,datasets:[{label:'Sentimiento',data:A(d.valores).map(Number),backgroundColor:cols,borderWidth:0,borderRadius:isBar?2:0,hoverOffset:isBar?0:6}]},options:{responsive:true,plugins:{legend:{display:!isBar,position:'bottom',labels:{font:{size:9},padding:8}}},cutout:isBar?undefined:'55%',scales:isBar?{y:{grid:GRID,ticks:{callback:signo}},x:{grid:{display:false},ticks:{font:{size:9}}}}:undefined}});
  }
  if(A(cl.labels).length){
    mk('rc-clima',{type:'doughnut',data:{labels:cl.labels,datasets:[{label:'Clima',data:A(cl.valores).map(Number),backgroundColor:A(cl.labels).map((l,i)=>colorPorLabel(l,i,[C.su,C.go,C.da,C.ne,C.bl,C.ac])),borderWidth:0,hoverOffset:6}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9},padding:8}}},cutout:'55%'}});
  }
}
window.radarUpdSent = function(btn,k){
  root.querySelectorAll('#rtab-sent .bb').forEach(b=>b.classList.remove('act')); btn.classList.add('act');
  $('r-sent-t').textContent = {general:'Sentimiento General',genero:'Sentimiento por Género',edad:'NPS-P por Edad',partido:'NPS-P por Partido'}[k];
  rSent(k);
};
const ICLS = ['ac','go','su','bl'];
const tarjetasIC = (items, cls, vacio) => A(items).length ? A(items).map((h,i)=>`<div class="ic ${cls[i%cls.length]}"><div class="ih">${S(h.titulo)}</div><div class="ib">${S(h.texto)}</div>${h.accion?`<div class="im">→ ${S(h.accion)}</div>`:''}</div>`).join('') : `<div class="ic ac"><div class="ib">${vacio}</div></div>`;
$('r-sent-hallazgos').innerHTML = tarjetasIC(D.sentimiento.hallazgos, ICLS, 'Sin hallazgos bivariados disponibles.');

/* ---------- TOP OF MIND ---------- */
function rTom(k){
  const d = O(O(D.topOfMind)[k]);
  if(!A(d.temas).length) return;
  if(k==='general'){
    mk('rc-tom',{type:'bar',data:{labels:d.temas,datasets:[{label:'Temas',data:A(d.valores).map(Number),backgroundColor:A(d.temas).map((_,i)=>[C.ac,C.su,C.go,C.da,C.bl,C.ne][i%6]),borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:GRID,ticks:{callback:v=>v+'%'}},y:{grid:{display:false},ticks:{font:{size:10}}}}}});
  } else {
    const pal = k==='genero' ? [C.bl,'rgba(220,38,38,.7)'] : [C.su,C.ac,C.go,C.da,C.bl,C.ne];
    const series = A(d.series).filter(s=>s&&s.nombre);
    mk('rc-tom',{type:'bar',data:{labels:d.temas,datasets:series.map((s,i)=>({label:s.nombre,data:A(s.valores).map(Number),backgroundColor:pal[i%pal.length],borderRadius:2}))},options:{indexAxis:k==='genero'?'y':'x',responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9}}}},scales:k==='genero'?{x:{grid:GRID,ticks:{callback:v=>v+'%'}},y:{grid:{display:false},ticks:{font:{size:9}}}}:{y:{grid:GRID,ticks:{callback:v=>v+'%'}},x:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }
}
window.radarUpdTom = function(btn,k){
  root.querySelectorAll('#rtab-tom .bb').forEach(b=>b.classList.remove('act')); btn.classList.add('act');
  $('r-tom-t').textContent = {general:'Top de Temas — General',genero:'Top of Mind por Género',edad:'Top of Mind por Edad',partido:'Top of Mind por Partido'}[k];
  rTom(k);
};
$('r-tom-cruces').innerHTML = tarjetasIC(D.topOfMind.cruces, ['ac','go','da','bl'], 'Sin cruces temáticos disponibles.');

/* ---------- NUBE & HASHTAGS ---------- */
const SCOL = {favorable:'#0E7C71',negativo:'#B91C1C',neutro:'#475569',polarizado:'#B45309'};
const TONO_COL = {favorable:'#0E7C71',negativo:'#B91C1C',neutro:'#475569',polarizado:'#B45309'};
const TONO_BAR = {favorable:C.su,negativo:C.da,neutro:C.ne,polarizado:C.go};
const pal = A(O(D.nube).palabras);
if(pal.length){
  const vals = pal.map(x=>Number(x.v)||0), max = Math.max(...vals), min = Math.min(...vals);
  $('r-cloud').innerHTML = pal.map(x=>{const t=((Number(x.v)||0)-min)/((max-min)||1);const size=(11+t*26).toFixed(0);const fw=t>0.6?800:t>0.3?700:500;return `<span style="font-size:${size}px;font-weight:${fw};color:${SCOL[S(x.s).toLowerCase()]||SCOL.neutro};margin:4px 8px;display:inline-block" title="${S(x.w)} · ${S(x.v)} · ${S(x.s)}">${S(x.w)}</span>`}).join(' ');
} else $('r-cloud').innerHTML = '<span class="ib">Sin palabras asociadas en el periodo.</span>';
$('r-cloud-lect').innerHTML = S(O(D.nube).lectura);
$('r-hash-tbl').innerHTML = D.hashtags.map(h=>`<tr><td>${S(h.tag)}</td><td style="color:${TONO_COL[S(h.tono).toLowerCase()]||'#475569'}">${S(h.tono)}</td><td>${S(h.plataforma)}</td><td>${S(h.origen)}</td></tr>`).join('') || '<tr><td colspan="4">Sin hashtags detectados.</td></tr>';
$('r-hash-lect').innerHTML = D.hashtagsLectura;
function rNube(){
  if(D.hashtags.length) mk('rc-hash',{type:'bar',data:{labels:D.hashtags.map(h=>h.tag),datasets:[{label:'Hashtags',data:D.hashtags.map(h=>Number(h.valor)||0),backgroundColor:D.hashtags.map(h=>TONO_BAR[S(h.tono).toLowerCase()]||C.ne),borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:GRID},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
}

/* ---------- PLATAFORMAS ---------- */
function rPlat(){
  const P = D.plataformas, alc=A(P.alcance), tono=A(P.tono), pe=A(P.porEdad), vir=A(P.viralizacion);
  if(alc.length) mk('rc-plalc',{type:'doughnut',data:{labels:alc.map(x=>x.plataforma),datasets:[{label:'Alcance',data:alc.map(x=>Number(x.valor)||0),backgroundColor:[C.ac,C.su,C.bl,C.go,C.ne,C.da],borderWidth:0,hoverOffset:6}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9},padding:8}}},cutout:'55%'}});
  if(tono.length) mk('rc-pltono',{type:'bar',data:{labels:tono.map(x=>x.plataforma),datasets:[{label:'% Favorable',data:tono.map(x=>Number(x.positivo)||0),backgroundColor:C.su,borderRadius:2},{label:'% Negativo',data:tono.map(x=>Number(x.negativo)||0),backgroundColor:C.da,borderRadius:2}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9}}}},scales:{y:{grid:GRID,ticks:{callback:v=>v+'%'}},x:{grid:{display:false}}}}});
  if(pe.length && A(pe[0].series).length){
    const grupos = A(pe[0].series).map(s=>s.nombre), cols=['rgba(220,38,38,.7)',C.go,C.su,C.ne];
    mk('rc-pledad',{type:'bar',data:{labels:pe.map(x=>x.plataforma),datasets:grupos.map((g,i)=>({label:g,data:pe.map(x=>Number((A(x.series)[i]||{}).valor)||0),backgroundColor:cols[i%4],borderRadius:2}))},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9}}}},scales:{y:{grid:GRID,ticks:{callback:v=>v+'%'}},x:{grid:{display:false}}}}});
  }
  if(vir.length){
    const horas = vir.map(v=>Number(v.horas ?? v.critica ?? v.propia)||0);
    mk('rc-plviral',{type:'bar',data:{labels:vir.map(v=>v.plataforma),datasets:[{label:'Horas a 1K',data:horas,backgroundColor:vir.map(v=>/terceros|cr[ií]tica/i.test(S(v.tipo))?C.da:C.su),borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:GRID},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  }
}
if(D.plataformas.viralizacionNota) $('r-viral-nota').textContent = D.plataformas.viralizacionNota;
$('r-plat-lectura').innerHTML = A(D.plataformas.lecturaEstrategica).map(i=>`<div class="card"><div class="ct" style="font-size:12px;color:${i.alerta?'#B91C1C':'var(--navy)'};margin-bottom:4px">${S(i.titulo)}</div><div class="ib">${S(i.texto)}</div></div>`).join('') || '<div class="card"><div class="ib">Sin lectura estratégica disponible.</div></div>';

/* ---------- NARRATIVAS ---------- */
const TAG_CLS = {genero:'bgen',género:'bgen',edad:'bage',partido:'bpar',fuente:'bsrc',territorio:'bloc',loc:'bloc'};
function tagHtml(t){
  if(t && typeof t === 'object') return `<span class="btag ${TAG_CLS[S(t.tipo).toLowerCase()]||'bloc'}">${S(t.texto)}</span>`;
  const x = S(t), cls = /^[♀♂HM]\s|mujer|hombre|g[eé]nero/i.test(x) ? 'bgen' : /\d{2}/.test(x) ? 'bage' : /pan|morena|pri|mc|verde|pt|independ|filiaci|base/i.test(x) ? 'bpar' : /prensa|medio|fuente|atiempo|x\b|facebook/i.test(x) ? 'bsrc' : 'bloc';
  return `<span class="btag ${cls}">${x}</span>`;
}
const narItem = (n, bi) => `<div class="ni"><div class="nit">${S(n.titulo)}</div><div class="nd">${S(n.descripcion)}</div>${A(n.tags).map(tagHtml).join('')}${n.bivariado?`<div class="bi ${bi}"><strong>Bivariado:</strong> ${S(n.bivariado)}</div>`:''}</div>`;
$('r-nar-fav').innerHTML = A(D.narrativas.favorables).map(n=>narItem(n,'')).join('') || '<div class="ni"><div class="nd">Sin narrativas favorables detectadas.</div></div>';
$('r-nar-crit').innerHTML = A(D.narrativas.criticas).map(n=>narItem(n,'neg')).join('') || '<div class="ni"><div class="nd">Sin narrativas críticas detectadas.</div></div>';
$('r-nar-neu').innerHTML = A(D.narrativas.neutras).map(n=>narItem(n,'ntr')).join('') || '<div class="ni"><div class="nd">Sin narrativas neutras detectadas.</div></div>';

/* ---------- RIESGOS & OPORTUNIDADES ---------- */
const LVL_R = {'CRÍTICO':'lc','CRITICO':'lc','ALTO':'la','MEDIO':'lm','BAJO':'lb'};
const LVL_O = {'ALTO':'lo-alto','ALTA':'lo-alto','MEDIO':'lo-medio','MEDIA':'lo-medio','BAJO':'lo-bajo','BAJA':'lo-bajo'};
const RO = D.riesgosOportunidades;
$('r-riesgos').innerHTML = A(RO.riesgos).map(r=>`<div class="mr"><div class="mt"><span class="lv ${LVL_R[S(r.nivel).toUpperCase()]||'lm'}">${S(r.nivel)}</span><span class="mn">${S(r.titulo)}</span></div><div class="md">${S(r.descripcion)}</div>${r.bivariado?`<div class="bi neg"><strong>Bivariado:</strong> ${S(r.bivariado)}</div>`:''}</div>`).join('') || '<div class="mr"><div class="md">Sin riesgos relevantes detectados.</div></div>';
$('r-oportunidades').innerHTML = A(RO.oportunidades).map(r=>`<div class="mr"><div class="mt"><span class="lv ${LVL_O[S(r.nivel).toUpperCase()]||'lo-medio'}">${S(r.nivel)}</span><span class="mn">${S(r.titulo)}</span></div><div class="md">${S(r.descripcion)}</div>${r.bivariado?`<div class="bi"><strong>Bivariado:</strong> ${S(r.bivariado)}</div>`:''}</div>`).join('') || '<div class="mr"><div class="md">Sin oportunidades relevantes detectadas.</div></div>';
const AL = O(RO.alerta), nivel = S(AL.nivel || '1');
const AL_COL = {'1':['#15803d','🟢'],'2':['#B45309','🟡'],'3':['#B91C1C','🔴']}[nivel] || ['#15803d','🟢'];
const lista = (t) => S(t).split(/\s·\s|\n|;/).map(x=>x.trim()).filter(Boolean).join(' · ');
$('r-alerta').innerHTML = `<div class="ct" style="color:${AL_COL[0]}">Nivel de Alerta — Escenarios de Movimiento</div>
  <div class="cs">Semáforo activo: ${AL_COL[1]} NIVEL ${nivel} — ${S(AL.etiqueta || 'ESTABLE')}.${AL.texto ? ' ' + S(AL.texto) : ''}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div><div style="font-family:monospace;font-size:9px;color:#B45309;letter-spacing:1px;margin-bottom:6px;font-weight:700">QUÉ SUBE EL NIVEL</div><div class="ib">${lista(AL.sube) || '—'}</div></div>
    <div><div style="font-family:monospace;font-size:9px;color:#0E7C71;letter-spacing:1px;margin-bottom:6px;font-weight:700">QUÉ LO BAJA / ESTABILIZA</div><div class="ib">${lista(AL.baja) || '—'}</div></div>
  </div>`;

/* ---------- TERRITORIAL ---------- */
const zonas = A(D.territorial.zonas);
const ZCLS = {favorable:'fav',adversa:'adv',inercial:'ine',sin_datos:'ine'};
const ZLBL = {favorable:'🟢 FAVORABLE',adversa:'🔴 ADVERSA',inercial:'🟡 INERCIAL',sin_datos:'⚪ SIN DATOS'};
const sinDato = z => z.nps === null || z.nps === undefined || S(z.clasificacion) === 'sin_datos';
$('r-ter-hm').innerHTML = zonas.map(z=>`<div class="hz ${ZCLS[S(z.clasificacion)]||'ine'}"><div class="hzn">${S(z.nombre)}</div><div class="hzs">${sinDato(z)?'N/D':signo(Number(z.nps))}</div><div class="hzl">${sinDato(z)?ZLBL.sin_datos:(ZLBL[S(z.clasificacion)]||'')}</div><div style="font-size:9px;color:#475569;margin-top:5px">${S(z.nota)}</div></div>`).join('') || '<div class="hz ine"><div class="hzn">Sin datos</div></div>';
function rTer(){
  const zz = zonas.filter(z=>!sinDato(z)).sort((a,b)=>Number(b.nps)-Number(a.nps));
  if(zz.length) mk('rc-ternps',{type:'bar',data:{labels:zz.map(z=>z.nombre),datasets:[{label:'NPS-P',data:zz.map(z=>Number(z.nps)),backgroundColor:d=>d.raw>10?C.su:d.raw>0?C.go:d.raw>-15?C.da:'#AA0000',borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:GRID,ticks:{callback:signo}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
  const vol = A(D.territorial.volumenPorZona);
  if(vol.length) mk('rc-tervol',{type:'bar',data:{labels:vol.map(v=>v.zona),datasets:[{label:'Volumen %',data:vol.map(v=>Number(v.volumen)||0),backgroundColor:vol.map((_,i)=>[C.go,C.su,C.ne][i%3]),borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{grid:GRID,ticks:{callback:v=>v+'%'}},y:{grid:{display:false},ticks:{font:{size:9}}}}}});
}

/* ---------- MÓDULOS ---------- */
const MOD_UI = {'M-A':['📡','var(--navy)'],'M-B':['🎯','var(--da)'],'M-C':['📅','var(--go)'],'M-D':['🔭','var(--su)'],'M-E':['📐','var(--bl)'],'M-F':['⚡','var(--da)']};
$('r-modulos').innerHTML = D.modulos.map(m=>{const ui=MOD_UI[S(m.codigo).toUpperCase()]||['◆','var(--navy)'];return `<div class="mc" style="border-top:3px solid ${ui[1]}"><div class="mi">${ui[0]}</div><div class="mn2">${S(m.codigo)} · ${S(m.titulo)}</div><div class="md2">${S(m.texto)||'Sin información suficiente en las fuentes del periodo.'}</div></div>`;}).join('') || '<div class="mc"><div class="md2">Sin módulos disponibles.</div></div>';

/* ---------- RENDER ---------- */
function radarCharts(t){
  if(t==='kpis') rKpis();
  if(t==='sent') rSent('general');
  if(t==='tom') rTom('general');
  if(t==='nube') rNube();
  if(t==='plat') rPlat();
  if(t==='ter') rTer();
}
setTimeout(()=>radarCharts('kpis'), 80);
})();
