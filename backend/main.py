"""
MatchMaker BOOT Outreach — Backend API v2
Connects to Base44 as the data layer (no local database).
"""
import os
import json
import urllib.parse
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

# ── Config ──────────────────────────────────────────────────────────────

BASE44_URL = os.environ.get("BASE44_URL", "https://match-boot-flow.base44.app/api")
BASE44_API_KEY = os.environ.get("BASE44_API_KEY", "")
PORT = int(os.environ.get("PORT", "8080"))

# ── Base44 HTTP Client ──────────────────────────────────────────────────

def base44_headers():
    return {"api_key": BASE44_API_KEY, "Content-Type": "application/json"}


async def base44_get(path: str, params: dict | None = None) -> dict | list:
    """GET request to Base44 API."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{BASE44_URL}{path}",
            headers=base44_headers(),
            params=params,
        )
        r.raise_for_status()
        return r.json()


async def base44_post(path: str, body: dict) -> dict:
    """POST request to Base44 API."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{BASE44_URL}{path}",
            headers=base44_headers(),
            json=body,
        )
        r.raise_for_status()
        return r.json()


async def base44_put(path: str, body: dict) -> dict:
    """PUT request to Base44 API."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.put(
            f"{BASE44_URL}{path}",
            headers=base44_headers(),
            json=body,
        )
        r.raise_for_status()
        return r.json()


async def base44_delete(path: str) -> dict:
    """DELETE a single record from Base44 API."""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.delete(
            f"{BASE44_URL}{path}",
            headers=base44_headers(),
        )
        r.raise_for_status()
        return r.json()


# ── FastAPI App ─────────────────────────────────────────────────────────

app = FastAPI(
    title="MatchMaker BOOT Outreach API",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth ────────────────────────────────────────────────────────────────

async def verify_extension(authorization: str = Header(...)):
    """Verify the extension token against Base44 AutomationSettings."""
    token = authorization.replace("Bearer ", "")
    try:
        settings = await base44_get("/entities/AutomationSettings", {"limit": "1"})
        if settings and settings[0].get("extension_token") == token:
            return token
    except Exception:
        pass
    raise HTTPException(status_code=401, detail="Invalid extension token")


# ── Schemas ─────────────────────────────────────────────────────────────

class JobComplete(BaseModel):
    status: str  # "completed" or "failed"
    error: Optional[str] = None


class ConfigResponse(BaseModel):
    daily_limit: int
    min_delay_seconds: int
    max_delay_seconds: int
    active_hours_start: str
    active_hours_end: str
    weekdays_only: bool


# ── Health ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "matchmaker-boot-outreach", "version": "2.0.0"}


# ── Extension Endpoints (called by Chrome Extension) ────────────────────

@app.get("/api/extension/jobs/queued")
async def get_queued_jobs(
    limit: int = Query(default=1, ge=1, le=10),
    _token: str = Depends(verify_extension),
):
    """Fetch the next queued ExtensionJobs from Base44, sorted by priority desc."""
    q = json.dumps({"status": "queued"})
    jobs = await base44_get(
        "/entities/ExtensionJob",
        {"q": q, "limit": str(limit), "sort_by": "-priority"},
    )

    # Mark fetched jobs as in_progress
    for job in jobs:
        try:
            await base44_put(
                f"/entities/ExtensionJob/{job['id']}",
                {"status": "in_progress"},
            )
            job["status"] = "in_progress"
        except Exception:
            pass  # best effort

    return jobs


@app.post("/api/extension/jobs/{job_id}/complete")
async def complete_job(
    job_id: str,
    body: JobComplete,
    _token: str = Depends(verify_extension),
):
    """Mark an ExtensionJob as completed or failed and update candidate status."""
    now = datetime.now(timezone.utc).isoformat()

    # Update the ExtensionJob
    update_data = {"status": body.status}
    if body.status == "completed":
        update_data["completed_date"] = now
    if body.error:
        update_data["error_message"] = body.error

    updated_job = await base44_put(f"/entities/ExtensionJob/{job_id}", update_data)

    # Update the Candidate status too
    candidate_id = updated_job.get("candidate_id")
    if candidate_id and body.status == "completed":
        try:
            await base44_put(
                f"/entities/Candidate/{candidate_id}",
                {"status": "Kontaktiert", "last_contact_date": now},
            )
        except Exception:
            pass  # best effort

    # Also create a ContactRequest record
    if body.status == "completed":
        try:
            await base44_post("/entities/ContactRequest", {
                "candidate_id": updated_job.get("candidate_id", ""),
                "candidate_name": updated_job.get("candidate_name", ""),
                "candidate_linkedin_url": updated_job.get("linkedin_url", ""),
                "project_id": updated_job.get("project_id", ""),
                "request_text": updated_job.get("text_content", ""),
                "status": "sent",
                "sent_date": now,
                "sequence_position": 1,
            })
        except Exception:
            pass

    # Log Activity
    try:
        await base44_post("/entities/Activity", {
            "type": "contact_request_sent" if body.status == "completed" else "status_change",
            "description": (
                f"Kontaktanfrage an {updated_job.get('candidate_name', 'Unbekannt')} gesendet"
                if body.status == "completed"
                else f"Job fehlgeschlagen: {body.error or 'Unbekannter Fehler'}"
            ),
            "candidate_id": candidate_id or "",
            "project_id": updated_job.get("project_id", ""),
        })
    except Exception:
        pass

    return updated_job


@app.get("/api/extension/config")
async def get_config(
    _token: str = Depends(verify_extension),
):
    """Return extension configuration from Base44."""
    configs = await base44_get("/entities/ExtensionConfig", {"limit": "1"})
    if not configs:
        return ConfigResponse(
            daily_limit=25,
            min_delay_seconds=45,
            max_delay_seconds=120,
            active_hours_start="09:00",
            active_hours_end="17:00",
            weekdays_only=True,
        )
    c = configs[0]
    return {
        "daily_limit": int(c.get("daily_limit", 25)),
        "min_delay_seconds": int(c.get("min_delay_seconds", 45)),
        "max_delay_seconds": int(c.get("max_delay_seconds", 120)),
        "active_hours_start": c.get("active_hours_start", "09:00"),
        "active_hours_end": c.get("active_hours_end", "17:00"),
        "weekdays_only": c.get("weekdays_only", True),
    }


@app.post("/api/extension/heartbeat")
async def heartbeat(
    _token: str = Depends(verify_extension),
):
    """Extension calls this to signal it's alive; updates ExtensionConfig."""
    now = datetime.now(timezone.utc).isoformat()
    configs = await base44_get("/entities/ExtensionConfig", {"limit": "1"})
    if configs:
        try:
            await base44_put(
                f"/entities/ExtensionConfig/{configs[0]['id']}",
                {"extension_connected": True, "last_connection_date": now},
            )
        except Exception:
            pass
    # Also update AutomationSettings
    settings = await base44_get("/entities/AutomationSettings", {"limit": "1"})
    if settings:
        try:
            await base44_put(
                f"/entities/AutomationSettings/{settings[0]['id']}",
                {"extension_connected": True},
            )
        except Exception:
            pass
    return {"status": "ok", "timestamp": now}


@app.get("/api/extension/stats")
async def get_stats(
    _token: str = Depends(verify_extension),
):
    """Return job queue statistics."""
    all_jobs = await base44_get("/entities/ExtensionJob", {"limit": "200"})
    counts = {}
    for j in all_jobs:
        s = j.get("status", "unknown")
        counts[s] = counts.get(s, 0) + 1
    return {
        "queued": counts.get("queued", 0),
        "in_progress": counts.get("in_progress", 0),
        "completed": counts.get("completed", 0),
        "failed": counts.get("failed", 0),
        "skipped": counts.get("skipped", 0),
        "total": sum(counts.values()),
    }


# ── Admin Endpoints (for convenience / debugging) ──────────────────────

@app.get("/api/admin/jobs")
async def list_jobs(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
):
    """List jobs from Base44 (no auth for dashboard access)."""
    params = {"limit": str(limit), "skip": str(skip), "sort_by": "-created_date"}
    if status:
        params["q"] = json.dumps({"status": status})
    return await base44_get("/entities/ExtensionJob", params)


@app.get("/api/admin/candidates")
async def list_candidates(
    project_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
):
    """List candidates from Base44."""
    params = {"limit": str(limit), "sort_by": "-matching_score"}
    if project_id:
        params["q"] = json.dumps({"project_id": project_id})
    return await base44_get("/entities/Candidate", params)


@app.get("/api/admin/projects")
async def list_projects():
    """List projects from Base44."""
    return await base44_get("/entities/Project")


@app.get("/api/admin/stats")
async def admin_stats():
    """Admin stats — same as extension stats but no auth."""
    all_jobs = await base44_get("/entities/ExtensionJob", {"limit": "200"})
    counts = {}
    for j in all_jobs:
        s = j.get("status", "unknown")
        counts[s] = counts.get(s, 0) + 1
    return {
        "queued": counts.get("queued", 0),
        "in_progress": counts.get("in_progress", 0),
        "completed": counts.get("completed", 0),
        "failed": counts.get("failed", 0),
        "skipped": counts.get("skipped", 0),
        "total": sum(counts.values()),
    }
