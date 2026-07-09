# MatchMaker BOOT Outreach — Backend API

Backend für die MatchMaker BOOT Outreach Chrome Extension. Verwaltet die Job-Queue für LinkedIn-Kontaktanfragen.

## Endpunkte

### Extension (Token-Auth)
| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| GET | `/api/extension/jobs/queued?limit=1` | Nächste Jobs abrufen |
| POST | `/api/extension/jobs/{id}/complete` | Job abschließen |

### Admin (Admin-Token)
| Methode | Pfad | Beschreibung |
|---------|------|--------------|
| POST | `/api/admin/jobs` | Einzelnen Job erstellen |
| POST | `/api/admin/jobs/bulk` | Mehrere Jobs erstellen |
| GET | `/api/admin/jobs?status=queued` | Jobs auflisten |
| GET | `/api/admin/stats` | Statistiken |
| DELETE | `/api/admin/jobs/{id}` | Job löschen |
| POST | `/api/admin/jobs/reset-failed` | Fehlgeschlagene zurücksetzen |
| POST | `/api/admin/tokens` | Neuen Extension-Token erstellen |
| GET | `/api/admin/tokens` | Tokens auflisten |

## Umgebungsvariablen

| Variable | Beschreibung |
|----------|--------------|
| `DATABASE_URL` | PostgreSQL-Connection-String |
| `ADMIN_TOKEN` | Token für Admin-Endpunkte |
| `EXTENSION_TOKEN` | Standard-Token für die Chrome Extension |
| `PORT` | Server-Port (default: 8080) |

## Job erstellen (Beispiel)

```bash
curl -X POST https://your-domain.up.railway.app/api/admin/jobs \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "linkedin_url": "https://www.linkedin.com/in/example",
    "text_content": "Hallo, ich bin Marco von MatchMaker..."
  }'
```
