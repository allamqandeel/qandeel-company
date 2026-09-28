-- QANDEEL COMPANY operational schema — migration 0008: C4 Review / Oversight / Quality (Stage 11):
-- versioned Review Plans designed before execution, the dynamic qualified Review Pool (reviewer
-- qualifications bound to C3 certifications — the Review Pool is a registry, NOT a Department), review
-- requests bound to a versioned subject fingerprint, assignments, decisions, Review Conflicts, Quality
-- Holds and Independent Oversight findings.
-- IMMUTABLE once released (see 0001). Migrations 0001–0007 are unchanged.
--
-- Execute ≠ Review ≠ Approve: nothing here approves anything (approvals stay in 0004, Founder-decided), a
-- review never makes R4 executable, and review content (rationale, reviewer instructions) is local governed
-- business evidence that never enters audit, events or logs (Rule A).

-- Review Plans (Stage 11 §1, §33): designed before the Work Item first runs, versioned, immutable per version.
CREATE TABLE review_plans (
  id                             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id                   TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  version                        INTEGER NOT NULL CHECK (version >= 1),
  status                         TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  domain                         TEXT    NOT NULL CHECK (length(domain) BETWEEN 1 AND 64 AND domain NOT GLOB '*[^a-z0-9.-]*'),
  applies_to                     TEXT    NOT NULL CHECK (applies_to IN ('OUTPUT', 'ACTIONS', 'BOTH')),
  keys_json                      TEXT    NOT NULL CHECK (json_valid(keys_json) AND json_type(keys_json) = 'array' AND json_array_length(keys_json) BETWEEN 1 AND 3 AND length(keys_json) <= 512),
  independence_json              TEXT    NOT NULL CHECK (json_valid(independence_json) AND json_type(independence_json) = 'object' AND length(independence_json) <= 512),
  required_evidence_json         TEXT    NOT NULL CHECK (json_valid(required_evidence_json) AND json_type(required_evidence_json) = 'array' AND length(required_evidence_json) <= 2048),
  rubric_code                    TEXT    NOT NULL CHECK (length(rubric_code) BETWEEN 1 AND 64 AND rubric_code NOT GLOB '*[^a-z0-9.-]*'),
  rubric_version                 INTEGER NOT NULL CHECK (rubric_version >= 1),
  reviewer_instructions          TEXT    NOT NULL CHECK (length(reviewer_instructions) BETWEEN 1 AND 8000),
  reviewer_instructions_sha256   TEXT    NOT NULL CHECK (length(reviewer_instructions_sha256) = 64 AND reviewer_instructions_sha256 NOT GLOB '*[^0-9a-f]*'),
  review_task_class              TEXT    NOT NULL CHECK (length(review_task_class) BETWEEN 1 AND 64),
  review_budget_money            INTEGER NOT NULL CHECK (review_budget_money BETWEEN 0 AND 1000000000000000),
  review_budget_tokens           INTEGER NOT NULL CHECK (review_budget_tokens BETWEEN 0 AND 1000000000000),
  deadline_at                    TEXT             CHECK (deadline_at IS NULL OR deadline_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  declared_by_ref                TEXT    NOT NULL CHECK (length(declared_by_ref) BETWEEN 3 AND 161),
  declared_run_id                TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  created_at                     TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (work_item_id, version)
) STRICT;
CREATE UNIQUE INDEX review_plans_one_active ON review_plans (work_item_id) WHERE status = 'ACTIVE';
CREATE TRIGGER review_plans_no_delete BEFORE DELETE ON review_plans BEGIN SELECT RAISE(ABORT, 'review plans are durable history'); END;
CREATE TRIGGER review_plans_supersede_only BEFORE UPDATE ON review_plans
WHEN NEW.id IS NOT OLD.id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.version IS NOT OLD.version OR NEW.domain IS NOT OLD.domain OR NEW.applies_to IS NOT OLD.applies_to
  OR NEW.keys_json IS NOT OLD.keys_json OR NEW.independence_json IS NOT OLD.independence_json OR NEW.required_evidence_json IS NOT OLD.required_evidence_json
  OR NEW.rubric_code IS NOT OLD.rubric_code OR NEW.rubric_version IS NOT OLD.rubric_version OR NEW.reviewer_instructions IS NOT OLD.reviewer_instructions
  OR NEW.reviewer_instructions_sha256 IS NOT OLD.reviewer_instructions_sha256 OR NEW.review_task_class IS NOT OLD.review_task_class
  OR NEW.review_budget_money IS NOT OLD.review_budget_money OR NEW.review_budget_tokens IS NOT OLD.review_budget_tokens OR NEW.deadline_at IS NOT OLD.deadline_at
  OR NEW.declared_by_ref IS NOT OLD.declared_by_ref OR NEW.created_at IS NOT OLD.created_at OR OLD.status = 'SUPERSEDED'
BEGIN SELECT RAISE(ABORT, 'a review plan version is immutable; a new version supersedes it'); END;
-- Review is designed BEFORE execution (Stage 11 §1): the first plan of a Work Item precedes its first run.
CREATE TRIGGER review_plans_before_execution BEFORE INSERT ON review_plans
WHEN NEW.version = 1 AND EXISTS (SELECT 1 FROM runs WHERE work_item_id = NEW.work_item_id)
BEGIN SELECT RAISE(ABORT, 'a review plan is declared before the work item first runs'); END;

-- Reviewer qualifications: the dynamic Review Pool (Stage 11 §6–§14). Eligibility is evidence, never
-- seniority: a VALID C3 certification for the reviewer role of the domain, Gold Cases (holdouts) passed,
-- calibration evidence, and Founder admission before independent (ACTIVE) review authority.
CREATE TABLE reviewer_qualifications (
  id                         TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id                TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  domain                     TEXT    NOT NULL CHECK (length(domain) BETWEEN 1 AND 64 AND domain NOT GLOB '*[^a-z0-9.-]*'),
  level                      TEXT    NOT NULL CHECK (level IN ('QUALIFIED', 'SENIOR', 'EXPERT')),
  certification_id           TEXT    NOT NULL REFERENCES certifications (id) ON DELETE RESTRICT,
  mode                       TEXT    NOT NULL CHECK (mode IN ('CALIBRATION', 'ACTIVE', 'SUSPENDED', 'REVOKED')),
  max_data_class             TEXT    NOT NULL CHECK (max_data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  max_data_rank              INTEGER NOT NULL CHECK (max_data_rank BETWEEN 0 AND 4),
  gold_cases_passed          INTEGER NOT NULL CHECK (gold_cases_passed >= 0),
  gold_cases_total           INTEGER NOT NULL CHECK (gold_cases_total >= 0),
  calibration_agreements     INTEGER NOT NULL DEFAULT 0 CHECK (calibration_agreements >= 0),
  calibration_disagreements  INTEGER NOT NULL DEFAULT 0 CHECK (calibration_disagreements >= 0),
  qualification_version      INTEGER NOT NULL CHECK (qualification_version >= 1),
  admitted_by_ref            TEXT             CHECK (admitted_by_ref IS NULL OR admitted_by_ref GLOB 'founder:*'),
  reason_code                TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  version                    INTEGER NOT NULL CHECK (version >= 1),
  created_at                 TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at                 TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (gold_cases_passed <= gold_cases_total),
  CHECK (mode <> 'ACTIVE' OR admitted_by_ref IS NOT NULL),
  CHECK (max_data_rank = CASE max_data_class WHEN 'D0' THEN 0 WHEN 'D1' THEN 1 WHEN 'D2' THEN 2 WHEN 'D3' THEN 3 ELSE 4 END)
) STRICT;
CREATE UNIQUE INDEX reviewer_qualifications_one_live ON reviewer_qualifications (employee_id, domain) WHERE mode IN ('CALIBRATION', 'ACTIVE', 'SUSPENDED');
CREATE INDEX reviewer_qualifications_domain ON reviewer_qualifications (domain, mode);
CREATE TRIGGER reviewer_qualifications_no_delete BEFORE DELETE ON reviewer_qualifications BEGIN SELECT RAISE(ABORT, 'qualifications are revoked, never deleted'); END;
CREATE TRIGGER reviewer_qualifications_evidence_forward BEFORE UPDATE ON reviewer_qualifications
WHEN NEW.id IS NOT OLD.id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.domain IS NOT OLD.domain OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version <> OLD.version + 1 OR OLD.mode = 'REVOKED' OR NEW.qualification_version < OLD.qualification_version
  OR NEW.calibration_agreements < OLD.calibration_agreements OR NEW.calibration_disagreements < OLD.calibration_disagreements
  OR NEW.gold_cases_passed < OLD.gold_cases_passed OR NEW.gold_cases_total < OLD.gold_cases_total
BEGIN SELECT RAISE(ABORT, 'a qualification keeps its identity; evidence counters never decrease; a revoked qualification is history'); END;

CREATE TABLE reviewer_qualification_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  qualification_id  TEXT    NOT NULL REFERENCES reviewer_qualifications (id) ON DELETE RESTRICT,
  version           INTEGER NOT NULL CHECK (version >= 1),
  from_mode         TEXT,
  to_mode           TEXT    NOT NULL,
  reason_code       TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref         TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at       TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (qualification_id, version)
) STRICT;
CREATE TRIGGER reviewer_qualification_history_append_only_u BEFORE UPDATE ON reviewer_qualification_history BEGIN SELECT RAISE(ABORT, 'qualification history is append-only'); END;
CREATE TRIGGER reviewer_qualification_history_append_only_d BEFORE DELETE ON reviewer_qualification_history BEGIN SELECT RAISE(ABORT, 'qualification history is append-only'); END;

-- Review requests: one per (Work Item, versioned subject, kind). The subject fingerprint binds the review to
-- exactly the output / action it judged: a materially different output, action or plan is a new review.
-- REQUIRED = the plan's gate; OVERSIGHT = Independent Quality Oversight (never satisfies or bypasses a gate).
CREATE TABLE review_requests (
  id                   TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  kind                 TEXT    NOT NULL CHECK (kind IN ('REQUIRED', 'OVERSIGHT')),
  plan_id              TEXT             REFERENCES review_plans (id) ON DELETE RESTRICT,
  work_item_id         TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  subject_kind         TEXT    NOT NULL CHECK (subject_kind IN ('OUTPUT', 'ACTION')),
  subject_fingerprint  TEXT    NOT NULL CHECK (length(subject_fingerprint) = 64 AND subject_fingerprint NOT GLOB '*[^0-9a-f]*'),
  subject_ref          TEXT    NOT NULL CHECK (length(subject_ref) BETWEEN 3 AND 161),
  data_class           TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  risk_level           TEXT    NOT NULL CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3', 'R4')),
  state                TEXT    NOT NULL CHECK (state IN ('OPEN', 'SATISFIED', 'REWORK', 'CONFLICT', 'ESCALATED', 'STALE', 'CANCELLED', 'CONSUMED')),
  waiting_reason       TEXT             CHECK (waiting_reason IS NULL OR length(waiting_reason) BETWEEN 1 AND 64),
  resolution_ref       TEXT             CHECK (resolution_ref IS NULL OR length(resolution_ref) BETWEEN 3 AND 161),
  version              INTEGER NOT NULL CHECK (version >= 1),
  created_at           TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at           TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_at           TEXT             CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (kind <> 'REQUIRED' OR plan_id IS NOT NULL),
  CHECK (kind <> 'OVERSIGHT' OR subject_kind = 'OUTPUT'),
  -- A review never stands in for R4's Founder-only sovereignty.
  CHECK (risk_level <> 'R4' OR state NOT IN ('SATISFIED', 'CONSUMED'))
) STRICT;
CREATE UNIQUE INDEX review_requests_one_live ON review_requests (work_item_id, subject_fingerprint, kind) WHERE state IN ('OPEN', 'SATISFIED', 'CONFLICT', 'ESCALATED');
CREATE INDEX review_requests_state ON review_requests (state);
CREATE INDEX review_requests_work_item ON review_requests (work_item_id);
CREATE TRIGGER review_requests_no_delete BEFORE DELETE ON review_requests BEGIN SELECT RAISE(ABORT, 'review requests are durable history'); END;
CREATE TRIGGER review_requests_subject_immutable BEFORE UPDATE ON review_requests
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.plan_id IS NOT OLD.plan_id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.subject_kind IS NOT OLD.subject_kind
  OR NEW.subject_fingerprint IS NOT OLD.subject_fingerprint OR NEW.subject_ref IS NOT OLD.subject_ref OR NEW.data_class IS NOT OLD.data_class
  OR NEW.risk_level IS NOT OLD.risk_level OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR OLD.state IN ('REWORK', 'STALE', 'CANCELLED', 'CONSUMED')
  OR (OLD.state = 'SATISFIED' AND NEW.state NOT IN ('CONSUMED', 'STALE', 'CONFLICT'))
BEGIN SELECT RAISE(ABORT, 'a review request is bound to its subject; a closed request is history'); END;

CREATE TABLE review_request_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   TEXT    NOT NULL REFERENCES review_requests (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT,
  to_state     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (request_id, version)
) STRICT;
CREATE TRIGGER review_request_history_append_only_u BEFORE UPDATE ON review_request_history BEGIN SELECT RAISE(ABORT, 'review request history is append-only'); END;
CREATE TRIGGER review_request_history_append_only_d BEFORE DELETE ON review_request_history BEGIN SELECT RAISE(ABORT, 'review request history is append-only'); END;

-- Assignments: one reviewer per plan key. SHADOW keys are calibration evaluations (never counted); the
-- datastore itself refuses one reviewer holding two counting keys of the same request (Stage 11 §10).
CREATE TABLE review_assignments (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  request_id            TEXT    NOT NULL REFERENCES review_requests (id) ON DELETE RESTRICT,
  key_index             INTEGER NOT NULL CHECK (key_index BETWEEN 0 AND 7),
  key_kind              TEXT    NOT NULL CHECK (key_kind IN ('SPECIALIST', 'MANAGER', 'FOUNDER', 'SHADOW', 'OVERSIGHT')),
  reviewer_employee_id  TEXT             REFERENCES employees (id) ON DELETE RESTRICT,
  reviewer_ref          TEXT    NOT NULL CHECK (length(reviewer_ref) BETWEEN 3 AND 161),
  qualification_id      TEXT             REFERENCES reviewer_qualifications (id) ON DELETE RESTRICT,
  review_work_item_id   TEXT             UNIQUE REFERENCES work_items (id) ON DELETE RESTRICT,
  state                 TEXT    NOT NULL CHECK (state IN ('ASSIGNED', 'DECIDED', 'WITHDRAWN')),
  withdraw_reason       TEXT             CHECK (withdraw_reason IS NULL OR length(withdraw_reason) BETWEEN 1 AND 64),
  version               INTEGER NOT NULL CHECK (version >= 1),
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at            TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((key_kind = 'FOUNDER') = (reviewer_employee_id IS NULL)),
  CHECK (key_kind <> 'FOUNDER' OR (reviewer_ref GLOB 'founder:*' AND review_work_item_id IS NULL)),
  CHECK (key_kind = 'FOUNDER' OR (reviewer_ref = 'employee:' || reviewer_employee_id AND qualification_id IS NOT NULL)),
  CHECK ((state = 'WITHDRAWN') = (withdraw_reason IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX review_assignments_one_open_per_key ON review_assignments (request_id, key_index) WHERE state = 'ASSIGNED';
CREATE UNIQUE INDEX review_assignments_distinct_keys ON review_assignments (request_id, reviewer_ref) WHERE state IN ('ASSIGNED', 'DECIDED') AND key_kind IN ('SPECIALIST', 'MANAGER', 'FOUNDER', 'OVERSIGHT');
CREATE INDEX review_assignments_reviewer ON review_assignments (reviewer_employee_id, state);
CREATE TRIGGER review_assignments_no_delete BEFORE DELETE ON review_assignments BEGIN SELECT RAISE(ABORT, 'review assignments are durable history'); END;
CREATE TRIGGER review_assignments_forward BEFORE UPDATE ON review_assignments
WHEN NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id OR NEW.key_index IS NOT OLD.key_index OR NEW.key_kind IS NOT OLD.key_kind
  OR NEW.reviewer_employee_id IS NOT OLD.reviewer_employee_id OR NEW.reviewer_ref IS NOT OLD.reviewer_ref OR NEW.qualification_id IS NOT OLD.qualification_id
  OR NEW.review_work_item_id IS NOT OLD.review_work_item_id OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1 OR OLD.state <> 'ASSIGNED'
BEGIN SELECT RAISE(ABORT, 'an assignment is decided or withdrawn once'); END;

-- Decisions (Stage 11 §15/§16): outcome, reason, rationale (local governed content), evidence, rubric / plan
-- / qualification versions, independence evidence. Append-only; one per assignment.
CREATE TABLE review_decisions (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  assignment_id          TEXT    NOT NULL UNIQUE REFERENCES review_assignments (id) ON DELETE RESTRICT,
  request_id             TEXT    NOT NULL REFERENCES review_requests (id) ON DELETE RESTRICT,
  reviewer_ref           TEXT    NOT NULL CHECK (length(reviewer_ref) BETWEEN 3 AND 161),
  reviewer_employee_id   TEXT             REFERENCES employees (id) ON DELETE RESTRICT,
  outcome                TEXT    NOT NULL CHECK (outcome IN ('PASS', 'FAIL', 'UNCERTAIN', 'INSUFFICIENT_EVIDENCE', 'NEEDS_SPECIALIST', 'ESCALATE')),
  reason_code            TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  rationale              TEXT             CHECK (rationale IS NULL OR length(rationale) BETWEEN 1 AND 4000),
  rationale_sha256       TEXT             CHECK (rationale_sha256 IS NULL OR (length(rationale_sha256) = 64 AND rationale_sha256 NOT GLOB '*[^0-9a-f]*')),
  evidence_refs_json     TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 2048),
  plan_id                TEXT             REFERENCES review_plans (id) ON DELETE RESTRICT,
  plan_version           INTEGER          CHECK (plan_version IS NULL OR plan_version >= 1),
  rubric_code            TEXT             CHECK (rubric_code IS NULL OR length(rubric_code) BETWEEN 1 AND 64),
  rubric_version         INTEGER          CHECK (rubric_version IS NULL OR rubric_version >= 1),
  subject_fingerprint    TEXT    NOT NULL CHECK (length(subject_fingerprint) = 64),
  qualification_id       TEXT             REFERENCES reviewer_qualifications (id) ON DELETE RESTRICT,
  qualification_version  INTEGER          CHECK (qualification_version IS NULL OR qualification_version >= 1),
  independence_json      TEXT    NOT NULL CHECK (json_valid(independence_json) AND json_type(independence_json) = 'object' AND length(independence_json) <= 1024),
  counts                 INTEGER NOT NULL CHECK (counts IN (0, 1)),
  run_id                 TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  decision_version       INTEGER NOT NULL DEFAULT 1 CHECK (decision_version >= 1),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((rationale IS NULL) = (rationale_sha256 IS NULL))
) STRICT;
CREATE INDEX review_decisions_request ON review_decisions (request_id);
CREATE INDEX review_decisions_reviewer ON review_decisions (reviewer_employee_id);
CREATE TRIGGER review_decisions_append_only_u BEFORE UPDATE ON review_decisions BEGIN SELECT RAISE(ABORT, 'review decisions are append-only'); END;
CREATE TRIGGER review_decisions_append_only_d BEFORE DELETE ON review_decisions BEGIN SELECT RAISE(ABORT, 'review decisions are append-only'); END;

-- Calibration evidence (Stage 11 §13/§14): a shadow (non-counting) decision compared once — against the
-- request's authoritative outcome, or, while a domain has no independent reviewer yet (bootstrap), against the
-- Founder's own judgement of the same subject. Once per decision: evidence is never double-counted.
CREATE TABLE review_calibrations (
  decision_id       TEXT NOT NULL PRIMARY KEY REFERENCES review_decisions (id) ON DELETE RESTRICT,
  qualification_id  TEXT NOT NULL REFERENCES reviewer_qualifications (id) ON DELETE RESTRICT,
  source            TEXT NOT NULL CHECK (source IN ('FINAL_OUTCOME', 'FOUNDER')),
  signal            TEXT NOT NULL CHECK (signal IN ('AGREE', 'DISAGREE')),
  actor_ref         TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  created_at        TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (source <> 'FOUNDER' OR actor_ref GLOB 'founder:*')
) STRICT, WITHOUT ROWID;
CREATE TRIGGER review_calibrations_append_only_u BEFORE UPDATE ON review_calibrations BEGIN SELECT RAISE(ABORT, 'calibration evidence is append-only'); END;
CREATE TRIGGER review_calibrations_append_only_d BEFORE DELETE ON review_calibrations BEGIN SELECT RAISE(ABORT, 'calibration evidence is append-only'); END;

-- Review Conflicts (Stage 11 §20): material disagreement is explicit, never averaged away; it survives
-- restarts and parks the subject until an authorized resolution.
CREATE TABLE review_conflicts (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  request_id         TEXT    NOT NULL REFERENCES review_requests (id) ON DELETE RESTRICT,
  origin             TEXT    NOT NULL CHECK (origin IN ('KEY_DISAGREEMENT', 'OVERSIGHT')),
  state              TEXT    NOT NULL CHECK (state IN ('OPEN', 'RESOLVED')),
  decision_ids_json  TEXT    NOT NULL CHECK (json_valid(decision_ids_json) AND json_type(decision_ids_json) = 'array' AND length(decision_ids_json) <= 1024),
  resolution         TEXT             CHECK (resolution IS NULL OR resolution IN ('PASS', 'REWORK')),
  resolved_by_ref    TEXT             CHECK (resolved_by_ref IS NULL OR resolved_by_ref GLOB 'founder:*'),
  reason_code        TEXT             CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  resolved_at        TEXT             CHECK (resolved_at IS NULL OR resolved_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'RESOLVED') = (resolution IS NOT NULL AND resolved_at IS NOT NULL AND resolved_by_ref IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX review_conflicts_one_open ON review_conflicts (request_id) WHERE state = 'OPEN';
CREATE TRIGGER review_conflicts_no_delete BEFORE DELETE ON review_conflicts BEGIN SELECT RAISE(ABORT, 'review conflicts are durable history'); END;
CREATE TRIGGER review_conflicts_resolve_once BEFORE UPDATE ON review_conflicts
WHEN NEW.id IS NOT OLD.id OR NEW.request_id IS NOT OLD.request_id OR NEW.origin IS NOT OLD.origin OR NEW.decision_ids_json IS NOT OLD.decision_ids_json
  OR NEW.created_at IS NOT OLD.created_at OR OLD.state = 'RESOLVED'
BEGIN SELECT RAISE(ABORT, 'a review conflict is resolved once'); END;

-- Quality Holds (Stage 11 §30): temporarily block reliance on a reviewer, a qualification, a review domain or
-- a rubric. Skill holds stay C3's own Skill freshness (SECURITY_HOLD / RETIRED): no second Skill status.
CREATE TABLE quality_holds (
  id             TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  target_kind    TEXT NOT NULL CHECK (target_kind IN ('REVIEWER', 'QUALIFICATION', 'DOMAIN', 'RUBRIC')),
  target_ref     TEXT NOT NULL CHECK (length(target_ref) BETWEEN 1 AND 161),
  state          TEXT NOT NULL CHECK (state IN ('ACTIVE', 'LIFTED')),
  origin         TEXT NOT NULL CHECK (origin IN ('OVERSIGHT', 'FOUNDER')),
  finding_id     TEXT          REFERENCES oversight_findings (id) ON DELETE RESTRICT,
  reason_code    TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  placed_by_ref  TEXT NOT NULL CHECK (placed_by_ref GLOB 'founder:*'),
  lifted_by_ref  TEXT          CHECK (lifted_by_ref IS NULL OR lifted_by_ref GLOB 'founder:*'),
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  lifted_at      TEXT          CHECK (lifted_at IS NULL OR lifted_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'LIFTED') = (lifted_at IS NOT NULL AND lifted_by_ref IS NOT NULL))
) STRICT;
CREATE INDEX quality_holds_active ON quality_holds (target_kind, target_ref) WHERE state = 'ACTIVE';
CREATE TRIGGER quality_holds_no_delete BEFORE DELETE ON quality_holds BEGIN SELECT RAISE(ABORT, 'quality holds are durable history'); END;
CREATE TRIGGER quality_holds_lift_once BEFORE UPDATE ON quality_holds
WHEN NEW.id IS NOT OLD.id OR NEW.target_kind IS NOT OLD.target_kind OR NEW.target_ref IS NOT OLD.target_ref OR NEW.origin IS NOT OLD.origin
  OR NEW.finding_id IS NOT OLD.finding_id OR NEW.placed_by_ref IS NOT OLD.placed_by_ref OR NEW.created_at IS NOT OLD.created_at OR OLD.state = 'LIFTED'
BEGIN SELECT RAISE(ABORT, 'a quality hold is lifted once; it is history afterwards'); END;

-- Independent Quality Oversight findings (Stage 11 §27–§32): Finding → Root Cause → Corrective Action →
-- Verify → Close. Oversight proposes; it never approves, never satisfies a required review and never
-- expands its own authority.
CREATE TABLE oversight_findings (
  id                      TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  target_kind             TEXT    NOT NULL CHECK (target_kind IN ('WORK_ITEM', 'EMPLOYEE', 'REVIEWER', 'QUALIFICATION', 'DOMAIN', 'RUBRIC', 'DEPARTMENT', 'SKILL', 'WORKFLOW')),
  target_ref              TEXT    NOT NULL CHECK (length(target_ref) BETWEEN 1 AND 161),
  severity                TEXT    NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  state                   TEXT    NOT NULL CHECK (state IN ('OPEN', 'ROOT_CAUSED', 'CORRECTIVE_ACTION', 'VERIFIED', 'CLOSED')),
  review_request_id       TEXT             REFERENCES review_requests (id) ON DELETE RESTRICT,
  reason_code             TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  root_cause_code         TEXT             CHECK (root_cause_code IS NULL OR length(root_cause_code) BETWEEN 1 AND 64),
  corrective_action_code  TEXT             CHECK (corrective_action_code IS NULL OR length(corrective_action_code) BETWEEN 1 AND 64),
  created_by_ref          TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  version                 INTEGER NOT NULL CHECK (version >= 1),
  created_at              TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at              TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (state IN ('OPEN') OR root_cause_code IS NOT NULL),
  CHECK (state NOT IN ('CORRECTIVE_ACTION', 'VERIFIED', 'CLOSED') OR corrective_action_code IS NOT NULL)
) STRICT;
CREATE INDEX oversight_findings_state ON oversight_findings (state);
CREATE TRIGGER oversight_findings_no_delete BEFORE DELETE ON oversight_findings BEGIN SELECT RAISE(ABORT, 'findings are durable history'); END;
CREATE TRIGGER oversight_findings_forward BEFORE UPDATE ON oversight_findings
WHEN NEW.id IS NOT OLD.id OR NEW.target_kind IS NOT OLD.target_kind OR NEW.target_ref IS NOT OLD.target_ref OR NEW.review_request_id IS NOT OLD.review_request_id
  OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1 OR OLD.state = 'CLOSED'
  OR (CASE NEW.state WHEN 'OPEN' THEN 0 WHEN 'ROOT_CAUSED' THEN 1 WHEN 'CORRECTIVE_ACTION' THEN 2 WHEN 'VERIFIED' THEN 3 ELSE 4 END) < (CASE OLD.state WHEN 'OPEN' THEN 0 WHEN 'ROOT_CAUSED' THEN 1 WHEN 'CORRECTIVE_ACTION' THEN 2 WHEN 'VERIFIED' THEN 3 ELSE 4 END)
BEGIN SELECT RAISE(ABORT, 'a finding moves forward along its corrective-action loop'); END;
