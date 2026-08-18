(function(){
const D = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('radar-root');
const C = {ac:'#1B4F8A',go:'#B8860B',da:'#E63946',su:'#008080',ne:'#4a5568',bl:'#1C2738'};

const FALLBACK = {
  actor: {cargo:'Servidor(a) Público(a)', entidad:'Estado de México', partido:'—', periodo: (META.mes||'')+' '+(META.anio||'')},
  kpis: {npsPartido:[{label:'Sin datos',valor:0}], npsDemografico:[{label:'Sin datos',valor:0}], ratioAtaqueDefensa:[{plataforma:'Sin datos',ratio:0}], traSemanal:{labels:['--'],valores:[0]}},
  sentimiento: {general:{labels:['Sin datos'],valores:[0]}, genero:{labels:['Sin datos'],valores:[0]}, edad:{labels:['Sin datos'],valores:[0]}, partido:{labels:['Sin datos'],valores:[0]}, hallazgos:[]},
  topOfMind: {general:{temas:['Sin datos'],valores:[0]}, genero:{temas:['Sin datos'],series:[{nombre:'—',valores:[0]}]}, edad:{temas:['Sin datos'],series:[{nombre:'—',valores:[0]}]}, partido:{temas:['Sin datos'],series:[{nombre:'—',valores:[0]}]}, cruces:[]},
  plataformas: {alcance:[{plataforma:'Sin datos',valor:0}], tono:[{plataforma:'Sin datos',positivo:0,negativo:0}], porEdad:[{plataforma:'Sin datos',series:[{nombre:'—',valor:0}]}], viralizacion:[{plataforma:'Sin datos',critica:0,propia:0}], lecturaEstrategica:[]},
  narrativas: {favorables:[], criticas:[], neutras:[]},
  riesgosOportunidades: {riesgos:[], oportunidades:[]},
  territorial: {zonas:[], volumenPorZona:[]},
  resumenEjecutivo: 'No se recibieron datos estructurados del backend para este periodo.'
};

function pick(obj, fallback) { 
  if (obj === undefined || obj === null) return fallback;
  if (Array.isArray(obj)) return obj.length ? obj : fallback;
  if (typeof obj === 'object') return Object.keys(obj).length ? obj : fallback;
  return obj;
}

const DATA = {
  actor: pick(D && D.actor, FALLBACK.actor),
  kpis: pick(D && D.kpis, FALLBACK.kpis),
  sentimiento: pick(D && D.sentimiento, FALLBACK.sentimiento),
  topOfMind: pick(D && D.topOfMind, FALLBACK.topOfMind),
  plataformas: pick(D && D.plataformas, FALLBACK.plataformas),
  narrativas: pick(D && D.narrativas, FALLBACK.narrativas),
  riesgosOportunidades: pick(D && D.riesgosOportunidades, FALLBACK.riesgosOportunidades),
  territorial: pick(D && D.territorial, FALLBACK.territorial),
  resumenEjecutivo: (D && D.resumenEjecutivo) || FALLBACK.resumenEjecutivo
};

// ---------- header ----------
const nameParts = (META.actor || 'PERSONAJE').split(' ');
document.getElementById('r-hdr-name').innerHTML = (nameParts[0]||'').toUpperCase() + ' <span>' + nameParts.slice(1).join(' ').toUpperCase() + '</span>';
document.getElementById('r-hdr-sub').textContent = [DATA.actor.cargo, DATA.actor.entidad, DATA.actor.partido, DATA.actor.periodo].filter(Boolean).join(' · ');
document.getElementById('r-ftr-l').textContent = 'RADAR Análisis Bivariado · ' + (DATA.actor.entidad || '');
document.getElementById('r-resumen').textContent = DATA.resumenEjecutivo;

// ---------- helpers de tabs ----------
window.radarTab = function(btn, id){
  root.querySelectorAll('.tsec').forEach(s=>s.classList.remove('show'));
  root.querySelectorAll('.tb').forEach(t=>t.classList.remove('act'));
  const target = document.getElementById('rtab-'+id);
  if(target) target.classList.add('show');
  btn.classList.add('act');
  setTimeout(()=>radarCharts(id), 60);
};

const CH = {};
function mk(id, cfg){ 
  if(CH[id]) CH[id].destroy(); 
  const c=document.getElementById(id); 
  if(!c) return; 
  CH[id]=new Chart(c, cfg); 
}

// ---------- KPIs ----------
function rKpis(){
  const p = DATA.kpis.npsPartido, dm = DATA.kpis.npsDemografico, ra = DATA.kpis.ratioAtaqueDefensa, tra = DATA.kpis.traSemanal;
  if(p && p.length) mk('rc-npspar',{type:'bar',data:{labels:p.map(x=>x.label),datasets:[{data:p.map(x=>x.valor),backgroundColor:d=>d.raw>=0?C.su:C.da,borderRadius:2,borderWidth:0}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>(v>0?'+':'')+v}}}}});  
  if(dm && dm.length) mk('rc-npsdemo',{type:'bar',data:{labels:dm.map(x=>x.label),datasets:[{data:dm.map(x=>x.valor),backgroundColor:d=>d.raw>=0?C.su:C.da,borderRadius:2,borderWidth:0}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>(v>0?'+':'')+v}},x:{ticks:{font:{size:8}}}}}});
  if(ra && ra.length) mk('rc-ratiopl',{type:'bar',data:{labels:ra.map(x=>x.plataforma),datasets:[{data:ra.map(x=>x.ratio),backgroundColor:d=>d.raw>=1.5?C.da:C.su,borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}}}});
  if(tra && tra.labels && tra.valores) mk('rc-tra',{type:'line',data:{labels:tra.labels,datasets:[{data:tra.valores,borderColor:C.ac,backgroundColor:'rgba(27,79,138,.1)',fill:true,tension:.4,borderWidth:2,pointRadius:3}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:v=>(v>0?'+':'')+v}}}}});  
}

// ---------- SENTIMIENTO ----------
let sC=null;
function rSent(k){
  if(sC) sC.destroy();
  const c = document.getElementById('rc-sent'); if(!c) return;
  const d = DATA.sentimiento[k];
  if(!d || !d.labels || !d.valores) return;
  const isBar = k !== 'general';
  sC = new Chart(c, {type:isBar?'bar':'doughnut', data:{labels:d.labels, datasets:[{data:d.valores, backgroundColor: isBar ? d.valores.map(v=>v>=0?C.su:C.da) : [C.su,C.ne,C.da,C.go], borderWidth:0, borderRadius:isBar?2:0, hoverOffset:isBar?0:6}]}, options:{responsive:true, plugins:{legend:{display:!isBar,position:'bottom',labels:{font:{size:9},padding:8,color:'#2d3748'}}}, cutout:isBar?undefined:'55%', scales:isBar?{y:{ticks:{callback:v=>(typeof v==='number'&&v>0?'+':'')+v}}}:undefined}});
}
window.radarUpdSent = function(btn,k){
  root.querySelectorAll('#rtab-sent .bb').forEach(b=>b.classList.remove('act')); btn.classList.add('act');
  const t={general:'Sentimiento General',genero:'Sentimiento por Género',edad:'Sentimiento / NPS-P por Edad',partido:'Sentimiento / NPS-P por Partido'};
  document.getElementById('r-sent-t').textContent = t[k]; rSent(k);
};
function rSentHallazgos(){
  const items = DATA.sentimiento.hallazgos || [];
  const classes = ['ac','go','su','bl'];
  document.getElementById('r-sent-hallazgos').innerHTML = items.length ? items.map((h,i)=>`
    <div class="ic ${classes[i%4]}"><div class="ih">${h.titulo||''}</div><div class="ib">${h.texto||''}</div>${h.accion?`<div class="im">→ ${h.accion}</div>`:''}</div>
  `).join('') : '<div class="ic ac"><div class="ib">Sin hallazgos bivariados disponibles.</div></div>';
}

// ---------- TOP OF MIND ----------
let tomC=null;
function rTom(k){
  if(tomC) tomC.destroy();
  const c = document.getElementById('rc-tom'); if(!c) return;
  const d = DATA.topOfMind[k];
  if(!d || !d.temas) return;
  if(k==='general'){
    tomC = new Chart(c,{type:'bar',data:{labels:d.temas,datasets:[{data:d.valores,backgroundColor:C.ac,borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{callback:v=>v+'%'}},y:{ticks:{font:{size:10}}}}}});
  } else {
    const palette=[C.ac,C.da,C.go,C.su];
    const series = (d.series||[]).filter(s=>s&&s.nombre&&s.valores);
    tomC = new Chart(c,{type:'bar',data:{labels:d.temas,datasets:series.map((s,i)=>({label:s.nombre,data:s.valores,backgroundColor:palette[i%4],borderRadius:2}))},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9},color:'#2d3748'}}},scales:{y:{ticks:{callback:v=>v+'%'}},x:{ticks:{font:{size:9}}}}}});
  }
}
window.radarUpdTom = function(btn,k){
  root.querySelectorAll('#rtab-tom .bb').forEach(b=>b.classList.remove('act')); btn.classList.add('act');
  const t={general:'Top de Temas — General',genero:'Top of Mind por Género',edad:'Top of Mind por Edad',partido:'Top of Mind por Partido'};
  document.getElementById('r-tom-t').textContent = t[k]; rTom(k);
};
function rTomCruces(){
  const items = DATA.topOfMind.cruces || [];
  const classes = ['ac','go','da','bl'];
  document.getElementById('r-tom-cruces').innerHTML = items.length ? items.map((h,i)=>`
    <div class="ic ${classes[i%4]}"><div class="ih">${h.titulo||''}</div><div class="ib">${h.texto||''}</div>${h.accion?`<div class="im">→ ${h.accion}</div>`:''}</div>
  `).join('') : '<div class="ic ac"><div class="ib">Sin cruces temáticos disponibles.</div></div>';
}

// ---------- PLATAFORMAS ----------
function rPlat(){
  const alc=DATA.plataformas.alcance, tono=DATA.plataformas.tono, pe=DATA.plataformas.porEdad, vir=DATA.plataformas.viralizacion;
  if(alc && alc.length) mk('rc-plalc',{type:'doughnut',data:{labels:alc.map(x=>x.plataforma),datasets:[{data:alc.map(x=>x.valor),backgroundColor:[C.ac,C.bl,C.go,C.ne,C.su,C.da],borderWidth:0,hoverOffset:6}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9},padding:8,color:'#2d3748'}}},cutout:'55%'}});
  if(tono && tono.length) mk('rc-pltono',{type:'bar',data:{labels:tono.map(x=>x.plataforma),datasets:[{label:'% Positivo',data:tono.map(x=>x.positivo),backgroundColor:C.su,borderRadius:2},{label:'% Negativo',data:tono.map(x=>x.negativo),backgroundColor:C.da,borderRadius:2}]},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9},color:'#2d3748'}}},scales:{y:{ticks:{callback:v=>v+'%'}}}}});
  if(pe && pe.length && pe[0].series){
    const palette=[C.da,C.go,C.su,C.ne];
    const grupos = (pe[0].series || []).map(s=>s.nombre);
    mk('rc-pledad',{type:'bar',data:{labels:pe.map(x=>x.plataforma),datasets:grupos.map((g,i)=>({label:g,data:pe.map(x=>(x.series[i]||{}).valor||0),backgroundColor:palette[i%4],borderRadius:2}))},options:{responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9},color:'#2d3748'}}},scales:{y:{ticks:{callback:v=>v+'%'}}}}});
  }
  if(vir && vir.length) mk('rc-plviral',{type:'bar',data:{labels:vir.map(x=>x.plataforma),datasets:[{label:'Crítica (h)',data:vir.map(x=>x.critica),backgroundColor:C.da,borderRadius:2},{label:'Propia (h)',data:vir.map(x=>x.propia),backgroundColor:C.su,borderRadius:2}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{position:'bottom',labels:{font:{size:9},color:'#2d3748'}}}}});
}
function rPlatLectura(){
  const items = DATA.plataformas.lecturaEstrategica || [];
  document.getElementById('r-plat-lectura').innerHTML = items.length ? items.map(i=>`
    <div class="card"><div class="ct" style="font-size:12px;color:${i.alerta?'var(--da)':'var(--bl)'};margin-bottom:4px;font-weight:700">${i.titulo||''}</div><div class="ib">${i.texto||''}</div></div>
  `).join('') : '<div class="card"><div class="ib">Sin lectura estratégica disponible.</div></div>';
}

// ---------- NARRATIVAS ----------
function narItemHtml(n, biClass){
  const tags = (n.tags||[]).map(t=>`<span class="btag">${t}</span>`).join('');
  return `<div class="ni"><div class="nit">${n.titulo||''}</div><div class="nd">${n.descripcion||''}</div>${tags}${n.bivariado?`<div class="bi ${biClass}"><strong>Bivariado:</strong> ${n.bivariado}</div>`:''}</div>`;
}
function rNarrativas(){
  document.getElementById('r-nar-fav').innerHTML = (DATA.narrativas.favorables||[]).map(n=>narItemHtml(n,'')).join('') || '<div class="ni"><div class="nd">Sin narrativas favorables detectadas.</div></div>';
  document.getElementById('r-nar-crit').innerHTML = (DATA.narrativas.criticas||[]).map(n=>narItemHtml(n,'neg')).join('') || '<div class="ni"><div class="nd">Sin narrativas críticas detectadas.</div></div>';
  document.getElementById('r-nar-neu').innerHTML = (DATA.narrativas.neutras||[]).map(n=>narItemHtml(n,'ntr')).join('') || '<div class="ni"><div class="nd">Sin narrativas neutras detectadas.</div></div>';
}

// ---------- RIESGOS Y OPORTUNIDADES ----------
const LVL_RIESGO = {'CRÍTICO':'lc','ALTO':'la','MEDIO':'lm','BAJO':'lb'};
const LVL_OPP = {'ALTO':'lo-alto','MEDIO':'lo-medio','BAJO':'lo-bajo'};
function rRiesgosOportunidades(){
  document.getElementById('r-riesgos').innerHTML = (DATA.riesgosOportunidades.riesgos||[]).map(r=>`
    <div class="mr"><div class="mt"><span class="lv ${LVL_RIESGO[r.nivel]||'lm'}">${r.nivel||''}</span><span class="mn">${r.titulo||''}</span></div><div class="md">${r.descripcion||''}</div>${r.bivariado?`<div class="bi neg"><strong>Bivariado:</strong> ${r.bivariado}</div>`:''}</div>
  `).join('') || '<div class="mr"><div class="md">Sin riesgos relevantes detectados.</div></div>';

  document.getElementById('r-oportunidades').innerHTML = (DATA.riesgosOportunidades.oportunidades||[]).map(r=>`
    <div class="mr"><div class="mt"><span class="lv ${LVL_OPP[r.nivel]||'lo-medio'}">${r.nivel||''}</span><span class="mn">${r.titulo||''}</span></div><div class="md">${r.descripcion||''}</div>${r.bivariado?`<div class="bi"><strong>Bivariado:</strong> ${r.bivariado}</div>`:''}</div>
  `).join('') || '<div class="mr"><div class="md">Sin oportunidades relevantes detectadas.</div></div>';
}

// ---------- TERRITORIAL ----------
const CLASE_MAP = {favorable:'fav', adversa:'adv', inercial:'ine'};
const EMOJI_MAP = {favorable:'🟢 FAVORABLE', adversa:'🔴 ADVERSA', inercial:'🟡 INERCIAL'};
function rTer(){
  const zonas = DATA.territorial.zonas || [];
  document.getElementById('r-ter-hm').innerHTML = zonas.map(z=>`
    <div class="hz ${CLASE_MAP[z.clasificacion]||'ine'}"><div class="hzn">${z.nombre}</div><div class="hzs">${z.nps>0?'+':''}${z.nps}</div><div class="hzl">${EMOJI_MAP[z.clasificacion]||''}</div><div style="font-size:9px;color:#4a5568;margin-top:5px">${z.nota||''}</div></div>
  `).join('') || '<div class="hz ine"><div class="hzn">Sin datos</div></div>';

  if(zonas.length) mk('rc-ternps',{type:'bar',data:{labels:zonas.map(z=>z.nombre),datasets:[{data:zonas.map(z=>z.nps),backgroundColor:d=>d.raw>10?C.su:d.raw>0?C.go:d.raw>-15?C.da:'#AA0000',borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}}}});

  const vol = DATA.territorial.volumenPorZona || [];
  if(vol.length) mk('rc-tervol',{type:'bar',data:{labels:vol.map(v=>v.zona),datasets:[{data:vol.map(v=>v.volumen),backgroundColor:C.go,borderRadius:2,borderWidth:0}]},options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{callback:v=>v+'%'}}}}});
}

function radarCharts(t){
  if(t==='kpis') rKpis();
  if(t==='sent'){ rSent('general'); rSentHallazgos(); }
  if(t==='tom'){ rTom('general'); rTomCruces(); }
  if(t==='plat'){ rPlat(); rPlatLectura(); }
  if(t==='nar') rNarrativas();
  if(t==='risk') rRiesgosOportunidades();
  if(t==='ter') rTer();
}

setTimeout(()=>radarCharts('kpis'), 80);
})();
