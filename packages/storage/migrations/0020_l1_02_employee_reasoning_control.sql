-- QANDEEL COMPANY operational schema — migration 0020: L1-02 Employee Reasoning Control (D-L1-36 / D-L1-44).
-- IMMUTABLE once released (see 0001). Migrations 0001–0019 are unchanged.
--
-- The persistent reasoning default and ceiling need no schema: they are the Employee's existing cognitive profile
-- (`employees.cognitive_profile_json`, 0004 / 0007), changed in place under the employee version and recorded in
-- `employee_history` (change kind PROFILE, 0004). Two things cannot be represented by existing storage:
--
--   work_item_reasoning_overrides  the Founder's one-task reasoning class for exactly one Employee Work Item, chosen
--                                  before that Work Item ever ran. It is NOT written into `work_items.processor_input_json`:
--                                  a Work Item's processor input is its immutable, submitter-set content (an approval
--                                  binds its SHA-256, an independent review binds it too, and a pinned class there means
--                                  a benchmark method pin, not a Founder choice). One row per Work Item; never updated,
--                                  never deleted. It grants nothing: authority, tools, data class, budget and the
--                                  Employee's ceiling are unchanged, and the runtime still routes and reserves under them.
--   founder_action_previews        the governed confirmation gains the two structured-only reasoning intents
--                                  (EMPLOYEE_REASONING_PROFILE, WORK_ITEM_REASONING_OVERRIDE). The intent catalogue is a
--                                  datastore CHECK (0009 / 0011 / 0012 / 0014 / 0016 / 0017 precedent): the table is
--                                  recreated with the extended list, every row kept.

CREATE TABLE work_item_reasoning_overrides (
  work_item_id      TEXT NOT NULL PRIMARY KEY REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id       TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  reasoning_class   TEXT NOT NULL CHECK (reasoning_class IN ('E1', 'E2', 'E3', 'E4')),
  -- The Employee's standing profile when the Founder chose the class (evidence of what was overridden; never re-read).
  standing_default  TEXT NOT NULL CHECK (standing_default IN ('E0', 'E1', 'E2', 'E3', 'E4')),
  standing_ceiling  TEXT NOT NULL CHECK (standing_ceiling IN ('E0', 'E1', 'E2', 'E3', 'E4')),
  set_by_ref        TEXT NOT NULL CHECK (set_by_ref GLOB 'founder:*'),
  reason_code       TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  created_at        TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE INDEX work_item_reasoning_overrides_employee ON work_item_reasoning_overrides (employee_id);
CREATE TRIGGER work_item_reasoning_overrides_append_only_u BEFORE UPDATE ON work_item_reasoning_overrides BEGIN SELECT RAISE(ABORT, 'a reasoning override is set once and never rewritten'); END;
CREATE TRIGGER work_item_reasoning_overrides_append_only_d BEFORE DELETE ON work_item_reasoning_overrides BEGIN SELECT RAISE(ABORT, 'a reasoning override is set once and never rewritten'); END;
-- Set only before the Work Item ever ran (it is visible before execution), only on a Work Item the Employee owns, and
-- never above the Employee's ceiling at that moment.
CREATE TRIGGER work_item_reasoning_overrides_before_execution BEFORE INSERT ON work_item_reasoning_overrides
WHEN EXISTS (SELECT 1 FROM runs WHERE work_item_id = NEW.work_item_id)
  OR NOT EXISTS (SELECT 1 FROM work_items WHERE id = NEW.work_item_id AND owner_ref = 'employee:' || NEW.employee_id)
  OR substr(NEW.reasoning_class, 2) > substr(NEW.standing_ceiling, 2)
BEGIN SELECT RAISE(ABORT, 'a reasoning override is set before execution, on the owner, within the ceiling'); END;

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
                                                         'EMPLOYEE_REASONING_PROFILE', 'WORK_ITEM_REASONING_OVERRIDE')),
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
