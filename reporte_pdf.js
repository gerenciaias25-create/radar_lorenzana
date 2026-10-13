/* =========================================================
   SIE · RADAR — PDF en FORMATO REPORTE (motor compartido)
   ---------------------------------------------------------
   Convierte el dashboard que está en pantalla en un reporte A4 vertical:
     · portada con el encabezado del dashboard,
     · cada pestaña como un capítulo con su título,
     · las subpestañas (cruces, filtros, detalles) una tras otra con su etiqueta,
     · acordeones y cajas con scroll desplegados,
     · cortes de página solo entre bloques (nunca a la mitad de una tarjeta),
     · alta resolución (gráficas re-dibujadas a ~300 dpi).
   Lo usan:
     · index.html de RADAR (botón "Descargar PDF"): SIEReporte.generar({...})
     · el panel de clientes de SIE (js/sie_pdf.js es este mismo archivo):
       escucha {type:'SIE_PDF'} del panel y responde {type:'SIE_PDF_ESTADO'}.
   ========================================================= */
(function () {
  if (window.SIEReporte) return;

  var ANCHO = 940;       // ancho de maquetación del reporte (px CSS)
  var ESCALA = 2.5;      // densidad de captura (≈320 dpi en A4)
  var MARGEN = 12;       // mm
  var CABEZA = 8;        // mm reservados arriba (encabezado de página)
  var PIE = 8;           // mm reservados abajo (pie de página)
  var CALIDAD = 0.9;     // JPEG

  // Estructura conocida de los dashboards de RADAR INTELLIGENCE.
  // tabs: botones de pestaña · seccion: panel visible · ignorar: controles que no son subpestañas
  // variantes: subpestañas cuya zona a repetir se conoce (si no, se detecta sola)
  var RECETAS = [
    { id: 'radar', raiz: '#radar-root', tabs: '#radar-root .tabs .tb', seccion: '#radar-root .tsec.show' },
    { id: 'emociones', raiz: '#emo-root', tabs: '#emo-root .tab[onclick*="emST"]', seccion: '#emo-root .pnl.on',
      ignorar: '[onclick*="emToggleEm"]',
      expandir: function (raiz) { return abrirClase(raiz.querySelectorAll('#emo-root .emd-box'), 'open'); } },
    { id: 'opositor', raiz: '#op-nav', tabs: '#op-nav button', seccion: 'section.tab.on', ignorar: '#op-filt button, #op-filt *' },
    { id: 'tensiones', raiz: '.nb[onclick*="tensTab"]', tabs: '.nb[onclick*="tensTab"]', seccion: '.view.on',
      variantes: [{ grupo: '.trow', zona: '#t-tens-detail' }] }
  ];

  /* ---------------- utilidades ---------------- */
  function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function cargar(src) {
    return new Promise(function (ok, mal) {
      if (document.querySelector('script[src="' + src + '"]')) return ok();
      var s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = function () { mal(new Error('No se pudo cargar ' + src)); };
      document.head.appendChild(s);
    });
  }
  function arr(x) { return Array.prototype.slice.call(x || []); }
  function visible(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
  function texto(el) { return ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim(); }
  function esActivo(el) { return /\b(on|act|active|activo|sel|selected|show|current)\b/.test(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '') || el.getAttribute('aria-selected') === 'true'; }
  function graficas() { return (window.Chart && Chart.instances) ? Object.values(Chart.instances) : []; }
  function redibujar(dpr) {
    if (typeof cambio === 'function') cambio();
    graficas().forEach(function (ch) {
      try { if (ch.options) ch.options.devicePixelRatio = dpr; ch.resize(); ch.update('none'); } catch (e) {}
    });
  }
  function abrirClase(lista, clase) {
    var hechos = [];
    arr(lista).forEach(function (el) { if (!el.classList.contains(clase)) { el.classList.add(clase); hechos.push(el); } });
    return function () { hechos.forEach(function (el) { el.classList.remove(clase); }); };
  }
  function enLista(el, sel) { try { return !!(sel && el.matches(sel)); } catch (e) { return false; } }

  /* ---------------- preparar / restaurar la página ---------------- */
  function preparar(cont) {
    var html = document.documentElement;
    var prev = { cont: cont.style.cssText, html: html.style.minWidth };
    var st = document.createElement('style');
    st.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.head.appendChild(st);
    cont.style.width = ANCHO + 'px'; cont.style.maxWidth = 'none'; cont.style.minWidth = ANCHO + 'px';
    if (html.clientWidth < ANCHO + 40) html.style.minWidth = (ANCHO + 40) + 'px';
    var prevAnim, prevDpr;
    if (window.Chart) { prevAnim = Chart.defaults.animation; prevDpr = Chart.defaults.devicePixelRatio; Chart.defaults.animation = false; Chart.defaults.devicePixelRatio = ESCALA; }
    return function () {
      cont.style.cssText = prev.cont; html.style.minWidth = prev.html; st.remove();
      if (window.Chart) { Chart.defaults.animation = prevAnim; Chart.defaults.devicePixelRatio = prevDpr; }
      redibujar(undefined);
    };
  }

  // Acordeones (<details>, encabezados que abren al hermano siguiente) y cajas con scroll.
  function expandir(raiz, receta) {
    var deshacer = [];
    arr(raiz.querySelectorAll('details:not([open])')).forEach(function (d) { d.open = true; deshacer.push(function () { d.open = false; }); });
    arr(raiz.querySelectorAll('[onclick*="nextElementSibling.classList.toggle"]')).forEach(function (h) {
      var m = /toggle\(\s*['"]([\w-]+)['"]/.exec(h.getAttribute('onclick')); var sib = h.nextElementSibling;
      if (m && sib && !sib.classList.contains(m[1])) { sib.classList.add(m[1]); deshacer.push(function () { sib.classList.remove(m[1]); }); }
    });
    if (receta && receta.expandir) deshacer.push(receta.expandir(raiz));
    return function () { deshacer.forEach(function (f) { try { f(); } catch (e) {} }); };
  }
  function desplegar(raiz) {
    var cambios = [];
    arr(raiz.querySelectorAll('*')).forEach(function (el) {
      if (el.tagName === 'CANVAS' || el.ownerSVGElement) return;
      var cs = getComputedStyle(el);
      var altoOculto = el.scrollHeight > el.clientHeight + 2 && /(auto|scroll)/.test(cs.overflowY);
      var anchoOculto = el.scrollWidth > el.clientWidth + 2 && /(auto|scroll)/.test(cs.overflowX);
      var maxH = cs.maxHeight !== 'none' && el.scrollHeight > el.clientHeight + 2 && cs.overflowY === 'hidden';
      if (!altoOculto && !anchoOculto && !maxH) return;
      cambios.push([el, el.style.cssText]);
      if (altoOculto || maxH) { el.style.maxHeight = 'none'; el.style.height = 'auto'; el.style.overflowY = 'visible'; }
      if (anchoOculto) { el.style.overflowX = 'visible'; }
    });
    return function () { cambios.forEach(function (c) { c[0].style.cssText = c[1]; }); };
  }

  /* ---------------- bloques y cortes ---------------- */
  function atomico(el, cs) {
    if (/^(CANVAS|IMG|TR|P|LI|H[1-6]|BUTTON|INPUT|TEXTAREA|SELECT|VIDEO|FIGURE|svg|SVG|TABLE|THEAD)$/.test(el.tagName)) return true;
    if (cs.backgroundColor && cs.backgroundColor !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(cs.backgroundColor)) return true;
    if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 || (cs.boxShadow && cs.boxShadow !== 'none')) return true;
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  }
  // Intervalos [arriba, abajo] (px relativos a top0) que no deben partirse.
  function intervalos(raiz, top0, maxH) {
    var out = [], tit = [];
    arr(raiz.querySelectorAll('*')).forEach(function (el) {
      if (el.ownerSVGElement) return;
      var r = el.getBoundingClientRect();
      if (r.height < 1 || r.width < 1) return;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return;
      if (r.height <= maxH && atomico(el, cs)) out.push([r.top - top0, r.bottom - top0]);
      if (/^H[1-4]$/.test(el.tagName) || /(^|\s)(stit\w*|sec-?tit\w*|section-title|titulo\w*|stl|sh)(\s|$)/.test(typeof el.className === 'string' ? el.className : '')) tit.push([r.top - top0, r.bottom - top0]);
    });
    return { iv: out, tit: tit };
  }
  function seguro(c, iv) { for (var j = 0; j < iv.length; j++) if (iv[j][0] < c - 0.5 && iv[j][1] > c + 0.5) return false; return true; }
  // Mayor corte seguro en (y, lim]; evita dejar un título huérfano al pie de la página.
  function mejorCorte(y, lim, B) {
    var c = [lim];
    B.iv.forEach(function (a) { if (a[0] > y && a[0] <= lim) c.push(a[0]); if (a[1] > y && a[1] <= lim) c.push(a[1]); });
    c.sort(function (a, b) { return b - a; });
    for (var i = 0; i < c.length; i++) {
      if (!seguro(c[i], B.iv)) continue;
      for (var t = 0; t < B.tit.length; t++) {
        var T = B.tit[t];
        if (T[1] <= c[i] + 0.5 && c[i] - T[1] < 26 && T[0] > y + 10 && seguro(T[0] - 1, B.iv)) return T[0] - 1;
      }
      return c[i];
    }
    return -1;
  }
  // Amplía [vt, vb] para no partir ningún bloque.
  function ajustar(vt, vb, iv) {
    var cambio = true;
    while (cambio) {
      cambio = false;
      iv.forEach(function (a) {
        if (a[0] < vt - 0.5 && a[1] > vt + 0.5) { vt = a[0]; cambio = true; }
        if (a[0] < vb - 0.5 && a[1] > vb + 0.5) { vb = a[1]; cambio = true; }
      });
    }
    return [vt, vb];
  }

  /* ---------------- captura ---------------- */
  // Se fotografía el elemento completo una sola vez por estado y luego se recortan los tramos.
  var version = 0, cache = { el: null, ver: -1, cv: null };
  function cambio() { version++; }
  async function fotoCompleta(motor, el) {
    if (cache.el === el && cache.ver === version && cache.cv) return cache.cv;
    if (cache.cv) { cache.cv.width = cache.cv.height = 0; }
    var r = el.getBoundingClientRect();
    var h = Math.max(r.height, el.scrollHeight), w = Math.max(r.width, el.scrollWidth);
    var esc = Math.min(ESCALA, 30000 / Math.max(h, 1), 14000 / Math.max(w, 1)); // límites de tamaño de canvas
    var cv;
    if (motor === 'hti') {
      cv = await window.htmlToImage.toCanvas(el, {
        pixelRatio: esc, backgroundColor: '#ffffff', width: Math.ceil(w), height: Math.ceil(h), cacheBust: false,
        imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', style: { margin: '0' }
      });
    } else {
      cv = await html2canvas(el, {
        scale: esc, backgroundColor: '#ffffff', useCORS: true, logging: false, width: Math.ceil(w), height: Math.ceil(h),
        onclone: function (doc) { var s = doc.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}'; doc.head.appendChild(s); }
      });
    }
    cache = { el: el, ver: version, cv: cv };
    return cv;
  }
  async function foto(motor, el, y0, h, W) {
    var cv = await fotoCompleta(motor, el);
    var s = cv.width / W;
    var t = document.createElement('canvas');
    t.width = Math.round(W * s); t.height = Math.max(1, Math.round(h * s));
    var c = t.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, t.width, t.height);
    c.drawImage(cv, 0, Math.round(y0 * s), t.width, t.height, 0, 0, t.width, t.height);
    return t;
  }

  /* ---------------- documento PDF ---------------- */
  function Documento(o) {
    var pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    var pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    var d = {
      pdf: pdf, ancho: pw - MARGEN * 2, top: MARGEN + CABEZA, fondo: ph - MARGEN - PIE + 4, y: MARGEN + CABEZA, vacia: true,
      k: (pw - MARGEN * 2) / ANCHO, contLeft: 0, motor: o.motor, avisar: o.avisar || function () {},
      alto: function () { return d.fondo - d.top; },
      restante: function () { return d.fondo - d.y; },
      enTope: function () { return d.y <= d.top + 0.5; },
      nueva: function () { if (!d.vacia) pdf.addPage(); d.y = d.top; d.vacia = true; }
    };
    return d;
  }
  function tituloCapitulo(d, n, txt) {
    if (!d.enTope() && d.restante() < d.alto() * 0.55) d.nueva();
    else if (!d.enTope()) d.y += 4;
    var p = d.pdf;
    p.setFillColor(0, 151, 167); p.rect(MARGEN, d.y, 1.8, 7.5, 'F');
    p.setFont('helvetica', 'bold'); p.setFontSize(12.5); p.setTextColor(28, 39, 56);
    p.text((n < 10 ? '0' + n : String(n)) + '   ' + txt.toUpperCase(), MARGEN + 5, d.y + 5.6, { charSpace: 0.5 });
    p.setDrawColor(28, 39, 56); p.setLineWidth(0.4); p.line(MARGEN, d.y + 10, MARGEN + d.ancho, d.y + 10);
    d.y += 14; d.vacia = false;
  }
  function etiqueta(d, txt, altoMm) {
    var necesita = 8 + Math.min(altoMm || 22, d.alto() - 8);
    if (d.restante() < necesita) d.nueva();
    var p = d.pdf;
    d.y += 3;
    p.setFont('helvetica', 'bold'); p.setFontSize(7.5); p.setTextColor(0, 120, 135);
    p.text(('VISTA · ' + txt).toUpperCase().slice(0, 120), MARGEN, d.y + 3, { charSpace: 0.4 });
    d.y += 5; d.vacia = false;
  }

  // Coloca [desde, hasta] de un elemento, fluyendo por páginas sin partir bloques.
  async function fluir(d, el, desde, hasta, junto, izquierda) {
    var r = el.getBoundingClientRect();
    var W = Math.ceil(Math.max(r.width, el.scrollWidth));
    var k = Math.min(d.k, d.ancho / W);
    var x = izquierda ? MARGEN : MARGEN + Math.max(0, (r.left - d.contLeft) * k);
    if (x + W * k > MARGEN + d.ancho + 0.1) x = MARGEN;
    var paginaPx = d.alto() / k;
    if (hasta - desde < 3) return;
    if (junto && (hasta - desde) <= paginaPx && (hasta - desde) * k > d.restante() && !d.enTope()) d.nueva();
    var B = intervalos(el, r.top, paginaPx * 0.98);
    var y = desde;
    while (hasta - y > 2) {
      var rem = d.restante() / k, lim = Math.min(hasta, y + rem), c;
      if (lim >= hasta - 0.5) c = hasta;
      else { c = mejorCorte(y, lim, B); if (c > 0 && (c - y) * k < 6 && !d.enTope()) c = -1; }
      if (c < 0 || c <= y + 0.5) {
        if (!d.enTope()) { d.nueva(); continue; }
        c = lim; // bloque más alto que una página completa: se parte
      }
      var cv = await foto(d.motor, el, y, c - y, W);
      d.pdf.addImage(cv.toDataURL('image/jpeg', CALIDAD), 'JPEG', x, d.y, W * k, (c - y) * k, undefined, 'FAST');
      cv.width = cv.height = 0;
      d.y += (c - y) * k; d.vacia = false;
      y = c;
    }
  }

  /* ---------------- subpestañas ---------------- */
  function gruposSubpestanas(sec, receta, tabs) {
    var sel = 'button, [role="tab"], [onclick], .bb, .chip, .pill, .seg-btn';
    var porPadre = new Map();
    arr(sec.querySelectorAll(sel)).forEach(function (el) {
      if (!visible(el) || tabs.indexOf(el) >= 0) return;
      if (receta && enLista(el, receta.ignorar)) return;
      var oc = el.getAttribute('onclick') || '';
      if (/toggle|nextElementSibling|print|download|descarg|window\.open|location/i.test(oc)) return;
      if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href') !== '#') return;
      if (texto(el).length > 60 || el.closest('svg')) return;
      var p = el.parentElement; if (!porPadre.has(p)) porPadre.set(p, []); porPadre.get(p).push(el);
    });
    var grupos = [];
    porPadre.forEach(function (lista) { if (lista.length >= 2 && lista.length <= 15) grupos.push({ botones: lista }); });
    if (receta && receta.variantes) {
      receta.variantes.forEach(function (v) {
        var b = arr(sec.querySelectorAll(v.grupo)).filter(visible), z = sec.querySelector(v.zona);
        if (b.length >= 2 && z) {
          grupos = grupos.filter(function (g) { return g.botones.indexOf(b[0]) < 0; });
          grupos.push({ botones: b, zona: z });
        }
      });
    }
    return grupos;
  }
  // Zona que cambia al usar la subpestaña (se mide con un MutationObserver).
  // Se guarda como lista de elementos para volver a medirla en cada estado.
  async function zonaDe(sec, g) {
    if (g.zona) return [g.zona];
    var padre = g.botones[0].parentElement, els = [padre];
    var recs = [];
    var obs = new MutationObserver(function (l) { recs = recs.concat(l); });
    obs.observe(sec, { subtree: true, childList: true, attributes: true, characterData: true });
    var activo = g.botones.filter(esActivo)[0] || g.botones[0];
    var otro = g.botones.filter(function (b) { return b !== activo; })[0];
    otro.click(); await esperar(450);
    recs = recs.concat(obs.takeRecords()); obs.disconnect();
    recs.forEach(function (m) {
      var n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      if (!n || padre.contains(n) || els.indexOf(n) >= 0 || !sec.contains(n)) return;
      els.push(n);
    });
    if (els.length === 1) {
      // Solo cambió una gráfica (canvas): se toma el bloque que sigue a los botones.
      var sig = padre.nextElementSibling; if (sig) els.push(sig);
    }
    activo.click(); await esperar(450);
    return els;
  }
  function medirZona(sec, els) {
    var t0 = sec.getBoundingClientRect().top, vt = Infinity, vb = -Infinity;
    els.forEach(function (e) {
      if (!e.isConnected) return;
      var r = e.getBoundingClientRect(); if (!r.height && !r.width) return;
      vt = Math.min(vt, r.top - t0); vb = Math.max(vb, r.bottom - t0);
    });
    if (vt === Infinity) return null;
    return ajustar(vt, vb, intervalos(sec, t0, 1e9).iv);
  }

  /* ---------------- pestañas genéricas (dashboards hechos a mano) ---------------- */
  function tabsGenericas(cont) {
    var sel = '[role="tab"], .tab, .tb, .tab-btn, .tab-button, .nb, .nav-tab, .nav-link, [data-tab], [data-target], [onclick*="Tab("], [onclick*="tab("], [onclick*="showTab"], [onclick*="switchTab"]';
    var grupos = new Map();
    arr(cont.querySelectorAll(sel)).forEach(function (el) {
      if (!visible(el) || el.closest('table')) return;
      var p = el.parentElement; if (!grupos.has(p)) grupos.set(p, []); grupos.get(p).push(el);
    });
    var mejor = [];
    grupos.forEach(function (l) { if (l.length > mejor.length) mejor = l; });
    return mejor.length >= 2 ? mejor : [];
  }
  function ocultos(cont) { var s = new Set(); arr(cont.querySelectorAll('*')).forEach(function (el) { if (!el.getClientRects().length) s.add(el); }); return s; }
  function panelNuevo(cont, antes) {
    var mejor = null, area = 0;
    antes.forEach(function (el) {
      if (!el.isConnected || !el.getClientRects().length) return;
      if (el.parentElement && antes.has(el.parentElement)) return;
      var r = el.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; mejor = el; }
    });
    return mejor;
  }

  /* ---------------- generar ---------------- */
  // o = { contenedor, motor ('h2c'|'hti'|auto), titulo, pie, avisar(txt) }
  async function generar(o) {
    var cont = o.contenedor || document.body;
    var aislado = (window.origin === 'null' || location.origin === 'null');
    var motor = o.motor || (aislado ? 'hti' : 'h2c');
    var avisar = o.avisar || function () {};
    avisar('Preparando reporte…');
    if (motor === 'hti') await cargar('https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js');
    else await cargar('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    await cargar('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');

    var receta = null;
    for (var i = 0; i < RECETAS.length; i++) if (cont.querySelector(RECETAS[i].raiz)) { receta = RECETAS[i]; break; }
    var tabs = receta ? arr(cont.querySelectorAll(receta.tabs)) : tabsGenericas(cont);
    var tabInicial = tabs.filter(esActivo)[0] || tabs[0];

    var d = Documento({ motor: motor, avisar: avisar });
    var restaurar = preparar(cont);
    var cerrar = expandir(cont, receta);
    try {
      await esperar(350); redibujar(ESCALA); await esperar(150);
      d.contLeft = cont.getBoundingClientRect().left;

      if (!tabs.length) {
        var plegar = desplegar(cont);
        try {
          avisar('Generando reporte…');
          var rc = cont.getBoundingClientRect();
          await fluir(d, cont, 0, Math.ceil(Math.max(rc.height, cont.scrollHeight)), false);
        } finally { plegar(); }
      } else {
        // Portada: todo lo que está arriba de la barra de pestañas.
        var top0 = cont.getBoundingClientRect().top;
        var barra = tabs[0].parentElement.getBoundingClientRect().top - top0;
        if (barra > 20) { avisar('Generando reporte… portada'); await fluir(d, cont, 0, barra, false); d.y += 2; }

        for (var t = 0; t < tabs.length; t++) {
          var nombreTab = texto(tabs[t]) || ('Sección ' + (t + 1));
          avisar('Generando reporte… ' + (t + 1) + ' de ' + tabs.length + ' · ' + nombreTab);
          var antes = receta ? null : ocultos(cont);
          if (!receta && t === 0 && tabs[1]) { tabs[1].click(); await esperar(300); antes = ocultos(cont); }
          tabs[t].click(); cambio();
          await esperar(900);
          var sec = receta ? cont.querySelector(receta.seccion) : panelNuevo(cont, antes);
          if (!sec && !receta) {
            // No se identificó el panel: se toma lo que hay debajo de la barra de pestañas.
            sec = cont;
          }
          if (!sec) continue;
          var plegarSec = desplegar(sec);
          var cerrarSec = expandir(sec, receta);
          try {
            await esperar(150); redibujar(ESCALA); await esperar(200);
            tituloCapitulo(d, t + 1, nombreTab);
            var rs = sec.getBoundingClientRect();
            var desde = sec === cont ? (tabs[0].parentElement.getBoundingClientRect().bottom - rs.top) : 0;
            var grupos = gruposSubpestanas(sec, receta, tabs);
            var zonas = [];
            for (var g = 0; g < grupos.length; g++) {
              try { zonas.push({ g: grupos[g], els: await zonaDe(sec, grupos[g]) }); } catch (e) {}
            }
            redibujar(ESCALA); await esperar(120);
            zonas = zonas.filter(function (z) { var m = medirZona(sec, z.els); if (!m) return false; z.vt = m[0]; z.vb = m[1]; return true; });
            zonas.sort(function (a, b) { return a.vt - b.vt; });
            var y = desde, ultimo = -1;
            for (var zi = 0; zi < zonas.length; zi++) {
              var Z = zonas[zi];
              if (Z.vt < ultimo || Z.vb <= y) continue;
              await fluir(d, sec, y, Z.vb, false);
              y = Z.vb; ultimo = Z.vb;
              var bots = Z.g.botones, act = bots.filter(esActivo)[0] || bots[0];
              for (var bi = 0; bi < bots.length; bi++) {
                if (bots[bi] === act) continue;
                avisar('Generando reporte… ' + (t + 1) + ' de ' + tabs.length + ' · ' + nombreTab + ' · ' + texto(bots[bi]));
                bots[bi].click(); await esperar(500); redibujar(ESCALA); await esperar(200);
                if (Z.g.zona) {
                  // Zona conocida (p. ej. el detalle de cada tensión): se coloca sola, completa.
                  var rzn = Z.g.zona.getBoundingClientRect();
                  etiqueta(d, texto(bots[bi]), rzn.height * d.k);
                  await fluir(d, Z.g.zona, 0, Math.ceil(Math.max(rzn.height, Z.g.zona.scrollHeight)), true, true);
                  continue;
                }
                var zz = medirZona(sec, Z.els); if (!zz) continue;
                etiqueta(d, texto(bots[bi]), (zz[1] - zz[0]) * d.k);
                await fluir(d, sec, zz[0], zz[1], true);
              }
              act.click(); await esperar(450); redibujar(ESCALA); await esperar(150);
            }
            var fin = sec.getBoundingClientRect();
            await fluir(d, sec, y, Math.ceil(Math.max(fin.height, sec.scrollHeight)), false);
          } finally { cerrarSec(); plegarSec(); }
        }
      }
    } finally {
      if (cache.cv) { cache.cv.width = cache.cv.height = 0; } cache = { el: null, ver: -1, cv: null };
      cerrar();
      if (tabInicial) { try { tabInicial.click(); } catch (e) {} }
      restaurar();
    }

    // Encabezado y pie de cada página
    var p = d.pdf, total = p.getNumberOfPages(), pw = p.internal.pageSize.getWidth(), ph = p.internal.pageSize.getHeight();
    var fecha = new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
    for (var n = 1; n <= total; n++) {
      p.setPage(n);
      p.setFont('helvetica', 'bold'); p.setFontSize(7); p.setTextColor(110, 120, 135);
      p.text(String(o.titulo || 'RADAR · Reporte').toUpperCase().slice(0, 110), MARGEN, MARGEN + 2, { charSpace: 0.3 });
      p.setFont('helvetica', 'normal');
      p.text(fecha, pw - MARGEN, MARGEN + 2, { align: 'right' });
      p.setDrawColor(210, 214, 220); p.setLineWidth(0.25); p.line(MARGEN, MARGEN + 4, pw - MARGEN, MARGEN + 4);
      p.line(MARGEN, ph - MARGEN + 1, pw - MARGEN, ph - MARGEN + 1);
      p.text((o.pie || (receta ? 'RADAR Estudio confidencial' : 'Estudio confidencial')) + '  ·  ' + n + ' / ' + total, pw / 2, ph - MARGEN + 5, { align: 'center' });
    }
    return p;
  }

  window.SIEReporte = { generar: generar };

  /* ---------------- modo panel de clientes (SIE) ---------------- */
  if (window.parent !== window && !window.SIE_REPORTE_SIN_ESCUCHA) {
    var avisarPadre = function (msg) { try { parent.postMessage(Object.assign({ type: 'SIE_PDF_ESTADO' }, msg), '*'); } catch (e) {} };
    var ocupado = false;
    window.addEventListener('message', function (ev) {
      if (ev.source !== parent || !ev.data || ev.data.type !== 'SIE_PDF' || ocupado) return;
      ocupado = true;
      var nombre = ev.data.nombre || 'reporte';
      generar({ contenedor: document.body, titulo: ev.data.titulo || nombre.replace(/_/g, ' '), avisar: function (t) { avisarPadre({ txt: t }); } })
        .then(function (pdf) { pdf.save(nombre + '.pdf'); avisarPadre({ fin: true }); })
        .catch(function (e) { avisarPadre({ fin: true, error: (e && e.message) || 'No se pudo generar el PDF' }); })
        .then(function () { ocupado = false; });
    });
    avisarPadre({ listo: true });
  }
})();
