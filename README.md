# MatchMaker BOOT Outreach — Chrome Extension

LinkedIn-/XING-Profilimport, Outreach und Social Publishing über die normale
Anmeldesitzung des jeweiligen Anbieters. Version 3.6.0 übernimmt dabei auch das
in ESOS freigegebene Beitragsbild und lädt es erst direkt vor der Veröffentlichung
authentifiziert aus ESOS. Der Positionsabgleich liest vorhandene Profil-Links per Hintergrundanfrage mit der Browser-Sitzung aus und öffnet dabei keine Tabs. Zugangsdaten werden nicht an ESOS übertragen und nicht
von der Erweiterung gespeichert.

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
| `content.js` | LinkedIn-/XING-Automatisierung einschließlich Social Publishing |
| `popup.html` | Popup-UI für Token-Eingabe |
| `popup.js` | Popup-Logik |
| `icon*.png` | Extension-Icons (16px, 48px, 128px) |

## Konfiguration

Die ESOS-URL und der mandantenspezifische Extension-Token werden im Settings-Tab eingetragen. Die feste Extension-ID lautet `mmcadbphcgljgifhgddkbaebkbamlkdm`.

## Hinweis

Diese Extension benötigt ein Backend-API, das folgende Endpunkte bereitstellt:
- `GET /api/outreach-ext/jobs/queued?limit=1` — Nächsten Job abrufen
- `POST /api/outreach-ext/jobs/{job_id}/complete` — Job-Status melden

