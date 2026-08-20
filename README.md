# MatchMaker BOOT — Chrome Extension

LinkedIn-/XING-Profilimport, Positionsabgleich, Netzwerk-Projekte, Outreach und Social Publishing über die normale Anmeldesitzung des jeweiligen Anbieters.

Die Extension kann Kandidaten mit bereits bestätigtem Profil-Link aus dem ESOS Social Finder automatisch in vorhandene **LinkedIn-Recruiter-Projekte** bzw. **XING-TalentManager-Projekte** einsortieren. Projektname und optional die konkrete Projekt-URL werden von ESOS übergeben, damit das richtige Ziel eindeutig ausgewählt werden kann. Der Positionsabgleich liest ausschließlich die aktuelle Position aus dem gespeicherten Profil-Link: zuerst aus strukturierten Profildaten, dann aus öffentlichen Profil-Metadaten. Er öffnet dabei keine Tabs, führt keine Namens- oder Firmensuche durch und überträgt keine Zugangsdaten an ESOS.

## Installation (Chrome)

1. Chrome öffnen → `chrome://extensions/`
2. **Entwicklermodus** aktivieren (oben rechts)
3. **Entpackte Erweiterung laden** → diesen Ordner auswählen
4. Extension-Icon klicken → Token eingeben

Nach einem Update des lokalen Extension-Ordners auf eine neue Version in `chrome://extensions/` einmal **Neu laden** klicken.

## Dateien

| Datei | Beschreibung |
|---|---|
| `manifest.json` | Chrome Extension Manifest V3 |
| `background.js` | Service Worker — Kommunikation zwischen Popup, Content-Script und API |
| `background-worker.js` | Erweiterter Hintergrund-Worker für tablose Positionsprüfungen |
| `content.js` | LinkedIn-/XING-Automatisierung einschließlich Netzwerk-Projekten und Social Publishing |
| `popup.html` | Popup-UI für Token-Eingabe |
| `popup.js` | Popup-Logik |
| `icon*.png` | Extension-Icons (16px, 48px, 128px) |

## Konfiguration

Die ESOS-URL und der mandantenspezifische Extension-Token werden im Settings-Tab eingetragen. Die feste Extension-ID lautet `mmcadbphcgljgifhgddkbaebkbamlkdm`.

## Netzwerk-Projekte

ESOS erzeugt für jeden Kandidaten einen priorisierten `platform_project_add`-Auftrag. Die Extension verwendet den bekannten LinkedIn- oder XING-Profillink und die bestehende Browser-Sitzung, wählt das vorgegebene vorhandene Projekt aus und meldet Erfolg oder Fehler an ESOS zurück. Diese Aufträge sind von Outreach-Arbeitszeiten und Outreach-Tageslimits unabhängig.

## Benötigte Backend-Endpunkte

- `GET /api/outreach-ext/jobs/queued?limit=1` — nächsten normalen Job abrufen
- `GET /api/outreach-ext/jobs/queued?limit=1&job_type=platform_project_add` — Netzwerk-Projektauftrag abrufen
- `POST /api/outreach-ext/jobs/{job_id}/complete` — Job-Status melden
