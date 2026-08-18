(function(){
const D_RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('emo-root');

// 8 emociones fijas de Plutchik: geometría/color no dependen de la IA
const EMOTION_META = [
  {key:'ira',          label:'Ira / Furia',        sublabel:'Furia · Ira · Indignación',              deg:180, color:['#FEE2E2','#FCA5A5','#B91C1C']},
  {key:'miedo',        label:'Miedo / Terror',     sublabel:'Terror · Miedo · Aprensión',              deg:0,   color:['#CFFAFE','#67E8F9','#0E7490']},
  {key:'anticipacion', label:'Anticipación',        sublabel:'Vigilancia · Esperanza condicionada',     deg:225, color:['#FFEDD5','#FDBA74','#C2410C']},
  {key:'tristeza',     label:'Tristeza / Abandono', sublabel:'Aflicción · Melancolía · Desamparo',      deg:90,  color:['#EDE9FE','#A78BFA','#4C1D95']},
  {key:'asco',         label:'Asco / Aversión',     sublabel:'Aversión · Indignación moral · Descrédito',deg:135, color:['#DCFCE7','#86EFAC','#15803D']},
  {key:'alegria',      label:'Alegría',              sublabel:'Éxtasis · Alegría · Serenidad',           deg:-90, color:['#FFF9C4','#FFF176','#F9A825']},
  {key:'confianza',    label:'Confianza',            sublabel:'Admiración · Confianza · Aceptación',     deg:-45, color:['#D1FAE5','#6EE7B7','#059669']},
  {key:'sorpresa',     label:'Sorpresa',             sublabel:'Asombro · Distracción · Reencuadre',      deg:45,  color:['#DBEAFE','#93C5FD','#2563EB']},
];
const RADAR_LABELS = ["Legitimidad ciudadana","Presencia territorial","Capital positivo","Riesgo castigo","Cap. gestión","Credibilidad"];
const RISK_HEX = {"CRÍTICO":"#ef4444","ALTO":"#f97316","MEDIO":"#b45309","BAJO":"#64748b"};
const RISK_BG  = {"CRÍTICO":"#fee2e2","ALTO":"#ffedd5","MEDIO":"#fef9c3","BAJO":"#f1f5f9"};
const PALETTE = ['#3b82f6','#f97316','#22c55e','#a855f7','#06b6d4','#eab308','#ef4444','#64748b'];

const FALLBACK = {
  territory: META.actor || 'Sin datos',
  subtitle: '',
  date: (META.mes||'')+' '+(META.anio||''),
  riskLevel: 'MEDIO',
  ivEstimado: 0,
  concept: 'Sin datos',
  conceptDesc: 'No se recibieron datos estructurados del backend.',
  emotions: EMOTION_META.map(e=>({key:e.key, active:false, intensity:0, triggers:[], consequences:[]})),
  secondary: [],
  problematics: [], fears: [], prides: [],
  quotes: [],
  temasChart: [['Sin datos', 0, '#94a3b8']],
  semaforo: [],
  dyads: [], dyadInterp: '',
  preguntaPolitica: '', preguntaDesc: '',
  govSemaforo: [],
  partidos: [], partidosChart: [],
  actores: [], actoresRadar: {labels:[], data:[], colors:[]},
  alertaEstrategica: '', alertaDesc: '',
  recs: [], evitar: [], gestionPrioridad: [['Sin datos', 0, '#94a3b8']],
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
const nameParts = (D.territory || '').split(' ');
document.getElementById('em-hdr-name').innerHTML = (nameParts[0]||'').toUpperCase() + ' <span>' + nameParts.slice(1).join(' ').toUpperCase() + '</span>';
document.getElementById('em-hdr-sub').textContent = D.subtitle || D.date || '';
document.getElementById('em-whl-territory').textContent = D.territory || '';
document.getElementById('em-ftr-l').textContent = 'RADAR - Emociones · ' + (D.territory||'');

// ---------- tabs ----------
window.emST = function(id, el){
  root.querySelectorAll('.pnl').forEach(p=>p.classList.remove('on'));
  root.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('empnl-'+id).classList.add('on');
  el.classList.add('on');
};
window.emToggleEm = function(el){ el.querySelector('.emd-box').classList.toggle('open'); };

// ---------- rueda de Plutchik ----------
function buildWheel(emotions){
  const S=380,cx=S/2,cy=S/2,rings=[72,112,150];
  let svg=`<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">`;
  emotions.forEach((em,i)=>{
    const a0=(em.deg-22.5)*Math.PI/180,a1=(em.deg+22.5)*Math.PI/180;
    [0,1,2].forEach(r=>{
      const r0=rings[r],r1=rings[r+1]||rings[r]+38;
      const x1=cx+r0*Math.cos(a0),y1=cy+r0*Math.sin(a0);
      const x2=cx+r1*Math.cos(a0),y2=cy+r1*Math.sin(a0);
      const x3=cx+r1*Math.cos(a1),y3=cy+r1*Math.sin(a1);
      const x4=cx+r0*Math.cos(a1),y4=cy+r0*Math.sin(a1);
      const fill=em.active&&em.intensity>r?em.color[r]:"#e2e8f0";
      svg+=`<path d="M${x1},${y1} L${x2},${y2} A${r1},${r1} 0 0,1 ${x3},${y3} L${x4},${y4} A${r0},${r0} 0 0,0 ${x1},${y1}" fill="${fill}" stroke="#ffffff" stroke-width="1.5" style="cursor:${em.active?'pointer':'default'}" onclick="document.querySelectorAll('#emo-root .emr')[${i}] && emToggleEm(document.querySelectorAll('#emo-root .emr')[${i}])"/>`;
    });
    const lx=cx+(rings[2]+22)*Math.cos(em.deg*Math.PI/180);
    const ly=cy+(rings[2]+22)*Math.sin(em.deg*Math.PI/180);
    const anchor=Math.abs(em.deg)>90?"end":"start";
    svg+=`<text x="${lx}" y="${ly}" text-anchor="${anchor}" dominant-baseline="middle" fill="${em.active?em.color[2]:'#94a3b8'}" font-size="9" font-weight="${em.active?700:400}" font-family="-apple-system,sans-serif">${em.label.split("/")[0].trim()}</text>`;
  });
  svg+=`<circle cx="${cx}" cy="${cy}" r="50" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1"/>
  <text x="${cx}" y="${cy-8}" text-anchor="middle" fill="#1d4ed8" font-size="9" font-weight="700" font-family="-apple-system,sans-serif">PLUTCHIK</text>
  <text x="${cx}" y="${cy+6}" text-anchor="middle" fill="#334155" font-size="8" font-family="-apple-system,sans-serif">${(D.territory||'').slice(0,18)}</text>
  <text x="${cx}" y="${cy+18}" text-anchor="middle" fill="#64748b" font-size="7" font-family="-apple-system,sans-serif">${D.date||''}</text></svg>`;
  return svg;
}

function init(){
  // merge geometría fija + datos de la IA por key
  const emotions = EMOTION_META.map(meta => {
    const d = (D.emotions || []).find(e=>e.key===meta.key) || {};
    return {...meta, active: !!d.active, intensity: d.intensity||0, triggers: d.triggers||[], consequences: d.consequences||[]};
  });

  const activeCount = emotions.filter(e=>e.active).length;
  const maxIntensity = Math.max(0, ...emotions.map(e=>e.intensity));
  document.getElementById('em-kpis').innerHTML = `
    <div class="card2"><div class="cv">Nivel de Riesgo</div><div class="cval" style="color:#e11d48">${D.riskLevel}</div><div class="csub">Clasificación general</div></div>
    <div class="card2"><div class="cv">Emociones Activas</div><div class="cval" style="color:#1d4ed8">${activeCount}<span style="font-size:1rem;color:var(--tx3)">/8</span></div><div class="csub">Rueda de Plutchik</div></div>
    <div class="card2"><div class="cv">Intensidad Máxima</div><div class="cval" style="color:#b91c1c">${["○","●","●●","●●●"][maxIntensity]||'○'}</div><div class="csub">Emoción dominante</div></div>
    <div class="card2"><div class="cv">IVE Estimado</div><div class="cval" style="color:#6b21a8">${D.ivEstimado}<span style="font-size:1rem">/100</span></div><div class="csub">Volatilidad</div></div>`;

  document.getElementById('em-wheel-wrap').innerHTML = buildWheel(emotions);
  const firstActive = emotions.find(e=>e.active && e.intensity>0);
  if(firstActive){
    document.getElementById('em-leg-hi').style.background = firstActive.color[2];
    document.getElementById('em-leg-md').style.background = firstActive.color[1];
  }

  document.getElementById('em-list').innerHTML = emotions.map((em,i)=>`
    <div class="emr" onclick="emToggleEm(this)">
      <div class="emh">
        <div style="width:8px;height:8px;border-radius:50%;background:${em.active?em.color[2]:'#cbd5e1'};flex-shrink:0"></div>
        <div style="font-size:12.5px;font-weight:${em.active?700:400};color:${em.active?'var(--tx1)':'var(--tx3)'};flex:1">${em.label}</div>
        <div style="font-size:10px;color:${em.active?em.color[2]:'var(--tx3)'}">${em.active?["●○○","●●○","●●●"][em.intensity-1]||"":"○○○"}</div>
      </div>
      <div class="emd-box">
        ${em.active&&em.triggers.length?`<div class="edk">Detonantes</div><div class="edv">${em.triggers.map(t=>`• ${t}`).join("<br>")}</div>`:""}
        ${em.active&&em.consequences.length?`<div class="edk" style="margin-top:6px">Consecuencias</div><div class="edv">${em.consequences.map(c=>`• ${c}`).join("<br>")}</div>`:""}
        ${!em.active?`<div class="edv">Sin activación relevante detectada en el periodo.</div>`:""}
      </div>
    </div>`).join('');

  document.getElementById('em-sec').innerHTML = (D.secondary||[]).map((s,i)=>`
    <div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--brd)">
      <div style="width:7px;height:7px;border-radius:50%;background:${s.color||PALETTE[i%PALETTE.length]};flex-shrink:0;margin-top:4px"></div>
      <div><div style="font-size:12px;font-weight:700;color:var(--tx1)">${s.name}</div><div style="font-size:11px;color:var(--tx3);margin-top:2px;line-height:1.55">${s.text}</div></div>
    </div>`).join('') || '<div style="font-size:11px;color:var(--tx3)">Sin emociones secundarias detectadas.</div>';

  document.getElementById('em-concepto-box').innerHTML = `<div class="cbox-label">Concepto Central del Territorio</div><div class="cbox-name">"${D.concept}"</div><div class="cbox-text">${D.conceptDesc}</div>`;

  const makeMP = (arr,dc) => (arr||[]).map(t=>`<div class="mpi"><div class="mpd" style="background:${dc}"></div>${t}</div>`).join('');
  document.getElementById('em-mapa-cols').innerHTML = `
    <div class="mpc"><div class="mptt" style="color:#b45309">⚠ Problemáticas</div>${makeMP(D.problematics,'#b45309') || '<div class="mpi">Sin datos.</div>'}</div>
    <div class="mpc"><div class="mptt" style="color:#b91c1c">⬡ Miedos</div>${makeMP(D.fears,'#b91c1c') || '<div class="mpi">Sin datos.</div>'}</div>
    <div class="mpc"><div class="mptt" style="color:#15803d">★ Orgullos</div>${makeMP(D.prides,'#15803d') || '<div class="mpi">Sin datos.</div>'}</div>`;

  document.getElementById('em-quotes').innerHTML = (D.quotes||[]).map(q=>`<div class="qi"><div class="qt">${q.text}</div><div class="qm">${q.topic} · ${q.emotion} · ${q.territory}</div></div>`).join('') || '<div class="qi"><div class="qt">Sin frases ciudadanas disponibles.</div></div>';

  const makeSem = (arr, id) => { 
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = (arr||[]).map(s=>`<div class="sem"><div class="semd" style="background:${s.color||'#94a3b8'}"></div><div class="seml">${s.label}</div><div class="semv" style="color:${s.color||'#94a3b8'}">${s.val}</div></div>`).join('') || '<div class="sem"><div class="seml">Sin datos.</div></div>'; 
  };
  makeSem(D.semaforo, 'em-semaforo');
  makeSem(D.govSemaforo, 'em-gov-sem');

  document.getElementById('em-dyad-cards').innerHTML = (D.dyads||[]).map(d=>`
    <div class="dyc" style="border-top-color:${RISK_HEX[d.risk]||'#64748b'}">
      <span class="dybadge" style="background:${RISK_BG[d.risk]||'#f1f5f9'};color:${RISK_HEX[d.risk]||'#64748b'}">${d.risk}</span>
      <div class="dyn" style="color:${RISK_HEX[d.risk]||'var(--tx1)'}">${d.name}</div>
      <div class="dyf">Díada ${d.type} · ${d.formula}</div>
      <div class="dyt">${d.text}</div>
    </div>`).join('') || '<div class="dyc">Sin díadas detectadas.</div>';
  document.getElementById('em-dyad-interp').innerHTML = D.dyadInterp || 'Sin interpretación disponible.';

  document.getElementById('em-id-pregunta').innerHTML = `<div class="cbox-label">Pregunta Política del Territorio</div><div class="cbox-name" style="font-size:18px">"${D.preguntaPolitica}"</div><div class="cbox-text">${D.preguntaDesc}</div>`;

  document.getElementById('em-partidos-tbl').innerHTML = (D.partidos||[]).map(p=>`
    <div style="display:grid;grid-template-columns:1.3fr 2fr 1fr 1fr;gap:.5rem;padding:8px 0;border-bottom:1px solid var(--brd);font-size:12px">
      <div style="font-weight:700;color:var(--tx1)">${p.nombre}</div>
      <div style="color:var(--tx2)">${p.emocion}</div>
      <div style="color:var(--tx3)">${p.capital}</div>
      <div style="color:${(p.tendencia||'').includes('↓')?'#b91c1c':(p.tendencia||'').includes('↑')?'#166534':'#475569'};font-weight:600">${p.tendencia}</div>
    </div>`).join('') || '<div style="font-size:11px;color:var(--tx3)">Sin datos.</div>';

  document.getElementById('em-actores-label').textContent = 'ANÁLISIS COMPARATIVO DE ACTORES · ' + (D.date||'');
  document.getElementById('em-actores-grid').innerHTML = (D.actores||[]).map((a,i)=>`
    <div class="ac">
      <div class="ach" style="border-left:4px solid ${a.borderColor||PALETTE[i%PALETTE.length]}"><div class="acn">${a.name}</div><div class="acr">${a.role}</div></div>
      <div class="acb">${(a.rows||[]).map(r=>`<div class="acrow"><span class="ack">${r[0]}</span><span class="acv">${r[1]}</span></div>`).join('')}</div>
    </div>`).join('') || '<div class="ac"><div class="acb">Sin actores disponibles.</div></div>';

  document.getElementById('em-alerta-box').innerHTML = `<div class="cbox-label" style="color:var(--red-s)">Alerta Estratégica</div><div class="cbox-name" style="font-size:16px;color:var(--red-s)">${D.alertaEstrategica}</div><div class="cbox-text">${D.alertaDesc}</div>`;
  document.getElementById('em-recs-list').innerHTML = (D.recs||[]).map(r=>`<div class="ri"><span class="rb" style="background:${r.bg||'#e2e8f0'};color:${r.tx||'#1e293b'}">${r.label||r.urgencia||''}</span><span class="rt">${r.text}</span></div>`).join('') || '<div class="ri"><span class="rt">Sin recomendaciones disponibles.</span></div>';
  document.getElementById('em-evitar-list').innerHTML = (D.evitar||[]).map(e=>`<div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--brd);font-size:12px;color:var(--tx2)"><span style="color:#ef4444;flex-shrink:0">✕</span>${e}</div>`).join('') || '<div style="font-size:11px;color:var(--tx3)">Sin datos.</div>';

  /* CHARTS */
  const CDf = {responsive:true,maintainAspectRatio:false,
    plugins:{legend:{display:false},tooltip:{backgroundColor:'#ffffff',titleColor:'#1e293b',bodyColor:'#475569',borderColor:'#cbd5e1',borderWidth:1,padding:10}},
    scales:{x:{grid:{color:'rgba(0,0,0,.05)'},ticks:{color:'#475569',font:{size:10}}}, y:{grid:{color:'rgba(0,0,0,.05)'},ticks:{color:'#475569',font:{size:10}}}}};

  const acEm = emotions.filter(e=>e.active);
  const intensCanvas = document.getElementById('em-ch-intens');
  if(intensCanvas && acEm.length > 0){
    new Chart(intensCanvas,{type:'bar',
      data:{labels:acEm.map(e=>e.label),datasets:[{data:acEm.map(e=>e.intensity),backgroundColor:acEm.map(e=>e.color[2]+'cc'),borderColor:acEm.map(e=>e.color[2]),borderWidth:1,borderRadius:5,borderSkipped:false}]},
      options:{...CDf, indexAxis:'y', plugins:{...CDf.plugins,tooltip:{...CDf.plugins.tooltip,callbacks:{label:c=>' '+['Inactiva','Baja','Media','Alta'][c.raw]||''}}},
        scales:{x:{...CDf.scales.x,min:0,max:3,ticks:{...CDf.scales.x.ticks,stepSize:1,callback:v=>['○○○','●○○','●●○','●●●'][v]||''}},y:{...CDf.scales.y}}}
    });
  }

  const temasCanvas = document.getElementById('em-ch-temas');
  const temasData = (D.temasChart||[]).filter(t=>Array.isArray(t)&&t.length>=2);
  if(temasCanvas && temasData.length > 0){
    new Chart(temasCanvas,{type:'doughnut',
      data:{labels:temasData.map(t=>t[0]),datasets:[{data:temasData.map(t=>t[1]),backgroundColor:temasData.map(t=>t[2]||'#94a3b8'),borderColor:'#d5d1d1',borderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:'right',labels:{color:'#334155',font:{size:11},boxWidth:12,padding:10}},tooltip:{...CDf.plugins.tooltip,callbacks:{label:c=>' '+c.label+': '+c.raw+'%'}}}}
    });
  }

  const diadasCanvas = document.getElementById('em-ch-diadas');
  const dyadsData = (D.dyads||[]).filter(d=>d.score!==undefined);
  if(diadasCanvas && dyadsData.length > 0){
    new Chart(diadasCanvas,{type:'bar',
      data:{labels:dyadsData.map(d=>d.name),datasets:[{label:'Score de riesgo',data:dyadsData.map(d=>d.score),backgroundColor:dyadsData.map(d=>(RISK_HEX[d.risk]||'#64748b')+'cc'),borderColor:dyadsData.map(d=>RISK_HEX[d.risk]||'#64748b'),borderWidth:1,borderRadius:6,borderSkipped:false}]},
      options:{...CDf, plugins:{...CDf.plugins,legend:{display:false}}, scales:{x:{...CDf.scales.x},y:{...CDf.scales.y,min:0,max:100,ticks:{...CDf.scales.y.ticks,callback:v=>v+'/100'}}}}
    });
  }

  const partidosCanvas = document.getElementById('em-ch-partidos');
  const partidosChartData = (D.partidosChart||[]).filter(x=>Array.isArray(x)&&x.length>=3);
  const partidosLabels = (D.partidos||[]).map(p=>p.nombre);
  if(partidosCanvas && partidosChartData.length > 0 && partidosLabels.length > 0){
    new Chart(partidosCanvas,{type:'bar',
      data:{labels:partidosLabels,datasets:[
        {label:'Ira/Asco',       data:partidosChartData.map(x=>x[0]||0),        backgroundColor:'#B91C1Caa',borderRadius:4,borderSkipped:false},
        {label:'Decep/Tristeza', data:partidosChartData.map(x=>x[1]||0),backgroundColor:'#4C1D95aa',borderRadius:4,borderSkipped:false},
        {label:'Interés disp.',  data:partidosChartData.map(x=>x[2]||0),backgroundColor:'#059669aa',borderRadius:4,borderSkipped:false},
      ]},
      options:{...CDf, plugins:{...CDf.plugins,legend:{display:true,labels:{color:'#334155',font:{size:10},boxWidth:10}}},
        scales:{x:{...CDf.scales.x},y:{...CDf.scales.y,min:0,max:100,ticks:{...CDf.scales.y.ticks,callback:v=>v+'%'}}}}
    });
  }

  const ar = D.actoresRadar || {};
  const actoresCanvas = document.getElementById('em-ch-actores');
  if (actoresCanvas && ar.labels && ar.labels.length && ar.data && ar.data.length) {
    new Chart(actoresCanvas,{type:'radar',
      data:{labels:RADAR_LABELS, datasets:(ar.labels||[]).map((lbl,i)=>({label:lbl, data:(ar.data[i]||[]).map(v=>v||0), borderColor:ar.colors[i]||PALETTE[i], backgroundColor:(ar.colors[i]||PALETTE[i])+'22', pointBackgroundColor:ar.colors[i]||PALETTE[i], pointRadius:4}))},
      options:{responsive:true,maintainAspectRatio:false,
        scales:{r:{ticks:{color:'#475569',font:{size:9},stepSize:20},grid:{color:'rgba(0,0,0,.08)'},pointLabels:{color:'#334155',font:{size:10}},angleLines:{color:'rgba(0,0,0,.08)'},min:0,max:100}},
        plugins:{legend:{display:true,labels:{color:'#334155',font:{size:11},boxWidth:10}},tooltip:{...CDf.plugins.tooltip}}}
    });
  }

  const priorCanvas = document.getElementById('em-ch-prior');
  const priorData = (D.gestionPrioridad||[]).filter(x=>Array.isArray(x)&&x.length>=2);
  if(priorCanvas && priorData.length > 0){
    new Chart(priorCanvas,{type:'bar',
      data:{labels:priorData.map(x=>x[0]),datasets:[{data:priorData.map(x=>x[1]),backgroundColor:priorData.map(x=>(x[2]||'#94a3b8')+'cc'),borderColor:priorData.map(x=>x[2]||'#94a3b8'),borderWidth:1,borderRadius:5,borderSkipped:false}]},
      options:{...CDf, indexAxis:'y', scales:{x:{...CDf.scales.x,min:0,max:100,ticks:{...CDf.scales.x.ticks,callback:v=>v+'/100'}},y:{...CDf.scales.y}}}
    });
  }
}

init();
})();
