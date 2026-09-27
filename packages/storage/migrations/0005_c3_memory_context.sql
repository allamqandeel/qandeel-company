-- QANDEEL COMPANY operational schema — migration 0005: C3 Memory, Knowledge, Canonical Truth,
-- learning validation and Context Assembly (Stage 5, Stage 13 D13-E).
-- IMMUTABLE once released (see 0001). Migrations 0001–0004 are unchanged.
--
-- Conventions as in 0001 / 0004: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard
-- delete, append-only history, bounded text and JSON. Every content-bearing row carries a SHA-256
-- of its exact stored text, verified on every read and use (corruption fails closed). Semantic
-- payload lives only in the owning row: history, audit, events, manifests and logs carry IDs,
-- versions, hashes, codes and counts, never content (Rule A). No column stores a secret.

-- Canonical Truth register (Stage 2 §5: Constitution → Policy → Decision → Verified Fact). It
-- outranks Knowledge and Memory. At most one ACTIVE record per claim key; supersession is additive.
CREATE TABLE canonical_truth (
  id                TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  level             TEXT    NOT NULL CHECK (level IN ('CONSTITUTION', 'POLICY', 'DECISION', 'VERIFIED_FACT')),
  topic             TEXT    NOT NULL CHECK (length(topic) BETWEEN 1 AND 96 AND topic NOT GLOB '*[^a-z0-9.-]*'),
  claim_key         TEXT             CHECK (claim_key IS NULL OR (length(claim_key) BETWEEN 1 AND 96 AND claim_key NOT GLOB '*[^a-z0-9.-]*')),
  claim_value       TEXT             CHECK (claim_value IS NULL OR (length(claim_value) BETWEEN 1 AND 96 AND claim_value NOT GLOB '*[^a-z0-9.-]*')),
  statement         TEXT    NOT NULL CHECK (length(statement) BETWEEN 1 AND 2000),
  statement_sha256  TEXT    NOT NULL CHECK (length(statement_sha256) = 64 AND statement_sha256 NOT GLOB '*[^0-9a-f]*'),
  terms_json        TEXT    NOT NULL CHECK (json_valid(terms_json) AND json_type(terms_json) = 'array' AND length(terms_json) <= 2048),
  data_class        TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  source_ref        TEXT    NOT NULL CHECK (length(source_ref) BETWEEN 3 AND 200),
  source_sha256     TEXT             CHECK (source_sha256 IS NULL OR (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*')),
  status            TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  integrity         TEXT    NOT NULL DEFAULT 'OK' CHECK (integrity IN ('OK', 'CORRUPT')),
  supersedes_id     TEXT             REFERENCES canonical_truth (id) ON DELETE RESTRICT,
  superseded_by_id  TEXT             REFERENCES canonical_truth (id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  version           INTEGER NOT NULL CHECK (version >= 1),
  recorded_by_ref   TEXT    NOT NULL CHECK (length(recorded_by_ref) BETWEEN 3 AND 161),
  recorded_at       TEXT    NOT NULL CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at        TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((claim_key IS NULL) = (claim_value IS NULL)),
  CHECK (status <> 'SUPERSEDED' OR superseded_by_id IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX canonical_truth_one_active_claim ON canonical_truth (claim_key) WHERE status = 'ACTIVE' AND claim_key IS NOT NULL;
CREATE INDEX canonical_truth_topic ON canonical_truth (topic, status);
CREATE TRIGGER canonical_truth_no_delete BEFORE DELETE ON canonical_truth BEGIN SELECT RAISE(ABORT, 'canonical truth are durable history'); END;
CREATE TRIGGER canonical_truth_content_immutable BEFORE UPDATE ON canonical_truth
WHEN NEW.id IS NOT OLD.id OR NEW.level IS NOT OLD.level OR NEW.topic IS NOT OLD.topic OR NEW.claim_key IS NOT OLD.claim_key OR NEW.claim_value IS NOT OLD.claim_value
  OR NEW.statement IS NOT OLD.statement OR NEW.statement_sha256 IS NOT OLD.statement_sha256 OR NEW.data_class IS NOT OLD.data_class OR NEW.source_ref IS NOT OLD.source_ref
  OR NEW.recorded_at IS NOT OLD.recorded_at OR NEW.supersedes_id IS NOT OLD.supersedes_id OR NEW.version <> OLD.version + 1
  OR (OLD.status = 'SUPERSEDED' AND NEW.status <> 'SUPERSEDED') OR (OLD.integrity = 'CORRUPT' AND NEW.integrity <> 'CORRUPT')
BEGIN SELECT RAISE(ABORT, 'canonical truth is superseded, never rewritten'); END;

-- Structured memory CANDIDATES submitted from governed runs (Stage 5 §3). A candidate is not memory:
-- the runtime-owned Memory Write Policy decides it in a separate transaction; a crash in between
-- leaves a SUBMITTED candidate that recovery decides. One candidate per Work Item step (idempotent
-- across retries and resumed runs). A candidate refused for secret material keeps no content.
CREATE TABLE memory_candidates (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  idempotency_key    TEXT    NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  employee_id        TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  run_id             TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  work_item_id       TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  kind               TEXT    NOT NULL CHECK (kind IN ('MEMORY', 'OBSERVATION')),
  memory_class       TEXT             CHECK (memory_class IS NULL OR memory_class IN ('PROFESSIONAL', 'EXPERIENCE', 'RELATIONSHIP_COLLABORATION', 'CURRENT_WORK', 'PERSONAL_LESSON')),
  topic              TEXT    NOT NULL CHECK (length(topic) BETWEEN 1 AND 96 AND topic NOT GLOB '*[^a-z0-9.-]*'),
  claim_key          TEXT             CHECK (claim_key IS NULL OR (length(claim_key) BETWEEN 1 AND 96 AND claim_key NOT GLOB '*[^a-z0-9.-]*')),
  claim_value        TEXT             CHECK (claim_value IS NULL OR (length(claim_value) BETWEEN 1 AND 96 AND claim_value NOT GLOB '*[^a-z0-9.-]*')),
  content            TEXT             CHECK (content IS NULL OR length(content) BETWEEN 1 AND 2000),
  content_sha256     TEXT             CHECK (content_sha256 IS NULL OR (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*')),
  confidence_pct     INTEGER NOT NULL CHECK (confidence_pct BETWEEN 0 AND 100),
  data_class         TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  evidence_refs_json TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 4096),
  provenance_kind    TEXT    NOT NULL CHECK (provenance_kind IN ('RUN', 'WORK_ITEM')),
  provenance_ref     TEXT    NOT NULL CHECK (length(provenance_ref) BETWEEN 3 AND 200),
  state              TEXT    NOT NULL CHECK (state IN ('SUBMITTED', 'ACCEPTED', 'REFUSED', 'ROUTED_TO_LEARNING')),
  decision_reason    TEXT             CHECK (decision_reason IS NULL OR length(decision_reason) BETWEEN 1 AND 64),
  duplicate_of       TEXT,
  result_memory_id   TEXT,
  result_lesson_id   TEXT,
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_at         TEXT             CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((content IS NULL) = (content_sha256 IS NULL)),
  CHECK (content IS NOT NULL OR (state = 'REFUSED' AND decision_reason = 'SECRET_MATERIAL')),
  CHECK ((state = 'SUBMITTED') = (decided_at IS NULL)),
  CHECK ((kind = 'MEMORY') = (memory_class IS NOT NULL))
) STRICT;
CREATE INDEX memory_candidates_pending ON memory_candidates (state) WHERE state = 'SUBMITTED';
CREATE INDEX memory_candidates_employee ON memory_candidates (employee_id, created_at);
CREATE TRIGGER memory_candidates_no_delete BEFORE DELETE ON memory_candidates BEGIN SELECT RAISE(ABORT, 'memory candidates are durable history'); END;
CREATE TRIGGER memory_candidates_decided_once BEFORE UPDATE ON memory_candidates
WHEN OLD.state <> 'SUBMITTED' OR NEW.content IS NOT OLD.content OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.employee_id IS NOT OLD.employee_id
  OR NEW.memory_class IS NOT OLD.memory_class OR NEW.idempotency_key IS NOT OLD.idempotency_key OR NEW.data_class IS NOT OLD.data_class
  OR NEW.run_id IS NOT OLD.run_id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.kind IS NOT OLD.kind OR NEW.topic IS NOT OLD.topic
  OR NEW.claim_key IS NOT OLD.claim_key OR NEW.claim_value IS NOT OLD.claim_value OR NEW.confidence_pct IS NOT OLD.confidence_pct
  OR NEW.evidence_refs_json IS NOT OLD.evidence_refs_json OR NEW.provenance_kind IS NOT OLD.provenance_kind OR NEW.provenance_ref IS NOT OLD.provenance_ref
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'a memory candidate is decided exactly once and never edited'); END;

-- Employee Memory (Stage 5 §1): explicit classes, PERSONAL scope, provenance, confidence, retention,
-- status, data class, integrity hash and supersession / correction lineage.
CREATE TABLE memory_records (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id        TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  memory_class       TEXT    NOT NULL CHECK (memory_class IN ('PROFESSIONAL', 'EXPERIENCE', 'RELATIONSHIP_COLLABORATION', 'CURRENT_WORK', 'PERSONAL_LESSON')),
  scope              TEXT    NOT NULL CHECK (scope = 'PERSONAL'),
  topic              TEXT    NOT NULL CHECK (length(topic) BETWEEN 1 AND 96 AND topic NOT GLOB '*[^a-z0-9.-]*'),
  claim_key          TEXT             CHECK (claim_key IS NULL OR (length(claim_key) BETWEEN 1 AND 96 AND claim_key NOT GLOB '*[^a-z0-9.-]*')),
  claim_value        TEXT             CHECK (claim_value IS NULL OR (length(claim_value) BETWEEN 1 AND 96 AND claim_value NOT GLOB '*[^a-z0-9.-]*')),
  content            TEXT    NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  content_sha256     TEXT    NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  fingerprint        TEXT    NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  terms_json         TEXT    NOT NULL CHECK (json_valid(terms_json) AND json_type(terms_json) = 'array' AND length(terms_json) <= 2048),
  data_class         TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  market_ref         TEXT             CHECK (market_ref IS NULL OR length(market_ref) BETWEEN 3 AND 200),
  project_ref        TEXT             CHECK (project_ref IS NULL OR length(project_ref) BETWEEN 3 AND 200),
  provenance_kind    TEXT    NOT NULL CHECK (provenance_kind IN ('RUN', 'WORK_ITEM', 'FOUNDER_CORRECTION', 'VALIDATED_LESSON', 'KNOWLEDGE', 'CANONICAL', 'SKILL_VERSION', 'ACADEMY')),
  provenance_ref     TEXT    NOT NULL CHECK (length(provenance_ref) BETWEEN 3 AND 200),
  source_version     INTEGER          CHECK (source_version IS NULL OR source_version >= 1),
  source_sha256      TEXT             CHECK (source_sha256 IS NULL OR (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*')),
  evidence_refs_json TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 4096),
  confidence_pct     INTEGER NOT NULL CHECK (confidence_pct BETWEEN 0 AND 100),
  status             TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE', 'SUPERSEDED', 'INCORRECT', 'ARCHIVED')),
  integrity          TEXT    NOT NULL DEFAULT 'OK' CHECK (integrity IN ('OK', 'CORRUPT')),
  retention_policy   TEXT    NOT NULL CHECK (length(retention_policy) BETWEEN 1 AND 64),
  review_at          TEXT             CHECK (review_at IS NULL OR review_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_validated_at  TEXT             CHECK (last_validated_at IS NULL OR last_validated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  candidate_id       TEXT             REFERENCES memory_candidates (id) ON DELETE RESTRICT,
  supersedes_id      TEXT             REFERENCES memory_records (id) ON DELETE RESTRICT,
  superseded_by_id   TEXT             REFERENCES memory_records (id) ON DELETE RESTRICT,
  version            INTEGER NOT NULL CHECK (version >= 1),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at         TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((claim_key IS NULL) = (claim_value IS NULL))
) STRICT;
CREATE INDEX memory_records_owner ON memory_records (employee_id, status, topic);
CREATE INDEX memory_records_claim ON memory_records (claim_key) WHERE claim_key IS NOT NULL;
CREATE UNIQUE INDEX memory_records_candidate ON memory_records (candidate_id) WHERE candidate_id IS NOT NULL;
CREATE TRIGGER memory_records_no_delete BEFORE DELETE ON memory_records BEGIN SELECT RAISE(ABORT, 'memory records are durable history'); END;
CREATE TRIGGER memory_records_content_immutable BEFORE UPDATE ON memory_records
WHEN NEW.id IS NOT OLD.id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.memory_class IS NOT OLD.memory_class OR NEW.scope IS NOT OLD.scope OR NEW.topic IS NOT OLD.topic
  OR NEW.claim_key IS NOT OLD.claim_key OR NEW.claim_value IS NOT OLD.claim_value OR NEW.content IS NOT OLD.content OR NEW.content_sha256 IS NOT OLD.content_sha256
  OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.data_class IS NOT OLD.data_class OR NEW.provenance_kind IS NOT OLD.provenance_kind OR NEW.provenance_ref IS NOT OLD.provenance_ref
  OR NEW.created_at IS NOT OLD.created_at OR NEW.supersedes_id IS NOT OLD.supersedes_id OR NEW.candidate_id IS NOT OLD.candidate_id OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'memory content and provenance are immutable; corrections supersede'); END;
CREATE TRIGGER memory_records_terminal_status BEFORE UPDATE OF status ON memory_records
WHEN (OLD.status IN ('SUPERSEDED', 'INCORRECT', 'ARCHIVED') AND NEW.status <> OLD.status) OR (OLD.integrity = 'CORRUPT' AND NEW.status = 'ACTIVE')
BEGIN SELECT RAISE(ABORT, 'a superseded, incorrect, archived or corrupt memory never returns to use'); END;
CREATE TRIGGER memory_records_integrity_sticky BEFORE UPDATE OF integrity ON memory_records
WHEN OLD.integrity = 'CORRUPT' AND NEW.integrity <> 'CORRUPT'
BEGIN SELECT RAISE(ABORT, 'a corrupt memory stays quarantined'); END;

CREATE TABLE memory_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id    TEXT    NOT NULL REFERENCES memory_records (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_status  TEXT,
  to_status    TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (memory_id, version)
) STRICT;
CREATE TRIGGER memory_history_append_only_u BEFORE UPDATE ON memory_history BEGIN SELECT RAISE(ABORT, 'memory history is append-only'); END;
CREATE TRIGGER memory_history_append_only_d BEFORE DELETE ON memory_history BEGIN SELECT RAISE(ABORT, 'memory history is append-only'); END;

-- Unresolved memory-vs-memory conflicts: both records and both provenance trails are kept; neither is
-- used as reliable until the conflict is resolved (correction or canonical truth).
CREATE TABLE memory_conflicts (
  id               TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  claim_key        TEXT NOT NULL CHECK (length(claim_key) BETWEEN 1 AND 96 AND claim_key NOT GLOB '*[^a-z0-9.-]*'),
  memory_a_id      TEXT NOT NULL REFERENCES memory_records (id) ON DELETE RESTRICT,
  memory_b_id      TEXT NOT NULL REFERENCES memory_records (id) ON DELETE RESTRICT,
  state            TEXT NOT NULL CHECK (state IN ('OPEN', 'RESOLVED')),
  resolution_ref   TEXT          CHECK (resolution_ref IS NULL OR length(resolution_ref) BETWEEN 3 AND 200),
  resolved_by_ref  TEXT          CHECK (resolved_by_ref IS NULL OR length(resolved_by_ref) BETWEEN 3 AND 161),
  created_at       TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  resolved_at      TEXT          CHECK (resolved_at IS NULL OR resolved_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (memory_a_id < memory_b_id),
  CHECK ((state = 'RESOLVED') = (resolved_at IS NOT NULL)),
  UNIQUE (memory_a_id, memory_b_id)
) STRICT;
CREATE INDEX memory_conflicts_open ON memory_conflicts (state) WHERE state = 'OPEN';
CREATE TRIGGER memory_conflicts_no_delete BEFORE DELETE ON memory_conflicts BEGIN SELECT RAISE(ABORT, 'memory conflicts are durable history'); END;
CREATE TRIGGER memory_conflicts_resolve_once BEFORE UPDATE ON memory_conflicts
WHEN OLD.state = 'RESOLVED' OR NEW.memory_a_id IS NOT OLD.memory_a_id OR NEW.memory_b_id IS NOT OLD.memory_b_id OR NEW.claim_key IS NOT OLD.claim_key
BEGIN SELECT RAISE(ABORT, 'a conflict is resolved once and its members never change'); END;

-- Founder corrections (Stage 5 §5): additive and auditable; the prior record is marked, never rewritten.
CREATE TABLE memory_corrections (
  id                   TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  memory_id            TEXT NOT NULL REFERENCES memory_records (id) ON DELETE RESTRICT,
  disposition          TEXT NOT NULL CHECK (disposition IN ('SUPERSEDED', 'INCORRECT', 'STALE')),
  corrected_memory_id  TEXT          REFERENCES memory_records (id) ON DELETE RESTRICT,
  reason_code          TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  context_ref          TEXT          CHECK (context_ref IS NULL OR length(context_ref) BETWEEN 3 AND 200),
  actor_ref            TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  created_at           TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (disposition <> 'SUPERSEDED' OR corrected_memory_id IS NOT NULL)
) STRICT;
CREATE TRIGGER memory_corrections_append_only_u BEFORE UPDATE ON memory_corrections BEGIN SELECT RAISE(ABORT, 'memory corrections is append-only'); END;
CREATE TRIGGER memory_corrections_append_only_d BEFORE DELETE ON memory_corrections BEGIN SELECT RAISE(ABORT, 'memory corrections is append-only'); END;

-- Learning validation (Stage 5 §4): EVENT / OUTCOME → OBSERVATION → LESSON_CANDIDATE → review →
-- VALIDATED / REJECTED. A mistake is not automatically a lesson; nothing here is memory or knowledge.
CREATE TABLE lessons (
  id                TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id       TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  stage             TEXT    NOT NULL CHECK (stage IN ('OBSERVATION', 'LESSON_CANDIDATE', 'UNDER_REVIEW', 'VALIDATED', 'REJECTED')),
  kind              TEXT    NOT NULL CHECK (kind IN ('OBSERVATION', 'LESSON')),
  observation_id    TEXT             REFERENCES lessons (id) ON DELETE RESTRICT,
  event_ref         TEXT    NOT NULL CHECK (length(event_ref) BETWEEN 3 AND 200),
  topic             TEXT    NOT NULL CHECK (length(topic) BETWEEN 1 AND 96 AND topic NOT GLOB '*[^a-z0-9.-]*'),
  claim_key         TEXT             CHECK (claim_key IS NULL OR (length(claim_key) BETWEEN 1 AND 96 AND claim_key NOT GLOB '*[^a-z0-9.-]*')),
  claim_value       TEXT             CHECK (claim_value IS NULL OR (length(claim_value) BETWEEN 1 AND 96 AND claim_value NOT GLOB '*[^a-z0-9.-]*')),
  content           TEXT    NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  content_sha256    TEXT    NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  fingerprint       TEXT    NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  terms_json        TEXT    NOT NULL CHECK (json_valid(terms_json) AND json_type(terms_json) = 'array' AND length(terms_json) <= 2048),
  data_class        TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  market_ref        TEXT             CHECK (market_ref IS NULL OR length(market_ref) BETWEEN 3 AND 200),
  candidate_id      TEXT             REFERENCES memory_candidates (id) ON DELETE RESTRICT,
  review_path       TEXT             CHECK (review_path IS NULL OR review_path IN ('FOUNDER', 'INDEPENDENT_REVIEW')),
  decided_by_ref    TEXT             CHECK (decided_by_ref IS NULL OR length(decided_by_ref) BETWEEN 3 AND 161),
  version           INTEGER NOT NULL CHECK (version >= 1),
  created_at        TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at        TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((kind = 'OBSERVATION') = (stage = 'OBSERVATION')),
  CHECK (kind = 'OBSERVATION' OR observation_id IS NOT NULL),
  CHECK (stage NOT IN ('VALIDATED', 'REJECTED') OR decided_by_ref IS NOT NULL)
) STRICT;
CREATE INDEX lessons_employee ON lessons (employee_id, stage);
CREATE TRIGGER lessons_no_delete BEFORE DELETE ON lessons BEGIN SELECT RAISE(ABORT, 'lessons are durable history'); END;
CREATE TRIGGER lessons_content_immutable BEFORE UPDATE ON lessons
WHEN NEW.content IS NOT OLD.content OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.employee_id IS NOT OLD.employee_id OR NEW.kind IS NOT OLD.kind
  OR NEW.observation_id IS NOT OLD.observation_id OR NEW.event_ref IS NOT OLD.event_ref OR NEW.market_ref IS NOT OLD.market_ref OR NEW.claim_key IS NOT OLD.claim_key
  OR NEW.claim_value IS NOT OLD.claim_value OR NEW.data_class IS NOT OLD.data_class OR NEW.version <> OLD.version + 1 OR OLD.stage IN ('VALIDATED', 'REJECTED', 'OBSERVATION')
BEGIN SELECT RAISE(ABORT, 'lesson content is immutable and a decided lesson is final'); END;

CREATE TABLE lesson_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id    TEXT    NOT NULL REFERENCES lessons (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_stage   TEXT,
  to_stage     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (lesson_id, version)
) STRICT;
CREATE TRIGGER lesson_history_append_only_u BEFORE UPDATE ON lesson_history BEGIN SELECT RAISE(ABORT, 'lesson history is append-only'); END;
CREATE TRIGGER lesson_history_append_only_d BEFORE DELETE ON lesson_history BEGIN SELECT RAISE(ABORT, 'lesson history is append-only'); END;

-- Company Knowledge (Stage 5 §2): scoped, validated, provenance-bearing. Scope refs are durable
-- references compatible with later C4 organization work (department id, role ref, market ref,
-- restricted scope code); C3 implements no organization management.
CREATE TABLE knowledge_items (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  scope              TEXT    NOT NULL CHECK (scope IN ('COMPANY', 'DEPARTMENT', 'ROLE', 'MARKET', 'RESTRICTED', 'FOUNDER_ONLY')),
  scope_ref          TEXT             CHECK (scope_ref IS NULL OR length(scope_ref) BETWEEN 3 AND 200),
  topic              TEXT    NOT NULL CHECK (length(topic) BETWEEN 1 AND 96 AND topic NOT GLOB '*[^a-z0-9.-]*'),
  claim_key          TEXT             CHECK (claim_key IS NULL OR (length(claim_key) BETWEEN 1 AND 96 AND claim_key NOT GLOB '*[^a-z0-9.-]*')),
  claim_value        TEXT             CHECK (claim_value IS NULL OR (length(claim_value) BETWEEN 1 AND 96 AND claim_value NOT GLOB '*[^a-z0-9.-]*')),
  content            TEXT    NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  content_sha256     TEXT    NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  fingerprint        TEXT    NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  terms_json         TEXT    NOT NULL CHECK (json_valid(terms_json) AND json_type(terms_json) = 'array' AND length(terms_json) <= 2048),
  data_class         TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  market_ref         TEXT             CHECK (market_ref IS NULL OR length(market_ref) BETWEEN 3 AND 200),
  provenance_kind    TEXT    NOT NULL CHECK (provenance_kind IN ('VALIDATED_LESSON', 'FOUNDER_DECISION', 'CANONICAL')),
  provenance_ref     TEXT    NOT NULL CHECK (length(provenance_ref) BETWEEN 3 AND 200),
  confidence_pct     INTEGER NOT NULL CHECK (confidence_pct BETWEEN 0 AND 100),
  status             TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'LOW_CONFIDENCE', 'STALE', 'SUPERSEDED', 'INCORRECT', 'ARCHIVED')),
  integrity          TEXT    NOT NULL DEFAULT 'OK' CHECK (integrity IN ('OK', 'CORRUPT')),
  review_at          TEXT             CHECK (review_at IS NULL OR review_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_validated_at  TEXT             CHECK (last_validated_at IS NULL OR last_validated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  supersedes_id      TEXT             REFERENCES knowledge_items (id) ON DELETE RESTRICT,
  superseded_by_id   TEXT             REFERENCES knowledge_items (id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  version            INTEGER NOT NULL CHECK (version >= 1),
  created_by_ref     TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at         TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((claim_key IS NULL) = (claim_value IS NULL)),
  CHECK ((scope IN ('COMPANY', 'FOUNDER_ONLY')) = (scope_ref IS NULL))
) STRICT;
CREATE INDEX knowledge_items_scope ON knowledge_items (scope, scope_ref, status);
CREATE UNIQUE INDEX knowledge_items_one_active_claim ON knowledge_items (scope, COALESCE(scope_ref, ''), claim_key) WHERE claim_key IS NOT NULL AND status IN ('ACTIVE', 'LOW_CONFIDENCE');
CREATE TRIGGER knowledge_items_no_delete BEFORE DELETE ON knowledge_items BEGIN SELECT RAISE(ABORT, 'knowledge items are durable history'); END;
CREATE TRIGGER knowledge_items_content_immutable BEFORE UPDATE ON knowledge_items
WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.scope_ref IS NOT OLD.scope_ref OR NEW.content IS NOT OLD.content OR NEW.content_sha256 IS NOT OLD.content_sha256
  OR NEW.claim_key IS NOT OLD.claim_key OR NEW.claim_value IS NOT OLD.claim_value OR NEW.data_class IS NOT OLD.data_class OR NEW.provenance_ref IS NOT OLD.provenance_ref
  OR NEW.provenance_kind IS NOT OLD.provenance_kind OR NEW.market_ref IS NOT OLD.market_ref OR NEW.terms_json IS NOT OLD.terms_json OR NEW.fingerprint IS NOT OLD.fingerprint
  OR NEW.topic IS NOT OLD.topic OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR (OLD.status IN ('SUPERSEDED', 'INCORRECT', 'ARCHIVED') AND NEW.status <> OLD.status) OR (OLD.integrity = 'CORRUPT' AND NEW.integrity <> 'CORRUPT')
BEGIN SELECT RAISE(ABORT, 'knowledge content, scope and provenance are immutable; changes supersede'); END;

CREATE TABLE knowledge_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_id  TEXT    NOT NULL REFERENCES knowledge_items (id) ON DELETE RESTRICT,
  version       INTEGER NOT NULL CHECK (version >= 1),
  from_status   TEXT,
  to_status     TEXT    NOT NULL,
  reason_code   TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref     TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at   TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (knowledge_id, version)
) STRICT;
CREATE TRIGGER knowledge_history_append_only_u BEFORE UPDATE ON knowledge_history BEGIN SELECT RAISE(ABORT, 'knowledge history is append-only'); END;
CREATE TRIGGER knowledge_history_append_only_d BEFORE DELETE ON knowledge_history BEGIN SELECT RAISE(ABORT, 'knowledge history is append-only'); END;

-- Promotion of a VALIDATED lesson (Stage 5 §10). PERSONAL stays with the Employee; every shared target
-- needs an independent review path. Until an authenticated one exists the request stays PENDING_REVIEW.
CREATE TABLE lesson_promotions (
  id                   TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  lesson_id            TEXT NOT NULL REFERENCES lessons (id) ON DELETE RESTRICT,
  target               TEXT NOT NULL CHECK (target IN ('PERSONAL', 'ROLE', 'DEPARTMENT', 'MARKET', 'COMPANY', 'RESTRICTED')),
  target_ref           TEXT          CHECK (target_ref IS NULL OR length(target_ref) BETWEEN 3 AND 200),
  state                TEXT NOT NULL CHECK (state IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED')),
  result_memory_id     TEXT          REFERENCES memory_records (id) ON DELETE RESTRICT,
  result_knowledge_id  TEXT          REFERENCES knowledge_items (id) ON DELETE RESTRICT,
  requested_by_ref     TEXT NOT NULL CHECK (length(requested_by_ref) BETWEEN 3 AND 161),
  decided_by_ref       TEXT          CHECK (decided_by_ref IS NULL OR length(decided_by_ref) BETWEEN 3 AND 161),
  reason_code          TEXT          CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
  created_at           TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_at           TEXT          CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'PENDING_REVIEW') = (decided_at IS NULL)),
  CHECK (state <> 'APPROVED' OR result_memory_id IS NOT NULL OR result_knowledge_id IS NOT NULL)
) STRICT;
-- One promotion per lesson and target (a NULL target_ref is one value here, not "distinct").
CREATE UNIQUE INDEX lesson_promotions_one ON lesson_promotions (lesson_id, target, COALESCE(target_ref, ''));
CREATE TRIGGER lesson_promotions_no_delete BEFORE DELETE ON lesson_promotions BEGIN SELECT RAISE(ABORT, 'lesson promotions are durable history'); END;
CREATE TRIGGER lesson_promotions_decided_once BEFORE UPDATE ON lesson_promotions
WHEN OLD.state <> 'PENDING_REVIEW' OR NEW.lesson_id IS NOT OLD.lesson_id OR NEW.target IS NOT OLD.target OR NEW.target_ref IS NOT OLD.target_ref
BEGIN SELECT RAISE(ABORT, 'a promotion is decided exactly once'); END;

-- Context Manifests (D13-E.8): one lightweight, durable record per inference. Entries carry IDs,
-- versions, hashes, classes, estimates and reason codes — never the assembled content.
CREATE TABLE context_manifests (
  id                      TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  run_id                  TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  work_item_id            TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id             TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  inference_seq           INTEGER NOT NULL CHECK (inference_seq BETWEEN 1 AND 100000),
  step                    INTEGER NOT NULL CHECK (step BETWEEN 0 AND 100000),
  outcome                 TEXT    NOT NULL CHECK (outcome IN ('OK', 'CONTEXT_BUDGET_EXHAUSTED', 'CONFLICT_HOLD', 'SKILL_CONFLICT', 'INTEGRITY_FAILURE')),
  policy_json             TEXT    NOT NULL CHECK (json_valid(policy_json) AND json_type(policy_json) = 'object' AND length(policy_json) <= 1024),
  total_budget            INTEGER NOT NULL CHECK (total_budget BETWEEN 1 AND 1000000),
  used_tokens             INTEGER NOT NULL CHECK (used_tokens BETWEEN 0 AND 100000000),
  estimated_input_tokens  INTEGER NOT NULL CHECK (estimated_input_tokens BETWEEN 0 AND 100000000),
  max_data_class          TEXT    NOT NULL CHECK (max_data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  per_layer_json          TEXT    NOT NULL CHECK (json_valid(per_layer_json) AND json_type(per_layer_json) = 'object' AND length(per_layer_json) <= 512),
  selected_count          INTEGER NOT NULL CHECK (selected_count >= 0),
  rejected_count          INTEGER NOT NULL CHECK (rejected_count >= 0),
  conflict_count          INTEGER NOT NULL CHECK (conflict_count >= 0),
  prefix_sha256           TEXT             CHECK (prefix_sha256 IS NULL OR (length(prefix_sha256) = 64 AND prefix_sha256 NOT GLOB '*[^0-9a-f]*')),
  messages_sha256         TEXT             CHECK (messages_sha256 IS NULL OR (length(messages_sha256) = 64 AND messages_sha256 NOT GLOB '*[^0-9a-f]*')),
  created_at              TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (outcome <> 'OK' OR (messages_sha256 IS NOT NULL AND estimated_input_tokens <= total_budget)),
  UNIQUE (run_id, inference_seq)
) STRICT;
CREATE INDEX context_manifests_work_item ON context_manifests (work_item_id, created_at);
CREATE TRIGGER context_manifests_append_only_u BEFORE UPDATE ON context_manifests BEGIN SELECT RAISE(ABORT, 'context manifests is append-only'); END;
CREATE TRIGGER context_manifests_append_only_d BEFORE DELETE ON context_manifests BEGIN SELECT RAISE(ABORT, 'context manifests is append-only'); END;

CREATE TABLE context_manifest_entries (
  manifest_id       TEXT    NOT NULL REFERENCES context_manifests (id) ON DELETE RESTRICT,
  ordinal           INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 10000),
  decision          TEXT    NOT NULL CHECK (decision IN ('SELECTED', 'REJECTED')),
  layer             TEXT    NOT NULL CHECK (layer IN ('AUTHORITY', 'WORK', 'SKILL', 'KNOWLEDGE', 'MEMORY', 'RECENT')),
  item_kind         TEXT    NOT NULL CHECK (item_kind IN ('PREAMBLE', 'CANONICAL', 'WORK_INSTRUCTIONS', 'ACADEMY_SCENARIO', 'SKILL', 'KNOWLEDGE', 'MEMORY', 'SUMMARY', 'CONFLICT_NOTICE', 'TOOL_RESULT')),
  item_id           TEXT    NOT NULL CHECK (length(item_id) BETWEEN 1 AND 64),
  item_version      INTEGER NOT NULL CHECK (item_version >= 0),
  item_sha256       TEXT    NOT NULL CHECK (length(item_sha256) = 64 AND item_sha256 NOT GLOB '*[^0-9a-f]*'),
  provenance_ref    TEXT    NOT NULL CHECK (length(provenance_ref) BETWEEN 3 AND 200),
  authority_weight  INTEGER NOT NULL CHECK (authority_weight BETWEEN 0 AND 100),
  status            TEXT    NOT NULL CHECK (length(status) BETWEEN 1 AND 64),
  stale             INTEGER NOT NULL CHECK (stale IN (0, 1)),
  data_class        TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  est_tokens        INTEGER NOT NULL CHECK (est_tokens BETWEEN 0 AND 10000000),
  score             INTEGER NOT NULL CHECK (score BETWEEN -1000 AND 10000),
  reason_code       TEXT             CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
  PRIMARY KEY (manifest_id, ordinal),
  CHECK ((decision = 'REJECTED') = (reason_code IS NOT NULL))
) STRICT, WITHOUT ROWID;
CREATE INDEX context_manifest_entries_item ON context_manifest_entries (item_id);
CREATE TRIGGER context_manifest_entries_append_only_u BEFORE UPDATE ON context_manifest_entries BEGIN SELECT RAISE(ABORT, 'context manifest entries is append-only'); END;
CREATE TRIGGER context_manifest_entries_append_only_d BEFORE DELETE ON context_manifest_entries BEGIN SELECT RAISE(ABORT, 'context manifest entries is append-only'); END;

-- Every model reservation names the Context Manifest of the inference it pays for (D13-E, D13-G):
-- no model call is reserved outside the governed Context Assembly path, and the reservation's input
-- bound is checked against the manifest's estimate.
ALTER TABLE budget_reservations ADD COLUMN context_manifest_id TEXT REFERENCES context_manifests (id) ON DELETE RESTRICT;
CREATE TRIGGER budget_reservations_model_call_manifest BEFORE INSERT ON budget_reservations
WHEN NEW.purpose = 'MODEL_CALL' AND (NEW.context_manifest_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM context_manifests m WHERE m.id = NEW.context_manifest_id AND m.run_id = NEW.run_id AND m.outcome = 'OK' AND NEW.tokens >= m.estimated_input_tokens))
BEGIN SELECT RAISE(ABORT, 'a model call is reserved only against its own OK context manifest and at least its estimated input'); END;
CREATE TRIGGER budget_reservations_manifest_immutable BEFORE UPDATE OF context_manifest_id ON budget_reservations
WHEN NEW.context_manifest_id IS NOT OLD.context_manifest_id
BEGIN SELECT RAISE(ABORT, 'the context manifest of a reservation is immutable'); END;

-- Derived compaction summaries (D13-E.7): never canonical truth; valid only while every source is
-- exactly as it was (fingerprint of source ids, versions, hashes and statuses); invalidated, never edited.
CREATE TABLE context_summaries (
  id                   TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id          TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  topic                TEXT NOT NULL CHECK (length(topic) BETWEEN 1 AND 96 AND topic NOT GLOB '*[^a-z0-9.-]*'),
  source_fingerprint   TEXT NOT NULL CHECK (length(source_fingerprint) BETWEEN 1 AND 20000),
  source_ids_json      TEXT NOT NULL CHECK (json_valid(source_ids_json) AND json_type(source_ids_json) = 'array' AND length(source_ids_json) <= 4096),
  content              TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  content_sha256       TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  data_class           TEXT NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  status               TEXT NOT NULL CHECK (status IN ('VALID', 'INVALIDATED')),
  invalidation_reason  TEXT          CHECK (invalidation_reason IS NULL OR length(invalidation_reason) BETWEEN 1 AND 64),
  created_at           TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  invalidated_at       TEXT          CHECK (invalidated_at IS NULL OR invalidated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((status = 'INVALIDATED') = (invalidated_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX context_summaries_one_valid ON context_summaries (employee_id, topic) WHERE status = 'VALID';
CREATE TRIGGER context_summaries_no_delete BEFORE DELETE ON context_summaries BEGIN SELECT RAISE(ABORT, 'context summaries are durable history'); END;
CREATE TRIGGER context_summaries_invalidate_only BEFORE UPDATE ON context_summaries
WHEN OLD.status = 'INVALIDATED' OR NEW.content IS NOT OLD.content OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.source_fingerprint IS NOT OLD.source_fingerprint OR NEW.source_ids_json IS NOT OLD.source_ids_json
BEGIN SELECT RAISE(ABORT, 'a summary is derived: it is invalidated, never edited'); END;
CREATE INDEX context_summaries_employee ON context_summaries (employee_id, status);

-- Term index for deterministic lexical retrieval (C3 §14): one row per (item, normalized term). A
-- pool query joins it with the task's query terms, so an assembly reads only relevant candidates
-- (bounded) and never scans an Employee's or the Company's full history. Terms of an item never change.
CREATE TABLE mind_terms (
  item_kind  TEXT NOT NULL CHECK (item_kind IN ('MEMORY', 'KNOWLEDGE', 'CANONICAL')),
  owner_key  TEXT NOT NULL CHECK (length(owner_key) <= 36),
  term       TEXT NOT NULL CHECK (length(term) BETWEEN 1 AND 64),
  item_id    TEXT NOT NULL CHECK (length(item_id) = 36),
  PRIMARY KEY (item_kind, owner_key, term, item_id)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER mind_terms_append_only_u BEFORE UPDATE ON mind_terms BEGIN SELECT RAISE(ABORT, 'mind terms is append-only'); END;
CREATE TRIGGER mind_terms_append_only_d BEFORE DELETE ON mind_terms BEGIN SELECT RAISE(ABORT, 'mind terms is append-only'); END;

-- Recent step results of a Work Item (context layer L6), recorded by the runtime's governed services
-- (tool executor results / refusals, memory decisions) — never supplied by a processor. One per step.
CREATE TABLE context_step_results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id    TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  run_id          TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  step            INTEGER NOT NULL CHECK (step BETWEEN 0 AND 100000),
  kind            TEXT    NOT NULL CHECK (kind IN ('TOOL_RESULT', 'TOOL_REFUSED', 'MEMORY_DECISION')),
  content         TEXT    NOT NULL CHECK (length(content) BETWEEN 1 AND 2048),
  content_sha256  TEXT    NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  data_class      TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (work_item_id, step)
) STRICT;
CREATE TRIGGER context_step_results_append_only_u BEFORE UPDATE ON context_step_results BEGIN SELECT RAISE(ABORT, 'context step results is append-only'); END;
CREATE TRIGGER context_step_results_append_only_d BEFORE DELETE ON context_step_results BEGIN SELECT RAISE(ABORT, 'context step results is append-only'); END;
