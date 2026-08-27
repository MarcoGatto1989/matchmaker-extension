# BA Kandidaten

**BA Kandidaten** ist eine eigenständige Chrome-Manifest-V3-Erweiterung für die Bewerberbörse der Bundesagentur für Arbeit. Sie unterstützt Recruiter beim projektbezogenen Prüfen sichtbarer Bewerberprofile, beim nachvollziehbaren Matching gegen konkrete Recruiting-Mandate und beim Vorbereiten individueller Nachrichten.

## Grundprinzip

BA Kandidaten arbeitet ausschließlich mit BA-Seiten, die der Nutzer selbst im bereits angemeldeten Browser geöffnet hat. Die Erweiterung scrollt nicht automatisch durch Trefferlisten, öffnet keine Profile im Hintergrund, erzeugt keine versteckten Tabs und klickt niemals auf den BA-Senden-Button.

Nicht gespeichert oder exportiert werden BA-Passwörter, Passkeys, Zwei-Faktor-Geheimnisse oder Session-Cookies. In Version 1 gibt es keinen Cloud-Sync und keine ESOS-API-Abhängigkeit.

## Funktionen

- erkennt bereits sichtbare Treffer einer BA-Bewerbersuche;
- liest ein manuell geöffnetes Kandidatenprofil in strukturierte Felder;
- nutzt die BA-Referenznummer als dauerhaften Dublettenschlüssel;
- speichert vollständige Profildaten erst nach Zuordnung zu einem konkreten Recruiting-Projekt;
- verwaltet Projekte lokal im Browser;
- bewertet Kandidaten deterministisch nach Tätigkeit, Kenntnissen, Standort, Erfahrung, Arbeitszeit und Sprache/Mobilität;
- zeigt Score, Datenbasis, positive Gründe, Bedenken und fehlende Informationen;
- erstellt projekt- und kandidatenbezogene Nachrichtenentwürfe ohne externe KI;
- kann den Entwurf nach Nutzeraktion in ein eindeutig sichtbares BA-Nachrichtenfeld einsetzen oder in die Zwischenablage kopieren;
- versendet niemals automatisch;
- verwaltet lokale Status wie übersprungen, projektbezogen gespeichert und kontaktiert;
- unterstützt Aufbewahrungsregeln, Bereinigung, JSON-Backup/-Restore, Projekt-CSV-Import und Reporting-CSV-Export.

## Installation für die Entwicklung

1. Chrome öffnen und `chrome://extensions/` aufrufen.
2. **Entwicklermodus** aktivieren.
3. **Entpackte Erweiterung laden** wählen.
4. Den Ordner `ba-candidate-assistant/` auswählen.
5. Die BA Bewerberbörse in einem normalen Tab öffnen und dort angemeldet arbeiten.

Der Extension-Button öffnet das eigenständige Dashboard. Auf unterstützten BA-Seiten erscheint zusätzlich unten rechts der kompakte Button **BA Kandidaten**.

## Normaler Workflow

1. In der BA Bewerberbörse eine gespeicherte Suche manuell öffnen.
2. Einen Treffer manuell auswählen.
3. BA Kandidaten liest nur das jetzt sichtbare Profil und zeigt die Parsing-Qualität.
4. Ein passendes lokales Recruiting-Projekt auswählen.
5. Projektzuordnung prüfen und speichern.
6. Nachricht vorbereiten und bei Bedarf bearbeiten.
7. In der BA selbst auf **Nachricht schreiben** gehen.
8. Den Text per BA Kandidaten einsetzen oder kopieren.
9. Text kontrollieren und den BA-Versand **selbst** auslösen.
10. Danach den lokalen Kontaktstatus markieren.

## Datenschutz und Aufbewahrung

Standardwerte:

- projektbezogene Kandidatenprofile: 90 Tage nach letzter Projektinteraktion;
- reine `SeenReference`-Einträge ohne Vollprofil: 30 Tage;
- Nachrichtenentwürfe: zusammen mit der Projektzuordnung;
- Projekte: bis zur manuellen Löschung/Archivierung.

Diese Werte sind im Dashboard änderbar. Unter **Einstellungen** können die Daten sofort bereinigt, als JSON exportiert oder vollständig gelöscht werden.

## Matching

Standardgewichtung:

| Dimension | Gewicht |
|---|---:|
| Tätigkeit / Rolle | 25 % |
| Muss-/Wunschkenntnisse | 25 % |
| Standort / Radius | 20 % |
| Berufserfahrung | 15 % |
| Verfügbarkeit / Arbeitszeit | 10 % |
| Sprache / Mobilität | 5 % |

Nicht sichtbare BA-Daten werden nicht als negative Fakten gewertet. Sie reduzieren die Datenbasis/Confidence. Explizite harte Projektanforderungen können bei eindeutig widersprechenden bekannten Daten zu `not_qualified` führen.

## BA-Markup-Änderungen

Die BA-Seite ist eine externe Abhängigkeit. Der Parser arbeitet deshalb über zentrale Adapter und fällt bei fehlenden Feldern auf `unknown` zurück. Bei niedriger Parsing-Konfidenz wird eine dauerhafte Projektzuordnung blockiert, statt Daten zu erraten.

## Tests

```bash
cd ba-candidate-assistant
npm test
npm run check
```

Die Tests decken unter anderem Manifest-Sicherheit, Profil-/Suchparser, Matching, Anti-Halluzinationsregeln im Nachrichtenentwurf, Statusübergänge, Aufbewahrung und Backup-Validierung ab.

## ESOS

BA Kandidaten bleibt technisch eigenständig. ESOS enthält lediglich eine **BA Kandidaten**-Kachel unter **Tools** und einen Launcher-/Infobereich, über den die BA Bewerberbörse geöffnet werden kann. Die Erweiterung benötigt dafür keine ESOS-Anmeldung, keine ESOS-Datenbank und keine ESOS-Host-Permission.
