(function(){
const D_RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('comparativo-root');
if(!root){ return; }

const PALETTE = ['#00A8B5','#C0392B','#D35400','#1E8449','#1B4F8A','#C49A00'];
const SENT_COLOR = {positivo:'#1E8449', negativo:'#C0392B', neutro:'#555555', polarizado:'#C49A00'};

function nombresActores(){
  if(META.actores && Array.isArray(META.actores) && META.actores.length) return META.actores;
  const list = [META.actor, META.actor2, META.actor3, META.actor4, META.actor5, META.actor6].filter(Boolean);
  return list.length ? list : ['Actor A','Actor B'];
}

function buildFallback(){
  const nombres = nombresActores();
  const actores = nombres.map((n,i)=>({nombre:n, color:PALETTE[i%PALETTE.length]}));
  const zeros4 = ()=>[0,0,0,0];
  const sentGeneral = {}; actores.forEach(a=>sentGeneral[a.nombre]=zeros4());
  const traSeries = {}; actores.forEach(a=>traSeries[a.nombre]=[0,0,0,0,0]);
  const npsPorActor = actores.map(()=>0);
  const ratioPorActor = actores.map(()=>0);
  const platRadar = {}; actores.forEach(a=>platRadar[a.nombre]=[0,0,0,0]);
  return {
    actores,
    alertaPrincipal: {actor: nombres[0]||'Sin datos', nivel:'Sin datos', label:'Sin datos suficientes'},
    periodo: {corte:'Sin datos', rango:'Sin datos'},
    resumenKpis: 'Sin datos suficientes para generar el resumen.',
    kpiCards: [{label:'Sin datos', val:'—', sub:'Sin datos suficientes', color:'n'}],
    npsPorActor, npsNote:'Sin datos suficientes.',
    ratioPorActor, ratioNote:'Sin datos suficientes.',
    traSerie:{labels:['','','','',''], series:traSeries}, traNote:'Sin datos suficientes.',
    sentimientoGeneral: sentGeneral,
    sentimientoCruces: {
      edad:{segments:['18-29','30-44','45-59','60+'], data:Object.fromEntries(actores.map(a=>[a.nombre, Object.fromEntries(['18-29','30-44','45-59','60+'].map(s=>[s,zeros4()]))])), note:'Sin datos suficientes.'},
      genero:{segments:['Mujer','Hombre'], data:Object.fromEntries(actores.map(a=>[a.nombre, {Mujer:zeros4(),Hombre:zeros4()}])), note:'Sin datos suficientes.'},
      partido:{segments:['Simpatizantes','Oposición','Independiente'], data:Object.fromEntries(actores.map(a=>[a.nombre, {Simpatizantes:zeros4(),Oposición:zeros4(),Independiente:zeros4()}])), note:'Sin datos suficientes.'}
    },
    topOfMindTabla: [['Sin datos','—','—']],
    topOfMindLead: 'Sin datos suficientes.',
    topOfMindCruces: {
      edad:{segments:['18-29','30-44','45-59','60+'], themes:['Sin datos'], data:{'Sin datos':[0,0,0,0]}, note:'Sin datos suficientes.'},
      genero:{segments:['Mujer','Hombre'], themes:['Sin datos'], data:{'Sin datos':[0,0]}, note:'Sin datos suficientes.'},
      partido:{segments:['Simpatizantes','Oposición'], themes:['Sin datos'], data:{'Sin datos':[0,0]}, note:'Sin datos suficientes.'}
    },
    picosLead:'Sin datos suficientes.',
    picosTabla:[['—','Sin datos','—','—']],
    picosSerie:{labels:['','','',''], series: Object.fromEntries(actores.slice(0,2).map(a=>[a.nombre,[0,0,0,0]]))},
    plataformasLead:'Sin datos suficientes.',
    plataformasRadar:{labels:['X (Twitter)','Facebook','Instagram','Medios digitales'], data:platRadar},
    plataformasNotas:[{titulo:'Sin datos', texto:'Sin datos suficientes.', color:'#555555'}],
    nubeLead:'Sin datos suficientes.',
    nubePalabras:[{word:'sin datos', weight:50, sentiment:'neutro'}],
    nubeNota:'Sin datos suficientes.',
    hashtags:[['—','—','—','—','—',0]],
    hashtagsNota:'Sin datos suficientes.',
    narrativas:[{actor:nombres[0]||'Sin datos', tipo:'favorable', titulo:'Sin datos', texto:'Sin datos suficientes.', bivariado:''}],
    narrativasCierre:'Sin datos suficientes.',
    riesgos:[['MEDIO','Sin datos','Sin datos suficientes.','']],
    oportunidades:[['MEDIA','Sin datos','Sin datos suficientes.','']],
    alertaTabla: actores.map(a=>[a.nombre,'Sin datos','Sin datos suficientes.']),
    escenarioSube:'Sin datos suficientes.',
    escenarioBaja:'Sin datos suficientes.',
    territorialLead:'Sin datos suficientes.',
    territorialTabla:[['—','Sin datos','—']],
    territorialAlerta: null
  };
}

const FALLBACK = buildFallback();
function pick(v, fb){ return (v===undefined || v===null) ? fb : v; }

const D = {};
Object.keys(FALLBACK).forEach(k=>{ D[k] = pick(D_RAW && D_RAW[k], FALLBACK[k]); });

// Asegura que D.actores siempre tenga nombre+color usable
const ACTORES = (D.actores && D.actores.length ? D.actores : FALLBACK.actores).map((a,i)=>({
  nombre: a.nombre || `Actor ${i+1}`,
  color: a.color || PALETTE[i%PALETTE.length]
}));
const ACTOR_NOMBRES = ACTORES.map(a=>a.nombre);
const ACTOR_COLORS = Object.fromEntries(ACTORES.map(a=>[a.nombre,a.color]));

function actorBadge(nombre){
  const color = ACTOR_COLORS[nombre] || '#555555';
  return `<span class="badge-actor" style="background:${color}22;color:${color}">${nombre}</span>`;
}

Chart.defaults.color = '#1C2738';
Chart.defaults.borderColor = 'rgba(0,0,0,0.1)';

// ---------- Header ----------
root.querySelector('#c-alerta-txt').textContent = `${D.alertaPrincipal.nivel || 'Sin datos'} — ${D.alertaPrincipal.actor || ''}`.trim();
root.querySelector('#c-periodo-txt').textContent = `Corte: ${D.periodo.corte || 'Sin datos'} · Periodo: ${D.periodo.rango || 'Sin datos'}`;
root.querySelector('#c-ftr-actores').textContent = `RADAR · ANÁLISIS BIVARIADO · Comparativo: ${ACTOR_NOMBRES.join(' · ')}`;

// ---------- Tabs ----------
const TABS = [
 {id:'c-kpis',label:'KPIs Ampliados'},
 {id:'c-sentimiento',label:'Sentimiento'},
 {id:'c-topofmind',label:'Top of Mind'},
 {id:'c-picos',label:'Picos'},
 {id:'c-plataformas',label:'Plataformas'},
 {id:'c-nube',label:'Nube y Hashtags'},
 {id:'c-narrativas',label:'Narrativas'},
 {id:'c-riesgos',label:'Riesgos y Oportunidades'},
 {id:'c-territorial',label:'Territorial'}
];

const nav = root.querySelector('#c-tabnav');
TABS.forEach((t,i)=>{
  const b = document.createElement('button');
  b.textContent = t.label; b.dataset.tab = t.id;
  if(i===0) b.classList.add('active');
  b.onclick = ()=>showTab(t.id);
  nav.appendChild(b);
});

function showTab(id){
  root.querySelectorAll('#c-tabnav button').forEach(b=>b.classList.toggle('active', b.dataset.tab===id));
  root.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.id===id));
  renderTab(id);
}

const main = root.querySelector('#c-main');
TABS.forEach(t=>{
  const d = document.createElement('div');
  d.className='tab'; d.id=t.id;
  main.appendChild(d);
});
main.querySelector('#c-kpis').classList.add('active');

const rendered = {};
function renderTab(id){
  if(rendered[id]) return;
  rendered[id]=true;
  ({
    'c-kpis': renderKPIs, 'c-sentimiento': renderSentimiento, 'c-topofmind': renderTopOfMind,
    'c-picos': renderPicos, 'c-plataformas': renderPlataformas, 'c-nube': renderNube,
    'c-narrativas': renderNarrativas, 'c-riesgos': renderRiesgos, 'c-territorial': renderTerritorial
  })[id]();
}
renderTab('c-kpis');

// ===================== 1. KPIs =====================
function renderKPIs(){
  const el = root.querySelector('#c-kpis');
  el.innerHTML = `
  <h2 class="sec">KPIs Ampliados — Sistema RADAR bivariado</h2>
  <p class="lead">${D.resumenKpis}</p>
  <div class="grid g4" id="c-kpiGrid"></div>
  <div class="divider"></div>
  <div class="grid g2">
    <div class="card"><h2 class="sec" style="font-size:15px">NPS-P por actor</h2><div class="chart-box"><canvas id="c-chNPS"></canvas></div>
    <p class="note">${D.npsNote}</p></div>
    <div class="card"><h2 class="sec" style="font-size:15px">Ratio Ataque/Defensa por actor</h2><div class="chart-box"><canvas id="c-chRatio"></canvas></div>
    <p class="note">${D.ratioNote}</p></div>
  </div>
  <div class="divider"></div>
  <div class="card"><h2 class="sec" style="font-size:15px">TRA — Temperatura Reputacional Acumulada (tendencia del periodo)</h2><div class="chart-box"><canvas id="c-chTRA"></canvas></div>
  <p class="note">${D.traNote}</p></div>
  `;

  const grid = el.querySelector('#c-kpiGrid');
  (D.kpiCards||[]).forEach(k=>{
    const c = document.createElement('div');
    c.className='card kpi';
    const colorMap = {g:'#1E8449', a:'#C49A00', r:'#C0392B', n:'#1C2738'};
    c.innerHTML = `<div class="label">${k.label}</div><div class="val" style="color:${colorMap[k.color]||'#1C2738'}">${k.val}</div><div class="sub">${k.sub}</div>`;
    grid.appendChild(c);
  });

  new Chart(el.querySelector('#c-chNPS'), {
    type:'bar',
    data:{labels:ACTOR_NOMBRES, datasets:[{label:'NPS-P estimado', data:D.npsPorActor, backgroundColor:ACTOR_NOMBRES.map(a=>ACTOR_COLORS[a])}]},
    options:{plugins:{legend:{display:false}}, scales:{y:{grid:{color:'rgba(0,0,0,.06)'},ticks:{color:'#1C2738'}},x:{ticks:{color:'#1C2738'},grid:{display:false}}}}
  });
  new Chart(el.querySelector('#c-chRatio'), {
    type:'bar',
    data:{labels:ACTOR_NOMBRES, datasets:[{label:'Ratio Ataque/Defensa', data:D.ratioPorActor, backgroundColor:ACTOR_NOMBRES.map(a=>ACTOR_COLORS[a])}]},
    options:{plugins:{legend:{display:false}}, scales:{y:{grid:{color:'rgba(0,0,0,.06)'},ticks:{color:'#1C2738'}},x:{ticks:{color:'#1C2738'},grid:{display:false}}}}
  });
  new Chart(el.querySelector('#c-chTRA'), {
    type:'line',
    data:{labels:D.traSerie.labels, datasets: ACTOR_NOMBRES.map(a=>({
      label:a, data:(D.traSerie.series||{})[a]||[], borderColor:ACTOR_COLORS[a], backgroundColor:'transparent', tension:.35
    }))},
    options:{plugins:{legend:{labels:{color:'#1C2738'}}}, scales:{y:{grid:{color:'rgba(0,0,0,.06)'},ticks:{color:'#1C2738'}},x:{ticks:{color:'#1C2738'},grid:{display:false}}}}
  });
}

// ===================== 2. SENTIMIENTO =====================
function renderSentimiento(){
  const el = root.querySelector('#c-sentimiento');
  el.innerHTML = `
  <h2 class="sec">Distribución del Sentimiento Digital</h2>
  <p class="lead">Aproximación cualitativa por tono editorial. Selecciona el actor y la variable de cruce bivariado.</p>
  <div class="pill-row"><span class="lbl">Actor:</span><div id="c-sentActorPills"></div></div>
  <div class="pill-row"><span class="lbl">Cruce bivariado:</span><div id="c-sentCrossPills"></div></div>
  <div class="grid g2">
    <div class="card"><h2 class="sec" style="font-size:14px">Sentimiento general</h2><div class="chart-box"><canvas id="c-chSentBar"></canvas></div></div>
    <div class="card"><h2 class="sec" style="font-size:14px" id="c-sentTitle2">Cruce bivariado</h2><div class="chart-box"><canvas id="c-chSentCross"></canvas></div></div>
  </div>
  <div class="card" style="margin-top:14px" id="c-sentInterp"></div>
  `;

  new Chart(el.querySelector('#c-chSentBar'), {
    type:'bar',
    data:{labels:ACTOR_NOMBRES, datasets:[
      {label:'Positivo', data:ACTOR_NOMBRES.map(a=>(D.sentimientoGeneral[a]||[0,0,0,0])[0]), backgroundColor:'#1E8449'},
      {label:'Neutro', data:ACTOR_NOMBRES.map(a=>(D.sentimientoGeneral[a]||[0,0,0,0])[1]), backgroundColor:'#8FA3B1'},
      {label:'Negativo', data:ACTOR_NOMBRES.map(a=>(D.sentimientoGeneral[a]||[0,0,0,0])[2]), backgroundColor:'#C0392B'},
      {label:'Polarizado', data:ACTOR_NOMBRES.map(a=>(D.sentimientoGeneral[a]||[0,0,0,0])[3]), backgroundColor:'#C49A00'}
    ]},
    options:{plugins:{legend:{labels:{color:'#1C2738'}}}, scales:{x:{stacked:true,ticks:{color:'#1C2738'},grid:{display:false}},y:{stacked:true,grid:{color:'rgba(0,0,0,.06)'},ticks:{color:'#1C2738'}}}}
  });

  let currentActor = ACTOR_NOMBRES[0], currentCross = 'edad';
  const actorPills = el.querySelector('#c-sentActorPills');
  ACTOR_NOMBRES.forEach(a=>{
    const p=document.createElement('div'); p.className='pill'+(a===currentActor?' on':''); p.textContent=a;
    p.onclick=()=>{currentActor=a; [...actorPills.children].forEach(x=>x.classList.remove('on')); p.classList.add('on'); updateCross();};
    actorPills.appendChild(p);
  });
  const crossPills = el.querySelector('#c-sentCrossPills');
  [['edad','Edad'],['genero','Género'],['partido','Partido']].forEach(([k,label])=>{
    const p=document.createElement('div'); p.className='pill alt'+(k===currentCross?' on':''); p.textContent=label;
    p.onclick=()=>{currentCross=k; [...crossPills.children].forEach(x=>x.classList.remove('on')); p.classList.add('on'); updateCross();};
    crossPills.appendChild(p);
  });

  let crossChart;
  function updateCross(){
    const cfg = D.sentimientoCruces[currentCross] || {segments:[],data:{},note:''};
    const segs = cfg.segments||[];
    const actorData = (cfg.data||{})[currentActor] || {};
    const rows = segs.map(s=>actorData[s]||[0,0,0,0]);
    el.querySelector('#c-sentTitle2').textContent = `Sentimiento de ${currentActor} por ${currentCross==='edad'?'Edad':currentCross==='genero'?'Género':'Partido'}`;
    const datasets = [
      {label:'Positivo', data:rows.map(r=>r[0]), backgroundColor:'#1E8449'},
      {label:'Neutro', data:rows.map(r=>r[1]), backgroundColor:'#8FA3B1'},
      {label:'Negativo', data:rows.map(r=>r[2]), backgroundColor:'#C0392B'},
      {label:'Polarizado', data:rows.map(r=>r[3]), backgroundColor:'#C49A00'}
    ];
    if(crossChart){ crossChart.data.labels=segs; crossChart.data.datasets=datasets; crossChart.update(); }
    else {
      crossChart = new Chart(el.querySelector('#c-chSentCross'), {
        type:'bar',
        data:{labels:segs, datasets},
        options:{indexAxis: currentCross==='partido'?'y':'x', plugins:{legend:{labels:{color:'#1C2738'}}},
          scales:{x:{stacked:true,ticks:{color:'#1C2738'},grid:{display:false}},y:{stacked:true,grid:{color:'rgba(0,0,0,.06)'},ticks:{color:'#1C2738'}}}}
      });
    }
    el.querySelector('#c-sentInterp').innerHTML = `<p style="font-size:12.5px;color:#1C2738;margin:0">${cfg.note||''}</p>`;
  }
  updateCross();
}

// ===================== 3. TOP OF MIND =====================
function renderTopOfMind(){
  const el = root.querySelector('#c-topofmind');
  const rows = D.topOfMindTabla||[];
  el.innerHTML = `
  <h2 class="sec">Principales Temas / Top of Mind</h2>
  <p class="lead">${D.topOfMindLead}</p>
  <div class="card" style="margin-bottom:16px"><table><thead><tr><th>Tema</th><th>Peso relativo</th><th>Actor(es) que más lo capitaliza(n)</th></tr></thead>
  <tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>
  <div class="divider"></div>
  <h2 class="sec" style="font-size:16px">Cruce bivariado del Top of Mind</h2>
  <div class="pill-row"><span class="lbl">Cruce bivariado:</span><div id="c-tomCrossPills"></div></div>
  <div class="card"><div class="chart-box lg"><canvas id="c-chTomCross"></canvas></div></div>
  <div class="card" style="margin-top:14px" id="c-tomInterp"></div>
  `;

  let currentTomCross = 'edad';
  const tomPills = el.querySelector('#c-tomCrossPills');
  [['edad','Edad'],['genero','Género'],['partido','Partido']].forEach(([k,label])=>{
    const p=document.createElement('div'); p.className='pill alt'+(k===currentTomCross?' on':''); p.textContent=label;
    p.onclick=()=>{currentTomCross=k; [...tomPills.children].forEach(x=>x.classList.remove('on')); p.classList.add('on'); updateTom();};
    tomPills.appendChild(p);
  });

  let tomChart;
  const paletteThemes = ['#00A8B5','#C0392B','#D35400','#1E8449','#1B4F8A','#C49A00'];
  function updateTom(){
    const cfg = D.topOfMindCruces[currentTomCross] || {segments:[],themes:[],data:{},note:''};
    const datasets = (cfg.themes||[]).map((th,i)=>({
      label:th,
      data:(cfg.segments||[]).map((s,si)=>((cfg.data||{})[th]||[])[si]||0),
      backgroundColor: paletteThemes[i%paletteThemes.length]
    }));
    if(tomChart){ tomChart.data.labels=cfg.segments; tomChart.data.datasets=datasets; tomChart.update(); }
    else {
      tomChart = new Chart(el.querySelector('#c-chTomCross'), {
        type:'bar',
        data:{labels:cfg.segments||[], datasets},
        options:{plugins:{legend:{labels:{color:'#1C2738',font:{size:10.5}}}},
          scales:{x:{ticks:{color:'#1C2738'},grid:{display:false}},y:{grid:{color:'rgba(0,0,0,.06)'},ticks:{color:'#1C2738'}}}}
      });
    }
    el.querySelector('#c-tomInterp').innerHTML = `<p style="font-size:12.5px;color:#1C2738;margin:0">${cfg.note||''}</p>`;
  }
  updateTom();
}

// ===================== 4. PICOS =====================
function renderPicos(){
  const el = root.querySelector('#c-picos');
  const items = D.picosTabla||[];
  el.innerHTML = `
  <h2 class="sec">Picos de la Conversación (cronología interpretada)</h2>
  <p class="lead">${D.picosLead}</p>
  <div class="card"><table><thead><tr><th>Fecha</th><th>Evento</th><th>Actor</th><th>Efecto</th></tr></thead>
  <tbody>${items.map(i=>`<tr><td>${i[0]}</td><td>${i[1]}</td><td>${actorBadge(i[2])}</td><td>${i[3]}</td></tr>`).join('')}</tbody></table></div>
  <div class="divider"></div>
  <div class="card"><h2 class="sec" style="font-size:15px">Evolución del NPS-P estimado (picos marcados)</h2><div class="chart-box"><canvas id="c-chPicos"></canvas></div></div>
  `;
  const series = D.picosSerie.series || {};
  new Chart(el.querySelector('#c-chPicos'), {
    type:'line',
    data:{labels:D.picosSerie.labels||[], datasets: Object.keys(series).map(nombre=>({
      label:nombre, data:series[nombre], borderColor:ACTOR_COLORS[nombre]||'#555555',
      backgroundColor:(ACTOR_COLORS[nombre]||'#555555')+'14', fill:false, tension:.3, pointRadius:3
    }))},
    options:{plugins:{legend:{labels:{color:'#1C2738'}}}, scales:{y:{grid:{color:'rgba(0,0,0,.06)'},ticks:{color:'#1C2738'}},x:{ticks:{color:'#1C2738'},grid:{display:false}}}}
  });
}

// ===================== 5. PLATAFORMAS =====================
function renderPlataformas(){
  const el = root.querySelector('#c-plataformas');
  const notas = D.plataformasNotas||[];
  el.innerHTML = `
  <h2 class="sec">Engagement por Plataforma</h2>
  <p class="lead">${D.plataformasLead}</p>
  <div class="card"><div class="chart-box"><canvas id="c-chPlat"></canvas></div></div>
  <div class="divider"></div>
  <div class="grid g2">
    ${notas.map(n=>`<div class="card"><h4 style="margin-top:0;color:${n.color||'#1C2738'}">${n.titulo}</h4><p style="font-size:12.5px;color:#1C2738">${n.texto}</p></div>`).join('')}
  </div>
  `;
  const platData = D.plataformasRadar || {labels:[],data:{}};
  new Chart(el.querySelector('#c-chPlat'), {
    type:'radar',
    data:{labels:platData.labels||[], datasets: ACTOR_NOMBRES.map(a=>({
      label:a, data:(platData.data||{})[a]||[], borderColor:ACTOR_COLORS[a], backgroundColor:ACTOR_COLORS[a]+'22'
    }))},
    options:{plugins:{legend:{labels:{color:'#1C2738'}}}, scales:{r:{angleLines:{color:'rgba(0,0,0,.1)'},grid:{color:'rgba(0,0,0,.1)'},pointLabels:{color:'#1C2738'},ticks:{display:false}}}}
  });
}

// ===================== 6. NUBE Y HASHTAGS =====================
function buildCloud(words){
  if(!words || !words.length) return '<span>Sin datos</span>';
  const max=Math.max(...words.map(w=>w.weight));
  const min=Math.min(...words.map(w=>w.weight));
  return words.map(w=>{
    const t=(w.weight-min)/((max-min)||1);
    const size=(12+t*30).toFixed(0);
    const color=SENT_COLOR[w.sentiment]||'#555555';
    const fw=t>0.6?800:t>0.3?700:500;
    return `<span style="font-size:${size}px;color:${color};font-weight:${fw}" title="${w.word} · peso ${w.weight} · ${w.sentiment}">${w.word}</span>`;
  }).join(' ');
}
function renderNube(){
  const el = root.querySelector('#c-nube');
  const hashtags = D.hashtags||[];
  el.innerHTML = `
  <h2 class="sec">Nube de Palabras</h2>
  <p class="lead">${D.nubeLead}</p>
  <div class="card wordcloud">${buildCloud(D.nubePalabras)}</div>
  <p class="note">${D.nubeNota}</p>
  <div class="divider"></div>
  <h2 class="sec">Análisis de Hashtags</h2>
  <div class="grid g2">
    <div class="card"><div class="chart-box"><canvas id="c-chHash"></canvas></div></div>
    <div class="card" style="overflow:auto;max-height:360px;"><table><thead><tr><th>Hashtag</th><th>Actor</th><th>Tono</th><th>Origen</th></tr></thead>
    <tbody>${hashtags.map(h=>`<tr><td>${h[0]}</td><td>${h[1]}</td><td>${h[2]}</td><td>${h[4]}</td></tr>`).join('')}</tbody></table></div>
  </div>
  <p class="note">${D.hashtagsNota}</p>
  `;
  const tone2color = t => (t||'').includes('Positivo')?'#1E8449':(t||'').includes('Negativo')?'#C0392B':(t||'').includes('Polarizado')?'#C49A00':'#555555';
  new Chart(el.querySelector('#c-chHash'), {
    type:'bar',
    data:{labels:hashtags.map(h=>h[0]), datasets:[{label:'Frecuencia relativa', data:hashtags.map(h=>h[5]||0), backgroundColor:hashtags.map(h=>tone2color(h[2]))}]},
    options:{indexAxis:'y', plugins:{legend:{display:false}}, scales:{x:{grid:{color:'rgba(0,0,0,.06)'},ticks:{color:'#1C2738'}},y:{ticks:{color:'#1C2738',font:{size:10}},grid:{display:false}}}}
  });
}

// ===================== 7. NARRATIVAS =====================
function renderNarrativas(){
  const el = root.querySelector('#c-narrativas');
  const items = D.narrativas||[];
  const favorables = items.filter(n=>n.tipo==='favorable');
  const criticas = items.filter(n=>n.tipo==='critica');
  const ambivalentes = items.filter(n=>n.tipo==='ambivalente');
  const col = (list, titleColor)=> list.map(n=>`
    <div class="card"><h4 style="color:${titleColor}">${n.titulo}</h4>
      <p style="font-size:12.5px;color:#1C2738">${n.texto}</p>
      ${actorBadge(n.actor)}
      ${n.bivariado?`<p class="biv" style="color:#444444;font-size:11.5px;margin-top:8px;font-style:italic">Bivariado: ${n.bivariado}</p>`:''}
    </div>`).join('');
  el.innerHTML = `
  <h2 class="sec">Narrativas — Favorables, Críticas y Ambivalentes</h2>
  <div class="grid g3">
    <div><h3 style="font-size:14px;color:#1E8449">Favorables</h3>${col(favorables,'#1E8449')}</div>
    <div><h3 style="font-size:14px;color:#C0392B">Críticas</h3>${col(criticas,'#C0392B')}</div>
    <div><h3 style="font-size:14px;color:#555555">Ambivalentes</h3>${col(ambivalentes,'#555555')}</div>
  </div>
  <div class="divider"></div>
  <p class="note" style="margin-top:16px">${D.narrativasCierre}</p>
  `;
}

// ===================== 8. RIESGOS =====================
function renderRiesgos(){
  const el = root.querySelector('#c-riesgos');
  const risks = D.riesgos||[];
  const opps = D.oportunidades||[];
  const alertaTabla = D.alertaTabla||[];
  el.innerHTML = `
  <h2 class="sec">Matriz de Riesgos y Oportunidades</h2>
  <div class="grid g2">
    <div class="risk-col"><h4>⚠ Riesgos</h4>${risks.map(r=>`<div class="risk-item"><span class="lvl" style="color:${r[0]==='ALTO'?'#C0392B':r[0]==='MEDIO'?'#C49A00':'#555555'}">${r[0]}</span><div style="font-weight:700;margin:4px 0">${r[1]}</div><div style="font-size:12.5px;color:#1C2738">${r[2]}</div>${r[3]?`<div class="biv">Bivariado: ${r[3]}</div>`:''}</div>`).join('')}</div>
    <div class="risk-col"><h4>✓ Oportunidades</h4>${opps.map(r=>`<div class="risk-item opp"><span class="lvl" style="color:#1E8449">${r[0]}</span><div style="font-weight:700;margin:4px 0">${r[1]}</div><div style="font-size:12.5px;color:#1C2738">${r[2]}</div>${r[3]?`<div class="biv">Bivariado: ${r[3]}</div>`:''}</div>`).join('')}</div>
  </div>
  <div class="divider"></div>
  <h2 class="sec" style="font-size:16px">Comparativo de nivel de alerta por actor</h2>
  <div class="card"><table><thead><tr><th>Actor</th><th>Nivel de alerta</th><th>Justificación breve</th></tr></thead>
  <tbody>${alertaTabla.map(r=>`<tr><td>${actorBadge(r[0])}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>
  <div class="divider"></div>
  <h2 class="sec" style="font-size:16px">Nivel de Alerta — Escenarios de Movimiento</h2>
  <div class="grid g2">
    <div class="card"><h4 style="color:#C0392B;margin-top:0">Sube el nivel si...</h4><p style="font-size:12.5px;color:#1C2738">${D.escenarioSube}</p></div>
    <div class="card"><h4 style="color:#1E8449;margin-top:0">Baja el nivel si...</h4><p style="font-size:12.5px;color:#1C2738">${D.escenarioBaja}</p></div>
  </div>
  `;
}

// ===================== 9. TERRITORIAL =====================
function renderTerritorial(){
  const el = root.querySelector('#c-territorial');
  const rows = D.territorialTabla||[];
  el.innerHTML = `
  <h2 class="sec">Segmentación Territorial</h2>
  <p class="lead">${D.territorialLead}</p>
  <div class="card"><table><thead><tr><th>Región / municipio</th><th>Actor con mayor presencia</th><th>Nota</th></tr></thead>
  <tbody>${rows.map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody></table></div>
  ${D.territorialAlerta ? `<div class="divider"></div><div class="card"><h4 style="color:var(--red);margin-top:0">⚠ ${D.territorialAlerta.titulo}</h4><p style="font-size:12.5px;color:#1C2738">${D.territorialAlerta.texto}</p></div>` : ''}
  `;
}

})();
