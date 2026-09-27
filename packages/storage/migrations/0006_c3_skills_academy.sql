-- QANDEEL COMPANY operational schema — migration 0006: C3 Skills, Role Skill Blueprints, Employee
-- Skill Passports, Capability Requirements / Gaps and the QANDEEL Academy (Stage 6, Stage 7).
-- IMMUTABLE once released (see 0001). Migrations 0001–0005 are unchanged.
--
-- Skill ≠ Tool ≠ Authority: nothing here grants a tool or a permission (C2 grants stay the only
-- tool authority). External Skill payloads are inert, bounded, hashed data — never executed.
-- Certification is necessary but not sufficient for ACTIVE: the employees activation gate below
-- also requires a Probation Review and an APPROVED Activation Request.

CREATE TABLE skills (
  id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code            TEXT    NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 96 AND code NOT GLOB '*[^a-z0-9.-]*'),
  name            TEXT    NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  skill_type      TEXT    NOT NULL CHECK (skill_type IN ('EXTERNAL', 'ADAPTED', 'QANDEEL_NATIVE')),
  owner_ref       TEXT    NOT NULL CHECK (length(owner_ref) BETWEEN 3 AND 161),
  market_code     TEXT             CHECK (market_code IS NULL OR (length(market_code) BETWEEN 2 AND 32 AND market_code NOT GLOB '*[^a-z0-9-]*')),
  status          TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  version         INTEGER NOT NULL CHECK (version >= 1),
  created_by_ref  TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at      TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER skills_no_delete BEFORE DELETE ON skills BEGIN SELECT RAISE(ABORT, 'skills are durable history'); END;
CREATE TRIGGER skills_identity_immutable BEFORE UPDATE ON skills
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.skill_type IS NOT OLD.skill_type OR NEW.created_at IS NOT OLD.created_at OR OLD.status = 'RETIRED' OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'skill identity is immutable; a retired skill is history'); END;

-- One row per pinned Skill version / revision: provenance, license, dependencies, requested tools
-- (informational only), directives, the inert instruction payload and its hash, pipeline and freshness.
CREATE TABLE skill_versions (
  id                          TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  skill_id                    TEXT    NOT NULL REFERENCES skills (id) ON DELETE RESTRICT,
  version_label               TEXT    NOT NULL CHECK (length(version_label) BETWEEN 1 AND 32 AND version_label NOT GLOB '*[^A-Za-z0-9.+-]*'),
  source_ref                  TEXT    NOT NULL CHECK (length(source_ref) BETWEEN 3 AND 200),
  source_revision             TEXT    NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 64),
  author_ref                  TEXT    NOT NULL CHECK (length(author_ref) BETWEEN 3 AND 161),
  acquired_at                 TEXT    NOT NULL CHECK (acquired_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  license_spdx                TEXT             CHECK (license_spdx IS NULL OR length(license_spdx) BETWEEN 1 AND 64),
  license_status              TEXT    NOT NULL CHECK (license_status IN ('CLEAR_FREE', 'QANDEEL_OWNED', 'REVIEW_REQUIRED', 'CLEARED_BY_REVIEW', 'UNCLEAR', 'NOT_FREE')),
  license_review_ref          TEXT             CHECK (license_review_ref IS NULL OR length(license_review_ref) BETWEEN 3 AND 200),
  dependencies_json           TEXT    NOT NULL CHECK (json_valid(dependencies_json) AND json_type(dependencies_json) = 'array' AND length(dependencies_json) <= 8192),
  paid_dependency             INTEGER NOT NULL CHECK (paid_dependency IN (0, 1)),
  paid_dependency_ack_ref     TEXT             CHECK (paid_dependency_ack_ref IS NULL OR length(paid_dependency_ack_ref) BETWEEN 3 AND 161),
  compatibility_json          TEXT    NOT NULL CHECK (json_valid(compatibility_json) AND json_type(compatibility_json) = 'object' AND length(compatibility_json) <= 2048),
  requested_tools_json        TEXT    NOT NULL CHECK (json_valid(requested_tools_json) AND json_type(requested_tools_json) = 'array' AND length(requested_tools_json) <= 2048),
  directives_json             TEXT    NOT NULL CHECK (json_valid(directives_json) AND json_type(directives_json) = 'object' AND length(directives_json) <= 4096),
  instructions                TEXT    NOT NULL CHECK (length(instructions) BETWEEN 1 AND 16000),
  instructions_sha256         TEXT    NOT NULL CHECK (length(instructions_sha256) = 64 AND instructions_sha256 NOT GLOB '*[^0-9a-f]*'),
  terms_json                  TEXT    NOT NULL CHECK (json_valid(terms_json) AND json_type(terms_json) = 'array' AND length(terms_json) <= 2048),
  inspection_findings_json    TEXT             CHECK (inspection_findings_json IS NULL OR (json_valid(inspection_findings_json) AND json_type(inspection_findings_json) = 'array' AND length(inspection_findings_json) <= 512)),
  security_status             TEXT    NOT NULL CHECK (security_status IN ('PENDING', 'CLEARED', 'FAILED')),
  benchmark_refs_json         TEXT    NOT NULL CHECK (json_valid(benchmark_refs_json) AND json_type(benchmark_refs_json) = 'array' AND length(benchmark_refs_json) <= 4096),
  pipeline_state              TEXT    NOT NULL CHECK (pipeline_state IN ('DISCOVERED', 'INSPECTED', 'LICENSE_DEPENDENCY_CHECKED', 'SECURITY_QUARANTINE', 'SANDBOXED', 'BENCHMARKED', 'COMPARED', 'APPROVED', 'TARGETED_LEARNING', 'ROLLED_OUT', 'REJECTED')),
  freshness                   TEXT    NOT NULL CHECK (freshness IN ('CURRENT', 'REVIEW_DUE', 'UPDATE_AVAILABLE', 'DEPRECATED', 'SECURITY_HOLD', 'RETIRED')),
  integrity                   TEXT    NOT NULL DEFAULT 'OK' CHECK (integrity IN ('OK', 'CORRUPT')),
  failure_reason              TEXT             CHECK (failure_reason IS NULL OR length(failure_reason) BETWEEN 1 AND 64),
  previous_version_id         TEXT             REFERENCES skill_versions (id) ON DELETE RESTRICT,
  approved_by_ref             TEXT             CHECK (approved_by_ref IS NULL OR length(approved_by_ref) BETWEEN 3 AND 161),
  version                     INTEGER NOT NULL CHECK (version >= 1),
  created_at                  TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at                  TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (skill_id, version_label),
  CHECK (pipeline_state <> 'REJECTED' OR failure_reason IS NOT NULL),
  CHECK (pipeline_state NOT IN ('APPROVED', 'TARGETED_LEARNING', 'ROLLED_OUT') OR (approved_by_ref IS NOT NULL AND security_status = 'CLEARED' AND license_status IN ('CLEAR_FREE', 'QANDEEL_OWNED', 'CLEARED_BY_REVIEW') AND inspection_findings_json = '[]' AND (paid_dependency = 0 OR paid_dependency_ack_ref IS NOT NULL)))
) STRICT;
CREATE INDEX skill_versions_skill ON skill_versions (skill_id, pipeline_state);
CREATE TRIGGER skill_versions_no_delete BEFORE DELETE ON skill_versions BEGIN SELECT RAISE(ABORT, 'skill versions are durable history'); END;
CREATE TRIGGER skill_versions_payload_immutable BEFORE UPDATE ON skill_versions
WHEN NEW.id IS NOT OLD.id OR NEW.skill_id IS NOT OLD.skill_id OR NEW.version_label IS NOT OLD.version_label OR NEW.source_ref IS NOT OLD.source_ref OR NEW.source_revision IS NOT OLD.source_revision
  OR NEW.instructions IS NOT OLD.instructions OR NEW.instructions_sha256 IS NOT OLD.instructions_sha256 OR NEW.directives_json IS NOT OLD.directives_json
  OR NEW.dependencies_json IS NOT OLD.dependencies_json OR NEW.paid_dependency IS NOT OLD.paid_dependency OR NEW.license_spdx IS NOT OLD.license_spdx
  OR NEW.requested_tools_json IS NOT OLD.requested_tools_json OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR (OLD.pipeline_state IN ('REJECTED', 'ROLLED_OUT') AND NEW.pipeline_state <> OLD.pipeline_state)
  OR (OLD.freshness = 'RETIRED' AND NEW.freshness <> 'RETIRED') OR (OLD.integrity = 'CORRUPT' AND NEW.integrity <> 'CORRUPT')
  OR (OLD.license_review_ref IS NOT NULL AND NEW.license_review_ref IS NOT OLD.license_review_ref)
  OR (NEW.license_status = 'CLEARED_BY_REVIEW' AND OLD.license_status NOT IN ('REVIEW_REQUIRED', 'CLEARED_BY_REVIEW'))
  OR (NEW.license_status = 'CLEARED_BY_REVIEW' AND NEW.license_review_ref IS NULL)
BEGIN SELECT RAISE(ABORT, 'a skill version is pinned: its payload and provenance never change'); END;

CREATE TABLE skill_version_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_version_id  TEXT    NOT NULL REFERENCES skill_versions (id) ON DELETE RESTRICT,
  version           INTEGER NOT NULL CHECK (version >= 1),
  change_kind       TEXT    NOT NULL CHECK (change_kind IN ('REGISTERED', 'PIPELINE', 'FRESHNESS', 'PAID_DEPENDENCY_ACK', 'INTEGRITY', 'LICENSE_REVIEW')),
  from_value        TEXT,
  to_value          TEXT    NOT NULL CHECK (length(to_value) <= 64),
  reason_code       TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  evidence_ref      TEXT             CHECK (evidence_ref IS NULL OR length(evidence_ref) BETWEEN 3 AND 200),
  actor_ref         TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at       TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (skill_version_id, version)
) STRICT;
CREATE TRIGGER skill_version_history_append_only_u BEFORE UPDATE ON skill_version_history BEGIN SELECT RAISE(ABORT, 'skill version history is append-only'); END;
CREATE TRIGGER skill_version_history_append_only_d BEFORE DELETE ON skill_version_history BEGIN SELECT RAISE(ABORT, 'skill version history is append-only'); END;

-- Continuous Skill Intelligence intake (Stage 7 §22): deduplicated discovery records. One intake per
-- source revision; repeated sightings only count (no Employee re-researches the same update).
CREATE TABLE skill_discoveries (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  fingerprint        TEXT    NOT NULL UNIQUE CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  skill_code         TEXT    NOT NULL CHECK (length(skill_code) BETWEEN 1 AND 96 AND skill_code NOT GLOB '*[^a-z0-9.-]*'),
  source_ref         TEXT    NOT NULL CHECK (length(source_ref) BETWEEN 3 AND 200),
  source_revision    TEXT    NOT NULL CHECK (length(source_revision) BETWEEN 1 AND 64),
  discovered_by_ref  TEXT    NOT NULL CHECK (length(discovered_by_ref) BETWEEN 3 AND 161),
  state              TEXT    NOT NULL CHECK (state IN ('NEW', 'INTAKEN', 'DISMISSED')),
  skill_version_id   TEXT             REFERENCES skill_versions (id) ON DELETE RESTRICT,
  seen_count         INTEGER NOT NULL CHECK (seen_count >= 1),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at         TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER skill_discoveries_no_delete BEFORE DELETE ON skill_discoveries BEGIN SELECT RAISE(ABORT, 'skill discoveries are durable history'); END;
CREATE TRIGGER skill_discoveries_identity_immutable BEFORE UPDATE ON skill_discoveries
WHEN NEW.id IS NOT OLD.id OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.skill_code IS NOT OLD.skill_code OR NEW.source_ref IS NOT OLD.source_ref
  OR NEW.source_revision IS NOT OLD.source_revision OR NEW.discovered_by_ref IS NOT OLD.discovered_by_ref OR NEW.created_at IS NOT OLD.created_at
  OR NEW.seen_count < OLD.seen_count OR (OLD.skill_version_id IS NOT NULL AND NEW.skill_version_id IS NOT OLD.skill_version_id)
BEGIN SELECT RAISE(ABORT, 'a discovery record is identified by its source; only its intake state and sighting count move'); END;

-- Material version updates: impact set (IDs only), recertification impact, rollout and rollback target.
CREATE TABLE skill_updates (
  id                      TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  skill_id                TEXT    NOT NULL REFERENCES skills (id) ON DELETE RESTRICT,
  from_version_id         TEXT    NOT NULL REFERENCES skill_versions (id) ON DELETE RESTRICT,
  to_version_id           TEXT    NOT NULL REFERENCES skill_versions (id) ON DELETE RESTRICT,
  material                INTEGER NOT NULL CHECK (material IN (0, 1)),
  recertification_impact  TEXT    NOT NULL CHECK (recertification_impact IN ('NONE', 'TARGETED', 'PARTIAL', 'FULL')),
  impact_json             TEXT    NOT NULL CHECK (json_valid(impact_json) AND json_type(impact_json) = 'object' AND length(impact_json) <= 65536),
  rollback_target_id      TEXT    NOT NULL REFERENCES skill_versions (id) ON DELETE RESTRICT,
  state                   TEXT    NOT NULL CHECK (state IN ('PLANNED', 'ROLLED_OUT', 'ROLLED_BACK', 'CANCELLED')),
  planned_by_ref          TEXT    NOT NULL CHECK (length(planned_by_ref) BETWEEN 3 AND 161),
  version                 INTEGER NOT NULL CHECK (version >= 1),
  created_at              TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at              TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (from_version_id <> to_version_id),
  CHECK (material = 1 OR recertification_impact = 'NONE')
) STRICT;
CREATE TRIGGER skill_updates_no_delete BEFORE DELETE ON skill_updates BEGIN SELECT RAISE(ABORT, 'skill updates are durable history'); END;
CREATE TRIGGER skill_updates_forward_only BEFORE UPDATE ON skill_updates
WHEN NEW.from_version_id IS NOT OLD.from_version_id OR NEW.to_version_id IS NOT OLD.to_version_id OR NEW.impact_json IS NOT OLD.impact_json OR NEW.rollback_target_id IS NOT OLD.rollback_target_id
  OR OLD.state IN ('ROLLED_BACK', 'CANCELLED') OR (OLD.state = 'ROLLED_OUT' AND NEW.state <> 'ROLLED_BACK') OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'a skill update moves forward only; its impact set and rollback target are immutable'); END;

-- Role Skill Blueprints (Stage 7 §2): versioned; C4 manages the organization, C3 the blueprint contract.
CREATE TABLE role_blueprints (
  id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  role_ref        TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*'),
  version         INTEGER NOT NULL CHECK (version >= 1),
  status          TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  created_by_ref  TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (role_ref, version)
) STRICT;
CREATE UNIQUE INDEX role_blueprints_one_active ON role_blueprints (role_ref) WHERE status = 'ACTIVE';
CREATE TRIGGER role_blueprints_no_delete BEFORE DELETE ON role_blueprints BEGIN SELECT RAISE(ABORT, 'role blueprints are durable history'); END;
CREATE TRIGGER role_blueprints_supersede_only BEFORE UPDATE ON role_blueprints
WHEN NEW.id IS NOT OLD.id OR NEW.role_ref IS NOT OLD.role_ref OR NEW.version IS NOT OLD.version OR OLD.status = 'SUPERSEDED'
BEGIN SELECT RAISE(ABORT, 'a blueprint version is immutable; a new version supersedes it'); END;

CREATE TABLE role_blueprint_entries (
  blueprint_id     TEXT    NOT NULL REFERENCES role_blueprints (id) ON DELETE RESTRICT,
  skill_id         TEXT    NOT NULL REFERENCES skills (id) ON DELETE RESTRICT,
  category         TEXT    NOT NULL CHECK (category IN ('REQUIRED', 'OPTIONAL', 'ADVANCED', 'MANAGEMENT', 'MARKET', 'OPERATING')),
  min_proficiency  TEXT    NOT NULL CHECK (min_proficiency IN ('LEARNING', 'QUALIFIED', 'PROFICIENT', 'EXPERT')),
  critical         INTEGER NOT NULL CHECK (critical IN (0, 1)),
  PRIMARY KEY (blueprint_id, skill_id)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER role_blueprint_entries_append_only_u BEFORE UPDATE ON role_blueprint_entries BEGIN SELECT RAISE(ABORT, 'role blueprint entries is append-only'); END;
CREATE TRIGGER role_blueprint_entries_append_only_d BEFORE DELETE ON role_blueprint_entries BEGIN SELECT RAISE(ABORT, 'role blueprint entries is append-only'); END;

-- Employee Skill Passports (Stage 7 §3): one entry per Employee and Skill, pinned to one version.
CREATE TABLE passport_entries (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id        TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  skill_id           TEXT    NOT NULL REFERENCES skills (id) ON DELETE RESTRICT,
  skill_version_id   TEXT    NOT NULL REFERENCES skill_versions (id) ON DELETE RESTRICT,
  proficiency        TEXT    NOT NULL CHECK (proficiency IN ('LEARNING', 'QUALIFIED', 'PROFICIENT', 'EXPERT')),
  status             TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'RECERTIFICATION_REQUIRED', 'SUSPENDED', 'REVOKED')),
  training_state     TEXT    NOT NULL CHECK (training_state IN ('NOT_STARTED', 'IN_TRAINING', 'TRAINED', 'RETRAINING_REQUIRED')),
  evidence_refs_json TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 4096),
  provenance_ref     TEXT    NOT NULL CHECK (length(provenance_ref) BETWEEN 3 AND 200),
  restrictions_json  TEXT    NOT NULL CHECK (json_valid(restrictions_json) AND json_type(restrictions_json) = 'array' AND length(restrictions_json) <= 1024),
  last_tested_at     TEXT             CHECK (last_tested_at IS NULL OR last_tested_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  version            INTEGER NOT NULL CHECK (version >= 1),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at         TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (employee_id, skill_id),
  -- Proficiency beyond LEARNING is established only by Academy certification evidence (never by a model or a grant).
  CHECK (proficiency = 'LEARNING' OR provenance_ref GLOB 'certification:*')
) STRICT;
CREATE INDEX passport_entries_version ON passport_entries (skill_version_id);
CREATE TRIGGER passport_entries_no_delete BEFORE DELETE ON passport_entries BEGIN SELECT RAISE(ABORT, 'passport entries are durable history'); END;
CREATE TRIGGER passport_entries_identity_immutable BEFORE UPDATE ON passport_entries
WHEN NEW.id IS NOT OLD.id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.skill_id IS NOT OLD.skill_id OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1 OR OLD.status = 'REVOKED'
BEGIN SELECT RAISE(ABORT, 'a passport entry belongs to one Employee and Skill; a revoked entry is history'); END;
-- A passport may only pin a version of its own Skill that is production-eligible by its stored state.
CREATE TRIGGER passport_entries_pin_i BEFORE INSERT ON passport_entries
WHEN NOT EXISTS (SELECT 1 FROM skill_versions v WHERE v.id = NEW.skill_version_id AND v.skill_id = NEW.skill_id AND v.pipeline_state IN ('APPROVED', 'TARGETED_LEARNING', 'ROLLED_OUT') AND v.freshness NOT IN ('SECURITY_HOLD', 'RETIRED', 'DEPRECATED') AND v.integrity = 'OK')
BEGIN SELECT RAISE(ABORT, 'a passport pins only an approved, current version of its own skill'); END;
CREATE TRIGGER passport_entries_pin_u BEFORE UPDATE OF skill_version_id ON passport_entries
WHEN NEW.skill_version_id IS NOT OLD.skill_version_id AND NOT EXISTS (SELECT 1 FROM skill_versions v WHERE v.id = NEW.skill_version_id AND v.skill_id = NEW.skill_id AND v.pipeline_state IN ('APPROVED', 'TARGETED_LEARNING', 'ROLLED_OUT') AND v.freshness NOT IN ('SECURITY_HOLD', 'RETIRED', 'DEPRECATED') AND v.integrity = 'OK')
BEGIN SELECT RAISE(ABORT, 'a passport re-pins only to an approved, current version of its own skill'); END;

CREATE TABLE passport_history (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  passport_entry_id  TEXT    NOT NULL REFERENCES passport_entries (id) ON DELETE RESTRICT,
  version            INTEGER NOT NULL CHECK (version >= 1),
  skill_version_id   TEXT    NOT NULL,
  proficiency        TEXT    NOT NULL,
  status             TEXT    NOT NULL,
  reason_code        TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref          TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at        TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (passport_entry_id, version)
) STRICT;
CREATE TRIGGER passport_history_append_only_u BEFORE UPDATE ON passport_history BEGIN SELECT RAISE(ABORT, 'passport history is append-only'); END;
CREATE TRIGGER passport_history_append_only_d BEFORE DELETE ON passport_history BEGIN SELECT RAISE(ABORT, 'passport history is append-only'); END;

-- Capability requirements of a Work Item (Stage 7 §16), declared before release and immutable after.
CREATE TABLE work_item_capabilities (
  work_item_id           TEXT NOT NULL PRIMARY KEY REFERENCES work_items (id) ON DELETE RESTRICT,
  requirements_json      TEXT NOT NULL CHECK (json_valid(requirements_json) AND json_type(requirements_json) = 'array' AND length(requirements_json) <= 8192),
  market_ref             TEXT          CHECK (market_ref IS NULL OR length(market_ref) BETWEEN 3 AND 200),
  importance             TEXT NOT NULL CHECK (importance IN ('ORDINARY', 'IMPORTANT')),
  topic_terms_json       TEXT NOT NULL CHECK (json_valid(topic_terms_json) AND json_type(topic_terms_json) = 'array' AND length(topic_terms_json) <= 2048),
  expected_outcome_code  TEXT          CHECK (expected_outcome_code IS NULL OR length(expected_outcome_code) BETWEEN 1 AND 64),
  created_at             TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE TRIGGER work_item_capabilities_append_only_u BEFORE UPDATE ON work_item_capabilities BEGIN SELECT RAISE(ABORT, 'work item capabilities is append-only'); END;
CREATE TRIGGER work_item_capabilities_append_only_d BEFORE DELETE ON work_item_capabilities BEGIN SELECT RAISE(ABORT, 'work item capabilities is append-only'); END;
CREATE TRIGGER work_item_capabilities_before_release BEFORE INSERT ON work_item_capabilities
WHEN (SELECT state FROM work_items WHERE id = NEW.work_item_id) IS NOT 'PROPOSED'
BEGIN SELECT RAISE(ABORT, 'capability requirements are declared before the Work Item is released'); END;

-- Durable Capability Gaps (Stage 7 §20): the work is parked, never silently given to the nearest Employee.
CREATE TABLE capability_gaps (
  id                TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id      TEXT NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id       TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  missing_json      TEXT NOT NULL CHECK (json_valid(missing_json) AND json_type(missing_json) = 'array' AND length(missing_json) <= 4096),
  suggestions_json  TEXT NOT NULL CHECK (json_valid(suggestions_json) AND json_type(suggestions_json) = 'array' AND length(suggestions_json) <= 512),
  state             TEXT NOT NULL CHECK (state IN ('OPEN', 'RESOLVED', 'CANCELLED')),
  resolved_by_ref   TEXT          CHECK (resolved_by_ref IS NULL OR length(resolved_by_ref) BETWEEN 3 AND 161),
  reason_code       TEXT          CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
  created_at        TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  resolved_at       TEXT          CHECK (resolved_at IS NULL OR resolved_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'OPEN') = (resolved_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX capability_gaps_one_open ON capability_gaps (work_item_id) WHERE state = 'OPEN';
CREATE TRIGGER capability_gaps_no_delete BEFORE DELETE ON capability_gaps BEGIN SELECT RAISE(ABORT, 'capability gaps are durable history'); END;
CREATE TRIGGER capability_gaps_close_once BEFORE UPDATE ON capability_gaps
WHEN OLD.state <> 'OPEN' OR NEW.missing_json IS NOT OLD.missing_json OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.employee_id IS NOT OLD.employee_id
BEGIN SELECT RAISE(ABORT, 'a capability gap is closed once; what was missing never changes'); END;

-- QANDEEL Academy (Stage 6). Programs are role-specific and versioned, bound to a blueprint version.
CREATE TABLE academy_programs (
  id              TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code            TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 96 AND code NOT GLOB '*[^a-z0-9.-]*'),
  role_ref        TEXT NOT NULL CHECK (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*'),
  created_by_ref  TEXT NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at      TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER academy_programs_append_only_u BEFORE UPDATE ON academy_programs BEGIN SELECT RAISE(ABORT, 'academy programs is append-only'); END;
CREATE TRIGGER academy_programs_append_only_d BEFORE DELETE ON academy_programs BEGIN SELECT RAISE(ABORT, 'academy programs is append-only'); END;

CREATE TABLE academy_program_versions (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  program_id         TEXT    NOT NULL REFERENCES academy_programs (id) ON DELETE RESTRICT,
  version            INTEGER NOT NULL CHECK (version >= 1),
  blueprint_id       TEXT    NOT NULL REFERENCES role_blueprints (id) ON DELETE RESTRICT,
  definition_json    TEXT    NOT NULL CHECK (json_valid(definition_json) AND json_type(definition_json) = 'object' AND length(definition_json) <= 32768),
  definition_sha256  TEXT    NOT NULL CHECK (length(definition_sha256) = 64 AND definition_sha256 NOT GLOB '*[^0-9a-f]*'),
  status             TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  created_by_ref     TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (program_id, version)
) STRICT;
CREATE UNIQUE INDEX academy_program_versions_one_active ON academy_program_versions (program_id) WHERE status = 'ACTIVE';
CREATE TRIGGER academy_program_versions_no_delete BEFORE DELETE ON academy_program_versions BEGIN SELECT RAISE(ABORT, 'academy program versions are durable history'); END;
CREATE TRIGGER academy_program_versions_supersede_only BEFORE UPDATE ON academy_program_versions
WHEN NEW.definition_json IS NOT OLD.definition_json OR NEW.definition_sha256 IS NOT OLD.definition_sha256 OR NEW.blueprint_id IS NOT OLD.blueprint_id OR OLD.status = 'SUPERSEDED'
BEGIN SELECT RAISE(ABORT, 'a program version is immutable; a new version supersedes it'); END;

-- Scenarios, including blind HOLDOUT scenarios whose content only ever enters an assessment context.
CREATE TABLE academy_scenarios (
  id                  TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  program_version_id  TEXT NOT NULL REFERENCES academy_program_versions (id) ON DELETE RESTRICT,
  code                TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 96 AND code NOT GLOB '*[^a-z0-9.-]*'),
  kind                TEXT NOT NULL CHECK (kind IN ('PRACTICE', 'ASSESSMENT', 'HOLDOUT')),
  content             TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 8000),
  content_sha256      TEXT NOT NULL CHECK (length(content_sha256) = 64 AND content_sha256 NOT GLOB '*[^0-9a-f]*'),
  source_ref          TEXT NOT NULL CHECK (length(source_ref) BETWEEN 3 AND 200),
  budget_micros       INTEGER NOT NULL CHECK (budget_micros BETWEEN 0 AND 1000000000000),
  status              TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at          TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (program_version_id, code),
  -- An assessment / holdout always has a real cost budget: COST_DISCIPLINE is never passed by default.
  CHECK (kind = 'PRACTICE' OR budget_micros > 0)
) STRICT;
CREATE TRIGGER academy_scenarios_no_delete BEFORE DELETE ON academy_scenarios BEGIN SELECT RAISE(ABORT, 'academy scenarios are durable history'); END;
CREATE TRIGGER academy_scenarios_content_immutable BEFORE UPDATE ON academy_scenarios
WHEN NEW.content IS NOT OLD.content OR NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.kind IS NOT OLD.kind OR NEW.program_version_id IS NOT OLD.program_version_id OR OLD.status = 'RETIRED'
BEGIN SELECT RAISE(ABORT, 'scenario content is versioned: a new scenario replaces it'); END;

CREATE TABLE academy_enrollments (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id         TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  program_version_id  TEXT    NOT NULL REFERENCES academy_program_versions (id) ON DELETE RESTRICT,
  role_ref            TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*'),
  stage               TEXT    NOT NULL CHECK (stage IN ('LEARN', 'CASE_STUDIES', 'SIMULATION', 'FEEDBACK', 'RETRY', 'ASSESSMENT', 'SHADOW_WORK', 'PROBATION_REVIEW', 'CERTIFICATION', 'ACTIVATION_APPROVAL', 'ACTIVATED', 'BLOCKED', 'WITHDRAWN')),
  blocked_reason      TEXT             CHECK (blocked_reason IS NULL OR length(blocked_reason) BETWEEN 1 AND 64),
  -- Evidence windows: a probation FAIL opens a new epoch (earlier shadow cases no longer count); every
  -- probation decision closes its review round (the next review needs a new decision).
  evidence_epoch      INTEGER NOT NULL DEFAULT 1 CHECK (evidence_epoch >= 1),
  review_round        INTEGER NOT NULL DEFAULT 1 CHECK (review_round >= 1),
  version             INTEGER NOT NULL CHECK (version >= 1),
  created_at          TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at          TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((stage = 'BLOCKED') = (blocked_reason IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX academy_enrollments_one_open ON academy_enrollments (employee_id, role_ref) WHERE stage NOT IN ('ACTIVATED', 'BLOCKED', 'WITHDRAWN');
CREATE TRIGGER academy_enrollments_no_delete BEFORE DELETE ON academy_enrollments BEGIN SELECT RAISE(ABORT, 'academy enrollments are durable history'); END;
CREATE TRIGGER academy_enrollments_forward BEFORE UPDATE ON academy_enrollments
WHEN NEW.employee_id IS NOT OLD.employee_id OR NEW.program_version_id IS NOT OLD.program_version_id OR NEW.role_ref IS NOT OLD.role_ref OR NEW.version <> OLD.version + 1
  OR NEW.evidence_epoch < OLD.evidence_epoch OR NEW.review_round < OLD.review_round OR OLD.stage IN ('ACTIVATED', 'BLOCKED', 'WITHDRAWN')
BEGIN SELECT RAISE(ABORT, 'an enrollment moves along its path once; a closed enrollment is history'); END;

CREATE TABLE academy_stage_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  enrollment_id  TEXT    NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  version        INTEGER NOT NULL CHECK (version >= 1),
  from_stage     TEXT,
  to_stage       TEXT    NOT NULL,
  reason_code    TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref      TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at    TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (enrollment_id, version)
) STRICT;
CREATE TRIGGER academy_stage_history_append_only_u BEFORE UPDATE ON academy_stage_history BEGIN SELECT RAISE(ABORT, 'academy stage history is append-only'); END;
CREATE TRIGGER academy_stage_history_append_only_d BEFORE DELETE ON academy_stage_history BEGIN SELECT RAISE(ABORT, 'academy stage history is append-only'); END;

CREATE TABLE academy_module_completions (
  enrollment_id   TEXT NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  module_code     TEXT NOT NULL CHECK (length(module_code) BETWEEN 1 AND 96 AND module_code NOT GLOB '*[^a-z0-9.-]*'),
  evidence_ref    TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 3 AND 200),
  recorded_by_ref TEXT NOT NULL CHECK (length(recorded_by_ref) BETWEEN 3 AND 161),
  recorded_at     TEXT NOT NULL CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (enrollment_id, module_code)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER academy_module_completions_append_only_u BEFORE UPDATE ON academy_module_completions BEGIN SELECT RAISE(ABORT, 'academy module completions is append-only'); END;
CREATE TRIGGER academy_module_completions_append_only_d BEFORE DELETE ON academy_module_completions BEGIN SELECT RAISE(ABORT, 'academy module completions is append-only'); END;

-- Attempts: one canonical row per (enrollment, kind, trial). The attempt's Work Item is created in the
-- same transaction; the outcome is recorded once.
CREATE TABLE academy_attempts (
  id                      TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  enrollment_id           TEXT    NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  scenario_id             TEXT    NOT NULL REFERENCES academy_scenarios (id) ON DELETE RESTRICT,
  kind                    TEXT    NOT NULL CHECK (kind IN ('SIMULATION', 'ASSESSMENT')),
  trial_no                INTEGER NOT NULL CHECK (trial_no BETWEEN 1 AND 1000),
  work_item_id            TEXT    NOT NULL UNIQUE REFERENCES work_items (id) ON DELETE RESTRICT,
  holdout                 INTEGER NOT NULL CHECK (holdout IN (0, 1)),
  holdout_clean           INTEGER NOT NULL CHECK (holdout_clean IN (0, 1)),
  state                   TEXT    NOT NULL CHECK (state IN ('OPEN', 'EVALUATED', 'VOID')),
  outcome                 TEXT             CHECK (outcome IS NULL OR outcome IN ('PASS', 'FAIL')),
  average_pct             INTEGER          CHECK (average_pct IS NULL OR average_pct BETWEEN 0 AND 100),
  failed_json             TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(failed_json) AND json_type(failed_json) = 'array' AND length(failed_json) <= 1024),
  critical_failures_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(critical_failures_json) AND json_type(critical_failures_json) = 'array' AND length(critical_failures_json) <= 1024),
  epoch                   INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  void_reason             TEXT             CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 1 AND 64),
  version                 INTEGER NOT NULL CHECK (version >= 1),
  created_at              TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  evaluated_at            TEXT             CHECK (evaluated_at IS NULL OR evaluated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'EVALUATED') = (outcome IS NOT NULL AND evaluated_at IS NOT NULL)),
  CHECK ((state = 'VOID') = (void_reason IS NOT NULL)),
  UNIQUE (enrollment_id, kind, trial_no)
) STRICT;
CREATE TRIGGER academy_attempts_no_delete BEFORE DELETE ON academy_attempts BEGIN SELECT RAISE(ABORT, 'academy attempts are durable history'); END;
CREATE TRIGGER academy_attempts_once BEFORE UPDATE ON academy_attempts
WHEN OLD.state <> 'OPEN' OR NEW.enrollment_id IS NOT OLD.enrollment_id OR NEW.scenario_id IS NOT OLD.scenario_id OR NEW.work_item_id IS NOT OLD.work_item_id
  OR NEW.holdout_clean IS NOT OLD.holdout_clean OR NEW.epoch IS NOT OLD.epoch OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'an attempt has exactly one canonical outcome'); END;

-- One result per dimension per attempt. The evaluator is never the trainee; deterministic dimensions
-- are computed from durable run facts.
CREATE TABLE academy_dimension_results (
  attempt_id          TEXT    NOT NULL REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  dimension           TEXT    NOT NULL CHECK (dimension IN ('REASONING_QUALITY', 'CORRECTNESS', 'EVIDENCE_USE', 'QANDEEL_UNDERSTANDING', 'ROLE_MASTERY', 'AUTHORITY_COMPLIANCE', 'COST_DISCIPLINE', 'COLLABORATION', 'FOUNDER_COMMUNICATION', 'LEARNING_FROM_FEEDBACK')),
  score_pct           INTEGER NOT NULL CHECK (score_pct BETWEEN 0 AND 100),
  evaluator_kind      TEXT    NOT NULL CHECK (evaluator_kind IN ('DETERMINISTIC_RUBRIC', 'EVALUATOR')),
  evaluator_ref       TEXT    NOT NULL CHECK (length(evaluator_ref) BETWEEN 3 AND 161 AND evaluator_ref NOT GLOB 'employee:*'),
  evidence_refs_json  TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 2048),
  recorded_at         TEXT    NOT NULL CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (attempt_id, dimension)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER academy_dimension_results_append_only_u BEFORE UPDATE ON academy_dimension_results BEGIN SELECT RAISE(ABORT, 'academy dimension results is append-only'); END;
CREATE TRIGGER academy_dimension_results_append_only_d BEFORE DELETE ON academy_dimension_results BEGIN SELECT RAISE(ABORT, 'academy dimension results is append-only'); END;

-- Every time scenario content enters a context (holdout pre-exposure proof).
CREATE TABLE academy_scenario_exposures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  scenario_id  TEXT NOT NULL REFERENCES academy_scenarios (id) ON DELETE RESTRICT,
  attempt_id   TEXT NOT NULL REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  manifest_id  TEXT NOT NULL REFERENCES context_manifests (id) ON DELETE RESTRICT,
  exposed_at   TEXT NOT NULL CHECK (exposed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX academy_scenario_exposures_employee ON academy_scenario_exposures (employee_id, scenario_id);
CREATE TRIGGER academy_scenario_exposures_append_only_u BEFORE UPDATE ON academy_scenario_exposures BEGIN SELECT RAISE(ABORT, 'academy scenario exposures is append-only'); END;
CREATE TRIGGER academy_scenario_exposures_append_only_d BEFORE DELETE ON academy_scenario_exposures BEGIN SELECT RAISE(ABORT, 'academy scenario exposures is append-only'); END;

-- Failure → Diagnosis → Targeted Retraining → Re-test (Stage 6 §9). History is kept, never overwritten.
CREATE TABLE academy_remediations (
  id                     TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  enrollment_id          TEXT NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  attempt_id             TEXT          UNIQUE REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  probation_review_id    TEXT          UNIQUE REFERENCES probation_reviews (id) ON DELETE RESTRICT,
  failed_json            TEXT NOT NULL CHECK (json_valid(failed_json) AND json_type(failed_json) = 'array' AND length(failed_json) <= 1024),
  critical_failures_json TEXT NOT NULL CHECK (json_valid(critical_failures_json) AND json_type(critical_failures_json) = 'array' AND length(critical_failures_json) <= 1024),
  categories_json        TEXT NOT NULL CHECK (json_valid(categories_json) AND json_type(categories_json) = 'array' AND length(categories_json) <= 1024),
  modules_json           TEXT NOT NULL CHECK (json_valid(modules_json) AND json_type(modules_json) = 'array' AND length(modules_json) <= 4096),
  state                  TEXT NOT NULL CHECK (state IN ('DIAGNOSED', 'RETRAINING', 'RETEST_READY', 'RETESTED')),
  retest_attempt_id      TEXT          REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  created_at             TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at             TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  -- Diagnosed from exactly one failure: a failed attempt or a failed probation review.
  CHECK ((attempt_id IS NULL) <> (probation_review_id IS NULL))
) STRICT;
CREATE TRIGGER academy_remediations_no_delete BEFORE DELETE ON academy_remediations BEGIN SELECT RAISE(ABORT, 'academy remediations are durable history'); END;
CREATE TRIGGER academy_remediations_forward BEFORE UPDATE ON academy_remediations
WHEN NEW.failed_json IS NOT OLD.failed_json OR NEW.critical_failures_json IS NOT OLD.critical_failures_json OR NEW.attempt_id IS NOT OLD.attempt_id
  OR NEW.probation_review_id IS NOT OLD.probation_review_id OR NEW.enrollment_id IS NOT OLD.enrollment_id OR NEW.categories_json IS NOT OLD.categories_json OR OLD.state = 'RETESTED'
  OR (CASE NEW.state WHEN 'DIAGNOSED' THEN 0 WHEN 'RETRAINING' THEN 1 WHEN 'RETEST_READY' THEN 2 ELSE 3 END) < (CASE OLD.state WHEN 'DIAGNOSED' THEN 0 WHEN 'RETRAINING' THEN 1 WHEN 'RETEST_READY' THEN 2 ELSE 3 END)
BEGIN SELECT RAISE(ABORT, 'a remediation record only moves forward'); END;
CREATE TABLE academy_remediation_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  remediation_id  TEXT    NOT NULL REFERENCES academy_remediations (id) ON DELETE RESTRICT,
  from_state      TEXT,
  to_state        TEXT    NOT NULL,
  reason_code     TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref       TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at     TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER academy_remediation_history_append_only_u BEFORE UPDATE ON academy_remediation_history BEGIN SELECT RAISE(ABORT, 'academy remediation history is append-only'); END;
CREATE TRIGGER academy_remediation_history_append_only_d BEFORE DELETE ON academy_remediation_history BEGIN SELECT RAISE(ABORT, 'academy remediation history is append-only'); END;

-- Shadow / probation work (Stage 6 §11–§12): real Work Items under constrained authority, and evidence.
CREATE TABLE academy_shadow_assignments (
  work_item_id   TEXT NOT NULL PRIMARY KEY REFERENCES work_items (id) ON DELETE RESTRICT,
  enrollment_id  TEXT NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  assigned_by_ref TEXT NOT NULL CHECK (length(assigned_by_ref) BETWEEN 3 AND 161),
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE TRIGGER academy_shadow_assignments_append_only_u BEFORE UPDATE ON academy_shadow_assignments BEGIN SELECT RAISE(ABORT, 'academy shadow assignments is append-only'); END;
CREATE TRIGGER academy_shadow_assignments_append_only_d BEFORE DELETE ON academy_shadow_assignments BEGIN SELECT RAISE(ABORT, 'academy shadow assignments is append-only'); END;

CREATE TABLE probation_evidence (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  enrollment_id    TEXT    NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  kind             TEXT    NOT NULL CHECK (kind IN ('CASE', 'CRITICAL_FAILURE', 'DEMONSTRATED_LEARNING', 'COST_DISCIPLINE', 'CORRECT_ESCALATION', 'COLLABORATION', 'QUALITY')),
  work_item_id     TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  positive         INTEGER NOT NULL CHECK (positive IN (0, 1)),
  recorded_by_kind TEXT    NOT NULL CHECK (recorded_by_kind IN ('DETERMINISTIC', 'EVALUATOR')),
  recorded_by_ref  TEXT    NOT NULL CHECK (length(recorded_by_ref) BETWEEN 3 AND 161 AND recorded_by_ref NOT GLOB 'employee:*'),
  epoch            INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  recorded_at      TEXT    NOT NULL CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (enrollment_id, kind, work_item_id)
) STRICT;
CREATE TRIGGER probation_evidence_append_only_u BEFORE UPDATE ON probation_evidence BEGIN SELECT RAISE(ABORT, 'probation evidence is append-only'); END;
CREATE TRIGGER probation_evidence_append_only_d BEFORE DELETE ON probation_evidence BEGIN SELECT RAISE(ABORT, 'probation evidence is append-only'); END;

CREATE TABLE probation_reviews (
  id               TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  enrollment_id    TEXT NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  decision         TEXT NOT NULL CHECK (decision IN ('PASS', 'FAIL', 'EXTEND')),
  summary_json     TEXT NOT NULL CHECK (json_valid(summary_json) AND json_type(summary_json) = 'object' AND length(summary_json) <= 1024),
  unmet_json       TEXT NOT NULL CHECK (json_valid(unmet_json) AND json_type(unmet_json) = 'array' AND length(unmet_json) <= 1024),
  decided_by_ref   TEXT NOT NULL CHECK (length(decided_by_ref) BETWEEN 3 AND 161 AND decided_by_ref NOT GLOB 'employee:*'),
  epoch            INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  review_round     INTEGER NOT NULL DEFAULT 1 CHECK (review_round >= 1),
  decided_at       TEXT NOT NULL CHECK (decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (decision <> 'PASS' OR unmet_json = '[]'),
  UNIQUE (enrollment_id, review_round)
) STRICT;
CREATE TRIGGER probation_reviews_append_only_u BEFORE UPDATE ON probation_reviews BEGIN SELECT RAISE(ABORT, 'probation reviews is append-only'); END;
CREATE TRIGGER probation_reviews_append_only_d BEFORE DELETE ON probation_reviews BEGIN SELECT RAISE(ABORT, 'probation reviews is append-only'); END;

-- Founder Calibration (Stage 6 §10): required evidence / status. The decision needs the authenticated
-- Founder surface (C5); until then it stays PENDING in production.
CREATE TABLE founder_calibrations (
  id                  TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  enrollment_id       TEXT NOT NULL UNIQUE REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  state               TEXT NOT NULL CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED')),
  evidence_refs_json  TEXT NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 2048),
  decided_by_ref      TEXT          CHECK (decided_by_ref IS NULL OR decided_by_ref GLOB 'founder:*'),
  created_at          TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_at          TEXT          CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'PENDING') = (decided_at IS NULL))
) STRICT;
CREATE TRIGGER founder_calibrations_no_delete BEFORE DELETE ON founder_calibrations BEGIN SELECT RAISE(ABORT, 'founder calibrations are durable history'); END;
CREATE TRIGGER founder_calibrations_decided_once BEFORE UPDATE ON founder_calibrations
WHEN OLD.state <> 'PENDING' OR NEW.enrollment_id IS NOT OLD.enrollment_id
BEGIN SELECT RAISE(ABORT, 'a calibration is decided once'); END;

-- Certifications (Stage 6 §3, §14): role-specific, bound to the program and blueprint versions and the
-- evidence, time-aware, revocable, supersedable and marked REVIEW_DUE on material change.
CREATE TABLE certifications (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id         TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  role_ref            TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*'),
  enrollment_id       TEXT    NOT NULL UNIQUE REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  program_version_id  TEXT    NOT NULL REFERENCES academy_program_versions (id) ON DELETE RESTRICT,
  blueprint_id        TEXT    NOT NULL REFERENCES role_blueprints (id) ON DELETE RESTRICT,
  status              TEXT    NOT NULL CHECK (status IN ('VALID', 'REVIEW_DUE', 'EXPIRED', 'REVOKED', 'SUPERSEDED')),
  evidence_json       TEXT    NOT NULL CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object' AND length(evidence_json) <= 8192),
  skill_pins_json     TEXT    NOT NULL CHECK (json_valid(skill_pins_json) AND json_type(skill_pins_json) = 'array' AND length(skill_pins_json) <= 8192),
  issued_at           TEXT    NOT NULL CHECK (issued_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  valid_until         TEXT    NOT NULL CHECK (valid_until GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  reason_code         TEXT             CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
  version             INTEGER NOT NULL CHECK (version >= 1),
  updated_at          TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (valid_until > issued_at)
) STRICT;
CREATE UNIQUE INDEX certifications_one_live ON certifications (employee_id, role_ref) WHERE status IN ('VALID', 'REVIEW_DUE');
CREATE TRIGGER certifications_no_delete BEFORE DELETE ON certifications BEGIN SELECT RAISE(ABORT, 'certifications are durable history'); END;
CREATE TRIGGER certifications_evidence_immutable BEFORE UPDATE ON certifications
WHEN NEW.employee_id IS NOT OLD.employee_id OR NEW.role_ref IS NOT OLD.role_ref OR NEW.program_version_id IS NOT OLD.program_version_id OR NEW.blueprint_id IS NOT OLD.blueprint_id
  OR NEW.evidence_json IS NOT OLD.evidence_json OR NEW.skill_pins_json IS NOT OLD.skill_pins_json OR NEW.issued_at IS NOT OLD.issued_at OR NEW.valid_until IS NOT OLD.valid_until
  OR NEW.version <> OLD.version + 1 OR OLD.status IN ('REVOKED', 'SUPERSEDED', 'EXPIRED') OR (OLD.status = 'REVIEW_DUE' AND NEW.status = 'VALID')
BEGIN SELECT RAISE(ABORT, 'a certification is issued once; it only degrades (review due, expired, revoked, superseded)'); END;

CREATE TABLE certification_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  certification_id  TEXT    NOT NULL REFERENCES certifications (id) ON DELETE RESTRICT,
  version           INTEGER NOT NULL CHECK (version >= 1),
  from_status       TEXT,
  to_status         TEXT    NOT NULL,
  reason_code       TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref         TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at       TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (certification_id, version)
) STRICT;
CREATE TRIGGER certification_history_append_only_u BEFORE UPDATE ON certification_history BEGIN SELECT RAISE(ABORT, 'certification history is append-only'); END;
CREATE TRIGGER certification_history_append_only_d BEFORE DELETE ON certification_history BEGIN SELECT RAISE(ABORT, 'certification history is append-only'); END;

-- Activation Approval (Stage 6 §13): Certification + Probation Review + Activation Approval. The request
-- carries the evidence; the decision needs authenticated authority (C5 / organization) and fails closed.
CREATE TABLE activation_requests (
  id                  TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id         TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  enrollment_id       TEXT NOT NULL UNIQUE REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  certification_id    TEXT NOT NULL REFERENCES certifications (id) ON DELETE RESTRICT,
  probation_review_id TEXT NOT NULL REFERENCES probation_reviews (id) ON DELETE RESTRICT,
  calibration_id      TEXT          REFERENCES founder_calibrations (id) ON DELETE RESTRICT,
  state               TEXT NOT NULL CHECK (state IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONSUMED')),
  decided_by_ref      TEXT          CHECK (decided_by_ref IS NULL OR decided_by_ref GLOB 'founder:*'),
  created_at          TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_at          TEXT          CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'PENDING_APPROVAL') = (decided_at IS NULL))
) STRICT;
CREATE UNIQUE INDEX activation_requests_one_open ON activation_requests (employee_id) WHERE state IN ('PENDING_APPROVAL', 'APPROVED');
CREATE TRIGGER activation_requests_no_delete BEFORE DELETE ON activation_requests BEGIN SELECT RAISE(ABORT, 'activation requests are durable history'); END;
CREATE TRIGGER activation_requests_forward BEFORE UPDATE ON activation_requests
WHEN NEW.employee_id IS NOT OLD.employee_id OR NEW.certification_id IS NOT OLD.certification_id OR NEW.probation_review_id IS NOT OLD.probation_review_id
  OR OLD.state IN ('REJECTED', 'CONSUMED') OR (OLD.state = 'APPROVED' AND NEW.state <> 'CONSUMED')
BEGIN SELECT RAISE(ABORT, 'an activation request moves forward once'); END;

-- The datastore's own activation gate (defence in depth): SHADOW / PROBATION → ACTIVE requires an
-- APPROVED activation request whose certification is VALID for this Employee's current role and
-- whose probation review PASSED. (The C2 test-only seam's labelled rows are the only other path, and
-- only tests can reach that seam.)
CREATE TRIGGER employees_activation_gate BEFORE UPDATE OF state ON employees
WHEN NEW.state = 'ACTIVE' AND OLD.state NOT IN ('ACTIVE', 'PAUSED', 'ON_LEAVE')
  AND NOT EXISTS (SELECT 1 FROM json_each(NEW.qualification_refs_json) j WHERE j.value GLOB 'test-seam:*')
  AND NOT EXISTS (
    SELECT 1 FROM activation_requests a
      JOIN certifications c ON c.id = a.certification_id
      JOIN probation_reviews p ON p.id = a.probation_review_id
     WHERE a.employee_id = NEW.id AND a.state = 'APPROVED' AND a.decided_by_ref GLOB 'founder:*'
       AND c.employee_id = NEW.id AND c.status = 'VALID' AND c.role_ref = NEW.role_ref AND c.valid_until > NEW.updated_at
       AND c.enrollment_id = a.enrollment_id AND p.enrollment_id = a.enrollment_id AND p.decision = 'PASS')
BEGIN SELECT RAISE(ABORT, 'activation requires a valid role certification, a passed probation review and an approved activation request'); END;

-- Execution mode of a Run by a non-ACTIVE Employee (Academy attempt or shadow work): constrained authority.
CREATE TABLE run_execution_modes (
  run_id         TEXT NOT NULL PRIMARY KEY REFERENCES runs (id) ON DELETE RESTRICT,
  mode           TEXT NOT NULL CHECK (mode IN ('ACADEMY_ATTEMPT', 'SHADOW_WORK')),
  enrollment_id  TEXT NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE TRIGGER run_execution_modes_append_only_u BEFORE UPDATE ON run_execution_modes BEGIN SELECT RAISE(ABORT, 'run execution modes is append-only'); END;
CREATE TRIGGER run_execution_modes_append_only_d BEFORE DELETE ON run_execution_modes BEGIN SELECT RAISE(ABORT, 'run execution modes is append-only'); END;
