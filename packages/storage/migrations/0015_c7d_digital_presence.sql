-- QANDEEL COMPANY operational schema — migration 0015: C7-D Digital Presence Creation & Operations.
-- The Company's internal Digital Workshop and the identity of its governed external promotion — CAPABILITY only: no
-- website, framework, hosting provider, CMS, analytics, SEO vendor or social platform is chosen here.
--
--   digital_projects            a long-lived digital deliverable (a CONTEXT; Work stays in C1 / C5)
--   digital_revisions           working → FINALIZED (immutable, deterministic manifest hash) or ABANDONED
--   digital_revision_files      logical path → READY Artifact Store object (hash + size; never the content)
--   digital_uploads / _chunks   bounded chunked authoring (each chunk an Artifact Store object; no partial file)
--   digital_previews            internal-only preview binding to one exact finalized revision (immutable)
--   digital_release_candidates  exact-content binding to one finalized revision + its manifest hash (immutable)
--   digital_promotion_targets   typed, Founder-registered external resources (an allowlisted identifier, never a URL
--                               or a credential — credentials stay `vault:` references on the Tool record)
--   digital_promotions          one prepared external act: candidate × exact action × target, with its EXACT tool
--                               arguments (ids and hashes only); review, approval and execution state is NOT stored —
--                               it is derived from review_requests / approvals / tool_invocations, the rows that own it
--
-- File content NEVER enters SQLite (Stage 12 §21): every column is an id, a hash, a size, a code or a short label. The
-- internal authoring actions are an ordinary, closed Tool catalogue (`digital-workspace`, driver
-- `company.digital-workspace`): Employees use them only with explicit Founder grants, through the Tool Executor.
-- IMMUTABLE once released (see 0001). Migrations 0001–0014 are unchanged.
-- Conventions as in 0001–0014: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete, forward-only.
PRAGMA defer_foreign_keys = ON;

-- =====================================================================================================
-- 1. Digital Project: DRAFT → ACTIVE → ARCHIVED (DRAFT → ARCHIVED too). Identity immutable; append-only history.
-- =====================================================================================================
CREATE TABLE digital_projects (
  id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  project_type    TEXT    NOT NULL CHECK (project_type IN ('WEBSITE', 'LANDING_PAGES', 'CONTENT_PROGRAM', 'LAUNCH_CONTENT', 'SOCIAL_PROGRAM')),
  -- Company content (a short label), secret-scanned before it is stored; never copied into audit / events / logs.
  title           TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  goal_id         TEXT             REFERENCES goals (id) ON DELETE RESTRICT,
  state           TEXT    NOT NULL CHECK (state IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  work_item_id    TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  created_by_ref  TEXT    NOT NULL CHECK (created_by_ref GLOB 'employee:*' OR created_by_ref GLOB 'founder:*'),
  version         INTEGER NOT NULL CHECK (version >= 1),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at      TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX digital_projects_goal ON digital_projects (goal_id) WHERE goal_id IS NOT NULL;
-- The same Work Item never creates the same project twice (a repeated create is idempotent).
CREATE UNIQUE INDEX digital_projects_once_per_work ON digital_projects (work_item_id, title) WHERE work_item_id IS NOT NULL;
CREATE TRIGGER digital_projects_born_draft BEFORE INSERT ON digital_projects
WHEN NEW.state <> 'DRAFT' OR NEW.version <> 1
BEGIN SELECT RAISE(ABORT, 'a digital project is created as a DRAFT'); END;
CREATE TRIGGER digital_projects_identity_immutable BEFORE UPDATE ON digital_projects
WHEN NEW.id IS NOT OLD.id OR NEW.project_type IS NOT OLD.project_type OR NEW.title IS NOT OLD.title OR NEW.goal_id IS NOT OLD.goal_id
  OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'a digital project keeps its identity'); END;
CREATE TRIGGER digital_projects_forward_only BEFORE UPDATE OF state ON digital_projects
WHEN NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('ACTIVE', 'ARCHIVED')) OR (OLD.state = 'ACTIVE' AND NEW.state = 'ARCHIVED'))
BEGIN SELECT RAISE(ABORT, 'a digital project moves forward only; an archived project never revives'); END;
CREATE TRIGGER digital_projects_no_delete BEFORE DELETE ON digital_projects
BEGIN SELECT RAISE(ABORT, 'a digital project is archived, never deleted'); END;

CREATE TABLE digital_project_history (
  project_id   TEXT    NOT NULL REFERENCES digital_projects (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT             CHECK (from_state IS NULL OR from_state IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  to_state     TEXT    NOT NULL CHECK (to_state IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (project_id, version)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER digital_project_history_append_only_u BEFORE UPDATE ON digital_project_history BEGIN SELECT RAISE(ABORT, 'digital project history is append-only'); END;
CREATE TRIGGER digital_project_history_append_only_d BEFORE DELETE ON digital_project_history BEGIN SELECT RAISE(ABORT, 'digital project history is append-only'); END;

-- =====================================================================================================
-- 2. Revisions: a WORKING draft (its file map may change) → FINALIZED (immutable; manifest hash written once) or
-- ABANDONED. A finalized or abandoned revision never changes again; a change is a new revision.
-- =====================================================================================================
CREATE TABLE digital_revisions (
  id                TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  project_id        TEXT    NOT NULL REFERENCES digital_projects (id) ON DELETE RESTRICT,
  ordinal           INTEGER NOT NULL CHECK (ordinal >= 1),
  base_revision_id  TEXT             REFERENCES digital_revisions (id) ON DELETE RESTRICT,
  state             TEXT    NOT NULL CHECK (state IN ('WORKING', 'FINALIZED', 'ABANDONED')),
  work_item_id      TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  created_by_ref    TEXT    NOT NULL CHECK (created_by_ref GLOB 'employee:*'),
  manifest_sha256   TEXT             CHECK (manifest_sha256 IS NULL OR (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),
  file_count        INTEGER NOT NULL DEFAULT 0 CHECK (file_count BETWEEN 0 AND 2000),
  total_bytes       INTEGER NOT NULL DEFAULT 0 CHECK (total_bytes BETWEEN 0 AND 67108864),
  created_at        TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  finalized_at      TEXT             CHECK (finalized_at IS NULL OR finalized_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at        TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (project_id, ordinal),
  CHECK ((state = 'FINALIZED') = (manifest_sha256 IS NOT NULL)),
  CHECK ((state = 'FINALIZED') = (finalized_at IS NOT NULL)),
  CHECK (state <> 'FINALIZED' OR file_count >= 1)
) STRICT;
CREATE TRIGGER digital_revisions_born_working BEFORE INSERT ON digital_revisions
WHEN NEW.state <> 'WORKING' OR NEW.manifest_sha256 IS NOT NULL OR NEW.file_count <> 0 OR NEW.total_bytes <> 0
  OR (SELECT state FROM digital_projects WHERE id = NEW.project_id) = 'ARCHIVED'
  OR (NEW.base_revision_id IS NOT NULL AND (SELECT state FROM digital_revisions WHERE id = NEW.base_revision_id AND project_id = NEW.project_id) IS NOT 'FINALIZED')
BEGIN SELECT RAISE(ABORT, 'a revision is born WORKING and empty, in a live project, from a finalized revision of the same project'); END;
-- Finalized / abandoned revisions are history; a working revision moves once, to FINALIZED or ABANDONED.
CREATE TRIGGER digital_revisions_frozen BEFORE UPDATE ON digital_revisions
WHEN OLD.state <> 'WORKING' OR NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.ordinal IS NOT OLD.ordinal OR NEW.base_revision_id IS NOT OLD.base_revision_id
  OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'a finalized or abandoned revision is immutable; a change is a new revision'); END;
-- Finalizing re-checks the file map: the recorded count and size are exactly the live (ACTIVE) files of the revision.
CREATE TRIGGER digital_revisions_finalize_matches_files BEFORE UPDATE OF state ON digital_revisions
WHEN NEW.state = 'FINALIZED' AND (
  NEW.file_count <> (SELECT COUNT(*) FROM digital_revision_files WHERE revision_id = NEW.id AND state = 'ACTIVE')
  OR NEW.total_bytes <> (SELECT COALESCE(SUM(size_bytes), 0) FROM digital_revision_files WHERE revision_id = NEW.id AND state = 'ACTIVE')
  OR EXISTS (SELECT 1 FROM digital_revision_files f JOIN artifacts a ON a.id = f.artifact_id WHERE f.revision_id = NEW.id AND f.state = 'ACTIVE' AND (a.state <> 'READY' OR a.sha256 <> f.sha256 OR a.size_bytes <> f.size_bytes))
  OR EXISTS (SELECT 1 FROM digital_uploads u WHERE u.revision_id = NEW.id AND u.state = 'OPEN'))
BEGIN SELECT RAISE(ABORT, 'a revision finalizes only with its exact, READY, verified file map and no open upload'); END;
CREATE TRIGGER digital_revisions_no_delete BEFORE DELETE ON digital_revisions
BEGIN SELECT RAISE(ABORT, 'revisions are durable history'); END;

-- One logical path of a revision → one READY Artifact Store object (hash + size recorded; the content is NOT here).
CREATE TABLE digital_revision_files (
  revision_id  TEXT    NOT NULL REFERENCES digital_revisions (id) ON DELETE RESTRICT,
  path_key     TEXT    NOT NULL CHECK (length(path_key) BETWEEN 1 AND 200),
  path         TEXT    NOT NULL CHECK (length(path) BETWEEN 1 AND 200 AND path NOT GLOB '/*' AND path NOT GLOB '*\*' AND path NOT GLOB '*..*' AND path NOT GLOB '*:*' AND instr(path, char(0)) = 0),
  artifact_id  TEXT    NOT NULL REFERENCES artifacts (id) ON DELETE RESTRICT,
  sha256       TEXT    NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes   INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 4194304),
  media_type   TEXT    NOT NULL CHECK (length(media_type) BETWEEN 3 AND 64),
  state        TEXT    NOT NULL CHECK (state IN ('ACTIVE', 'REMOVED')),
  updated_at   TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (revision_id, path_key),
  CHECK (path_key = lower(path))
) STRICT, WITHOUT ROWID;
CREATE TRIGGER digital_revision_files_working_only_i BEFORE INSERT ON digital_revision_files
WHEN (SELECT state FROM digital_revisions WHERE id = NEW.revision_id) IS NOT 'WORKING'
  OR (SELECT state FROM artifacts WHERE id = NEW.artifact_id) IS NOT 'READY'
  OR (SELECT sha256 FROM artifacts WHERE id = NEW.artifact_id) IS NOT NEW.sha256
  OR (SELECT size_bytes FROM artifacts WHERE id = NEW.artifact_id) IS NOT NEW.size_bytes
BEGIN SELECT RAISE(ABORT, 'a file maps into a WORKING revision, to a READY artifact with exactly its hash and size'); END;
CREATE TRIGGER digital_revision_files_working_only_u BEFORE UPDATE ON digital_revision_files
WHEN (SELECT state FROM digital_revisions WHERE id = OLD.revision_id) IS NOT 'WORKING' OR NEW.revision_id IS NOT OLD.revision_id OR NEW.path_key IS NOT OLD.path_key
  OR (SELECT state FROM artifacts WHERE id = NEW.artifact_id) IS NOT 'READY'
  OR (SELECT sha256 FROM artifacts WHERE id = NEW.artifact_id) IS NOT NEW.sha256
  OR (SELECT size_bytes FROM artifacts WHERE id = NEW.artifact_id) IS NOT NEW.size_bytes
BEGIN SELECT RAISE(ABORT, 'a finalized revision''s files never change; a working file maps to a READY artifact with exactly its hash and size'); END;
CREATE TRIGGER digital_revision_files_no_delete BEFORE DELETE ON digital_revision_files
BEGIN SELECT RAISE(ABORT, 'a file is REMOVED from a working revision, never deleted'); END;

-- =====================================================================================================
-- 3. Chunked authoring. Each chunk is its own Artifact Store object; the whole file is assembled, its size and hash
-- verified against what `upload-begin` declared, stored as one artifact and only THEN mapped to its path.
-- =====================================================================================================
CREATE TABLE digital_uploads (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  revision_id      TEXT    NOT NULL REFERENCES digital_revisions (id) ON DELETE RESTRICT,
  path_key         TEXT    NOT NULL CHECK (length(path_key) BETWEEN 1 AND 200),
  path             TEXT    NOT NULL CHECK (length(path) BETWEEN 1 AND 200),
  media_type       TEXT    NOT NULL CHECK (length(media_type) BETWEEN 3 AND 64),
  expected_size    INTEGER NOT NULL CHECK (expected_size BETWEEN 0 AND 4194304),
  expected_sha256  TEXT    NOT NULL CHECK (length(expected_sha256) = 64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'),
  chunk_count      INTEGER NOT NULL CHECK (chunk_count BETWEEN 1 AND 1024),
  state            TEXT    NOT NULL CHECK (state IN ('OPEN', 'COMMITTED', 'ABANDONED')),
  work_item_id     TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  artifact_id      TEXT             REFERENCES artifacts (id) ON DELETE RESTRICT,
  created_at       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at       TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'COMMITTED') = (artifact_id IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX digital_uploads_one_open ON digital_uploads (revision_id, path_key) WHERE state = 'OPEN';
CREATE TRIGGER digital_uploads_born_open BEFORE INSERT ON digital_uploads
WHEN NEW.state <> 'OPEN' OR (SELECT state FROM digital_revisions WHERE id = NEW.revision_id) IS NOT 'WORKING'
BEGIN SELECT RAISE(ABORT, 'an upload opens on a WORKING revision'); END;
CREATE TRIGGER digital_uploads_settle_once BEFORE UPDATE ON digital_uploads
WHEN OLD.state <> 'OPEN' OR NEW.id IS NOT OLD.id OR NEW.revision_id IS NOT OLD.revision_id OR NEW.path_key IS NOT OLD.path_key OR NEW.expected_size IS NOT OLD.expected_size
  OR NEW.expected_sha256 IS NOT OLD.expected_sha256 OR NEW.chunk_count IS NOT OLD.chunk_count OR NEW.work_item_id IS NOT OLD.work_item_id
  OR (NEW.state = 'COMMITTED' AND ((SELECT COUNT(*) FROM digital_upload_chunks WHERE upload_id = NEW.id) <> NEW.chunk_count
    OR (SELECT sha256 FROM artifacts WHERE id = NEW.artifact_id AND state = 'READY') IS NOT NEW.expected_sha256))
BEGIN SELECT RAISE(ABORT, 'an upload settles once, committed only with every chunk and the declared content hash'); END;
CREATE TRIGGER digital_uploads_no_delete BEFORE DELETE ON digital_uploads BEGIN SELECT RAISE(ABORT, 'uploads are durable history'); END;

CREATE TABLE digital_upload_chunks (
  upload_id    TEXT    NOT NULL REFERENCES digital_uploads (id) ON DELETE RESTRICT,
  seq          INTEGER NOT NULL CHECK (seq BETWEEN 0 AND 1023),
  artifact_id  TEXT    NOT NULL REFERENCES artifacts (id) ON DELETE RESTRICT,
  sha256       TEXT    NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes   INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 4096),
  created_at   TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (upload_id, seq)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER digital_upload_chunks_open_only BEFORE INSERT ON digital_upload_chunks
WHEN (SELECT state FROM digital_uploads WHERE id = NEW.upload_id) IS NOT 'OPEN'
  OR NEW.seq >= (SELECT chunk_count FROM digital_uploads WHERE id = NEW.upload_id)
  OR (SELECT sha256 FROM artifacts WHERE id = NEW.artifact_id AND state = 'READY') IS NOT NEW.sha256
BEGIN SELECT RAISE(ABORT, 'a chunk joins an OPEN upload in range, as a READY artifact with exactly its hash'); END;
CREATE TRIGGER digital_upload_chunks_immutable_u BEFORE UPDATE ON digital_upload_chunks BEGIN SELECT RAISE(ABORT, 'chunks are immutable'); END;
CREATE TRIGGER digital_upload_chunks_immutable_d BEFORE DELETE ON digital_upload_chunks BEGIN SELECT RAISE(ABORT, 'chunks are immutable'); END;

-- =====================================================================================================
-- 4. Internal Preview: an immutable binding to one exact FINALIZED revision and its manifest hash. INTERNAL only —
-- a Preview is never a deployment or a publication; an external preview is a governed promotion.
-- =====================================================================================================
CREATE TABLE digital_previews (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  revision_id      TEXT    NOT NULL UNIQUE REFERENCES digital_revisions (id) ON DELETE RESTRICT,
  manifest_sha256  TEXT    NOT NULL CHECK (length(manifest_sha256) = 64),
  mode             TEXT    NOT NULL CHECK (mode = 'INTERNAL'),
  state            TEXT    NOT NULL CHECK (state IN ('READY', 'CAPABILITY_GAP')),
  entry_path       TEXT             CHECK (entry_path IS NULL OR length(entry_path) BETWEEN 1 AND 200),
  gap_code         TEXT             CHECK (gap_code IS NULL OR gap_code IN ('PREVIEW_REQUIRES_BUILD', 'PREVIEW_NO_STATIC_ENTRY')),
  work_item_id     TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  created_by_ref   TEXT    NOT NULL CHECK (created_by_ref GLOB 'employee:*' OR created_by_ref GLOB 'founder:*'),
  created_at       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'READY') = (entry_path IS NOT NULL AND gap_code IS NULL)),
  CHECK ((state = 'CAPABILITY_GAP') = (gap_code IS NOT NULL AND entry_path IS NULL))
) STRICT;
CREATE TRIGGER digital_previews_exact_revision BEFORE INSERT ON digital_previews
WHEN (SELECT state FROM digital_revisions WHERE id = NEW.revision_id) IS NOT 'FINALIZED'
  OR (SELECT manifest_sha256 FROM digital_revisions WHERE id = NEW.revision_id) IS NOT NEW.manifest_sha256
  OR (NEW.entry_path IS NOT NULL AND NOT EXISTS (SELECT 1 FROM digital_revision_files WHERE revision_id = NEW.revision_id AND path = NEW.entry_path AND state = 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'a preview binds exactly one finalized revision and its manifest hash'); END;
CREATE TRIGGER digital_previews_immutable_u BEFORE UPDATE ON digital_previews BEGIN SELECT RAISE(ABORT, 'a preview is immutable history'); END;
CREATE TRIGGER digital_previews_immutable_d BEFORE DELETE ON digital_previews BEGIN SELECT RAISE(ABORT, 'a preview is immutable history'); END;

-- =====================================================================================================
-- 5. Release Candidate: the exact content that Review and the Founder see — one FINALIZED revision and its manifest
-- hash, by reference (no content). Immutable: a change after review or approval is a new candidate.
-- =====================================================================================================
CREATE TABLE digital_release_candidates (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  project_id         TEXT    NOT NULL REFERENCES digital_projects (id) ON DELETE RESTRICT,
  revision_id        TEXT    NOT NULL REFERENCES digital_revisions (id) ON DELETE RESTRICT,
  manifest_sha256    TEXT    NOT NULL CHECK (length(manifest_sha256) = 64),
  kind               TEXT    NOT NULL CHECK (kind IN ('WEBSITE', 'CONTENT_PACKAGE', 'SOCIAL_POST')),
  -- What changed and why, in Founder-friendly words (Company content, secret-scanned; never in audit / events / logs).
  summary            TEXT    NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
  fingerprint        TEXT    NOT NULL UNIQUE CHECK (length(fingerprint) = 64),
  work_item_id       TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  maker_employee_id  TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (revision_id, kind)
) STRICT;
CREATE TRIGGER digital_release_candidates_exact_revision BEFORE INSERT ON digital_release_candidates
WHEN (SELECT state FROM digital_revisions WHERE id = NEW.revision_id AND project_id = NEW.project_id) IS NOT 'FINALIZED'
  OR (SELECT manifest_sha256 FROM digital_revisions WHERE id = NEW.revision_id) IS NOT NEW.manifest_sha256
BEGIN SELECT RAISE(ABORT, 'a release candidate binds exactly one finalized revision of its project and that revision''s manifest hash'); END;
CREATE TRIGGER digital_release_candidates_immutable_u BEFORE UPDATE ON digital_release_candidates BEGIN SELECT RAISE(ABORT, 'a release candidate is immutable; a change is a new candidate'); END;
CREATE TRIGGER digital_release_candidates_immutable_d BEFORE DELETE ON digital_release_candidates BEGIN SELECT RAISE(ABORT, 'a release candidate is immutable history'); END;

-- =====================================================================================================
-- 6. Promotion Targets: typed external resources the Founder registers (an allowlisted provider identifier — never a
-- URL, a token or a password). The adapter is the Tool driver that serves the target's class.
-- =====================================================================================================
CREATE TABLE digital_promotion_targets (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code             TEXT    NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 64 AND code NOT GLOB '*[^a-z0-9.-]*'),
  target_class     TEXT    NOT NULL CHECK (target_class IN ('CODE_REPOSITORY', 'WEBSITE_PRODUCTION', 'WEBSITE_PREVIEW_EXTERNAL', 'CMS', 'SOCIAL_CHANNEL', 'SEARCH_PROPERTY')),
  adapter_code     TEXT    NOT NULL CHECK (length(adapter_code) BETWEEN 1 AND 64 AND adapter_code NOT GLOB '*[^a-z0-9.-]*'),
  -- `<provider>:<identifier>` (e.g. an owner/repository name) — no scheme, no host, no query, no credential.
  external_ref     TEXT    NOT NULL CHECK (length(external_ref) BETWEEN 3 AND 161 AND external_ref GLOB '[a-z]*:[A-Za-z0-9]*' AND external_ref NOT GLOB '*[^A-Za-z0-9:._/-]*' AND external_ref NOT GLOB '*//*' AND external_ref NOT GLOB '*..*'),
  -- The adapter's declared capability summary (codes only; bounded).
  capability_json  TEXT    NOT NULL CHECK (json_valid(capability_json) AND length(capability_json) <= 2048),
  state            TEXT    NOT NULL CHECK (state IN ('ACTIVE', 'SUSPENDED', 'RETIRED')),
  registered_by_ref TEXT   NOT NULL CHECK (registered_by_ref GLOB 'founder:*'),
  version          INTEGER NOT NULL CHECK (version >= 1),
  created_at       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at       TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (adapter_code, external_ref)
) STRICT;
CREATE TRIGGER digital_promotion_targets_identity_immutable BEFORE UPDATE ON digital_promotion_targets
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.target_class IS NOT OLD.target_class OR NEW.adapter_code IS NOT OLD.adapter_code
  OR NEW.external_ref IS NOT OLD.external_ref OR NEW.capability_json IS NOT OLD.capability_json OR NEW.registered_by_ref IS NOT OLD.registered_by_ref
  OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1 OR OLD.state = 'RETIRED'
BEGIN SELECT RAISE(ABORT, 'a promotion target keeps its identity; a retired target is history'); END;
CREATE TRIGGER digital_promotion_targets_no_delete BEFORE DELETE ON digital_promotion_targets BEGIN SELECT RAISE(ABORT, 'targets are retired, never deleted'); END;

-- =====================================================================================================
-- 7. Promotions: one prepared external act — candidate × kind × target × the EXACT tool action and arguments (ids and
-- hashes only). Immutable. Review, Founder approval and execution are the canonical rows of the existing C4 / C2
-- systems, matched by (work item, tool action, argument hash); nothing here can mark a promotion approved or done.
-- =====================================================================================================
CREATE TABLE digital_promotions (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  candidate_id     TEXT    NOT NULL REFERENCES digital_release_candidates (id) ON DELETE RESTRICT,
  target_id        TEXT    NOT NULL REFERENCES digital_promotion_targets (id) ON DELETE RESTRICT,
  kind             TEXT    NOT NULL CHECK (kind IN ('EXPORT_SOURCE', 'MERGE_PRODUCTION', 'PREVIEW_EXTERNAL', 'PUBLISH_PRODUCTION', 'ROLLBACK_PRODUCTION', 'SOCIAL_PUBLISH')),
  tool_action_id   TEXT    NOT NULL REFERENCES tool_actions (id) ON DELETE RESTRICT,
  work_item_id     TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id      TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  args_json        TEXT    NOT NULL CHECK (json_valid(args_json) AND json_type(args_json) = 'object' AND length(args_json) <= 1024),
  args_sha256      TEXT    NOT NULL CHECK (length(args_sha256) = 64),
  prior_promotion_id TEXT          REFERENCES digital_promotions (id) ON DELETE RESTRICT,
  created_at       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (tool_action_id, work_item_id, args_sha256),
  CHECK (json_extract(args_json, '$.promotionId') = id),
  CHECK (json_extract(args_json, '$.targetId') = target_id),
  CHECK (json_extract(args_json, '$.candidateId') = candidate_id),
  CHECK (kind <> 'MERGE_PRODUCTION' OR prior_promotion_id IS NOT NULL)
) STRICT;
CREATE INDEX digital_promotions_candidate ON digital_promotions (candidate_id, target_id, kind);
CREATE TRIGGER digital_promotions_exact_binding BEFORE INSERT ON digital_promotions
WHEN (SELECT state FROM digital_promotion_targets WHERE id = NEW.target_id) IS NOT 'ACTIVE'
  -- the action is served by the target's adapter (its Tool driver), is external and R3+
  OR (SELECT t.driver_code FROM tool_actions a JOIN tools t ON t.id = a.tool_id WHERE a.id = NEW.tool_action_id) IS NOT (SELECT adapter_code FROM digital_promotion_targets WHERE id = NEW.target_id)
  OR (SELECT a.mutates_external || a.risk_level FROM tool_actions a WHERE a.id = NEW.tool_action_id) NOT IN ('1R3', '1R4')
  -- the arguments name exactly this candidate's manifest hash
  OR json_extract(NEW.args_json, '$.manifestSha256') IS NOT (SELECT manifest_sha256 FROM digital_release_candidates WHERE id = NEW.candidate_id)
  -- the target class fits the promotion kind
  OR NOT ((NEW.kind IN ('EXPORT_SOURCE', 'MERGE_PRODUCTION') AND (SELECT target_class FROM digital_promotion_targets WHERE id = NEW.target_id) = 'CODE_REPOSITORY')
    OR (NEW.kind = 'PREVIEW_EXTERNAL' AND (SELECT target_class FROM digital_promotion_targets WHERE id = NEW.target_id) = 'WEBSITE_PREVIEW_EXTERNAL')
    OR (NEW.kind IN ('PUBLISH_PRODUCTION', 'ROLLBACK_PRODUCTION') AND (SELECT target_class FROM digital_promotion_targets WHERE id = NEW.target_id) IN ('WEBSITE_PRODUCTION', 'CMS'))
    OR (NEW.kind = 'SOCIAL_PUBLISH' AND (SELECT target_class FROM digital_promotion_targets WHERE id = NEW.target_id) = 'SOCIAL_CHANNEL'))
  -- a production merge follows an export of the SAME candidate to the SAME target that the provider confirmed
  OR (NEW.kind = 'MERGE_PRODUCTION' AND NOT EXISTS (
    SELECT 1 FROM digital_promotions p JOIN tool_invocations i ON i.tool_action_id = p.tool_action_id AND i.work_item_id = p.work_item_id AND i.args_sha256 = p.args_sha256
     WHERE p.id = NEW.prior_promotion_id AND p.kind = 'EXPORT_SOURCE' AND p.candidate_id = NEW.candidate_id AND p.target_id = NEW.target_id AND i.state = 'SUCCEEDED'))
BEGIN SELECT RAISE(ABORT, 'a promotion binds an active target, its own adapter''s governed external action, this candidate''s exact manifest hash and (for a merge) a confirmed export'); END;
CREATE TRIGGER digital_promotions_immutable_u BEFORE UPDATE ON digital_promotions BEGIN SELECT RAISE(ABORT, 'a promotion is immutable history'); END;
CREATE TRIGGER digital_promotions_immutable_d BEFORE DELETE ON digital_promotions BEGIN SELECT RAISE(ABORT, 'a promotion is immutable history'); END;

-- =====================================================================================================
-- 8. The internal authoring catalogue: one closed, Company-native Tool. Its driver code is reserved (no other tool may
-- claim it) and its actions are fixed here (no action may be added to it). Employees still need an explicit Founder
-- grant per action; tools are never granted automatically.
-- =====================================================================================================
INSERT INTO tools (id, code, driver_code, egress, status, hold_reason, credential_ref, version, created_at, updated_at)
VALUES ('c7d00000-0000-4000-8000-000000000001', 'digital-workspace', 'company.digital-workspace', 'NONE', 'ACTIVE', NULL, NULL, 1, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z');

INSERT INTO tool_actions (id, tool_id, code, risk_level, side_effects, mutates_external, requires_idempotency, data_class_ceiling, result_data_class, args_schema_json, cost_per_call_micros, status, created_at) VALUES
('c7d00000-0000-4000-8000-000000000101', 'c7d00000-0000-4000-8000-000000000001', 'project-create', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"projectType":{"type":"string","required":true,"maxLength":32},"title":{"type":"string","required":true,"maxLength":160},"goalId":{"type":"string","maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000102', 'c7d00000-0000-4000-8000-000000000001', 'project-activate', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"projectId":{"type":"string","required":true,"maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000103', 'c7d00000-0000-4000-8000-000000000001', 'project-archive', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"projectId":{"type":"string","required":true,"maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000104', 'c7d00000-0000-4000-8000-000000000001', 'revision-open', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"projectId":{"type":"string","required":true,"maxLength":36},"baseRevisionId":{"type":"string","maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000105', 'c7d00000-0000-4000-8000-000000000001', 'file-put', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36},"path":{"type":"string","required":true,"maxLength":200},"encoding":{"type":"string","required":true,"maxLength":8},"content":{"type":"string","required":true,"maxLength":5464}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000106', 'c7d00000-0000-4000-8000-000000000001', 'upload-begin', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36},"path":{"type":"string","required":true,"maxLength":200},"sizeBytes":{"type":"integer","required":true,"min":0,"max":4194304},"sha256":{"type":"string","required":true,"maxLength":64}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000107', 'c7d00000-0000-4000-8000-000000000001', 'upload-chunk', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"uploadId":{"type":"string","required":true,"maxLength":36},"seq":{"type":"integer","required":true,"min":0,"max":1023},"data":{"type":"string","required":true,"maxLength":5464},"chunkSha256":{"type":"string","required":true,"maxLength":64}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000108', 'c7d00000-0000-4000-8000-000000000001', 'upload-commit', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"uploadId":{"type":"string","required":true,"maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000109', 'c7d00000-0000-4000-8000-000000000001', 'file-remove', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36},"path":{"type":"string","required":true,"maxLength":200}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000110', 'c7d00000-0000-4000-8000-000000000001', 'revision-finalize', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000111', 'c7d00000-0000-4000-8000-000000000001', 'revision-inspect', 'R0', 'NONE', 0, 0, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36},"offset":{"type":"integer","min":0,"max":2000}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000112', 'c7d00000-0000-4000-8000-000000000001', 'file-read', 'R0', 'NONE', 0, 0, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36},"path":{"type":"string","required":true,"maxLength":200},"offset":{"type":"integer","min":0,"max":4194304},"length":{"type":"integer","min":1,"max":1024}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000113', 'c7d00000-0000-4000-8000-000000000001', 'preview-create', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000114', 'c7d00000-0000-4000-8000-000000000001', 'seo-check', 'R0', 'NONE', 0, 0, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000115', 'c7d00000-0000-4000-8000-000000000001', 'candidate-create', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"revisionId":{"type":"string","required":true,"maxLength":36},"kind":{"type":"string","required":true,"maxLength":32},"summary":{"type":"string","required":true,"maxLength":500}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000116', 'c7d00000-0000-4000-8000-000000000001', 'promotion-prepare', 'R1', 'IDEMPOTENT', 0, 1, 'D2', 'D1', '{"fields":{"candidateId":{"type":"string","required":true,"maxLength":36},"targetId":{"type":"string","required":true,"maxLength":36},"kind":{"type":"string","required":true,"maxLength":32},"notBefore":{"type":"string","maxLength":24},"notAfter":{"type":"string","maxLength":24},"expectedCurrentRef":{"type":"string","maxLength":128},"rollbackToRef":{"type":"string","maxLength":128}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z'),
('c7d00000-0000-4000-8000-000000000117', 'c7d00000-0000-4000-8000-000000000001', 'promotion-inspect', 'R0', 'NONE', 0, 0, 'D2', 'D1', '{"fields":{"promotionId":{"type":"string","required":true,"maxLength":36}}}', 0, 'ACTIVE', '2026-10-01T00:00:00.000Z');

INSERT INTO catalog_history (entity_type, entity_id, change_kind, from_value, to_value, reason_code, actor_ref, occurred_at)
VALUES ('tool', 'c7d00000-0000-4000-8000-000000000001', 'registered', NULL, 'ACTIVE', 'c7d.internal_catalogue', 'system:migration-0015', '2026-10-01T00:00:00.000Z');

-- The reserved internal driver is the seeded tool's alone, and its catalogue is closed.
CREATE TRIGGER tools_digital_workspace_reserved BEFORE INSERT ON tools
WHEN NEW.driver_code = 'company.digital-workspace' OR NEW.code = 'digital-workspace'
BEGIN SELECT RAISE(ABORT, 'the internal digital workspace tool and driver are reserved'); END;
CREATE TRIGGER tool_actions_digital_workspace_closed BEFORE INSERT ON tool_actions
WHEN NEW.tool_id = 'c7d00000-0000-4000-8000-000000000001'
BEGIN SELECT RAISE(ABORT, 'the internal digital workspace catalogue is closed'); END;
-- The internal workspace tool never becomes an external tool and never carries a credential.
CREATE TRIGGER tools_digital_workspace_internal BEFORE UPDATE ON tools
WHEN OLD.id = 'c7d00000-0000-4000-8000-000000000001' AND NEW.credential_ref IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'the internal digital workspace tool carries no credential'); END;
