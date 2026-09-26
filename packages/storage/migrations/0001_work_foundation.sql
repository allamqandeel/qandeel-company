-- QANDEEL COMPANY operational schema — migration 0001: work foundation.
-- IMMUTABLE once released: the runtime refuses to start if this file's SHA-256 changes after it
-- has been applied. Schema changes are made by adding a new migration file.
--
-- Conventions: STRICT tables; ids are UUID text; timestamps are fixed-width ISO-8601 UTC text
-- (lexicographic order = chronological order); history is append-only; no cascading deletes.

CREATE TABLE work_items (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  root_id               TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  parent_id             TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  lineage_depth         INTEGER NOT NULL CHECK (lineage_depth BETWEEN 0 AND 32),
  objective             TEXT    NOT NULL CHECK (length(objective) BETWEEN 1 AND 4000),
  owner_ref             TEXT    NOT NULL CHECK (length(owner_ref) BETWEEN 3 AND 161),
  contributors_json     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(contributors_json) AND json_type(contributors_json) = 'array'),
  priority              INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 100),
  due_at                TEXT             CHECK (due_at IS NULL OR due_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  risk_level            TEXT    NOT NULL CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3', 'R4')),
  completion_criteria_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(completion_criteria_json)),
  required_evidence_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(required_evidence_json)),
  review_required       INTEGER NOT NULL CHECK (review_required IN (0, 1)),
  approval_required     INTEGER NOT NULL CHECK (approval_required IN (0, 1)),
  max_attempts          INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 25),
  processor_kind        TEXT             CHECK (processor_kind IS NULL OR length(processor_kind) BETWEEN 1 AND 64),
  processor_input_json  TEXT    NOT NULL DEFAULT 'null' CHECK (json_valid(processor_input_json)),
  state                 TEXT    NOT NULL CHECK (state IN ('PROPOSED', 'READY', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'BLOCKED',
                                  'WAITING_REVIEW', 'WAITING_APPROVAL', 'COMPLETED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED',
                                  'FAILED', 'CANCELLED', 'SUPERSEDED')),
  version               INTEGER NOT NULL CHECK (version >= 1),
  outcome               TEXT    NOT NULL DEFAULT 'NOT_ASSESSED' CHECK (outcome IN ('NOT_ASSESSED', 'ACHIEVED', 'NOT_ACHIEVED')),
  blocked_reason        TEXT             CHECK (blocked_reason IS NULL OR length(blocked_reason) <= 64),
  blocker_ref           TEXT             CHECK (blocker_ref IS NULL OR length(blocker_ref) <= 161),
  propagation_mode      TEXT    NOT NULL DEFAULT 'PROPAGATE' CHECK (propagation_mode IN ('PROPAGATE', 'INDEPENDENT')),
  termination_requested TEXT             CHECK (termination_requested IS NULL OR termination_requested IN ('CANCELLED', 'SUPERSEDED')),
  termination_reason    TEXT             CHECK (termination_reason IS NULL OR length(termination_reason) <= 64),
  superseded_by         TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  dedupe_key            TEXT             CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 1 AND 200),
  correlation_id        TEXT    NOT NULL CHECK (length(correlation_id) = 36),
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at            TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((parent_id IS NULL AND root_id = id AND lineage_depth = 0) OR (parent_id IS NOT NULL AND parent_id <> id AND lineage_depth > 0)),
  CHECK (state <> 'BLOCKED' OR blocked_reason IS NOT NULL),
  CHECK (state <> 'OUTCOME_VERIFIED' OR outcome = 'ACHIEVED'),
  CHECK (state <> 'SUPERSEDED' OR superseded_by IS NOT NULL),
  CHECK (superseded_by IS NULL OR superseded_by <> id)
) STRICT;

CREATE INDEX work_items_root ON work_items (root_id);
CREATE INDEX work_items_parent ON work_items (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX work_items_state ON work_items (state);
-- Deterministic duplicate prevention: one live Work Item per dedupe key.
CREATE UNIQUE INDEX work_items_live_dedupe ON work_items (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND state NOT IN ('CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED');

CREATE TRIGGER work_items_no_delete BEFORE DELETE ON work_items
BEGIN SELECT RAISE(ABORT, 'work items are never hard-deleted; cancel, supersede or close them'); END;

CREATE TRIGGER work_items_identity_immutable BEFORE UPDATE OF id, root_id, parent_id, lineage_depth, correlation_id, created_at ON work_items
WHEN NEW.id IS NOT OLD.id OR NEW.root_id IS NOT OLD.root_id OR NEW.parent_id IS NOT OLD.parent_id
  OR NEW.lineage_depth IS NOT OLD.lineage_depth OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'work item identity and lineage are immutable'); END;

-- No resurrection: a terminal Work Item never changes again (Stage 8; cancellation races, C1 §15).
CREATE TRIGGER work_items_terminal_frozen BEFORE UPDATE ON work_items
WHEN OLD.state IN ('CLOSED', 'FAILED', 'CANCELLED', 'SUPERSEDED')
BEGIN SELECT RAISE(ABORT, 'terminal work items are immutable'); END;

-- Stage 8 §34: closing never converts activity into success. ACHIEVED is recorded only through
-- OUTCOME_VERIFIED (CHECK above), and a close may carry it only from that state.
CREATE TRIGGER work_items_success_needs_verification BEFORE UPDATE OF state ON work_items
WHEN NEW.state = 'CLOSED' AND NEW.outcome = 'ACHIEVED' AND OLD.state <> 'OUTCOME_VERIFIED'
BEGIN SELECT RAISE(ABORT, 'ACHIEVED outcomes are recorded only through OUTCOME_VERIFIED'); END;

CREATE TRIGGER work_items_version_monotonic BEFORE UPDATE ON work_items
WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'work item version must increase by exactly one per update'); END;

CREATE TABLE work_item_dependencies (
  work_item_id   TEXT NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  depends_on_id  TEXT NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  resolved_at    TEXT          CHECK (resolved_at IS NULL OR resolved_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (work_item_id, depends_on_id),
  CHECK (work_item_id <> depends_on_id)
) STRICT, WITHOUT ROWID;

-- Targeted wake-up: resolving one dependency finds only its dependents.
CREATE INDEX work_item_dependencies_reverse ON work_item_dependencies (depends_on_id, work_item_id);

CREATE TRIGGER work_item_dependencies_no_delete BEFORE DELETE ON work_item_dependencies
BEGIN SELECT RAISE(ABORT, 'dependency edges are durable history'); END;

CREATE TABLE work_item_transitions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_id    TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  from_state      TEXT,
  to_state        TEXT    NOT NULL,
  version         INTEGER NOT NULL CHECK (version >= 1),
  reason_code     TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref       TEXT             CHECK (actor_ref IS NULL OR length(actor_ref) <= 161),
  correlation_id  TEXT    NOT NULL CHECK (length(correlation_id) = 36),
  causation_id    TEXT             CHECK (causation_id IS NULL OR length(causation_id) = 36),
  occurred_at     TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (work_item_id, version)
) STRICT;

CREATE TRIGGER work_item_transitions_append_only_u BEFORE UPDATE ON work_item_transitions
BEGIN SELECT RAISE(ABORT, 'state history is append-only'); END;
CREATE TRIGGER work_item_transitions_append_only_d BEFORE DELETE ON work_item_transitions
BEGIN SELECT RAISE(ABORT, 'state history is append-only'); END;

CREATE TABLE idempotency_records (
  scope         TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 64),
  idem_key      TEXT NOT NULL CHECK (length(idem_key) BETWEEN 1 AND 200),
  fingerprint   TEXT NOT NULL CHECK (length(fingerprint) = 64),
  result_ref    TEXT NOT NULL CHECK (length(result_ref) BETWEEN 1 AND 161),
  created_at    TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (scope, idem_key)
) STRICT, WITHOUT ROWID;

CREATE TRIGGER idempotency_records_immutable BEFORE UPDATE ON idempotency_records
BEGIN SELECT RAISE(ABORT, 'idempotency records are immutable'); END;

-- Durable outbox. Written in the same transaction as the state change it describes.
CREATE TABLE events (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT    NOT NULL UNIQUE CHECK (length(id) = 36),
  type            TEXT    NOT NULL CHECK (length(type) BETWEEN 1 AND 64),
  version         INTEGER NOT NULL CHECK (version >= 1),
  aggregate_type  TEXT    NOT NULL CHECK (aggregate_type IN ('work_item', 'job', 'run', 'artifact', 'runtime', 'backup')),
  aggregate_id    TEXT    NOT NULL CHECK (length(aggregate_id) = 36),
  correlation_id  TEXT    NOT NULL CHECK (length(correlation_id) = 36),
  causation_id    TEXT             CHECK (causation_id IS NULL OR length(causation_id) = 36),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  payload_json    TEXT    NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 2048),
  dispatched_at   TEXT             CHECK (dispatched_at IS NULL OR dispatched_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  dispatch_count  INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_count >= 0)
) STRICT;

CREATE INDEX events_pending ON events (seq) WHERE dispatched_at IS NULL;
CREATE INDEX events_aggregate ON events (aggregate_id, seq);

CREATE TRIGGER events_envelope_immutable BEFORE UPDATE ON events
WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.version IS NOT OLD.version
  OR NEW.aggregate_type IS NOT OLD.aggregate_type OR NEW.aggregate_id IS NOT OLD.aggregate_id
  OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.causation_id IS NOT OLD.causation_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.payload_json IS NOT OLD.payload_json
BEGIN SELECT RAISE(ABORT, 'event envelopes are immutable; only delivery metadata changes'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are durable history'); END;

-- Content-minimized audit trail: IDs, codes and outcomes only (Rule A).
CREATE TABLE audit_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at     TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  action          TEXT    NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  entity_type     TEXT    NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 32),
  entity_id       TEXT    NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 64),
  actor_ref       TEXT             CHECK (actor_ref IS NULL OR length(actor_ref) <= 161),
  correlation_id  TEXT             CHECK (correlation_id IS NULL OR length(correlation_id) = 36),
  causation_id    TEXT             CHECK (causation_id IS NULL OR length(causation_id) = 36),
  outcome         TEXT    NOT NULL CHECK (outcome IN ('OK', 'REJECTED', 'ERROR')),
  reason_code     TEXT             CHECK (reason_code IS NULL OR length(reason_code) <= 64),
  details_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(details_json) AND length(details_json) <= 1024)
) STRICT;

CREATE INDEX audit_events_entity ON audit_events (entity_id, id);

CREATE TRIGGER audit_events_append_only_u BEFORE UPDATE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END;
CREATE TRIGGER audit_events_append_only_d BEFORE DELETE ON audit_events
BEGIN SELECT RAISE(ABORT, 'audit trail is append-only'); END;

CREATE TABLE runtime_instances (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  pid              INTEGER NOT NULL CHECK (pid > 0),
  runtime_version  TEXT    NOT NULL CHECK (length(runtime_version) BETWEEN 1 AND 64),
  schema_version   INTEGER NOT NULL CHECK (schema_version >= 1),
  state            TEXT    NOT NULL CHECK (state IN ('STARTING', 'RECOVERING', 'READY', 'STOPPING', 'STOPPED', 'FAILED', 'ABANDONED')),
  supervisor_token INTEGER          CHECK (supervisor_token IS NULL OR supervisor_token >= 1),
  recovery_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(recovery_json) AND length(recovery_json) <= 4096),
  started_at       TEXT    NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at       TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  stopped_at       TEXT             CHECK (stopped_at IS NULL OR stopped_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;

CREATE TRIGGER runtime_instances_no_delete BEFORE DELETE ON runtime_instances
BEGIN SELECT RAISE(ABORT, 'runtime instance records are durable history'); END;

-- Singleton leases (the Runtime Supervisor). The fencing token only ever increases.
CREATE TABLE runtime_leases (
  name           TEXT    NOT NULL PRIMARY KEY CHECK (name IN ('supervisor')),
  holder_id      TEXT    NOT NULL CHECK (length(holder_id) = 36),
  fencing_token  INTEGER NOT NULL CHECK (fencing_token >= 1),
  acquired_at    TEXT    NOT NULL CHECK (acquired_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  renewed_at     TEXT    NOT NULL CHECK (renewed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  expires_at     TEXT    NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;

CREATE TRIGGER runtime_leases_token_monotonic BEFORE UPDATE ON runtime_leases
WHEN NEW.fencing_token < OLD.fencing_token OR (NEW.holder_id <> OLD.holder_id AND NEW.fencing_token <= OLD.fencing_token)
BEGIN SELECT RAISE(ABORT, 'lease fencing token must increase on every change of holder'); END;
CREATE TRIGGER runtime_leases_no_delete BEFORE DELETE ON runtime_leases
BEGIN SELECT RAISE(ABORT, 'leases are released by expiry, never deleted'); END;
