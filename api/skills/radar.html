<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RADAR v2.0 - {{ACTOR_NOMBRE}}</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
  <style>
    :root {
      --hdrblue: #1C2738;
      --navy: #1C2738;
      --ac: #00C2D4;
      --go: #F4C430;
      --da: #E63946;
      --su: #2EC4B6;
      --ne: #556B2F;
      --bl: #1B4F8A;
      --card: #d5d1d1;
      --border: rgba(28,39,56,0.15);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #ffffff; color: #1C2738; font-family: system-ui, sans-serif; min-height: 100vh; }

    .hdr { background: var(--hdrblue); border-bottom: 1px solid rgba(255,255,255,0.1); padding: 18px 24px; position: sticky; top: 0; backdrop-filter: blur(12px); z-index: 100; display: flex; justify-content: space-between; align-items: center; }
    .hdr-name { font-size: 20px; font-weight: 800; color: #fff; letter-spacing: 0.5px; line-height: 1.2; }
    .hdr-name span { color: var(--ac); }
    .hdr-sub { font-size: 11px; color: #94A3B8; margin-top: 4px; font-weight: 500; }

    .con { max-width: 1300px; margin: 0 auto; padding: 0 20px; }
    
    .tabs { display: flex; border-bottom: 2px solid var(--navy); overflow-x: auto; scrollbar-width: none; margin-top: 20px; margin-bottom: 24px; gap: 4px; }
    .tb { font-family: monospace; font-size: 9px; padding: 10px 14px; cursor: pointer; color: #718096; border-bottom: 3px solid transparent; white-space: nowrap; background: rgba(0,0,0,0.03); border: none; transition: all .2s; font-weight: 700; }
    .tb:hover { color: var(--navy); background: rgba(0,0,0,0.07); }
    .tb.act { color: #ffffff; background: var(--navy); border-bottom-color: var(--ac); }
    
    .tsec { display: none; }
    .tsec.show { display: block; animation: fi .3s ease; }
    @keyframes fi { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    .stitle { font-family: monospace; font-size: 10px; font-weight: 700; color: var(--navy); letter-spacing: 4px; margin-bottom: 14px; display: flex; align-items: center; gap: 10px; margin-top: 10px; }
    .stitle::after { content: ''; flex: 1; height: 2px; background: linear-gradient(90deg, var(--border), transparent); }

    .cg { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 28px; }
    @media(max-width: 768px) { .cg { grid-template-columns: 1fr; } }

    .card { background: var(--card); border: 1px solid rgba(0,0,0,0.05); border-radius: 4px; padding: 18px; color: #1a202c; }
    .ct { font-size: 13px; font-weight: 700; margin-bottom: 3px; color: var(--navy); }
    .cs { font-size: 10px; color: #4a5568; margin-bottom: 14px; }

    .bbar { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
    .blbl { font-family: monospace; font-size: 9px; color: var(--navy); letter-spacing: 1px; font-weight: 700; }
    .bb { font-family: monospace; font-size: 8px; padding: 5px 11px; border-radius: 2px; cursor: pointer; border: 1px solid var(--navy); background: transparent; color: var(--navy); letter-spacing: 1px; transition: all .15s; font-weight: 700; }
    .bb:hover, .bb.act { background: var(--navy); color: #fff; }

    .ng { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
    @media(max-width: 900px) { .ng { grid-template-columns: 1fr; } }

    .nc { background: var(--card); border: 1px solid rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden; color: #1a202c; }
    .nh { padding: 10px 13px; font-family: monospace; font-size: 9px; font-weight: 700; letter-spacing: 2px; }
    .nh.fav { background: rgba(46,196,182,.25); color: #004d4d; border-bottom: 1px solid rgba(46,196,182,.4); }
    .nh.crit { background: rgba(230,57,70,.2); color: #8b0000; border-bottom: 1px solid rgba(230,57,70,.3); }
    .nh.neu { background: rgba(0,0,0,.08); color: var(--navy); border-bottom: 1px solid rgba(0,0,0,.15); }
    .ni { padding: 11px 13px; border-bottom: 1px solid rgba(0,0,0,.06); }
    .ni:last-child { border-bottom: none; }
    .nit { font-size: 12px; font-weight: 700; margin-bottom: 3px; color: var(--navy); }
    .nd { font-size: 10px; color: #2d3748; line-height: 1.4; }

    .btag { display: inline-block; font-family: monospace; font-size: 7px; padding: 2px 6px; border-radius: 2px; margin-top: 4px; font-weight: 700; margin-right: 4px; }
    .bgen { background: rgba(27,79,138,.15); color: var(--bl); border: 1px solid rgba(27,79,138,.3); }
    .bage { background: rgba(244,196,48,.25); color: #8b6508; border: 1px solid rgba(244,196,48,.4); }
    .bpar { background: rgba(46,196,182,.15); color: #006666; border: 1px solid rgba(46,196,182,.3); }
    .bloc { background: rgba(28,39,56,.12); color: var(--navy); border: 1px solid rgba(28,39,56,.25); }
    .bsrc { background: rgba(230,57,70,.15); color: #990000; border: 1px solid rgba(230,57,70,.25); }

    .bi { background: rgba(255,255,255,.5); border-left: 3px solid var(--bl); padding: 6px 9px; font-size: 9px; color: #2d3748; line-height: 1.5; margin-top: 7px; border-radius: 0 2px 2px 0; }
    .bi strong { color: var(--bl); }
    .bi.neg { border-left-color: var(--da); background: rgba(230,57,70,.08); }
    .bi.neg strong { color: var(--da); }
    .bi.ntr { border-left-color: #4a5568; background: rgba(0,0,0,.04); }
    .bi.ntr strong { color: #1a202c; }

    .mg { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 28px; }
    @media(max-width: 768px) { .mg { grid-template-columns: 1fr; } }
    .mh { padding: 10px 14px; font-family: monospace; font-size: 9px; font-weight: 700; letter-spacing: 2px; }
    .mh.risk { background: rgba(230,57,70,.25); color: #8b0000; border: 1px solid rgba(230,57,70,.3); border-bottom: none; }
    .mh.opp { background: rgba(46,196,182,.2); color: #004d4d; border: 1px solid rgba(46,196,182,.3); border-bottom: none; }
    .mb { border: 1px solid rgba(0,0,0,.08); border-top: none; border-radius: 0 0 4px 4px; background: var(--card); }
    .mr { padding: 11px 13px; border-bottom: 1px solid rgba(0,0,0,.05); }
    .mr:last-child { border-bottom: none; }
    .mt { display: flex; align-items: center; gap: 9px; margin-bottom: 5px; }
    .lv { font-family: monospace; font-size: 7px; font-weight: 700; padding: 3px 7px; border-radius: 2px; min-width: 50px; text-align: center; }
    .lc { background: #E63946; color: #fff; } .la { background: #E67E22; color: #fff; } .lm { background: #F4C430; color: #0D1B2A; }
    .mn { font-size: 12px; font-weight: 700; color: var(--navy); }
    .md { font-size: 10px; color: #2d3748; line-height: 1.5; margin-bottom: 5px; }

    .hm { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-bottom: 28px; }
    @media(max-width: 768px) { .hm { grid-template-columns: repeat(2, 1fr); } }
    .hz { background: var(--card); border-radius: 4px; padding: 13px; text-align: center; border: 2px solid transparent; color: #1a202c; }
    .hz.fav { border-color: var(--su); background: rgba(46,196,182,.15); }
    .hz.adv { border-color: var(--da); background: rgba(230,57,70,.12); }
    .hz.ine { border-color: #b8860b; background: rgba(244,196,48,.15); }
    .hzn { font-size: 12px; font-weight: 700; margin-bottom: 4px; color: var(--navy); }
    .hzs { font-size: 20px; font-weight: 800; }
    .hz.fav .hzs, .hz.fav .hzl { color: #006666; }
    .hz.adv .hzs, .hz.adv .hzl { color: #990000; }
    .hz.ine .hzs, .hz.ine .hzl { color: #8b6508; }
    .hzl { font-family: monospace; font-size: 8px; margin-top: 4px; font-weight: 700; }

    .ig { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; margin-bottom: 24px; }
    @media(max-width: 768px) { .ig { grid-template-columns: 1fr; } }
    .ic { background: var(--card); border: 1px solid rgba(0,0,0,0.05); border-radius: 4px; padding: 13px; color: #1a202c; }
    .ic.ac { border-left: 3px solid var(--bl); } .ic.go { border-left: 3px solid #b8860b; } .ic.su { border-left: 3px solid #008080; } .ic.bl { border-left: 3px solid var(--navy); } .ic.da { border-left: 3px solid var(--da); }
    .ih { font-size: 11px; font-weight: 700; margin-bottom: 5px; color: var(--navy); }
    .ib { font-size: 11px; color: #2d3748; line-height: 1.6; }
    .im { font-size: 10px; color: var(--bl); margin-top: 5px; font-weight: 600; }

    .footer { background: #1C2738; border-top: 1px solid rgba(255,255,255,0.1); padding: 14px 24px; font-size: 11px; color: #94A3B8; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-top: 40px; border-radius: 4px; }
    canvas { max-height: 220px; }
  </style>
</head>
<body>

<header class="hdr">
  <div>
    <h1 class="hdr-name">{{ACTOR_NOMBRE_PRINCIPAL}} <span>{{ACTOR_APELLIDOS}}</span></h1>
    <p class="hdr-sub">{{ACTOR_CARGO}} &middot; {{ACTOR_ENTIDAD}} &middot; {{ACTOR_PARTIDO}} &middot; {{PERIODO_EVALUADO}}</p>
  </div>
</header>

<main class="con">
  <div class="tabs">
    <button class="tb act" onclick="tab(this,'kpis')">KPIs AMPLIADOS</button>
    <button class="tb" onclick="tab(this,'sent')">SENTIMIENTO</button>
    <button class="tb" onclick="tab(this,'tom')">TOP OF MIND</button>
    <button class="tb" onclick="tab(this,'plat')">PLATAFORMAS</button>
    <button class="tb" onclick="tab(this,'nar')">NARRATIVAS</button>
    <button class="tb" onclick="tab(this,'risk')">RIESGOS &amp; OPORT.</button>
    <button class="tb" onclick="tab(this,'ter')">MAPA TERRITORIAL</button>
  </div>

  <!-- 1. KPIs -->
  <div class="tsec show" id="tab-kpis">
    <div class="stitle">KPIs BIVARIADOS</div>
    <div class="cg">
      <div class="card"><div class="ct">NPS-P por Identidad Partidista</div><div class="cs">Aprobación según filiación política</div><canvas id="c-npspar"></canvas></div>
      <div class="card"><div class="ct">NPS-P por Género y Edad</div><div class="cs">Brecha demográfica</div><canvas id="c-npsdemo"></canvas></div>
      <div class="card"><div class="ct">Ratio Ataque/Defensa por Plataforma</div><div class="cs">Conversación adversa por red</div><canvas id="c-ratiopl"></canvas></div>
      <div class="card"><div class="ct">TRA — Evolución Reputacional</div><div class="cs">Temperatura acumulada en el tiempo</div><canvas id="c-tra"></canvas></div>
    </div>
  </div>

  <!-- 2. SENTIMIENTO -->
  <div class="tsec" id="tab-sent">
    <div class="stitle">SENTIMIENTO DIGITAL — ANÁLISIS BIVARIADO</div>
    <div class="bbar">
      <span class="blbl">CRUZAR POR →</span>
      <button class="bb act" onclick="updSent(this,'general')">GENERAL</button>
      <button class="bb" onclick="updSent(this,'genero')">GÉNERO</button>
      <button class="bb" onclick="updSent(this,'edad')">EDAD</button>
      <button class="bb" onclick="updSent(this,'partido')">PARTIDO</button>
    </div>
    <div class="cg" style="grid-template-columns: 1fr;">
      <div class="card"><div class="ct" id="sent-t">Sentimiento General</div><div class="cs" id="sent-s">Clasificación semántica del periodo</div><canvas id="c-sent"></canvas></div>
    </div>
    <div class="stitle">HALLAZGOS BIVARIADOS</div>
    <div class="ig">
      <div class="ic ac"><div class="ih">GÉNERO × SENTIMIENTO</div><div class="ib">{{HALLAZGO_GENERO}}</div><div class="im">→ {{ACCION_GENERO}}</div></div>
      <div class="ic go"><div class="ih">PARTIDO × SENTIMIENTO</div><div class="ib">{{HALLAZGO_PARTIDO}}</div><div class="im">→ {{ACCION_PARTIDO}}</div></div>
      <div class="ic su"><div class="ih">EDAD × SENTIMIENTO</div><div class="ib">{{HALLAZGO_EDAD}}</div><div class="im">→ {{ACCION_EDAD}}</div></div>
      <div class="ic bl"><div class="ih">LOCALIDAD × SENTIMIENTO</div><div class="ib">{{HALLAZGO_LOCALIDAD}}</div><div class="im">→ {{ACCION_LOCALIDAD}}</div></div>
    </div>
  </div>

  <!-- 3. TOP OF MIND -->
  <div class="tsec" id="tab-tom">
    <div class="stitle">TOP OF MIND — ANÁLISIS BIVARIADO</div>
    <div class="bbar">
      <span class="blbl">CRUZAR POR →</span>
      <button class="bb act" onclick="updTom(this,'general')">GENERAL</button>
      <button class="bb" onclick="updTom(this,'genero')">GÉNERO</button>
      <button class="bb" onclick="updTom(this,'edad')">EDAD</button>
      <button class="bb" onclick="updTom(this,'partido')">PARTIDO</button>
    </div>
    <div class="card" style="margin-bottom:18px"><div class="ct" id="tom-t">Top de Temas — General</div><div class="cs" id="tom-s">¿Qué domina la conversación pública?</div><canvas id="c-tom" style="max-height:230px"></canvas></div>
    <div class="stitle">CRUCES TEMÁTICOS</div>
    <div class="ig">
      <div class="ic ac"><div class="ih">GÉNERO × TEMA</div><div class="ib">{{CRUCE_GENERO_TEMA}}</div><div class="im">→ {{ACCION_GENERO_TEMA}}</div></div>
      <div class="ic go"><div class="ih">EDAD × TEMA</div><div class="ib">{{CRUCE_EDAD_TEMA}}</div><div class="im">→ {{ACCION_EDAD_TEMA}}</div></div>
      <div class="ic da"><div class="ih">PARTIDO × TEMA</div><div class="ib">{{CRUCE_PARTIDO_TEMA}}</div><div class="im">→ {{ACCION_PARTIDO_TEMA}}</div></div>
      <div class="ic bl"><div class="ih">LOCALIDAD × TEMA</div><div class="ib">{{CRUCE_LOCALIDAD_TEMA}}</div><div class="im">→ {{ACCION_LOCALIDAD_TEMA}}</div></div>
    </div>
  </div>

  <!-- 4. PLATAFORMAS -->
  <div class="tsec" id="tab-plat">
    <div class="stitle">PLATAFORMAS — ANÁLISIS BIVARIADO</div>
    <div class="cg">
      <div class="card"><div class="ct">Alcance por Plataforma</div><div class="cs">Peso relativo de cada canal</div><canvas id="c-plalc"></canvas></div>
      <div class="card"><div class="ct">Tono por Plataforma</div><div class="cs">Aprobación / Crítica por red</div><canvas id="c-pltono"></canvas></div>
      <div class="card"><div class="ct">Plataforma × Edad</div><div class="cs">Distribución demográfica por red</div><canvas id="c-pledad"></canvas></div>
      <div class="card"><div class="ct">Velocidad de Viralización (horas)</div><div class="cs">Crítica vs. contenido propio</div><canvas id="c-plviral"></canvas></div>
    </div>
    <div class="stitle">LECTURA ESTRATÉGICA</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px">
      <div class="card"><div class="ct" style="font-size:12px;color:var(--bl);margin-bottom:4px;font-weight:700">Facebook</div><div class="ib">{{PLATAFORMA_FB_TEXTO}}</div></div>
      <div class="card"><div class="ct" style="font-size:12px;color:var(--bl);margin-bottom:4px;font-weight:700">Twitter / X</div><div class="ib">{{PLATAFORMA_TW_TEXTO}}</div></div>
      <div class="card"><div class="ct" style="font-size:12px;color:var(--da);margin-bottom:4px;font-weight:700">TikTok</div><div class="ib">{{PLATAFORMA_TK_TEXTO}}</div></div>
    </div>
  </div>

  <!-- 5. NARRATIVAS -->
  <div class="tsec" id="tab-nar">
    <div class="stitle">ANÁLISIS BIVARIADO DE NARRATIVAS</div>
    <div class="ng">
      <!-- FAVORABLES -->
      <div class="nc">
        <div class="nh fav">▲ NARRATIVAS FAVORABLES</div>
        <!-- Iterar item según datos -->
        <div class="ni">
          <div class="nit">{{NARRATIVA_FAV_1_TITULO}}</div>
          <div class="nd">{{NARRATIVA_FAV_1_DESC}}</div>
          <span class="btag bgen">{{TAG_DEMO}}</span><span class="btag bloc">{{TAG_ZONA}}</span>
          <div class="bi"><strong>Bivariado:</strong> {{NARRATIVA_FAV_1_BIVARIADO}}</div>
        </div>
      </div>
      <!-- CRÍTICAS -->
      <div class="nc">
        <div class="nh crit">▼ NARRATIVAS CRÍTICAS</div>
        <div class="ni">
          <div class="nit" style="color:#8b0000">{{NARRATIVA_CRIT_1_TITULO}}</div>
          <div class="nd">{{NARRATIVA_CRIT_1_DESC}}</div>
          <span class="btag bsrc">{{TAG_ORIGEN}}</span>
          <div class="bi neg"><strong>Bivariado:</strong> {{NARRATIVA_CRIT_1_BIVARIADO}}</div>
        </div>
      </div>
      <!-- NEUTRAS -->
      <div class="nc">
        <div class="nh neu">◆ NARRATIVAS NEUTRAS</div>
        <div class="ni">
          <div class="nit">{{NARRATIVA_NEU_1_TITULO}}</div>
          <div class="nd">{{NARRATIVA_NEU_1_DESC}}</div>
          <div class="bi ntr"><strong>Bivariado:</strong> {{NARRATIVA_NEU_1_BIVARIADO}}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 6. RIESGOS Y OPORTUNIDADES -->
  <div class="tsec" id="tab-risk">
    <div class="stitle">MATRIZ BIVARIADA DE RIESGOS Y OPORTUNIDADES</div>
    <div class="mg">
      <div>
        <div class="mh risk">⚠ RIESGOS — IMPACTO POR SEGMENTO</div>
        <div class="mb">
          <div class="mr">
            <div class="mt"><span class="lv lc">CRÍTICO</span><span class="mn">{{RIESGO_1_TITULO}}</span></div>
            <div class="md">{{RIESGO_1_DESC}}</div>
            <div class="bi neg"><strong>Bivariado:</strong> {{RIESGO_1_BIVARIADO}}</div>
          </div>
        </div>
      </div>
      <div>
        <div class="mh opp">✦ OPORTUNIDADES — POTENCIAL POR SEGMENTO</div>
        <div class="mb">
          <div class="mr">
            <div class="mt"><span class="lv" style="background:#008080;color:#fff">ALTO</span><span class="mn">{{OPORTUNIDAD_1_TITULO}}</span></div>
            <div class="md">{{OPORTUNIDAD_1_DESC}}</div>
            <div class="bi"><strong>Bivariado:</strong> {{OPORTUNIDAD_1_BIVARIADO}}</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 7. TERRITORIAL -->
  <div class="tsec" id="tab-ter">
    <div class="stitle">MAPA DE CALOR TERRITORIAL — NPS-P POR ZONA</div>
    <div class="hm">
      <!-- Ejemplo de tarjeta de zona -->
      <div class="hz fav">
        <div class="hzn">{{ZONA_1_NOMBRE}}</div>
        <div class="hzs">{{ZONA_1_NPS}}</div>
        <div class="hzl">🟢 FAVORABLE</div>
        <div style="font-size:9px;color:#4a5568;margin-top:5px">{{ZONA_1_MOTIVO}}</div>
      </div>
      <div class="hz adv">
        <div class="hzn">{{ZONA_2_NOMBRE}}</div>
        <div class="hzs">{{ZONA_2_NPS}}</div>
        <div class="hzl">🔴 ADVERSA</div>
        <div style="font-size:9px;color:#4a5568;margin-top:5px">{{ZONA_2_MOTIVO}}</div>
      </div>
    </div>
    <div class="cg">
      <div class="card"><div class="ct">NPS-P por Zona</div><div class="cs">Aprobación neta geográfica</div><canvas id="c-ternps"></canvas></div>
      <div class="card"><div class="ct">Volumen por Zona</div><div class="cs">% del total de menciones</div><canvas id="c-tervol"></canvas></div>
    </div>
  </div>
</main>

<div class="footer">
  <span>Radar Análisis Bivariado &middot; {{ACTOR_ENTIDAD}} &middot;</span>
  <span>CONFIDENCIAL &middot; Uso estratégico exclusivo &middot;</span>
</div>

<script>
const C = { ac: '#1B4F8A', go: '#B8860B', da: '#E63946', su: '#008080', ne: '#4a5568', bl: '#1C2738' };
Chart.defaults.color = '#2d3748';
Chart.defaults.font.family = 'system-ui,sans-serif';

function tab(btn, id) {
  document.querySelectorAll('.tsec').forEach(s => s.classList.remove('show'));
  document.querySelectorAll('.tb').forEach(t => t.classList.remove('act'));
  const target = document.getElementById('tab-' + id);
  if(target) target.classList.add('show');
  btn.classList.add('act');
  setTimeout(() => rCharts(id), 60);
}

const CH = {};
function mk(id, cfg) {
  if (CH[id]) CH[id].destroy();
  const c = document.getElementById(id);
  if (!c) return;
  CH[id] = new Chart(c, cfg);
}

// -------------------------------------------------------------
// DATASETS DINÁMICOS - INYECTAR AQUÍ LOS VALORES DESDE EL SKILL
// -------------------------------------------------------------

function rKpis() {
  mk('c-npspar', {
    type: 'bar',
    data: {
      labels: {{KPIS_PARTIDO_LABELS}}, // ej: ['Base', 'Independientes', 'Oposición']
      datasets: [{ data: {{KPIS_PARTIDO_DATA}}, backgroundColor: [C.su, C.ne, C.da], borderRadius: 2 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });

  mk('c-npsdemo', {
    type: 'bar',
    data: {
      labels: {{KPIS_DEMO_LABELS}}, // ej: ['H18-29', 'M18-29', 'H30-44', 'M30-44']
      datasets: [{ data: {{KPIS_DEMO_DATA}}, backgroundColor: d => d.raw >= 0 ? C.su : C.da, borderRadius: 2 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });

  mk('c-ratiopl', {
    type: 'bar',
    data: {
      labels: {{KPIS_RATIO_PLATAFORMAS_LABELS}},
      datasets: [{ data: {{KPIS_RATIO_PLATAFORMAS_DATA}}, backgroundColor: [C.da, C.go, C.su], borderRadius: 2 }]
    },
    options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } } }
  });

  mk('c-tra', {
    type: 'line',
    data: {
      labels: {{KPIS_TRA_LABELS}}, // ej: ['S1', 'S2', 'S3', 'S4']
      datasets: [{ data: {{KPIS_TRA_DATA}}, borderColor: C.ac, backgroundColor: 'rgba(27,79,138,.1)', fill: true, tension: .4 }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

let sC = null;
const SENT = {{DATASET_SENTIMIENTO}}; // Objeto JS con esquemas: general, genero, edad, partido

function rSent(k) {
  if (sC) sC.destroy();
  const d = SENT[k];
  const c1 = document.getElementById('c-sent');
  if (!c1) return;
  const isBar = d.t === 'bar';
  sC = new Chart(c1, {
    type: d.t,
    data: { labels: d.l, datasets: [{ data: d.d, backgroundColor: d.c, borderWidth: 0 }] },
    options: { responsive: true, plugins: { legend: { display: !isBar, position: 'bottom' } } }
  });
}

function updSent(btn, k) {
  document.querySelectorAll('#tab-sent .bb').forEach(b => b.classList.remove('act'));
  btn.classList.add('act');
  rSent(k);
}

let tomC = null;
const TOM = {{DATASET_TOP_OF_MIND}}; // Objeto JS parametrizado

function rTom(k) {
  if (tomC) tomC.destroy();
  const c = document.getElementById('c-tom');
  if (!c) return;
  // Lógica de renderizado según cruce (general, género, edad, partido)
}

function updTom(btn, k) {
  document.querySelectorAll('#tab-tom .bb').forEach(b => b.classList.remove('act'));
  btn.classList.add('act');
  rTom(k);
}

function rPlat() {
  // Configuración de gráficos de la pestaña Plataformas
}

function rTer() {
  // Configuración de gráficos de la pestaña Territorial
}

function rCharts(t) {
  if (t === 'kpis') rKpis();
  if (t === 'sent') rSent('general');
  if (t === 'tom') rTom('general');
  if (t === 'plat') rPlat();
  if (t === 'ter') rTer();
}

window.addEventListener('load', () => setTimeout(() => rCharts('kpis'), 100));
</script>
</body>
</html>
