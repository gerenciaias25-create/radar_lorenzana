(function(){
const D = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('tensiones-root');

const FALLBACK = {
  actor: {entidad: 'Entidad', cargo: 'Servidor Público', periodo: (META.mes||'')+' '+(META.anio||'')},
  ranking: [], emociones: [], narrativas: [], territorios: [], riesgos: [], trayectoria: [], alertas: [],
  hallazgoEmocional: 'Sin datos de hallazgo emocional disponibles.',
  hallazgoTrayectoria: 'Sin datos de trayectoria disponibles.',
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
  emociones: pick(D && D.emociones, FALLBACK.emociones),
  narrativas: pick(D && D.narrativas, FALLBACK.narrativas),
  territorios: pick(D && D.territorios, FALLBACK.territorios),
  riesgos: pick(D && D.riesgos, FALLBACK.riesgos),
  trayectoria: pick(D && D.trayectoria, FALLBACK.trayectoria),
  alertas: pick(D && D.alertas, FALLBACK.alertas),
  hallazgoEmocional: (D && D.hallazgoEmocional) || FALLBACK.hallazgoEmocional,
  hallazgoTrayectoria: (D && D.hallazgoTrayectoria) || FALLBACK.hallazgoTrayectoria,
  resumenEjecutivo: (D && D.resumenEjecutivo) || FALLBACK.resumenEjecutivo
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
      <div style="font-size:14px;font-weight:700;color:var(--hdrblue);margin-bottom:8px">${t.nombre}</div>
      <div class="dg">
        <span class="dk">Emoción:</span><span class="dv">${t.emocion || '—'}</span>
        <span class="dk">Narrativa:</span><span class="dv">${t.narrativa || '—'}</span>
        <span class="dk">Actor Resp.:</span><span class="dv">${t.actor || '—'}</span>
        <span class="dk">Territorio:</span><span class="dv">${t.territorio || '—'}</span>
        <span class="dk">Riesgo Pol.:</span><span class="dv">${t.politica || '—'}</span>
      </div>
      ${t.recomendacion ? `<div class="drec"><strong>Recomendación:</strong> ${t.recomendacion}</div>` : ''}
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
      <div class="ebar">
        <span class="enam">${e.nombre}</span>
        <div class="ebg"><div class="efill" style="width:${(e.intensidad/5)*100}%;background:${e.color||'#C05621'}"></div></div>
        <span style="font-size:11px;font-weight:700">${e.intensidad}/5</span>
      </div>
    `).join('');
    document.getElementById('t-hallazgo-emo').textContent = DATA.hallazgoEmocional;
    if(DATA.emociones.length > 0){
      mk('tc-emo', {
        type:'doughnut',
        data: { labels: DATA.emociones.map(x=>x.nombre), datasets: [{ data: DATA.emociones.map(x=>x.porcentaje||10), backgroundColor: DATA.emociones.map(x=>x.color||'#C05621') }] },
        options: { plugins:{legend:{position:'bottom'}}, responsive:true }
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
        </div>
      </div>
    `).join('') || '<div class="card">Sin narrativas registradas.</div>';
  }
  if(tab==='territorios'){
    document.getElementById('t-ter-list').innerHTML = DATA.territorios.map(t=>`
      <div class="ter">
        <div class="ter-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="ter-info">
            <div class="ter-name">${t.nombre}</div>
            <div class="ter-sub">Tensión: ${t.tension} &middot; Emoción: ${t.emocion}</div>
          </div>
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
        <div style="font-weight:700;color:var(--hdrblue)">${r.nombre} (SRR: ${r.srr})</div>
        <div style="font-size:11px;margin-top:4px"><strong>Acción Recomendada:</strong> ${r.accion}</div>
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
        <td>${tr.tipo}</td><td>${tr.velocidad}</td>
      </tr>
    `).join('') || '<tr><td colspan="7">Sin datos de trayectoria.</td></tr>';
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
}

setTimeout(()=>drawCharts('tensiones'), 80);
})();
