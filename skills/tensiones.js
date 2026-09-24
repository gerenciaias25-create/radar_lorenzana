(function(){
const D = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('tensiones-root');
const R = D || {};

// ───────────── Utilidades ─────────────
const C = { red:'#E24B4A', org:'#D97706', yel:'#B45309', grn:'#15803D', cyan:'#0891B2' };
const NIV = { Rojo:C.red, Naranja:C.org, Amarillo:C.yel, Verde:C.grn };
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arr = v => Array.isArray(v) ? v : [];
const obj = v => (v && typeof v==='object' && !Array.isArray(v)) ? v : {};
const num = (v,d=0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const cut = (s,n) => { s = String(s==null?'':s); return s.length>n ? s.slice(0,n-1)+'…' : s; };
const rgba = (hex,a) => { const h=String(hex||'').replace('#',''); if(h.length!==6) return `rgba(100,116,139,${a})`; const n=parseInt(h,16); return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`; };
const isHex = v => /^#[0-9a-f]{6}$/i.test(String(v||''));
// Nivel por score: lo decide el frontend a partir del número (el servidor hace lo mismo).
const lvl = s => s>=80 ? {n:'Crítico',c:C.red} : s>=65 ? {n:'Alto',c:C.org} : s>=50 ? {n:'Relevante',c:C.yel} : {n:'Emergente',c:C.grn};
const pill = (txt,c) => `<span class="tniv" style="background:${rgba(c,.15)};color:${c};border-color:${rgba(c,.45)}">${esc(txt)}</span>`;
const cols = items => { const a=[], b=[]; items.forEach((h,i)=>(i%2?b:a).push(h)); return `<div class="cols"><div class="col">${a.join('')}</div><div class="col">${b.join('')}</div></div>`; };
const empty = t => `<div class="card"><div class="empty">${esc(t)}</div></div>`;

function comentarios(list, titulo){
  const l = arr(list).filter(c=>c && c.texto);
  if(!l.length) return '';
  return `<div class="voces"><div class="voces-t">${esc(titulo||'Voces en medios y redes')}</div>` +
    l.map(c=>`<div class="voz"><span class="voz-f">${esc(c.fuente||'Fuente')}</span><span class="voz-x">“${esc(c.texto)}”</span></div>`).join('') + `</div>`;
}

// ───────────── Datos ─────────────
const DATA = {
  actor: (R.actor && typeof R.actor==='object') ? R.actor : { entidad:'Entidad', cargo:'Servidor Público', periodo:((META.mes||'')+' '+(META.anio||'')).trim() },
  resumen: R.resumenEjecutivo || '',
  advertencias: arr(R.advertencias),
  semaforo: obj(R.semaforo),
  ranking: arr(R.ranking).filter(x=>x&&x.nombre).map(x=>Object.assign({}, x, {score:num(x.score)})).sort((a,b)=>b.score-a.score),
  emociones: arr(R.emociones).filter(x=>x&&x.nombre),
  lecturaEmocional: arr(R.lecturaEmocional),
  hallazgoEmocional: R.hallazgoEmocional || 'Sin datos de hallazgo emocional disponibles.',
  narrativaMadre: obj(R.narrativaMadre),
  narrativas: arr(R.narrativas).filter(x=>x&&x.nombre),
  territorios: arr(R.territorios).filter(x=>x&&x.nombre),
  riesgos: arr(R.riesgos).filter(x=>x&&x.nombre),
  periodos: arr(R.periodos),
  trayectoria: arr(R.trayectoria).filter(x=>x&&x.nombre),
  hallazgoTrayectoria: R.hallazgoTrayectoria || 'Sin datos de trayectoria disponibles.',
  aprobacion: obj(R.aprobacion),
  alertas: arr(R.alertas).filter(x=>x&&x.titulo)
};
const S = Object.assign({}, obj(R.socio));
['radiografia','dolores','enemigos','fracturas','segmentacion','narrativas','preguntas9'].forEach(k=>{ S[k] = arr(S[k]); });
S.narrativaMadre = obj(S.narrativaMadre);
DATA.socio = S;

// ───────────── Encabezado ─────────────
const nameParts = (META.actor || 'TENSIONES').split(' ');
document.getElementById('t-hdr-name').innerHTML = esc((nameParts[0]||'').toUpperCase()) + ' <span>' + esc(nameParts.slice(1).join(' ').toUpperCase()) + '</span>';
document.getElementById('t-hdr-sub').textContent = [DATA.actor.cargo, DATA.actor.entidad, DATA.actor.periodo].filter(Boolean).join(' · ');
document.getElementById('t-ftr-l').textContent = 'Radar de Tensiones · ' + (DATA.actor.entidad || '');

// ───────────── Navegación ─────────────
window.tensTab = function(btn, id){
  root.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  root.querySelectorAll('.nb').forEach(b=>b.classList.remove('on'));
  const target = document.getElementById('tv-'+id);
  if(target) target.classList.add('on');
  btn.classList.add('on');
  setTimeout(()=>drawCharts(id), 60);
};
// Acordeón genérico (header -> body hermano siguiente + flecha)
window.tensTgl = function(h){
  const b = h.nextElementSibling; if(b) b.classList.toggle('op');
  const a = h.querySelector('.arr'); if(a) a.classList.toggle('op');
};

// ───────────── Gráficas ─────────────
const CH = {};
function mk(id, cfg, h){
  if(CH[id]){ CH[id].destroy(); delete CH[id]; }
  const c = document.getElementById(id);
  if(!c || typeof Chart === 'undefined') return;
  if(h && c.parentElement) c.parentElement.style.height = h+'px';
  if(Chart.defaults && Chart.defaults.font) Chart.defaults.font.size = 11;
  cfg.options = Object.assign({ responsive:true, maintainAspectRatio:false }, cfg.options||{});
  CH[id] = new Chart(c, cfg);
}
const barH = (id, labels, values, colors, fullNames, max) => mk(id, {
  type:'bar',
  data:{ labels: labels.map(l=>cut(l,34)), datasets:[{ data:values, backgroundColor:colors, borderRadius:4 }] },
  options:{ indexAxis:'y',
    plugins:{ legend:{display:false}, tooltip:{ callbacks:{ title:c=>fullNames[c[0].dataIndex], label:c=>' '+c.raw+(max?'/'+max:'') } } },
    scales:{ x:{ min:0, max:max||undefined, grid:{color:'rgba(0,0,0,.06)'} }, y:{ grid:{display:false} } } }
}, Math.max(180, labels.length*36+50));

// ───────────── 1. TENSIONES ─────────────
function renderRanking(){
  const list = document.getElementById('t-tens-list');
  const adv = document.getElementById('t-advert');
  adv.innerHTML = DATA.advertencias.length ? `<div class="advert">${DATA.advertencias.map(esc).join('<br>')}</div>` : '';
  const rc = document.getElementById('t-resumen-card');
  rc.style.display = DATA.resumen ? 'block' : 'none';
  document.getElementById('t-resumen').textContent = DATA.resumen;

  if(!DATA.ranking.length){ list.innerHTML = empty('Sin tensiones registradas.'); return; }
  list.innerHTML = DATA.ranking.map((t,i)=>{
    const L = lvl(t.score);
    return `<div class="trow ${i===0?'sel':''}" onclick="showDetail(${i}, this)">
      <span class="tnum">${i+1}</span>
      <span class="tname">${esc(t.nombre)}</span>
      <div class="tbar"><div class="tbar-f" style="width:${Math.min(100,t.score)}%;background:${L.c}"></div></div>
      <span class="tsco" style="color:${L.c}">${t.score}</span>
      ${pill(t.nivel||L.n, L.c)}
    </div>`;
  }).join('');
  showDetail(0);
}
window.showDetail = function(idx, el){
  if(el){ root.querySelectorAll('.trow').forEach(r=>r.classList.remove('sel')); el.classList.add('sel'); }
  const t = DATA.ranking[idx]; if(!t) return;
  const L = lvl(t.score);
  document.getElementById('t-tens-detail').innerHTML = `
    <div class="card" style="border-color:${rgba(L.c,.4)}">
      <div class="dtit" style="color:${L.c}">${esc(t.nombre)} — STS ${t.score}</div>
      <div class="dg">
        <span class="dk">Nivel</span><span class="dv" style="color:${L.c};font-weight:600">${esc(t.nivel||L.n)} · ${t.score}/100</span>
        <span class="dk">Emoción</span><span class="dv">${esc(t.emocion||'—')}</span>
        <span class="dk">Narrativa</span><span class="dv">${t.narrativa?'“'+esc(t.narrativa)+'”':'—'}</span>
        <span class="dk">Actor</span><span class="dv">${esc(t.actor||'—')}</span>
        <span class="dk">Territorio</span><span class="dv">${esc(t.territorio||'—')}</span>
        <span class="dk">Potencial</span><span class="dv">${esc(t.politica||'—')}</span>
        <span class="dk">Evidencia</span><span class="dv">${esc(t.evidencia||'—')}</span>
      </div>
      ${t.lectura ? `<div class="drec" style="border-left-color:${L.c};background:${rgba(L.c,.1)}"><b>Lectura estratégica:</b> ${esc(t.lectura)}</div>` : ''}
      ${t.recomendacion ? `<div class="drec" style="border-left-color:${C.cyan};background:${rgba(C.cyan,.08)}"><b>Acción recomendada:</b> ${esc(t.recomendacion)}</div>` : ''}
      ${comentarios(t.comentarios)}
    </div>`;
};
function renderSemaforo(){
  const s = DATA.semaforo;
  const items = [
    ['Tensión social','tensionSocial'], ['Reputacional','reputacional'], ['Escalamiento','escalamiento'],
    ['Confianza institucional','confianzaInstitucional'], ['Movilización social','movilizacionSocial']
  ];
  const el = document.getElementById('t-sem');
  if(!Object.keys(s).length){ el.innerHTML = '<div class="empty">Sin datos de semáforo.</div>'; return; }
  el.innerHTML = items.map(([lab,k])=>{
    const it = obj(s[k]); const c = NIV[it.nivel] || C.yel;
    const val = (it.valor===undefined||it.valor===null||it.valor==='') ? '—' : it.valor;
    const isTxt = typeof val === 'string' && isNaN(Number(val));
    return `<div class="sembox" style="background:${rgba(c,.12)};border-color:${rgba(c,.45)};color:${c}">
      <div class="seml">${lab}</div>
      <div class="semv ${isTxt?'t':''}">${esc(val)}</div>
      <div class="sems">${esc(it.detalle||'')}</div></div>`;
  }).join('');
}

// ───────────── 2. EMOCIONES ─────────────
const emoColor = e => isHex(e.color) ? e.color : (num(e.intensidad)>=4 ? C.red : num(e.intensidad)===3 ? C.org : num(e.intensidad)===2 ? C.yel : C.grn);
function renderEmociones(){
  const E = DATA.emociones;
  document.getElementById('t-emo-bars').innerHTML = E.map(e=>{
    const i = Math.max(0,Math.min(5,Math.round(num(e.intensidad)))), c = emoColor(e);
    return `<div class="eitem"><div class="ebar">
      <span class="enam">${esc(e.nombre)}</span>
      <div class="ebg"><div class="efill" style="width:${i*20}%;background:${c}"></div></div>
      <span class="epts" style="color:${c}">${'●'.repeat(i)}${'○'.repeat(5-i)}</span></div>
      ${e.descripcion?`<div class="edesc">${esc(e.descripcion)}</div>`:''}</div>`;
  }).join('') || '<div class="empty">Sin emociones registradas.</div>';

  document.getElementById('t-emo-evol').innerHTML = E.map(e=>{
    const c = emoColor(e);
    return `<div class="evrow"><div class="evh"><span class="evn">${esc(e.nombre)}</span><span class="evt" style="color:${c}">${esc(e.tendencia||'')}</span></div>
      <div class="evd">${esc(e.evolucion||'')}</div></div>`;
  }).join('') || '<div class="empty">Sin evolución registrada.</div>';

  const byName = {}; E.forEach(e=>{ byName[String(e.nombre).toLowerCase()] = e; });
  document.getElementById('t-emo-lect').innerHTML = DATA.lecturaEmocional.map(l=>{
    const e = byName[String(l.emocion||'').toLowerCase()];
    const c = e ? emoColor(e) : C.cyan;
    const inten = e ? ` (${Math.round(num(e.intensidad))}/5)` : '';
    return `<p class="lecp"><b style="color:${c}">${esc(l.emocion)}</b>${inten} ${esc(l.texto)}</p>`;
  }).join('') || '<div class="empty">Sin lectura política registrada.</div>';

  document.getElementById('t-hallazgo-emo').textContent = DATA.hallazgoEmocional;
  if(E.length){
    mk('tc-emo', {
      type:'doughnut',
      data:{ labels:E.map(e=>e.nombre), datasets:[{ data:E.map(e=>num(e.porcentaje,0)||num(e.intensidad,1)*4), backgroundColor:E.map(emoColor), borderColor:'#d5d1d1', borderWidth:2 }] },
      options:{ cutout:'52%', plugins:{ legend:{ position:'right', labels:{ boxWidth:10, padding:10 } }, tooltip:{ callbacks:{ label:c=>' '+c.label+': '+c.raw+'%' } } } }
    });
  }
}

// ───────────── 3. NARRATIVAS ─────────────
function narrativaCard(n, meta, cuerpoHTML){
  return `<div class="nar"><div class="nar-h" onclick="tensTgl(this)"><div class="nar-info">
      <div class="nar-name">${esc(n.nombre)}</div><div class="nar-meta">${meta}</div></div><span class="arr">▼</span></div>
    <div class="nar-body">${cuerpoHTML}</div></div>`;
}
function renderNarrativas(){
  const m = DATA.narrativaMadre;
  document.getElementById('t-madre-f').textContent = m.frase ? '“'+m.frase+'”' : 'Sin narrativa madre registrada.';
  document.getElementById('t-madre-n').textContent = m.nota || '';
  const N = DATA.narrativas;
  document.getElementById('t-nar-list').innerHTML = !N.length ? empty('Sin narrativas registradas.') : cols(N.map(n=>{
    const L = lvl(num(n.indice));
    const chip = n.indice!==undefined ? `<span class="chip" style="color:${L.c};border-color:${rgba(L.c,.5)};background:${rgba(L.c,.12)}">Índice ${Math.round(num(n.indice))}</span>` : '';
    return narrativaCard({nombre:'“'+n.nombre+'”'},
      `${esc(n.tema||'')} &middot; Actor: ${esc(n.actor||'—')}`,
      `<p><strong>Potencial político:</strong> ${chip}</p><p style="margin-top:4px">${esc(n.politica||'')}</p>
       ${n.frase?`<p class="nfrase">“${esc(n.frase)}”</p>`:''}
       ${n.fuente?`<p class="nfuente">${esc(n.fuente)}</p>`:''}${comentarios(n.comentarios)}`);
  }));
  if(N.length){
    const vals = N.map(n=>Math.round(num(n.indice)));
    barH('tc-nar', N.map(n=>n.nombre), vals, vals.map(v=>lvl(v).c), N.map(n=>n.nombre), 100);
  }
}

// ───────────── 4. TERRITORIOS ─────────────
function renderTerritorios(){
  const T = DATA.territorios.slice().sort((a,b)=>num(b.sensibilidad)-num(a.sensibilidad));
  document.getElementById('t-ter-list').innerHTML = !T.length ? empty('Sin territorios registrados.') : cols(T.map((t,i)=>{
    const sens = Math.round(num(t.sensibilidad));
    const nom = NIV[t.color] ? t.color : (sens>=75?'Rojo':sens>=55?'Naranja':'Amarillo');
    const c = NIV[nom];
    const open = i===0;
    return `<div class="ter" style="background:${rgba(c,.1)};border-color:${rgba(c,.42)}">
      <div class="ter-h" onclick="tensTgl(this)">
        <div class="ter-info"><div class="ter-name" style="color:${c}">${esc(t.nombre)}</div>
          <div class="ter-sub" style="color:${c}">${esc(t.emocion||'')}${t.tension?' · '+esc(t.tension):''}</div></div>
        ${pill(nom+(t.sensibilidad!==undefined?' · '+sens:''), c)}
        <span class="arr ${open?'op':''}" style="color:${c}">▼</span>
      </div>
      <div class="ter-body ${open?'op':''}">
        ${t.actores?`<div class="ter-meta"><b>Actores:</b> ${esc(t.actores)} &middot; <b>Sensibilidad:</b> ${sens}/100</div>`:''}
        ${esc(t.observaciones||'')}${comentarios(t.comentarios)}
      </div></div>`;
  }));
}

// ───────────── 5. RIESGOS ─────────────
function renderRiesgos(){
  const Rk = DATA.riesgos;
  const probColor = p => /alta/i.test(p) ? C.red : /media/i.test(p) ? C.org : C.grn;
  document.getElementById('t-riesgo-body').innerHTML = Rk.map(r=>{
    const srr = Math.round(num(r.srr)), c = lvl(srr).c, pc = probColor(String(r.probEscalar||''));
    const hz = r.horizonteDias ? ` — ${Math.round(num(r.horizonteDias))}d` : '';
    return `<tr>
      <td style="color:${c};font-weight:700">${esc(r.nombre)}</td>
      <td>${esc(r.actorExpuesto||'—')}</td>
      <td style="color:${c};font-weight:800;font-size:14px">${srr}</td>
      <td><b>${esc(r.tipoSenal||'—')}</b>${r.senalDetalle?`<br><span style="color:var(--muted)">${esc(r.senalDetalle)}</span>`:''}</td>
      <td style="color:${pc};font-weight:700;white-space:nowrap">${esc(String(r.probEscalar||'—').toUpperCase())}${hz}</td>
      <td>${esc(r.consecuencia||'—')}</td>
      <td>${esc(r.accion||'—')}</td></tr>`;
  }).join('') || '<tr><td colspan="7">Sin riesgos registrados.</td></tr>';
  if(Rk.length){
    const vals = Rk.map(r=>Math.round(num(r.srr)));
    mk('tc-srr', {
      type:'bar',
      data:{ labels:Rk.map(r=>cut(r.nombreCorto||r.nombre,22)), datasets:[{ data:vals, backgroundColor:vals.map(v=>lvl(v).c), borderRadius:4 }] },
      options:{ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ title:c=>Rk[c[0].dataIndex].nombre, label:c=>' SRR: '+c.raw+'/100' } } },
        scales:{ y:{ min:0, max:100, grid:{color:'rgba(0,0,0,.06)'} }, x:{ grid:{display:false} } } }
    });
  }
}

// ───────────── 6. TRAYECTORIA ─────────────
const PALETA = ['#E24B4A','#D97706','#0891B2','#15803D','#B45309','#7C3AED','#DB2777','#475569','#0D9488','#CA8A04'];
function seriesDe(t){
  if(Array.isArray(t.serie)) return t.serie.map(v=>num(v));
  return [t.t3,t.t2,t.t1,t.ta].filter(v=>v!==undefined).map(v=>num(v)); // compatibilidad con formato anterior
}
function renderTrayectoria(){
  const T = DATA.trayectoria;
  const n = T.reduce((m,t)=>Math.max(m,seriesDe(t).length),0) || 4;
  const per = (DATA.periodos.length===n) ? DATA.periodos.map(String)
    : (n===4 ? ['T-3','T-2','T-1','Actual'] : Array.from({length:n},(_,i)=>'P'+(i+1)));
  const rango = per.length ? `${per[0]} a ${per[per.length-1]}` : '';
  document.getElementById('t-traj-titulo').textContent = 'Trayectoria de tensiones — '+rango+' (Δ del periodo)';
  document.getElementById('t-traj-gtitulo').textContent = 'Gráfica de trayectoria — evolución STS '+rango;

  document.getElementById('t-traj-head').innerHTML = `<tr><th>Tensión</th>${per.map(p=>`<th>${esc(p)}</th>`).join('')}<th>Δ periodo</th><th>Velocidad</th></tr>`;
  const velC = v => /aceler/i.test(v) ? C.red : /moder/i.test(v) ? C.org : /gradual/i.test(v) ? C.yel : /desc|baja/i.test(v) ? C.cyan : C.grn;
  const serie = t => { const s = seriesDe(t); while(s.length<per.length) s.unshift(s.length?s[0]:0); return s; };
  document.getElementById('t-traj-body').innerHTML = T.map(t=>{
    const s = serie(t);
    const last = s[s.length-1], d = last - s[0], c = lvl(last).c;
    const arrow = d>0 ? '↑' : d<0 ? '↓' : '→';
    const dtxt = arrow+' '+(d>0?'+':'')+d;
    return `<tr><td>${esc(t.nombre)}</td>
      ${s.map((v,i)=> i===s.length-1 ? `<td style="color:${c};font-weight:800">${v}</td>` : `<td>${v}</td>`).join('')}
      <td style="color:${d>=0?c:C.cyan};font-weight:700">${dtxt}</td>
      <td style="color:${velC(String(t.velocidad||''))};font-weight:700">${esc(t.velocidad||'—')}</td></tr>`;
  }).join('') || `<tr><td colspan="${per.length+3}">Sin datos de trayectoria.</td></tr>`;

  document.getElementById('t-hallazgo-traj').textContent = DATA.hallazgoTrayectoria;

  if(T.length){
    mk('tc-traj', {
      type:'line',
      data:{ labels:per, datasets:T.map((t,i)=>({ label:cut(t.nombre,32), data:serie(t), borderColor:PALETA[i%PALETA.length], backgroundColor:PALETA[i%PALETA.length], borderWidth:2, tension:.35, pointRadius:3, fill:false, borderDash: i%3===1?[6,4]: i%3===2?[2,3]:[] })) },
      options:{ plugins:{ legend:{ position:'bottom', labels:{ boxWidth:14, padding:12 } } }, scales:{ y:{ min:0, max:100, grid:{color:'rgba(0,0,0,.06)'} }, x:{ grid:{display:false} } } }
    });
  }

  // Aprobación: solo puntos verificados (nunca interpolados)
  const A = DATA.aprobacion, datos = arr(A.datos).filter(d=>d && Number.isFinite(Number(d.valor)));
  document.getElementById('t-aprob-titulo').textContent = (A.titulo||'Aprobación')+' — dato verificado en encuesta pública (no interpolado)';
  const chartBox = document.getElementById('t-aprob-chart');
  if(CH['tc-aprob']){ CH['tc-aprob'].destroy(); delete CH['tc-aprob']; }
  if(datos.length){
    chartBox.innerHTML = '<div class="chw" style="height:240px"><canvas id="tc-aprob"></canvas></div>';
    mk('tc-aprob', {
      type:'bar',
      data:{ labels:datos.map(d=>d.periodo||'—'), datasets:[{ data:datos.map(d=>num(d.valor)), backgroundColor:C.cyan, borderRadius:6, maxBarThickness:70 }] },
      options:{ plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:c=>' '+c.raw+'%'+(datos[c.dataIndex].fuente?' · '+datos[c.dataIndex].fuente:'') } } },
        scales:{ y:{ min:0, max:100, grid:{color:'rgba(0,0,0,.06)'} }, x:{ grid:{display:false} } } }
    });
  } else {
    chartBox.innerHTML = '<div class="empty">No se identificó una encuesta pública de aprobación verificable en las fuentes del periodo.</div>';
  }
  document.getElementById('t-aprob-nota').textContent = A.nota || '';
}

// ───────────── 7. ALERTAS ─────────────
function renderAlertas(){
  document.getElementById('t-alertas-list').innerHTML = DATA.alertas.map((a,i)=>{
    const open = i<2;
    const rows = arr(a.rows).filter(r=>Array.isArray(r)&&r.length>=2);
    return `<div class="abox"><div class="abox-h" onclick="tensTgl(this)">
        <span class="abox-t"><span>●</span>${esc(a.titulo)}</span><span class="arr ${open?'op':''}">▼</span></div>
      <div class="abox-body ${open?'op':''}" onclick="event.stopPropagation()">
        <div class="ag">${rows.map(r=>`<span class="ak">${esc(r[0])}</span><span class="av">${esc(r[1])}</span>`).join('')}</div>
        ${comentarios(a.comentarios)}
      </div></div>`;
  }).join('') || empty('Sin alertas registradas.');
}

// ───────────── 8-10. SOCIOAFECTIVA ─────────────
const SEG_COLOR = { Rojo:C.red, Naranja:C.org, Amarillo:C.yel, Verde:C.grn };
function renderSoc1(){
  const rad = S.radiografia.slice().sort((a,b)=>num(b.ias)-num(a.ias));
  document.getElementById('t-rad-list').innerHTML = rad.map(z=>{
    const ias = Math.round(num(z.ias)), c = lvl(ias).c;
    return `<div class="zonac"><div class="zonac-h"><div>
        <div class="zonac-n">${esc(z.nombre)}</div>
        <div class="zonac-sub">${esc(z.nivel||'—')} &middot; Tensión dominante: ${esc(z.tensionDominante||'—')} &middot; Emoción: ${esc(z.emocion||'—')}</div></div>
        <div><div class="ias" style="color:${c}">${ias}</div><div class="iasl">IAS</div></div></div>
      <div class="zonac-lec">${esc(z.lectura||'')}</div></div>`;
  }).join('') || empty('Sin radiografía territorial registrada.');
  document.getElementById('t-dol-list').innerHTML = S.dolores.map((d,i)=>`
    <div class="dolor"><div class="dolorn">${i+1}</div><div><div class="dolorfrase">“${esc(String(d.frase||'').replace(/^["“]|["”]$/g,''))}”</div><div class="dolormeta">${esc(d.meta||'')}</div></div></div>`
  ).join('') || '<div class="empty">Sin dolores sociales registrados.</div>';
  if(rad.length){
    const vals = rad.map(z=>Math.round(num(z.ias)));
    barH('tc-ias', rad.map(z=>z.nombre), vals, vals.map(v=>lvl(v).c), rad.map(z=>z.nombre), 100);
  }
}
function renderSoc2(){
  document.getElementById('t-enem-list').innerHTML = S.enemigos.map(e=>`<div class="enemcard"><div class="enemn">${esc(e.nombre)}</div><div class="enemd">${esc(e.descripcion||'')}</div></div>`).join('') || '<div class="empty">Sin enemigos simbólicos registrados.</div>';
  document.getElementById('t-fract-list').innerHTML = S.fracturas.map(f=>`<div class="fractrow"><b>${esc(f.titulo)}</b><br>${esc(f.descripcion||'')}</div>`).join('') || '<div class="empty">Sin fracturas sociales registradas.</div>';
  document.getElementById('t-seg-body').innerHTML = S.segmentacion.map(s=>`<tr>
      <td style="font-weight:600">${esc(s.segmento)}</td>
      <td style="color:${SEG_COLOR[s.color]||'#475569'};font-weight:700">${esc(s.emocion||'')}</td>
      <td>${esc(s.detonante||'')}</td></tr>`).join('') || '<tr><td colspan="3">Sin segmentación registrada.</td></tr>';
}
function renderSoc3(){
  const nm = S.narrativaMadre;
  document.getElementById('t-narmadre-frase').textContent = nm.frase ? '“'+nm.frase+'”' : 'Sin narrativa madre registrada.';
  document.getElementById('t-narmadre-nota').textContent = nm.nota || '';
  document.getElementById('t-narsoc-list').innerHTML = !S.narrativas.length ? empty('Sin narrativas socioafectivas registradas.') : cols(S.narrativas.map(n=>narrativaCard({nombre:n.nombre},
    `${esc(n.tema||'')} &middot; ${esc(n.actor||'')}`,
    `<p><strong>Potencial de propagación:</strong> ${esc(n.potencial||'')}</p>
     ${n.frase?`<p class="nfrase">“${esc(n.frase)}”</p>`:''}${n.fuente?`<p class="nfuente">${esc(n.fuente)}</p>`:''}`
  )));
  document.getElementById('t-preg-list').innerHTML = S.preguntas9.map((p,i)=>`
    <div class="preg"><div class="preg-h" onclick="tensTgl(this)"><div class="preg-n">${i+1}</div><div class="preg-q">${esc(p.pregunta)}</div><span class="arr">▼</span></div>
      <div class="preg-body">${esc(p.respuesta||'')}</div></div>`).join('') || empty('Sin preguntas registradas.');
}

// ───────────── Router de render ─────────────
function drawCharts(tab){
  if(tab==='tensiones'){
    renderRanking(); renderSemaforo();
    if(DATA.ranking.length){
      const v = DATA.ranking.map(r=>r.score);
      barH('tc-tens', DATA.ranking.map(r=>r.nombre), v, v.map(x=>lvl(x).c), DATA.ranking.map(r=>r.nombre), 100);
    }
  }
  if(tab==='emociones') renderEmociones();
  if(tab==='narrativas') renderNarrativas();
  if(tab==='territorios') renderTerritorios();
  if(tab==='riesgos') renderRiesgos();
  if(tab==='trayectoria') renderTrayectoria();
  if(tab==='alertas') renderAlertas();
  if(tab==='soc1') renderSoc1();
  if(tab==='soc2') renderSoc2();
  if(tab==='soc3') renderSoc3();
}

setTimeout(()=>drawCharts('tensiones'), 80);
})();
