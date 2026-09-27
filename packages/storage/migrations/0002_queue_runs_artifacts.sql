-- QANDEEL COMPANY operational schema — migration 0002: durable queue, runs, checkpoints,
-- artifacts and backup records.
-- IMMUTABLE once released (see 0001).

-- Durable queue. The fencing token increases on every claim and on every forced lease release;
-- every worker write is conditional on the token it was issued (stale-worker fencing).
CREATE TABLE queue_jobs (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id        TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  root_work_item_id   TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  processor_kind      TEXT    NOT NULL CHECK (length(processor_kind) BETWEEN 1 AND 64),
  state               TEXT    NOT NULL CHECK (state IN ('QUEUED', 'CLAIMED', 'WAITING', 'RECONCILIATION_HOLD', 'DEAD_LETTER', 'DONE', 'FAILED', 'CANCELLED')),
  priority            INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
  available_at        TEXT    NOT NULL CHECK (available_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  attempt_count       INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts        INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 25),
  lease_owner         TEXT             CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 64),
  lease_expires_at    TEXT             CHECK (lease_expires_at IS NULL OR lease_expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  fencing_token       INTEGER NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  current_run_id      TEXT             CHECK (current_run_id IS NULL OR length(current_run_id) = 36),
  cancel_requested    INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  wait_reason         TEXT             CHECK (wait_reason IS NULL OR length(wait_reason) <= 64),
  dead_letter_reason  TEXT             CHECK (dead_letter_reason IS NULL OR length(dead_letter_reason) <= 64),
  last_failure_code   TEXT             CHECK (last_failure_code IS NULL OR length(last_failure_code) <= 64),
  requeue_count       INTEGER NOT NULL DEFAULT 0 CHECK (requeue_count >= 0),
  correlation_id      TEXT    NOT NULL CHECK (length(correlation_id) = 36),
  created_at          TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at          TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'CLAIMED') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND current_run_id IS NOT NULL)),
  CHECK (state <> 'DEAD_LETTER' OR dead_letter_reason IS NOT NULL),
  CHECK (attempt_count <= max_attempts)
) STRICT;

-- At most one live job per Work Item.
CREATE UNIQUE INDEX queue_jobs_one_live_per_item ON queue_jobs (work_item_id)
  WHERE state IN ('QUEUED', 'CLAIMED', 'WAITING', 'RECONCILIATION_HOLD', 'DEAD_LETTER');
-- Deterministic claim order: persisted priority, then due time, then creation, then id.
CREATE INDEX queue_jobs_claim_order ON queue_jobs (priority DESC, available_at, created_at, id) WHERE state = 'QUEUED';
CREATE INDEX queue_jobs_due ON queue_jobs (available_at) WHERE state = 'QUEUED';
CREATE INDEX queue_jobs_leases ON queue_jobs (lease_expires_at) WHERE state = 'CLAIMED';
CREATE INDEX queue_jobs_state ON queue_jobs (state);

CREATE TRIGGER queue_jobs_token_monotonic BEFORE UPDATE ON queue_jobs
WHEN NEW.fencing_token < OLD.fencing_token
BEGIN SELECT RAISE(ABORT, 'job fencing token must never decrease'); END;
CREATE TRIGGER queue_jobs_final_frozen BEFORE UPDATE ON queue_jobs
WHEN OLD.state IN ('DONE', 'FAILED', 'CANCELLED')
BEGIN SELECT RAISE(ABORT, 'final jobs are immutable'); END;
CREATE TRIGGER queue_jobs_no_delete BEFORE DELETE ON queue_jobs
BEGIN SELECT RAISE(ABORT, 'jobs are durable history'); END;

CREATE TABLE runs (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  job_id                TEXT    NOT NULL REFERENCES queue_jobs (id) ON DELETE RESTRICT,
  work_item_id          TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  run_seq               INTEGER NOT NULL CHECK (run_seq >= 1),
  attempt               INTEGER NOT NULL CHECK (attempt >= 1),
  processor_kind        TEXT    NOT NULL CHECK (length(processor_kind) BETWEEN 1 AND 64),
  side_effects          TEXT    NOT NULL CHECK (side_effects IN ('NONE', 'IDEMPOTENT', 'UNSAFE')),
  state                 TEXT    NOT NULL CHECK (state IN ('RUNNING', 'SUCCEEDED', 'PARKED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT',
                                  'RECONCILIATION_REQUIRED', 'CANCELLED', 'INTERRUPTED')),
  worker_id             TEXT    NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 64),
  fencing_token         INTEGER NOT NULL CHECK (fencing_token >= 1),
  checkpoint_seq        INTEGER NOT NULL DEFAULT 0 CHECK (checkpoint_seq >= 0),
  retry_of_run_id       TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  correlation_id        TEXT    NOT NULL CHECK (length(correlation_id) = 36),
  failure_code          TEXT             CHECK (failure_code IS NULL OR length(failure_code) <= 64),
  failure_category      TEXT             CHECK (failure_category IS NULL OR failure_category IN
                                  ('RETRYABLE', 'PERMANENT', 'RECONCILIATION', 'INTERRUPTED', 'TIMEOUT', 'CANCELLED')),
  recovery_disposition  TEXT             CHECK (recovery_disposition IS NULL OR recovery_disposition IN
                                  ('SAFE_TO_RESUME', 'SAFE_TO_RETRY', 'RECONCILIATION_REQUIRED')),
  result_json           TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(result_json) AND length(result_json) <= 4096),
  started_at            TEXT    NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  ended_at              TEXT             CHECK (ended_at IS NULL OR ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'RUNNING') = (ended_at IS NULL)),
  UNIQUE (job_id, run_seq)
) STRICT;

CREATE UNIQUE INDEX runs_one_running_per_job ON runs (job_id) WHERE state = 'RUNNING';
CREATE INDEX runs_work_item ON runs (work_item_id);
CREATE INDEX runs_running ON runs (state) WHERE state = 'RUNNING';

-- A finished run is history: a stale worker can never rewrite it.
CREATE TRIGGER runs_finished_frozen BEFORE UPDATE ON runs
WHEN OLD.state <> 'RUNNING'
BEGIN SELECT RAISE(ABORT, 'finished runs are immutable'); END;
CREATE TRIGGER runs_no_delete BEFORE DELETE ON runs
BEGIN SELECT RAISE(ABORT, 'runs are durable history'); END;

CREATE TABLE run_checkpoints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  job_id        TEXT    NOT NULL REFERENCES queue_jobs (id) ON DELETE RESTRICT,
  seq           INTEGER NOT NULL CHECK (seq >= 1),
  kind          TEXT    NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
  kind_version  INTEGER NOT NULL CHECK (kind_version >= 1),
  state_json    TEXT    NOT NULL CHECK (json_valid(state_json) AND length(state_json) <= 65536),
  sha256        TEXT    NOT NULL CHECK (length(sha256) = 64),
  created_at    TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (run_id, seq)
) STRICT;

CREATE INDEX run_checkpoints_job ON run_checkpoints (job_id, id);

CREATE TRIGGER run_checkpoints_append_only_u BEFORE UPDATE ON run_checkpoints
BEGIN SELECT RAISE(ABORT, 'checkpoints are append-only'); END;
CREATE TRIGGER run_checkpoints_append_only_d BEFORE DELETE ON run_checkpoints
BEGIN SELECT RAISE(ABORT, 'checkpoints are append-only'); END;

-- Artifact metadata. Content lives outside SQLite in a content-addressed object store; a row is
-- READY only after its object exists and its hash was verified.
CREATE TABLE artifacts (
  id            TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  sha256        TEXT    NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes    INTEGER NOT NULL CHECK (size_bytes >= 0),
  media_type    TEXT    NOT NULL CHECK (length(media_type) BETWEEN 3 AND 100),
  label         TEXT             CHECK (label IS NULL OR length(label) <= 200),
  state         TEXT    NOT NULL CHECK (state IN ('STAGED', 'READY', 'MISSING', 'CORRUPT', 'ABANDONED')),
  work_item_id  TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  run_id        TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  correlation_id TEXT            CHECK (correlation_id IS NULL OR length(correlation_id) = 36),
  created_at    TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at    TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  verified_at   TEXT             CHECK (verified_at IS NULL OR verified_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE INDEX artifacts_sha256 ON artifacts (sha256);
CREATE INDEX artifacts_state ON artifacts (state);
CREATE INDEX artifacts_work_item ON artifacts (work_item_id) WHERE work_item_id IS NOT NULL;

CREATE TRIGGER artifacts_identity_immutable BEFORE UPDATE OF id, sha256, size_bytes, created_at ON artifacts
WHEN NEW.id IS NOT OLD.id OR NEW.sha256 IS NOT OLD.sha256 OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'artifact identity and content hash are immutable'); END;
CREATE TRIGGER artifacts_no_delete BEFORE DELETE ON artifacts
BEGIN SELECT RAISE(ABORT, 'artifact metadata is durable history'); END;

CREATE TABLE backup_records (
  id                TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  created_at        TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  schema_version    INTEGER NOT NULL CHECK (schema_version >= 1),
  snapshot_sha256   TEXT    NOT NULL CHECK (length(snapshot_sha256) = 64),
  manifest_sha256   TEXT    NOT NULL CHECK (length(manifest_sha256) = 64),
  integrity_result  TEXT    NOT NULL CHECK (integrity_result IN ('ok', 'failed')),
  artifact_count    INTEGER NOT NULL CHECK (artifact_count >= 0)
) STRICT;

CREATE TRIGGER backup_records_append_only_u BEFORE UPDATE ON backup_records
BEGIN SELECT RAISE(ABORT, 'backup records are append-only'); END;
CREATE TRIGGER backup_records_append_only_d BEFORE DELETE ON backup_records
BEGIN SELECT RAISE(ABORT, 'backup records are append-only'); END;
