# Počasí – Osek u Rokycan

Statická webová aplikace s předpovědí počasí. Výchozí místo je Osek u Rokycan (49,78° s. š., 13,59° v. d.),
ale jde zobrazit počasí kdekoli na světě.

Vše je v menu **☰** vlevo nahoře:

- **Zadat místo** – hledání obce nebo města s našeptáváním.
- **📍 Použít moji polohu** – zjistí polohu z prohlížeče (funguje na HTTPS a localhost).
- **Automaticky podle polohy (GPS)** – při každém otevření se samo přepne na aktuální polohu.
  Když je vypnuté, otevře se naposledy zobrazené místo.
- **Uložená místa** – „☆ Uložit aktuální“ přidá místo do seznamu, klepnutím se na něj přepne, 🗑 ho smaže.

Jen HTML, CSS a čistý JavaScript, bez frameworku a bez buildu.

**Živá verze:** https://jkorinek87.github.io/pocasi-osek/ (GitHub Pages z větve `main`, obnoví se po každém pushi).

## Spuštění

**Nejjednodušší:** otevři `index.html` dvojklikem v prohlížeči. Aplikace nepoužívá ES moduly
a Open-Meteo povoluje CORS, takže funguje i z `file://`.

**Přes lokální server** (doporučeno). Bez Pythonu i Node.js stačí přiložený PowerShell skript:

```powershell
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Pak otevři http://localhost:8000 (ukončení Ctrl+C). Alternativy: `python -m http.server 8000`,
`npx serve` (Node.js) nebo rozšíření Live Server ve VS Code.

## Soubory

| Soubor | Co dělá |
|---|---|
| `index.html` | Kostra stránky |
| `styles.css` | Vzhled, mobilní layout, světlý/tmavý režim |
| `api.js` | Volání Open-Meteo a sloučení modelů |
| `chart.js` | SVG graf na 48 hodin |
| `app.js` | Vykreslení, české formátování, obnova každých 15 min |

## Data

[Open-Meteo](https://open-meteo.com/) (CC BY 4.0, zdarma pro nekomerční použití, bez API klíče).

- **Aktuální stav:** ICON-D2, záložně ICON-EU (a nakonec ECMWF).
- **Graf 48 h:** po hodinách ICON-D2, kde chybí, ICON-EU, pak ECMWF IFS.
- **7 dní:** dny 1–2 ICON-D2 (záložně ICON-EU), dny 3–7 ECMWF IFS. Štítek u dne ukazuje použitý model.

To je režim **Automaticky**. V nabídce *Model* jde zvolit jen jeden model (ICON-D2, ICON-EU, nebo ECMWF IFS):
celá stránka pak ukazuje jen jeho data a dny mimo jeho dosah jsou označené „Mimo dosah zvoleného modelu“.
Přepnutí modelu nestahuje předpověď znovu, jen aktuální stav.

Tlačítkem 🌙 / ☀️ v hlavičce se přepíná světlý a tmavý vzhled (výchozí je podle systému).
Tlačítkem 🎄 se zapíná vánoční vzhled (barvy, girlanda, padající sníh) – funguje ve světlém i tmavém režimu.
Zvolený model i vzhled si prohlížeč pamatuje (localStorage).

Časy jsou v místním čase zvoleného místa, jednotky °C, km/h, mm.
