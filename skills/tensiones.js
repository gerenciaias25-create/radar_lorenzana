(function(){
const D = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};
const root = document.getElementById('tensiones-root');

const FALLBACK = {
  actor: {entidad: 'Entidad', cargo: 'Servidor Público', periodo: (META.mes||'')+' '+(META.anio||'')},
  semaforo: [],
  ranking: [], emociones: [], narrativas: [], territorios: [], riesgos: [], trayectoriaLabels: [], trayectoria: [], alertas: [],
  lecturaPoliticaEmociones: '',
  narrativaMadreSintesis: {texto: '', descripcion: ''},
  aprobacion: {cortes: [], nota: ''},
  hallazgoEmocional: 'Sin datos de hallazgo emocional disponibles.',
  hallazgoTrayectoria: 'Sin datos de trayectoria disponibles.',
  resumenEjecutivo: '',
  cartografiaSocioafectiva: {
    iasPorZona: [], dolores: [], enemigosSimbolicos: [], fracturasSociales: [], segmentacion: [],
    narrativaMadre: '', narrativaMadreDesc: '', narrativas: [], preguntas: []
  }
};

function pick(obj, fb) { 
  if (obj === undefined || obj === null) return fb;
  if (Array.isArray(obj)) return obj.length ? obj : fb;
  if (typeof obj === 'object') return Object.keys(obj).length ? obj : fb;
  return obj;
}

const DATA = {
  actor: pick(D && D.actor, FALLBACK.actor),
  semaforo: pick(D && D.semaforo, FALLBACK.semaforo),
  ranking: pick(D && D.ranking, FALLBACK.ranking),
  emociones: pick(D && D.emociones, FALLBACK.emociones),
  narrativas: pick(D && D.narrativas, FALLBACK.narrativas),
  territorios: pick(D && D.territorios, FALLBACK.territorios),
  riesgos: pick(D && D.riesgos, FALLBACK.riesgos),
  trayectoriaLabels: pick(D && D.trayectoriaLabels, FALLBACK.trayectoriaLabels),
  trayectoria: pick(D && D.trayectoria, FALLBACK.trayectoria),
  alertas: pick(D && D.alertas, FALLBACK.alertas),
  lecturaPoliticaEmociones: (D && D.lecturaPoliticaEmociones) || FALLBACK.lecturaPoliticaEmociones,
  narrativaMadreSintesis: pick(D && D.narrativaMadreSintesis, FALLBACK.narrativaMadreSintesis),
  aprobacion: pick(D && D.aprobacion, FALLBACK.aprobacion),
  hallazgoEmocional: (D && D.hallazgoEmocional) || FALLBACK.hallazgoEmocional,
  hallazgoTrayectoria: (D && D.hallazgoTrayectoria) || FALLBACK.hallazgoTrayectoria,
  resumenEjecutivo: (D && D.resumenEjecutivo) || FALLBACK.resumenEjecutivo,
  cartografiaSocioafectiva: pick(D && D.cartografiaSocioafectiva, FALLBACK.cartografiaSocioafectiva)
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
      ${t.lecturaEstrategica ? `<div class="drec"><strong>Lectura estratégica:</strong> ${t.lecturaEstrategica}</div>` : ''}
      ${t.recomendacion ? `<div class="drec">${t.recomendacion}</div>` : ''}
    </div>
  `;
}

function renderSemaforo(){
  const el = document.getElementById('t-semaforo');
  if(!el) return;
  const NIVEL_COLOR = { critico: '#C53030', alto: '#C05621', medio: '#B7791F', bajo: '#2F855A' };
  const NIVEL_BG = { critico: 'var(--red-bg)', alto: 'var(--org-bg)', medio: 'var(--yel-bg)', bajo: 'var(--grn-bg)' };
  el.innerHTML = (DATA.semaforo||[]).map(s=>`
    <div class="semaf-item" style="background:${NIVEL_BG[s.nivel]||'var(--card-bg)'};border-color:${NIVEL_COLOR[s.nivel]||'var(--border2)'}">
      <div class="semaf-lbl">${s.etiqueta}</div>
      <div class="semaf-val" style="color:${NIVEL_COLOR[s.nivel]||'var(--text)'}">${s.valor}</div>
      <div class="semaf-sub">${s.sub||''}</div>
    </div>
  `).join('') || '<div class="card">Sin datos de semáforo disponibles.</div>';
}

// Render Charts & Data
function drawCharts(tab){
  if(tab==='tensiones'){
    renderRanking();
    renderSemaforo();
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
      mk('tc-emo', {
        type:'doughnut',
        data: { labels: DATA.emociones.map(x=>x.nombre), datasets: [{ data: DATA.emociones.map(x=>x.porcentaje||10), backgroundColor: DATA.emociones.map(x=>x.color||'#C05621'), borderColor:'#FFFFFF', borderWidth:2 }] },
        options: { plugins:{legend:{position:'right', labels:{boxWidth:11, font:{size:11}}}}, responsive:true, cutout:'55%' }
      });
    }
    document.getElementById('t-emo-evol').innerHTML = DATA.emociones.map(e=>`
      <div class="evolrow">
        <div class="evolnam">${e.nombre}</div>
        <div class="evoltr">${e.tendencia || '—'}</div>
        <div class="evoldesc">${e.tendenciaDesc || ''}</div>
      </div>
    `).join('') || '<div class="card">Sin datos de evolución disponibles.</div>';
    document.getElementById('t-emo-lectura').textContent = DATA.lecturaPoliticaEmociones || 'Sin lectura política estratégica disponible.';
  }
  if(tab==='narrativas'){
    const nms = DATA.narrativaMadreSintesis || {};
    document.getElementById('t-narmadre-t').textContent = nms.texto ? `"${nms.texto}"` : 'Sin narrativa madre disponible.';
    document.getElementById('t-narmadre-d').textContent = nms.descripcion || '';
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
    if(DATA.narrativas.length > 0){
      mk('tc-narpot', {
        type:'bar',
        data: { labels: DATA.narrativas.map(x=>x.nombre), datasets: [{ data: DATA.narrativas.map(x=>x.potencial||0), backgroundColor: '#C05621', borderRadius: 3 }] },
        options: { indexAxis:'y', plugins:{legend:{display:false}}, responsive:true, scales:{ x:{beginAtZero:true, max:100} } }
      });
    }
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
    document.getElementById('t-riesgo-tbl').innerHTML = DATA.riesgos.map(r=>`
      <tr>
        <td><strong style="color:${r.color||'var(--org)'}">${r.nombre}</strong></td>
        <td>${r.actorExpuesto || '—'}</td>
        <td style="text-align:center;font-weight:700">${r.srr}</td>
        <td>${r.tipoSenal || '—'}</td>
        <td>${r.probEscalar || '—'}</td>
        <td>${r.consecuencia || r.accion || '—'}</td>
      </tr>
    `).join('') || '<tr><td colspan="6">Sin riesgos registrados.</td></tr>';
  }
  if(tab==='trayectoria'){
    document.getElementById('t-hallazgo-traj').textContent = DATA.hallazgoTrayectoria;
    const labels = (DATA.trayectoriaLabels && DATA.trayectoriaLabels.length) ? DATA.trayectoriaLabels : ['T-3','T-2','T-1','Actual'];
    document.getElementById('t-traj-thead').innerHTML = `<th>TENSIÓN</th>${labels.map(l=>`<th>${l.toUpperCase()}</th>`).join('')}<th>Δ PERIODO</th><th>VELOCIDAD</th>`;
    document.getElementById('t-traj-body').innerHTML = DATA.trayectoria.map(tr=>{
      const valores = (tr.valores && tr.valores.length) ? tr.valores : [tr.t3, tr.t2, tr.t1, tr.ta];
      const ta = tr.ta != null ? tr.ta : valores[valores.length-1];
      const delta = tr.delta || (((ta - valores[0]) >= 0 ? '+' : '') + (ta - valores[0]));
      return `
      <tr>
        <td><strong>${tr.nombre}</strong></td>
        ${valores.map((v,i)=>`<td${i===valores.length-1?' style="font-weight:700"':''}>${v}</td>`).join('')}
        <td>${delta}</td>
        <td>${tr.velocidad}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8">Sin datos de trayectoria.</td></tr>';
    if(DATA.trayectoria.length > 0){
      mk('tc-traj', {
        type:'line',
        data: {
          labels: labels,
          datasets: DATA.trayectoria.map(tr=>({ label: tr.nombre, data: (tr.valores && tr.valores.length) ? tr.valores : [tr.t3, tr.t2, tr.t1, tr.ta], fill:false, tension:0.3 }))
        },
        options: { plugins:{legend:{position:'bottom'}}, responsive:true }
      });
    }
    const cortes = (DATA.aprobacion && DATA.aprobacion.cortes) || [];
    document.getElementById('t-aprob-nota').textContent = (DATA.aprobacion && DATA.aprobacion.nota) || '';
    if(cortes.length > 0){
      mk('tc-aprob', {
        type:'bar',
        data: { labels: cortes.map(c=>c.label), datasets: [{ data: cortes.map(c=>c.valor), backgroundColor: 'var(--cyan)', maxBarThickness: 70 }] },
        options: { plugins:{legend:{display:false}}, responsive:true, scales:{ y:{beginAtZero:true, max:100} } }
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
    const CS = DATA.cartografiaSocioafectiva;
    document.getElementById('t-dol-list').innerHTML = (CS.dolores||[]).map((d,i)=>`
      <div class="dolor"><div class="dolorn">${i+1}</div><div><div class="dolorfrase">${d.frase}</div><div class="dolormeta">${d.meta}</div></div></div>
    `).join('') || '<div class="card">Sin dolores registrados.</div>';
    if((CS.iasPorZona||[]).length > 0){
      mk('tc-ias', {
        type:'bar',
        data: { labels: CS.iasPorZona.map(z=>z.zona), datasets: [{ data: CS.iasPorZona.map(z=>z.ias), backgroundColor: CS.iasPorZona.map(z=>z.ias>=75?'#C53030':z.ias>=55?'#C05621':'#B7791F') }] },
        options: { plugins:{legend:{display:false}}, responsive:true, scales:{ y:{beginAtZero:true,max:100} } }
      });
    }
  }
  if(tab==='soc2'){
    const CS = DATA.cartografiaSocioafectiva;
    document.getElementById('t-enem-list').innerHTML = (CS.enemigosSimbolicos||[]).map(e=>`
      <div class="ter" style="cursor:default"><div class="ter-h"><div class="ter-info"><div class="ter-name">${e.nombre}</div></div></div><div class="ter-body op" style="display:block">${e.descripcion}</div></div>
    `).join('') || '<div class="card">Sin enemigos simbólicos registrados.</div>';
    document.getElementById('t-fract-list').innerHTML = (CS.fracturasSociales||[]).map(f=>`
      <div class="ter" style="cursor:default"><div class="ter-h"><div class="ter-info"><div class="ter-name">${f.titulo}</div></div></div><div class="ter-body op" style="display:block">${f.descripcion}</div></div>
    `).join('') || '<div class="card">Sin fracturas sociales registradas.</div>';
    document.getElementById('t-segsoc-tbl').innerHTML = (CS.segmentacion||[]).map(s=>`
      <tr><td>${s.segmento}</td><td style="font-weight:600">${s.emocionDominante}</td><td>${s.detonante}</td></tr>
    `).join('') || '<tr><td colspan="3">Sin segmentación registrada.</td></tr>';
  }
  if(tab==='soc3'){
    const CS = DATA.cartografiaSocioafectiva;
    document.getElementById('t-narsoc-madre-t').textContent = CS.narrativaMadre || 'Sin narrativa madre registrada.';
    document.getElementById('t-narsoc-madre-d').textContent = CS.narrativaMadreDesc || '';
    document.getElementById('t-narsoc-list').innerHTML = (CS.narrativas||[]).map(n=>`
      <div class="nar">
        <div class="nar-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="nar-info">
            <div class="nar-name">"${n.nombre}"</div>
            <div class="nar-meta">Tema: ${n.tema} &middot; Actor: ${n.actor}</div>
          </div>
        </div>
        <div class="nar-body">
          <p><strong>Potencial de propagación:</strong> ${n.potencial}</p>
          <p style="margin-top:4px;font-style:italic;color:var(--cyan)">${n.frase}</p>
          ${n.fuente ? `<p style="margin-top:4px;font-size:10.5px;color:var(--dim)">${n.fuente}</p>` : ''}
        </div>
      </div>
    `).join('') || '<div class="card">Sin narrativas socioafectivas registradas.</div>';
    document.getElementById('t-preg-list').innerHTML = (CS.preguntas||[]).map((p,i)=>`
      <div class="nar">
        <div class="nar-h" onclick="this.nextElementSibling.classList.toggle('op')">
          <div class="nar-info"><div class="nar-name">${i+1}. ${p.pregunta}</div></div>
        </div>
        <div class="nar-body">${p.respuesta}</div>
      </div>
    `).join('') || '<div class="card">Sin preguntas registradas.</div>';
  }
}

setTimeout(()=>drawCharts('tensiones'), 80);
})();
