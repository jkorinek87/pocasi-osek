/* Hodinový graf (SVG, bez knihoven): teplota, pocitová teplota, srážky, pravděpodobnost srážek. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  var COL_W = 32;
  var PAD_L = 36;
  var PAD_R = 36;
  var TOP_DAY = 14;    // řádek s názvy dnů
  var TOP_ICON = 36;   // řádek s ikonami
  var T_TOP = 62;      // horní okraj teplotní části
  var T_H = 140;       // výška teplotní části
  var P_GAP = 22;
  var P_H = 60;        // výška srážkové části
  var BOTTOM = 26;

  function el(name, attrs, text) {
    var n = document.createElementNS(NS, name);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function niceStep(range) {
    var steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) if (range / steps[i] <= 6) return steps[i];
    return 10;
  }

  function fmt(v, d) {
    return v == null ? '–' : v.toLocaleString('cs-CZ', { maximumFractionDigits: d || 0, minimumFractionDigits: 0 });
  }

  /**
   * @param {HTMLElement} host
   * @param {Array} pts  sloučené hodiny (time, temperature_2m, …, model)
   * @param {Object} opt  { icon(code,isDay), dayLabel(dateStr), onSelect(index) }
   */
  function render(host, pts, opt) {
    host.innerHTML = '';
    if (!pts.length) { host.textContent = 'Hodinová data nejsou k dispozici.'; return; }

    var n = pts.length;
    var W = PAD_L + n * COL_W + PAD_R;
    var P_TOP = T_TOP + T_H + P_GAP;
    var H = P_TOP + P_H + BOTTOM;

    function x(i) { return PAD_L + i * COL_W + COL_W / 2; }

    // Rozsah teplot
    var vals = [];
    pts.forEach(function (p) {
      if (p.temperature_2m != null) vals.push(p.temperature_2m);
      if (p.apparent_temperature != null) vals.push(p.apparent_temperature);
    });
    var tMin = Math.min.apply(null, vals), tMax = Math.max.apply(null, vals);
    if (tMax - tMin < 4) { var mid = (tMax + tMin) / 2; tMin = mid - 2; tMax = mid + 2; }
    var step = niceStep(tMax - tMin);
    tMin = Math.floor((tMin - 0.5) / step) * step;
    tMax = Math.ceil((tMax + 0.5) / step) * step;
    function yT(v) { return T_TOP + (tMax - v) / (tMax - tMin) * T_H; }

    var pMax = 2;
    pts.forEach(function (p) { if (p.precipitation != null && p.precipitation > pMax) pMax = p.precipitation; });
    pMax = Math.ceil(pMax);
    function yP(mm) { return P_TOP + P_H - Math.min(mm, pMax) / pMax * P_H; }
    function yPP(pct) { return P_TOP + P_H - pct / 100 * P_H; }

    var svg = el('svg', {
      width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Graf teploty a srážek na ' + n + ' hodin'
    });

    // Noc
    pts.forEach(function (p, i) {
      if (p.is_day === 0) svg.appendChild(el('rect', { class: 'night', x: PAD_L + i * COL_W, y: T_TOP - 8, width: COL_W + 0.5, height: P_TOP + P_H - T_TOP + 8 }));
    });

    // Mřížka teplot + popisky os
    for (var t = tMin; t <= tMax + 1e-9; t += step) {
      var gy = yT(t);
      svg.appendChild(el('line', { class: 'grid', x1: PAD_L, x2: W - PAD_R, y1: gy, y2: gy }));
      svg.appendChild(el('text', { x: PAD_L - 6, y: gy + 4, 'text-anchor': 'end' }, fmt(t) + '°'));
    }
    svg.appendChild(el('line', { class: 'grid', x1: PAD_L, x2: W - PAD_R, y1: P_TOP + P_H, y2: P_TOP + P_H }));
    svg.appendChild(el('line', { class: 'grid', x1: PAD_L, x2: W - PAD_R, y1: P_TOP, y2: P_TOP }));
    svg.appendChild(el('text', { x: PAD_L - 6, y: P_TOP + 4, 'text-anchor': 'end' }, pMax + ' mm'));
    svg.appendChild(el('text', { x: W - PAD_R + 6, y: P_TOP + 4 }, '100 %'));
    svg.appendChild(el('text', { x: W - PAD_R + 6, y: P_TOP + P_H + 4 }, '0 %'));

    // Půlnoci a názvy dnů
    pts.forEach(function (p, i) {
      var hour = +p.time.slice(11, 13);
      if (hour === 0 && i > 0) {
        var lx = PAD_L + i * COL_W;
        svg.appendChild(el('line', { class: 'midnight', x1: lx, x2: lx, y1: 4, y2: P_TOP + P_H }));
        svg.appendChild(el('text', { class: 'day-lbl', x: lx + 5, y: TOP_DAY }, opt.dayLabel(p.time.slice(0, 10))));
      }
    });
    svg.appendChild(el('text', { class: 'day-lbl now-lbl', x: PAD_L + 2, y: TOP_DAY }, 'Teď'));

    // Srážky – sloupce
    pts.forEach(function (p, i) {
      if (p.precipitation != null && p.precipitation > 0) {
        var by = yP(p.precipitation);
        svg.appendChild(el('rect', { class: 'bar', x: PAD_L + i * COL_W + 5, y: by, width: COL_W - 10, height: Math.max(1.5, P_TOP + P_H - by), rx: 2 }));
      }
    });

    // Čáry
    function path(key, yFn) {
      var d = '', pen = false;
      pts.forEach(function (p, i) {
        var v = p[key];
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + yFn(v).toFixed(1);
        pen = true;
      });
      return d;
    }
    var ppPath = path('precipitation_probability', yPP);
    if (ppPath) svg.appendChild(el('path', { class: 'l-pp', d: ppPath }));
    svg.appendChild(el('path', { class: 'l-feels', d: path('apparent_temperature', yT) }));
    svg.appendChild(el('path', { class: 'l-temp', d: path('temperature_2m', yT) }));

    // Popisky co 3 hodiny: ikona, hodnota, čas
    pts.forEach(function (p, i) {
      var hour = +p.time.slice(11, 13);
      if (i % 3 !== 0) return;
      svg.appendChild(el('text', { class: 'icon', x: x(i), y: TOP_ICON + 6, 'text-anchor': 'middle' }, opt.icon(p.weather_code, p.is_day)));
      if (p.temperature_2m != null) {
        var ty = yT(p.temperature_2m);
        svg.appendChild(el('circle', { cx: x(i), cy: ty, r: 2.5, fill: 'var(--temp)' }));
        svg.appendChild(el('text', { class: 't-val', x: x(i), y: ty - 8, 'text-anchor': 'middle' }, fmt(p.temperature_2m) + '°'));
      }
      svg.appendChild(el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, String(hour).padStart(2, '0') + ':00'));
    });

    // Značka „teď“
    svg.appendChild(el('line', { class: 'now-line', x1: PAD_L, x2: PAD_L, y1: 4, y2: P_TOP + P_H }));

    // Klikací sloupce (tooltip + detail na mobilu)
    var hits = [];
    pts.forEach(function (p, i) {
      var r = el('rect', { class: 'hit', x: PAD_L + i * COL_W, y: T_TOP - 8, width: COL_W, height: P_TOP + P_H - T_TOP + 8, 'data-i': i });
      r.appendChild(el('title', {}, p.time.slice(11, 16) + ' · ' + fmt(p.temperature_2m, 1) + ' °C'));
      hits.push(r);
      svg.appendChild(r);
    });
    svg.addEventListener('click', function (e) {
      var i = e.target && e.target.getAttribute && e.target.getAttribute('data-i');
      if (i == null) return;
      hits.forEach(function (h) { h.classList.remove('sel'); });
      hits[+i].classList.add('sel');
      if (opt.onSelect) opt.onSelect(+i);
    });

    host.appendChild(svg);
  }

  window.WeatherChart = { render: render };
})();
