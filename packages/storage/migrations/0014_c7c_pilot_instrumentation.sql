-- QANDEEL COMPANY operational schema — migration 0014: C7-C Pilot Instrumentation Pack.
-- A Pilot is a small, durable, Founder-decided CONTEXT over the canonical Company systems: one stable identity, a mode
-- (internal training or a controlled real-world pilot), a forward-only lifecycle with append-only history, one binding
-- to the primary Founder <-> CEO briefing thread (an existing C5 thread; no message body is copied here) and one
-- binding to its root Company Goal (an existing, Founder-approved C5 Goal). Work, review, evaluation, attribution,
-- learning, cost and external evidence are NOT stored here: the Pilot Evidence Board derives them from their own
-- canonical tables. A Pilot grants no budget, tool, role or authority, and no metric ever moves its state.
-- IMMUTABLE once released (see 0001). Migrations 0001–0013 are unchanged; the one object they created that is replaced
-- here (the Founder's governed-confirmation previews, to admit the two Pilot intents) uses the row-preserving rebuild
-- of D-C4-01 (copied whole to TEMP, re-created, every row copied back BEFORE the triggers are re-created).
--
-- Conventions as in 0001–0013: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete, append-only
-- history, forward-only updates. The Pilot title is Company content under the Founder's access scope: it never enters
-- audit, events or logs (Rule A); audit rows carry ids, states and codes only.
PRAGMA defer_foreign_keys = ON;

-- =====================================================================================================
-- 1. The Pilot. DRAFT → BRIEFING → READY → ACTIVE → REVIEWING → COMPLETED, and STOPPED from any non-terminal state.
-- Every step is a Founder act (pilot_history.actor_ref is a Founder ref). The mode never changes. The briefing thread
-- is bound once (entering BRIEFING), the root Goal once (entering ACTIVE); neither is ever re-pointed.
-- =====================================================================================================
CREATE TABLE pilots (
  id                         TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  mode                       TEXT    NOT NULL CHECK (mode IN ('TRAINING_INTERNAL', 'CONTROLLED_REAL')),
  -- Company content (Founder-typed), never copied into audit / events / logs.
  title                      TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  -- A controlled real-world Pilot may state that it needs real external outcome evidence; a training Pilot never does.
  requires_external_outcome  INTEGER NOT NULL CHECK (requires_external_outcome IN (0, 1)),
  state                      TEXT    NOT NULL CHECK (state IN ('DRAFT', 'BRIEFING', 'READY', 'ACTIVE', 'REVIEWING', 'COMPLETED', 'STOPPED')),
  briefing_thread_id         TEXT             REFERENCES communication_threads (id) ON DELETE RESTRICT,
  -- The briefing boundary: the bound thread's next message sequence when THIS Pilot entered BRIEFING. Only Founder
  -- requests at or after it can evidence this Pilot's briefing; earlier messages stay ordinary history (TL review, MAJOR).
  briefing_from_seq          INTEGER          CHECK (briefing_from_seq IS NULL OR briefing_from_seq >= 1),
  root_goal_id               TEXT             REFERENCES goals (id) ON DELETE RESTRICT,
  created_by_ref             TEXT    NOT NULL CHECK (created_by_ref GLOB 'founder:*'),
  version                    INTEGER NOT NULL CHECK (version >= 1),
  created_at                 TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at                 TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  activated_at               TEXT             CHECK (activated_at IS NULL OR activated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  closed_at                  TEXT             CHECK (closed_at IS NULL OR closed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (mode = 'CONTROLLED_REAL' OR requires_external_outcome = 0),
  CHECK (state IN ('DRAFT', 'STOPPED') OR briefing_thread_id IS NOT NULL),
  CHECK ((briefing_thread_id IS NULL) = (briefing_from_seq IS NULL)),
  CHECK (state NOT IN ('ACTIVE', 'REVIEWING', 'COMPLETED') OR (root_goal_id IS NOT NULL AND activated_at IS NOT NULL)),
  CHECK ((state IN ('COMPLETED', 'STOPPED')) = (closed_at IS NOT NULL))
) STRICT;
CREATE INDEX pilots_state ON pilots (state);
-- One Pilot per briefing thread and per root Goal: a link is never duplicated, and one Goal's evidence never counts twice.
CREATE UNIQUE INDEX pilots_one_per_thread ON pilots (briefing_thread_id) WHERE briefing_thread_id IS NOT NULL;
CREATE UNIQUE INDEX pilots_one_per_root_goal ON pilots (root_goal_id) WHERE root_goal_id IS NOT NULL;

CREATE TRIGGER pilots_no_delete BEFORE DELETE ON pilots
BEGIN SELECT RAISE(ABORT, 'a pilot is closed or stopped, never deleted'); END;

-- A Pilot is born a DRAFT with nothing bound.
CREATE TRIGGER pilots_born_draft BEFORE INSERT ON pilots
WHEN NEW.state <> 'DRAFT' OR NEW.version <> 1 OR NEW.briefing_thread_id IS NOT NULL OR NEW.briefing_from_seq IS NOT NULL OR NEW.root_goal_id IS NOT NULL OR NEW.activated_at IS NOT NULL OR NEW.closed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a pilot is created as a DRAFT with nothing bound'); END;

-- Identity, mode and title are immutable; each binding is written once; every update is one versioned step.
CREATE TRIGGER pilots_identity_immutable BEFORE UPDATE ON pilots
WHEN NEW.id IS NOT OLD.id OR NEW.mode IS NOT OLD.mode OR NEW.title IS NOT OLD.title OR NEW.requires_external_outcome IS NOT OLD.requires_external_outcome
  OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR (OLD.briefing_thread_id IS NOT NULL AND NEW.briefing_thread_id IS NOT OLD.briefing_thread_id)
  OR (OLD.briefing_from_seq IS NOT NULL AND NEW.briefing_from_seq IS NOT OLD.briefing_from_seq)
  OR (OLD.root_goal_id IS NOT NULL AND NEW.root_goal_id IS NOT OLD.root_goal_id)
  OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS NOT OLD.activated_at)
BEGIN SELECT RAISE(ABORT, 'a pilot keeps its identity, mode and bindings'); END;

-- Forward only: each update is exactly one allowed step; a terminal Pilot never revives.
CREATE TRIGGER pilots_forward BEFORE UPDATE ON pilots
WHEN NOT (
     (OLD.state = 'DRAFT'     AND NEW.state IN ('BRIEFING', 'STOPPED'))
  OR (OLD.state = 'BRIEFING'  AND NEW.state IN ('READY', 'STOPPED'))
  OR (OLD.state = 'READY'     AND NEW.state IN ('ACTIVE', 'STOPPED'))
  OR (OLD.state = 'ACTIVE'    AND NEW.state IN ('REVIEWING', 'STOPPED'))
  OR (OLD.state = 'REVIEWING' AND NEW.state IN ('COMPLETED', 'STOPPED')))
BEGIN SELECT RAISE(ABORT, 'pilot transition is not allowed'); END;

-- The briefing is a Founder <-> CEO thread that is open when it is bound, and its boundary is exactly the thread's next
-- message sequence at that moment (an existing thread may be reused; what it already holds never briefs this Pilot).
CREATE TRIGGER pilots_briefing_thread_governed BEFORE UPDATE ON pilots
WHEN (NEW.briefing_thread_id IS NOT OLD.briefing_thread_id OR NEW.briefing_from_seq IS NOT OLD.briefing_from_seq)
  AND (NEW.state <> 'BRIEFING' OR NOT EXISTS (SELECT 1 FROM communication_threads t WHERE t.id = NEW.briefing_thread_id AND t.kind = 'FOUNDER_CEO' AND t.state = 'OPEN')
       OR NEW.briefing_from_seq IS NOT (SELECT COALESCE(MAX(m.seq), 0) + 1 FROM communication_messages m WHERE m.thread_id = NEW.briefing_thread_id))
BEGIN SELECT RAISE(ABORT, 'a pilot briefing is bound once, entering BRIEFING, to an open Founder <-> CEO thread from its next message on'); END;

-- READY needs proof that a conversation happened FOR THIS PILOT (never its quality, never consent): in the briefing thread,
-- at or after the Pilot's briefing boundary, the Founder sent a response-required REQUEST / QUESTION / DECISION_REQUEST, and the governed reply Work Item of THAT message has
-- recorded an Employee reply from its own run. An unanswered request proves nothing (silence is never approval).
CREATE TRIGGER pilots_ready_requires_briefing BEFORE UPDATE ON pilots
WHEN NEW.state = 'READY' AND OLD.state <> 'READY' AND NOT EXISTS (
  SELECT 1 FROM communication_messages m
   WHERE m.thread_id = NEW.briefing_thread_id AND m.seq >= NEW.briefing_from_seq AND m.sender_kind = 'FOUNDER' AND m.response_required = 1
     AND m.purpose IN ('REQUEST', 'QUESTION', 'DECISION_REQUEST') AND m.reply_work_item_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM communication_messages r JOIN runs x ON x.id = r.run_id
                  WHERE r.thread_id = m.thread_id AND r.seq > m.seq AND r.sender_kind = 'EMPLOYEE' AND x.work_item_id = m.reply_work_item_id))
BEGIN SELECT RAISE(ABORT, 'a pilot is READY only after a governed reply to a Founder briefing request'); END;

-- ACTIVE needs its root Company Goal: Founder-approved, ACTIVE, with success criteria. Nothing here creates or approves it.
CREATE TRIGGER pilots_active_requires_root_goal BEFORE UPDATE ON pilots
WHEN NEW.state = 'ACTIVE' AND OLD.state <> 'ACTIVE' AND NOT EXISTS (
  SELECT 1 FROM goals g WHERE g.id = NEW.root_goal_id AND g.kind = 'COMPANY' AND g.state = 'ACTIVE' AND g.approved_by_ref IS NOT NULL
     AND json_array_length(g.success_criteria_json) > 0)
BEGIN SELECT RAISE(ABORT, 'a pilot is ACTIVE only on an active, Founder-approved company goal with success criteria'); END;

-- The root Goal is bound only by the step that activates the Pilot.
CREATE TRIGGER pilots_root_goal_bound_at_activation BEFORE UPDATE ON pilots
WHEN NEW.root_goal_id IS NOT OLD.root_goal_id AND NEW.state <> 'ACTIVE'
BEGIN SELECT RAISE(ABORT, 'a pilot binds its root goal when it becomes ACTIVE'); END;

-- =====================================================================================================
-- 2. History: one row per step, written by the Founder, matching the Pilot's own version and state.
-- =====================================================================================================
CREATE TABLE pilot_history (
  pilot_id     TEXT    NOT NULL REFERENCES pilots (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT             CHECK (from_state IS NULL OR from_state IN ('DRAFT', 'BRIEFING', 'READY', 'ACTIVE', 'REVIEWING', 'COMPLETED', 'STOPPED')),
  to_state     TEXT    NOT NULL CHECK (to_state IN ('DRAFT', 'BRIEFING', 'READY', 'ACTIVE', 'REVIEWING', 'COMPLETED', 'STOPPED')),
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (actor_ref GLOB 'founder:*'),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (pilot_id, version),
  CHECK ((version = 1) = (from_state IS NULL))
) STRICT;
CREATE TRIGGER pilot_history_matches BEFORE INSERT ON pilot_history
WHEN NOT EXISTS (SELECT 1 FROM pilots p WHERE p.id = NEW.pilot_id AND p.version = NEW.version AND p.state = NEW.to_state)
BEGIN SELECT RAISE(ABORT, 'pilot history records the step the pilot just took'); END;
CREATE TRIGGER pilot_history_append_only_u BEFORE UPDATE ON pilot_history
BEGIN SELECT RAISE(ABORT, 'pilot history is append-only'); END;
CREATE TRIGGER pilot_history_append_only_d BEFORE DELETE ON pilot_history
BEGIN SELECT RAISE(ABORT, 'pilot history is append-only'); END;

-- =====================================================================================================
-- 3. The Founder's governed confirmation (0009 / 0011 / 0012) gains the two structured Pilot intents: creating a Pilot
-- and taking one lifecycle step. Same rebuild as R2-21 / C7-A.
-- =====================================================================================================
CREATE TEMP TABLE c4_copy_founder_action_previews AS SELECT * FROM main.founder_action_previews;
DROP TABLE main.founder_action_previews;
CREATE TABLE founder_action_previews (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  session_id     TEXT    NOT NULL REFERENCES founder_sessions (id) ON DELETE RESTRICT,
  intent_kind    TEXT    NOT NULL CHECK (intent_kind IN ('APPROVAL_DECIDE', 'GOAL_APPROVE', 'GOAL_STATE', 'GOAL_PROPOSE', 'STAFFING_DECIDE', 'CONFLICT_RESOLVE', 'BUDGET_CEILING', 'DELEGATE_WORK',
                                                         'TOOL_RECONCILE', 'RESERVATION_RECONCILE', 'JOB_RECONCILE', 'REVIEW_ESCALATION_RESOLVE', 'SYSTEMIC_DECIDE', 'ATTRIBUTION_DECIDE', 'LESSON_DECIDE', 'OUTCOME_VERIFY', 'PROMOTION_DECIDE',
                                                         'SOURCE_REGISTER', 'SOURCE_DECIDE', 'EVIDENCE_BIND', 'EVIDENCE_UNBIND', 'OUTCOME_CONTEST_RESOLVE',
                                                         'PILOT_CREATE', 'PILOT_ADVANCE')),
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
