-- QANDEEL COMPANY operational schema — migration 0009: C5 Founder Command Center foundation:
-- the durable Goal model (Stage 2 Direction), Founder-facing structured communication (Stage 9),
-- Founder Attention state (dedup / cooldown / resolution), the authenticated Founder surface (launch
-- tokens, sessions — hashes only) and governed action previews (natural language never mutates).
-- IMMUTABLE once released (see 0001). Migrations 0001–0008 are unchanged.
--
-- Conventions as in 0001–0008: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete,
-- append-only history. Nothing here stores a secret (token and CSRF columns hold SHA-256 hashes only) and
-- nothing here is operational telemetry: message bodies are Founder-scoped company content (Stage 9 §24).
-- Message ≠ Decision ≠ Knowledge; Goal ≠ Work Item; Conversation ≠ Authority; a UI projection ≠ canonical state.

-- =====================================================================================================
-- 1. Goals (Stage 2 §3): stable identity, kind / scope, lifecycle, ownership, derivation and horizon.
-- A COMPANY goal is Founder-approved (never APPROVED / ACTIVE without a founder:* approver); a DEPARTMENT
-- goal derives from an approved COMPANY goal (parent) within its Department. Routine maintenance needs no
-- Goal: Standing Responsibility remains valid context (no artificial goals are required by any CHECK).
-- =====================================================================================================
CREATE TABLE goals (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  kind                   TEXT    NOT NULL CHECK (kind IN ('COMPANY', 'DEPARTMENT')),
  department_id          TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  title                  TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  summary                TEXT    NOT NULL CHECK (length(summary) BETWEEN 1 AND 2000),
  success_criteria_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(success_criteria_json) AND json_type(success_criteria_json) = 'array' AND length(success_criteria_json) <= 4096),
  state                  TEXT    NOT NULL CHECK (state IN ('DRAFT', 'PROPOSED', 'APPROVED', 'ACTIVE', 'PAUSED', 'ACHIEVED', 'CANCELLED', 'SUPERSEDED')),
  owner_ref              TEXT    NOT NULL CHECK (length(owner_ref) BETWEEN 3 AND 161),
  parent_goal_id         TEXT             REFERENCES goals (id) ON DELETE RESTRICT,
  horizon_from           TEXT             CHECK (horizon_from IS NULL OR horizon_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  horizon_to             TEXT             CHECK (horizon_to IS NULL OR horizon_to GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  approved_by_ref        TEXT             CHECK (approved_by_ref IS NULL OR approved_by_ref GLOB 'founder:*'),
  approved_at            TEXT             CHECK (approved_at IS NULL OR approved_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  superseded_by          TEXT             REFERENCES goals (id) ON DELETE RESTRICT,
  created_by_ref         TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  version                INTEGER NOT NULL CHECK (version >= 1),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at             TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((kind = 'DEPARTMENT') = (department_id IS NOT NULL)),
  CHECK (kind <> 'DEPARTMENT' OR parent_goal_id IS NOT NULL),
  CHECK (kind <> 'COMPANY' OR parent_goal_id IS NULL),
  -- Company-level strategic Goals require Founder approval (Stage 2 §3): never live without it.
  CHECK (kind <> 'COMPANY' OR state NOT IN ('APPROVED', 'ACTIVE', 'PAUSED', 'ACHIEVED') OR approved_by_ref IS NOT NULL),
  CHECK ((approved_by_ref IS NULL) = (approved_at IS NULL)),
  CHECK ((state = 'SUPERSEDED') = (superseded_by IS NOT NULL)),
  CHECK (horizon_from IS NULL OR horizon_to IS NULL OR horizon_to >= horizon_from),
  CHECK (parent_goal_id IS NULL OR parent_goal_id <> id)
) STRICT;
CREATE INDEX goals_state ON goals (state);
CREATE INDEX goals_department ON goals (department_id);
CREATE INDEX goals_parent ON goals (parent_goal_id);
CREATE TRIGGER goals_no_delete BEFORE DELETE ON goals BEGIN SELECT RAISE(ABORT, 'goals are cancelled or superseded, never deleted'); END;
CREATE TRIGGER goals_identity_immutable BEFORE UPDATE ON goals
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.department_id IS NOT OLD.department_id OR NEW.parent_goal_id IS NOT OLD.parent_goal_id
  OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR (OLD.approved_by_ref IS NOT NULL AND (NEW.approved_by_ref IS NOT OLD.approved_by_ref OR NEW.approved_at IS NOT OLD.approved_at))
  OR OLD.state IN ('ACHIEVED', 'CANCELLED', 'SUPERSEDED')
BEGIN SELECT RAISE(ABORT, 'a goal keeps its identity, kind, derivation and approval; a closed goal is history'); END;
-- A Department goal derives from an approved / active company goal of the company (Stage 2 §3).
CREATE TRIGGER goals_department_derives_from_company BEFORE INSERT ON goals
WHEN NEW.kind = 'DEPARTMENT' AND NOT EXISTS (SELECT 1 FROM goals p WHERE p.id = NEW.parent_goal_id AND p.kind = 'COMPANY' AND p.state IN ('APPROVED', 'ACTIVE'))
BEGIN SELECT RAISE(ABORT, 'a Department goal derives from an approved company goal'); END;

CREATE TABLE goal_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id      TEXT    NOT NULL REFERENCES goals (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT,
  to_state     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (goal_id, version)
) STRICT;
CREATE TRIGGER goal_history_append_only_u BEFORE UPDATE ON goal_history BEGIN SELECT RAISE(ABORT, 'goal history is append-only'); END;
CREATE TRIGGER goal_history_append_only_d BEFORE DELETE ON goal_history BEGIN SELECT RAISE(ABORT, 'goal history is append-only'); END;

-- Goal → Work traceability: durable links, never a parallel Work Item engine. A link ends; it is never deleted.
CREATE TABLE goal_work_links (
  id              TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  goal_id         TEXT NOT NULL REFERENCES goals (id) ON DELETE RESTRICT,
  work_item_id    TEXT NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  link_kind       TEXT NOT NULL CHECK (link_kind IN ('SERVES', 'DERIVED')),
  created_by_ref  TEXT NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at      TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  ended_at        TEXT          CHECK (ended_at IS NULL OR ended_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  end_reason_code TEXT          CHECK (end_reason_code IS NULL OR length(end_reason_code) BETWEEN 1 AND 64),
  CHECK ((ended_at IS NULL) = (end_reason_code IS NULL))
) STRICT;
CREATE UNIQUE INDEX goal_work_links_one_live ON goal_work_links (goal_id, work_item_id) WHERE ended_at IS NULL;
CREATE INDEX goal_work_links_work_item ON goal_work_links (work_item_id);
CREATE TRIGGER goal_work_links_no_delete BEFORE DELETE ON goal_work_links BEGIN SELECT RAISE(ABORT, 'goal links are ended, never deleted'); END;
CREATE TRIGGER goal_work_links_end_once BEFORE UPDATE ON goal_work_links
WHEN NEW.id IS NOT OLD.id OR NEW.goal_id IS NOT OLD.goal_id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.link_kind IS NOT OLD.link_kind
  OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR OLD.ended_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a goal link is ended once; it is history afterwards'); END;

-- =====================================================================================================
-- 2. Founder-facing structured communication (Stage 9): threads with a purpose and context, messages that
-- are durable company content under the FOUNDER_ONLY access scope. An Employee message is written only by
-- that Employee's governed run (fenced, runtime-authority); the Founder's own messages by the authenticated
-- Founder surface. Direct communication changes no authority (Stage 9 §6): nothing here is an approval.
-- =====================================================================================================
CREATE TABLE communication_threads (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  kind           TEXT    NOT NULL CHECK (kind IN ('FOUNDER_CEO', 'FOUNDER_EMPLOYEE', 'CEO_BRIEF')),
  employee_id    TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  subject        TEXT    NOT NULL CHECK (length(subject) BETWEEN 1 AND 160),
  context_kind   TEXT             CHECK (context_kind IS NULL OR context_kind IN ('GOAL', 'WORK_ITEM', 'DECISION', 'REVIEW', 'APPROVAL', 'DEPARTMENT', 'INCIDENT')),
  context_ref    TEXT             CHECK (context_ref IS NULL OR length(context_ref) BETWEEN 3 AND 161),
  access_scope   TEXT    NOT NULL DEFAULT 'FOUNDER_ONLY' CHECK (access_scope = 'FOUNDER_ONLY'),
  state          TEXT    NOT NULL CHECK (state IN ('OPEN', 'CLOSED')),
  opened_by_ref  TEXT    NOT NULL CHECK (length(opened_by_ref) BETWEEN 3 AND 161),
  version        INTEGER NOT NULL CHECK (version >= 1),
  created_at     TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at     TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((context_kind IS NULL) = (context_ref IS NULL))
) STRICT;
CREATE INDEX communication_threads_employee ON communication_threads (employee_id, state);
CREATE INDEX communication_threads_context ON communication_threads (context_kind, context_ref);
CREATE TRIGGER communication_threads_no_delete BEFORE DELETE ON communication_threads BEGIN SELECT RAISE(ABORT, 'threads are closed, never deleted'); END;
CREATE TRIGGER communication_threads_identity_immutable BEFORE UPDATE ON communication_threads
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.employee_id IS NOT OLD.employee_id OR NEW.access_scope IS NOT OLD.access_scope
  OR NEW.opened_by_ref IS NOT OLD.opened_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'a thread keeps its identity, participants and scope'); END;

CREATE TABLE communication_messages (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  thread_id           TEXT    NOT NULL REFERENCES communication_threads (id) ON DELETE RESTRICT,
  seq                 INTEGER NOT NULL CHECK (seq >= 1),
  sender_kind         TEXT    NOT NULL CHECK (sender_kind IN ('FOUNDER', 'EMPLOYEE')),
  sender_ref          TEXT    NOT NULL CHECK (length(sender_ref) BETWEEN 3 AND 161),
  purpose             TEXT    NOT NULL CHECK (purpose IN ('REQUEST', 'QUESTION', 'FYI', 'REVIEW', 'DECISION_REQUEST', 'BLOCKER', 'ESCALATION', 'RESULT', 'CORRECTION', 'BRIEF')),
  attention_level     TEXT    NOT NULL CHECK (attention_level IN ('INFORMATIONAL', 'NEEDS_ATTENTION', 'NEEDS_DECISION', 'URGENT')),
  -- Company content under the thread's access scope (never copied into audit, events or logs — Rule A).
  body                TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  body_sha256         TEXT    NOT NULL CHECK (length(body_sha256) = 64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'),
  -- Founder Communication Standard (Stage 9 §15): what / why / recommendation / decision needed.
  brief_json          TEXT             CHECK (brief_json IS NULL OR (json_valid(brief_json) AND json_type(brief_json) = 'object' AND length(brief_json) <= 6000)),
  response_required   INTEGER NOT NULL CHECK (response_required IN (0, 1)),
  reply_work_item_id  TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  run_id              TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  context_refs_json   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(context_refs_json) AND json_type(context_refs_json) = 'array' AND length(context_refs_json) <= 1024),
  superseded_by       TEXT             REFERENCES communication_messages (id) ON DELETE RESTRICT,
  created_at          TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (thread_id, seq),
  CHECK ((purpose = 'BRIEF') = (brief_json IS NOT NULL)),
  CHECK (sender_kind <> 'FOUNDER' OR sender_ref GLOB 'founder:*'),
  CHECK (sender_kind <> 'EMPLOYEE' OR (sender_ref GLOB 'employee:*' AND run_id IS NOT NULL)),
  CHECK (sender_kind <> 'FOUNDER' OR run_id IS NULL),
  CHECK (sender_kind <> 'EMPLOYEE' OR reply_work_item_id IS NULL),
  CHECK (purpose <> 'BRIEF' OR sender_kind = 'EMPLOYEE')
) STRICT;
CREATE INDEX communication_messages_thread ON communication_messages (thread_id, seq);
CREATE INDEX communication_messages_reply_work ON communication_messages (reply_work_item_id) WHERE reply_work_item_id IS NOT NULL;
CREATE TRIGGER communication_messages_append_only_d BEFORE DELETE ON communication_messages BEGIN SELECT RAISE(ABORT, 'messages are durable communication history'); END;
CREATE TRIGGER communication_messages_supersede_only BEFORE UPDATE ON communication_messages
WHEN NEW.id IS NOT OLD.id OR NEW.thread_id IS NOT OLD.thread_id OR NEW.seq IS NOT OLD.seq OR NEW.sender_kind IS NOT OLD.sender_kind OR NEW.sender_ref IS NOT OLD.sender_ref
  OR NEW.purpose IS NOT OLD.purpose OR NEW.attention_level IS NOT OLD.attention_level OR NEW.body IS NOT OLD.body OR NEW.body_sha256 IS NOT OLD.body_sha256
  OR NEW.brief_json IS NOT OLD.brief_json OR NEW.response_required IS NOT OLD.response_required OR NEW.reply_work_item_id IS NOT OLD.reply_work_item_id
  OR NEW.run_id IS NOT OLD.run_id OR NEW.context_refs_json IS NOT OLD.context_refs_json OR NEW.created_at IS NOT OLD.created_at OR OLD.superseded_by IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a message is corrected by supersession, never rewritten'); END;

-- =====================================================================================================
-- 3. Founder Attention (Stage 9 §16, §25–§29): durable dedup / cooldown / resolution state over canonical
-- sources (approvals, escalations, conflicts, briefs, threads). Not a second inbox: an item points at its
-- source and never carries content (the Founder reads the source itself).
-- =====================================================================================================
CREATE TABLE founder_attention_items (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  dedup_key        TEXT    NOT NULL UNIQUE CHECK (length(dedup_key) BETWEEN 3 AND 161),
  lane             TEXT    NOT NULL CHECK (lane IN ('NEEDS_ME', 'CEO_BRIEFS', 'THREADS')),
  level            TEXT    NOT NULL CHECK (level IN ('INFORMATIONAL', 'NEEDS_ATTENTION', 'NEEDS_DECISION', 'URGENT')),
  source_kind      TEXT    NOT NULL CHECK (source_kind IN ('APPROVAL', 'STAFFING_REQUEST', 'ESCALATION', 'REVIEW_CONFLICT', 'BRIEF', 'THREAD', 'GOAL', 'DECISION_REQUEST')),
  source_ref       TEXT    NOT NULL CHECK (length(source_ref) BETWEEN 3 AND 161),
  owner_ref        TEXT             CHECK (owner_ref IS NULL OR length(owner_ref) BETWEEN 3 AND 161),
  state            TEXT    NOT NULL CHECK (state IN ('OPEN', 'RESOLVED', 'DISMISSED')),
  first_seen_at    TEXT    NOT NULL CHECK (first_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_signal_at   TEXT    NOT NULL CHECK (last_signal_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  signal_count     INTEGER NOT NULL CHECK (signal_count >= 1),
  cooldown_until   TEXT             CHECK (cooldown_until IS NULL OR cooldown_until GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  resolved_at      TEXT             CHECK (resolved_at IS NULL OR resolved_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  resolved_reason  TEXT             CHECK (resolved_reason IS NULL OR length(resolved_reason) BETWEEN 1 AND 64),
  version          INTEGER NOT NULL CHECK (version >= 1),
  CHECK ((state = 'OPEN') = (resolved_at IS NULL)),
  CHECK ((resolved_at IS NULL) = (resolved_reason IS NULL)),
  CHECK (last_signal_at >= first_seen_at)
) STRICT;
CREATE INDEX founder_attention_open ON founder_attention_items (lane, state) WHERE state = 'OPEN';
CREATE TRIGGER founder_attention_items_no_delete BEFORE DELETE ON founder_attention_items BEGIN SELECT RAISE(ABORT, 'attention items are resolved, never deleted'); END;
CREATE TRIGGER founder_attention_items_forward BEFORE UPDATE ON founder_attention_items
WHEN NEW.id IS NOT OLD.id OR NEW.dedup_key IS NOT OLD.dedup_key OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_ref IS NOT OLD.source_ref
  OR NEW.first_seen_at IS NOT OLD.first_seen_at OR NEW.version <> OLD.version + 1 OR NEW.signal_count < OLD.signal_count
BEGIN SELECT RAISE(ABORT, 'an attention item keeps its identity and source; signals never decrease'); END;

-- =====================================================================================================
-- 4. The authenticated Founder surface (Stage 14, D-C2-13). A launch token is minted by the Founder's own
-- Windows user against the workspace and redeemed once by the browser; a session is the browser's proof.
-- Only SHA-256 hashes are stored: a database copy yields no usable credential. Local is not trusted:
-- every privileged request re-verifies its session here, and everything fails closed.
-- =====================================================================================================
CREATE TABLE founder_launch_tokens (
  id            TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  token_sha256  TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at    TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  expires_at    TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  consumed_at   TEXT          CHECK (consumed_at IS NULL OR consumed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (expires_at > created_at)
) STRICT;
CREATE TRIGGER founder_launch_tokens_no_delete BEFORE DELETE ON founder_launch_tokens BEGIN SELECT RAISE(ABORT, 'launch tokens expire or are consumed; they are audit history'); END;
CREATE TRIGGER founder_launch_tokens_consume_once BEFORE UPDATE ON founder_launch_tokens
WHEN NEW.id IS NOT OLD.id OR NEW.token_sha256 IS NOT OLD.token_sha256 OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.consumed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a launch token is consumed once'); END;

CREATE TABLE founder_sessions (
  id             TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  token_sha256   TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'),
  csrf_sha256    TEXT NOT NULL CHECK (length(csrf_sha256) = 64 AND csrf_sha256 NOT GLOB '*[^0-9a-f]*'),
  founder_ref    TEXT NOT NULL CHECK (founder_ref GLOB 'founder:*'),
  launch_id      TEXT NOT NULL REFERENCES founder_launch_tokens (id) ON DELETE RESTRICT,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  expires_at     TEXT NOT NULL CHECK (expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_seen_at   TEXT NOT NULL CHECK (last_seen_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  revoked_at     TEXT          CHECK (revoked_at IS NULL OR revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  revoke_reason  TEXT          CHECK (revoke_reason IS NULL OR length(revoke_reason) BETWEEN 1 AND 64),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
) STRICT;
CREATE INDEX founder_sessions_live ON founder_sessions (expires_at) WHERE revoked_at IS NULL;
CREATE TRIGGER founder_sessions_no_delete BEFORE DELETE ON founder_sessions BEGIN SELECT RAISE(ABORT, 'sessions are revoked, never deleted'); END;
CREATE TRIGGER founder_sessions_revoke_once BEFORE UPDATE ON founder_sessions
WHEN NEW.id IS NOT OLD.id OR NEW.token_sha256 IS NOT OLD.token_sha256 OR NEW.csrf_sha256 IS NOT OLD.csrf_sha256 OR NEW.founder_ref IS NOT OLD.founder_ref
  OR NEW.launch_id IS NOT OLD.launch_id OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at > OLD.expires_at OR OLD.revoked_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'a session never extends, changes identity or comes back after revocation'); END;

-- Governed action previews (Stage 14 D14-A.6 / C5 §11.3): a mutating natural-language intent becomes a
-- structured preview bound to its session; only an explicit confirmation of exactly that preview reaches the
-- real authority boundary. The text alone mutates nothing. Payloads carry codes, IDs and bounded values.
CREATE TABLE founder_action_previews (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  session_id     TEXT    NOT NULL REFERENCES founder_sessions (id) ON DELETE RESTRICT,
  intent_kind    TEXT    NOT NULL CHECK (intent_kind IN ('APPROVAL_DECIDE', 'GOAL_APPROVE', 'GOAL_STATE', 'GOAL_PROPOSE', 'STAFFING_DECIDE', 'CONFLICT_RESOLVE', 'BUDGET_CEILING', 'DELEGATE_WORK')),
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
CREATE INDEX founder_action_previews_session ON founder_action_previews (session_id, state);
CREATE TRIGGER founder_action_previews_no_delete BEFORE DELETE ON founder_action_previews BEGIN SELECT RAISE(ABORT, 'previews are decided or expire; they are audit history'); END;
CREATE TRIGGER founder_action_previews_decide_once BEFORE UPDATE ON founder_action_previews
WHEN NEW.id IS NOT OLD.id OR NEW.session_id IS NOT OLD.session_id OR NEW.intent_kind IS NOT OLD.intent_kind OR NEW.payload_json IS NOT OLD.payload_json
  OR NEW.fingerprint IS NOT OLD.fingerprint OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.state <> 'PREVIEW'
BEGIN SELECT RAISE(ABORT, 'a preview is decided exactly once and never rewritten'); END;
