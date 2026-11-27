# Počasí – Osek u Rokycan

Statická webová aplikace s předpovědí počasí. Výchozí místo je Osek u Rokycan, jde ale zvolit jakékoli místo na světě.

## Lokalita
- Výchozí místo **Osek u Rokycan**, souřadnice **49.78, 13.59** (`DEFAULT_LOCATION` v `api.js`).
- Místo = `{ name, detail, lat, lon, gps }` (stav `place` v `app.js`). Po otevření se ukáže naposledy zobrazené místo (`pocasi-loc`); se zapnutou volbou „Automaticky podle polohy“ (`pocasi-autogps`) se pak samo přepne na polohu z GPS (`locate(true)`).
- Ovládání míst je ve výsuvném menu ☰ vlevo nahoře (`#drawer`, modální dialog: Escape, klik mimo a ✕ ho zavřou, Tab zůstává uvnitř, fokus se vrací na ☰). Výběr místa menu zavře.
- Načítání: nejdřív předpověď (všechny modely), z ní `availableModels()` zjistí, které modely mají pro místo data; aktuální stav se ptá jen jich (jinak by mimo oblast ICON vznikaly chyby 400 v konzoli).
- Hledání: Open-Meteo Geocoding (`https://geocoding-api.open-meteo.com/v1/search`, `language=cs`, data GeoNames), našeptávání po 300 ms od 2 znaků.
- Poloha: Geolocation API prohlížeče (funguje jen na HTTPS nebo localhost), souřadnice zaokrouhlené na 3 desetinná místa. Název místa z BigDataCloud `reverse-geocode-client` – podle jejich podmínek se smí volat **jen ze souřadnic z Geolocation API**, ne z hledání ani z uložených míst.
- Uložená místa: `pocasi-favs` (nejvýš 12), v menu tlačítko „☆ Uložit aktuální“ a seznam s 🗑 pro smazání. Názvy míst z API se do stránky vkládají **jen přes `textContent`**, nikdy přes `innerHTML`.
- Časové pásmo: v API `timezone=auto`, pásmo místa z odpovědi (`timezone`) se ukládá do `tz` v `app.js` a používá ve formátování (`Intl` s `timeZone`). Čas „aktualizováno“ je podle hodin uživatele.
- Mimo oblast ICON (mimo střední Evropu / Evropu) vrací ICON `null`, u aktuálního stavu chybu „No data is available“ – režim Automaticky pak použije ECMWF.
- Pozor: když má pro místo data **jen jeden** model (např. Japonsko → jen ECMWF), API vrátí `hourly`/`daily` proměnné **bez přípony** modelu. `normalizeModels()` v `api.js` je přejmenuje na `_ecmwf_ifs` (jediný globální model), jinak by graf i 7 dní zůstaly prázdné.

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
- Časy z API jsou místní čas zvoleného místa bez offsetu (`"2026-11-27T14:00"`). Nepředávej je do `new Date()` (vyložil by je v pásmu prohlížeče) – pracuj s nimi jako s řetězci, „teď“ v místě získáš přes `localNow()` v `app.js`.

## UI
- Mobile-first, musí fungovat od šířky 320 px bez vodorovného posouvání stránky (posouvá se jen graf).
- Světlý/tmavý vzhled: výchozí podle systému, přepínač v hlavičce nastavuje `data-theme` na `<html>`. Barvy jen přes CSS proměnné v `:root`.
- Vánoční vzhled: samostatný přepínač 🎄, nastavuje atribut `data-xmas` na `<html>` a kombinuje se se světlým i tmavým (vlastní CSS proměnné pro obě varianty). Hlavička je prapor (červený / v tmavém zelený), pod ní girlanda žárovek (sestavuje `buildGarland()` v `app.js`, přepočítá se při změně šířky), karty mají sněhové čepice, v patičce je přání. Sníh (`#snow`) je pod kartami (`z-index`), aby nepřekrýval údaje; při `prefers-reduced-motion` vločky jen staticky leží a žárovky neblikají.
- Volby se ukládají do `localStorage` (`pocasi-theme`, `pocasi-model`, `pocasi-xmas`, `pocasi-loc`, `pocasi-favs`, `pocasi-autogps`), vždy v `try/catch` – aplikace musí fungovat i bez něj. Téma i vánoční vzhled nastavuje už inline skript v `<head>`, aby stránka neproblikla.
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

## Nasazení
- Veřejný repozitář https://github.com/jkorinek87/pocasi-osek, GitHub Pages z kořene větve `main`: https://jkorinek87.github.io/pocasi-osek/
- Každý push do `main` stránku přenasadí. `.nojekyll` vypíná Jekyll – soubory se servírují tak, jak jsou.
- Všechny cesty v `index.html` musí zůstat relativní (stránka běží v podadresáři `/pocasi-osek/`).

## Ověření změn
Spustit server, otevřít stránku a zkontrolovat: obě volání Open-Meteo vrací 200, vykreslí se aktuální stav, graf (48 sloupců) i 7 dní, konzole bez chyb, a na šířce 375 px žádné vodorovné posouvání.
