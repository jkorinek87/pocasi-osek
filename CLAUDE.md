# Počasí – Osek u Rokycan

Statická webová aplikace s předpovědí počasí pro jednu obec.

## Lokalita
- Obec **Osek u Rokycan**, souřadnice **49.78, 13.59** (konstanty `LAT`/`LON` v `api.js`).
- Časové pásmo **Europe/Prague** – v API (`timezone=Europe/Prague`) i ve formátování (`Intl` s `timeZone`).

## Technologie
- Jen **HTML, CSS a čistý JavaScript**. Žádný framework, knihovna, npm ani build.
- Skripty se načítají klasickým `<script defer>`, **ne jako ES moduly** – stránka musí fungovat i po otevření `index.html` přímo ze souboru (`file://`).
- Moduly sdílí stav přes globální objekty: `window.WeatherAPI` (`api.js`), `window.WeatherChart` (`chart.js`); `app.js` je spojuje.
- Graf je vlastní SVG (`chart.js`), barvy přes CSS proměnné, žádná knihovna pro grafy.

## Data: Open-Meteo
- Endpoint `https://api.open-meteo.com/v1/forecast`, zdarma, bez API klíče, CORS povolen.
- Modely (hodnoty parametru `models`): `icon_d2` (ICON-D2, 2 km, ~2,5 dne), `icon_eu` (ICON-EU, 7 km, 5 dní), `ecmwf_ifs` (ECMWF IFS HRES, 9 km, 7+ dní).
- Režim **Automaticky** (výchozí):
  - aktuální stav: ICON-D2 → záložně ICON-EU → ECMWF,
  - graf 48 h: po hodinách ICON-D2 → ICON-EU → ECMWF,
  - 7 dní: dny 1–2 ICON-D2 (záložně ICON-EU), dny 3–7 ECMWF.
- Uživatel může zvolit jediný model; dny mimo jeho dosah se pak nezobrazí (neúplný den by dával zkreslené max/min).
- Při více modelech v jednom dotazu mají proměnné v `hourly`/`daily` příponu modelu (`temperature_2m_icon_d2`) a mimo dosah modelu `null`. Blok `current` příponu nemá → aktuální stav se volá zvlášť s jedním modelem.
- Předpověď se stahuje jednou pro všechny modely; přepnutí modelu jen znovu slučuje data (`WeatherAPI.merge`).
- Parametry API ověřuj v dokumentaci (https://open-meteo.com/en/docs), nehádej je.
- Licence CC BY 4.0: odkaz „Data: Open-Meteo.com“ v patičce musí zůstat. Bezplatné API jen pro nekomerční použití.

## Jazyk a jednotky
- Veškeré texty v UI **česky** (`lang="cs"`, formátování `cs-CZ` – desetinná čárka).
- Jednotky **°C, km/h, mm** (`temperature_unit=celsius`, `wind_speed_unit=kmh`, `precipitation_unit=mm`); tlak v hPa, vlhkost a oblačnost v %.
- Časy z API jsou místní pražský čas bez offsetu (`"2026-11-27T14:00"`). Nepředávej je do `new Date()` (vyložil by je v pásmu prohlížeče) – pracuj s nimi jako s řetězci, „teď“ získáš přes `pragueNow()` v `app.js`.

## UI
- Mobile-first, musí fungovat od šířky 320 px bez vodorovného posouvání stránky (posouvá se jen graf).
- Světlý/tmavý vzhled: výchozí podle systému, přepínač v hlavičce nastavuje `data-theme` na `<html>`. Barvy jen přes CSS proměnné v `:root`.
- Volby se ukládají do `localStorage` (`pocasi-theme`, `pocasi-model`), vždy v `try/catch` – aplikace musí fungovat i bez něj.
- Data se obnovují automaticky každých 15 minut a po návratu na stránku, pokud jsou starší.

## Spuštění lokálně
- Nejjednodušší: otevřít `index.html` dvojklikem.
- Lokální server (Python ani Node.js na tomto počítači nejsou):
  ```powershell
  powershell -ExecutionPolicy Bypass -File serve.ps1
  ```
  pak http://localhost:8000. Server poslouchá jen na `localhost`, ne na `127.0.0.1`.
- V Claude desktop aplikaci je náhled připravený v `.claude/launch.json` (konfigurace `pocasi`).
- `serve.ps1` drž **jen v ASCII** – Windows PowerShell 5.1 čte soubory bez BOM jako ANSI.

## Ověření změn
Spustit server, otevřít stránku a zkontrolovat: obě volání Open-Meteo vrací 200, vykreslí se aktuální stav, graf (48 sloupců) i 7 dní, konzole bez chyb, a na šířce 375 px žádné vodorovné posouvání.
