# BA Kandidaten — freigegebene Spec-Ergänzung

Datum: 2026-08-25

Diese Ergänzung präzisiert die bereits freigegebene Design-Spec `docs/superpowers/specs/2026-08-25-ba-candidate-assistant-design.md`.

1. Der sichtbare Produktname lautet überall **BA Kandidaten**. Der bisherige Arbeitsname „BA Candidate Assistant“ bleibt nur in historischen Branch-/Spec-Bezeichnungen bestehen.
2. Das Chrome-Tool bleibt vollständig **eigenständig installierbar und betreibbar**. Es hat in v1 keine ESOS-API-, Datenbank-, Auth- oder Host-Permission-Abhängigkeit.
3. In ESOS wird **BA Kandidaten** als eigene Kachel in der bestehenden Tools-Übersicht angezeigt.
4. Die ESOS-Kachel führt zu `/tools/ba-kandidaten`. Diese Seite ist ausschließlich Launcher und Erklärung: Sie öffnet die BA Bewerberbörse und beschreibt Installation/Arbeitsweise des eigenständigen Browser-Tools. Sie überträgt keine Kandidatendaten zwischen ESOS und der Erweiterung.
5. Kein Merge gehört zum Auftrag. Extension- und ESOS-Änderungen bleiben auf isolierten Feature-Branches, bis der Nutzer einen Merge ausdrücklich freigibt.
