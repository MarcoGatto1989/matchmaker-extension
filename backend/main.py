"""
MatchMaker BOOT Outreach — Backend API
Manages the job queue for the Chrome Extension.
"""
import os
import uuid
import secrets
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Text, DateTime, Integer, select, update


# ── Config ──────────────────────────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL", "")
# Railway uses postgresql:// but asyncpg needs postgresql+asyncpg://
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Admin token for creating jobs; Extension token for fetching/completing
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
EXTENSION_TOKEN = os.environ.get("EXTENSION_TOKEN", "")

PORT = int(os.environ.get("PORT", "8080"))


# ── Database Models ─────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "outreach_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    linkedin_url: Mapped[str] = mapped_column(Text, nullable=False)
    text_content: Mapped[str] = mapped_column(Text, nullable=False)
    candidate_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="queued")  # queued, in_progress, completed, failed
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                                                   onupdate=lambda: datetime.now(timezone.utc))
    priority: Mapped[int] = mapped_column(Integer, default=0)


class ExtensionToken(Base):
    __tablename__ = "extension_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False, default="default")
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


# ── Engine & Session ────────────────────────────────────────────────────

engine = create_async_engine(DATABASE_URL, echo=False) if DATABASE_URL else None
async_session = async_sessionmaker(engine, expire_on_commit=False) if engine else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    if engine:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        # Ensure default extension token exists
        async with async_session() as session:
            result = await session.execute(
                select(ExtensionToken).where(ExtensionToken.token == EXTENSION_TOKEN)
            )
            if not result.scalar_one_or_none() and EXTENSION_TOKEN:
                session.add(ExtensionToken(token=EXTENSION_TOKEN, label="default"))
                await session.commit()
    yield
    if engine:
        await engine.dispose()


# ── FastAPI App ─────────────────────────────────────────────────────────

app = FastAPI(
    title="MatchMaker BOOT Outreach API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth Dependencies ──────────────────────────────────────────────────

async def verify_admin(authorization: str = Header(...)):
    token = authorization.replace("Bearer ", "")
    if not ADMIN_TOKEN or token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid admin token")
    return token


async def verify_extension(authorization: str = Header(...)):
    token = authorization.replace("Bearer ", "")
    if not async_session:
        raise HTTPException(status_code=500, detail="Database not configured")
    async with async_session() as session:
        result = await session.execute(
            select(ExtensionToken).where(
                ExtensionToken.token == token,
                ExtensionToken.is_active == True
            )
        )
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=401, detail="Invalid extension token")
    return token


async def get_db():
    if not async_session:
        raise HTTPException(status_code=500, detail="Database not configured")
    async with async_session() as session:
        yield session


# ── Schemas ─────────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    linkedin_url: str
    text_content: str
    candidate_name: Optional[str] = None
    priority: int = 0


class JobBulkCreate(BaseModel):
    jobs: list[JobCreate]


class JobComplete(BaseModel):
    status: str  # "completed" or "failed"
    error: Optional[str] = None


class JobResponse(BaseModel):
    id: str
    linkedin_url: str
    text_content: str
    candidate_name: Optional[str]
    status: str
    error_message: Optional[str]
    created_at: datetime
    updated_at: datetime
    priority: int


class TokenCreate(BaseModel):
    label: str = "default"


class TokenResponse(BaseModel):
    id: str
    token: str
    label: str
    is_active: bool
    created_at: datetime


class StatsResponse(BaseModel):
    queued: int
    in_progress: int
    completed: int
    failed: int
    total: int


# ── Health ──────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "matchmaker-boot-outreach"}


# ── Extension Endpoints ────────────────────────────────────────────────

@app.get("/api/extension/jobs/queued", response_model=list[JobResponse])
async def get_queued_jobs(
    limit: int = Query(default=1, ge=1, le=10),
    _token: str = Depends(verify_extension),
    db: AsyncSession = Depends(get_db),
):
    """Fetch the next queued jobs for the extension to process."""
    result = await db.execute(
        select(Job)
        .where(Job.status == "queued")
        .order_by(Job.priority.desc(), Job.created_at.asc())
        .limit(limit)
    )
    jobs = result.scalars().all()

    # Mark fetched jobs as in_progress
    for job in jobs:
        job.status = "in_progress"
        job.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return jobs


@app.post("/api/extension/jobs/{job_id}/complete", response_model=JobResponse)
async def complete_job(
    job_id: str,
    body: JobComplete,
    _token: str = Depends(verify_extension),
    db: AsyncSession = Depends(get_db),
):
    """Mark a job as completed or failed."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job.status = body.status
    job.error_message = body.error
    job.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    return job


# ── Admin Endpoints ────────────────────────────────────────────────────

@app.post("/api/admin/jobs", response_model=JobResponse)
async def create_job(
    body: JobCreate,
    _token: str = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a single outreach job."""
    job = Job(
        linkedin_url=body.linkedin_url,
        text_content=body.text_content,
        candidate_name=body.candidate_name,
        priority=body.priority,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


@app.post("/api/admin/jobs/bulk", response_model=list[JobResponse])
async def create_jobs_bulk(
    body: JobBulkCreate,
    _token: str = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create multiple outreach jobs at once."""
    jobs = []
    for j in body.jobs:
        job = Job(
            linkedin_url=j.linkedin_url,
            text_content=j.text_content,
            candidate_name=j.candidate_name,
            priority=j.priority,
        )
        db.add(job)
        jobs.append(job)
    await db.commit()
    for job in jobs:
        await db.refresh(job)
    return jobs


@app.get("/api/admin/jobs", response_model=list[JobResponse])
async def list_jobs(
    status: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _token: str = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all jobs with optional status filter."""
    query = select(Job).order_by(Job.created_at.desc()).limit(limit).offset(offset)
    if status:
        query = query.where(Job.status == status)
    result = await db.execute(query)
    return result.scalars().all()


@app.get("/api/admin/stats", response_model=StatsResponse)
async def get_stats(
    _token: str = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get job queue statistics."""
    from sqlalchemy import func
    result = await db.execute(
        select(Job.status, func.count(Job.id)).group_by(Job.status)
    )
    counts = {row[0]: row[1] for row in result.all()}
    return StatsResponse(
        queued=counts.get("queued", 0),
        in_progress=counts.get("in_progress", 0),
        completed=counts.get("completed", 0),
        failed=counts.get("failed", 0),
        total=sum(counts.values()),
    )


@app.delete("/api/admin/jobs/{job_id}")
async def delete_job(
    job_id: str,
    _token: str = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a job."""
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await db.delete(job)
    await db.commit()
    return {"deleted": True}


@app.post("/api/admin/jobs/reset-failed", response_model=dict)
async def reset_failed_jobs(
    _token: str = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reset all failed jobs back to queued."""
    result = await db.execute(
        update(Job)
        .where(Job.status == "failed")
        .values(status="queued", error_message=None, updated_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return {"reset_count": result.rowcount}


# ── Token Management (Admin) ──────────────────────────────────────────

@app.post("/api/admin/tokens", response_model=TokenResponse)
async def create_token(
    body: TokenCreate,
    _token: str = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new extension token."""
    new_token = ExtensionToken(
        token=secrets.token_urlsafe(32),
        label=body.label,
    )
    db.add(new_token)
    await db.commit()
    await db.refresh(new_token)
    return new_token


@app.get("/api/admin/tokens", response_model=list[TokenResponse])
async def list_tokens(
    _token: str = Depends(verify_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all extension tokens."""
    result = await db.execute(select(ExtensionToken).order_by(ExtensionToken.created_at.desc()))
    return result.scalars().all()
