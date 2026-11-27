/* Hlavní logika: načtení dat, vykreslení aktuálního stavu, grafu a 7 dní. */
(function () {
  'use strict';

  var API = window.WeatherAPI;
  var REFRESH_MS = 15 * 60 * 1000;
  var HOURS = 48;
  var MAX_FAVS = 12;

  var $ = function (id) { return document.getElementById(id); };
  var lastLoad = 0;
  var loadGen = 0;           // pořadí načítání; starší odpověď (např. po přepnutí místa) se zahodí
  // Časové pásmo zobrazeného místa – přepíše ho odpověď API (timezone=auto).
  var tz = 'Europe/Prague';

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
  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  // Místo = { name, detail, lat, lon, gps? }. Neplatná uložená data se ignorují.
  function validPlace(p) {
    return p && typeof p.name === 'string' && p.name &&
      typeof p.lat === 'number' && Math.abs(p.lat) <= 90 &&
      typeof p.lon === 'number' && Math.abs(p.lon) <= 180;
  }
  function cleanPlace(p) {
    return { name: p.name, detail: p.detail || '', lat: p.lat, lon: p.lon, gps: !!p.gps };
  }
  function placeKey(p) { return p.lat.toFixed(3) + ',' + p.lon.toFixed(3); }

  // Po otevření se ukáže naposledy zobrazené místo (zpočátku Osek u Rokycan).
  var savedPlace = readJson('pocasi-loc');
  var place = validPlace(savedPlace) ? cleanPlace(savedPlace) : cleanPlace(API.DEFAULT_LOCATION);
  var favs = (readJson('pocasi-favs') || []).filter(validPlace).map(cleanPlace).slice(0, MAX_FAVS);

  var MODES = ['auto', 'icon_d2', 'icon_eu', 'ecmwf_ifs'];
  var mode = readPref('pocasi-model', MODES, 'auto');
  // Výchozí téma podle systému, po přepnutí se pamatuje volba uživatele.
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = readPref('pocasi-theme', ['light', 'dark'], systemDark ? 'dark' : 'light');
  // Vánoční vzhled je nezávislý přepínač, kombinuje se se světlým i tmavým.
  var xmas = readPref('pocasi-xmas', ['on', 'off'], 'off') === 'on';
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

  /* ---------- Formátování (cs-CZ, časy v pásmu zobrazeného místa) ---------- */
  function num(v, d) {
    if (v == null) return '–';
    return v.toLocaleString('cs-CZ', { maximumFractionDigits: d || 0, minimumFractionDigits: d || 0 });
  }
  function temp(v, d) { return v == null ? '–' : num(v, d) + ' °C'; }

  // Aktuální čas zobrazeného místa jako "YYYY-MM-DDTHH:MM" (stejný tvar jako časy z API).
  function localNow() {
    var parts = {};
    var opts = {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    };
    var fmt;
    try { fmt = new Intl.DateTimeFormat('en-CA', Object.assign({ timeZone: tz }, opts)); }
    catch (e) { fmt = new Intl.DateTimeFormat('en-CA', opts); } // neznámé pásmo → čas prohlížeče
    fmt.formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
  }
  var browserTz = (function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; }
  })();
  var fmtClock = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit' });
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
    var today = localNow().slice(0, 10);
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
    var nowHour = localNow().slice(0, 13) + ':00';
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

    // Které modely se skutečně použily (mimo Evropu ICON nemá data, zůstane jen ECMWF).
    var usedModels = [];
    daily.forEach(function (d) {
      if (d.model && usedModels.indexOf(d.model) < 0) usedModels.push(d.model);
    });
    $('days-meta').textContent = mode === 'auto'
      ? (usedModels.length ? usedModels.map(function (m) { return API.MODELS[m].name; }).join(' + ') : '')
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
    return settle(API.fetchCurrent(mode, place, API.availableModels(rawForecast))).then(function (r) {
      if (req !== currentReq) return null; // mezitím přišel novější dotaz
      if (r.ok) { renderCurrent(r.v); return null; }
      // Nenechávat na kartě staré hodnoty jiného modelu nebo místa.
      $('now-icon').textContent = '·';
      $('now-temp').textContent = '–';
      $('now-desc').textContent = 'Aktuální stav není k dispozici';
      $('now-meta').textContent = '';
      $('now-tiles').textContent = '';
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
    var gen = ++loadGen;
    $('refresh').classList.add('spin');
    $('error').hidden = true;

    // Nejdřív předpověď (všechny modely naráz): z ní je vidět, které modely pro místo
    // mají data, a aktuální stav se pak ptá jen jich – mimo oblast ICON tak nevznikají chyby 400.
    var errs = [];
    var forecastOk = false;
    settle(API.fetchForecast(place)).then(function (f) {
      if (gen !== loadGen) return null; // mezitím se načítá jiné místo
      if (f.ok) {
        forecastOk = true;
        rawForecast = f.v;
        if (rawForecast.timezone) tz = rawForecast.timezone;
        try { renderForecast(); } catch (e) { errs.push('předpověď (' + e.message + ')'); }
      } else {
        errs.push('předpověď (' + f.e.message + ')');
      }
      return loadCurrent();
    }).then(function (currentErr) {
      if (gen !== loadGen) return;
      if (currentErr) errs.push(currentErr);
      if (errs.length) showError('Nepodařilo se načíst: ' + errs.join(', ') + '.');
      if (!currentErr || forecastOk) {
        lastLoad = Date.now();
        // Čas aktualizace podle hodin uživatele; u místa v jiném pásmu se pásmo připíše.
        $('updated').textContent = 'aktualizováno ' + fmtClock.format(new Date()) +
          (tz && browserTz && tz !== browserTz ? ' · místní čas ' + tz.replace(/_/g, ' ') : '');
      } else {
        $('updated').textContent = 'data nejsou k dispozici';
      }
    }).finally(function () {
      if (gen === loadGen) $('refresh').classList.remove('spin');
    });
  }

  /* ---------- Místo: zobrazení, hledání, poloha, oblíbená ---------- */
  function fmtCoords(p) {
    return num(Math.abs(p.lat), 2) + '° ' + (p.lat >= 0 ? 's. š.' : 'j. š.') + ', ' +
      num(Math.abs(p.lon), 2) + '° ' + (p.lon >= 0 ? 'v. d.' : 'z. d.');
  }
  function isFav(p) {
    var k = placeKey(p);
    return favs.some(function (f) { return placeKey(f) === k; });
  }
  function setStatus(text) {
    $('loc-status').textContent = text || '';
    $('loc-status').hidden = !text;
  }

  // Názvy míst přicházejí z API → vkládají se jen přes textContent, nikdy přes innerHTML.
  function renderPlace() {
    $('loc-name').textContent = place.name;
    // Krátký název (např. „Osek u Rokycan“) drží vánoční nadpis na jednom řádku, delší se zalomí.
    $('loc-name').classList.toggle('long-name', place.name.length > 15);
    $('loc-detail').textContent = (place.gps ? '📍 ' : '') + (place.detail || fmtCoords(place));
    $('loc-detail').title = fmtCoords(place);
    document.title = 'Počasí ' + place.name;
    var fav = isFav(place);
    $('fav-toggle').textContent = fav ? '★ Uloženo' : '☆ Uložit aktuální';
    $('fav-toggle').setAttribute('aria-pressed', fav ? 'true' : 'false');
    $('fav-toggle').title = fav ? 'Odebrat „' + place.name + '“ z uložených' : 'Uložit „' + place.name + '“';
    renderFavs();
  }

  function renderFavs() {
    var list = $('favs');
    list.textContent = '';
    $('favs-empty').hidden = favs.length > 0;
    var current = placeKey(place);
    favs.forEach(function (f, i) {
      var li = document.createElement('li');
      li.className = 'fav-row' + (placeKey(f) === current ? ' current' : '');
      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'fav-go';
      var nameEl = document.createElement('span');
      nameEl.textContent = f.name;
      go.appendChild(nameEl);
      if (f.detail) {
        var small = document.createElement('small');
        small.textContent = f.detail;
        go.appendChild(small);
      }
      if (placeKey(f) === current) go.setAttribute('aria-current', 'true');
      go.addEventListener('click', function () { setPlace(f); });
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'fav-del';
      del.textContent = '🗑';
      del.title = 'Smazat';
      del.setAttribute('aria-label', 'Smazat uložené místo ' + f.name);
      del.addEventListener('click', function () {
        favs.splice(i, 1);
        writeJson('pocasi-favs', favs);
        renderPlace();
        // Fokus na další řádek (nebo na tlačítko Uložit), ať se při ovládání klávesnicí neztratí.
        var dels = $('favs').querySelectorAll('.fav-del');
        (dels[Math.min(i, dels.length - 1)] || $('fav-toggle')).focus();
      });
      li.appendChild(go);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  function setPlace(p) {
    place = cleanPlace(p);
    writeJson('pocasi-loc', place);
    setStatus('');
    rawForecast = null;
    ['now', 'chart', 'days'].forEach(function (id) { $(id).classList.add('is-loading'); });
    renderPlace();
    closeDrawer();
    load();
  }

  /* ---------- Menu ☰ (výsuvný panel) ---------- */
  var drawerOpen = false;
  function openDrawer() {
    drawerOpen = true;
    $('drawer').classList.add('open');
    $('drawer-backdrop').classList.add('open');
    $('menu-btn').setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    // Fokus až po zviditelnění panelu (visibility se mění okamžitě, transform animuje).
    setTimeout(function () { $('loc-input').focus(); }, 50);
  }
  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    $('drawer').classList.remove('open');
    $('drawer-backdrop').classList.remove('open');
    $('menu-btn').setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    $('loc-input').value = '';
    closeResults();
    $('menu-btn').focus();
  }
  $('menu-btn').addEventListener('click', function () { if (drawerOpen) closeDrawer(); else openDrawer(); });
  $('drawer-close').addEventListener('click', closeDrawer);
  $('drawer-backdrop').addEventListener('click', closeDrawer);
  $('drawer').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    // Tab zůstává uvnitř panelu (modální dialog).
    var items = Array.prototype.filter.call(
      $('drawer').querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])'),
      function (el) { return !el.disabled && el.offsetParent !== null; }
    );
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  $('fav-toggle').addEventListener('click', function () {
    var k = placeKey(place);
    if (isFav(place)) {
      favs = favs.filter(function (f) { return placeKey(f) !== k; });
    } else {
      if (favs.length >= MAX_FAVS) { setStatus('Uložit jde nejvýš ' + MAX_FAVS + ' míst. Nejdřív nějaké odeber.'); return; }
      favs.push(cleanPlace({ name: place.name, detail: place.detail, lat: place.lat, lon: place.lon }));
    }
    writeJson('pocasi-favs', favs);
    renderPlace();
  });

  // Poloha z prohlížeče (Geolocation API) → název místa → předpověď.
  // auto=true: volá se sama při otevření stránky (zapnutá volba „Automaticky podle polohy“).
  function locate(auto) {
    var btn = $('geo-btn');
    if (!navigator.geolocation) { setStatus('Tento prohlížeč neumí zjistit polohu.'); return; }
    btn.disabled = true;
    setStatus('Zjišťuji polohu…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      // Zaokrouhlení na ~100 m stačí pro předpověď i název obce.
      var lat = Math.round(pos.coords.latitude * 1000) / 1000;
      var lon = Math.round(pos.coords.longitude * 1000) / 1000;
      // Při automatickém zjištění na stejném místě nic znovu nenačítat.
      if (auto && place.gps && placeKey(place) === placeKey({ lat: lat, lon: lon })) {
        btn.disabled = false;
        setStatus('');
        return;
      }
      API.reverseGeocode(lat, lon).then(function (n) {
        btn.disabled = false;
        setPlace({ name: n.name, detail: n.detail, lat: lat, lon: lon, gps: true });
      });
    }, function (err) {
      btn.disabled = false;
      var msg = {
        1: 'Přístup k poloze je zakázaný. Povol ho pro tuto stránku v nastavení prohlížeče.',
        2: 'Polohu se nepodařilo zjistit.',
        3: 'Zjišťování polohy trvalo příliš dlouho. Zkus to znovu.'
      }[err.code] || 'Polohu se nepodařilo zjistit.';
      setStatus(auto ? msg + ' Zobrazuji naposledy vybrané místo.' : msg);
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60 * 1000 });
  }
  $('geo-btn').addEventListener('click', function () { locate(false); });

  // Volba „Automaticky podle polohy (GPS) při každém otevření“.
  var autoGps = readPref('pocasi-autogps', ['on', 'off'], 'off') === 'on';
  $('auto-gps').checked = autoGps;
  $('auto-gps').addEventListener('change', function (e) {
    autoGps = e.target.checked;
    writePref('pocasi-autogps', autoGps ? 'on' : 'off');
    if (autoGps) locate(false); // hned po zapnutí ukázat aktuální polohu
    else setStatus('');
  });

  // Hledání místa podle názvu s našeptáváním.
  var searchTimer = null;
  var searchSeq = 0;
  var results = [];
  var activeIdx = -1;

  function closeResults() {
    $('loc-results').hidden = true;
    $('loc-input').setAttribute('aria-expanded', 'false');
    $('loc-input').removeAttribute('aria-activedescendant');
    activeIdx = -1;
  }
  function highlight(i) {
    var items = $('loc-results').querySelectorAll('[role="option"]');
    items.forEach(function (el, j) { el.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
    activeIdx = i;
    if (items[i]) {
      $('loc-input').setAttribute('aria-activedescendant', items[i].id);
      items[i].scrollIntoView({ block: 'nearest' });
    }
  }
  function choose(i) {
    var r = results[i];
    if (!r) return;
    $('loc-input').value = '';
    closeResults();
    setPlace(r); // zavře i panel a vrátí fokus na ☰
  }
  function showResults(list, query) {
    var ul = $('loc-results');
    ul.textContent = '';
    results = list;
    if (!list.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nic nenalezeno pro „' + query + '“.';
      ul.appendChild(empty);
    }
    list.forEach(function (r, i) {
      var li = document.createElement('li');
      li.id = 'loc-opt-' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.textContent = r.name;
      if (r.detail) {
        var small = document.createElement('small');
        small.textContent = r.detail;
        li.appendChild(small);
      }
      // mousedown místo click: vybere dřív, než pole ztratí fokus a seznam se zavře
      li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(i); });
      ul.appendChild(li);
    });
    ul.hidden = false;
    $('loc-input').setAttribute('aria-expanded', 'true');
    activeIdx = -1;
  }

  $('loc-input').addEventListener('input', function (e) {
    var q = e.target.value.trim();
    clearTimeout(searchTimer);
    if (q.length < 2) { searchSeq++; closeResults(); return; }
    searchTimer = setTimeout(function () {
      var seq = ++searchSeq;
      API.searchPlaces(q).then(function (list) {
        if (seq === searchSeq) showResults(list, q);
      }).catch(function () {
        if (seq === searchSeq) setStatus('Hledání míst je teď nedostupné.');
      });
    }, 300);
  });
  $('loc-input').addEventListener('keydown', function (e) {
    var open = !$('loc-results').hidden && results.length;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); highlight(Math.min(activeIdx + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); highlight(Math.max(activeIdx - 1, 0)); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); choose(activeIdx >= 0 ? activeIdx : 0); }
    else if (e.key === 'Escape' && open) { e.stopPropagation(); closeResults(); } // jinak Escape zavře celý panel
  });
  $('loc-input').addEventListener('blur', closeResults);

  renderPlace();

  /* ---------- Přepínače ---------- */
  var THEME_COLORS = { light: '#f4f6f9', dark: '#11151c' };
  var XMAS_COLORS = { light: '#9e2019', dark: '#135033' }; // barva praporu v hlavičce
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme);
    // Barva lišty prohlížeče na mobilu odpovídá zvolenému tématu.
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute('content', (xmas ? XMAS_COLORS : THEME_COLORS)[theme]);
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

  /* ---------- Vánoční vzhled ---------- */
  var FLAKES = 40;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function makeSnow() {
    var box = $('snow');
    box.innerHTML = '';
    if (!xmas) return;
    var chars = ['❄', '❅', '❆', '•'];
    var count = reduceMotion ? 18 : FLAKES;
    for (var i = 0; i < count; i++) {
      var f = document.createElement('span');
      f.className = 'flake';
      f.textContent = chars[i % chars.length];
      f.style.left = (Math.random() * 100).toFixed(1) + '%';
      f.style.fontSize = (8 + Math.random() * 12).toFixed(0) + 'px';
      if (reduceMotion) {
        // Bez animace vločky jen staticky „visí“ rozmístěné po obrazovce.
        f.style.top = (Math.random() * 100).toFixed(1) + '%';
      } else {
        f.style.animationDuration = (9 + Math.random() * 12).toFixed(1) + 's';
        // Záporné zpoždění = vločky jsou rozprostřené po obrazovce hned od začátku.
        f.style.animationDelay = (-Math.random() * 20).toFixed(1) + 's';
        f.style.setProperty('--sway', ((Math.random() - 0.5) * 80).toFixed(0) + 'px');
      }
      box.appendChild(f);
    }
  }

  // Girlanda: drát prohnutý mezi háčky po 120 px, žárovky po 30 px visí na drátu.
  var BULB_COLORS = ['var(--xmas-red)', 'var(--gold)', 'var(--xmas-green)', 'var(--xmas-blue)'];
  var HOOK = 120, TOP = 6, SAG = 16;
  function wireY(x) {
    var t = (x % HOOK) / HOOK;
    return TOP + 4 * SAG * t * (1 - t); // parabola mezi dvěma háčky
  }
  function buildGarland() {
    var g = $('garland');
    g.innerHTML = '';
    if (!xmas) return;
    var w = g.clientWidth || document.documentElement.clientWidth;
    var segs = Math.ceil(w / HOOK);
    var d = 'M0,' + TOP;
    for (var s = 0; s < segs; s++) {
      d += ' Q' + (s * HOOK + HOOK / 2) + ',' + (TOP + 2 * SAG) + ' ' + ((s + 1) * HOOK) + ',' + TOP;
    }
    g.innerHTML = '<svg aria-hidden="true"><path class="wire" d="' + d + '"/></svg>';
    for (var i = 0, x = 15; x < w; i++, x += 30) {
      var b = document.createElement('span');
      b.className = 'bulb';
      b.style.left = x + 'px';
      b.style.top = (wireY(x) + 3).toFixed(1) + 'px';
      b.style.setProperty('--c', BULB_COLORS[i % BULB_COLORS.length]);
      b.style.setProperty('--d', ((i % 5) * 0.37).toFixed(2) + 's');
      b.style.setProperty('--r', (i % 2 ? -7 : 7) + 'deg');
      g.appendChild(b);
    }
  }
  var garlandTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(garlandTimer);
    garlandTimer = setTimeout(buildGarland, 150);
  });

  function applyXmas() {
    var root = document.documentElement;
    if (xmas) root.setAttribute('data-xmas', ''); else root.removeAttribute('data-xmas');
    var btn = $('xmas-toggle');
    btn.setAttribute('aria-pressed', xmas ? 'true' : 'false');
    btn.title = xmas ? 'Vypnout vánoční vzhled' : 'Zapnout vánoční vzhled';
    makeSnow();
    buildGarland();
    applyTheme(); // kvůli barvě lišty prohlížeče
  }

  applyXmas();

  $('xmas-toggle').addEventListener('click', function () {
    xmas = !xmas;
    writePref('pocasi-xmas', xmas ? 'on' : 'off');
    applyXmas();
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

  // Hned ukázat naposledy vybrané místo; se zapnutou automatickou polohou pak přepnout na GPS.
  load();
  if (autoGps) locate(true);
})();
