(function(){
/* OPOSITOR · Expediente de adversarios (2 adversarios + cliente de referencia).
   Estructura y diseño = OPOSITOR_MICHOACAN.html. Claves: "a" = Adversario A
   (actor), "b" = Adversario B (actor2), "all" = ambos. */
const RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : {};
const META = window.DATA_META || {};
const root = document.getElementById('op-root');
const $ = (id) => document.getElementById(id);
const esc = (v) => (v === undefined || v === null) ? '' : String(v);
const A = (v) => Array.isArray(v) ? v : [];
const O = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};

const D = {
  meta: O(RAW.meta),
  adversarios: A(RAW.adversarios),
  iva: O(RAW.iva),
  alertaJuridica: esc(RAW.alertaJuridica),
  alertas: A(RAW.alertas), recomendaciones: A(RAW.recomendaciones), semaforo3C: A(RAW.semaforo3C),
  perfiles: A(RAW.perfiles), ier: A(RAW.ier), ierNota: esc(RAW.ierNota),
  contradicciones: A(RAW.contradicciones), vulnerabilidades: A(RAW.vulnerabilidades),
  red: A(RAW.red), implicaciones: O(RAW.implicaciones),
  narrativa: A(RAW.narrativa), disc: A(RAW.disc), discNota: esc(RAW.discNota),
  digital: A(RAW.digital), digitalNota: esc(RAW.digitalNota),
  vectores: A(RAW.vectores), defensa: A(RAW.defensa), comparativo: A(RAW.comparativo),
  indicadores9C: A(RAW.indicadores9C), diagnostico9B: O(RAW.diagnostico9B),
  bolsillo: A(RAW.bolsillo), bolsilloNota: esc(RAW.bolsilloNota), changelog: O(RAW.changelog)
};

/* Adversarios (los nombres reales siempre salen de la búsqueda) */
const advDe = (k) => D.adversarios.find(x => x && x.clave === k) || {};
const ADV = {
  a: Object.assign({ nombre: META.actor || 'Adversario A', corto: META.actor || 'Adversario A', siglas: 'A', partido: '' }, advDe('a')),
  b: Object.assign({ nombre: META.actor2 || 'Adversario B', corto: META.actor2 || 'Adversario B', siglas: 'B', partido: '' }, advDe('b'))
};
if (META.actor) ADV.a.nombre = META.actor;
if (META.actor2) ADV.b.nombre = META.actor2;
const CLIENTE = D.meta.cliente || META.cliente || '';
const CLI_CORTO = CLIENTE ? CLIENTE.split(/\s+/).slice(0, 2).join(' ') : 'Cliente';
const COLOR = { a: '#2563eb', b: '#e11d48' };

const LEG = { g: '<span class="pill p-g">🟢 Verde</span>', y: '<span class="pill p-y">🟡 Amarillo</span>', r: '<span class="pill p-r">🔴 Rojo</span>' };
const LEG_ICO = { g: '🟢', y: '🟡', r: '🔴' };
const WHO = { a: `<span class="pill p-b">${esc(ADV.a.corto)}</span>`, b: `<span class="pill p-m">${esc(ADV.b.corto)}</span>`, all: '<span class="pill p-n">Ambos</span>' };
const SIG = { a: `<span class="pill p-b">${esc(ADV.a.siglas)}</span>`, b: `<span class="pill p-m">${esc(ADV.b.siglas)}</span>` };
const RISK = { C: '<span class="pill p-r">Crítico</span>', A: '<span class="pill p-o">Alto</span>', M: '<span class="pill p-y">Medio</span>', B: '<span class="pill p-n">Bajo</span>' };
const NIVEL = {
  ALTA: { pill: 'p-r', ico: '🔴', txt: 'ALTA VULNERABILIDAD', col: 'var(--r)' },
  VULNERABLE: { pill: 'p-o', ico: '🟠', txt: 'VULNERABLE', col: 'var(--o)' },
  MEDIA: { pill: 'p-y', ico: '🟡', txt: 'VULNERABILIDAD MEDIA', col: 'var(--y)' },
  BAJA: { pill: 'p-g', ico: '🟢', txt: 'BAJA', col: 'var(--g)' }
};
const nivelDe = (n) => NIVEL[String(n || '').toUpperCase()] || NIVEL.MEDIA;
const vacio = (cols, msg) => `<tr><td colspan="${cols}" class="muted">${msg || 'Sin datos para el periodo.'}</td></tr>`;
const ivaDe = (k) => O(D.iva[k]);

/* ---------- HEADER ---------- */
$('op-tag-terr').textContent = D.meta.territorio || 'Territorio';
$('op-tag-vent').textContent = 'Ventana: ' + (D.meta.ventana || (META.periodo || [META.mes, META.anio].filter(Boolean).join(' ')));
const per = META.periodo || [META.mes, META.anio].filter(Boolean).join(' ');
if (per) $('op-tag-per').textContent = 'Periodo: ' + per; else $('op-tag-per').classList.add('hide');
$('op-h1').textContent = `Vulnerabilidades y contradicciones: ${ADV.a.nombre} · ${ADV.b.nombre}`;
$('op-sub').innerHTML = [esc(D.meta.contexto) || [D.meta.contienda].filter(Boolean).join(''),
  CLIENTE && !String(D.meta.contexto || '').includes(CLIENTE) ? `Cliente de referencia para contraste y defensa: <b>${esc(CLIENTE)}</b>.` : '',
  D.meta.fuente ? `Fuente: ${esc(D.meta.fuente)}` : ''].filter(Boolean).join(' ');
$('op-hero').innerHTML = ['a', 'b'].map(k => {
  const iv = ivaDe(k), nv = nivelDe(iv.nivel);
  return `<div class="ivabox"><div><div class="ivalbl">IVA · ${esc(ADV[k].corto)}</div><div class="ivanum" style="color:${nv.col}">${iv.total ?? '—'}</div></div><div><span class="pill ${nv.pill}">${nv.ico} ${nv.txt}</span></div></div>`;
}).join('') + `<div class="ivabox"><div><div class="ivalbl">Vectores con semáforo legal 🔴</div><div class="ivanum" style="color:var(--r)">${D.iva.vectoresRojos ?? 0}</div></div></div>`;
$('op-f-a').textContent = `${ADV.a.corto}${ADV.a.partido ? ' (' + ADV.a.partido + ')' : ''}`;
$('op-f-b').textContent = `${ADV.b.corto}${ADV.b.partido ? ' (' + ADV.b.partido + ')' : ''}`;
root.querySelectorAll('.op-th-a').forEach(th => th.textContent = ADV.a.corto);
root.querySelectorAll('.op-th-b').forEach(th => th.textContent = ADV.b.corto);
$('op-footer').textContent = `OPOSITOR · ESTUDIO CONFIDENCIAL · ${(D.meta.territorio || '').toUpperCase()}`;

/* ---------- TABS ---------- */
const TABS = [["op-t-res","Resumen & IVA"],["op-t-per","Perfiles & IER"],["op-t-con","Contradicciones"],["op-t-vul","Vulnerabilidades"],["op-t-red","Red de alianzas"],["op-t-nar","Narrativa · Psico · Digital"],["op-t-vec","Vectores + 6E"],["op-t-def","Defensa"],["op-t-cmp","Comparativo"],["op-t-bol","Bolsillo & versiones"]];
const nav = $('op-nav');
TABS.forEach(([id, l], i) => {
  const b = document.createElement('button'); b.textContent = l; b.dataset.t = id; if (i === 0) b.className = 'on';
  b.onclick = () => { nav.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); root.querySelectorAll('section.tab').forEach(s => s.classList.toggle('on', s.id === id)); };
  nav.appendChild(b);
});

/* ---------- 1 RESUMEN ---------- */
$('op-alerta-jur').innerHTML = `<b>Requiere validación jurídica antes de usar:</b> ${esc(D.alertaJuridica) || `${D.iva.vectoresRojos || 0} vector(es) quedaron en 🔴 (ver pestaña Vectores).`}`;
const ivA = ivaDe('a'), ivB = ivaDe('b');
$('op-iva-nota').innerHTML = `Ponderación: contradicciones 25% · vulnerabilidades 25% · debilidad narrativa 15% · vulnerabilidad digital 15% · brecha de gestión (IER) 20%. Contradicciones = promedio del TOP 3; vulnerabilidades = promedio de todas las fichas (Crítico 90 · Alto 75 · Medio 55 · Bajo 25). IVA total: <b>${esc(ADV.a.corto)} ${ivA.total ?? '—'} ${nivelDe(ivA.nivel).ico}</b> · <b>${esc(ADV.b.corto)} ${ivB.total ?? '—'} ${nivelDe(ivB.nivel).ico}</b>.${D.digitalNota && /PARCIAL/i.test(D.digitalNota) ? ' Estado: <b>PARCIAL</b> en el componente digital.' : ''}`;
$('op-alertas').innerHTML = D.alertas.map(x => `<li data-a="${x.a}">${SIG[x.a] || ''} ${x.texto}</li>`).join('') || '<li class="muted">Sin alertas.</li>';
$('op-recs').innerHTML = D.recomendaciones.map(r => `<li>${r}</li>`).join('') || '<li class="muted">Sin recomendaciones.</li>';
$('op-3c').innerHTML = D.semaforo3C.map((s, i) => { const nv = nivelDe(s.nivel); return `<div data-a="${s.a}" style="margin-bottom:10px"><span class="pill ${nv.pill}">${nv.ico} ${s.nivel === 'MEDIA' ? 'MEDIA' : nv.txt}</span> <b>${esc((ADV[s.a] || {}).corto)}</b>: ${s.texto}</div>`; }).join('');

/* ---------- 2 PERFILES & IER ---------- */
$('op-perfiles').innerHTML = ['a', 'b'].map(k => {
  const p = D.perfiles.find(x => x.a === k) || { rows: [] };
  const pillCls = k === 'a' ? 'p-b' : 'p-m';
  return `<div class="card ${k}" data-a="${k}"><h3>${esc(ADV[k].nombre)} ${ADV[k].partido ? `<span class="pill ${pillCls}">${esc(ADV[k].partido)}</span>` : ''}</h3>
    <div class="kv">${A(p.rows).map(r => `<b>${r.label}</b><span>${r.value}</span>`).join('') || '<b>—</b><span class="muted">Sin datos de perfil.</span>'}</div></div>`;
}).join('');
$('op-tIer').querySelector('tbody').innerHTML = D.ier.map(r => `<tr data-a="${r.a}"><td>${WHO[r.a]}</td><td>${r.cargo}</td><td>${r.periodo}</td><td>${r.promesa}</td><td>${r.resultado}</td><td><b>${r.valor}</b></td></tr>`).join('') || vacio(6);
$('op-ier-nota').innerHTML = `IER promedio: ${esc(ADV.a.corto)} ${ivA.ierPromedio ?? '—'} · ${esc(ADV.b.corto)} ${ivB.ierPromedio ?? '—'}.${D.ierNota ? ' ' + D.ierNota : ''}`;

/* ---------- 3 CONTRADICCIONES ---------- */
$('op-conCards').innerHTML = D.contradicciones.map(c => `<div class="card ${c.a}" data-a="${c.a}"><h3>${c.codigo} · ${c.titulo}</h3><div class="small muted">${c.tipo} · ${c.verificacion}</div><p style="margin:8px 0">${c.descripcion}</p><div class="kv small"><b>Fuentes</b><span>${c.fuentes}</span><b>Audiencia</b><span>${c.audiencia}</span><b>Uso</b><span>${c.uso}</span><b>Potencial</b><span>${c.potencial}/100<div class="bar"><i style="width:${c.potencial}%;background:${c.a === 'a' ? 'var(--pan)' : 'var(--mor)'}"></i></div></span></div></div>`).join('') || '<div class="card muted">Sin contradicciones documentadas en el periodo.</div>';

/* ---------- 4 VULNERABILIDADES ---------- */
$('op-tVul').querySelector('tbody').innerHTML = D.vulnerabilidades.map((r, i) => `<tr data-a="${r.a}"><td>${i + 1}</td><td>${WHO[r.a]}</td><td>${r.categoria}</td><td>${r.descripcion}</td><td class="small">${r.evidencia}</td><td class="small">${r.verificacion}</td><td>${RISK[r.riesgo] || RISK.M}</td><td>${r.publica}</td><td class="small">${r.uso}</td></tr>`).join('') || vacio(9);

/* ---------- 5 RED ---------- */
$('op-tRed').querySelector('tbody').innerHTML = D.red.map(r => `<tr data-a="${r.a}"><td><b>${r.actor}</b></td><td>${WHO[r.a]}</td><td>${r.vinculo}</td><td>${r.relevancia}</td><td>${r.compromete}</td></tr>`).join('') || vacio(5);
$('op-implic').innerHTML = ['a', 'b'].map(k => `<div class="card ${k}" data-a="${k}"><h3>Implicaciones · ${esc(ADV[k].corto)}</h3><ul class="l">${A(D.implicaciones[k]).map(t => `<li>${t}</li>`).join('') || '<li class="muted">Sin implicaciones registradas.</li>'}</ul></div>`).join('');

/* ---------- 6 NARRATIVA · PSICO · DIGITAL ---------- */
$('op-narr').innerHTML = ['a', 'b'].map(k => {
  const n = D.narrativa.find(x => x.a === k) || {};
  return `<div class="card ${k}" data-a="${k}"><h3>${esc(ADV[k].corto)} · Narrativa</h3>
    <div class="kv"><b>Propuesta central</b><span>${esc(n.propuesta) || '—'}</span><b>Identidad</b><span>${esc(n.identidad) || '—'}</span><b>Villano</b><span>${esc(n.villano) || '—'}</span><b>Emoción que activa</b><span>${esc(n.emocion) || '—'}</span><b>Frame (Lakoff)</b><span>${esc(n.frame) || '—'}</span></div>
    <h3 style="margin-top:12px">Fortalezas (no subestimar)</h3><ul class="l">${A(n.fortalezas).map(t => `<li>${t}</li>`).join('') || '<li class="muted">Sin datos.</li>'}</ul>
    <h3 style="margin-top:12px">Debilidades narrativas</h3><ul class="l">${A(n.debilidades).map(t => `<li>${t}</li>`).join('') || '<li class="muted">Sin datos.</li>'}</ul></div>`;
}).join('');
const dA = D.disc.find(x => x.a === 'a') || {}, dB = D.disc.find(x => x.a === 'b') || {};
const discRow = (lbl, fa, fb) => `<tr><td>${lbl}</td><td data-a="a">${fa(dA) || '<span class="muted">—</span>'}</td><td data-a="b">${fb(dB) || '<span class="muted">—</span>'}</td></tr>`;
const dd = (d) => d.dominante ? `<b>${d.dominante}</b>${d.secundario ? ' / ' + d.secundario : ''}${d.estilo ? ' — ' + d.estilo : ''}` : '';
$('op-disc').innerHTML = [
  discRow('DISC dominante / secundario', dd, dd),
  discRow('Evidencia', d => esc(d.evidencia), d => esc(d.evidencia)),
  discRow('Implicación en debate', d => esc(d.implicacionDebate), d => esc(d.implicacionDebate)),
  discRow('Ego trigger probable', d => esc(d.egoTrigger), d => esc(d.egoTrigger)),
  discRow('Patrón bajo presión', d => esc(d.patronBajoPresion), d => esc(d.patronBajoPresion)),
  discRow('Temas de evasión', d => esc(d.temasEvasion), d => esc(d.temasEvasion))
].join('');
$('op-disc-nota').innerHTML = D.discNota || 'La clasificación DISC es hipótesis de trabajo basada en conducta pública, no diagnóstico.';
const sinDato = (v) => /sin dato|sin evidencia/i.test(v || '');
$('op-dig').innerHTML = D.digital.map(r => `<tr><td>${r.indicador}</td><td data-a="a"${sinDato(r.a) ? ' class="muted"' : ''}>${r.a}</td><td data-a="b"${sinDato(r.b) ? ' class="muted"' : ''}>${r.b}</td></tr>`).join('') || vacio(3);
$('op-dig-nota').innerHTML = `${D.digitalNota ? D.digitalNota + ' ' : ''}Componente digital del IVA: ${esc(ADV.a.corto)} ${ivA.digital ?? '—'} · ${esc(ADV.b.corto)} ${ivB.digital ?? '—'}.`;

/* ---------- 7 VECTORES + 6E ---------- */
$('op-tVec').querySelector('tbody').innerHTML = D.vectores.map(v => `<tr data-a="${v.a}"><td class="mono">${v.codigo}</td><td>${WHO[v.a]}</td><td>${v.tipo}</td><td>${v.argumento}</td><td class="small">${v.evidencia}</td><td class="small">${v.audiencia}</td><td class="small">${v.canal}</td><td>${v.rebote}</td><td>${LEG[v.legal] || LEG.y}</td></tr>`).join('') || vacio(9);
$('op-vecLegal').innerHTML = D.vectores.filter(v => v.legal !== 'g').map(v => `<div class="card ${v.a}" data-a="${v.a}"><h3>Verificación 6E · ${v.codigo} ${LEG[v.legal] || ''}</h3><div class="kv small"><b>Calumnia electoral</b><span>${v.calumnia}</span><b>VPG</b><span>${v.vpg}</span><b>Datos / fuente</b><span>${v.datos}</span><b>Vida privada</b><span>${v.vidaPrivada}</span><b>Ajuste</b><span>${v.ajuste}</span></div></div>`).join('');

/* ---------- 8 DEFENSA ---------- */
$('op-def-h2').textContent = `Módulo 7 · Ataques anticipados contra ${CLIENTE || 'el cliente'} y protocolo de respuesta`;
$('op-defCards').innerHTML = D.defensa.map(d => `<div class="card cl" data-a="${d.a}"><h3>${d.titulo} ${WHO[d.a] || WHO.all}</h3><div class="kv small"><b>Evidencia que usará</b><span>${d.evidencia}</span><b>Probabilidad</b><span>${d.probabilidad}</span><b>1 · Bloqueo</b><span>${d.bloqueo}</span><b>2 · Reencuadre</b><span>${d.reencuadre}</span><b>3 · Contraataque</b><span>${d.contraataque}</span>${d.pendiente ? `<b style="color:var(--y)">Pendiente</b><span>${d.pendiente}</span>` : ''}</div></div>`).join('') || '<div class="card muted">Sin ataques anticipados.</div>';

/* ---------- 9 COMPARATIVO ---------- */
$('op-th-cli').textContent = CLIENTE ? `${CLI_CORTO} (cliente)` : 'Cliente';
const filasCmp = D.comparativo.map(r => `<tr><td><b>${r.dimension}</b></td><td>${r.cliente}</td><td data-a="a">${r.a}</td><td data-a="b">${r.b}</td><td class="small">${r.ventaja}</td></tr>`);
if (ivA.total !== undefined) {
  const mas = (ivA.total || 0) >= (ivB.total || 0) ? ADV.a.corto : ADV.b.corto;
  filasCmp.push(`<tr><td><b>IVA</b></td><td>— (no aplica)</td><td data-a="a">${ivA.total} ${nivelDe(ivA.nivel).ico}</td><td data-a="b">${ivB.total} ${nivelDe(ivB.nivel).ico}</td><td class="small">${esc(mas)} más expuesto</td></tr>`);
}
$('op-tCmp').querySelector('tbody').innerHTML = filasCmp.join('') || vacio(5);
$('op-9c').innerHTML = D.indicadores9C.map(r => { const m = sinDato(r.valor) || /sin datos/i.test(r.valor) ? ' class="muted"' : ''; return `<tr><td>${r.indicador}</td><td${m}>${r.valor}</td><td${m}>${r.fuente}</td><td${m}>${r.fecha}</td></tr>`; }).join('') || vacio(4);
const b9 = D.diagnostico9B;
$('op-9b').innerHTML = [['Dónde gana el cliente', b9.gana], ['Dónde pierde', b9.pierde], ['Terreno favorable', b9.favorable], ['Terreno que impondrán ellos', b9.impondran]].filter(x => x[1]).map(x => `<li><b>${x[0]}:</b> ${x[1]}</li>`).join('') || '<li class="muted">Sin diagnóstico.</li>';

/* ---------- 10 BOLSILLO & VERSIONES ---------- */
$('op-bol-nota').innerHTML = D.bolsilloNota || 'Tarjetas de preparación para debate y entrevistas.';
$('op-bolsillo').innerHTML = ['a', 'b'].map(k => {
  const b = D.bolsillo.find(x => x.a === k) || {}, iv = ivaDe(k), nv = nivelDe(iv.nivel);
  const ataques = A(b.meAtacara).map((x, i) => `${i + 1}) “${esc(x.ataque).replace(/^[“"]|[”"]$/g, '')}” → “${esc(x.respuesta).replace(/^[“"]|[”"]$/g, '')}”`).join(' ');
  const mios = A(b.misAtaques).map((x, i) => `${i + 1}) ${x.texto} ${LEG_ICO[x.legal] || ''}`).join(' ');
  return `<div class="pocket" data-a="${k}">
    <div class="mono" style="font-weight:800;margin-bottom:6px">BOLSILLO — ${esc(ADV[k].nombre).toUpperCase()}</div>
    <div class="ln"><b>IVA:</b> ${iv.total ?? '—'} ${nv.ico}</div>
    <div class="ln"><b>Su narrativa:</b> ${esc(b.narrativa) || '—'}</div>
    <div class="ln"><b>Su vulnerabilidad principal:</b> ${esc(b.vulnerabilidad) || '—'}</div>
    <div class="ln"><b>Bajo presión:</b> ${esc(b.bajoPresion) || '—'}</div>
    <div class="ln"><b>Me atacará con:</b> ${ataques || '—'}</div>
    <div class="ln"><b>Mis 3 ataques:</b> ${mios || '—'}</div>
    <div class="ln"><b>No debo:</b> ${esc(b.noDebo) || '—'}</div>
  </div>`;
}).join('');
const cl = D.changelog;
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/).slice(-2, -1)[0] || '';
$('op-changelog').innerHTML = `
  <b>Versión</b><span>${esc(cl.version) || `OPOSITOR_${slug(ADV.a.nombre)}_${slug(ADV.b.nombre)}_v1`}</span>
  <b>Fecha</b><span>${esc(cl.fecha) || new Date().toLocaleDateString('es-MX')}</span>
  <b>Periodo</b><span>${esc(per) || '—'}</span>
  <b>IVA</b><span>${esc(ADV.a.corto)} ${ivA.total ?? '—'} ${nivelDe(ivA.nivel).ico} · ${esc(ADV.b.corto)} ${ivB.total ?? '—'} ${nivelDe(ivB.nivel).ico}</span>
  <b>🔴 pendientes</b><span>${D.iva.vectoresRojos ?? 0}${cl.pendientes && cl.pendientes !== String(D.iva.vectoresRojos) ? ' (' + esc(cl.pendientes) + ')' : ''}</span>
  <b>Fase</b><span>${esc(cl.fase) || '—'}</span>`;
$('op-activadores').innerHTML = A(cl.activadores).map(t => `<li>${t}</li>`).join('') || '<li class="muted">Sin activadores definidos.</li>';

/* ---------- FILTRO POR ACTOR ---------- */
$('op-filt').querySelectorAll('button').forEach(b => b.onclick = () => {
  $('op-filt').querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on');
  const f = b.dataset.f;
  root.querySelectorAll('[data-a]').forEach(el => { const a = el.dataset.a; el.classList.toggle('hide', f !== 'all' && a !== 'all' && a !== f); });
});

/* ---------- CHARTS ---------- */
if (window.Chart) {
  Chart.defaults.color = '#334155';
  Chart.defaults.borderColor = '#b0b0b0';
  Chart.defaults.font.family = 'Segoe UI,Roboto,sans-serif';
  const comp = (iv) => [iv.contradicciones, iv.vulnerabilidades, iv.narrativa, iv.digital, iv.gestion, iv.total].map(v => v || 0);
  const digPar = /PARCIAL/i.test(D.digitalNota) ? 'Digital [PARCIAL]' : 'Digital';
  new Chart($('op-cIva'), {
    type: 'bar',
    data: { labels: ['Contradicciones', 'Vulnerabilidades', 'Debilidad narrativa', digPar, 'Brecha de gestión', 'IVA total'],
      datasets: [{ label: ADV.a.corto, data: comp(ivA), backgroundColor: COLOR.a }, { label: ADV.b.corto, data: comp(ivB), backgroundColor: COLOR.b }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { min: 0, max: 100 } } }
  });
  if (D.ier.length) new Chart($('op-cIer'), {
    type: 'bar',
    data: { labels: D.ier.map(r => ADV[r.a].siglas + ' · ' + r.cargo), datasets: [{ label: 'IER', data: D.ier.map(r => r.valor), backgroundColor: D.ier.map(r => COLOR[r.a]) }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 10 } } }
  });
  const cs = [...D.contradicciones].sort((x, y) => y.potencial - x.potencial);
  if (cs.length) new Chart($('op-cCon'), {
    type: 'bar',
    data: { labels: cs.map(c => c.codigo + ' · ' + String(c.titulo).slice(0, 48) + (String(c.titulo).length > 48 ? '…' : '')), datasets: [{ label: 'Potencial de daño', data: cs.map(c => c.potencial), backgroundColor: cs.map(c => COLOR[c.a]) }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 } } }
  });
}
})();
