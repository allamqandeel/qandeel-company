-- QANDEEL COMPANY operational schema — migration 0010: C6 Company Improvement Engine (Stage 17 reporting /
-- performance / learning; Stage 15 resilience): the QANDEEL-owned Eval Registry and its calibration runs,
-- governed outcome verification, evaluation results, causal attributions, learning signals (a companion to the
-- C3 lesson lifecycle, never a second learning store), learning interventions and their verified effect,
-- systemic findings, the failure → regression / Gold case lifecycle, report snapshots, and resilience records
-- (backup retirement, encrypted portable packages, restore drills, maintenance records).
-- IMMUTABLE once released (see 0001). Migrations 0001–0009 are unchanged.
--
-- Conventions as in 0001–0009: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete,
-- append-only history, forward-only updates. Everything here is Company-side governed evidence: ids, codes,
-- counts and hashes — no App data, no private content, no secret (Rule A / B / C). There is deliberately no
-- aggregate score column anywhere: a Performance Profile is derived per dimension, never stored as a number.

-- =====================================================================================================
-- 1. The Eval Registry (Stage 17 derived decision "QANDEEL-owned Eval Registry"): versioned, provider-
-- independent definitions. A definition becomes ACTIVE only with a PASSED calibration run of its own spec and a
-- Founder activation; its spec is immutable per version (a change is a new version that supersedes it).
-- =====================================================================================================
CREATE TABLE eval_definitions (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code                TEXT    NOT NULL CHECK (length(code) BETWEEN 1 AND 64 AND code NOT GLOB '*[^a-z0-9.-]*'),
  def_version         INTEGER NOT NULL CHECK (def_version >= 1),
  evaluation_type     TEXT    NOT NULL CHECK (evaluation_type IN ('WORK_OUTCOME')),
  subject_type        TEXT    NOT NULL CHECK (subject_type IN ('WORK_ITEM')),
  evaluator_kind      TEXT    NOT NULL CHECK (evaluator_kind IN ('DETERMINISTIC_RULES', 'REVIEW_POOL', 'FOUNDER', 'MODEL_GRADER')),
  spec_json           TEXT    NOT NULL CHECK (json_valid(spec_json) AND json_type(spec_json) = 'object' AND length(spec_json) <= 65536),
  spec_sha256         TEXT    NOT NULL CHECK (length(spec_sha256) = 64 AND spec_sha256 NOT GLOB '*[^0-9a-f]*'),
  status              TEXT    NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'RETIRED')),
  calibration_run_id  TEXT             REFERENCES eval_calibration_runs (id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  provenance          TEXT    NOT NULL CHECK (length(provenance) BETWEEN 1 AND 64),
  review_at           TEXT             CHECK (review_at IS NULL OR review_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  created_by_ref      TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  activated_by_ref    TEXT             CHECK (activated_by_ref IS NULL OR activated_by_ref GLOB 'founder:*'),
  version             INTEGER NOT NULL CHECK (version >= 1),
  created_at          TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at          TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (code, def_version),
  CHECK (status NOT IN ('ACTIVE', 'SUPERSEDED') OR (calibration_run_id IS NOT NULL AND activated_by_ref IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX eval_definitions_one_active ON eval_definitions (code) WHERE status = 'ACTIVE';
CREATE TRIGGER eval_definitions_no_delete BEFORE DELETE ON eval_definitions BEGIN SELECT RAISE(ABORT, 'eval definitions are retired or superseded, never deleted'); END;
CREATE TRIGGER eval_definitions_spec_immutable BEFORE UPDATE ON eval_definitions
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.def_version IS NOT OLD.def_version OR NEW.evaluation_type IS NOT OLD.evaluation_type
  OR NEW.subject_type IS NOT OLD.subject_type OR NEW.evaluator_kind IS NOT OLD.evaluator_kind OR NEW.spec_json IS NOT OLD.spec_json OR NEW.spec_sha256 IS NOT OLD.spec_sha256
  OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR OLD.status IN ('SUPERSEDED', 'RETIRED')
  OR (OLD.status = 'ACTIVE' AND NEW.status NOT IN ('SUPERSEDED', 'RETIRED'))
  OR (OLD.status = 'DRAFT' AND NEW.status NOT IN ('ACTIVE', 'RETIRED'))
BEGIN SELECT RAISE(ABORT, 'an eval definition version is immutable and moves forward only'); END;
-- The evaluator is itself evaluated: activation requires a PASSED calibration run of exactly this definition.
CREATE TRIGGER eval_definitions_activation_needs_calibration BEFORE UPDATE ON eval_definitions
WHEN NEW.status = 'ACTIVE' AND OLD.status = 'DRAFT'
  AND NOT EXISTS (SELECT 1 FROM eval_calibration_runs r WHERE r.id = NEW.calibration_run_id AND r.definition_id = NEW.id AND r.passed = 1 AND r.spec_sha256 = NEW.spec_sha256)
BEGIN SELECT RAISE(ABORT, 'an eval definition is activated only after it passes its own calibration'); END;

CREATE TABLE eval_definition_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id  TEXT    NOT NULL REFERENCES eval_definitions (id) ON DELETE RESTRICT,
  version        INTEGER NOT NULL CHECK (version >= 1),
  from_status    TEXT,
  to_status      TEXT    NOT NULL,
  reason_code    TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref      TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at    TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (definition_id, version)
) STRICT;
CREATE TRIGGER eval_definition_history_append_only_u BEFORE UPDATE ON eval_definition_history BEGIN SELECT RAISE(ABORT, 'eval definition history is append-only'); END;
CREATE TRIGGER eval_definition_history_append_only_d BEFORE DELETE ON eval_definition_history BEGIN SELECT RAISE(ABORT, 'eval definition history is append-only'); END;

-- Meta-evaluation evidence: one run of a definition's reference cases (known-good, known-bad, ambiguous,
-- non-employee cause, valid creative path). Append-only; a failed run is kept.
CREATE TABLE eval_calibration_runs (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  definition_id  TEXT    NOT NULL REFERENCES eval_definitions (id) ON DELETE RESTRICT,
  spec_sha256    TEXT    NOT NULL CHECK (length(spec_sha256) = 64 AND spec_sha256 NOT GLOB '*[^0-9a-f]*'),
  passed         INTEGER NOT NULL CHECK (passed IN (0, 1)),
  coverage_json  TEXT    NOT NULL CHECK (json_valid(coverage_json) AND json_type(coverage_json) = 'array' AND length(coverage_json) <= 512),
  results_json   TEXT    NOT NULL CHECK (json_valid(results_json) AND json_type(results_json) = 'array' AND length(results_json) <= 16384),
  actor_ref      TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  created_at     TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX eval_calibration_runs_definition ON eval_calibration_runs (definition_id, created_at);
CREATE TRIGGER eval_calibration_runs_append_only_u BEFORE UPDATE ON eval_calibration_runs BEGIN SELECT RAISE(ABORT, 'calibration runs are append-only'); END;
CREATE TRIGGER eval_calibration_runs_append_only_d BEFORE DELETE ON eval_calibration_runs BEGIN SELECT RAISE(ABORT, 'calibration runs are append-only'); END;

-- =====================================================================================================
-- 2. Outcome verification (Completed != Reviewed != Outcome Verified): the evidence behind REVIEWED →
-- OUTCOME_VERIFIED (or → CLOSED with NOT_ACHIEVED). Founder-decided in C6. External outcomes are refused until
-- a governed source exists (C7): they are never invented.
-- =====================================================================================================
CREATE TABLE outcome_verifications (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id           TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  verdict                TEXT    NOT NULL CHECK (verdict IN ('ACHIEVED', 'NOT_ACHIEVED', 'INCONCLUSIVE')),
  evidence_classes_json  TEXT    NOT NULL CHECK (json_valid(evidence_classes_json) AND json_type(evidence_classes_json) = 'array' AND json_array_length(evidence_classes_json) >= 1 AND length(evidence_classes_json) <= 512 AND evidence_classes_json NOT LIKE '%EXTERNAL_OUTCOME%'),
  evidence_refs_json     TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND json_array_length(evidence_refs_json) >= 1 AND length(evidence_refs_json) <= 4096),
  verifier_ref           TEXT    NOT NULL CHECK (verifier_ref GLOB 'founder:*'),
  reason_code            TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
-- One decisive verdict per Work Item (INCONCLUSIVE may precede it).
CREATE UNIQUE INDEX outcome_verifications_one_decisive ON outcome_verifications (work_item_id) WHERE verdict <> 'INCONCLUSIVE';
CREATE TRIGGER outcome_verifications_append_only_u BEFORE UPDATE ON outcome_verifications BEGIN SELECT RAISE(ABORT, 'outcome verifications are append-only'); END;
CREATE TRIGGER outcome_verifications_append_only_d BEFORE DELETE ON outcome_verifications BEGIN SELECT RAISE(ABORT, 'outcome verifications are append-only'); END;
-- Completion is not success: a verdict is recorded only on reviewed work (the REVIEWED family), never on COMPLETED alone.
CREATE TRIGGER outcome_verifications_need_review BEFORE INSERT ON outcome_verifications
WHEN NOT EXISTS (SELECT 1 FROM work_items w WHERE w.id = NEW.work_item_id AND w.state IN ('REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'))
BEGIN SELECT RAISE(ABORT, 'an outcome is verified only after independent review'); END;

-- =====================================================================================================
-- 3. Evaluation results: one live result per (Work Item, definition); a re-evaluation supersedes. Built only
-- from canonical rows by the deterministic evaluator; activity counts are stored as labelled observability.
-- =====================================================================================================
CREATE TABLE evaluation_results (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id          TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id           TEXT             REFERENCES employees (id) ON DELETE RESTRICT,
  department_id         TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  definition_id         TEXT    NOT NULL REFERENCES eval_definitions (id) ON DELETE RESTRICT,
  comparable_key        TEXT    NOT NULL CHECK (length(comparable_key) BETWEEN 1 AND 96),
  risk_level            TEXT    NOT NULL CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3', 'R4')),
  evidence_state        TEXT    NOT NULL CHECK (evidence_state IN ('SUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE')),
  qualified_outcome     INTEGER NOT NULL CHECK (qualified_outcome IN (0, 1)),
  dimensions_json       TEXT    NOT NULL CHECK (json_valid(dimensions_json) AND json_type(dimensions_json) = 'array' AND length(dimensions_json) <= 4096),
  missing_json          TEXT    NOT NULL CHECK (json_valid(missing_json) AND json_type(missing_json) = 'array' AND length(missing_json) <= 1024),
  conflicts_json        TEXT    NOT NULL CHECK (json_valid(conflicts_json) AND json_type(conflicts_json) = 'array' AND length(conflicts_json) <= 1024),
  cost_json             TEXT    NOT NULL CHECK (json_valid(cost_json) AND json_type(cost_json) = 'object' AND length(cost_json) <= 1024),
  observability_json    TEXT    NOT NULL CHECK (json_valid(observability_json) AND json_type(observability_json) = 'object' AND length(observability_json) <= 1024),
  evidence_json         TEXT    NOT NULL CHECK (json_valid(evidence_json) AND json_type(evidence_json) = 'object' AND length(evidence_json) <= 8192),
  evidence_sha256       TEXT    NOT NULL CHECK (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  evaluator_ref         TEXT    NOT NULL CHECK (length(evaluator_ref) BETWEEN 3 AND 161),
  superseded_by         TEXT             REFERENCES evaluation_results (id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (qualified_outcome = 0 OR evidence_state = 'SUFFICIENT_EVIDENCE')
) STRICT;
CREATE UNIQUE INDEX evaluation_results_one_live ON evaluation_results (work_item_id, definition_id) WHERE superseded_by IS NULL;
CREATE INDEX evaluation_results_employee ON evaluation_results (employee_id, created_at);
CREATE TRIGGER evaluation_results_no_delete BEFORE DELETE ON evaluation_results BEGIN SELECT RAISE(ABORT, 'evaluation results are durable history'); END;
CREATE TRIGGER evaluation_results_supersede_only BEFORE UPDATE ON evaluation_results
WHEN NEW.id IS NOT OLD.id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.department_id IS NOT OLD.department_id
  OR NEW.definition_id IS NOT OLD.definition_id OR NEW.comparable_key IS NOT OLD.comparable_key OR NEW.risk_level IS NOT OLD.risk_level
  OR NEW.evidence_state IS NOT OLD.evidence_state OR NEW.qualified_outcome IS NOT OLD.qualified_outcome OR NEW.dimensions_json IS NOT OLD.dimensions_json
  OR NEW.missing_json IS NOT OLD.missing_json OR NEW.conflicts_json IS NOT OLD.conflicts_json OR NEW.cost_json IS NOT OLD.cost_json
  OR NEW.observability_json IS NOT OLD.observability_json OR NEW.evidence_json IS NOT OLD.evidence_json OR NEW.evidence_sha256 IS NOT OLD.evidence_sha256
  OR NEW.evaluator_ref IS NOT OLD.evaluator_ref OR NEW.created_at IS NOT OLD.created_at OR OLD.superseded_by IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'an evaluation result is corrected by supersession, never rewritten'); END;
-- A qualified outcome is independently reviewed AND verified as achieved (defence in depth under the kernel).
CREATE TRIGGER evaluation_results_qualified_needs_verification BEFORE INSERT ON evaluation_results
WHEN NEW.qualified_outcome = 1 AND NOT EXISTS (SELECT 1 FROM outcome_verifications v WHERE v.work_item_id = NEW.work_item_id AND v.verdict = 'ACHIEVED')
BEGIN SELECT RAISE(ABORT, 'a qualified outcome needs a recorded ACHIEVED verification'); END;
-- Only an ACTIVE (calibrated) definition evaluates.
CREATE TRIGGER evaluation_results_active_definition BEFORE INSERT ON evaluation_results
WHEN NOT EXISTS (SELECT 1 FROM eval_definitions d WHERE d.id = NEW.definition_id AND d.status = 'ACTIVE')
BEGIN SELECT RAISE(ABORT, 'only an active, calibrated eval definition evaluates'); END;

-- =====================================================================================================
-- 4. Causal attribution (Stage 17 Founder Decision 2). Proposed by the evaluator or the Founder; validated
-- only independently of the subject Employee. Nothing learns from, and no profile counts, a proposal.
-- =====================================================================================================
CREATE TABLE causal_attributions (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id          TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  evaluation_id         TEXT             REFERENCES evaluation_results (id) ON DELETE RESTRICT,
  employee_id           TEXT             REFERENCES employees (id) ON DELETE RESTRICT,
  comparable_key        TEXT    NOT NULL CHECK (length(comparable_key) BETWEEN 1 AND 96),
  overall               TEXT    NOT NULL CHECK (overall IN ('EMPLOYEE_JUDGMENT', 'MODEL', 'TOOL', 'CONTEXT_RETRIEVAL', 'WORKFLOW_PROCESS', 'PROVIDER', 'REQUIREMENT', 'EXTERNAL_DEPENDENCY', 'MIXED', 'UNKNOWN')),
  causes_json           TEXT    NOT NULL CHECK (json_valid(causes_json) AND json_type(causes_json) = 'array' AND length(causes_json) <= 2048),
  employee_accountable  INTEGER NOT NULL CHECK (employee_accountable IN (0, 1)),
  confidence            TEXT    NOT NULL CHECK (confidence IN ('LOW', 'MEDIUM', 'HIGH')),
  source                TEXT    NOT NULL CHECK (source IN ('EVALUATOR_PROPOSAL', 'FOUNDER')),
  state                 TEXT    NOT NULL CHECK (state IN ('PROPOSED', 'VALIDATED', 'REJECTED', 'SUPERSEDED')),
  proposed_by_ref       TEXT    NOT NULL CHECK (length(proposed_by_ref) BETWEEN 3 AND 161),
  decided_by_ref        TEXT             CHECK (decided_by_ref IS NULL OR length(decided_by_ref) BETWEEN 3 AND 161),
  reason_code           TEXT             CHECK (reason_code IS NULL OR length(reason_code) BETWEEN 1 AND 64),
  evidence_refs_json    TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 4096),
  version               INTEGER NOT NULL CHECK (version >= 1),
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at            TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (state NOT IN ('VALIDATED', 'REJECTED') OR decided_by_ref IS NOT NULL),
  -- Independence: the subject Employee never validates the cause of their own work.
  CHECK (decided_by_ref IS NULL OR employee_id IS NULL OR decided_by_ref <> 'employee:' || employee_id),
  CHECK (employee_accountable = 0 OR overall = 'EMPLOYEE_JUDGMENT' OR overall = 'MIXED')
) STRICT;
CREATE UNIQUE INDEX causal_attributions_one_live ON causal_attributions (work_item_id) WHERE state IN ('PROPOSED', 'VALIDATED');
CREATE INDEX causal_attributions_employee ON causal_attributions (employee_id, state);
CREATE TRIGGER causal_attributions_no_delete BEFORE DELETE ON causal_attributions BEGIN SELECT RAISE(ABORT, 'attributions are durable history'); END;
CREATE TRIGGER causal_attributions_forward BEFORE UPDATE ON causal_attributions
WHEN NEW.id IS NOT OLD.id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.evaluation_id IS NOT OLD.evaluation_id OR NEW.employee_id IS NOT OLD.employee_id
  OR NEW.comparable_key IS NOT OLD.comparable_key OR NEW.overall IS NOT OLD.overall OR NEW.causes_json IS NOT OLD.causes_json
  OR NEW.employee_accountable IS NOT OLD.employee_accountable OR NEW.confidence IS NOT OLD.confidence OR NEW.source IS NOT OLD.source
  OR NEW.proposed_by_ref IS NOT OLD.proposed_by_ref OR NEW.evidence_refs_json IS NOT OLD.evidence_refs_json OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version <> OLD.version + 1 OR OLD.state IN ('REJECTED', 'SUPERSEDED')
  OR (OLD.state = 'VALIDATED' AND NEW.state <> 'SUPERSEDED')
BEGIN SELECT RAISE(ABORT, 'an attribution keeps its causes; it is decided once and superseded, never rewritten'); END;

CREATE TABLE causal_attribution_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  attribution_id  TEXT    NOT NULL REFERENCES causal_attributions (id) ON DELETE RESTRICT,
  version         INTEGER NOT NULL CHECK (version >= 1),
  from_state      TEXT,
  to_state        TEXT    NOT NULL,
  reason_code     TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref       TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at     TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (attribution_id, version)
) STRICT;
CREATE TRIGGER causal_attribution_history_append_only_u BEFORE UPDATE ON causal_attribution_history BEGIN SELECT RAISE(ABORT, 'attribution history is append-only'); END;
CREATE TRIGGER causal_attribution_history_append_only_d BEFORE DELETE ON causal_attribution_history BEGIN SELECT RAISE(ABORT, 'attribution history is append-only'); END;

-- =====================================================================================================
-- 5. Learning signals: the C6 classification of a C3 observation (MISTAKE_LESSON / SUCCESSFUL_PATTERN /
-- NEAR_MISS_WARNING) and where it came from. The lesson lifecycle itself stays the C3 one.
-- Reflection (an Employee's own observation) is a hypothesis: the gates below refuse to validate or share it
-- without independent evidence.
-- =====================================================================================================
CREATE TABLE learning_signals (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  observation_id      TEXT    NOT NULL UNIQUE REFERENCES lessons (id) ON DELETE RESTRICT,
  kind                TEXT    NOT NULL CHECK (kind IN ('MISTAKE_LESSON', 'SUCCESSFUL_PATTERN', 'NEAR_MISS_WARNING')),
  source              TEXT    NOT NULL CHECK (source IN ('REFLECTION', 'ATTRIBUTION', 'REVIEW', 'GATE_CATCH', 'EVALUATION')),
  work_item_id        TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  attribution_id      TEXT             REFERENCES causal_attributions (id) ON DELETE RESTRICT,
  evaluation_id       TEXT             REFERENCES evaluation_results (id) ON DELETE RESTRICT,
  codes_json          TEXT    NOT NULL CHECK (json_valid(codes_json) AND json_type(codes_json) = 'array' AND length(codes_json) <= 1024),
  classified_by_ref   TEXT    NOT NULL CHECK (length(classified_by_ref) BETWEEN 3 AND 161),
  created_at          TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX learning_signals_work_item ON learning_signals (work_item_id);
CREATE TRIGGER learning_signals_append_only_u BEFORE UPDATE ON learning_signals BEGIN SELECT RAISE(ABORT, 'learning signals are append-only'); END;
CREATE TRIGGER learning_signals_append_only_d BEFORE DELETE ON learning_signals BEGIN SELECT RAISE(ABORT, 'learning signals are append-only'); END;
CREATE TRIGGER learning_signals_classify_observations BEFORE INSERT ON learning_signals
WHEN NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = NEW.observation_id AND l.kind = 'OBSERVATION')
BEGIN SELECT RAISE(ABORT, 'a learning signal classifies a recorded observation'); END;

-- Validation gate on the C3 lesson lifecycle (a new trigger on an existing table; 0005 is untouched).
CREATE TRIGGER lessons_c6_validation_gate BEFORE UPDATE ON lessons
WHEN NEW.stage = 'VALIDATED' AND OLD.stage <> 'VALIDATED' AND EXISTS (SELECT 1 FROM learning_signals s WHERE s.observation_id = NEW.observation_id) AND (
     -- A mistake lesson needs a VALIDATED attribution that makes the Employee accountable.
     EXISTS (SELECT 1 FROM learning_signals s WHERE s.observation_id = NEW.observation_id AND s.kind = 'MISTAKE_LESSON'
             AND NOT EXISTS (SELECT 1 FROM causal_attributions a WHERE a.work_item_id = s.work_item_id AND a.state = 'VALIDATED' AND a.employee_accountable = 1))
  -- A successful pattern needs a qualified evaluation of its work.
  OR EXISTS (SELECT 1 FROM learning_signals s WHERE s.observation_id = NEW.observation_id AND s.kind = 'SUCCESSFUL_PATTERN'
             AND NOT EXISTS (SELECT 1 FROM evaluation_results e WHERE e.work_item_id = s.work_item_id AND e.qualified_outcome = 1 AND e.superseded_by IS NULL))
  -- A reflected near miss needs a validated attribution of its work.
  OR EXISTS (SELECT 1 FROM learning_signals s WHERE s.observation_id = NEW.observation_id AND s.kind = 'NEAR_MISS_WARNING' AND s.source = 'REFLECTION'
             AND NOT EXISTS (SELECT 1 FROM causal_attributions a WHERE a.work_item_id = s.work_item_id AND a.state = 'VALIDATED')))
BEGIN SELECT RAISE(ABORT, 'learning is validated only on independent evidence (reflection is a hypothesis)'); END;

-- =====================================================================================================
-- 6. Learning interventions and their verified effect (training completed is not learning proven).
-- =====================================================================================================
CREATE TABLE learning_interventions (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  lesson_id              TEXT    NOT NULL REFERENCES lessons (id) ON DELETE RESTRICT,
  employee_id            TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  kind                   TEXT    NOT NULL CHECK (kind IN ('TARGETED_RETRAINING', 'PATTERN_REUSE')),
  cycle_no               INTEGER NOT NULL CHECK (cycle_no BETWEEN 1 AND 100),
  target_cause           TEXT    NOT NULL CHECK (target_cause IN ('EMPLOYEE_JUDGMENT', 'MODEL', 'TOOL', 'CONTEXT_RETRIEVAL', 'WORKFLOW_PROCESS', 'PROVIDER', 'REQUIREMENT', 'EXTERNAL_DEPENDENCY')),
  comparable_key         TEXT    NOT NULL CHECK (length(comparable_key) BETWEEN 1 AND 96),
  remediation_id         TEXT             REFERENCES academy_remediations (id) ON DELETE RESTRICT,
  baseline_json          TEXT    NOT NULL CHECK (json_valid(baseline_json) AND json_type(baseline_json) = 'array' AND length(baseline_json) <= 4096),
  state                  TEXT    NOT NULL CHECK (state IN ('PLANNED', 'TRAINING_COMPLETED', 'EFFECT_ASSESSED', 'CANCELLED')),
  effect                 TEXT    NOT NULL CHECK (effect IN ('NOT_YET_TESTED', 'IMPROVEMENT_OBSERVED', 'NO_IMPROVEMENT', 'REGRESSION', 'INCONCLUSIVE')),
  effect_basis           TEXT             CHECK (effect_basis IS NULL OR length(effect_basis) BETWEEN 1 AND 64),
  evidence_refs_json     TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 4096),
  training_completed_at  TEXT             CHECK (training_completed_at IS NULL OR training_completed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  assessed_at            TEXT             CHECK (assessed_at IS NULL OR assessed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  created_by_ref         TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  version                INTEGER NOT NULL CHECK (version >= 1),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at             TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (lesson_id, kind, cycle_no),
  -- An effect other than "not yet tested" exists only after the training (or reuse) is complete.
  CHECK (effect = 'NOT_YET_TESTED' OR training_completed_at IS NOT NULL),
  CHECK ((state = 'EFFECT_ASSESSED') = (assessed_at IS NOT NULL AND effect <> 'NOT_YET_TESTED'))
) STRICT;
CREATE INDEX learning_interventions_employee ON learning_interventions (employee_id, state);
CREATE TRIGGER learning_interventions_no_delete BEFORE DELETE ON learning_interventions BEGIN SELECT RAISE(ABORT, 'interventions are durable history'); END;
CREATE TRIGGER learning_interventions_on_validated_lessons BEFORE INSERT ON learning_interventions
WHEN NOT EXISTS (SELECT 1 FROM lessons l WHERE l.id = NEW.lesson_id AND l.stage = 'VALIDATED')
BEGIN SELECT RAISE(ABORT, 'an intervention follows a validated lesson'); END;
-- No infinite retraining loop: after two ineffective cycles, the lesson escalates to systemic analysis instead.
CREATE TRIGGER learning_interventions_retraining_bound BEFORE INSERT ON learning_interventions
WHEN NEW.kind = 'TARGETED_RETRAINING' AND (
     (SELECT COUNT(*) FROM learning_interventions i WHERE i.lesson_id = NEW.lesson_id AND i.kind = 'TARGETED_RETRAINING' AND i.effect IN ('NO_IMPROVEMENT', 'REGRESSION')) >= 2
  OR EXISTS (SELECT 1 FROM learning_interventions i WHERE i.lesson_id = NEW.lesson_id AND i.kind = 'TARGETED_RETRAINING' AND i.state IN ('PLANNED', 'TRAINING_COMPLETED')))
BEGIN SELECT RAISE(ABORT, 'retraining is bounded: await the prior effect, or escalate after repeated ineffective cycles'); END;
CREATE TRIGGER learning_interventions_forward BEFORE UPDATE ON learning_interventions
WHEN NEW.id IS NOT OLD.id OR NEW.lesson_id IS NOT OLD.lesson_id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.kind IS NOT OLD.kind OR NEW.cycle_no IS NOT OLD.cycle_no
  OR NEW.target_cause IS NOT OLD.target_cause OR NEW.comparable_key IS NOT OLD.comparable_key OR NEW.baseline_json IS NOT OLD.baseline_json
  OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR OLD.state = 'CANCELLED' OR OLD.effect IN ('IMPROVEMENT_OBSERVED', 'NO_IMPROVEMENT', 'REGRESSION')
  OR (OLD.training_completed_at IS NOT NULL AND NEW.training_completed_at IS NOT OLD.training_completed_at)
BEGIN SELECT RAISE(ABORT, 'an intervention moves forward; a decisive effect is final'); END;

-- Sharing gate on the C3 promotion lifecycle: a successful pattern expands beyond its author only after verified reuse.
CREATE TRIGGER lesson_promotions_c6_pattern_gate BEFORE UPDATE ON lesson_promotions
WHEN NEW.state = 'APPROVED' AND OLD.state = 'PENDING_REVIEW' AND NEW.target <> 'PERSONAL'
  AND EXISTS (SELECT 1 FROM lessons l JOIN learning_signals s ON s.observation_id = l.observation_id WHERE l.id = NEW.lesson_id AND s.kind = 'SUCCESSFUL_PATTERN')
  AND (SELECT COUNT(*) FROM learning_interventions i WHERE i.lesson_id = NEW.lesson_id AND i.kind = 'PATTERN_REUSE' AND i.effect = 'IMPROVEMENT_OBSERVED') < 2
BEGIN SELECT RAISE(ABORT, 'a successful pattern is shared only after verified reuse'); END;

CREATE TABLE learning_intervention_history (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  intervention_id  TEXT    NOT NULL REFERENCES learning_interventions (id) ON DELETE RESTRICT,
  version          INTEGER NOT NULL CHECK (version >= 1),
  state            TEXT    NOT NULL,
  effect           TEXT    NOT NULL,
  reason_code      TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref        TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at      TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (intervention_id, version)
) STRICT;
CREATE TRIGGER learning_intervention_history_append_only_u BEFORE UPDATE ON learning_intervention_history BEGIN SELECT RAISE(ABORT, 'intervention history is append-only'); END;
CREATE TRIGGER learning_intervention_history_append_only_d BEFORE DELETE ON learning_intervention_history BEGIN SELECT RAISE(ABORT, 'intervention history is append-only'); END;

-- =====================================================================================================
-- 7. Systemic findings (double-loop learning): repeated validated causes point at a workflow, skill, tool,
-- evaluator, requirement, policy assumption, role design or Goal definition. A finding recommends; it never
-- rewrites governance, identity, authority or Founder policy.
-- =====================================================================================================
CREATE TABLE systemic_findings (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  dedup_key             TEXT    NOT NULL UNIQUE CHECK (length(dedup_key) BETWEEN 3 AND 200),
  target_kind           TEXT    NOT NULL CHECK (target_kind IN ('WORKFLOW', 'SKILL', 'TOOL', 'CONTEXT', 'MODEL_ROUTE', 'EVALUATOR', 'REQUIREMENT', 'POLICY_ASSUMPTION', 'ROLE_DESIGN', 'GOAL_DEFINITION', 'EXTERNAL_DEPENDENCY')),
  target_ref            TEXT    NOT NULL CHECK (length(target_ref) BETWEEN 1 AND 161),
  cause                 TEXT    NOT NULL CHECK (cause IN ('EMPLOYEE_JUDGMENT', 'MODEL', 'TOOL', 'CONTEXT_RETRIEVAL', 'WORKFLOW_PROCESS', 'PROVIDER', 'REQUIREMENT', 'EXTERNAL_DEPENDENCY')),
  origin                TEXT    NOT NULL CHECK (origin IN ('REPEATED_ATTRIBUTION', 'RETRAINING_EXHAUSTED')),
  occurrences           INTEGER NOT NULL CHECK (occurrences >= 1),
  distinct_employees    INTEGER NOT NULL CHECK (distinct_employees >= 0),
  evidence_refs_json    TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND json_array_length(evidence_refs_json) >= 1 AND length(evidence_refs_json) <= 8192),
  state                 TEXT    NOT NULL CHECK (state IN ('CANDIDATE', 'VALIDATED', 'REJECTED', 'ADDRESSED')),
  recommendation_code   TEXT    NOT NULL CHECK (length(recommendation_code) BETWEEN 1 AND 64),
  oversight_finding_id  TEXT             REFERENCES oversight_findings (id) ON DELETE RESTRICT,
  decided_by_ref        TEXT             CHECK (decided_by_ref IS NULL OR decided_by_ref GLOB 'founder:*'),
  version               INTEGER NOT NULL CHECK (version >= 1),
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at            TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (state = 'CANDIDATE' OR decided_by_ref IS NOT NULL)
) STRICT;
CREATE INDEX systemic_findings_state ON systemic_findings (state);
CREATE TRIGGER systemic_findings_no_delete BEFORE DELETE ON systemic_findings BEGIN SELECT RAISE(ABORT, 'systemic findings are durable history'); END;
CREATE TRIGGER systemic_findings_forward BEFORE UPDATE ON systemic_findings
WHEN NEW.id IS NOT OLD.id OR NEW.dedup_key IS NOT OLD.dedup_key OR NEW.target_kind IS NOT OLD.target_kind OR NEW.target_ref IS NOT OLD.target_ref
  OR NEW.cause IS NOT OLD.cause OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR NEW.occurrences < OLD.occurrences OR OLD.state IN ('REJECTED', 'ADDRESSED')
  OR (OLD.state = 'VALIDATED' AND NEW.state NOT IN ('VALIDATED', 'ADDRESSED'))
  OR (OLD.state <> 'CANDIDATE' AND (NEW.evidence_refs_json IS NOT OLD.evidence_refs_json OR NEW.occurrences IS NOT OLD.occurrences))
BEGIN SELECT RAISE(ABORT, 'a systemic finding keeps its target; evidence only grows while it is a candidate'); END;

CREATE TABLE systemic_finding_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id   TEXT    NOT NULL REFERENCES systemic_findings (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT,
  to_state     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (finding_id, version)
) STRICT;
CREATE TRIGGER systemic_finding_history_append_only_u BEFORE UPDATE ON systemic_finding_history BEGIN SELECT RAISE(ABORT, 'systemic finding history is append-only'); END;
CREATE TRIGGER systemic_finding_history_append_only_d BEFORE DELETE ON systemic_finding_history BEGIN SELECT RAISE(ABORT, 'systemic finding history is append-only'); END;

-- =====================================================================================================
-- 8. Failure cases: REAL_FAILURE → CAUSE_ANALYSIS → VALID_FAILURE_CASE → REGRESSION_CANDIDATE →
-- REGRESSION_CASE / GOLD_CASE (Stage 17 Founder Decision 5). A permanent case is bound to an Academy scenario;
-- a hidden (Gold) case to a HOLDOUT scenario, which is never retraining material.
-- =====================================================================================================
CREATE TABLE failure_cases (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id          TEXT    NOT NULL UNIQUE REFERENCES work_items (id) ON DELETE RESTRICT,
  attribution_id        TEXT             REFERENCES causal_attributions (id) ON DELETE RESTRICT,
  comparable_key        TEXT    NOT NULL CHECK (length(comparable_key) BETWEEN 1 AND 96),
  stage                 TEXT    NOT NULL CHECK (stage IN ('REAL_FAILURE', 'CAUSE_ANALYSIS', 'VALID_FAILURE_CASE', 'REGRESSION_CANDIDATE', 'REGRESSION_CASE', 'GOLD_CASE', 'REJECTED')),
  hidden                INTEGER NOT NULL CHECK (hidden IN (0, 1)),
  academy_scenario_id   TEXT             REFERENCES academy_scenarios (id) ON DELETE RESTRICT,
  calibration_run_id    TEXT             REFERENCES eval_calibration_runs (id) ON DELETE RESTRICT,
  created_by_ref        TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  version               INTEGER NOT NULL CHECK (version >= 1),
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at            TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (stage NOT IN ('VALID_FAILURE_CASE', 'REGRESSION_CANDIDATE', 'REGRESSION_CASE', 'GOLD_CASE') OR attribution_id IS NOT NULL),
  CHECK (stage NOT IN ('REGRESSION_CASE', 'GOLD_CASE') OR (academy_scenario_id IS NOT NULL AND calibration_run_id IS NOT NULL)),
  CHECK (stage <> 'GOLD_CASE' OR hidden = 1)
) STRICT;
CREATE TRIGGER failure_cases_no_delete BEFORE DELETE ON failure_cases BEGIN SELECT RAISE(ABORT, 'failure cases are durable history'); END;
CREATE TRIGGER failure_cases_forward BEFORE UPDATE ON failure_cases
WHEN NEW.id IS NOT OLD.id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.comparable_key IS NOT OLD.comparable_key OR NEW.created_by_ref IS NOT OLD.created_by_ref
  OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1 OR OLD.stage IN ('REGRESSION_CASE', 'GOLD_CASE', 'REJECTED')
  OR (OLD.attribution_id IS NOT NULL AND NEW.attribution_id IS NOT OLD.attribution_id)
BEGIN SELECT RAISE(ABORT, 'a failure case moves forward once; a permanent case is history'); END;
CREATE TRIGGER failure_cases_hidden_is_holdout BEFORE UPDATE ON failure_cases
WHEN NEW.academy_scenario_id IS NOT NULL AND NEW.hidden = 1 AND NOT EXISTS (SELECT 1 FROM academy_scenarios s WHERE s.id = NEW.academy_scenario_id AND s.kind = 'HOLDOUT')
BEGIN SELECT RAISE(ABORT, 'a hidden case is bound to a holdout scenario'); END;

CREATE TABLE failure_case_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id      TEXT    NOT NULL REFERENCES failure_cases (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_stage   TEXT,
  to_stage     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (case_id, version)
) STRICT;
CREATE TRIGGER failure_case_history_append_only_u BEFORE UPDATE ON failure_case_history BEGIN SELECT RAISE(ABORT, 'failure case history is append-only'); END;
CREATE TRIGGER failure_case_history_append_only_d BEFORE DELETE ON failure_case_history BEGIN SELECT RAISE(ABORT, 'failure case history is append-only'); END;

-- =====================================================================================================
-- 9. Report snapshots: the typed claims of a Daily / Weekly / Monthly report exactly as generated (FACT /
-- ASSESSMENT / TREND / RECOMMENDATION, evidence refs, uncertainty). Identical regeneration is idempotent.
-- =====================================================================================================
CREATE TABLE report_snapshots (
  id                TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  cadence           TEXT    NOT NULL CHECK (cadence IN ('DAILY', 'WEEKLY', 'MONTHLY')),
  period_from       TEXT    NOT NULL CHECK (period_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  period_to         TEXT    NOT NULL CHECK (period_to GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  claims_json       TEXT    NOT NULL CHECK (json_valid(claims_json) AND json_type(claims_json) = 'array' AND length(claims_json) <= 262144),
  claims_sha256     TEXT    NOT NULL CHECK (length(claims_sha256) = 64 AND claims_sha256 NOT GLOB '*[^0-9a-f]*'),
  claim_count       INTEGER NOT NULL CHECK (claim_count >= 1),
  generated_by_ref  TEXT    NOT NULL CHECK (length(generated_by_ref) BETWEEN 3 AND 161),
  created_at        TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (cadence, period_to, claims_sha256),
  CHECK (period_to > period_from)
) STRICT;
CREATE INDEX report_snapshots_cadence ON report_snapshots (cadence, period_to);
CREATE TRIGGER report_snapshots_append_only_u BEFORE UPDATE ON report_snapshots BEGIN SELECT RAISE(ABORT, 'report snapshots are append-only'); END;
CREATE TRIGGER report_snapshots_append_only_d BEFORE DELETE ON report_snapshots BEGIN SELECT RAISE(ABORT, 'report snapshots are append-only'); END;

-- =====================================================================================================
-- 10. Resilience (Stage 15): generational retention, encrypted portable packages, restore drills, maintenance.
-- `backup_records` (0002) stays append-only; a pruned generation is recorded here, never by deleting its row.
-- =====================================================================================================
CREATE TABLE backup_retirements (
  backup_id     TEXT NOT NULL PRIMARY KEY REFERENCES backup_records (id) ON DELETE RESTRICT,
  reason_code   TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  policy_json   TEXT NOT NULL CHECK (json_valid(policy_json) AND json_type(policy_json) = 'object' AND length(policy_json) <= 1024),
  actor_ref     TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  retired_at    TEXT NOT NULL CHECK (retired_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE TRIGGER backup_retirements_append_only_u BEFORE UPDATE ON backup_retirements BEGIN SELECT RAISE(ABORT, 'backup retirements are append-only'); END;
CREATE TRIGGER backup_retirements_append_only_d BEFORE DELETE ON backup_retirements BEGIN SELECT RAISE(ABORT, 'backup retirements are append-only'); END;
-- Retention never removes the last live generation.
CREATE TRIGGER backup_retirements_keep_one BEFORE INSERT ON backup_retirements
WHEN (SELECT COUNT(*) FROM backup_records b WHERE b.integrity_result = 'ok' AND b.id <> NEW.backup_id AND NOT EXISTS (SELECT 1 FROM backup_retirements r WHERE r.backup_id = b.id)) < 1
BEGIN SELECT RAISE(ABORT, 'retention always keeps at least one live backup generation'); END;

CREATE TABLE portable_backups (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  backup_id          TEXT    NOT NULL REFERENCES backup_records (id) ON DELETE RESTRICT,
  destination_kind   TEXT    NOT NULL CHECK (destination_kind IN ('DIRECTORY')),
  destination_ref    TEXT    NOT NULL CHECK (length(destination_ref) = 64 AND destination_ref NOT GLOB '*[^0-9a-f]*'),
  failure_domain     TEXT    NOT NULL CHECK (failure_domain IN ('SAME_VOLUME', 'SEPARATE_VOLUME', 'ATTESTED_OFF_DEVICE')),
  package_name       TEXT    NOT NULL CHECK (length(package_name) BETWEEN 1 AND 96 AND package_name NOT GLOB '*[^a-z0-9.-]*'),
  package_sha256     TEXT    NOT NULL CHECK (length(package_sha256) = 64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'),
  size_bytes         INTEGER NOT NULL CHECK (size_bytes > 0),
  format             TEXT    NOT NULL CHECK (length(format) BETWEEN 1 AND 64),
  kdf_json           TEXT    NOT NULL CHECK (json_valid(kdf_json) AND json_type(kdf_json) = 'object' AND length(kdf_json) <= 512),
  state              TEXT    NOT NULL CHECK (state IN ('VERIFIED', 'RETIRED')),
  verified_at        TEXT    NOT NULL CHECK (verified_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  retired_at         TEXT             CHECK (retired_at IS NULL OR retired_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'RETIRED') = (retired_at IS NOT NULL))
) STRICT;
CREATE INDEX portable_backups_live ON portable_backups (state, verified_at);
CREATE TRIGGER portable_backups_no_delete BEFORE DELETE ON portable_backups BEGIN SELECT RAISE(ABORT, 'portable backup records are durable history'); END;
CREATE TRIGGER portable_backups_forward BEFORE UPDATE ON portable_backups
WHEN NEW.id IS NOT OLD.id OR NEW.backup_id IS NOT OLD.backup_id OR NEW.destination_kind IS NOT OLD.destination_kind OR NEW.destination_ref IS NOT OLD.destination_ref
  OR NEW.failure_domain IS NOT OLD.failure_domain OR NEW.package_name IS NOT OLD.package_name OR NEW.package_sha256 IS NOT OLD.package_sha256
  OR NEW.size_bytes IS NOT OLD.size_bytes OR NEW.format IS NOT OLD.format OR NEW.kdf_json IS NOT OLD.kdf_json OR NEW.created_at IS NOT OLD.created_at
  OR OLD.state = 'RETIRED' OR NEW.verified_at < OLD.verified_at
BEGIN SELECT RAISE(ABORT, 'a portable package record keeps its identity; it is re-verified or retired, never rewritten'); END;
CREATE TRIGGER portable_backups_keep_one BEFORE UPDATE ON portable_backups
WHEN NEW.state = 'RETIRED' AND OLD.state = 'VERIFIED' AND (SELECT COUNT(*) FROM portable_backups p WHERE p.state = 'VERIFIED' AND p.id <> NEW.id) < 1
BEGIN SELECT RAISE(ABORT, 'retention always keeps at least one verified portable package'); END;

CREATE TABLE recovery_drills (
  id           TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  kind         TEXT    NOT NULL CHECK (kind IN ('BACKUP_VERIFY', 'ISOLATED_RESTORE', 'PORTABLE_RESTORE')),
  subject_ref  TEXT    NOT NULL CHECK (length(subject_ref) BETWEEN 3 AND 161),
  result       TEXT    NOT NULL CHECK (result IN ('PASS', 'FAIL')),
  code         TEXT    NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  duration_ms  INTEGER NOT NULL CHECK (duration_ms >= 0),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  created_at   TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX recovery_drills_recent ON recovery_drills (kind, created_at);
CREATE TRIGGER recovery_drills_append_only_u BEFORE UPDATE ON recovery_drills BEGIN SELECT RAISE(ABORT, 'restore drills are append-only'); END;
CREATE TRIGGER recovery_drills_append_only_d BEFORE DELETE ON recovery_drills BEGIN SELECT RAISE(ABORT, 'restore drills are append-only'); END;

-- Maintenance (Preflight → Backup → Rehearse → Migrate → Verify → Activate). Written into the database that
-- results; a failed attempt is recorded after its rollback (the on-disk maintenance journal carries the rest).
CREATE TABLE maintenance_records (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  kind                   TEXT    NOT NULL CHECK (kind IN ('SCHEMA_UPDATE')),
  from_version           INTEGER NOT NULL CHECK (from_version >= 1),
  to_version             INTEGER NOT NULL CHECK (to_version >= from_version),
  snapshot_sha256        TEXT    NOT NULL CHECK (length(snapshot_sha256) = 64 AND snapshot_sha256 NOT GLOB '*[^0-9a-f]*'),
  outcome                TEXT    NOT NULL CHECK (outcome IN ('ACTIVATED', 'ROLLED_BACK_UPDATE_HOLD')),
  code                   TEXT    NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  runtime_version        TEXT    NOT NULL CHECK (length(runtime_version) BETWEEN 1 AND 32),
  started_at             TEXT    NOT NULL CHECK (started_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  finished_at            TEXT    NOT NULL CHECK (finished_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER maintenance_records_append_only_u BEFORE UPDATE ON maintenance_records BEGIN SELECT RAISE(ABORT, 'maintenance records are append-only'); END;
CREATE TRIGGER maintenance_records_append_only_d BEFORE DELETE ON maintenance_records BEGIN SELECT RAISE(ABORT, 'maintenance records are append-only'); END;
