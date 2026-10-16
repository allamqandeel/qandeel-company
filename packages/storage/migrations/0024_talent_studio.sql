-- QANDEEL COMPANY operational schema — migration 0024: COMPANY-TALENT-01, the universal Staffing, Identity, Skills & Academy studio.
-- IMMUTABLE once released (see 0001). Migrations 0001–0023 are unchanged.
--
-- Hiring and qualification become Company data run from the Company's own surface, on the EXISTING engines (staffing
-- requests, seats, the hire, the Skill Registry, BQM-2, the Academy, the activation gate, grants and Tools). Nothing here
-- creates an Employee, a grant, a budget or a policy: every row is written by a governed act.
--
--   founder_action_previews        the governed confirmation gains the COMPANY-TALENT-01 structured intents (the catalogue
--                                  is a datastore CHECK: recreated with the extended list, every row kept, 0023 precedent).
--   talent_definitions (+history)  identity profiles and Academy program definitions as versioned, digest-frozen data:
--                                  DRAFT (editable) → SUBMITTED (content frozen) → APPROVED by the Founder | REJECTED;
--                                  an APPROVED version is SUPERSEDED by its successor. Content is local governed Company
--                                  content (never copied into audit, events or logs — Rule A).
--   employee_identity_bindings     which approved identity profile version an Employee carries, with its history (a
--                                  revision ends one binding and starts the next; nothing is rewritten).
--   staffing_requests.headcount    D7: a request may ask for several identical seats (1..10; immutable evidence).
--   access_policies / policy_grant_links
--                                  D2–D5: a Founder-approved leadership policy and the individual grants it issued (each
--                                  grant stays an ordinary `permission_grants` row, granted by the Founder's act).
--   role_tool_requirements         the Tools a role needs (metadata; readiness is derived, never asserted).
--   talent_proposals               a leader's proposal (identity, program, skill, retraining, Department budget): evidence
--                                  and a request, never a decision.
--   academy_dimension_results      D5 (Founder amendment of D-C3-10 / D-C3-22 7.1, the widening C3 deferred to a later
--                                  migration): a qualified MANAGER may evaluate a direct report. The table is recreated with
--                                  every row kept; an `employee:*` evaluator is admitted ONLY as kind MANAGER, ONLY with an
--                                  APPLIED manager evaluation of that attempt by that Employee, and NEVER the trainee.
--   academy_manager_evaluations    a manager's evaluation of one attempt: assigned by the Founder, proposed by the manager's
--                                  own governed run, applied directly for practice and only after an independent review
--                                  for an assessment / holdout (critical evaluations).
--   academy_competency_results     the specialty competencies a program assesses beside the ten dimensions.
--   academy_scenarios.tool_code    a scenario that assesses operating a Tool names it (null = a text scenario).
--   certification_tool_scopes      for every Tool the role needs, whether the certification ASSESSED operating it or not.

CREATE TEMP TABLE c4_copy_founder_action_previews AS SELECT * FROM main.founder_action_previews;
DROP TABLE main.founder_action_previews;
CREATE TABLE founder_action_previews (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  session_id     TEXT    NOT NULL REFERENCES founder_sessions (id) ON DELETE RESTRICT,
  intent_kind    TEXT    NOT NULL CHECK (intent_kind IN ('APPROVAL_DECIDE', 'GOAL_APPROVE', 'GOAL_STATE', 'GOAL_PROPOSE', 'STAFFING_DECIDE', 'CONFLICT_RESOLVE', 'BUDGET_CEILING', 'DELEGATE_WORK',
                                                         'TOOL_RECONCILE', 'RESERVATION_RECONCILE', 'JOB_RECONCILE', 'REVIEW_ESCALATION_RESOLVE', 'SYSTEMIC_DECIDE', 'ATTRIBUTION_DECIDE', 'LESSON_DECIDE', 'OUTCOME_VERIFY', 'PROMOTION_DECIDE',
                                                         'SOURCE_REGISTER', 'SOURCE_DECIDE', 'EVIDENCE_BIND', 'EVIDENCE_UNBIND', 'OUTCOME_CONTEST_RESOLVE',
                                                         'PILOT_CREATE', 'PILOT_ADVANCE',
                                                         'PROVIDER_PROVISION',
                                                         'EMPLOYEE_HIRE', 'EMPLOYEE_LIFECYCLE', 'EMPLOYEE_MODEL_ACCESS', 'SKILL_PACKAGE_QUALIFY', 'ACADEMY_PACKAGE_INSTALL', 'ACADEMY_ENROLL',
                                                         'ACADEMY_MODULES_COMPLETE', 'ACADEMY_ATTEMPT_START', 'ACADEMY_EVALUATE', 'ACADEMY_RETRAIN_COMPLETE', 'ACADEMY_SHADOW_ASSIGN',
                                                         'ACADEMY_PROBATION_EVIDENCE', 'ACADEMY_PROBATION_REVIEW', 'ACADEMY_CALIBRATION', 'ACTIVATION_DECIDE',
                                                         'EMPLOYEE_REASONING_PROFILE', 'WORK_ITEM_REASONING_OVERRIDE',
                                                         'ACADEMY_FOUNDER_FEEDBACK',
                                                         'EMPLOYEE_RENAME', 'PRODUCT_KNOWLEDGE_ACCESS',
                                                         'FOUNDER_DECISION_RECORD', 'FOUNDER_DECISION_REVOKE',
                                                         'TALENT_DEFINITION_DECIDE', 'TALENT_PROPOSAL_DECIDE', 'EMPLOYEE_IDENTITY_REVISE', 'POSITION_CREATE', 'DEPARTMENT_BUDGET',
                                                         'ACCESS_POLICY_DECIDE', 'ROLE_TOOL_REQUIREMENT', 'TOOL_ACCESS', 'EMPLOYEE_RETRAIN', 'ACADEMY_EVALUATION_ASSIGN', 'ACADEMY_EVALUATION_REVIEW')),
  payload_json   TEXT    NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object' AND length(payload_json) <= 4096),
  fingerprint    TEXT    NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  state          TEXT    NOT NULL CHECK (state IN ('PREVIEW', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'FAILED')),
  result_ref     TEXT             CHECK (result_ref IS NULL OR length(result_ref) BETWEEN 3 AND 161),
  result_code    TEXT             CHECK (result_code IS NULL OR length(result_code) BETWEEN 1 AND 64),
  created_at     TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  expires_at     TEXT    NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_at     TEXT             CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (expires_at > created_at),
  CHECK ((state = 'PREVIEW') = (decided_at IS NULL)),
  CHECK (state <> 'CONFIRMED' OR result_ref IS NOT NULL)
) STRICT;
INSERT INTO founder_action_previews (id, session_id, intent_kind, payload_json, fingerprint, state, result_ref, result_code, created_at, expires_at, decided_at)
  SELECT id, session_id, intent_kind, payload_json, fingerprint, state, result_ref, result_code, created_at, expires_at, decided_at FROM temp.c4_copy_founder_action_previews;
DROP TABLE temp.c4_copy_founder_action_previews;
CREATE INDEX founder_action_previews_session ON founder_action_previews (session_id, state);
CREATE TRIGGER founder_action_previews_no_delete BEFORE DELETE ON founder_action_previews BEGIN SELECT RAISE(ABORT, 'previews are decided or expire; they are audit history'); END;
CREATE TRIGGER founder_action_previews_decide_once BEFORE UPDATE ON founder_action_previews
WHEN NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id OR NEW.intent_kind IS NOT OLD.intent_kind OR NEW.payload_json IS NOT OLD.payload_json
  OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.state <> 'PREVIEW'
BEGIN SELECT RAISE(ABORT, 'a preview is decided exactly once and never rewritten'); END;

-- =====================================================================================================
-- The Talent Catalog: identity profiles and Academy program definitions as versioned Company data.
-- =====================================================================================================
CREATE TABLE talent_definitions (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  kind             TEXT    NOT NULL CHECK (kind IN ('IDENTITY_PROFILE', 'ACADEMY_PROGRAM')),
  code             TEXT    NOT NULL CHECK (length(code) BETWEEN 2 AND 96 AND code NOT GLOB '*[^a-z0-9.-]*'),
  version          INTEGER NOT NULL CHECK (version BETWEEN 1 AND 10000),
  role_ref         TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*'),
  title            TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  state            TEXT    NOT NULL CHECK (state IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN')),
  body_json        TEXT    NOT NULL CHECK (json_valid(body_json) AND json_type(body_json) = 'object' AND length(body_json) <= 2000000),
  sha256           TEXT             CHECK (sha256 IS NULL OR (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*')),
  author_ref       TEXT    NOT NULL CHECK (author_ref GLOB 'founder:*' OR author_ref GLOB 'employee:*'),
  proposal_id      TEXT             CHECK (proposal_id IS NULL OR length(proposal_id) = 36),
  submitted_at     TEXT             CHECK (submitted_at IS NULL OR submitted_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_by_ref   TEXT             CHECK (decided_by_ref IS NULL OR (decided_by_ref GLOB 'founder:*' AND length(decided_by_ref) BETWEEN 9 AND 161)),
  decided_at       TEXT             CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decision_code    TEXT             CHECK (decision_code IS NULL OR length(decision_code) BETWEEN 1 AND 64),
  row_version      INTEGER NOT NULL CHECK (row_version >= 1),
  created_at       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at       TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (kind, code, version),
  -- Content is digest-pinned from submission on; a decision is the Founder's, recorded once.
  CHECK (state = 'DRAFT' OR state = 'WITHDRAWN' OR (sha256 IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK ((state IN ('APPROVED', 'REJECTED', 'SUPERSEDED')) = (decided_by_ref IS NOT NULL AND decided_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX talent_definitions_one_approved ON talent_definitions (kind, code) WHERE state = 'APPROVED';
CREATE INDEX talent_definitions_role ON talent_definitions (role_ref, kind, state);
CREATE TRIGGER talent_definitions_no_delete BEFORE DELETE ON talent_definitions BEGIN SELECT RAISE(ABORT, 'talent definitions are durable history'); END;
CREATE TRIGGER talent_definitions_frozen BEFORE UPDATE ON talent_definitions
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.code IS NOT OLD.code OR NEW.version IS NOT OLD.version OR NEW.author_ref IS NOT OLD.author_ref
  OR NEW.created_at IS NOT OLD.created_at OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.row_version <> OLD.row_version + 1
  OR (OLD.state <> 'DRAFT' AND (NEW.body_json IS NOT OLD.body_json OR NEW.sha256 IS NOT OLD.sha256 OR NEW.role_ref IS NOT OLD.role_ref OR NEW.title IS NOT OLD.title OR NEW.submitted_at IS NOT OLD.submitted_at))
  OR (OLD.state = 'DRAFT' AND NEW.state NOT IN ('DRAFT', 'SUBMITTED', 'WITHDRAWN'))
  OR (OLD.state = 'SUBMITTED' AND NEW.state NOT IN ('APPROVED', 'REJECTED', 'WITHDRAWN'))
  OR (OLD.state = 'APPROVED' AND NEW.state NOT IN ('SUPERSEDED'))
  OR (OLD.state IN ('REJECTED', 'SUPERSEDED', 'WITHDRAWN'))
  OR (OLD.decided_by_ref IS NOT NULL AND (NEW.decided_by_ref IS NOT OLD.decided_by_ref OR NEW.decision_code IS NOT OLD.decision_code))
BEGIN SELECT RAISE(ABORT, 'a submitted talent definition is frozen; its lifecycle only moves forward'); END;

CREATE TABLE talent_definition_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id  TEXT    NOT NULL REFERENCES talent_definitions (id) ON DELETE RESTRICT,
  from_state     TEXT             CHECK (from_state IS NULL OR from_state IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN')),
  to_state       TEXT    NOT NULL CHECK (to_state IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN')),
  sha256         TEXT             CHECK (sha256 IS NULL OR length(sha256) = 64),
  reason_code    TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref      TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at    TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX talent_definition_history_def ON talent_definition_history (definition_id, id);
CREATE TRIGGER talent_definition_history_append_only_u BEFORE UPDATE ON talent_definition_history BEGIN SELECT RAISE(ABORT, 'talent definition history is append-only'); END;
CREATE TRIGGER talent_definition_history_append_only_d BEFORE DELETE ON talent_definition_history BEGIN SELECT RAISE(ABORT, 'talent definition history is append-only'); END;

-- An Employee's identity profile version, with its history (a revision ends one binding and starts the next).
CREATE TABLE employee_identity_bindings (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id      TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  definition_id    TEXT    NOT NULL REFERENCES talent_definitions (id) ON DELETE RESTRICT,
  sha256           TEXT    NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  kernel_sha256    TEXT    NOT NULL CHECK (length(kernel_sha256) = 64 AND kernel_sha256 NOT GLOB '*[^0-9a-f]*'),
  classification   TEXT    NOT NULL CHECK (classification IN ('INITIAL', 'MINOR', 'MATERIAL')),
  bound_by_ref     TEXT    NOT NULL CHECK (bound_by_ref GLOB 'founder:*' AND length(bound_by_ref) BETWEEN 9 AND 161),
  bound_at         TEXT    NOT NULL CHECK (bound_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  ended_at         TEXT             CHECK (ended_at IS NULL OR ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  ended_by_ref     TEXT             CHECK (ended_by_ref IS NULL OR length(ended_by_ref) BETWEEN 3 AND 161),
  CHECK ((ended_at IS NULL) = (ended_by_ref IS NULL))
) STRICT;
CREATE UNIQUE INDEX employee_identity_bindings_live ON employee_identity_bindings (employee_id) WHERE ended_at IS NULL;
CREATE TRIGGER employee_identity_bindings_no_delete BEFORE DELETE ON employee_identity_bindings BEGIN SELECT RAISE(ABORT, 'identity bindings are durable history'); END;
CREATE TRIGGER employee_identity_bindings_end_once BEFORE UPDATE ON employee_identity_bindings
WHEN NEW.id IS NOT OLD.id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.definition_id IS NOT OLD.definition_id OR NEW.sha256 IS NOT OLD.sha256
  OR NEW.kernel_sha256 IS NOT OLD.kernel_sha256 OR NEW.classification IS NOT OLD.classification OR NEW.bound_by_ref IS NOT OLD.bound_by_ref
  OR NEW.bound_at IS NOT OLD.bound_at OR OLD.ended_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'an identity binding is only ended, once'); END;
-- Only an APPROVED identity profile of the Employee's own role is ever bound.
CREATE TRIGGER employee_identity_bindings_approved BEFORE INSERT ON employee_identity_bindings
WHEN NOT EXISTS (SELECT 1 FROM talent_definitions d JOIN employees e ON e.id = NEW.employee_id
                 WHERE d.id = NEW.definition_id AND d.kind = 'IDENTITY_PROFILE' AND d.state = 'APPROVED' AND d.sha256 = NEW.sha256 AND d.role_ref = e.role_ref)
BEGIN SELECT RAISE(ABORT, 'an Employee carries only an approved identity profile of its own role'); END;

-- =====================================================================================================
-- Staffing: D7 headcount (immutable evidence of the request, like the rest of it).
-- =====================================================================================================
ALTER TABLE staffing_requests ADD COLUMN headcount INTEGER NOT NULL DEFAULT 1 CHECK (headcount BETWEEN 1 AND 10);
CREATE TRIGGER staffing_requests_headcount_immutable BEFORE UPDATE OF headcount ON staffing_requests
WHEN NEW.headcount IS NOT OLD.headcount
BEGIN SELECT RAISE(ABORT, 'a staffing request''s headcount is part of its immutable evidence'); END;

-- =====================================================================================================
-- Leadership access policies (D2–D5) and the individual grants they issued.
-- =====================================================================================================
CREATE TABLE access_policies (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code             TEXT    NOT NULL CHECK (length(code) BETWEEN 3 AND 64 AND code NOT GLOB '*[^a-z0-9.-]*'),
  state            TEXT    NOT NULL CHECK (state IN ('ACTIVE', 'REVOKED')),
  approved_by_ref  TEXT    NOT NULL CHECK (approved_by_ref GLOB 'founder:*' AND length(approved_by_ref) BETWEEN 9 AND 161),
  approved_at      TEXT    NOT NULL CHECK (approved_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  revoked_by_ref   TEXT             CHECK (revoked_by_ref IS NULL OR (revoked_by_ref GLOB 'founder:*' AND length(revoked_by_ref) BETWEEN 9 AND 161)),
  revoked_at       TEXT             CHECK (revoked_at IS NULL OR revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'REVOKED') = (revoked_at IS NOT NULL AND revoked_by_ref IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX access_policies_one_active ON access_policies (code) WHERE state = 'ACTIVE';
CREATE TRIGGER access_policies_no_delete BEFORE DELETE ON access_policies BEGIN SELECT RAISE(ABORT, 'access policies are durable history'); END;
CREATE TRIGGER access_policies_revoke_once BEFORE UPDATE ON access_policies
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.approved_by_ref IS NOT OLD.approved_by_ref OR NEW.approved_at IS NOT OLD.approved_at OR OLD.state <> 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'an access policy is only revoked, once'); END;

CREATE TABLE policy_grant_links (
  grant_id      TEXT    NOT NULL PRIMARY KEY REFERENCES permission_grants (id) ON DELETE RESTRICT,
  policy_id     TEXT    NOT NULL REFERENCES access_policies (id) ON DELETE RESTRICT,
  employee_id   TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  position_id   TEXT    NOT NULL REFERENCES org_positions (id) ON DELETE RESTRICT,
  capability    TEXT    NOT NULL CHECK (length(capability) BETWEEN 1 AND 128),
  -- 1: an existing individual grant the policy adopted as it was (never revoked and re-issued).
  adopted       INTEGER NOT NULL CHECK (adopted IN (0, 1)),
  linked_at     TEXT    NOT NULL CHECK (linked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE INDEX policy_grant_links_employee ON policy_grant_links (employee_id, policy_id);
CREATE TRIGGER policy_grant_links_append_only_u BEFORE UPDATE ON policy_grant_links BEGIN SELECT RAISE(ABORT, 'policy grant links are append-only'); END;
CREATE TRIGGER policy_grant_links_append_only_d BEFORE DELETE ON policy_grant_links BEGIN SELECT RAISE(ABORT, 'policy grant links are append-only'); END;
-- A policy issues only an individual grant of the Employee it names, decided by the Founder's act.
CREATE TRIGGER policy_grant_links_same_employee BEFORE INSERT ON policy_grant_links
WHEN NOT EXISTS (SELECT 1 FROM permission_grants g WHERE g.id = NEW.grant_id AND g.employee_id = NEW.employee_id AND g.capability = NEW.capability AND g.granted_by_ref GLOB 'founder:*')
BEGIN SELECT RAISE(ABORT, 'a policy grant is an individual Founder grant of the same Employee and capability'); END;

-- =====================================================================================================
-- The Tools a role needs (metadata; readiness is derived from the Registry, the host's drivers and the vault).
-- =====================================================================================================
CREATE TABLE role_tool_requirements (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  role_ref         TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*'),
  tool_code        TEXT    NOT NULL CHECK (length(tool_code) BETWEEN 1 AND 64 AND tool_code NOT GLOB '*[^a-z0-9.-]*'),
  purpose          TEXT    NOT NULL CHECK (length(purpose) BETWEEN 1 AND 400),
  state            TEXT    NOT NULL CHECK (state IN ('ACTIVE', 'REMOVED')),
  created_by_ref   TEXT    NOT NULL CHECK (created_by_ref GLOB 'founder:*'),
  created_at       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  removed_by_ref   TEXT             CHECK (removed_by_ref IS NULL OR removed_by_ref GLOB 'founder:*'),
  removed_at       TEXT             CHECK (removed_at IS NULL OR removed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'REMOVED') = (removed_at IS NOT NULL AND removed_by_ref IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX role_tool_requirements_live ON role_tool_requirements (role_ref, tool_code) WHERE state = 'ACTIVE';
CREATE TRIGGER role_tool_requirements_no_delete BEFORE DELETE ON role_tool_requirements BEGIN SELECT RAISE(ABORT, 'role tool requirements are durable history'); END;
CREATE TRIGGER role_tool_requirements_remove_once BEFORE UPDATE ON role_tool_requirements
WHEN NEW.id IS NOT OLD.id OR NEW.role_ref IS NOT OLD.role_ref OR NEW.tool_code IS NOT OLD.tool_code OR NEW.purpose IS NOT OLD.purpose OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR OLD.state <> 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'a role tool requirement is only removed, once'); END;

-- =====================================================================================================
-- A leader's proposal (evidence and a request — never a decision, a hire, a grant or a spend).
-- =====================================================================================================
CREATE TABLE talent_proposals (
  id                       TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  kind                     TEXT    NOT NULL CHECK (kind IN ('IDENTITY_PROFILE', 'ACADEMY_PROGRAM', 'SKILL', 'RETRAIN', 'DEPARTMENT_BUDGET')),
  proposer_employee_id     TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  proposer_position_id     TEXT    NOT NULL REFERENCES org_positions (id) ON DELETE RESTRICT,
  run_id                   TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  subject_employee_id      TEXT             REFERENCES employees (id) ON DELETE RESTRICT,
  department_id            TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  role_ref                 TEXT             CHECK (role_ref IS NULL OR (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*')),
  rationale                TEXT    NOT NULL CHECK (length(rationale) BETWEEN 1 AND 2000),
  payload_json             TEXT    NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json) = 'object' AND length(payload_json) <= 400000),
  definition_id            TEXT             REFERENCES talent_definitions (id) ON DELETE RESTRICT,
  state                    TEXT    NOT NULL CHECK (state IN ('PROPOSED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN')),
  decided_by_ref           TEXT             CHECK (decided_by_ref IS NULL OR (decided_by_ref GLOB 'founder:*' AND length(decided_by_ref) BETWEEN 9 AND 161)),
  decided_at               TEXT             CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  result_ref               TEXT             CHECK (result_ref IS NULL OR length(result_ref) BETWEEN 3 AND 161),
  version                  INTEGER NOT NULL CHECK (version >= 1),
  created_at               TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at               TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state IN ('ACCEPTED', 'DECLINED')) = (decided_by_ref IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (subject_employee_id IS NULL OR subject_employee_id <> proposer_employee_id)
) STRICT;
CREATE INDEX talent_proposals_state ON talent_proposals (state, created_at);
CREATE TRIGGER talent_proposals_no_delete BEFORE DELETE ON talent_proposals BEGIN SELECT RAISE(ABORT, 'talent proposals are durable history'); END;
CREATE TRIGGER talent_proposals_evidence_immutable BEFORE UPDATE ON talent_proposals
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.proposer_employee_id IS NOT OLD.proposer_employee_id OR NEW.proposer_position_id IS NOT OLD.proposer_position_id
  OR NEW.run_id IS NOT OLD.run_id OR NEW.subject_employee_id IS NOT OLD.subject_employee_id OR NEW.department_id IS NOT OLD.department_id OR NEW.role_ref IS NOT OLD.role_ref
  OR NEW.rationale IS NOT OLD.rationale OR NEW.payload_json IS NOT OLD.payload_json OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR OLD.state <> 'PROPOSED'
BEGIN SELECT RAISE(ABORT, 'a talent proposal''s evidence is immutable; a decided proposal is history'); END;

-- =====================================================================================================
-- D5: scalable Academy evaluation. The dimension results table is recreated with every row kept: an employee:*
-- evaluator is admitted only as kind MANAGER, bound to an APPLIED manager evaluation, and never the trainee.
-- =====================================================================================================
CREATE TABLE academy_manager_evaluations (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  attempt_id             TEXT    NOT NULL REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  enrollment_id          TEXT    NOT NULL REFERENCES academy_enrollments (id) ON DELETE RESTRICT,
  evaluator_employee_id  TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  trainee_employee_id    TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  work_item_id           TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  answer_id              TEXT    NOT NULL CHECK (length(answer_id) = 36),
  answer_sha256          TEXT    NOT NULL CHECK (length(answer_sha256) = 64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- 1: an assessment / holdout (it counts toward certification) — applied only after an independent review.
  review_required        INTEGER NOT NULL CHECK (review_required IN (0, 1)),
  scores_json            TEXT             CHECK (scores_json IS NULL OR (json_valid(scores_json) AND json_type(scores_json) = 'object' AND length(scores_json) <= 4096)),
  state                  TEXT    NOT NULL CHECK (state IN ('ASSIGNED', 'PROPOSED', 'APPLIED', 'REJECTED', 'CANCELLED')),
  assigned_by_ref        TEXT    NOT NULL CHECK (assigned_by_ref GLOB 'founder:*' AND length(assigned_by_ref) BETWEEN 9 AND 161),
  proposed_at            TEXT             CHECK (proposed_at IS NULL OR proposed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  reviewed_by_ref        TEXT             CHECK (reviewed_by_ref IS NULL OR (length(reviewed_by_ref) BETWEEN 9 AND 161 AND (reviewed_by_ref GLOB 'founder:*' OR reviewed_by_ref GLOB 'employee:*'))),
  reviewed_at            TEXT             CHECK (reviewed_at IS NULL OR reviewed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at             TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  -- Never the trainee; an independent reviewer is neither the evaluator nor the trainee.
  CHECK (evaluator_employee_id <> trainee_employee_id),
  CHECK (reviewed_by_ref IS NULL OR (reviewed_by_ref <> 'employee:' || evaluator_employee_id AND reviewed_by_ref <> 'employee:' || trainee_employee_id)),
  CHECK (state NOT IN ('PROPOSED', 'APPLIED') OR (scores_json IS NOT NULL AND proposed_at IS NOT NULL)),
  CHECK (state <> 'APPLIED' OR review_required = 0 OR (reviewed_by_ref IS NOT NULL AND reviewed_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX academy_manager_evaluations_open ON academy_manager_evaluations (attempt_id) WHERE state IN ('ASSIGNED', 'PROPOSED', 'APPLIED');
CREATE TRIGGER academy_manager_evaluations_no_delete BEFORE DELETE ON academy_manager_evaluations BEGIN SELECT RAISE(ABORT, 'manager evaluations are durable history'); END;
CREATE TRIGGER academy_manager_evaluations_forward BEFORE UPDATE ON academy_manager_evaluations
WHEN NEW.id IS NOT OLD.id OR NEW.attempt_id IS NOT OLD.attempt_id OR NEW.enrollment_id IS NOT OLD.enrollment_id OR NEW.evaluator_employee_id IS NOT OLD.evaluator_employee_id
  OR NEW.trainee_employee_id IS NOT OLD.trainee_employee_id OR NEW.answer_id IS NOT OLD.answer_id OR NEW.answer_sha256 IS NOT OLD.answer_sha256
  OR NEW.review_required IS NOT OLD.review_required OR NEW.assigned_by_ref IS NOT OLD.assigned_by_ref OR NEW.created_at IS NOT OLD.created_at
  OR (OLD.work_item_id IS NOT NULL AND NEW.work_item_id IS NOT OLD.work_item_id)
  OR (OLD.scores_json IS NOT NULL AND NEW.scores_json IS NOT OLD.scores_json)
  OR (OLD.state = 'ASSIGNED' AND NEW.state NOT IN ('ASSIGNED', 'PROPOSED', 'APPLIED', 'CANCELLED'))
  OR (OLD.state = 'PROPOSED' AND NEW.state NOT IN ('APPLIED', 'REJECTED', 'CANCELLED'))
  OR (OLD.state IN ('APPLIED', 'REJECTED', 'CANCELLED'))
BEGIN SELECT RAISE(ABORT, 'a manager evaluation only moves forward and its scores are recorded once'); END;

CREATE TEMP TABLE c4_copy_academy_dimension_results AS SELECT * FROM main.academy_dimension_results;
DROP TABLE main.academy_dimension_results;
CREATE TABLE academy_dimension_results (
  attempt_id          TEXT    NOT NULL REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  dimension           TEXT    NOT NULL CHECK (dimension IN ('REASONING_QUALITY', 'CORRECTNESS', 'EVIDENCE_USE', 'QANDEEL_UNDERSTANDING', 'ROLE_MASTERY', 'AUTHORITY_COMPLIANCE', 'COST_DISCIPLINE', 'COLLABORATION', 'FOUNDER_COMMUNICATION', 'LEARNING_FROM_FEEDBACK')),
  score_pct           INTEGER NOT NULL CHECK (score_pct BETWEEN 0 AND 100),
  evaluator_kind      TEXT    NOT NULL CHECK (evaluator_kind IN ('DETERMINISTIC_RUBRIC', 'EVALUATOR', 'MANAGER')),
  evaluator_ref       TEXT    NOT NULL CHECK (length(evaluator_ref) BETWEEN 3 AND 161 AND ((evaluator_kind = 'MANAGER') = (evaluator_ref GLOB 'employee:*'))),
  evidence_refs_json  TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 2048),
  recorded_at         TEXT    NOT NULL CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  -- The deterministic dimensions are never typed by an evaluator, a manager or the Founder.
  CHECK (evaluator_kind = 'DETERMINISTIC_RUBRIC' OR dimension NOT IN ('AUTHORITY_COMPLIANCE', 'COST_DISCIPLINE')),
  PRIMARY KEY (attempt_id, dimension)
) STRICT, WITHOUT ROWID;
INSERT INTO academy_dimension_results (attempt_id, dimension, score_pct, evaluator_kind, evaluator_ref, evidence_refs_json, recorded_at)
  SELECT attempt_id, dimension, score_pct, evaluator_kind, evaluator_ref, evidence_refs_json, recorded_at FROM temp.c4_copy_academy_dimension_results;
DROP TABLE temp.c4_copy_academy_dimension_results;
CREATE TRIGGER academy_dimension_results_append_only_u BEFORE UPDATE ON academy_dimension_results BEGIN SELECT RAISE(ABORT, 'academy dimension results is append-only'); END;
CREATE TRIGGER academy_dimension_results_append_only_d BEFORE DELETE ON academy_dimension_results BEGIN SELECT RAISE(ABORT, 'academy dimension results is append-only'); END;
CREATE TRIGGER academy_dimension_results_manager_bound BEFORE INSERT ON academy_dimension_results
WHEN NEW.evaluator_kind = 'MANAGER' AND NOT EXISTS (
  SELECT 1 FROM academy_manager_evaluations m JOIN academy_enrollments en ON en.id = m.enrollment_id JOIN academy_attempts a ON a.id = m.attempt_id
  WHERE m.attempt_id = NEW.attempt_id AND m.state = 'APPLIED' AND NEW.evaluator_ref = 'employee:' || m.evaluator_employee_id
    AND a.enrollment_id = en.id AND en.employee_id = m.trainee_employee_id AND m.evaluator_employee_id <> en.employee_id)
BEGIN SELECT RAISE(ABORT, 'a manager scores only an attempt it was assigned, after its evaluation was applied, and never its own'); END;

CREATE TABLE academy_competency_results (
  attempt_id          TEXT    NOT NULL REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  competency_code     TEXT    NOT NULL CHECK (length(competency_code) BETWEEN 3 AND 48 AND competency_code NOT GLOB '*[^A-Z0-9_]*'),
  score_pct           INTEGER NOT NULL CHECK (score_pct BETWEEN 0 AND 100),
  evaluator_kind      TEXT    NOT NULL CHECK (evaluator_kind IN ('EVALUATOR', 'MANAGER')),
  evaluator_ref       TEXT    NOT NULL CHECK (length(evaluator_ref) BETWEEN 3 AND 161 AND ((evaluator_kind = 'MANAGER') = (evaluator_ref GLOB 'employee:*'))),
  evidence_refs_json  TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND length(evidence_refs_json) <= 2048),
  recorded_at         TEXT    NOT NULL CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (attempt_id, competency_code)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER academy_competency_results_append_only_u BEFORE UPDATE ON academy_competency_results BEGIN SELECT RAISE(ABORT, 'academy competency results is append-only'); END;
CREATE TRIGGER academy_competency_results_append_only_d BEFORE DELETE ON academy_competency_results BEGIN SELECT RAISE(ABORT, 'academy competency results is append-only'); END;
CREATE TRIGGER academy_competency_results_manager_bound BEFORE INSERT ON academy_competency_results
WHEN NEW.evaluator_kind = 'MANAGER' AND NOT EXISTS (
  SELECT 1 FROM academy_manager_evaluations m WHERE m.attempt_id = NEW.attempt_id AND m.state = 'APPLIED' AND NEW.evaluator_ref = 'employee:' || m.evaluator_employee_id)
BEGIN SELECT RAISE(ABORT, 'a manager scores only an attempt it was assigned, after its evaluation was applied'); END;

-- A scenario that assesses operating a Tool names it (null = a text scenario; every earlier scenario is a text scenario).
ALTER TABLE academy_scenarios ADD COLUMN tool_code TEXT CHECK (tool_code IS NULL OR (length(tool_code) BETWEEN 1 AND 64 AND tool_code NOT GLOB '*[^a-z0-9.-]*'));
CREATE TRIGGER academy_scenarios_tool_immutable BEFORE UPDATE OF tool_code ON academy_scenarios
WHEN NEW.tool_code IS NOT OLD.tool_code
BEGIN SELECT RAISE(ABORT, 'a scenario''s tool is part of its versioned content'); END;

-- For every Tool the role needs, whether the certification ASSESSED operating it (a Skill certificate never claims an
-- unassessed Tool capability).
CREATE TABLE certification_tool_scopes (
  certification_id   TEXT    NOT NULL REFERENCES certifications (id) ON DELETE RESTRICT,
  tool_code          TEXT    NOT NULL CHECK (length(tool_code) BETWEEN 1 AND 64),
  status             TEXT    NOT NULL CHECK (status IN ('ASSESSED', 'NOT_ASSESSED')),
  readiness          TEXT    NOT NULL CHECK (readiness IN ('NOT_REGISTERED', 'NOT_INTEGRATED', 'AWAITING_CONNECTION', 'ON_HOLD', 'READY', 'UNKNOWN')),
  evidence_ref       TEXT             CHECK (evidence_ref IS NULL OR length(evidence_ref) BETWEEN 3 AND 161),
  recorded_at        TEXT    NOT NULL CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((status = 'ASSESSED') = (evidence_ref IS NOT NULL)),
  PRIMARY KEY (certification_id, tool_code)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER certification_tool_scopes_append_only_u BEFORE UPDATE ON certification_tool_scopes BEGIN SELECT RAISE(ABORT, 'certification tool scopes are append-only'); END;
CREATE TRIGGER certification_tool_scopes_append_only_d BEFORE DELETE ON certification_tool_scopes BEGIN SELECT RAISE(ABORT, 'certification tool scopes are append-only'); END;
