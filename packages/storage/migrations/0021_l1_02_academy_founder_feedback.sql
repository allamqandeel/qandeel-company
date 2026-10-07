-- QANDEEL COMPANY operational schema — migration 0021: L1-02 Academy Founder Feedback Loop (D-L1-39).
-- IMMUTABLE once released (see 0001). Migrations 0001–0020 are unchanged.
--
-- The Academy stores the evaluator's dimension scores bound to the candidate's actual answer, and codes-only remediation
-- for a failed attempt. It stores no Founder TEXT for an attempt — in particular for a passed attempt, which opens no
-- remediation — so a Founder training note never reached a later attempt and LEARNING_FROM_FEEDBACK could not be evidenced
-- from Founder feedback. No existing table can hold it: every Academy table is codes / numbers only, `work_answers` is the
-- candidate's own answer (one per Work Item), and the C4 review rationale belongs to a REQUIRED review of one Work Item.
--
--   academy_founder_feedback  the Founder's own textual feedback on ONE evaluated, non-holdout attempt, bound to that
--                             attempt's exact recorded answer (its id and SHA-256). Append-only: a later note is a new
--                             row; nothing rewrites an attempt, an answer or a score. Governed D1 training content: the body
--                             is never copied into audit, events or logs (Rule A); integrity is re-checked by its SHA-256
--                             whenever it is loaded. It reaches the trainee's LATER Academy attempts' context (the context
--                             manifest records its exposure by id — the evidence that later supports, or refutes, a claim
--                             of learning from Founder feedback). It grants nothing and scores nothing.
--   founder_action_previews   the governed confirmation gains the structured intent ACADEMY_FOUNDER_FEEDBACK. The intent
--                             catalogue is a datastore CHECK (0009 / 0011 / 0012 / 0014 / 0016 / 0017 / 0020 precedent):
--                             the table is recreated with the extended list, every row kept.

CREATE TABLE academy_founder_feedback (
  id              TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  attempt_id      TEXT NOT NULL REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  employee_id     TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  work_answer_id  TEXT NOT NULL REFERENCES work_answers (id) ON DELETE RESTRICT,
  answer_sha256   TEXT NOT NULL CHECK (length(answer_sha256) = 64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*'),
  body            TEXT NOT NULL CHECK (length(trim(body)) >= 1 AND length(CAST(body AS BLOB)) <= 2400),
  body_sha256     TEXT NOT NULL CHECK (length(body_sha256) = 64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'),
  data_class      TEXT NOT NULL CHECK (data_class = 'D1'),
  set_by_ref      TEXT NOT NULL CHECK (set_by_ref GLOB 'founder:*' AND length(set_by_ref) BETWEEN 9 AND 161),
  reason_code     TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  created_at      TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX academy_founder_feedback_employee ON academy_founder_feedback (employee_id, created_at);
CREATE INDEX academy_founder_feedback_attempt ON academy_founder_feedback (attempt_id);
CREATE TRIGGER academy_founder_feedback_append_only_u BEFORE UPDATE ON academy_founder_feedback BEGIN SELECT RAISE(ABORT, 'Founder feedback is append-only'); END;
CREATE TRIGGER academy_founder_feedback_append_only_d BEFORE DELETE ON academy_founder_feedback BEGIN SELECT RAISE(ABORT, 'Founder feedback is append-only'); END;
-- Bound to an EVALUATED, non-holdout attempt of this Employee and to that attempt's own recorded answer (a holdout stays
-- hidden: feedback on it would carry the holdout into later contexts).
CREATE TRIGGER academy_founder_feedback_bound BEFORE INSERT ON academy_founder_feedback
WHEN NOT EXISTS (
  SELECT 1 FROM academy_attempts a JOIN academy_enrollments e ON e.id = a.enrollment_id JOIN work_answers w ON w.work_item_id = a.work_item_id
   WHERE a.id = NEW.attempt_id AND a.state = 'EVALUATED' AND a.holdout = 0 AND e.employee_id = NEW.employee_id
     AND w.id = NEW.work_answer_id AND w.body_sha256 = NEW.answer_sha256)
BEGIN SELECT RAISE(ABORT, 'Founder feedback is bound to an evaluated non-holdout attempt and its recorded answer'); END;

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
                                                         'ACADEMY_FOUNDER_FEEDBACK')),
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
