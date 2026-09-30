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

-- -----------------------------------------------------------------------------------------------------
-- RR2-1 (R2-03 family): a budget wait resumes on what its refusal NEEDED, never on any headroom anywhere
-- (Stage 3 §6). The refusing reservation transaction records the need — the refused level and dimension, the
-- level whose headroom the wait depends on (the refusing level; for a Run-level refusal its Work Item level, the
-- next run's Run budget is fresh) and the refused amounts. Append-only and content-free (IDs, codes, amounts).
-- A job's latest row is its current need (a later refusal at another level re-binds it); it is read by job.
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE budget_wait_needs (
  seq                INTEGER NOT NULL PRIMARY KEY,
  job_id             TEXT    NOT NULL REFERENCES queue_jobs (id) ON DELETE RESTRICT,
  run_id             TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  work_item_id       TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  refused_budget_id  TEXT    NOT NULL REFERENCES budgets (id) ON DELETE RESTRICT,
  refused_scope      TEXT    NOT NULL CHECK (refused_scope IN ('COMPANY', 'DEPARTMENT', 'EMPLOYEE', 'WORK_ITEM', 'RUN')),
  dimension          TEXT    NOT NULL CHECK (dimension IN ('MONEY', 'TOKENS')),
  wait_budget_id     TEXT    NOT NULL REFERENCES budgets (id) ON DELETE RESTRICT,
  need_money         INTEGER NOT NULL CHECK (need_money BETWEEN 0 AND 1000000000000000),
  need_tokens        INTEGER NOT NULL CHECK (need_tokens BETWEEN 0 AND 1000000000000),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((refused_scope = 'RUN') = (wait_budget_id <> refused_budget_id))
) STRICT;
CREATE INDEX budget_wait_needs_job ON budget_wait_needs (job_id, seq);
CREATE TRIGGER budget_wait_needs_append_only_u BEFORE UPDATE ON budget_wait_needs BEGIN SELECT RAISE(ABORT, 'a budget wait need is append-only'); END;
CREATE TRIGGER budget_wait_needs_append_only_d BEFORE DELETE ON budget_wait_needs BEGIN SELECT RAISE(ABORT, 'a budget wait need is append-only'); END;
CREATE TRIGGER budget_wait_needs_levels BEFORE INSERT ON budget_wait_needs
WHEN NOT EXISTS (SELECT 1 FROM budgets b WHERE b.id = NEW.refused_budget_id AND b.scope = NEW.refused_scope
                   AND (NEW.refused_scope <> 'RUN' OR b.parent_id = NEW.wait_budget_id))
BEGIN SELECT RAISE(ABORT, 'a budget wait binds the refusing level, or the Work Item level of a refused Run budget'); END;

-- -----------------------------------------------------------------------------------------------------
-- RR2-2 / RR2-5 (R2-04 / R2-05 family): a handoff never outlives its delegator (Stage 8 §23: accountability stays
-- with the delegator). When the delegating Work Item ends without finishing (FAILED, CANCELLED, SUPERSEDED), every
-- handoff it still holds open closes CANCELLED (PARENT_ENDED, history row) in the same transaction, whatever path
-- ended it. Its non-terminal children are cancelled by the application's canonical propagation path.
-- -----------------------------------------------------------------------------------------------------
CREATE TRIGGER work_delegations_follow_parent AFTER UPDATE OF state ON work_items
WHEN NEW.state IS NOT OLD.state AND NEW.state IN ('FAILED', 'CANCELLED', 'SUPERSEDED')
  AND EXISTS (SELECT 1 FROM work_delegations d WHERE d.parent_work_item_id = NEW.id AND d.state IN ('OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED'))
BEGIN
  INSERT INTO work_delegation_history (delegation_id, version, from_state, to_state, reason_code, actor_ref, occurred_at)
    SELECT d.id, d.version + 1, d.state, 'CANCELLED', 'PARENT_ENDED', 'system:runtime', NEW.updated_at
      FROM work_delegations d WHERE d.parent_work_item_id = NEW.id AND d.state IN ('OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED');
  UPDATE work_delegations SET state = 'CANCELLED', response_reason_code = 'PARENT_ENDED', version = version + 1, updated_at = NEW.updated_at
   WHERE parent_work_item_id = NEW.id AND state IN ('OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED');
END;

-- -----------------------------------------------------------------------------------------------------
-- FA-1 (R2-03 family, architecture correction): budget capacity is ADMITTED, not broadcast. Freed headroom has one
-- durable owner before a BUDGET_EXHAUSTED waiter resumes: the admission pass (one serialized write transaction)
-- admits waiters in order (priority, then FIFO, then id) against the remaining capacity of every level of the
-- waiter's chain (its Work Item level and ancestors — never a Run level: the next run's Run budget is fresh), and
-- records each admission here before it wakes the job, so the next waiter sees that capacity as taken. Every
-- reservation check subtracts OTHER jobs' outstanding ADMITTED amounts; the admitted job's first reservation
-- CONSUMES its own admission (never counted twice). Admissions are not reservations: the budgets' reserved / spent
-- truth is unchanged. State moves once: ADMITTED -> CONSUMED | RELEASED. Never deleted. Content-free.
-- -----------------------------------------------------------------------------------------------------
CREATE TABLE budget_admissions (
  id                       TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  job_id                   TEXT    NOT NULL REFERENCES queue_jobs (id) ON DELETE RESTRICT,
  work_item_id             TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  -- The need it admits (the job's latest budget_wait_needs row); NULL only for a wait parked before needs existed.
  need_seq                 INTEGER REFERENCES budget_wait_needs (seq) ON DELETE RESTRICT,
  -- The levels whose capacity it holds, leaf (Work Item) first: JSON array of budget ids.
  levels_json              TEXT    NOT NULL CHECK (json_valid(levels_json) AND json_type(levels_json) = 'array' AND json_array_length(levels_json) BETWEEN 1 AND 5),
  money                    INTEGER NOT NULL CHECK (money BETWEEN 0 AND 1000000000000000),
  tokens                   INTEGER NOT NULL CHECK (tokens BETWEEN 0 AND 1000000000000),
  state                    TEXT    NOT NULL CHECK (state IN ('ADMITTED', 'CONSUMED', 'RELEASED')),
  reason_code              TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  end_reason_code          TEXT    CHECK (end_reason_code IS NULL OR length(end_reason_code) BETWEEN 1 AND 64),
  consumed_reservation_id  TEXT    REFERENCES budget_reservations (id) ON DELETE RESTRICT,
  admitted_at              TEXT    NOT NULL CHECK (admitted_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  ended_at                 TEXT    CHECK (ended_at IS NULL OR ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'ADMITTED') = (ended_at IS NULL)),
  CHECK ((state = 'ADMITTED') = (end_reason_code IS NULL)),
  CHECK ((state = 'CONSUMED') = (consumed_reservation_id IS NOT NULL))
) STRICT;
-- Never two outstanding admissions of one job (and so never two owners of one job's admitted headroom).
CREATE UNIQUE INDEX budget_admissions_one_outstanding ON budget_admissions (job_id) WHERE state = 'ADMITTED';
CREATE INDEX budget_admissions_outstanding ON budget_admissions (state, admitted_at) WHERE state = 'ADMITTED';
CREATE TRIGGER budget_admissions_no_delete BEFORE DELETE ON budget_admissions BEGIN SELECT RAISE(ABORT, 'a budget admission is durable history'); END;
CREATE TRIGGER budget_admissions_end_once BEFORE UPDATE ON budget_admissions
WHEN NEW.id IS NOT OLD.id OR NEW.job_id IS NOT OLD.job_id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.need_seq IS NOT OLD.need_seq
  OR NEW.levels_json IS NOT OLD.levels_json OR NEW.money IS NOT OLD.money OR NEW.tokens IS NOT OLD.tokens OR NEW.reason_code IS NOT OLD.reason_code
  OR NEW.admitted_at IS NOT OLD.admitted_at OR OLD.state <> 'ADMITTED' OR NEW.state NOT IN ('CONSUMED', 'RELEASED')
BEGIN SELECT RAISE(ABORT, 'a budget admission moves once, ADMITTED to CONSUMED or RELEASED, and is never rewritten'); END;
-- Admitted only for a parked budget waiter, on existing non-Run levels, against the need it currently has.
CREATE TRIGGER budget_admissions_admit_waiter BEFORE INSERT ON budget_admissions
WHEN NEW.state <> 'ADMITTED'
  OR NOT EXISTS (SELECT 1 FROM queue_jobs j WHERE j.id = NEW.job_id AND j.work_item_id = NEW.work_item_id AND j.state = 'WAITING' AND j.wait_reason = 'BUDGET_EXHAUSTED')
  OR (SELECT COUNT(*) FROM json_each(NEW.levels_json) l JOIN budgets b ON b.id = l.value WHERE b.scope <> 'RUN') <> json_array_length(NEW.levels_json)
  OR NEW.need_seq IS NOT (SELECT MAX(n.seq) FROM budget_wait_needs n WHERE n.job_id = NEW.job_id)
BEGIN SELECT RAISE(ABORT, 'a budget admission admits a parked budget waiter on its current need and non-Run levels'); END;
-- Durable backstops (the application releases first and re-runs admission for the freed levels in the same
-- transaction; these make a missed path fail safe, never leak): a job that leaves QUEUED / CLAIMED for any other
-- state, or whose need is replaced by a later refusal, no longer owns admitted capacity.
CREATE TRIGGER budget_admissions_follow_job AFTER UPDATE OF state ON queue_jobs
WHEN NEW.state IS NOT OLD.state AND NEW.state NOT IN ('QUEUED', 'CLAIMED')
BEGIN
  UPDATE budget_admissions SET state = 'RELEASED', end_reason_code = 'JOB_LEFT_QUEUE', ended_at = NEW.updated_at WHERE job_id = NEW.id AND state = 'ADMITTED';
END;
CREATE TRIGGER budget_admissions_follow_need AFTER INSERT ON budget_wait_needs
BEGIN
  UPDATE budget_admissions SET state = 'RELEASED', end_reason_code = 'NEED_REPLACED', ended_at = NEW.created_at WHERE job_id = NEW.job_id AND state = 'ADMITTED';
END;
