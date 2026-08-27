# BA Kandidaten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the independently installable Chrome MV3 tool **BA Kandidaten**, verify its safe project-bound BA workflow, and add a separate ESOS Tools launcher without merging either branch.

**Architecture:** The Chrome tool lives under `ba-candidate-assistant/` and reads only DOM content already rendered in user-opened BA pages. Page adapters normalize visible BA data, the background service worker owns local IndexedDB persistence and deterministic domain logic, and the extension dashboard owns project/settings/reporting UI. ESOS only gets a launcher page and ToolsOverview entry; there is no runtime integration between ESOS and the extension.

**Tech Stack:** Chrome Manifest V3, plain JavaScript/HTML/CSS, IndexedDB, `chrome.storage`, Node `node:test`/`node:assert`, React/Vite for the existing ESOS launcher page.

**Spec:** `docs/superpowers/specs/2026-08-25-ba-candidate-assistant-design.md` plus `ba-candidate-assistant/docs/2026-08-25-ba-kandidaten-spec-amendment.md`

## Global Constraints

- Visible product name is exactly `BA Kandidaten`.
- No BA credentials, passkeys, 2FA secrets, auth tokens, or session cookies are stored or exported.
- No autonomous crawling, hidden-tab navigation, automatic scrolling for collection, programmatic result opening, or automatic message sending.
- Full candidate snapshots are persisted only after association with a concrete recruiting project.
- Unknown BA fields reduce confidence; they are not invented or automatically treated as negative facts.
- No ESOS host permission or ESOS runtime dependency exists in the v1 Chrome manifest.
- ESOS exposes only a launcher/info route `/tools/ba-kandidaten` and Tools tile.
- Work stays on `feature/ba-candidate-assistant` and `feature/477-ba-kandidaten-tool`; no merge.

---

### Task 1: Standalone extension shell and safety contract

**Files:**
- Create: `ba-candidate-assistant/manifest.json`
- Create: `ba-candidate-assistant/package.json`
- Test: `ba-candidate-assistant/test/manifest-safety.test.mjs`

**Interfaces:**
- Produces Chrome content-script injection only for BA hosts and ESM service-worker entry `src/background/service-worker.js`.

- [ ] Write a manifest contract asserting the name is `BA Kandidaten`, permissions equal `['storage']`, host permissions only contain `arbeitsagentur.de`, and content scripts contain no programmatic `.click()` path.
- [ ] Run `node --test test/manifest-safety.test.mjs` and confirm RED before the manifest/shell exists.
- [ ] Create the MV3 manifest with only `storage`, explicit BA hosts, an action handler, and BA-scoped content scripts.
- [ ] Run the contract again and confirm PASS.
- [ ] Commit with an issue reference.

### Task 2: Pure candidate/project domain and deterministic matching

**Files:**
- Create: `src/shared/text.js`, `src/shared/ids.js`
- Create: `src/domain/candidate.js`, `src/domain/project.js`, `src/domain/match-engine.js`, `src/domain/lifecycle.js`
- Test: `test/match-engine.test.mjs`, `test/lifecycle-retention-backup.test.mjs`

**Interfaces:**
- Produces `normalizeCandidateSnapshot(input)`, `normalizeProject(input)`, `matchCandidateToProject(candidate, project)`, `rankProjects(candidate, projects)`, `transitionState(from,to)`.

- [ ] Add RED tests for role/skill/location scoring, unknown-data confidence, hard experience failure, project ranking and invalid lifecycle jumps.
- [ ] Implement normalized domain types and default weights `25/25/20/15/10/5`.
- [ ] Calculate score only across known dimensions and return `score`, `confidence`, `classification`, reasons, concerns, unknown evidence, hard failures and dimension details.
- [ ] Run focused tests, then the full suite.
- [ ] Commit with an issue reference.

### Task 3: BA adapters that fail closed

**Files:**
- Create: `src/adapters/normalizers-global.js`, `ba-profile-adapter-global.js`, `ba-search-adapter-global.js`
- Create: `test/fixtures/profile-visible.txt`
- Test: `test/profile-adapter.test.mjs`, `test/search-adapter.test.mjs`

**Interfaces:**
- Produces `BAKandidaten.profileAdapter.parseVisibleProfile(document)` and `BAKandidaten.searchAdapter.extractVisibleSearchCards(document)`.

- [ ] Write RED parser tests using sanitized visible text from the supplied BA profile screenshots.
- [ ] Parse BA reference, roles, postal code/location/radius, availability, work-time, experience, education, skills, languages, competencies and mobility without guessing missing values.
- [ ] Add adapter metadata, missing fields and confidence.
- [ ] Search parsing must inspect only currently rendered/visible candidate-like DOM nodes and never scroll or click.
- [ ] Run parser/degradation tests and commit.

### Task 4: Local project-bound persistence, retention, backup and message composition

**Files:**
- Create: `src/storage/db.js`, `repositories.js`, `retention.js`, `cleanup.js`, `backup.js`
- Create: `src/domain/message-composer.js`
- Test: `test/lifecycle-retention-backup.test.mjs`, `test/message-composer.test.mjs`

**Interfaces:**
- Produces IndexedDB repositories for projects/candidates/seenReferences/links/drafts/settings, `runRetentionCleanup()`, `makeBackup()/parseBackup()`, and `composeMessage(candidate, project)`.

- [ ] Add tests proving 90/30-day retention behavior and versioned backup validation.
- [ ] Add anti-hallucination message tests proving undisclosed client names, salary and remote-work claims are not invented.
- [ ] Implement local stores and minimal SeenReference records.
- [ ] Implement message composition from visible candidate/project facts only.
- [ ] Run full unit suite and commit.

### Task 5: Service-worker orchestration and BA assistant panel

**Files:**
- Create: `src/background/service-worker.js`
- Create: `src/content/assistant-panel.js`, `assistant-panel.css`, `bootstrap.js`

**Interfaces:**
- Consumes domain/storage APIs from Tasks 2–4.
- Produces message types `BAK_GET_PROFILE_VIEW`, `BAK_ASSOCIATE`, `BAK_CREATE_DRAFT`, `BAK_UPDATE_DRAFT`, `BAK_MARK_CONTACTED`, project/settings/import/export actions.

- [ ] Route all persistence/matching through the service worker; content scripts only parse visible pages and render UI.
- [ ] Persist full candidate snapshots only inside `BAK_ASSOCIATE`, rejecting missing BA reference or low parser confidence.
- [ ] Render search summary and opened-profile match ranking in a fixed assistant panel.
- [ ] Implement user-triggered project association, skip/contact status and editable message drafts.
- [ ] Insert draft text only into an already visible editable field after the recruiter clicks the BA-Kandidaten button; never synthesize BA send/click/submit actions.
- [ ] Run manifest safety contract and syntax checks.

### Task 6: Standalone dashboard and import/export controls

**Files:**
- Create: `src/dashboard/index.html`, `dashboard.css`, `dashboard.js`

**Interfaces:**
- Consumes service-worker message API.
- Produces pages `Heute`, `Kandidaten`, `Projekte`, `Nachrichten`, `Einstellungen`.

- [ ] Build daily counters and project-bound candidate/history views.
- [ ] Build project create/edit/archive/delete UI with target roles, skills, location, experience, work-time, language and outreach fields.
- [ ] Build message history and retention settings.
- [ ] Add JSON backup/restore, project CSV import, reporting CSV export and complete local-data deletion.
- [ ] Ensure action click opens the full dashboard and the dashboard has a manual BA Bewerberbörse launcher.
- [ ] Run syntax and full unit tests.

### Task 7: Documentation and installability verification

**Files:**
- Create: `ba-candidate-assistant/README.md`
- Create: `ba-candidate-assistant/docs/2026-08-25-ba-kandidaten-spec-amendment.md`

**Interfaces:** None.

- [ ] Document installation, normal workflow, privacy, retention, matching, parser degradation, tests and ESOS independence.
- [ ] Verify `npm test` and `npm run check` pass.
- [ ] Launch Chromium with `--disable-extensions-except=<dir> --load-extension=<dir>` and verify there are no manifest-load errors.
- [ ] Commit the standalone tool to `feature/ba-candidate-assistant` without merging.

### Task 8: ESOS Tools launcher

**Files (ESOS repo):**
- Modify: `packages/frontend/src/pages/ToolsOverview.jsx`
- Create: `packages/frontend/src/pages/BAKandidaten.jsx`
- Modify: `packages/frontend/src/App.jsx`
- Create: `packages/frontend/src/pages/BAKandidaten.contract.test.mjs`
- Modify: matching frontend architecture documentation under `docs/architecture/frontend/`

**Interfaces:**
- Produces Tools tile id `ba-kandidaten`, module `tools.ba-kandidaten`, route `/tools/ba-kandidaten`.

- [ ] Write a RED contract proving ToolsOverview contains `BA Kandidaten` → `/tools/ba-kandidaten`, App routes it, and the page contains only explanatory/launcher behavior with no candidate API calls.
- [ ] Add the tile and launcher page using existing ESOS UI components.
- [ ] Add/update route import and architecture docs.
- [ ] Run the focused contract and ESOS CI via a draft PR.
- [ ] Keep issue #477 in review state and do not merge.
