# BA Candidate Assistant — Design Specification

Date: 2026-08-25  
Status: Proposed for implementation  
Tracking: #33, #34  
Branch: `feature/ba-candidate-assistant`

## 1. Purpose

Build a completely standalone Chrome Manifest V3 extension for the Bundesagentur für Arbeit (BA) Bewerberbörse. The tool must not depend on ESOS, its database, its authentication, or its API. It assists a recruiter while they are already signed in to the BA website and working in the Bewerberbörse.

The extension turns the currently visible BA search/profile workflow into a structured review workflow: detect visible candidates, extract structured profile information, deduplicate via BA reference number, compare a candidate with locally managed recruiting projects, explain the match score, prepare a project-specific message, and track the local review/contact state.

The extension is independently installable and lives under its own top-level directory. It may later integrate with ESOS through a deliberately narrow adapter interface, but v1 performs no ESOS network calls.

## 2. Non-goals and hard constraints

The extension must not:

- log in to the BA website or store BA usernames, passwords, passkeys, second-factor secrets, or authentication tokens;
- export or copy BA session cookies;
- crawl the Bewerberbörse autonomously;
- create hidden tabs/windows to enumerate profiles;
- programmatically click through search results to collect profiles;
- send messages automatically;
- maintain a general, indefinite applicant pool unrelated to a concrete recruiting project;
- require a server, cloud database, or external AI provider in v1.

The content script reacts only to pages the user has opened and to DOM content already rendered in the active BA tab. User actions remain the trigger for opening profiles, opening the BA message composer, and sending a message.

## 3. Product experience

### 3.1 BA-page assistant

On supported BA Bewerberbörse pages the extension injects one compact floating control labelled `BA Candidate Assistant`. Opening it reveals a right-hand assistant panel without navigating away from the BA website.

On a search-results page the panel shows:

- number of currently visible result cards;
- how many references are new, previously seen, contacted, or skipped;
- project quick-filter;
- a compact list of visible candidates with local review state when a stable reference can be determined;
- parser diagnostics only behind an advanced/debug toggle.

The extension never scrolls the BA page automatically to force additional results to load. It only processes what is already rendered.

On an opened candidate profile/drawer the panel shows:

- candidate summary extracted from the visible page;
- BA reference number and publication date when present;
- desired roles;
- location and radius;
- availability and working-time preference;
- experience timeline summary;
- education;
- skills/knowledge;
- languages;
- mobility;
- parse confidence and missing fields;
- ranked project matches with score and explanation;
- actions: `Projekt zuordnen`, `Nachricht vorbereiten`, `Überspringen`, `Als kontaktiert markieren`, `Notiz`.

### 3.2 Standalone dashboard

Clicking the extension action opens a full extension dashboard with five primary areas:

1. **Heute** — daily counters and recently reviewed references.
2. **Kandidaten** — only candidates that have been associated with a concrete project, plus a minimal deduplication history for other seen references.
3. **Projekte** — create/edit/archive project profiles and matching requirements.
4. **Nachrichten** — prepared and sent-status message history; the BA remains the actual sending channel.
5. **Einstellungen** — retention, matching weights, import/export, privacy controls, parser diagnostics.

The UI should be visually independent of the existing ESOS extension: clean recruiter dashboard, large readable scores, clear status chips, no technical clutter in the default view.

## 4. Architecture

The standalone implementation lives in:

`ba-candidate-assistant/`

Suggested structure:

```text
ba-candidate-assistant/
  manifest.json
  package.json
  src/
    background/
      service-worker.js
    content/
      bootstrap.js
      assistant-panel.js
      page-observer.js
    adapters/
      ba-page-router.js
      ba-search-adapter.js
      ba-profile-adapter.js
      selectors.js
      normalizers.js
    domain/
      candidate.js
      project.js
      match-engine.js
      message-composer.js
      lifecycle.js
    storage/
      db.js
      repositories.js
      retention.js
    dashboard/
      index.html
      dashboard.js
      dashboard.css
    shared/
      events.js
      ids.js
      text.js
  test/
    fixtures/
    *.test.mjs
  README.md
```

### 4.1 Manifest and permissions

Manifest V3. Host access is limited to BA web properties required by the visible workflow, specifically the `arbeitsagentur.de` and `web.arbeitsagentur.de` origins used by the Bewerberbörse/profile pages.

Required Chrome permissions should remain minimal: `storage` and `activeTab` if needed. No `cookies`, no broad `tabs`, no `webRequest`, and no background navigation permissions unless implementation proves one is strictly necessary. The dashboard is an extension page; content scripts are scoped only to supported BA paths.

### 4.2 Content script

The content script owns only page observation and UI injection. It uses a `MutationObserver` to detect when the user opens/closes a profile drawer or when already-visible search results change.

It must not contain persistence or scoring logic. It sends normalized page snapshots to the service worker/domain layer and receives a view model for display.

### 4.3 BA page adapters

BA markup is an external dependency and may change. Parsing therefore uses an adapter boundary instead of spreading DOM selectors throughout the product.

The adapters follow a layered strategy:

1. stable semantic attributes when available (`aria-*`, labels, accessible roles, test/data attributes if present);
2. section heading + nearby value relationships;
3. normalized visible text patterns as a fallback;
4. explicit `unknown` rather than guessing.

Every parsed snapshot includes:

- adapter version;
- parse confidence;
- list of fields that were not found;
- source page type (`search` or `profile`).

Selectors are centralized so a BA markup change can be repaired in one domain.

## 5. Local data model

### 5.1 Project

A project represents a concrete recruiting mandate. Fields:

- id;
- name;
- client/company display name (optional);
- status (`active`, `paused`, `archived`);
- target roles;
- must-have skills;
- preferred skills;
- minimum experience;
- target locations;
- maximum acceptable commute/radius;
- allowed work-time models;
- earliest/latest availability rules;
- language requirements;
- free-text recruiter notes;
- matching weight overrides;
- outreach template settings.

### 5.2 CandidateSnapshot

A full candidate snapshot may be persisted only when the recruiter associates the candidate with a concrete project. It contains the normalized visible profile fields plus BA reference number, timestamps and parser metadata.

The BA reference number is the primary external deduplication key. If it is unavailable, the extension may use an ephemeral page-local fingerprint for the current session but must not treat it as a durable identity.

### 5.3 SeenReference

To avoid repeatedly presenting the same person as new without building a general applicant database, the extension stores a minimal deduplication record for non-project-bound candidates:

- BA reference number;
- first seen / last seen;
- outcome (`unreviewed`, `skipped`, `not_relevant`, `contacted_elsewhere`);
- optional short reason code;
- no full CV/profile snapshot.

### 5.4 CandidateProjectLink

Stores project-bound workflow state:

- candidate reference;
- project id;
- match result;
- recruiter decision;
- contact state;
- notes;
- created/updated timestamps.

### 5.5 MessageDraft

Stores prepared message text, project id, candidate reference, created timestamp and local status (`draft`, `copied_to_ba`, `marked_sent`, `discarded`). `marked_sent` is a recruiter-confirmed local state; v1 does not claim to observe a successful BA send transaction unless the visible BA page gives a reliable confirmation after the user's send action.

## 6. Storage and retention

Use IndexedDB for structured local data; use `chrome.storage.local` only for small settings/preferences.

Defaults:

- full project-bound candidate snapshots: retain 90 days after the last project interaction, configurable by the user;
- minimal `SeenReference` entries: retain 30 days by default;
- message drafts: retain with the project-bound record until retention cleanup;
- archived projects remain local until manually deleted, but expired candidate records are still purged according to retention rules.

The dashboard provides `Jetzt bereinigen`, per-project deletion, full local-data deletion, JSON backup, JSON restore, project CSV import, and reporting CSV export.

No background sync and no cloud upload in v1.

## 7. Matching engine

The local matching engine must be deterministic, explainable and testable.

Default weighted dimensions:

- target role/title alignment: 25%;
- must-have/preferred skills: 25%;
- location/radius: 20%;
- relevant experience: 15%;
- availability/work-time model: 10%;
- languages/mobility: 5%.

Hard requirements can cap or reject a match. Example: if a project marks a required qualification as mandatory and it is clearly absent, the result is `not qualified` even if other weighted dimensions score highly.

The result shape contains:

- score 0–100;
- classification (`strong`, `good`, `possible`, `weak`, `not_qualified`);
- positive reasons;
- concerns;
- unknown/missing evidence;
- per-dimension scores.

Unknown BA data must not be treated as a negative fact. It lowers confidence, not necessarily candidate quality.

## 8. Message composer

V1 uses a local template composer rather than an external LLM. The message is project-specific and candidate-specific using only facts visible in the BA profile and fields explicitly entered in the project.

The composer must never invent qualifications, salary, client facts, remote-work policies or availability.

Workflow:

1. recruiter selects a project;
2. extension prepares a concise message draft;
3. recruiter can edit it in the assistant panel;
4. recruiter clicks `In BA-Nachricht übernehmen`;
5. if the BA message composer is visibly open and a supported editable field is detected, the extension inserts the text into that field;
6. the recruiter reviews and presses the BA send button themselves.

The extension must not programmatically trigger the send action.

## 9. Workflow states

Candidate review states:

`new` → `reviewed` → `project_linked` → `message_prepared` → `contacted`

Alternative terminal/review states:

- `skipped`;
- `not_relevant`;
- `archived`.

State transitions are explicit user actions except `new`/`reviewed`, which may be derived from visible parsing and opening the assistant.

## 10. Future ESOS integration boundary

Define interfaces but ship no active integration:

```text
ProjectProvider
  listProjects()
  getProject(id)

CandidateSink
  pushProjectCandidate(candidate, projectLink)

MessageProvider
  draft(candidate, project)
```

V1 implementations are local-only. A future ESOS adapter can implement these interfaces without changing BA DOM parsing or the core matching workflow.

No ESOS host permission is present in the v1 manifest.

## 11. Failure handling

The product fails closed:

- if a candidate reference cannot be found, show `Referenz nicht erkannt` and do not persist a full candidate snapshot;
- if parser confidence is low, show which sections could not be read and require recruiter confirmation before project association;
- if the BA message field cannot be confidently identified, offer `Text kopieren` instead of injecting into an uncertain element;
- if IndexedDB is unavailable/corrupt, show a blocking local-storage error and export/recovery guidance;
- if BA markup changes significantly, the assistant remains visible but reports parser degradation rather than silently writing incorrect data.

## 12. Testing strategy

Use Node's built-in `node:test` + `node:assert/strict` and browser-independent DOM fixtures wherever possible.

Required coverage:

- role/title normalization;
- reference-number parsing;
- location/radius parsing;
- timeline normalization;
- skill/language normalization;
- match scoring including hard requirements and unknown fields;
- message composition with anti-hallucination assertions;
- lifecycle state transitions;
- retention cleanup;
- import/export round trips;
- parser fixtures based on sanitized representations of the supplied BA screenshots/pages;
- manifest contract test proving no cookie permission, no automatic background navigation capability, and only BA host permissions;
- contract test proving no code path invokes a BA send button;
- adapter degradation test for missing/renamed sections.

Manual acceptance test in Chrome:

1. load the standalone unpacked extension;
2. open an existing BA Bewerberbörse search while already logged in;
3. verify the assistant detects only currently rendered results;
4. open a profile manually;
5. verify structured fields against the visible BA profile;
6. create a concrete project and verify ranking/explanation;
7. associate the profile with the project;
8. prepare a message;
9. open `Nachricht schreiben` manually and verify text insertion/copy fallback;
10. send only by manual BA action;
11. mark local contact state;
12. reload and verify deduplication/history;
13. verify retention/export/delete controls.

## 13. Acceptance criteria

Implementation is complete when:

- the tool installs independently of the existing ESOS AI extension;
- supported BA pages receive a stable assistant UI without breaking BA page behavior;
- a visible candidate profile is parsed into a normalized snapshot with confidence information;
- durable deduplication works via BA reference number;
- full candidate data is stored only after association with a concrete project;
- local project CRUD and import/export work;
- explainable matching produces reproducible scores;
- a recruiter can prepare/edit/copy or insert a message but the extension never sends it;
- local statuses survive browser restarts;
- retention cleanup works;
- no BA credentials/cookies are stored or exported;
- no autonomous browsing/crawling exists;
- tests pass;
- README contains installation, workflow, privacy, troubleshooting and data-deletion instructions;
- all work remains on `feature/ba-candidate-assistant` and is not merged until the user explicitly asks for a merge.

## 14. Implementation sequencing

After approval of this specification, implementation should proceed in slices:

1. isolated extension shell + manifest safety contract;
2. domain model + IndexedDB repositories + tests;
3. sanitized BA profile/search adapters + tests;
4. matching engine + project management;
5. assistant panel + dashboard;
6. message composer + safe BA field insertion/copy fallback;
7. retention/import/export;
8. full regression, manual fixture verification, documentation, and final branch/PR readiness review.

No merge is part of this scope.