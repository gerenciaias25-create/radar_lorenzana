(function(){
const D_RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('emo-root');

// 8 emociones fijas de Plutchik: geometría/color no dependen de la IA
// "deg" = ángulo de INICIO del pétalo (cada emoción ocupa 45°), igual que en
// el dashboard de referencia EMOCIONES_LA_PIEDAD.
const EMOTION_META = [
  {key:'ira',          label:'Ira / Furia',     sublabel:'Furia · Ira · Enfado',                 deg:180, color:['#FEE2E2','#FCA5A5','#B91C1C']},
  {key:'miedo',        label:'Miedo / Terror',  sublabel:'Terror · Miedo · Temor',               deg:0,   color:['#CFFAFE','#67E8F9','#0E7490']},
  {key:'anticipacion', label:'Anticipación',    sublabel:'Vigilancia · Anticipación · Interés',  deg:225, color:['#FFEDD5','#FDBA74','#C2410C']},
  {key:'tristeza',     label:'Tristeza',        sublabel:'Aflicción · Tristeza · Melancolía',    deg:90,  color:['#EDE9FE','#A78BFA','#4C1D95']},
  {key:'asco',         label:'Asco / Aversión', sublabel:'Aversión · Asco · Aburrimiento',       deg:135, color:['#DCFCE7','#86EFAC','#15803D']},
  {key:'alegria',      label:'Alegría',         sublabel:'Éxtasis · Alegría · Serenidad',        deg:-90, color:['#FFF9C4','#FFF176','#F9A825']},
  {key:'confianza',    label:'Confianza',       sublabel:'Admiración · Confianza · Aceptación',  deg:-45, color:['#D1FAE5','#6EE7B7','#059669']},
  {key:'sorpresa',     label:'Sorpresa',        sublabel:'Asombro · Sorpresa · Distracción',     deg:45,  color:['#DBEAFE','#93C5FD','#2563EB']},
];
const RADAR_LABELS = ["Legitimidad ciudadana","Presencia territorial","Capital positivo","Riesgo castigo","Cap. gestión","Credibilidad"];
// 12 arquetipos junguianos: geometría/orden fijos, igual que EMOTION_META — la IA
// solo entrega los 12 valores del radar (0-5) en este mismo orden.
const ARCHETYPE_LABELS = ["Inocente","Explorador","Sabio","Héroe","Rebelde","Mago","Todos/Hombre común","Amante","Bufón","Cuidador","Gobernante","Guerrero"];
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
  resumenEjecutivo: '',
  segIntro: 'No se recibieron datos estructurados del backend.',
  segmentos: [],
  semiotica: {
    arquetipoColectivo: { dominante: 'Sin datos', secundario: 'Sin datos', emergente: 'Sin datos', rechazado: 'Sin datos' },
    arquetipoPolitico: { ideal: 'Sin datos', secundario: 'Sin datos', resonancia: '—', evidencia: 'Sin datos.' },
    arquetiposRadar: ARCHETYPE_LABELS.map(()=>0),
    miedos: [], deseos: [], necesidades: []
  }
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
// El nombre real siempre es el que el usuario escribió en la búsqueda
// (META.actor) -- nunca el campo "territory" generado por la IA, que puede
// inventar un valor genérico (ej. "México") en vez del nombre de la persona.
// "territory" solo se usa como contexto adicional (entidad/estado) cuando
// está disponible, nunca como el nombre principal del encabezado.
const nombrePrincipal = META.actor || D.territory || 'Sin datos';
const nameParts = nombrePrincipal.split(' ');
document.getElementById('em-hdr-name').innerHTML = (nameParts[0]||'').toUpperCase() + ' <span>' + nameParts.slice(1).join(' ').toUpperCase() + '</span>';
document.getElementById('em-hdr-sub').textContent = D.subtitle || '';
const periodoTxt = META.periodo || D.date || [META.mes, META.anio].filter(Boolean).join(' ');
document.getElementById('em-hero-l').textContent = 'EMOCIONES // HUMOR SOCIAL EMOCIONAL · SEMIÓTICA ● MONITOREO ACTIVO' + (periodoTxt ? ' · ' + periodoTxt : '');
document.getElementById('em-whl-territory').textContent = nombrePrincipal;
document.getElementById('em-ftr-l').textContent = 'RADAR - Emociones · ' + nombrePrincipal;

// ---------- tabs ----------
window.emST = function(id, el){
  root.querySelectorAll('.pnl').forEach(p=>p.classList.remove('on'));
  root.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.getElementById('empnl-'+id).classList.add('on');
  el.classList.add('on');
};
window.emToggleEm = function(key){
  const d = document.getElementById('emd-'+key);
  if(!d) return;
  const open = d.classList.contains('open');
  root.querySelectorAll('.emd-box').forEach(x=>x.classList.remove('open'));
  if(!open) d.classList.add('open');
};

// ---------- rueda de Plutchik ----------
const CX=220, CY=220, WR=[62,108,154,200], GAP=1.4;
const rad = d => d*Math.PI/180;
const pt = (r,d) => [CX+r*Math.cos(rad(d)), CY+r*Math.sin(rad(d))];
function arc(r1,r2,s0,e0){
  const a=s0+GAP, b=e0-GAP;
  const [x1,y1]=pt(r1,a),[x2,y2]=pt(r2,a),[x3,y3]=pt(r2,b),[x4,y4]=pt(r1,b);
  return `M${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}A${r2},${r2} 0 0,1 ${x3.toFixed(2)},${y3.toFixed(2)}L${x4.toFixed(2)},${y4.toFixed(2)}A${r1},${r1} 0 0,0 ${x1.toFixed(2)},${y1.toFixed(2)}Z`;
}
const INACT = ['#e2e8f0','#cbd5e1','#94a3b8'];
function buildWheel(emotions){
  let p = '';
  emotions.forEach(em=>{
    const ac = em.active, iv = em.intensity;
    [1,2,3].forEach(i=>{
      const fill = ac && iv>=i ? em.color[i-1] : INACT[i-1];
      p += `<path d="${arc(WR[i-1],WR[i],em.deg,em.deg+45)}" fill="${fill}" stroke="#ffffff" stroke-width="2" ${ac?`onclick="emToggleEm('${em.key}')" style="cursor:pointer"`:''}/>`;
    });
    const md = em.deg+22.5, lr = WR[3]+23;
    const [lx,ly] = pt(lr,md);
    const an = Math.cos(rad(md))>.12 ? 'start' : Math.cos(rad(md))<-.12 ? 'end' : 'middle';
    p += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${an}" dominant-baseline="middle" font-size="11" font-family="-apple-system,sans-serif" fill="${ac?'#0f172a':'#64748b'}" font-weight="${ac?'700':'400'}" style="pointer-events:none">${em.label}</text>`;
    if(ac && iv===3){
      const [bx,by] = pt(WR[3]+6,md);
      p += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5" fill="${em.color[2]}" style="pointer-events:none"><animate attributeName="opacity" values="1;.25;1" dur="1.6s" repeatCount="indefinite"/></circle>`;
    }
  });
  return `<svg width="440" height="420" viewBox="-100 -10 640 460" style="max-width:100%;height:auto;">${p}<circle cx="${CX}" cy="${CY}" r="${WR[0]-4}" fill="#d5d1d1" stroke="#b0b0b0" stroke-width="1.5"/><text x="${CX}" y="${CY-7}" text-anchor="middle" font-size="9.5" font-family="-apple-system,sans-serif" fill="#475569" font-weight="700" letter-spacing="2">HUMOR</text><text x="${CX}" y="${CY+7}" text-anchor="middle" font-size="9.5" font-family="-apple-system,sans-serif" fill="#475569" font-weight="700" letter-spacing="2">SOCIAL</text></svg>`;
}

function init(){
  // merge geometría fija + datos de la IA por key
  const emotions = EMOTION_META.map(meta => {
    const d = (D.emotions || []).find(e=>e.key===meta.key) || {};
    const iv = Math.max(0, Math.min(3, Math.round(Number(d.intensity)||0)));
    return {...meta, active: !!d.active && iv>0, intensity: iv, triggers: d.triggers||[], consequences: d.consequences||[]};
  });

  const activeCount = emotions.filter(e=>e.active).length;
  const maxIntensity = Math.max(0, ...emotions.map(e=>e.intensity));
  document.getElementById('em-kpis').innerHTML = `
    <div class="card2"><div class="cv">Nivel de Riesgo</div><div class="cval" style="color:#e11d48">${D.riskLevel}</div><div class="csub">Clasificación general</div></div>
    <div class="card2"><div class="cv">Emociones Activas</div><div class="cval" style="color:#1d4ed8">${activeCount}<span style="font-size:1rem;color:var(--tx3)">/8</span></div><div class="csub">Rueda de Plutchik</div></div>
    <div class="card2"><div class="cv">Intensidad Máxima</div><div class="cval" style="color:#b91c1c">${["○","●","●●","●●●"][maxIntensity]||'○'}</div><div class="csub">Emoción dominante</div></div>
    <div class="card2"><div class="cv">IVE Estimado</div><div class="cval" style="color:#6b21a8">${D.ivEstimado}<span style="font-size:1rem">/100</span></div><div class="csub">Volatilidad</div></div>`;

  document.getElementById('em-wheel-wrap').innerHTML = buildWheel(emotions);
  const hiEm = emotions.find(e=>e.active && e.intensity===3) || emotions.find(e=>e.active);
  const mdEm = emotions.find(e=>e.active && e.intensity===2) || hiEm;
  if(hiEm) document.getElementById('em-leg-hi').style.background = hiEm.color[2];
  if(mdEm) document.getElementById('em-leg-md').style.background = mdEm.color[1];

  // Igual que la referencia: solo emociones ACTIVAS, con su sublabel y
  // detonantes/consecuencias al hacer clic (en la rueda o en la lista).
  const activas = emotions.filter(e=>e.active);
  document.getElementById('em-list').innerHTML = activas.map(em=>{
    const iv = em.intensity;
    const riskTx = iv===3 ? 'var(--red-s)' : iv===2 ? 'var(--org-s)' : 'var(--ylw)';
    const dots = '●'.repeat(iv) + '<span style="color:#94a3b8">' + '○'.repeat(3-iv) + '</span>';
    return `<div class="emr" onclick="emToggleEm('${em.key}')">
      <div class="emh">
        <div style="width:10px;height:10px;border-radius:50%;background:${em.color[2]};box-shadow:0 0 6px ${em.color[2]}55;flex-shrink:0"></div>
        <span style="font-size:13px;font-weight:700;color:var(--tx1)">${em.label}</span>
        <span style="margin-left:auto;font-size:13px;color:${riskTx}">${dots}</span>
      </div>
      <div style="font-size:10.5px;color:var(--tx3);margin-top:2px;margin-left:17px">${em.sublabel}</div>
      <div class="emd-box" id="emd-${em.key}">
        ${em.triggers.length?`<div class="edk">Detonantes:</div><div class="edv">${em.triggers.join(' · ')}</div>`:''}
        ${em.consequences.length?`<div class="edk" style="margin-top:5px">Consecuencias:</div><div class="edv">${em.consequences.join(' · ')}</div>`:''}
      </div>
    </div>`;
  }).join('') || '<div class="emr"><div class="edv">Sin emociones activas detectadas en el periodo.</div></div>';

  document.getElementById('em-sec').innerHTML = (D.secondary||[]).map((s,i)=>`
    <div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--brd)">
      <div style="width:7px;height:7px;border-radius:50%;background:${s.color||PALETTE[i%PALETTE.length]};flex-shrink:0;margin-top:4px"></div>
      <div><div style="font-size:12px;font-weight:700;color:var(--tx1)">${s.name}</div><div style="font-size:11px;color:var(--tx3);margin-top:2px;line-height:1.55">${s.text}</div></div>
    </div>`).join('') || '<div style="font-size:11px;color:var(--tx3)">Sin emociones secundarias detectadas.</div>';

  document.getElementById('em-concepto-box').innerHTML = `<div class="cbox-label">Concepto Central del Territorio</div><div class="cbox-name">"${D.concept}"</div><div class="cbox-text">${D.conceptDesc}</div>`;

  const makeMP = (arr,dc) => (arr||[]).map(t=>`<div class="mpi"><div class="mpd" style="background:${dc}"></div>${t}</div>`).join('');
  document.getElementById('em-mapa-cols').innerHTML = `
    <div class="mpc"><div class="mptt" style="color:#b45309">⚠ Problemáticas</div>${makeMP(D.problematics,'#b45309') || '<div class="mpi">Sin datos.</div>'}</div>
    <div class="mpc"><div class="mptt" style="color:#ef4444">⬡ Miedos</div>${makeMP(D.fears,'#ef4444') || '<div class="mpi">Sin datos.</div>'}</div>
    <div class="mpc"><div class="mptt" style="color:#166534">★ Orgullos</div>${makeMP(D.prides,'#166534') || '<div class="mpi">Sin datos.</div>'}</div>`;

  document.getElementById('em-quotes-note').textContent = `Frases construidas a partir de patrones documentados en cobertura periodística regional y declaraciones ciudadanas citadas por medios${periodoTxt ? ' ('+periodoTxt+')' : ''} — no son capturas literales de redes sociales. [ANÁLISIS INFERENCIAL]`;
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

  document.getElementById('em-actores-grid').innerHTML = (D.actores||[]).map((a,i)=>`
    <div class="ac">
      <div class="ach" style="border-left:4px solid ${a.borderColor||PALETTE[i%PALETTE.length]}"><div class="acn">${a.name}</div><div class="acr">${a.role}</div></div>
      <div class="acb">${(a.rows||[]).map(r=>`<div class="acrow"><span class="ack">${r[0]}</span><span class="acv">${r[1]}</span></div>`).join('')}</div>
    </div>`).join('') || '<div class="ac"><div class="acb">Sin actores disponibles.</div></div>';

  /* ---------- Segmentos y Perfiles (SEGMENTA) ---------- */
  document.getElementById('em-seg-intro').innerHTML = D.segIntro || 'Sin datos.';
  document.getElementById('em-seg-cards').innerHTML = (D.segmentos||[]).map(s=>`
    <div class="segcard" style="border-top:3px solid ${s.color||'#64748b'}">
      <div class="seghdr" style="background:rgba(0,0,0,.03)">
        <div>
          <div class="segname">${s.tipo||''} · ${s.nombre||''}</div>
          <div class="segsub">${s.subtitulo||''}</div>
        </div>
        <div class="segmeta">
          <span class="segweight">Peso: ${s.peso||'—'}</span>
          <span class="segpersu" style="background:${s.persuColor||'#64748b'}">${s.persuabilidad||''}</span>
        </div>
      </div>
      <div class="segquote" style="border-left-color:${s.color||'#64748b'}">${s.frase||''}</div>
      <div class="segbody">
        <div>
          <div class="segcol-title">Perfil sociodemográfico</div>
          <div class="segrow"><b>Edad y género</b>${(s.perfil||{}).edad||'—'}</div>
          <div class="segrow"><b>Zona</b>${(s.perfil||{}).zona||'—'}</div>
          <div class="segrow"><b>Ocupación</b>${(s.perfil||{}).ocupacion||'—'}</div>
          <div class="segrow"><b>Escolaridad</b>${(s.perfil||{}).escolaridad||'—'}</div>
          <div class="segrow"><b>Presencia digital</b>${(s.perfil||{}).digital||'—'}</div>
          <div class="segrow"><b>Historia electoral</b>${(s.perfil||{}).historia||'—'}</div>
        </div>
        <div>
          <div class="segcol-title">Mundo emocional y tensiones</div>
          <div class="segrow"><b>Emoción Plutchik</b>${(s.emocional||{}).emocion||'—'}</div>
          <div class="segrow"><b>Vida cotidiana</b>${(s.emocional||{}).cotidiana||'—'}</div>
          <div class="segrow"><b>Tensión activa</b>${(s.emocional||{}).tension||'—'}</div>
          <div class="segrow"><b>Dolor profundo</b>${(s.emocional||{}).dolor||'—'}</div>
          <div class="segrow"><b>Miedo</b>${(s.emocional||{}).miedo||'—'}</div>
          <div class="segrow"><b>Orgullo</b>${(s.emocional||{}).orgullo||'—'}</div>
          <div class="segrow"><b>Narrativa maestra</b>${(s.emocional||{}).narrativa||'—'}</div>
        </div>
        <div>
          <div class="segcol-title">Problemáticas, orgullos y palancas</div>
          <div class="segrow"><b>Problemas críticos</b>${((s.palancas||{}).problemas||[]).map(p=>`<span class="segtag">${p}</span>`).join('')||'—'}</div>
          <div class="segrow"><b>Orgullo comunitario</b>${(s.palancas||{}).orgullo||'—'}</div>
          <div class="segrow"><b>Consumo digital</b>${(s.palancas||{}).consumo||'—'}</div>
          <div class="segrow"><b>Qué lo acerca</b>${(s.palancas||{}).acerca||'—'}</div>
          <div class="segrow"><b>Qué lo aleja</b>${(s.palancas||{}).aleja||'—'}</div>
          <div class="segrow"><b>Frame cognitivo</b>${(s.palancas||{}).frame||'—'}</div>
          <div class="segrow"><b>Palanca</b>${(s.palancas||{}).palanca||'—'}</div>
        </div>
      </div>
      <div class="segfoot">
        <div>📡 ${(s.vector||{}).canal||'—'} &nbsp;·&nbsp; 🎙 ${(s.vector||{}).tono||'—'} &nbsp;·&nbsp; 🎬 ${(s.vector||{}).formato||'—'}</div>
        <div style="font-weight:700;color:${s.color||'#64748b'}">${s.objetivo||''}</div>
      </div>
    </div>`).join('') || '<div class="segcard"><div class="seghdr"><div class="segname">Sin segmentos disponibles.</div></div></div>';

  /* ---------- Semiótica ---------- */
  const SEM = D.semiotica || {};
  const arqC = SEM.arquetipoColectivo || {};
  const arqP = SEM.arquetipoPolitico || {};
  document.getElementById('em-arq-colectivo').innerHTML = `
    <tr><td>Dominante</td><td style="color:var(--tx1);font-weight:700">${arqC.dominante||'Sin datos.'}</td></tr>
    <tr><td>Secundario</td><td>${arqC.secundario||'Sin datos.'}</td></tr>
    <tr><td>Emergente</td><td>${arqC.emergente||'Sin datos.'}</td></tr>
    <tr><td>Rechazado</td><td>${arqC.rechazado||'Sin datos.'}</td></tr>`;
  document.getElementById('em-arq-politico').innerHTML = `
    <tr><td>Arquetipo ideal</td><td style="color:var(--blue2);font-weight:700">${arqP.ideal||'Sin datos.'}</td></tr>
    <tr><td>Resonancia</td><td>${arqP.resonancia||'—'}</td></tr>
    <tr><td>Complementario</td><td>${arqP.secundario||'Sin datos.'}</td></tr>`;
  document.getElementById('em-arq-evidencia').innerHTML = `<b style="color:var(--tx2);text-transform:uppercase;font-size:10px;letter-spacing:.05em">Evidencia y riesgo de sobreactuación</b><br>${arqP.evidencia||'Sin datos.'}`;

  const rkList = (id, arr) => {
    const el = document.getElementById(id);
    if(!el) return;
    el.innerHTML = (arr||[]).map(m=>`
      <div class="rkrow"><div class="rknum">#${m.rank}</div>
      <div><div class="rkname">${m.nombre}</div>
      <div class="rkdesc"><b style="color:var(--tx2)">Evidencia:</b> ${m.evidencia}<br><b style="color:var(--tx2)">Lectura política:</b> ${m.significado}</div></div></div>`).join('') || '<div class="rkrow"><div class="rkname">Sin datos.</div></div>';
  };
  rkList('em-rk-miedos', SEM.miedos);
  rkList('em-rk-deseos', SEM.deseos);
  rkList('em-rk-necesidades', SEM.necesidades);

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
      data:{labels:temasData.map(t=>t[0]),datasets:[{data:temasData.map(t=>t[1]),backgroundColor:temasData.map(t=>t[2]||'#94a3b8'),borderColor:'#ffffff',borderWidth:2}]},
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

  const arquetiposCanvas = document.getElementById('em-ch-arquetipos');
  const arquetiposData = (SEM.arquetiposRadar||[]).length ? SEM.arquetiposRadar : ARCHETYPE_LABELS.map(()=>0);
  if(arquetiposCanvas){
    new Chart(arquetiposCanvas,{type:'radar',
      data:{labels:ARCHETYPE_LABELS,datasets:[{label:'Arquetipo colectivo',data:arquetiposData,borderColor:'#1d4ed8',backgroundColor:'rgba(29,78,216,.18)',pointBackgroundColor:'#1d4ed8',pointRadius:3}]},
      options:{responsive:true,maintainAspectRatio:false,
        scales:{r:{min:0,max:5,ticks:{color:'#475569',font:{size:9},stepSize:1,backdropColor:'transparent'},grid:{color:'rgba(0,0,0,.1)'},pointLabels:{color:'#334155',font:{size:10}},angleLines:{color:'rgba(0,0,0,.1)'}}},
        plugins:{legend:{display:false},tooltip:{...CDf.plugins.tooltip}}}
    });
  }

  const miedosDeseosCanvas = document.getElementById('em-ch-miedosdeseos');
  const top5M = (SEM.miedos||[]).slice(0,5), top5D = (SEM.deseos||[]).slice(0,5);
  if(miedosDeseosCanvas && (top5M.length || top5D.length)){
    new Chart(miedosDeseosCanvas,{type:'bar',
      data:{labels:top5M.map((m,i)=>'#'+(i+1)),datasets:[
        {label:'Miedos',data:top5M.map((m,i)=>5-i),backgroundColor:'#B91C1Caa',borderRadius:4,borderSkipped:false},
        {label:'Deseos',data:top5D.map((m,i)=>5-i),backgroundColor:'#059669aa',borderRadius:4,borderSkipped:false},
      ]},
      options:{...CDf, plugins:{...CDf.plugins,legend:{display:true,labels:{color:'#334155',font:{size:10},boxWidth:10}},
        tooltip:{...CDf.plugins.tooltip,callbacks:{label:c=>{ const arr=c.datasetIndex===0?top5M:top5D; return arr[c.dataIndex] ? ' '+arr[c.dataIndex].nombre : ''; }}}},
        scales:{x:{...CDf.scales.x},y:{...CDf.scales.y,min:0,max:5,ticks:{...CDf.scales.y.ticks,stepSize:1}}}}
    });
  }
}

init();
})();
