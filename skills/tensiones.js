(function(){
const D = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('tensiones-root');

const FALLBACK = {
  actor: {entidad: 'Entidad', cargo: 'Servidor Público', periodo: (META.mes||'')+' '+(META.anio||'')},
  ranking: [], emociones: [], narrativas: [], territorios: [], riesgos: [], trayectoria: [], alertas: [],
  hallazgoEmocional: 'Sin datos de hallazgo emocional disponibles.',
  hallazgoTrayectoria: 'Sin datos de trayectoria disponibles.',
  resumenEjecutivo: '',
  radiografia: [], dolores: [], enemigos: [], fracturas: [], segmentacion: [],
  narrativaMadreSocio: 'Sin narrativa madre socioafectiva disponible.',
  comparacionNarrativas: '',
  narrativasSocio: [], preguntas9: []
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
  emociones: pick(D && D.emociones, FALLBACK.emociones),
  narrativas: pick(D && D.narrativas, FALLBACK.narrativas),
  territorios: pick(D && D.territorios, FALLBACK.territorios),
  riesgos: pick(D && D.riesgos, FALLBACK.riesgos),
  trayectoria: pick(D && D.trayectoria, FALLBACK.trayectoria),
  alertas: pick(D && D.alertas, FALLBACK.alertas),
  hallazgoEmocional: (D && D.hallazgoEmocional) || FALLBACK.hallazgoEmocional,
  hallazgoTrayectoria: (D && D.hallazgoTrayectoria) || FALLBACK.hallazgoTrayectoria,
  resumenEjecutivo: (D && D.resumenEjecutivo) || FALLBACK.resumenEjecutivo,
  radiografia: pick(D && D.radiografia, FALLBACK.radiografia),
  dolores: pick(D && D.dolores, FALLBACK.dolores),
  enemigos: pick(D && D.enemigos, FALLBACK.enemigos),
  fracturas: pick(D && D.fracturas, FALLBACK.fracturas),
  segmentacion: pick(D && D.segmentacion, FALLBACK.segmentacion),
  narrativaMadreSocio: (D && D.narrativaMadreSocio) || FALLBACK.narrativaMadreSocio,
  comparacionNarrativas: (D && D.comparacionNarrativas) || FALLBACK.comparacionNarrativas,
  narrativasSocio: pick(D && D.narrativasSocio, FALLBACK.narrativasSocio),
  preguntas9: pick(D && D.preguntas9, FALLBACK.preguntas9)
};

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
  if(tab==='soc1'){
    document.getElementById('t-rad-list').innerHTML = DATA.radiografia.map(r=>`
      <div class="zonac">
        <div class="zonac-h">
          <div><div class="zonac-n">${r.nombre}</div><div class="zonac-sub">${r.nivel||''} &middot; Tensión dominante: ${r.tension||'—'} &middot; Emoción: ${r.emocion||'—'}</div></div>
          <div><div class="ias" style="color:${r.color||'#C05621'}">${r.ias}</div><div class="iasl">IAS</div></div>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.55">${r.lectura||''}</div>
      </div>
    `).join('') || '<div class="card">Sin radiografía territorial registrada.</div>';

    document.getElementById('t-dol-list').innerHTML = DATA.dolores.map((d,i)=>`
      <div class="dolor">
        <div class="dolorn">${i+1}</div>
        <div><div class="dolorfrase">${d.frase}</div><div class="dolormeta">${d.meta||''}</div></div>
      </div>
    `).join('') || '<div style="font-size:12px;color:var(--dim)">Sin dolores sociales registrados.</div>';

    if(DATA.radiografia.length > 0){
      mk('tc-ias', {
        type:'bar',
        data: { labels: DATA.radiografia.map(r=>r.nombre), datasets: [{ label:'IAS', data: DATA.radiografia.map(r=>r.ias), backgroundColor: DATA.radiografia.map(r=>r.color||'#C05621'), borderRadius: 5, borderSkipped: false }] },
        options: { plugins:{legend:{display:false}, tooltip:{callbacks:{label:c=>' IAS: '+c.raw+'/100'}}}, responsive:true, scales:{ y:{ beginAtZero:true, max:100 } } }
      });
    }
  }
  if(tab==='soc2'){
    document.getElementById('t-enem-list').innerHTML = DATA.enemigos.map(e=>`
      <div class="enemcard"><div class="enemn">${e.nombre}</div><div class="enemd">${e.descripcion}</div></div>
    `).join('') || '<div style="font-size:12px;color:var(--dim)">Sin enemigos simbólicos registrados.</div>';

    document.getElementById('t-fract-list').innerHTML = DATA.fracturas.map(f=>`
      <div class="fractrow"><b>${f.titulo}</b><br>${f.descripcion}</div>
    `).join('') || '<div style="font-size:12px;color:var(--dim)">Sin fracturas sociales registradas.</div>';

    document.getElementById('t-seg-tabla').innerHTML = `
      <tr><th>Segmento</th><th>Emoción dominante</th><th>Detonante principal</th></tr>
      ${DATA.segmentacion.map(s=>`<tr><td>${s.segmento}</td><td>${s.emocion}</td><td>${s.detonante}</td></tr>`).join('') || '<tr><td colspan="3">Sin datos de segmentación.</td></tr>'}
    `;
  }
  if(tab==='soc3'){
    document.getElementById('t-narsoc-madre').textContent = DATA.narrativaMadreSocio;
    document.getElementById('t-narsoc-comparacion').textContent = DATA.comparacionNarrativas;

    document.getElementById('t-narsoc-list').innerHTML = DATA.narrativasSocio.map(n=>`
      <div class="nar">
        <div class="nar-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="nar-info">
            <div class="nar-name">${n.nombre}</div>
            <div class="nar-meta">${n.tema||''} &middot; ${n.actor||''}</div>
          </div>
        </div>
        <div class="nar-body">
          <p><strong>Potencial de propagación:</strong> ${n.potencial||'—'}</p>
          <p class="nfrase">${n.frase||''}</p>
          ${n.fuente ? `<p style="margin-top:4px;font-size:10.5px;color:var(--dim)">${n.fuente}</p>` : ''}
        </div>
      </div>
    `).join('') || '<div class="card">Sin narrativas socioafectivas registradas.</div>';

    document.getElementById('t-preg-list').innerHTML = DATA.preguntas9.map((p,i)=>`
      <div class="preg">
        <div class="preg-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="preg-n">${i+1}</div>
          <div class="preg-q">${p.pregunta}</div>
        </div>
        <div class="preg-body">${p.respuesta}</div>
      </div>
    `).join('') || '<div class="card">Sin preguntas registradas.</div>';
  }
}

setTimeout(()=>drawCharts('tensiones'), 80);
})();
