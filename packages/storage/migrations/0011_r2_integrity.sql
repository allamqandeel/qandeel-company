-- QANDEEL COMPANY operational schema — migration 0011: R2 integrity corrections (Full Strong-v1 Independent
-- Review). Datastore guards for defects the R2 findings register froze (docs/R2_FULL_STRONG_V1_INDEPENDENT_REVIEW_REPORT.md);
-- the application-level corrections live with their owning stages. No new Product behaviour.
-- IMMUTABLE once released (see 0001). Migrations 0001–0010 are unchanged; objects they created are replaced
-- here only by DROP + CREATE of a trigger or a table rebuild that keeps every row.

-- -----------------------------------------------------------------------------------------------------
-- R2-01: the executor never re-designs its own review (Stage 11 §1 / §3; D-C4-05; D-C6-10). Version 1 is
-- declared before the first run (0008 `review_plans_before_execution`); a later version is declared by the
-- Founder or by the delegator of delegated work — never by the Work Item's own owner.
-- -----------------------------------------------------------------------------------------------------
CREATE TRIGGER review_plans_executor_never_redesigns BEFORE INSERT ON review_plans
WHEN NEW.version > 1 AND NEW.declared_by_ref NOT GLOB 'founder:*'
  AND NEW.declared_by_ref = (SELECT w.owner_ref FROM work_items w WHERE w.id = NEW.work_item_id)
BEGIN SELECT RAISE(ABORT, 'the executor never re-designs its own review; a plan version is superseded by the Founder or the delegator'); END;

-- -----------------------------------------------------------------------------------------------------
-- R2-05: Completed ≠ Reviewed at the delegation seam (Stage 8 §31; D-C1-21). A review-required child closes
-- its delegation (and wakes the delegator) only once REVIEWED or later; finishing execution
-- (COMPLETED / WAITING_REVIEW) or going back to rework leaves the handoff open. Unchanged otherwise.
-- -----------------------------------------------------------------------------------------------------
DROP TRIGGER work_delegations_follow_child;
CREATE TRIGGER work_delegations_follow_child AFTER UPDATE OF state ON work_items
WHEN NEW.state IS NOT OLD.state
  AND (NEW.state IN ('CANCELLED', 'SUPERSEDED', 'FAILED', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED')
       OR (NEW.state = 'COMPLETED' AND NEW.review_required = 0))
  AND EXISTS (SELECT 1 FROM work_delegations d WHERE d.child_work_item_id = NEW.id AND d.state IN ('OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED'))
BEGIN
  INSERT INTO work_delegation_history (delegation_id, version, from_state, to_state, reason_code, actor_ref, occurred_at)
    SELECT d.id, d.version + 1, d.state,
           CASE WHEN NEW.state IN ('CANCELLED', 'SUPERSEDED', 'FAILED') THEN NEW.state ELSE 'COMPLETED' END,
           'CHILD_' || NEW.state, 'system:runtime', NEW.updated_at
      FROM work_delegations d WHERE d.child_work_item_id = NEW.id;
  UPDATE work_delegations
     SET state = CASE WHEN NEW.state IN ('CANCELLED', 'SUPERSEDED', 'FAILED') THEN NEW.state ELSE 'COMPLETED' END,
         response_reason_code = COALESCE(response_reason_code, 'CHILD_' || NEW.state), version = version + 1, updated_at = NEW.updated_at
   WHERE child_work_item_id = NEW.id;
  -- Targeted wake of the delegator's parked job (the queue_jobs trigger advances the durable wake generation).
  UPDATE queue_jobs SET state = 'QUEUED', available_at = NEW.updated_at, wait_reason = NULL, updated_at = NEW.updated_at
   WHERE state = 'WAITING' AND wait_reason = 'AWAITING_DELEGATION'
     AND work_item_id IN (SELECT parent_work_item_id FROM work_delegations WHERE child_work_item_id = NEW.id);
END;

-- -----------------------------------------------------------------------------------------------------
-- R2-11: the ACTION review subject is durable and single-sourced. Written once when the ACTION request is
-- created (the full, untruncated action and arguments the review fingerprint binds); every reviewer fill,
-- refill and reassignment reads it. Local governed business evidence, like reviewer instructions — never
-- audit, events or logs (Rule A).
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE review_action_subjects (
  request_id      TEXT    NOT NULL PRIMARY KEY REFERENCES review_requests (id) ON DELETE RESTRICT,
  subject_text    TEXT    NOT NULL CHECK (length(subject_text) BETWEEN 1 AND 16000),
  subject_sha256  TEXT    NOT NULL CHECK (length(subject_sha256) = 64 AND subject_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER review_action_subjects_append_only_u BEFORE UPDATE ON review_action_subjects BEGIN SELECT RAISE(ABORT, 'an action review subject is written once'); END;
CREATE TRIGGER review_action_subjects_append_only_d BEFORE DELETE ON review_action_subjects BEGIN SELECT RAISE(ABORT, 'an action review subject is written once'); END;
CREATE TRIGGER review_action_subjects_action_only BEFORE INSERT ON review_action_subjects
WHEN NOT EXISTS (SELECT 1 FROM review_requests r WHERE r.id = NEW.request_id AND r.subject_kind = 'ACTION')
BEGIN SELECT RAISE(ABORT, 'an action review subject belongs to an ACTION review request'); END;

-- -----------------------------------------------------------------------------------------------------
-- R2-16: a successful pattern is shared only after two verified reuses on DISTINCT evidence (D-C6-04). The
-- same follow-up evidence never counts twice, and an Employee has one open reuse of a lesson at a time.
-- -----------------------------------------------------------------------------------------------------
DROP TRIGGER lesson_promotions_c6_pattern_gate;
CREATE TRIGGER lesson_promotions_c6_pattern_gate BEFORE UPDATE ON lesson_promotions
WHEN NEW.state = 'APPROVED' AND OLD.state = 'PENDING_REVIEW' AND NEW.target <> 'PERSONAL'
  AND EXISTS (SELECT 1 FROM lessons l JOIN learning_signals s ON s.observation_id = l.observation_id WHERE l.id = NEW.lesson_id AND s.kind = 'SUCCESSFUL_PATTERN')
  AND NOT EXISTS (
    SELECT 1 FROM learning_interventions a JOIN learning_interventions b ON b.lesson_id = a.lesson_id AND b.id > a.id
     WHERE a.lesson_id = NEW.lesson_id AND a.kind = 'PATTERN_REUSE' AND b.kind = 'PATTERN_REUSE'
       AND a.effect = 'IMPROVEMENT_OBSERVED' AND b.effect = 'IMPROVEMENT_OBSERVED'
       AND json_array_length(a.evidence_refs_json) > 0 AND json_array_length(b.evidence_refs_json) > 0
       AND NOT EXISTS (SELECT 1 FROM json_each(a.evidence_refs_json) x JOIN json_each(b.evidence_refs_json) y ON x.value = y.value))
BEGIN SELECT RAISE(ABORT, 'a successful pattern is shared only after two verified reuses on distinct evidence'); END;
CREATE TRIGGER learning_interventions_pattern_reuse_bound BEFORE INSERT ON learning_interventions
WHEN NEW.kind = 'PATTERN_REUSE' AND EXISTS (
  SELECT 1 FROM learning_interventions i WHERE i.lesson_id = NEW.lesson_id AND i.employee_id = NEW.employee_id
     AND i.kind = 'PATTERN_REUSE' AND i.state IN ('PLANNED', 'TRAINING_COMPLETED'))
BEGIN SELECT RAISE(ABORT, 'one open pattern reuse per lesson and employee: await its effect'); END;

-- -----------------------------------------------------------------------------------------------------
-- R2-21: the Founder's exception decisions become governed previews (D-C5-07: text never mutates; an explicit,
-- fingerprinted, session-bound confirmation reaches the real boundary). The intent CHECK of 0009 is widened by
-- the row-preserving rebuild of D-C4-01 (copied whole to TEMP, re-created, every row copied back; DROP
-- TABLE's implicit delete fires no trigger; parent references deferred to COMMIT). Index and triggers kept.
-- -----------------------------------------------------------------------------------------------------
PRAGMA defer_foreign_keys = ON;
CREATE TEMP TABLE c4_copy_founder_action_previews AS SELECT * FROM main.founder_action_previews;
DROP TABLE main.founder_action_previews;
CREATE TABLE founder_action_previews (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  session_id     TEXT    NOT NULL REFERENCES founder_sessions (id) ON DELETE RESTRICT,
  intent_kind    TEXT    NOT NULL CHECK (intent_kind IN ('APPROVAL_DECIDE', 'GOAL_APPROVE', 'GOAL_STATE', 'GOAL_PROPOSE', 'STAFFING_DECIDE', 'CONFLICT_RESOLVE', 'BUDGET_CEILING', 'DELEGATE_WORK',
                                                         'TOOL_RECONCILE', 'RESERVATION_RECONCILE', 'JOB_RECONCILE', 'REVIEW_ESCALATION_RESOLVE', 'SYSTEMIC_DECIDE', 'ATTRIBUTION_DECIDE', 'LESSON_DECIDE', 'OUTCOME_VERIFY', 'PROMOTION_DECIDE')),
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
