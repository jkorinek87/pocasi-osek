/* Hlavní logika: načtení dat, vykreslení aktuálního stavu, grafu a 7 dní. */
(function () {
  'use strict';

  var API = window.WeatherAPI;
  var TZ = API.TZ;
  var REFRESH_MS = 15 * 60 * 1000;
  var HOURS = 48;

  var $ = function (id) { return document.getElementById(id); };
  var lastLoad = 0;
  var loading = false;

  /* ---------- Uložené volby (localStorage jen jako pohodlí, stránka funguje i bez něj) ---------- */
  function readPref(key, allowed, fallback) {
    try {
      var v = localStorage.getItem(key);
      return allowed.indexOf(v) >= 0 ? v : fallback;
    } catch (e) { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  var MODES = ['auto', 'icon_d2', 'icon_eu', 'ecmwf_ifs'];
  var mode = readPref('pocasi-model', MODES, 'auto');
  // Výchozí téma podle systému, po přepnutí se pamatuje volba uživatele.
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = readPref('pocasi-theme', ['light', 'dark'], systemDark ? 'dark' : 'light');
  var rawForecast = null;  // poslední surová data předpovědi (pro přepnutí modelu bez dotazu)
  var currentReq = 0;      // pořadí dotazů na aktuální stav, aby starší odpověď nepřepsala novější

  /* ---------- WMO kódy počasí ---------- */
  var WMO = {
    0: ['Jasno', '☀️', '🌙'],
    1: ['Skoro jasno', '🌤️', '🌙'],
    2: ['Polojasno', '⛅', '☁️'],
    3: ['Zataženo', '☁️', '☁️'],
    45: ['Mlha', '🌫️'],
    48: ['Mlha s námrazou', '🌫️'],
    51: ['Slabé mrholení', '🌦️', '🌧️'],
    53: ['Mrholení', '🌦️', '🌧️'],
    55: ['Silné mrholení', '🌧️'],
    56: ['Mrznoucí mrholení', '🌧️'],
    57: ['Silné mrznoucí mrholení', '🌧️'],
    61: ['Slabý déšť', '🌦️', '🌧️'],
    63: ['Déšť', '🌧️'],
    65: ['Silný déšť', '🌧️'],
    66: ['Mrznoucí déšť', '🌧️'],
    67: ['Silný mrznoucí déšť', '🌧️'],
    71: ['Slabé sněžení', '🌨️'],
    73: ['Sněžení', '🌨️'],
    75: ['Silné sněžení', '❄️'],
    77: ['Sněhová zrna', '🌨️'],
    80: ['Slabé přeháňky', '🌦️', '🌧️'],
    81: ['Přeháňky', '🌧️'],
    82: ['Silné přeháňky', '🌧️'],
    85: ['Sněhové přeháňky', '🌨️'],
    86: ['Silné sněhové přeháňky', '❄️'],
    95: ['Bouřka', '⛈️'],
    96: ['Bouřka s kroupami', '⛈️'],
    99: ['Silná bouřka s kroupami', '⛈️']
  };
  function wmoText(code) { return (WMO[code] || ['Neznámý stav'])[0]; }
  function wmoIcon(code, isDay) {
    var w = WMO[code];
    if (!w) return '·';
    return isDay === 0 && w[2] ? w[2] : w[1];
  }

  /* ---------- Formátování (cs-CZ, Europe/Prague) ---------- */
  function num(v, d) {
    if (v == null) return '–';
    return v.toLocaleString('cs-CZ', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
  }
  function temp(v, d) { return v == null ? '–' : num(v, d) + ' °C'; }

  // Aktuální čas v Praze jako "YYYY-MM-DDTHH:MM" (stejný tvar jako časy z API).
  function pragueNow() {
    var parts = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
  }
  function addDays(dateStr, n) {
    var p = dateStr.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.toISOString().slice(0, 10);
  }
  function utcDate(dateStr) {
    var p = dateStr.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
  }
  var fmtWeekShort = new Intl.DateTimeFormat('cs-CZ', { weekday: 'short', timeZone: 'UTC' });
  var fmtWeekLong = new Intl.DateTimeFormat('cs-CZ', { weekday: 'long', timeZone: 'UTC' });
  var fmtDayMonth = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function relDay(dateStr) {
    var today = pragueNow().slice(0, 10);
    if (dateStr === today) return 'Dnes';
    if (dateStr === addDays(today, 1)) return 'Zítra';
    return null;
  }
  function shortDayLabel(dateStr) {
    return relDay(dateStr) || cap(fmtWeekShort.format(utcDate(dateStr))) + ' ' + fmtDayMonth.format(utcDate(dateStr));
  }
  function hhmm(iso) { return iso ? iso.slice(11, 16) : '–'; }

  var COMPASS = ['S', 'SV', 'V', 'JV', 'J', 'JZ', 'Z', 'SZ'];
  function compass(deg) { return deg == null ? '' : COMPASS[Math.round(deg / 45) % 8]; }

  /* ---------- Aktuálně ---------- */
  function renderCurrent(res) {
    var c = res.data;
    var model = API.MODELS[res.model];
    $('now-icon').textContent = wmoIcon(c.weather_code, c.is_day);
    $('now-temp').textContent = temp(c.temperature_2m, 1);
    $('now-desc').textContent = wmoText(c.weather_code) + ' · pocitově ' + temp(c.apparent_temperature, 0);
    $('now-meta').textContent = 'stav k ' + hhmm(c.time) + ' · model ' + model.name;

    var dir = c.wind_direction_10m;
    var arrow = dir == null ? '' :
      ' <span class="arrow" style="transform:rotate(' + Math.round(dir) + 'deg)" aria-hidden="true">↓</span>';
    var minutes = Math.round((res.interval || 900) / 60);

    var tiles = [
      ['Pocitová teplota', temp(c.apparent_temperature, 1)],
      ['Oblačnost', num(c.cloud_cover) + ' %'],
      ['Vítr', num(c.wind_speed_10m) + ' km/h' + arrow + ' <small>' + compass(dir) + '</small>'],
      ['Nárazy větru', num(c.wind_gusts_10m) + ' km/h'],
      ['Srážky <small>(' + minutes + ' min)</small>', num(c.precipitation, 1) + ' mm'],
      ['Vlhkost', num(c.relative_humidity_2m) + ' %'],
      ['Tlak <small>(moře)</small>', num(c.pressure_msl) + ' hPa'],
      ['Den / noc', c.is_day === 0 ? 'Noc' : 'Den']
    ];
    $('now-tiles').innerHTML = tiles.map(function (t) {
      return '<div class="tile"><dt>' + t[0] + '</dt><dd>' + t[1] + '</dd></div>';
    }).join('');
    $('now').classList.remove('is-loading');
  }

  /* ---------- 48 hodin ---------- */
  function renderHours(hourly) {
    var nowHour = pragueNow().slice(0, 13) + ':00';
    var start = 0;
    while (start < hourly.length && hourly[start].time < nowHour) start++;
    var pts = hourly.slice(start, start + HOURS);

    var used = {};
    pts.forEach(function (p) { used[p.model] = (used[p.model] || 0) + 1; });
    $('hours-meta').textContent = Object.keys(used).map(function (m) {
      return API.MODELS[m].name + ' ' + used[m] + ' h';
    }).join(' · ') + (pts.length && pts.length < HOURS ? ' (dál model nesahá)' : '');
    $('chart-detail').textContent = 'Klepněte na hodinu v grafu pro podrobnosti.';

    function showDetail(i) {
      var p = pts[i];
      if (!p) return;
      $('chart-detail').innerHTML =
        '<b>' + shortDayLabel(p.time.slice(0, 10)) + ' ' + hhmm(p.time) + '</b> · ' +
        wmoIcon(p.weather_code, p.is_day) + ' ' + wmoText(p.weather_code) + ' · ' +
        '<b>' + temp(p.temperature_2m, 1) + '</b> (pocitově ' + temp(p.apparent_temperature, 0) + ') · ' +
        'srážky ' + num(p.precipitation, 1) + ' mm' +
        (p.precipitation_probability != null ? ' (' + num(p.precipitation_probability) + ' %)' : '') + ' · ' +
        'oblačnost ' + num(p.cloud_cover) + ' % · vítr ' + num(p.wind_speed_10m) + ' km/h, nárazy ' +
        num(p.wind_gusts_10m) + ' km/h · <span class="muted">' + API.MODELS[p.model].name + '</span>';
    }

    window.WeatherChart.render($('chart'), pts, {
      icon: wmoIcon,
      dayLabel: shortDayLabel,
      onSelect: showDetail
    });
    $('chart').classList.remove('is-loading');
  }

  /* ---------- 7 dní ---------- */
  function renderDays(daily) {
    var gMin = Infinity, gMax = -Infinity;
    daily.forEach(function (d) {
      if (d.temperature_2m_min != null) gMin = Math.min(gMin, d.temperature_2m_min);
      if (d.temperature_2m_max != null) gMax = Math.max(gMax, d.temperature_2m_max);
    });
    var span = Math.max(1, gMax - gMin);

    $('days-meta').textContent = mode === 'auto'
      ? 'dny 1–2 ICON-D2, dny 3–7 ECMWF'
      : 'jen model ' + API.MODELS[mode].name;

    $('days').innerHTML = daily.map(function (d) {
      var dt = utcDate(d.date);
      var rel = relDay(d.date);
      var name = rel || cap(fmtWeekLong.format(dt));
      var model = d.model ? API.MODELS[d.model] : null;

      if (!model) {
        return '<li class="day day-na">' +
          '<div class="day-name">' + name + '<small>' + fmtDayMonth.format(dt) + '</small></div>' +
          '<div class="day-icon" aria-hidden="true">·</div>' +
          '<div class="day-temps muted">Mimo dosah zvoleného modelu</div>' +
          '<span></span>' +
        '</li>';
      }
      var left = d.temperature_2m_min != null ? (d.temperature_2m_min - gMin) / span * 100 : 0;
      var width = d.temperature_2m_max != null && d.temperature_2m_min != null
        ? Math.max(4, (d.temperature_2m_max - d.temperature_2m_min) / span * 100) : 0;
      var pp = d.precipitation_probability_max != null ? ' · ' + num(d.precipitation_probability_max) + ' %' : '';

      return '<li class="day">' +
        '<div class="day-name">' + name + '<small>' + fmtDayMonth.format(dt) + '</small></div>' +
        '<div class="day-icon" title="' + wmoText(d.weather_code) + '">' + wmoIcon(d.weather_code, 1) + '</div>' +
        '<div class="day-temps">' +
          '<span class="tmax">' + num(d.temperature_2m_max) + '°</span>' +
          '<span class="range" aria-hidden="true"><i style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%"></i></span>' +
          '<span class="tmin">' + num(d.temperature_2m_min) + '°</span>' +
        '</div>' +
        (model ? '<span class="badge" title="' + model.name + '">' + model.short + '</span>' : '<span></span>') +
        '<div class="day-extra">' +
          '<span>' + wmoText(d.weather_code) + '</span>' +
          '<span>💧 ' + num(d.precipitation_sum, 1) + ' mm' + pp + '</span>' +
          '<span>💨 ' + num(d.wind_speed_10m_max) + ' / ' + num(d.wind_gusts_10m_max) + ' km/h</span>' +
          '<span>🌅 ' + hhmm(d.sunrise) + ' – ' + hhmm(d.sunset) + '</span>' +
        '</div>' +
      '</li>';
    }).join('');
    $('days').classList.remove('is-loading');
  }

  /* ---------- Načtení ---------- */
  function showError(msg) {
    $('error-text').textContent = msg;
    $('error').hidden = false;
  }

  function settle(p) {
    return p.then(function (r) { return { ok: true, v: r }; }, function (e) { return { ok: false, e: e }; });
  }

  // Načte aktuální stav pro zvolený model; vrací chybový text nebo null.
  function loadCurrent() {
    var req = ++currentReq;
    $('now').classList.add('is-loading');
    return settle(API.fetchCurrent(mode)).then(function (r) {
      if (req !== currentReq) return null; // mezitím přišel novější dotaz
      if (r.ok) { renderCurrent(r.v); return null; }
      $('now').classList.remove('is-loading');
      return 'aktuální stav (' + r.e.message + ')';
    });
  }

  // Sloučí uložená surová data podle zvoleného modelu a vykreslí graf a dny.
  function renderForecast() {
    if (!rawForecast) return;
    var merged = API.merge(rawForecast, mode);
    renderHours(merged.hourly);
    renderDays(merged.daily);
  }

  function load() {
    if (loading) return;
    loading = true;
    $('refresh').classList.add('spin');
    $('error').hidden = true;

    Promise.all([
      loadCurrent(),
      settle(API.fetchForecast())
    ]).then(function (res) {
      var errs = [];
      if (res[0]) errs.push(res[0]);
      if (res[1].ok) {
        rawForecast = res[1].v;
        try { renderForecast(); } catch (e) { errs.push('předpověď (' + e.message + ')'); }
      } else {
        errs.push('předpověď (' + res[1].e.message + ')');
      }
      if (errs.length) showError('Nepodařilo se načíst: ' + errs.join(', ') + '.');
      if (!res[0] || res[1].ok) {
        lastLoad = Date.now();
        $('updated').textContent = 'aktualizováno ' + pragueNow().slice(11, 16);
      } else {
        $('updated').textContent = 'data nejsou k dispozici';
      }
    }).finally(function () {
      loading = false;
      $('refresh').classList.remove('spin');
    });
  }

  /* ---------- Přepínače ---------- */
  var THEME_COLORS = { light: '#f4f6f9', dark: '#11151c' };
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme);
    // Barva lišty prohlížeče na mobilu odpovídá zvolenému tématu.
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute('content', THEME_COLORS[theme]);
    });
    var btn = $('theme-toggle');
    var label = theme === 'dark' ? 'Přepnout na světlý vzhled' : 'Přepnout na tmavý vzhled';
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  $('model-select').value = mode;
  applyTheme();

  $('theme-toggle').addEventListener('click', function () {
    theme = theme === 'dark' ? 'light' : 'dark';
    writePref('pocasi-theme', theme);
    applyTheme();
  });

  $('model-select').addEventListener('change', function (e) {
    mode = e.target.value;
    writePref('pocasi-model', mode);
    $('error').hidden = true;
    try { renderForecast(); } catch (err) { showError('Nepodařilo se zobrazit předpověď (' + err.message + ').'); }
    loadCurrent().then(function (msg) { if (msg) showError('Nepodařilo se načíst: ' + msg + '.'); });
  });

  $('refresh').addEventListener('click', load);
  $('retry').addEventListener('click', load);
  setInterval(load, REFRESH_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - lastLoad > REFRESH_MS) load();
  });

  load();
})();
