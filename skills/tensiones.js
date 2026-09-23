(function(){
const D = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('tensiones-root');

const FALLBACK = {
  actor: {entidad: 'Entidad', cargo: 'Servidor Público', periodo: (META.mes||'')+' '+(META.anio||'')},
  ranking: [], semaforo: [], emociones: [], emocionesTendencia: [], narrativas: [], territorios: [], riesgos: [],
  trayectoriaMeses: ['Periodo 1','Periodo 2','Periodo 3','Periodo 4','Actual'], trayectoria: [], alertas: [],
  aprobacionAlcalde: { valor: 0, periodo: 'Sin dato', fuente: '', nota: 'Sin dato de aprobación verificado.' },
  hallazgoEmocional: 'Sin datos de hallazgo emocional disponibles.',
  hallazgoTrayectoria: 'Sin datos de trayectoria disponibles.',
  emocionesLectura: 'Sin lectura política estratégica disponible.',
  resumenEjecutivo: ''
};

function pick(obj, fb) { 
  if (obj === undefined || obj === null) return fb;
  if (Array.isArray(obj)) return obj.length ? obj : fb;
  if (typeof obj === 'object') return Object.keys(obj).length ? obj : fb;
  return obj;
}

const DATA = {
  actor: pick(D && D.actor, FALLBACK.actor),
  ranking: pick(D && D.ranking, FALLBACK.ranking),
  semaforo: pick(D && D.semaforo, FALLBACK.semaforo),
  emociones: pick(D && D.emociones, FALLBACK.emociones),
  emocionesTendencia: pick(D && D.emocionesTendencia, FALLBACK.emocionesTendencia),
  narrativas: pick(D && D.narrativas, FALLBACK.narrativas),
  territorios: pick(D && D.territorios, FALLBACK.territorios),
  riesgos: pick(D && D.riesgos, FALLBACK.riesgos),
  trayectoriaMeses: pick(D && D.trayectoriaMeses, FALLBACK.trayectoriaMeses),
  trayectoria: pick(D && D.trayectoria, FALLBACK.trayectoria),
  alertas: pick(D && D.alertas, FALLBACK.alertas),
  aprobacionAlcalde: pick(D && D.aprobacionAlcalde, FALLBACK.aprobacionAlcalde),
  hallazgoEmocional: (D && D.hallazgoEmocional) || FALLBACK.hallazgoEmocional,
  hallazgoTrayectoria: (D && D.hallazgoTrayectoria) || FALLBACK.hallazgoTrayectoria,
  emocionesLectura: (D && D.emocionesLectura) || FALLBACK.emocionesLectura,
  resumenEjecutivo: (D && D.resumenEjecutivo) || FALLBACK.resumenEjecutivo
};

// Bloque SOCIOAFECTIVA (pestañas soc1-soc3). Cada sub-lista se normaliza a
// array para que un JSON incompleto del modelo nunca rompa el render.
const S = Object.assign({}, (D && D.socio) || {});
['radiografia','dolores','enemigos','fracturas','segmentacion','narrativas','preguntas9'].forEach(k=>{
  if(!Array.isArray(S[k])) S[k] = [];
});
S.narrativaMadre = (S.narrativaMadre && typeof S.narrativaMadre === 'object') ? S.narrativaMadre : {};
DATA.socio = S;

const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// El color del IAS lo decide el frontend a partir del número (no el modelo).
const iasColor = v => v>=75 ? '#C53030' : v>=55 ? '#C05621' : '#B7791F';
const SEG_COLOR = { Rojo:'#C53030', Naranja:'#C05621', Amarillo:'#B7791F', Verde:'#2F855A' };

// Header
const nameParts = (META.actor || 'TENSIONES').split(' ');
document.getElementById('t-hdr-name').innerHTML = (nameParts[0]||'').toUpperCase() + ' <span>' + nameParts.slice(1).join(' ').toUpperCase() + '</span>';
document.getElementById('t-hdr-sub').textContent = [DATA.actor.cargo, DATA.actor.entidad, DATA.actor.periodo].filter(Boolean).join(' · ');
document.getElementById('t-ftr-l').textContent = 'Radar de Tensiones · ' + (DATA.actor.entidad || '');

// Tabs Router
window.tensTab = function(btn, id){
  root.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
  root.querySelectorAll('.nb').forEach(b=>b.classList.remove('on'));
  const target = document.getElementById('tv-'+id);
  if(target) target.classList.add('on');
  btn.classList.add('on');
  setTimeout(()=>drawCharts(id), 60);
};

const CH = {};
function mk(id, cfg){ 
  if(CH[id]) CH[id].destroy(); 
  const c=document.getElementById(id); 
  if(!c) return; 
  CH[id]=new Chart(c, cfg); 
}

// Render Ranking
function renderRanking(){
  const list = document.getElementById('t-tens-list');
  if(!DATA.ranking.length){ list.innerHTML = '<div class="card">Sin tensiones registradas.</div>'; return; }

  list.innerHTML = DATA.ranking.map((item, i)=>`
    <div class="trow ${i===0?'sel':''}" onclick="showDetail(${i}, this)">
      <span class="tnum">${i+1}</span>
      <span class="tname">${item.nombre}</span>
      <div class="tbar"><div class="tbar-f" style="width:${item.score}%;background:${item.color||'#C05621'}"></div></div>
      <span class="tsco">${item.score}</span>
      <span class="tniv" style="background:${item.color||'#C05621'};color:#fff">${item.nivel}</span>
    </div>
  `).join('');
  showDetail(0);
}

window.showDetail = function(idx, el){
  if(el){ root.querySelectorAll('.trow').forEach(r=>r.classList.remove('sel')); el.classList.add('sel'); }
  const t = DATA.ranking[idx]; if(!t) return;
  document.getElementById('t-tens-detail').innerHTML = `
    <div class="card">
      <div style="font-size:14px;font-weight:700;color:var(--hdrblue);margin-bottom:8px">${t.nombre}${t.score!=null?` — STS ${t.score}`:''}</div>
      <div class="dg">
        <span class="dk">Nivel:</span><span class="dv">${t.nivel || '—'}${t.score!=null?` · ${t.score}/100`:''}</span>
        <span class="dk">Emoción:</span><span class="dv">${t.emocion || '—'}</span>
        <span class="dk">Narrativa:</span><span class="dv" style="font-style:italic">${t.narrativa ? '"'+t.narrativa+'"' : '—'}</span>
        <span class="dk">Actor:</span><span class="dv">${t.actor || '—'}</span>
        <span class="dk">Territorio:</span><span class="dv">${t.territorio || '—'}</span>
        <span class="dk">Potencial:</span><span class="dv">${t.politica || '—'}</span>
        <span class="dk">Evidencia:</span><span class="dv">${t.evidencia || '—'}</span>
      </div>
      ${t.recomendacion ? `<div class="drec">${t.recomendacion}</div>` : ''}
    </div>
  `;
}

// Render Charts & Data
function drawCharts(tab){
  if(tab==='tensiones'){
    renderRanking();
    if(DATA.ranking.length > 0){
      mk('tc-tens', {
        type:'bar',
        data: { labels: DATA.ranking.map(x=>x.nombre), datasets: [{ data: DATA.ranking.map(x=>x.score), backgroundColor: DATA.ranking.map(x=>x.color||'#C05621') }] },
        options: { indexAxis:'y', plugins:{legend:{display:false}}, responsive:true }
      });
    }
  }
  if(tab==='emociones'){
    document.getElementById('t-emo-bars').innerHTML = DATA.emociones.map(e=>`
      <div class="ebar" style="flex-direction:column;align-items:stretch;gap:4px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="enam">${e.nombre}</span>
          <div class="ebg"><div class="efill" style="width:${(e.intensidad/5)*100}%;background:${e.color||'#C05621'}"></div></div>
          <span style="font-size:11px;font-weight:700">${e.intensidad}/5</span>
        </div>
        ${e.descripcion ? `<div style="font-size:10.5px;color:var(--dim);margin-left:120px">${e.descripcion}</div>` : ''}
      </div>
    `).join('');
    document.getElementById('t-hallazgo-emo').textContent = DATA.hallazgoEmocional;
    if(DATA.emociones.length > 0){
      // Barras horizontales en vez de dona: más legible para comparar
      // magnitudes entre emociones que un porcentaje circular.
      mk('tc-emo', {
        type:'bar',
        data: { labels: DATA.emociones.map(x=>x.nombre), datasets: [{ data: DATA.emociones.map(x=>x.porcentaje||10), backgroundColor: DATA.emociones.map(x=>x.color||'#C05621'), borderRadius: 3 }] },
        options: { indexAxis:'y', plugins:{legend:{display:false}}, responsive:true, scales:{ x:{beginAtZero:true} } }
      });
    }
  }
  if(tab==='narrativas'){
    document.getElementById('t-nar-list').innerHTML = DATA.narrativas.map(n=>`
      <div class="nar">
        <div class="nar-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="nar-info">
            <div class="nar-name">"${n.nombre}"</div>
            <div class="nar-meta">Tema: ${n.tema} &middot; Actor: ${n.actor}</div>
          </div>
        </div>
        <div class="nar-body">
          <p><strong>Impacto Político:</strong> ${n.politica}</p>
          <p style="margin-top:4px;font-style:italic;color:var(--cyan)">${n.frase}</p>
          ${n.fuente ? `<p style="margin-top:4px;font-size:10.5px;color:var(--dim)">${n.fuente}</p>` : ''}
        </div>
      </div>
    `).join('') || '<div class="card">Sin narrativas registradas.</div>';
  }
  if(tab==='territorios'){
    const COLOR_MAP = { Rojo: '#C53030', Naranja: '#C05621', Amarillo: '#B7791F' };
    document.getElementById('t-ter-list').innerHTML = DATA.territorios.map(t=>`
      <div class="ter">
        <div class="ter-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="ter-info">
            <div class="ter-name">${t.nombre}</div>
            <div class="ter-sub">Tensión: ${t.tension} &middot; Emoción: ${t.emocion}</div>
          </div>
          ${t.color ? `<span class="tniv" style="background:${COLOR_MAP[t.color]||'#C05621'};color:#fff;align-self:flex-start">${t.color}</span>` : ''}
        </div>
        <div class="ter-body">${t.observaciones}</div>
      </div>
    `).join('') || '<div class="card">Sin territorios registrados.</div>';
  }
  if(tab==='riesgos'){
    if(DATA.riesgos.length > 0){
      mk('tc-srr', {
        type:'bar',
        data: { labels: DATA.riesgos.map(x=>x.nombre), datasets: [{ data: DATA.riesgos.map(x=>x.srr), backgroundColor: DATA.riesgos.map(x=>x.color||'#C05621') }] },
        options: { plugins:{legend:{display:false}}, responsive:true }
      });
    }
    document.getElementById('t-riesgo-list').innerHTML = DATA.riesgos.map(r=>`
      <div class="card mb">
        <div style="font-weight:700;color:var(--hdrblue);margin-bottom:6px">${r.nombre} (SRR: ${r.srr})</div>
        <div class="dg">
          <span class="dk">Actor expuesto:</span><span class="dv">${r.actorExpuesto || '—'}</span>
          <span class="dk">Tipo de señal:</span><span class="dv">${r.tipoSenal || '—'}</span>
          <span class="dk">Prob. de escalar:</span><span class="dv">${r.probEscalar || '—'}</span>
        </div>
        <div class="drec" style="margin-top:.7rem">${r.accion}</div>
      </div>
    `).join('') || '<div class="card">Sin riesgos registrados.</div>';
  }
  if(tab==='trayectoria'){
    document.getElementById('t-hallazgo-traj').textContent = DATA.hallazgoTrayectoria;
    document.getElementById('t-traj-body').innerHTML = DATA.trayectoria.map(tr=>`
      <tr>
        <td><strong>${tr.nombre}</strong></td>
        <td>${tr.t3}</td><td>${tr.t2}</td><td>${tr.t1}</td>
        <td><strong>${tr.ta}</strong></td>
        <td>${tr.delta || ((tr.ta - tr.t3) >= 0 ? '+' : '') + (tr.ta - tr.t3)}</td>
        <td>${tr.tipo}</td><td>${tr.velocidad}</td>
      </tr>
    `).join('') || '<tr><td colspan="8">Sin datos de trayectoria.</td></tr>';
    if(DATA.trayectoria.length > 0){
      mk('tc-traj', {
        type:'line',
        data: {
          labels: ['Periodo 1', 'Periodo 2', 'Periodo 3', 'Actual'],
          datasets: DATA.trayectoria.map(tr=>({ label: tr.nombre, data: [tr.t3, tr.t2, tr.t1, tr.ta], fill:false, tension:0.3 }))
        },
        options: { plugins:{legend:{position:'bottom'}}, responsive:true }
      });
    }
  }
  if(tab==='alertas'){
    document.getElementById('t-alertas-list').innerHTML = DATA.alertas.map(a=>`
      <div class="abox">
        <div class="abox-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <span class="abox-t">⚠ ${a.titulo}</span>
        </div>
        <div class="abox-body">
          <div class="dg">
            ${(a.rows||[]).map(r=>`<span class="dk">${r[0]}:</span><span class="dv">${r[1]}</span>`).join('')}
          </div>
        </div>
      </div>
    `).join('') || '<div class="card">Sin alertas registradas.</div>';
  }

  // ── SOCIOAFECTIVA 1: Radiografía + Dolores ──
  if(tab==='soc1'){
    const rad = DATA.socio.radiografia;
    document.getElementById('t-rad-list').innerHTML = rad.map(r=>{
      const ias = Number(r.ias)||0, c = iasColor(ias);
      return `
      <div class="zonac">
        <div class="zonac-h">
          <div>
            <div class="zonac-n">${esc(r.nombre)}</div>
            <div class="zonac-sub">${esc(r.nivel||'—')} &middot; Tensión dominante: ${esc(r.tensionDominante||'—')} &middot; Emoción: ${esc(r.emocion||'—')}</div>
          </div>
          <div><div class="ias" style="color:${c}">${ias}</div><div class="iasl">IAS</div></div>
        </div>
        <div class="zonac-lec">${esc(r.lectura||'')}</div>
      </div>`;
    }).join('') || '<div class="card">Sin radiografía territorial registrada.</div>';

    document.getElementById('t-dol-list').innerHTML = DATA.socio.dolores.map((d,i)=>`
      <div class="dolor">
        <div class="dolorn">${i+1}</div>
        <div><div class="dolorfrase">${esc(d.frase)}</div><div class="dolormeta">${esc(d.meta)}</div></div>
      </div>`).join('') || 'Sin dolores sociales registrados.';

    if(rad.length > 0){
      mk('tc-ias', {
        type:'bar',
        data: {
          labels: rad.map(r=>{ const n=String(r.nombre||''); return n.length>30 ? n.slice(0,30)+'…' : n; }),
          datasets: [{ data: rad.map(r=>Number(r.ias)||0), backgroundColor: rad.map(r=>iasColor(Number(r.ias)||0)), borderRadius: 4 }]
        },
        options: {
          indexAxis:'y', responsive:true,
          plugins:{ legend:{display:false}, tooltip:{ callbacks:{ title:c=>rad[c[0].dataIndex].nombre, label:c=>' IAS: '+c.raw+'/100' } } },
          scales:{ x:{ min:0, max:100 } }
        }
      });
    }
  }

  // ── SOCIOAFECTIVA 2: Enemigos + Fracturas + Segmentación ──
  if(tab==='soc2'){
    document.getElementById('t-enem-list').innerHTML = DATA.socio.enemigos.map(e=>`
      <div class="enemcard"><div class="enemn">${esc(e.nombre)}</div><div class="enemd">${esc(e.descripcion)}</div></div>
    `).join('') || 'Sin enemigos simbólicos registrados.';

    document.getElementById('t-fract-list').innerHTML = DATA.socio.fracturas.map(f=>`
      <div class="fractrow"><b>${esc(f.titulo)}</b><br>${esc(f.descripcion)}</div>
    `).join('') || 'Sin fracturas sociales registradas.';

    document.getElementById('t-seg-body').innerHTML = DATA.socio.segmentacion.map(s=>`
      <tr>
        <td>${esc(s.segmento)}</td>
        <td style="color:${SEG_COLOR[s.color]||'#4B5563'};font-weight:600">${esc(s.emocion)}</td>
        <td>${esc(s.detonante)}</td>
      </tr>
    `).join('') || '<tr><td colspan="3">Sin segmentación registrada.</td></tr>';
  }

  // ── SOCIOAFECTIVA 3: Narrativas + 9 Preguntas ──
  if(tab==='soc3'){
    const nm = DATA.socio.narrativaMadre;
    document.getElementById('t-narmadre-frase').textContent = nm.frase ? '"'+nm.frase+'"' : 'Sin narrativa madre registrada.';
    document.getElementById('t-narmadre-nota').textContent = nm.nota || '';

    document.getElementById('t-narsoc-list').innerHTML = DATA.socio.narrativas.map(n=>`
      <div class="nar">
        <div class="nar-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="nar-info">
            <div class="nar-name">${esc(n.nombre)}</div>
            <div class="nar-meta">${esc(n.tema)} &middot; ${esc(n.actor)}</div>
          </div>
        </div>
        <div class="nar-body">
          <p><strong>Potencial de propagación:</strong> ${esc(n.potencial)}</p>
          <p style="margin-top:4px;font-style:italic;color:var(--cyan)">${esc(n.frase)}</p>
          ${n.fuente ? `<p style="margin-top:4px;font-size:10.5px;color:var(--dim)">${esc(n.fuente)}</p>` : ''}
        </div>
      </div>
    `).join('') || '<div class="card">Sin narrativas socioafectivas registradas.</div>';

    document.getElementById('t-preg-list').innerHTML = DATA.socio.preguntas9.map((p,i)=>`
      <div class="preg">
        <div class="preg-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="preg-n">${i+1}</div>
          <div class="preg-q">${esc(p.pregunta)}</div>
        </div>
        <div class="preg-body">${esc(p.respuesta)}</div>
      </div>
    `).join('') || '<div class="card">Sin preguntas registradas.</div>';
  }
}

setTimeout(()=>drawCharts('tensiones'), 80);
})();
