/* Open-Meteo: sestavení dotazů a sloučení modelů ICON-D2 / ICON-EU / ECMWF IFS. */
(function () {
  'use strict';

  var BASE = 'https://api.open-meteo.com/v1/forecast';
  var LAT = 49.78;
  var LON = 13.59;
  var TZ = 'Europe/Prague';
  var TIMEOUT_MS = 12000;

  var MODELS = {
    icon_d2: { short: 'D2', name: 'ICON-D2' },
    icon_eu: { short: 'EU', name: 'ICON-EU' },
    ecmwf_ifs: { short: 'EC', name: 'ECMWF IFS' }
  };

  var CURRENT_VARS = [
    'temperature_2m', 'apparent_temperature', 'cloud_cover', 'wind_speed_10m',
    'wind_gusts_10m', 'wind_direction_10m', 'precipitation', 'relative_humidity_2m',
    'pressure_msl', 'weather_code', 'is_day'
  ];
  var HOURLY_VARS = [
    'temperature_2m', 'apparent_temperature', 'precipitation', 'precipitation_probability',
    'cloud_cover', 'wind_speed_10m', 'wind_gusts_10m', 'weather_code', 'is_day'
  ];
  var DAILY_VARS = [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
    'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max',
    'sunrise', 'sunset'
  ];

  // Režim „auto“: graf 48 h a dny 1–2 začínají ICON-D2, dny 3–7 ECMWF.
  var ALL_MODELS = ['icon_d2', 'icon_eu', 'ecmwf_ifs'];
  var AUTO_HOURLY = ['icon_d2', 'icon_eu', 'ecmwf_ifs'];
  var AUTO_DAY_SHORT = ['icon_d2', 'icon_eu', 'ecmwf_ifs'];
  var AUTO_DAY_LONG = ['ecmwf_ifs', 'icon_eu', 'icon_d2'];

  // Pořadí modelů podle zvoleného režimu ('auto' nebo id jednoho modelu).
  function orders(mode) {
    if (MODELS[mode]) return { hourly: [mode], dayShort: [mode], dayLong: [mode], strict: true };
    return { hourly: AUTO_HOURLY, dayShort: AUTO_DAY_SHORT, dayLong: AUTO_DAY_LONG, strict: false };
  }

  function buildUrl(params) {
    var q = Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    return BASE + '?' + q;
  }

  function common() {
    return {
      latitude: LAT,
      longitude: LON,
      timezone: TZ,
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      precipitation_unit: 'mm'
    };
  }

  function getJson(url) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS) : null;
    return fetch(url, ctrl ? { signal: ctrl.signal } : {})
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || body.error) {
            throw new Error(body.reason || ('HTTP ' + res.status));
          }
          return body;
        });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') throw new Error('Vypršel časový limit odpovědi');
        throw err;
      })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function isNum(v) { return typeof v === 'number' && !isNaN(v); }

  /* --- A) Aktuální stav: v auto režimu ICON-D2, záložně ICON-EU, nakonec ECMWF --- */
  function fetchCurrent(mode) {
    var order = orders(mode).hourly;
    var lastErr = null;

    function attempt(i) {
      if (i >= order.length) {
        return Promise.reject(lastErr || new Error('Aktuální data nejsou k dispozici'));
      }
      var model = order[i];
      var p = common();
      p.current = CURRENT_VARS.join(',');
      p.models = model;
      return getJson(buildUrl(p)).then(function (data) {
        var c = data.current || {};
        var complete = ['temperature_2m', 'wind_speed_10m', 'weather_code'].every(function (k) {
          return isNum(c[k]);
        });
        if (!complete) throw new Error('Model ' + MODELS[model].name + ' nevrátil aktuální data');
        return { model: model, data: c, interval: c.interval };
      }).catch(function (err) {
        lastErr = err;
        return attempt(i + 1);
      });
    }
    return attempt(0);
  }

  /* --- B) Hodinová + denní předpověď, všechny modely v jednom dotazu --- */
  function fetchForecast() {
    var p = common();
    p.hourly = HOURLY_VARS.join(',');
    p.daily = DAILY_VARS.join(',');
    p.models = ALL_MODELS.join(',');
    p.forecast_days = 7;
    // Vrací surová data; sloučení podle zvoleného modelu dělá merge(),
    // takže přepnutí modelu nepotřebuje nový dotaz.
    return getJson(buildUrl(p));
  }

  function merge(raw, mode) {
    var o = orders(mode);
    return {
      hourly: mergeHourly(raw.hourly, o.hourly),
      daily: mergeDaily(raw.daily, raw.hourly, o)
    };
  }

  function pick(block, name, model, i) {
    var arr = block[name + '_' + model];
    return arr ? arr[i] : undefined;
  }

  // Pro každou hodinu vezme první model (v pořadí), který má teplotu;
  // všechny veličiny té hodiny pak bere ze stejného modelu, aby k sobě seděly.
  function mergeHourly(h, order) {
    if (!h || !h.time) return [];
    var out = [];
    for (var i = 0; i < h.time.length; i++) {
      var model = null;
      for (var m = 0; m < order.length; m++) {
        if (isNum(pick(h, 'temperature_2m', order[m], i))) { model = order[m]; break; }
      }
      if (!model) continue;
      var row = { time: h.time[i], model: model };
      HOURLY_VARS.forEach(function (v) {
        var val = pick(h, v, model, i);
        row[v] = isNum(val) ? val : null;
      });
      out.push(row);
    }
    return out;
  }

  // Počet hodin dne, které model pokrývá teplotou, a kolik hodin ten den má (23/24/25 při změně času).
  function coverage(h, model, date) {
    var total = 0, have = 0;
    var arr = h && h['temperature_2m_' + model];
    if (!h || !h.time) return { total: 0, have: 0 };
    for (var i = 0; i < h.time.length; i++) {
      if (h.time[i].slice(0, 10) !== date) continue;
      total++;
      if (arr && isNum(arr[i])) have++;
    }
    return { total: total, have: have };
  }

  function mergeDaily(d, h, o) {
    if (!d || !d.time) return [];
    return d.time.map(function (date, i) {
      var order = i < 2 ? o.dayShort : o.dayLong;
      var chosen = null;
      // Přednost má model, který pokrývá celý den; v auto režimu pak první, který má aspoň max. teplotu.
      // Při ručně zvoleném modelu se neúplný den nezobrazí (denní max/min by byly zkreslené).
      for (var a = 0; a < order.length && !chosen; a++) {
        var cov = coverage(h, order[a], date);
        if (cov.total > 0 && cov.have === cov.total && isNum(pick(d, 'temperature_2m_max', order[a], i))) {
          chosen = order[a];
        }
      }
      for (var b = 0; b < order.length && !chosen && !o.strict; b++) {
        if (isNum(pick(d, 'temperature_2m_max', order[b], i))) chosen = order[b];
      }
      var row = { date: date, model: chosen };
      DAILY_VARS.forEach(function (v) {
        var val = chosen ? pick(d, v, chosen, i) : null;
        if (val === undefined) val = null;
        // Východ/západ slunce je astronomický – vezmeme jakýkoli model, který ho má.
        if (val === null && (v === 'sunrise' || v === 'sunset')) {
          for (var c = 0; c < ALL_MODELS.length && val === null; c++) {
            var alt = pick(d, v, ALL_MODELS[c], i);
            if (alt) val = alt;
          }
        }
        row[v] = val;
      });
      return row;
    });
  }

  window.WeatherAPI = {
    MODELS: MODELS,
    TZ: TZ,
    fetchCurrent: fetchCurrent,
    fetchForecast: fetchForecast,
    merge: merge
  };
})();
