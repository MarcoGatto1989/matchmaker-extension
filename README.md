# MatchMaker BOOT Outreach — Chrome Extension

Semi-automatische LinkedIn-Kontaktanfragen für MatchMaker BOOT.

## Installation (Chrome)

1. Chrome öffnen → `chrome://extensions/`
2. **Entwicklermodus** aktivieren (oben rechts)
3. **Entpackte Erweiterung laden** → diesen Ordner auswählen
4. Extension-Icon klicken → Token eingeben

## Dateien

| Datei | Beschreibung |
|---|---|
| `manifest.json` | Chrome Extension Manifest V3 |
| `background.js` | Service Worker — Kommunikation zwischen Popup, Content-Script und API |
| `content.js` | LinkedIn-Automatisierung (läuft auf linkedin.com) |
| `popup.html` | Popup-UI für Token-Eingabe |
| `popup.js` | Popup-Logik |
| `icon*.png` | Extension-Icons (16px, 48px, 128px) |

## Konfiguration

In `background.js` die `API_BASE`-URL auf die tatsächliche Backend-API setzen.

## Hinweis

Diese Extension benötigt ein Backend-API, das folgende Endpunkte bereitstellt:
- `GET /api/extension/jobs/queued?limit=1` — Nächsten Job abrufen
- `POST /api/extension/jobs/{job_id}/complete` — Job-Status melden
