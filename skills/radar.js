(function () {
  const D = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
  const META = window.DATA_META || {};
  const root = document.getElementById('radar-root');
  if (!root) return;

  const C = {
    teal: '#00A8B5',
    green: '#1E8449',
    amber: '#C49A00',
    red: '#C0392B',
    orange: '#D35400',
    navy: '#1C2738',
    neutral: '#555555',
    blue2: '#1B4F8A'
  };

  const FALLBACK = {
    actor: { cargo: 'Servidor(a) Público(a)', entidad: 'Entidad', partido: '—', periodo: (META.mes || '') + ' ' + (META.anio || '') },
    kpis: {
      npsPartido: [{ label: 'Sin datos', valor: 0 }],
      ratioAtaqueDefensa: [{ plataforma: 'Sin datos', ratio: 0 }],
      traSemanal: { labels: ['--'], valores: [0] },
      resumen: 'No se recibieron datos procesados suficientes.'
    },
    sentimiento: {
      general: { labels: ['Positivo', 'Negativo', 'Neutro'], valores: [0, 0, 0] },
      genero: { labels: ['Hombres', 'Mujeres'], valores: [0, 0] },
      edad: { labels: ['18-29', '30-49', '50+'], valores: [0, 0, 0] },
      partido: { labels: ['Propio', 'Oposición', 'Independiente'], valores: [0, 0, 0] },
      hallazgos: []
    },
    topOfMind: {
      general: { temas: ['Sin datos'], valores: [0] },
      genero: { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] },
      edad: { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] },
      partido: { temas: ['Sin datos'], series: [{ nombre: '—', valores: [0] }] },
      cruces: []
    },
    picos: { labels: ['DíA 1'], valores: [0], eventos: [] },
    plataformas: {
      alcance: [{ plataforma: 'Sin datos', valor: 0 }],
      tono: [{ plataforma: 'Sin datos', positivo: 0, negativo: 0 }],
      porEdad: [{ plataforma: 'Sin datos', series: [{ nombre: '—', valor: 0 }] }],
      viralizacion: [{ plataforma: 'Sin datos', critica: 0, propia: 0 }],
      lecturaEstrategica: []
    },
    nube: { palabras: [{ texto: 'Sin datos', peso: 10 }], hashtags: [] },
    narrativas: { favorables: [], criticas: [], neutras: [] },
    riesgosOportunidades: { riesgos: [], oportunidades: [] },
    territorial: { zonas: [], volumenPorZona: [] },
    resumenEjecutivo: 'Sin resumen disponible para el periodo seleccionado.'
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
    picos: pick(D && D.picos, FALLBACK.picos),
    plataformas: pick(D && D.plataformas, FALLBACK.plataformas),
    nube: pick(D && D.nube, FALLBACK.nube),
    narrativas: pick(D && D.narrativas, FALLBACK.narrativas),
    riesgosOportunidades: pick(D && D.riesgosOportunidades, FALLBACK.riesgosOportunidades),
    territorial: pick(D && D.territorial, FALLBACK.territorial),
    resumenEjecutivo: (D && D.resumenEjecutivo) || FALLBACK.resumenEjecutivo
  };

  // ----- HEADER -----
  const actorName = (META.actor || 'PERSONAJE').toUpperCase();
  document.getElementById('r-hdr-name').textContent = actorName;
  document.getElementById('r-hdr-sub').textContent = [
    DATA.actor.cargo, DATA.actor.entidad, DATA.actor.partido, DATA.actor.periodo
  ].filter(Boolean).join(' · ');
  document.getElementById('r-ftr-l').textContent = 'RADAR Análisis Bivariado · ' + (DATA.actor.entidad || '');
  document.getElementById('r-resumen').textContent = DATA.resumenEjecutivo;

  // ----- NAVEGACIÓN TAB -----
  window.radarTab = function (id, btn) {
    root.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    root.querySelectorAll('#tabnav button').forEach(b => b.classList.remove('active'));

    const target = document.getElementById('rtab-' + id);
    if (target) target.classList.add('active');
    if (btn) btn.classList.add('active');

    setTimeout(() => renderTabCharts(id), 60);
  };

  const CH = {};
  function mkChart(id, cfg) {
    if (CH[id]) CH[id].destroy();
    const c = document.getElementById(id);
    if (!c) return;
    CH[id] = new Chart(c, cfg);
  }

  // ----- TAB 1: KPIS -----
  function rKPIs() {
    document.getElementById('r-kpis-lead').textContent = DATA.kpis.resumen || 'Indicadores clave de percepción y tracción reputacional.';

    const grid = document.getElementById('r-kpi-grid');
    grid.innerHTML = '';
    const items = DATA.kpis.items || [
      { label: 'NPS-P', val: DATA.kpis.npsGlobal || '0', sub: 'Aprobación Neta', color: 'g' },
      { label: 'Ratio Ataque/Defensa', val: DATA.kpis.ratioGlobal || '0.0', sub: 'Riesgo reputacional', color: 'g' },
      { label: 'Share of Voice', val: DATA.kpis.sov || '0%', sub: 'Presencia digital', color: 'n' },
      { label: 'Nivel de Alerta', val: DATA.kpis.alerta || 'Nivel 1', sub: 'Estado general', color: 'a' }
    ];

    items.forEach(k => {
      const c = document.createElement('div');
      c.className = 'card kpi';
      const clr = k.color === 'g' ? C.green : k.color === 'a' ? C.amber : k.color === 'r' ? C.red : C.navy;
      c.innerHTML = `<div class="label">${k.label}</div><div class="val" style="color:${clr}">${k.val}</div><div class="sub">${k.sub}</div>`;
      grid.appendChild(c);
    });

    const nps = DATA.kpis.npsPartido || [];
    if (nps.length) {
      mkChart('rc-nps', {
        type: 'bar',
        data: {
          labels: nps.map(x => x.label),
          datasets: [{
            data: nps.map(x => x.valor),
            backgroundColor: d => d.raw >= 0 ? C.green : C.red,
            borderRadius: 4
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }

    const ra = DATA.kpis.ratioAtaqueDefensa || [];
    if (ra.length) {
      mkChart('rc-ratio', {
        type: 'bar',
        data: {
          labels: ra.map(x => x.plataforma),
          datasets: [{
            data: ra.map(x => x.ratio),
            backgroundColor: d => d.raw >= 1.5 ? C.red : C.green,
            borderRadius: 4
          }]
        },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
      });
    }

    const tra = DATA.kpis.traSemanal || {};
    if (tra.labels && tra.valores) {
      mkChart('rc-tra', {
        type: 'line',
        data: {
          labels: tra.labels,
          datasets: [{
            data: tra.valores,
            borderColor: C.teal,
            backgroundColor: 'rgba(0,168,181,.1)',
            fill: true, tension: 0.3, borderWidth: 2
          }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }
  }

  // ----- TAB 2: SENTIMIENTO -----
  let chartSent = null;
  function rSent(key) {
    if (chartSent) chartSent.destroy();
    const c = document.getElementById('rc-sent');
    if (!c) return;
    const d = DATA.sentimiento[key] || DATA.sentimiento.general;
    const isBar = key !== 'general';

    chartSent = new Chart(c, {
      type: isBar ? 'bar' : 'doughnut',
      data: {
        labels: d.labels,
        datasets: [{
          data: d.valores,
          backgroundColor: isBar ? d.valores.map(v => v >= 0 ? C.green : C.red) : [C.green, C.red, C.neutral],
          borderRadius: isBar ? 4 : 0
        }]
      },
      options: { responsive: true, plugins: { legend: { display: !isBar } } }
    });
  }

  window.radarSentCross = function (key, btn) {
    btn.parentElement.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
    btn.classList.add('on');
    document.getElementById('r-sent-title').textContent = 'Sentimiento por ' + key.toUpperCase();
    rSent(key);
  };

  function rSentHallazgos() {
    const items = DATA.sentimiento.hallazgos || [];
    document.getElementById('r-sent-hallazgos').innerHTML = items.length ? items.map(h => `
      <div style="margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid #ccc;">
        <strong>${h.titulo || ''}</strong><p>${h.texto || ''}</p>
      </div>
    `).join('') : 'Sin hallazgos cargados.';
  }

  // ----- TAB 3: TOP OF MIND -----
  let chartTom = null;
  function rTom(key) {
    if (chartTom) chartTom.destroy();
    const c = document.getElementById('rc-tom');
    if (!c) return;
    const d = DATA.topOfMind[key] || DATA.topOfMind.general;

    if (key === 'general') {
      chartTom = new Chart(c, {
        type: 'bar',
        data: {
          labels: d.temas,
          datasets: [{ data: d.valores, backgroundColor: C.navy, borderRadius: 4 }]
        },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
      });
    } else {
      const palette = [C.teal, C.red, C.amber, C.green];
      const series = (d.series || []).filter(s => s && s.nombre);
      chartTom = new Chart(c, {
        type: 'bar',
        data: {
          labels: d.temas,
          datasets: series.map((s, i) => ({
            label: s.nombre,
            data: s.valores,
            backgroundColor: palette[i % 4],
            borderRadius: 4
          }))
        },
        options: { responsive: true }
      });
    }
  }

  window.radarTomCross = function (key, btn) {
    btn.parentElement.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
    btn.classList.add('on');
    document.getElementById('r-tom-title').textContent = 'Top of Mind — ' + key.toUpperCase();
    rTom(key);
  };

  function rTomCruces() {
    const items = DATA.topOfMind.cruces || [];
    document.getElementById('r-tom-cruces').innerHTML = items.length ? items.map(c => `
      <div class="card" style="padding:10px;">
        <strong style="color:var(--navy);">${c.titulo || ''}</strong>
        <p style="margin-top:4px;">${c.texto || ''}</p>
      </div>
    `).join('') : 'Sin cruces configurados.';
  }

  // ----- TAB 4: PICOS -----
  function rPicos() {
    const p = DATA.picos || {};
    if (p.labels && p.valores) {
      mkChart('rc-picos', {
        type: 'line',
        data: {
          labels: p.labels,
          datasets: [{ label: 'Volumen Menciones', data: p.valores, borderColor: C.red, backgroundColor: 'rgba(192,57,43,.1)', fill: true }]
        },
        options: { responsive: true }
      });
    }

    const tbody = document.getElementById('r-picos-tabla');
    tbody.innerHTML = (p.eventos || []).map(e => `
      <tr>
        <td><strong>${e.fecha || '-'}</strong></td>
        <td>${e.evento || '-'}</td>
        <td><span class="tag ${e.impacto === 'Alto' ? 'r' : 'a'}">${e.impacto || '-'}</span></td>
        <td>${e.canal || '-'}</td>
      </tr>
    `).join('') || '<tr><td colspan="4">Sin picos detectados.</td></tr>';
  }

  // ----- TAB 5: PLATAFORMAS -----
  function rPlat() {
    const alc = DATA.plataformas.alcance, tono = DATA.plataformas.tono, pe = DATA.plataformas.porEdad, vir = DATA.plataformas.viralizacion;

    if (alc.length) mkChart('rc-plalc', {
      type: 'doughnut',
      data: { labels: alc.map(x => x.plataforma), datasets: [{ data: alc.map(x => x.valor), backgroundColor: [C.teal, C.navy, C.amber, C.neutral, C.green, C.red] }] },
      options: { responsive: true }
    });

    if (tono.length) mkChart('rc-pltono', {
      type: 'bar',
      data: {
        labels: tono.map(x => x.plataforma),
        datasets: [
          { label: '% Positivo', data: tono.map(x => x.positivo), backgroundColor: C.green },
          { label: '% Negativo', data: tono.map(x => x.negativo), backgroundColor: C.red }
        ]
      },
      options: { responsive: true }
    });

    if (pe.length && pe[0].series) {
      const palette = [C.red, C.amber, C.green, C.neutral];
      const grupos = pe[0].series.map(s => s.nombre);
      mkChart('rc-pledad', {
        type: 'bar',
        data: {
          labels: pe.map(x => x.plataforma),
          datasets: grupos.map((g, i) => ({
            label: g,
            data: pe.map(x => (x.series[i] || {}).valor || 0),
            backgroundColor: palette[i % 4]
          }))
        },
        options: { responsive: true }
      });
    }

    if (vir.length) mkChart('rc-plviral', {
      type: 'bar',
      data: {
        labels: vir.map(x => x.plataforma),
        datasets: [
          { label: 'Crítica (h)', data: vir.map(x => x.critica), backgroundColor: C.red },
          { label: 'Propia (h)', data: vir.map(x => x.propia), backgroundColor: C.green }
        ]
      },
      options: { indexAxis: 'y', responsive: true }
    });

    const lec = DATA.plataformas.lecturaEstrategica || [];
    document.getElementById('r-plat-lectura').innerHTML = lec.length ? lec.map(l => `
      <div class="card">
        <strong style="color:${l.alerta ? 'var(--red)' : 'var(--navy)'};">${l.titulo || ''}</strong>
        <p style="margin-top:4px;">${l.texto || ''}</p>
      </div>
    `).join('') : 'Sin lectura de plataformas.';
  }

  // ----- TAB 6: NUBE -----
  function rNube() {
    const words = DATA.nube.palabras || [];
    document.getElementById('r-nube-words').innerHTML = words.length ? words.map(w => `
      <span style="font-size:${Math.min(Math.max(w.peso, 12), 28)}px; color:${w.peso > 20 ? C.navy : C.teal}">${w.texto}</span>
    `).join('') : 'Sin datos semánticos.';

    const tags = DATA.nube.hashtags || [];
    document.getElementById('r-nube-tags').innerHTML = tags.map(t => `
      <tr>
        <td><strong>${t.tag || '-'}</strong></td>
        <td><span class="tag ${t.orientacion === 'Favorables' ? 'g' : 'r'}">${t.orientacion || '-'}</span></td>
        <td>${t.impulsor || '-'}</td>
      </tr>
    `).join('') || '<tr><td colspan="3">Sin hashtags registrados.</td></tr>';
  }

  // ----- TAB 7: NARRATIVAS -----
  function itemNarrativa(n) {
    const tags = (n.tags || []).map(t => `<span class="tag n">${t}</span>`).join('');
    return `
      <div style="margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid rgba(0,0,0,.1);">
        <strong>${n.titulo || ''}</strong>
        <p style="font-size:11px; margin:4px 0;">${n.descripcion || ''}</p>
        ${tags}
        ${n.bivariado ? `<div style="font-size:10px; background:rgba(0,0,0,.05); padding:4px; margin-top:4px;"><strong>Bivariado:</strong> ${n.bivariado}</div>` : ''}
      </div>
    `;
  }

  function rNarrativas() {
    document.getElementById('r-nar-fav').innerHTML = (DATA.narrativas.favorables || []).map(itemNarrativa).join('') || 'Sin narrativas.';
    document.getElementById('r-nar-crit').innerHTML = (DATA.narrativas.criticas || []).map(itemNarrativa).join('') || 'Sin narrativas.';
    document.getElementById('r-nar-neu').innerHTML = (DATA.narrativas.neutras || []).map(itemNarrativa).join('') || 'Sin narrativas.';
  }

  // ----- TAB 8: RIESGOS -----
  function rRiesgos() {
    document.getElementById('r-riesgos').innerHTML = (DATA.riesgosOportunidades.riesgos || []).map(r => `
      <div class="risk-item">
        <div class="lvl">${r.nivel || 'MEDIO'} - ${r.titulo || ''}</div>
        <p style="font-size:11px; margin-top:4px;">${r.descripcion || ''}</p>
        ${r.bivariado ? `<div class="biv">Bivariado: ${r.bivariado}</div>` : ''}
      </div>
    `).join('') || 'Sin riesgos configurados.';

    document.getElementById('r-oportunidades').innerHTML = (DATA.riesgosOportunidades.oportunidades || []).map(o => `
      <div class="risk-item opp">
        <div class="lvl" style="color:var(--green);">${o.nivel || 'MEDIO'} - ${o.titulo || ''}</div>
        <p style="font-size:11px; margin-top:4px;">${o.descripcion || ''}</p>
        ${o.bivariado ? `<div class="biv">Bivariado: ${o.bivariado}</div>` : ''}
      </div>
    `).join('') || 'Sin oportunidades configuradas.';
  }

  // ----- TAB 9: TERRITORIAL -----
  function rTerritorial() {
    const zonas = DATA.territorial.zonas || [];
    if (zonas.length) {
      mkChart('rc-ternps', {
        type: 'bar',
        data: {
          labels: zonas.map(z => z.nombre),
          datasets: [{
            data: zonas.map(z => z.nps),
            backgroundColor: d => d.raw > 0 ? C.green : C.red,
            borderRadius: 4
          }]
        },
        options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
      });
    }

    const vol = DATA.territorial.volumenPorZona || [];
    if (vol.length) {
      mkChart('rc-tervol', {
        type: 'bar',
        data: {
          labels: vol.map(v => v.zona),
          datasets: [{ data: vol.map(v => v.volumen), backgroundColor: C.amber, borderRadius: 4 }]
        },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
    }

    document.getElementById('r-ter-zonas').innerHTML = zonas.map(z => `
      <div style="margin-bottom:8px;">
        <strong>${z.nombre}</strong> (NPS: ${z.nps}): ${z.nota || ''}
      </div>
    `).join('') || 'Sin detalles zonales.';
  }

  function renderTabCharts(tab) {
    if (tab === 'kpis') rKPIs();
    if (tab === 'sentimiento') { rSent('general'); rSentHallazgos(); }
    if (tab === 'topofmind') { rTom('general'); rTomCruces(); }
    if (tab === 'picos') rPicos();
    if (tab === 'plataformas') rPlat();
    if (tab === 'nube') rNube();
    if (tab === 'narrativas') rNarrativas();
    if (tab === 'riesgos') rRiesgos();
    if (tab === 'territorial') rTerritorial();
  }

  // Inicialización inmediata
  setTimeout(() => renderTabCharts('kpis'), 80);
})();
