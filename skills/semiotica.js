(function(){
const D_RAW = (window.DATA && Object.keys(window.DATA).length) ? window.DATA : null;
const META = window.DATA_META || {};

const FALLBACK = {
  territorio: {nombre: META.actor || 'Territorio', ventana:'', corte:'', fuentesRevisadas:0, metodologiaModulos:'13 módulos'},
  kpis: {arquetipoColectivo:'Sin datos', arquetipoColectivoDesc:'', arquetipoIdeal:'Sin datos', arquetipoIdealDesc:'', tensionDominante:'Sin datos', tensionDominanteDesc:'', irsTopActor:'Sin datos', irsTopScore:0, irsTopEstado:'warning'},
  codigoSimbolico: 'No se recibieron datos estructurados del backend.',
  signos: [], poblacion: [], significacion: [], narrativas: [], frameDominante: {titulo:'Frame dominante (Lakoff)', bullets:[]}, fundacionesMorales: {titulo:'Fundaciones morales activas (Haidt)', bullets:[]},
  miedos: [], deseos: [], necesidades: [], simbolosPoder: [], mapaMemetico: [], cosmovision: [],
  arquetipos: [], arquetipoIdealPrincipal: {rol:'', nombre:'', texto:'', riesgo:''}, arquetipoIdealSecundario: {rol:'', nombre:'', texto:'', riesgo:''},
  tensiones: [], matrizEstrategica: [],
  irs: {actores:[], nota1:'', nota2:''},
  fuentes: []
};
function pick(v, fb){ return (v!==undefined && v!==null && (Array.isArray(v)?v.length:Object.keys(v).length)) ? v : fb; }
const D = {};
Object.keys(FALLBACK).forEach(k => { D[k] = pick(D_RAW && D_RAW[k], FALLBACK[k]); });

const STATUS_LABEL = {good:'🟢 Resonancia alta', warning:'🟡 Alineado', serious:'🟠 Resonancia parcial', critical:'🔴 Desalineado'};
const STATUS_VAR = {good:'var(--good)', warning:'var(--warning)', serious:'var(--serious)', critical:'var(--critical)'};
const NARR_CLASS = {dominante:'dom', emergente:'', aspiracional:'emerg', enojo:'', miedo:'', esperanza:'emerg'};
const NARR_LABEL = {dominante:'Dominante', emergente:'Emergente', aspiracional:'Aspiracional / oficial', enojo:'De enojo', miedo:'De miedo', esperanza:'De esperanza'};

// ---------- header / hero ----------
document.getElementById('sm-brand-territorio').textContent = '· ' + D.territorio.nombre;
document.getElementById('sm-hero-territorio').textContent = D.territorio.nombre;
document.getElementById('sm-hero-sub').textContent = `Lectura de signos, símbolos, mitos y narrativas dominantes en ${D.territorio.nombre} a partir de evidencia digital pública — traducida en implicaciones estratégicas de comunicación política y en el Índice de Resonancia Simbólica (IRS) de los principales actores.`;
document.getElementById('sm-hero-meta').innerHTML = `
  <div class="meta-pill">Territorio: <b>&nbsp;${D.territorio.nombre}</b></div>
  <div class="meta-pill">Ventana: <b>&nbsp;${D.territorio.ventana}</b></div>
  <div class="meta-pill">Corte: <b>&nbsp;${D.territorio.corte}</b></div>
  <div class="meta-pill">Fuentes revisadas: <b>&nbsp;${D.territorio.fuentesRevisadas}</b></div>
  <div class="meta-pill">Metodología: <b>&nbsp;SEMIÓTICA · ${D.territorio.metodologiaModulos}</b></div>`;
document.getElementById('sm-ftr-corte').textContent = 'Corte: ' + D.territorio.corte;
document.getElementById('sm-fuentes-dek').textContent = `${D.fuentes.length} fuentes públicas revisadas dentro de la ventana ${D.territorio.ventana}. Los hallazgos sin doble fuente se señalan explícitamente en el cuerpo del estudio como "hallazgo no confirmado / señal única".`;

// ---------- KPIs ----------
document.getElementById('sm-kpis').innerHTML = `
  <div class="kpi-card"><div class="kpi-label">Arquetipo colectivo dominante</div><div class="kpi-value">${D.kpis.arquetipoColectivo}</div><div class="kpi-foot">${D.kpis.arquetipoColectivoDesc}</div></div>
  <div class="kpi-card"><div class="kpi-label">Arquetipo político ideal</div><div class="kpi-value">${D.kpis.arquetipoIdeal}</div><div class="kpi-foot">${D.kpis.arquetipoIdealDesc}</div></div>
  <div class="kpi-card"><div class="kpi-label">Tensión semiótica dominante</div><div class="kpi-value">${D.kpis.tensionDominante}</div><div class="kpi-foot">${D.kpis.tensionDominanteDesc}</div></div>
  <div class="kpi-card"><div class="kpi-label">IRS más alto entre aspirantes</div><div class="kpi-value tabular">${D.kpis.irsTopActor} — ${D.kpis.irsTopScore}/100</div><span class="status-chip ${D.kpis.irsTopEstado}">${STATUS_LABEL[D.kpis.irsTopEstado]||''}</span></div>`;

// ---------- código simbólico ----------
document.getElementById('sm-codigo-texto').innerHTML = D.codigoSimbolico;

// ---------- signos ----------
document.getElementById('sm-signos-grid').innerHTML = D.signos.map(cat=>`
  <div class="signo-cat"><h4>${cat.categoria}</h4>${(cat.items||[]).map(it=>`<div class="signo-item"><b>${it.titulo}</b><span>${it.texto}</span></div>`).join('')}</div>`).join('') || '<div class="signo-cat">Sin datos.</div>';
document.getElementById('sm-poblacion-chips').innerHTML = D.poblacion.map(p=>`
  <div class="pop-chip"><div class="top"><b>${p.titulo}</b><span class="dot-status ${p.estado}">${p.estado}</span></div><p>${p.texto}</p></div>`).join('') || '';

// ---------- significación ----------
document.getElementById('sm-sig-body').innerHTML = D.significacion.map(s=>`
  <tr><td class="tema">${s.tema}</td><td>${s.manifiesto}</td><td>${s.latente}</td><td>${s.inconsciente}</td></tr>`).join('') || '<tr><td colspan="4">Sin datos.</td></tr>';

// ---------- narrativas ----------
document.getElementById('sm-narr-grid').innerHTML = D.narrativas.map(n=>`
  <div class="narr-card ${NARR_CLASS[n.tipo]||''}"><h5>${NARR_LABEL[n.tipo]||n.tipo}</h5><p>${n.texto}</p></div>`).join('') || '<div class="narr-card">Sin datos.</div>';
document.getElementById('sm-frame-titulo').textContent = D.frameDominante.titulo || 'Frame dominante (Lakoff)';
document.getElementById('sm-frame-bullets').innerHTML = (D.frameDominante.bullets||[]).map(b=>`<li>${b}</li>`).join('') || '<li>Sin datos.</li>';
document.getElementById('sm-moral-titulo').textContent = D.fundacionesMorales.titulo || 'Fundaciones morales activas (Haidt)';
document.getElementById('sm-moral-bullets').innerHTML = (D.fundacionesMorales.bullets||[]).map(b=>`<li>${b}</li>`).join('') || '<li>Sin datos.</li>';

// ---------- miedos / deseos / necesidades ----------
function renderRank(id, items, cls){
  document.getElementById(id).innerHTML = items.map((t,i)=>{
    const pct = 100 - (i*6);
    return `<li class="rank-row"><span class="rank-idx mono">${String(i+1).padStart(2,'0')}</span><div class="rank-bar-track"><div class="rank-bar-fill ${cls}" style="width:${pct}%"></div><div class="rank-label">${t}</div></div></li>`;
  }).join('') || '<li>Sin datos.</li>';
}
renderRank('sm-list-miedos', D.miedos, '');
renderRank('sm-list-deseos', D.deseos, 'deseo');
renderRank('sm-list-necesidades', D.necesidades, 'necesidad');

// ---------- símbolos de poder ----------
document.getElementById('sm-simbolos-grid').innerHTML = D.simbolosPoder.map(s=>`<div class="sym-card"><b>${s.titulo}</b><p>${s.texto}</p></div>`).join('') || '<div class="sym-card">Sin datos.</div>';

// ---------- mapa memético ----------
const MEME_LABEL = {admira:'Se admira', ridiculiza:'Se ridiculiza', castiga:'Se castiga', rechaza:'Se rechaza', legitima:'Se legitima'};
document.getElementById('sm-meme-grid').innerHTML = D.mapaMemetico.map(m=>`<div class="meme-card ${m.tipo}"><h5>${MEME_LABEL[m.tipo]||m.tipo}</h5><p>${m.texto}</p></div>`).join('') || '<div class="meme-card">Sin datos.</div>';

// ---------- cosmovisión ----------
document.getElementById('sm-cosmo-grid').innerHTML = D.cosmovision.map(c=>`<div class="cosmo-card"><h5>${c.concepto}</h5><p>${c.texto}</p></div>`).join('') || '<div class="cosmo-card">Sin datos.</div>';

// ---------- arquetipos ----------
const ARQ_CLASS = {Dominante:'dominante', Secundario:'secundario', Emergente:'emergente', Rechazado:'rechazado'};
document.getElementById('sm-arq-grid').innerHTML = D.arquetipos.map(a=>`
  <div class="arq-card ${ARQ_CLASS[a.rol]||''}"><div class="role">${a.rol}</div><h4>${a.nombre}</h4><p>${a.texto}</p></div>`).join('') || '<div class="arq-card">Sin datos.</div>';
document.getElementById('sm-ideal1-nombre').textContent = D.arquetipoIdealPrincipal.nombre || '';
document.getElementById('sm-ideal1-texto').textContent = D.arquetipoIdealPrincipal.texto || '';
document.getElementById('sm-ideal1-riesgo').innerHTML = D.arquetipoIdealPrincipal.riesgo ? `Riesgo de sobreactuación: <b>${D.arquetipoIdealPrincipal.riesgo}</b>` : '';
document.getElementById('sm-ideal2-nombre').textContent = D.arquetipoIdealSecundario.nombre || '';
document.getElementById('sm-ideal2-texto').textContent = D.arquetipoIdealSecundario.texto || '';
document.getElementById('sm-ideal2-riesgo').innerHTML = D.arquetipoIdealSecundario.riesgo ? `Riesgo de sobreactuación: <b>${D.arquetipoIdealSecundario.riesgo}</b>` : '';

// ---------- tensiones ----------
document.getElementById('sm-tension-list').innerHTML = D.tensiones.map((t,i)=>`
  <div class="tension-row"><div class="tension-rank">${i+1}</div><div>
    <div class="tension-poles"><span class="a">${t.poloA}</span><span class="b">${t.poloB}</span></div>
    <div class="tbar"><i style="width:${t.intensidad}%;"></i></div>
    <div class="tension-desc">${t.texto}</div>
  </div></div>`).join('') || '<div class="tension-row">Sin datos.</div>';

// ---------- matriz ----------
document.getElementById('sm-matrix-body').innerHTML = D.matrizEstrategica.map(m=>`
  <tr><td>${m.decir}</td><td class="bad-cell">${m.noDecir}</td><td>${m.simbolosUsar}</td><td class="bad-cell">${m.simbolosEvitar}</td>
  <td>${m.emocionesMovilizan}</td><td>${m.emocionesBloquean}</td><td class="good-cell">${m.narrativaGanadora}</td><td class="bad-cell">${m.narrativaPerdedora}</td></tr>`).join('') || '<tr><td colspan="8">Sin datos.</td></tr>';

// ---------- IRS ----------
const actoresIrs = (D.irs.actores||[]).map(a=>({...a, total:(a.narrativa||0)+(a.simbolos||0)+(a.arquetipo||0)})).sort((a,b)=>b.total-a.total);
document.getElementById('sm-irs-chart').innerHTML = actoresIrs.map(a=>`
  <div class="irs-bar-row"><div class="irs-bar-top"><span class="irs-name">${a.nombre}<span class="irs-party">${a.cargo||''}</span></span><span class="irs-score tabular" style="color:${STATUS_VAR[a.estado]||'#000'}">${a.total}/100</span></div>
  <div class="irs-track"><div class="irs-fill" style="width:${a.total}%;background:${STATUS_VAR[a.estado]||'#000'}"></div></div></div>`).join('') + `
  <div class="irs-legend">
    <span><i style="background:var(--good)"></i>81–100 alta</span><span><i style="background:var(--warning)"></i>61–80 alineado</span>
    <span><i style="background:var(--serious)"></i>41–60 parcial</span><span><i style="background:var(--critical)"></i>0–40 desalineado</span>
  </div>` || '';
document.getElementById('sm-irs-table-body').innerHTML = actoresIrs.map(a=>`
  <tr><td class="name">${a.nombre}</td><td>${a.cargo||''}</td><td class="tabular">${a.narrativa}/40</td><td class="tabular">${a.simbolos}/30</td><td class="tabular">${a.arquetipo}/30</td>
  <td class="tabular" style="font-weight:700;color:${STATUS_VAR[a.estado]||'#000'}">${a.total}</td><td style="color:${STATUS_VAR[a.estado]||'#000'}">${STATUS_LABEL[a.estado]||''}</td></tr>`).join('') || '<tr><td colspan="7">Sin datos.</td></tr>';
document.getElementById('sm-irs-nota1').textContent = D.irs.nota1 || 'A mide si el actor refuerza o entra en conflicto con las narrativas del Módulo 4. B mide el uso auténtico (o forzado) de los signos del Módulo 1, 2 y 6. C mide la coherencia entre imagen pública y el Arquetipo Político Ideal.';
document.getElementById('sm-irs-nota2').textContent = D.irs.nota2 || '';

// ---------- fuentes ----------
document.getElementById('sm-sources-list').innerHTML = D.fuentes.map((s,i)=>`
  <div class="source-item"><span class="n">${String(i+1).padStart(2,'0')}</span>${s.url?`<a href="${s.url}" target="_blank" rel="noopener">${s.titulo}</a>`:`<span>${s.titulo}</span>`}</div>`).join('') || '<div class="source-item">Sin fuentes registradas.</div>';
})();
