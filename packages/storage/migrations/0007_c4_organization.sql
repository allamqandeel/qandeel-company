-- QANDEEL COMPANY operational schema — migration 0007: C4 organization (company-scoped executive
-- compatibility, Department Charters, Positions, effective-dated Assignments, Staffing Requests,
-- Founder-originated authority delegation, work delegation / support / handoff, idempotent organization
-- acts, time-correct run organization snapshots, P-07 exclusion releases) and the canonical Strong-v1
-- organization skeleton.
-- IMMUTABLE once released (see 0001). Migrations 0001–0006 are unchanged.
--
-- Conventions as in 0001–0006: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard
-- delete, append-only history. Titles, Positions and Departments grant NO authority: authority exists
-- only in explicit grants (0004). Nothing here stores a secret or operational telemetry content.

-- =====================================================================================================
-- 1. C2 compatibility evolution for company-scoped executives (D-C4-02).
--
-- The CEO seat is COMPANY-scoped (D-R1-04): its holder belongs to no Department. Four released C2 tables
-- declared `department_id NOT NULL`, which would force a fake Department; `budgets` allowed exactly one
-- Employee envelope forever, under an immutable parent, so a transfer or a promotion into the CEO seat could
-- never be budgeted again. These five tables are rebuilt, inside this migration's single transaction:
-- `department_id` nullable under an explicit scope invariant, and per-placement Employee envelopes. Every
-- other column, CHECK, index and trigger is re-created exactly; every row is copied. PRAGMA foreign_keys cannot
-- change inside a transaction, so parent references are deferred to COMMIT (defer_foreign_keys resets
-- itself at COMMIT / ROLLBACK): a dangling reference fails the migration and nothing is applied.
-- DROP TABLE's implicit delete fires no trigger (sqlite.org/foreignkeys.html §5).
-- =====================================================================================================
PRAGMA defer_foreign_keys = ON;

-- ---- employees: `department_id` is the C2 projection of the canonical Position Assignment ------------
CREATE TEMP TABLE c4_copy_employees AS SELECT * FROM main.employees;
DROP TABLE main.employees;
CREATE TABLE employees (
  id                       TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  given_name               TEXT    NOT NULL CHECK (length(given_name) BETWEEN 2 AND 40),
  family_name              TEXT    NOT NULL CHECK (length(family_name) BETWEEN 2 AND 40),
  name_origin              TEXT    NOT NULL CHECK (name_origin = 'EG'),
  profile_json             TEXT    NOT NULL CHECK (json_valid(profile_json) AND length(profile_json) <= 8192),
  cognitive_profile_json   TEXT    NOT NULL CHECK (json_valid(cognitive_profile_json) AND length(cognitive_profile_json) <= 512),
  role_ref                 TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 3 AND 161),
  position_ref             TEXT    NOT NULL CHECK (length(position_ref) BETWEEN 3 AND 161),
  department_id            TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  manager_ref              TEXT    NOT NULL CHECK (length(manager_ref) BETWEEN 3 AND 161),
  state                    TEXT    NOT NULL CHECK (state IN ('CANDIDATE', 'TRAINING', 'SHADOW', 'PROBATION', 'ACTIVE', 'PAUSED', 'ON_LEAVE', 'RETRAINING', 'SUSPENDED', 'RETIRED')),
  qualification_refs_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(qualification_refs_json) AND json_type(qualification_refs_json) = 'array' AND length(qualification_refs_json) <= 4096),
  version                  INTEGER NOT NULL CHECK (version >= 1),
  created_at               TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at               TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  -- C4: DEPARTMENT (a Department member) or COMPANY (a company-scoped executive seat such as the CEO).
  org_scope                TEXT    NOT NULL DEFAULT 'DEPARTMENT' CHECK (org_scope IN ('DEPARTMENT', 'COMPANY')),
  CHECK (state <> 'ACTIVE' OR json_array_length(qualification_refs_json) > 0),
  CHECK ((org_scope = 'DEPARTMENT') = (department_id IS NOT NULL))
) STRICT;
INSERT INTO employees (id, given_name, family_name, name_origin, profile_json, cognitive_profile_json, role_ref, position_ref, department_id, manager_ref, state, qualification_refs_json, version, created_at, updated_at, org_scope)
  SELECT id, given_name, family_name, name_origin, profile_json, cognitive_profile_json, role_ref, position_ref, department_id, manager_ref, state, qualification_refs_json, version, created_at, updated_at, 'DEPARTMENT' FROM temp.c4_copy_employees;
DROP TABLE temp.c4_copy_employees;
CREATE UNIQUE INDEX employees_distinct_name ON employees (given_name, family_name);
CREATE INDEX employees_department ON employees (department_id);
CREATE TRIGGER employees_no_delete BEFORE DELETE ON employees BEGIN SELECT RAISE(ABORT, 'employees are retired, never deleted'); END;
CREATE TRIGGER employees_identity_immutable BEFORE UPDATE OF id, created_at, name_origin ON employees
WHEN NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at OR NEW.name_origin IS NOT OLD.name_origin
BEGIN SELECT RAISE(ABORT, 'employee identity is immutable'); END;
CREATE TRIGGER employees_retired_frozen BEFORE UPDATE ON employees WHEN OLD.state = 'RETIRED'
BEGIN SELECT RAISE(ABORT, 'a retired employee record is history'); END;
CREATE TRIGGER employees_version_monotonic BEFORE UPDATE ON employees WHEN NEW.version <> OLD.version + 1
BEGIN SELECT RAISE(ABORT, 'employee version must increase by exactly one per update'); END;
CREATE TRIGGER employees_activation_gate BEFORE UPDATE OF state ON employees
WHEN NEW.state = 'ACTIVE' AND OLD.state NOT IN ('ACTIVE', 'PAUSED', 'ON_LEAVE')
  AND NOT EXISTS (SELECT 1 FROM json_each(NEW.qualification_refs_json) j WHERE j.value GLOB 'test-seam:*')
  AND NOT EXISTS (
    SELECT 1 FROM activation_requests a
      JOIN certifications c ON c.id = a.certification_id
      JOIN probation_reviews p ON p.id = a.probation_review_id
     WHERE a.employee_id = NEW.id AND a.state = 'APPROVED' AND a.decided_by_ref GLOB 'founder:*'
       AND c.employee_id = NEW.id AND c.status = 'VALID' AND c.role_ref = NEW.role_ref AND c.valid_until > NEW.updated_at
       AND c.enrollment_id = a.enrollment_id AND p.enrollment_id = a.enrollment_id AND p.decision = 'PASS'
       AND NOT EXISTS (SELECT 1 FROM founder_calibrations f WHERE f.enrollment_id = a.enrollment_id AND (f.state <> 'APPROVED' OR a.calibration_id IS NOT f.id)))
BEGIN SELECT RAISE(ABORT, 'activation requires a valid role certification, a passed probation review and an approved activation request'); END;

-- ---- run_attributions: a company-scoped run is attributed to no Department -----------------------------
CREATE TEMP TABLE c4_copy_run_attributions AS SELECT * FROM main.run_attributions;
DROP TABLE main.run_attributions;
CREATE TABLE run_attributions (
  run_id         TEXT NOT NULL PRIMARY KEY REFERENCES runs (id) ON DELETE RESTRICT,
  work_item_id   TEXT NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id    TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  department_id  TEXT          REFERENCES departments (id) ON DELETE RESTRICT,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  org_scope      TEXT NOT NULL DEFAULT 'DEPARTMENT' CHECK (org_scope IN ('DEPARTMENT', 'COMPANY')),
  CHECK ((org_scope = 'DEPARTMENT') = (department_id IS NOT NULL))
) STRICT, WITHOUT ROWID;
INSERT INTO run_attributions (run_id, work_item_id, employee_id, department_id, created_at, org_scope)
  SELECT run_id, work_item_id, employee_id, department_id, created_at, 'DEPARTMENT' FROM temp.c4_copy_run_attributions;
DROP TABLE temp.c4_copy_run_attributions;
CREATE INDEX run_attributions_employee ON run_attributions (employee_id);
CREATE TRIGGER run_attributions_immutable_u BEFORE UPDATE ON run_attributions BEGIN SELECT RAISE(ABORT, 'run attribution is immutable'); END;
CREATE TRIGGER run_attributions_immutable_d BEFORE DELETE ON run_attributions BEGIN SELECT RAISE(ABORT, 'run attribution is immutable'); END;

-- ---- budget_reservations (0004 + the 0005 manifest column and triggers) --------------------------------
CREATE TEMP TABLE c4_copy_budget_reservations AS SELECT * FROM main.budget_reservations;
DROP TABLE main.budget_reservations;
CREATE TABLE budget_reservations (
  id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  budget_id       TEXT    NOT NULL REFERENCES budgets (id) ON DELETE RESTRICT,
  run_id          TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  job_id          TEXT    NOT NULL REFERENCES queue_jobs (id) ON DELETE RESTRICT,
  fencing_token   INTEGER NOT NULL CHECK (fencing_token >= 1),
  work_item_id    TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id     TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  department_id   TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  purpose         TEXT    NOT NULL CHECK (purpose IN ('MODEL_CALL', 'TOOL_CALL')),
  attempt_kind    TEXT    NOT NULL CHECK (attempt_kind IN ('PRIMARY', 'RETRY', 'FALLBACK', 'ESCALATION')),
  deployment_id   TEXT             REFERENCES deployments (id) ON DELETE RESTRICT,
  price_card_id   TEXT             REFERENCES price_cards (id) ON DELETE RESTRICT,
  tool_action_id  TEXT             REFERENCES tool_actions (id) ON DELETE RESTRICT,
  route_policy_id TEXT             REFERENCES route_policies (id) ON DELETE RESTRICT,
  money           INTEGER NOT NULL CHECK (money BETWEEN 0 AND 1000000000000000),
  tokens          INTEGER NOT NULL CHECK (tokens BETWEEN 0 AND 1000000000000),
  state           TEXT    NOT NULL CHECK (state IN ('RESERVED', 'SETTLED', 'RELEASED', 'RECONCILIATION_REQUIRED')),
  reason_code     TEXT             CHECK (reason_code IS NULL OR length(reason_code) <= 64),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at      TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  context_manifest_id TEXT REFERENCES context_manifests (id) ON DELETE RESTRICT,
  CHECK ((purpose = 'MODEL_CALL') = (deployment_id IS NOT NULL AND price_card_id IS NOT NULL AND route_policy_id IS NOT NULL)),
  CHECK ((purpose = 'TOOL_CALL') = (tool_action_id IS NOT NULL))
) STRICT;
INSERT INTO budget_reservations (id, budget_id, run_id, job_id, fencing_token, work_item_id, employee_id, department_id, purpose, attempt_kind, deployment_id, price_card_id, tool_action_id, route_policy_id, money, tokens, state, reason_code, created_at, updated_at, context_manifest_id)
  SELECT id, budget_id, run_id, job_id, fencing_token, work_item_id, employee_id, department_id, purpose, attempt_kind, deployment_id, price_card_id, tool_action_id, route_policy_id, money, tokens, state, reason_code, created_at, updated_at, context_manifest_id FROM temp.c4_copy_budget_reservations;
DROP TABLE temp.c4_copy_budget_reservations;
CREATE INDEX budget_reservations_run ON budget_reservations (run_id);
CREATE INDEX budget_reservations_open ON budget_reservations (state) WHERE state IN ('RESERVED', 'RECONCILIATION_REQUIRED');
-- P-07: the per-Work-Item deployment exclusion is read by (work item, deployment).
CREATE INDEX budget_reservations_work_item_deployment ON budget_reservations (work_item_id, deployment_id) WHERE purpose = 'MODEL_CALL';
CREATE TRIGGER budget_reservations_amounts_immutable BEFORE UPDATE ON budget_reservations
WHEN NEW.id IS NOT OLD.id OR NEW.budget_id IS NOT OLD.budget_id OR NEW.run_id IS NOT OLD.run_id OR NEW.money IS NOT OLD.money OR NEW.tokens IS NOT OLD.tokens
  OR NEW.purpose IS NOT OLD.purpose OR NEW.attempt_kind IS NOT OLD.attempt_kind OR NEW.fencing_token IS NOT OLD.fencing_token OR NEW.created_at IS NOT OLD.created_at
  OR OLD.state IN ('SETTLED', 'RELEASED')
BEGIN SELECT RAISE(ABORT, 'reservation amounts are immutable and a settled / released reservation is final'); END;
CREATE TRIGGER budget_reservations_no_delete BEFORE DELETE ON budget_reservations BEGIN SELECT RAISE(ABORT, 'reservations are durable history'); END;
CREATE TRIGGER budget_reservations_model_call_manifest BEFORE INSERT ON budget_reservations
WHEN NEW.purpose = 'MODEL_CALL' AND (NEW.context_manifest_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM context_manifests m WHERE m.id = NEW.context_manifest_id AND m.run_id = NEW.run_id AND m.outcome = 'OK' AND NEW.tokens >= m.estimated_input_tokens))
BEGIN SELECT RAISE(ABORT, 'a model call is reserved only against its own OK context manifest and at least its estimated input'); END;
CREATE TRIGGER budget_reservations_manifest_immutable BEFORE UPDATE OF context_manifest_id ON budget_reservations
WHEN NEW.context_manifest_id IS NOT OLD.context_manifest_id
BEGIN SELECT RAISE(ABORT, 'the context manifest of a reservation is immutable'); END;

-- ---- usage_records ----------------------------------------------------------------------------------
CREATE TEMP TABLE c4_copy_usage_records AS SELECT * FROM main.usage_records;
DROP TABLE main.usage_records;
CREATE TABLE usage_records (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  reservation_id      TEXT    NOT NULL UNIQUE REFERENCES budget_reservations (id) ON DELETE RESTRICT,
  run_id              TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  work_item_id        TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id         TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  department_id       TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  purpose             TEXT    NOT NULL CHECK (purpose IN ('MODEL_CALL', 'TOOL_CALL')),
  attempt_kind        TEXT    NOT NULL CHECK (attempt_kind IN ('PRIMARY', 'RETRY', 'FALLBACK', 'ESCALATION')),
  provider_id         TEXT             REFERENCES model_providers (id) ON DELETE RESTRICT,
  model_id            TEXT             REFERENCES models (id) ON DELETE RESTRICT,
  deployment_id       TEXT             REFERENCES deployments (id) ON DELETE RESTRICT,
  price_card_id       TEXT             REFERENCES price_cards (id) ON DELETE RESTRICT,
  price_card_version  INTEGER          CHECK (price_card_version IS NULL OR price_card_version >= 1),
  tool_action_id      TEXT             REFERENCES tool_actions (id) ON DELETE RESTRICT,
  session_id          TEXT             CHECK (session_id IS NULL OR length(session_id) = 36),
  input_tokens        INTEGER NOT NULL CHECK (input_tokens BETWEEN 0 AND 1000000000000),
  output_tokens       INTEGER NOT NULL CHECK (output_tokens BETWEEN 0 AND 1000000000000),
  charged_tokens      INTEGER NOT NULL CHECK (charged_tokens BETWEEN 0 AND 1000000000000),
  billed_micros       INTEGER NOT NULL CHECK (billed_micros BETWEEN 0 AND 1000000000000000),
  economic_micros     INTEGER NOT NULL CHECK (economic_micros BETWEEN 0 AND 1000000000000000),
  within_bounds       INTEGER NOT NULL CHECK (within_bounds IN (0, 1)),
  outcome             TEXT    NOT NULL CHECK (outcome IN ('OK', 'FAILED_CHARGED', 'RECONCILED')),
  created_at          TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
INSERT INTO usage_records (id, reservation_id, run_id, work_item_id, employee_id, department_id, purpose, attempt_kind, provider_id, model_id, deployment_id, price_card_id, price_card_version, tool_action_id, session_id, input_tokens, output_tokens, charged_tokens, billed_micros, economic_micros, within_bounds, outcome, created_at)
  SELECT id, reservation_id, run_id, work_item_id, employee_id, department_id, purpose, attempt_kind, provider_id, model_id, deployment_id, price_card_id, price_card_version, tool_action_id, session_id, input_tokens, output_tokens, charged_tokens, billed_micros, economic_micros, within_bounds, outcome, created_at FROM temp.c4_copy_usage_records;
DROP TABLE temp.c4_copy_usage_records;
CREATE INDEX usage_records_run ON usage_records (run_id);
CREATE INDEX usage_records_employee ON usage_records (employee_id);
CREATE TRIGGER usage_records_append_only_u BEFORE UPDATE ON usage_records BEGIN SELECT RAISE(ABORT, 'usage records are append-only'); END;
CREATE TRIGGER usage_records_append_only_d BEFORE DELETE ON usage_records BEGIN SELECT RAISE(ABORT, 'usage records are append-only'); END;

-- ---- budgets: per-placement Employee envelopes --------------------------------------------------------
-- A budget's parent is immutable (history: what was spent where never moves). An Employee's envelope follows
-- its placement: when a transfer or a promotion into the company-scoped CEO seat changes the parent level,
-- the old EMPLOYEE envelope is CLOSED (kept, with its spend, under its original ancestry) and a new one is
-- opened under the new parent. One OPEN envelope per Employee; every other scope stays strictly unique.
CREATE TEMP TABLE c4_copy_budgets AS SELECT * FROM main.budgets;
DROP TABLE main.budgets;
CREATE TABLE budgets (
  id                TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  scope             TEXT    NOT NULL CHECK (scope IN ('COMPANY', 'DEPARTMENT', 'EMPLOYEE', 'WORK_ITEM', 'RUN')),
  scope_id          TEXT    NOT NULL CHECK (length(scope_id) BETWEEN 1 AND 36),
  parent_id         TEXT             REFERENCES budgets (id) ON DELETE RESTRICT,
  currency          TEXT    NOT NULL CHECK (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
  cap_money         INTEGER NOT NULL CHECK (cap_money BETWEEN 0 AND 1000000000000000),
  cap_tokens        INTEGER NOT NULL CHECK (cap_tokens BETWEEN 0 AND 1000000000000),
  reserved_money    INTEGER NOT NULL DEFAULT 0 CHECK (reserved_money BETWEEN 0 AND 1000000000000000),
  reserved_tokens   INTEGER NOT NULL DEFAULT 0 CHECK (reserved_tokens BETWEEN 0 AND 1000000000000),
  spent_money       INTEGER NOT NULL DEFAULT 0 CHECK (spent_money BETWEEN 0 AND 1000000000000000),
  spent_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (spent_tokens BETWEEN 0 AND 1000000000000),
  overrun_money     INTEGER NOT NULL DEFAULT 0 CHECK (overrun_money BETWEEN 0 AND 1000000000000000),
  overrun_tokens    INTEGER NOT NULL DEFAULT 0 CHECK (overrun_tokens BETWEEN 0 AND 1000000000000),
  run_cap_money     INTEGER          CHECK (run_cap_money IS NULL OR run_cap_money BETWEEN 0 AND 1000000000000000),
  run_cap_tokens    INTEGER          CHECK (run_cap_tokens IS NULL OR run_cap_tokens BETWEEN 0 AND 1000000000000),
  version           INTEGER NOT NULL CHECK (version >= 1),
  created_by_ref    TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at        TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at        TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  status            TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  closed_at         TEXT             CHECK (closed_at IS NULL OR closed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  closed_reason     TEXT             CHECK (closed_reason IS NULL OR length(closed_reason) BETWEEN 1 AND 64),
  CHECK ((scope = 'COMPANY') = (parent_id IS NULL)),
  CHECK (reserved_money + spent_money <= cap_money + overrun_money),
  CHECK (reserved_tokens + spent_tokens <= cap_tokens + overrun_tokens),
  CHECK (scope = 'WORK_ITEM' OR (run_cap_money IS NULL AND run_cap_tokens IS NULL)),
  CHECK (status = 'OPEN' OR scope = 'EMPLOYEE'),
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL AND closed_reason IS NOT NULL))
) STRICT;
INSERT INTO budgets (id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, reserved_money, reserved_tokens, spent_money, spent_tokens, overrun_money, overrun_tokens, run_cap_money, run_cap_tokens, version, created_by_ref, created_at, updated_at, status, closed_at, closed_reason)
  SELECT id, scope, scope_id, parent_id, currency, cap_money, cap_tokens, reserved_money, reserved_tokens, spent_money, spent_tokens, overrun_money, overrun_tokens, run_cap_money, run_cap_tokens, version, created_by_ref, created_at, updated_at, 'OPEN', NULL, NULL FROM temp.c4_copy_budgets;
DROP TABLE temp.c4_copy_budgets;
CREATE UNIQUE INDEX budgets_one_per_scope ON budgets (scope, scope_id) WHERE scope <> 'EMPLOYEE' OR status = 'OPEN';
CREATE INDEX budgets_scope_lookup ON budgets (scope, scope_id);
CREATE INDEX budgets_parent ON budgets (parent_id);
CREATE TRIGGER budgets_identity_immutable BEFORE UPDATE ON budgets
WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.scope_id IS NOT OLD.scope_id OR NEW.parent_id IS NOT OLD.parent_id
  OR NEW.currency IS NOT OLD.currency OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version <> OLD.version + 1 OR NEW.spent_money < OLD.spent_money OR NEW.spent_tokens < OLD.spent_tokens
  OR NEW.overrun_money < OLD.overrun_money OR NEW.overrun_tokens < OLD.overrun_tokens
  OR (OLD.status = 'CLOSED' AND (NEW.status IS NOT 'CLOSED' OR NEW.closed_at IS NOT OLD.closed_at OR NEW.closed_reason IS NOT OLD.closed_reason OR NEW.cap_money IS NOT OLD.cap_money OR NEW.cap_tokens IS NOT OLD.cap_tokens))
BEGIN SELECT RAISE(ABORT, 'budget identity is immutable and spend is never reduced'); END;
CREATE TRIGGER budgets_no_delete BEFORE DELETE ON budgets BEGIN SELECT RAISE(ABORT, 'budgets are durable history'); END;

-- =====================================================================================================
-- 2. Positions (Stage 2 §2, Stage 10, D-R1-04): a durable seat, distinct from Employee identity, Role,
-- Department and authority. The CEO seat is COMPANY-scoped and reports to the Founder (a principal, never
-- an Employee); every Department has one Director seat. A title is a label: it grants nothing.
-- =====================================================================================================
CREATE TABLE org_positions (
  id                      TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code                    TEXT    NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 96 AND code NOT GLOB '*[^a-z0-9.-]*'),
  title                   TEXT    NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  scope                   TEXT    NOT NULL CHECK (scope IN ('COMPANY', 'DEPARTMENT')),
  department_id           TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  kind                    TEXT    NOT NULL CHECK (kind IN ('CEO', 'DIRECTOR', 'MANAGER', 'LEAD', 'SPECIALIST')),
  role_ref                TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*'),
  reports_to_position_id  TEXT             REFERENCES org_positions (id) ON DELETE RESTRICT,
  reports_to_founder      INTEGER NOT NULL CHECK (reports_to_founder IN (0, 1)),
  accountability_json     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(accountability_json) AND json_type(accountability_json) = 'array' AND length(accountability_json) <= 2048),
  status                  TEXT    NOT NULL CHECK (status IN ('PROPOSED', 'ACTIVE', 'PAUSED', 'RETIRED')),
  source                  TEXT    NOT NULL CHECK (source IN ('CANONICAL_MAP', 'STAFFING_REQUEST', 'FOUNDER')),
  staffing_request_id     TEXT             REFERENCES staffing_requests (id) ON DELETE RESTRICT,
  version                 INTEGER NOT NULL CHECK (version >= 1),
  created_by_ref          TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at              TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at              TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((scope = 'COMPANY') = (department_id IS NULL)),
  -- Founder → CEO → Directors: only the CEO seat reports to the Founder, and it always does.
  CHECK ((kind = 'CEO') = (reports_to_founder = 1)),
  CHECK (kind <> 'CEO' OR (scope = 'COMPANY' AND reports_to_position_id IS NULL)),
  CHECK (kind <> 'DIRECTOR' OR scope = 'DEPARTMENT'),
  CHECK (reports_to_founder = 1 OR reports_to_position_id IS NOT NULL),
  CHECK (reports_to_position_id IS NULL OR reports_to_position_id <> id),
  CHECK (source <> 'STAFFING_REQUEST' OR staffing_request_id IS NOT NULL)
) STRICT;
-- At most one live CEO seat and one live Director seat per Department (seats, not people; not authority).
CREATE UNIQUE INDEX org_positions_one_ceo ON org_positions (kind) WHERE kind = 'CEO' AND status <> 'RETIRED';
CREATE UNIQUE INDEX org_positions_one_director ON org_positions (department_id) WHERE kind = 'DIRECTOR' AND status <> 'RETIRED';
CREATE INDEX org_positions_department ON org_positions (department_id);
CREATE INDEX org_positions_reports_to ON org_positions (reports_to_position_id);
CREATE TRIGGER org_positions_no_delete BEFORE DELETE ON org_positions BEGIN SELECT RAISE(ABORT, 'positions are retired, never deleted'); END;
CREATE TRIGGER org_positions_identity_immutable BEFORE UPDATE ON org_positions
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.scope IS NOT OLD.scope OR NEW.department_id IS NOT OLD.department_id OR NEW.kind IS NOT OLD.kind
  OR NEW.reports_to_founder IS NOT OLD.reports_to_founder OR NEW.source IS NOT OLD.source OR NEW.staffing_request_id IS NOT OLD.staffing_request_id
  OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1 OR OLD.status = 'RETIRED'
BEGIN SELECT RAISE(ABORT, 'a position keeps its identity and scope; a retired position is history'); END;
-- The reporting line never cycles (checked in the transaction too; this is defence in depth).
CREATE TRIGGER org_positions_no_reporting_cycle BEFORE UPDATE OF reports_to_position_id ON org_positions
WHEN NEW.reports_to_position_id IS NOT NULL AND EXISTS (
  WITH RECURSIVE chain(id) AS (SELECT NEW.reports_to_position_id UNION SELECT q.reports_to_position_id FROM org_positions q JOIN chain ON q.id = chain.id WHERE q.reports_to_position_id IS NOT NULL)
  SELECT 1 FROM chain WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'a reporting line cannot cycle'); END;

CREATE TABLE org_position_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id  TEXT    NOT NULL REFERENCES org_positions (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  change_kind  TEXT    NOT NULL CHECK (change_kind IN ('CREATED', 'STATUS', 'REPORTING_LINE', 'TITLE', 'ROLE')),
  from_value   TEXT             CHECK (from_value IS NULL OR length(from_value) <= 161),
  to_value     TEXT             CHECK (to_value IS NULL OR length(to_value) <= 161),
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (position_id, version)
) STRICT;
CREATE TRIGGER org_position_history_append_only_u BEFORE UPDATE ON org_position_history BEGIN SELECT RAISE(ABORT, 'position history is append-only'); END;
CREATE TRIGGER org_position_history_append_only_d BEFORE DELETE ON org_position_history BEGIN SELECT RAISE(ABORT, 'position history is append-only'); END;

-- =====================================================================================================
-- 3. Department Charters (Stage 10 §4): durable, versioned; the budget envelope is a reference into the
-- existing budget engine (never a second one). BASELINE = release-seeded from Product authority; its
-- outcomes, measures, risks and budget envelope are completed by the Founder in a new version.
-- =====================================================================================================
CREATE TABLE department_charters (
  id                               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  department_id                    TEXT    NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  version                          INTEGER NOT NULL CHECK (version >= 1),
  status                           TEXT    NOT NULL CHECK (status IN ('BASELINE', 'ACTIVE', 'SUPERSEDED')),
  mission                          TEXT    NOT NULL CHECK (length(mission) BETWEEN 1 AND 2000),
  outcomes_json                    TEXT    NOT NULL CHECK (json_valid(outcomes_json) AND json_type(outcomes_json) = 'array' AND length(outcomes_json) <= 4096),
  scope_json                       TEXT    NOT NULL CHECK (json_valid(scope_json) AND json_type(scope_json) = 'array' AND length(scope_json) <= 8192),
  boundaries_json                  TEXT    NOT NULL CHECK (json_valid(boundaries_json) AND json_type(boundaries_json) = 'array' AND length(boundaries_json) <= 4096),
  director_position_id             TEXT    NOT NULL REFERENCES org_positions (id) ON DELETE RESTRICT,
  seats_json                       TEXT    NOT NULL CHECK (json_valid(seats_json) AND json_type(seats_json) = 'array' AND length(seats_json) <= 4096),
  recurring_responsibilities_json  TEXT    NOT NULL CHECK (json_valid(recurring_responsibilities_json) AND json_type(recurring_responsibilities_json) = 'array' AND length(recurring_responsibilities_json) <= 4096),
  dependencies_json                TEXT    NOT NULL CHECK (json_valid(dependencies_json) AND json_type(dependencies_json) = 'array' AND length(dependencies_json) <= 4096),
  budget_envelope_id               TEXT             REFERENCES budgets (id) ON DELETE RESTRICT,
  measures_json                    TEXT    NOT NULL CHECK (json_valid(measures_json) AND json_type(measures_json) = 'array' AND length(measures_json) <= 4096),
  risks_json                       TEXT    NOT NULL CHECK (json_valid(risks_json) AND json_type(risks_json) = 'array' AND length(risks_json) <= 4096),
  source                           TEXT    NOT NULL CHECK (source IN ('PRODUCT_AUTHORITY', 'FOUNDER')),
  effective_from                   TEXT    NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  effective_to                     TEXT             CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  created_by_ref                   TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at                       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (department_id, version),
  CHECK ((status = 'SUPERSEDED') = (effective_to IS NOT NULL)),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
) STRICT;
CREATE UNIQUE INDEX department_charters_one_current ON department_charters (department_id) WHERE status IN ('BASELINE', 'ACTIVE');
CREATE TRIGGER department_charters_no_delete BEFORE DELETE ON department_charters BEGIN SELECT RAISE(ABORT, 'charters are durable history'); END;
CREATE TRIGGER department_charters_supersede_only BEFORE UPDATE ON department_charters
WHEN NEW.id IS NOT OLD.id OR NEW.department_id IS NOT OLD.department_id OR NEW.version IS NOT OLD.version OR NEW.mission IS NOT OLD.mission
  OR NEW.outcomes_json IS NOT OLD.outcomes_json OR NEW.scope_json IS NOT OLD.scope_json OR NEW.boundaries_json IS NOT OLD.boundaries_json
  OR NEW.director_position_id IS NOT OLD.director_position_id OR NEW.seats_json IS NOT OLD.seats_json OR NEW.recurring_responsibilities_json IS NOT OLD.recurring_responsibilities_json
  OR NEW.dependencies_json IS NOT OLD.dependencies_json OR NEW.budget_envelope_id IS NOT OLD.budget_envelope_id OR NEW.measures_json IS NOT OLD.measures_json
  OR NEW.risks_json IS NOT OLD.risks_json OR NEW.source IS NOT OLD.source OR NEW.effective_from IS NOT OLD.effective_from OR NEW.created_at IS NOT OLD.created_at
  OR OLD.status = 'SUPERSEDED' OR NEW.status <> 'SUPERSEDED'
BEGIN SELECT RAISE(ABORT, 'a charter version is immutable; a new version supersedes it'); END;

-- =====================================================================================================
-- 4. Effective-dated Position Assignments (Stage 2 §2, Stage 4 §9/§13, Stage 10 §24/§25). Canonical
-- organization truth: who held which seat, when, as PRIMARY (permanent) or ACTING (explicit, time-bounded
-- coverage that copies no identity, memory or authority). History is never rewritten: an ended row keeps
-- its effective range. "Holder of a seat at T" = a valid ACTING assignment at T, else the PRIMARY one.
-- =====================================================================================================
CREATE TABLE position_assignments (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  position_id         TEXT    NOT NULL REFERENCES org_positions (id) ON DELETE RESTRICT,
  employee_id         TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  kind                TEXT    NOT NULL CHECK (kind IN ('PRIMARY', 'ACTING')),
  status              TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'ENDED', 'EXPIRED')),
  effective_from      TEXT    NOT NULL CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  -- ACTING: the bounded end is planned up front (calendar seam) and never extended in place.
  planned_to          TEXT             CHECK (planned_to IS NULL OR planned_to GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  effective_to        TEXT             CHECK (effective_to IS NULL OR effective_to GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  acting_scope_json   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(acting_scope_json) AND json_type(acting_scope_json) = 'array' AND length(acting_scope_json) <= 1024),
  covers_employee_id  TEXT             REFERENCES employees (id) ON DELETE RESTRICT,
  reason_code         TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  end_reason_code     TEXT             CHECK (end_reason_code IS NULL OR length(end_reason_code) BETWEEN 1 AND 64),
  decided_by_ref      TEXT    NOT NULL CHECK (length(decided_by_ref) BETWEEN 3 AND 161),
  authority_ref       TEXT             CHECK (authority_ref IS NULL OR length(authority_ref) BETWEEN 3 AND 161),
  version             INTEGER NOT NULL CHECK (version >= 1),
  created_at          TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at          TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((kind = 'ACTING') = (planned_to IS NOT NULL)),
  CHECK (planned_to IS NULL OR planned_to > effective_from),
  CHECK (kind <> 'ACTING' OR effective_to IS NOT NULL),
  CHECK (kind <> 'PRIMARY' OR covers_employee_id IS NULL),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (status = 'ACTIVE' OR (effective_to IS NOT NULL AND end_reason_code IS NOT NULL)),
  CHECK (status <> 'ACTIVE' OR end_reason_code IS NULL),
  CHECK (covers_employee_id IS NULL OR covers_employee_id <> employee_id)
) STRICT;
CREATE UNIQUE INDEX position_assignments_one_primary_per_seat ON position_assignments (position_id) WHERE kind = 'PRIMARY' AND status = 'ACTIVE';
CREATE UNIQUE INDEX position_assignments_one_acting_per_seat ON position_assignments (position_id) WHERE kind = 'ACTING' AND status = 'ACTIVE';
CREATE UNIQUE INDEX position_assignments_one_primary_per_employee ON position_assignments (employee_id) WHERE kind = 'PRIMARY' AND status = 'ACTIVE';
CREATE INDEX position_assignments_seat_time ON position_assignments (position_id, effective_from);
CREATE INDEX position_assignments_employee_time ON position_assignments (employee_id, effective_from);
-- Acting coverage past its planned end is found without a scan (materialized at run start / recovery).
CREATE INDEX position_assignments_acting_due ON position_assignments (planned_to) WHERE kind = 'ACTING' AND status = 'ACTIVE';
CREATE TRIGGER position_assignments_no_delete BEFORE DELETE ON position_assignments BEGIN SELECT RAISE(ABORT, 'assignments are durable history'); END;
CREATE TRIGGER position_assignments_history_immutable BEFORE UPDATE ON position_assignments
WHEN NEW.id IS NOT OLD.id OR NEW.position_id IS NOT OLD.position_id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.kind IS NOT OLD.kind
  OR NEW.effective_from IS NOT OLD.effective_from OR NEW.planned_to IS NOT OLD.planned_to OR NEW.acting_scope_json IS NOT OLD.acting_scope_json
  OR NEW.covers_employee_id IS NOT OLD.covers_employee_id OR NEW.reason_code IS NOT OLD.reason_code OR NEW.decided_by_ref IS NOT OLD.decided_by_ref
  OR NEW.authority_ref IS NOT OLD.authority_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR OLD.status <> 'ACTIVE' OR NEW.status = 'ACTIVE'
  OR (OLD.effective_to IS NOT NULL AND NEW.effective_to > OLD.effective_to)
BEGIN SELECT RAISE(ABORT, 'an assignment only ends (never extends or reopens); ended assignments are history'); END;
-- Only a live seat is assigned; a retired Employee holds no seat.
CREATE TRIGGER position_assignments_live_seat BEFORE INSERT ON position_assignments
WHEN (SELECT status FROM org_positions WHERE id = NEW.position_id) IS NOT 'ACTIVE'
  OR (SELECT state FROM employees WHERE id = NEW.employee_id) IS 'RETIRED'
BEGIN SELECT RAISE(ABORT, 'only an ACTIVE position can be assigned, and never to a retired employee'); END;

CREATE TABLE position_assignment_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id  TEXT    NOT NULL REFERENCES position_assignments (id) ON DELETE RESTRICT,
  version        INTEGER NOT NULL CHECK (version >= 1),
  from_status    TEXT,
  to_status      TEXT    NOT NULL,
  reason_code    TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref      TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at    TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (assignment_id, version)
) STRICT;
CREATE TRIGGER position_assignment_history_append_only_u BEFORE UPDATE ON position_assignment_history BEGIN SELECT RAISE(ABORT, 'assignment history is append-only'); END;
CREATE TRIGGER position_assignment_history_append_only_d BEFORE DELETE ON position_assignment_history BEGIN SELECT RAISE(ABORT, 'assignment history is append-only'); END;

-- =====================================================================================================
-- 5. Staffing Requests (Stage 10 §21/§22, D-R1-04/06). A request is evidence and a proposal — never
-- hiring authority. Directors file; the CEO challenges / returns / prioritizes / consolidates / recommends;
-- the Founder decides (or the CEO within an explicit, capped delegation grant). No Employee becomes ACTIVE
-- through a request: a hire is a CANDIDATE that still follows the Academy lifecycle.
-- =====================================================================================================
CREATE TABLE staffing_requests (
  id                         TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  scope                      TEXT    NOT NULL CHECK (scope IN ('COMPANY', 'DEPARTMENT')),
  department_id              TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  requested_by_employee_id   TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  requested_by_position_id   TEXT    NOT NULL REFERENCES org_positions (id) ON DELETE RESTRICT,
  requested_run_id           TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  role_ref                   TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 6 AND 161 AND role_ref GLOB 'role:*'),
  position_kind              TEXT    NOT NULL CHECK (position_kind IN ('MANAGER', 'LEAD', 'SPECIALIST')),
  position_title             TEXT    NOT NULL CHECK (length(position_title) BETWEEN 1 AND 120),
  -- Business evidence (local governed content: never copied into audit, events or logs — Rule A).
  business_need              TEXT    NOT NULL CHECK (length(business_need) BETWEEN 1 AND 2000),
  workload_evidence          TEXT    NOT NULL CHECK (length(workload_evidence) BETWEEN 1 AND 2000),
  skill_gap                  TEXT    NOT NULL CHECK (length(skill_gap) BETWEEN 1 AND 2000),
  expected_value             TEXT    NOT NULL CHECK (length(expected_value) BETWEEN 1 AND 2000),
  impact_if_not_staffed      TEXT    NOT NULL CHECK (length(impact_if_not_staffed) BETWEEN 1 AND 2000),
  -- Stage 10 §22: redistribute → training → automate → temporary specialist → persistent employee.
  alternatives_json          TEXT    NOT NULL CHECK (json_valid(alternatives_json) AND json_type(alternatives_json) = 'object' AND length(alternatives_json) <= 4096),
  expected_cost_micros       INTEGER          CHECK (expected_cost_micros IS NULL OR expected_cost_micros BETWEEN 0 AND 1000000000000000),
  priority                   INTEGER          CHECK (priority IS NULL OR priority BETWEEN 0 AND 100),
  state                      TEXT    NOT NULL CHECK (state IN ('SUBMITTED', 'CHALLENGED', 'RETURNED_FOR_EVIDENCE', 'PRIORITIZED', 'RECOMMENDED', 'CONSOLIDATED', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  ceo_recommendation         TEXT             CHECK (ceo_recommendation IS NULL OR ceo_recommendation IN ('APPROVE', 'REJECT')),
  ceo_note                   TEXT             CHECK (ceo_note IS NULL OR length(ceo_note) BETWEEN 1 AND 2000),
  consolidated_into_id       TEXT             REFERENCES staffing_requests (id) ON DELETE RESTRICT,
  decided_by_ref             TEXT             CHECK (decided_by_ref IS NULL OR length(decided_by_ref) BETWEEN 3 AND 161),
  decision_authority_ref     TEXT             CHECK (decision_authority_ref IS NULL OR length(decision_authority_ref) BETWEEN 3 AND 161),
  approved_position_id       TEXT             REFERENCES org_positions (id) ON DELETE RESTRICT,
  hired_employee_id          TEXT             REFERENCES employees (id) ON DELETE RESTRICT,
  decision_due_at            TEXT             CHECK (decision_due_at IS NULL OR decision_due_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_at                 TEXT             CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  version                    INTEGER NOT NULL CHECK (version >= 1),
  created_at                 TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at                 TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((scope = 'COMPANY') = (department_id IS NULL)),
  CHECK ((state IN ('APPROVED', 'REJECTED')) = (decided_by_ref IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (state <> 'APPROVED' OR approved_position_id IS NOT NULL),
  CHECK ((state = 'CONSOLIDATED') = (consolidated_into_id IS NOT NULL)),
  CHECK (consolidated_into_id IS NULL OR consolidated_into_id <> id),
  CHECK (hired_employee_id IS NULL OR state = 'APPROVED')
) STRICT;
CREATE INDEX staffing_requests_state ON staffing_requests (state);
CREATE TRIGGER staffing_requests_no_delete BEFORE DELETE ON staffing_requests BEGIN SELECT RAISE(ABORT, 'staffing requests are durable history'); END;
CREATE TRIGGER staffing_requests_evidence_immutable BEFORE UPDATE ON staffing_requests
WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.department_id IS NOT OLD.department_id OR NEW.requested_by_employee_id IS NOT OLD.requested_by_employee_id
  OR NEW.requested_by_position_id IS NOT OLD.requested_by_position_id OR NEW.requested_run_id IS NOT OLD.requested_run_id OR NEW.role_ref IS NOT OLD.role_ref
  OR NEW.position_kind IS NOT OLD.position_kind OR NEW.position_title IS NOT OLD.position_title OR NEW.business_need IS NOT OLD.business_need
  OR NEW.workload_evidence IS NOT OLD.workload_evidence OR NEW.skill_gap IS NOT OLD.skill_gap OR NEW.expected_value IS NOT OLD.expected_value
  OR NEW.impact_if_not_staffed IS NOT OLD.impact_if_not_staffed OR NEW.alternatives_json IS NOT OLD.alternatives_json OR NEW.expected_cost_micros IS NOT OLD.expected_cost_micros
  OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR (OLD.state IN ('REJECTED', 'WITHDRAWN', 'CONSOLIDATED'))
  OR (OLD.state = 'APPROVED' AND (NEW.state <> 'APPROVED' OR OLD.hired_employee_id IS NOT NULL OR NEW.approved_position_id IS NOT OLD.approved_position_id OR NEW.decided_by_ref IS NOT OLD.decided_by_ref))
BEGIN SELECT RAISE(ABORT, 'a staffing request''s evidence is immutable; a decided request is history (a hire is recorded once)'); END;

CREATE TABLE staffing_request_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id   TEXT    NOT NULL REFERENCES staffing_requests (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT,
  to_state     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (request_id, version)
) STRICT;
CREATE TRIGGER staffing_request_history_append_only_u BEFORE UPDATE ON staffing_request_history BEGIN SELECT RAISE(ABORT, 'staffing request history is append-only'); END;
CREATE TRIGGER staffing_request_history_append_only_d BEFORE DELETE ON staffing_request_history BEGIN SELECT RAISE(ABORT, 'staffing request history is append-only'); END;

-- =====================================================================================================
-- 6. Authority delegation (Stage 3 §3, D-R1-04, D14-C). The enforcement object is the existing explicit
-- permission grant (default deny, scoped, capped by max_uses, expiring, revocable); this record carries the
-- delegation's purpose and policy limits. In C4 authority is delegated by the Founder only: an Employee
-- cannot delegate (and therefore cannot self-escalate). R2 / R4 remain ungrantable (0004 CHECK).
-- =====================================================================================================
CREATE TABLE authority_delegations (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  grant_id              TEXT    NOT NULL UNIQUE REFERENCES permission_grants (id) ON DELETE RESTRICT,
  delegator_ref         TEXT    NOT NULL CHECK (delegator_ref GLOB 'founder:*'),
  delegate_employee_id  TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  purpose_code          TEXT    NOT NULL CHECK (length(purpose_code) BETWEEN 1 AND 64),
  limits_json           TEXT    NOT NULL CHECK (json_valid(limits_json) AND json_type(limits_json) = 'object' AND length(limits_json) <= 2048),
  acting_assignment_id  TEXT             REFERENCES position_assignments (id) ON DELETE RESTRICT,
  status                TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  reason_code           TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  revoked_by_ref        TEXT             CHECK (revoked_by_ref IS NULL OR length(revoked_by_ref) BETWEEN 3 AND 161),
  revoked_at            TEXT             CHECK (revoked_at IS NULL OR revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
) STRICT;
CREATE TRIGGER authority_delegations_no_delete BEFORE DELETE ON authority_delegations BEGIN SELECT RAISE(ABORT, 'delegations are revoked, never deleted'); END;
CREATE TRIGGER authority_delegations_scope_immutable BEFORE UPDATE ON authority_delegations
WHEN NEW.id IS NOT OLD.id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.delegator_ref IS NOT OLD.delegator_ref OR NEW.delegate_employee_id IS NOT OLD.delegate_employee_id
  OR NEW.purpose_code IS NOT OLD.purpose_code OR NEW.limits_json IS NOT OLD.limits_json OR NEW.acting_assignment_id IS NOT OLD.acting_assignment_id
  OR NEW.created_at IS NOT OLD.created_at OR OLD.status = 'REVOKED'
BEGIN SELECT RAISE(ABORT, 'a delegation''s scope is immutable; a revoked delegation is history'); END;

-- =====================================================================================================
-- 7. Work delegation, cross-department support and handoff (Stage 8 §20–§29, Stage 9 §8). The child is an
-- ordinary C1 Work Item in the parent's lineage (no second task graph); accountability stays with the root
-- owner; a support request changes no reporting line, grants no authority and creates no budget (the child
-- runs under the delegate's existing envelope, capped by the parent Work Item's cap).
-- =====================================================================================================
CREATE TABLE work_delegations (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  kind                   TEXT    NOT NULL CHECK (kind IN ('DELEGATION', 'SUPPORT')),
  parent_work_item_id    TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  child_work_item_id     TEXT    NOT NULL UNIQUE REFERENCES work_items (id) ON DELETE RESTRICT,
  root_work_item_id      TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  delegator_employee_id  TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  delegate_employee_id   TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  accountable_owner_ref  TEXT    NOT NULL CHECK (length(accountable_owner_ref) BETWEEN 3 AND 161),
  source_department_id   TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  target_department_id   TEXT             REFERENCES departments (id) ON DELETE RESTRICT,
  depth                  INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 8),
  state                  TEXT    NOT NULL CHECK (state IN ('OFFERED', 'ACCEPTED', 'CLARIFICATION_REQUESTED', 'ESCALATED', 'REFUSED', 'CANCELLED', 'SUPERSEDED', 'COMPLETED', 'FAILED')),
  response_reason_code   TEXT             CHECK (response_reason_code IS NULL OR length(response_reason_code) BETWEEN 1 AND 64),
  accepted_run_id        TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  budget_cap_money       INTEGER NOT NULL CHECK (budget_cap_money BETWEEN 0 AND 1000000000000000),
  budget_cap_tokens      INTEGER NOT NULL CHECK (budget_cap_tokens BETWEEN 0 AND 1000000000000),
  due_at                 TEXT             CHECK (due_at IS NULL OR due_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  created_run_id         TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  version                INTEGER NOT NULL CHECK (version >= 1),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at             TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (delegator_employee_id <> delegate_employee_id),
  CHECK (parent_work_item_id <> child_work_item_id),
  CHECK (kind <> 'SUPPORT' OR (target_department_id IS NOT NULL AND (source_department_id IS NULL OR source_department_id <> target_department_id)))
) STRICT;
CREATE INDEX work_delegations_parent ON work_delegations (parent_work_item_id);
CREATE INDEX work_delegations_root ON work_delegations (root_work_item_id);
CREATE INDEX work_delegations_state ON work_delegations (state);
CREATE TRIGGER work_delegations_no_delete BEFORE DELETE ON work_delegations BEGIN SELECT RAISE(ABORT, 'delegations are durable history'); END;
CREATE TRIGGER work_delegations_identity_immutable BEFORE UPDATE ON work_delegations
WHEN NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind OR NEW.parent_work_item_id IS NOT OLD.parent_work_item_id OR NEW.child_work_item_id IS NOT OLD.child_work_item_id
  OR NEW.root_work_item_id IS NOT OLD.root_work_item_id OR NEW.delegator_employee_id IS NOT OLD.delegator_employee_id OR NEW.delegate_employee_id IS NOT OLD.delegate_employee_id
  OR NEW.accountable_owner_ref IS NOT OLD.accountable_owner_ref OR NEW.depth IS NOT OLD.depth OR NEW.budget_cap_money IS NOT OLD.budget_cap_money
  OR NEW.budget_cap_tokens IS NOT OLD.budget_cap_tokens OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR OLD.state IN ('REFUSED', 'CANCELLED', 'SUPERSEDED', 'COMPLETED', 'FAILED')
BEGIN SELECT RAISE(ABORT, 'a delegation''s scope, lineage and accountability are immutable; a closed delegation is history'); END;

CREATE TABLE work_delegation_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id  TEXT    NOT NULL REFERENCES work_delegations (id) ON DELETE RESTRICT,
  version        INTEGER NOT NULL CHECK (version >= 1),
  from_state     TEXT,
  to_state       TEXT    NOT NULL,
  reason_code    TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref      TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at    TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (delegation_id, version)
) STRICT;
CREATE TRIGGER work_delegation_history_append_only_u BEFORE UPDATE ON work_delegation_history BEGIN SELECT RAISE(ABORT, 'delegation history is append-only'); END;
CREATE TRIGGER work_delegation_history_append_only_d BEFORE DELETE ON work_delegation_history BEGIN SELECT RAISE(ABORT, 'delegation history is append-only'); END;

-- Handoff messages (Stage 8 §22/§23): the clarification request, clarification, refusal or escalation reason
-- exchanged on one handoff. Local governed business content — it reaches only the two parties' governed
-- context (never audit, events or logs, Rule A); append-only, integrity-hashed, classified.
CREATE TABLE handoff_messages (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  delegation_id       TEXT    NOT NULL REFERENCES work_delegations (id) ON DELETE RESTRICT,
  kind                TEXT    NOT NULL CHECK (kind IN ('CLARIFICATION_REQUEST', 'CLARIFICATION', 'REFUSAL', 'ESCALATION', 'REPRIORITIZATION')),
  author_employee_id  TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  run_id              TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  body                TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  body_sha256         TEXT    NOT NULL CHECK (length(body_sha256) = 64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'),
  data_class          TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  created_at          TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX handoff_messages_delegation ON handoff_messages (delegation_id, created_at);
CREATE TRIGGER handoff_messages_append_only_u BEFORE UPDATE ON handoff_messages BEGIN SELECT RAISE(ABORT, 'handoff messages are append-only'); END;
CREATE TRIGGER handoff_messages_append_only_d BEFORE DELETE ON handoff_messages BEGIN SELECT RAISE(ABORT, 'handoff messages are append-only'); END;

-- Cancellation / supersession / completion of the child is reflected in its delegation in the SAME
-- transaction as the Work Item change, whatever path made it (C1 propagation included): an open handoff can
-- never silently outlive its work (Stage 8 §23, §42).
CREATE TRIGGER work_delegations_follow_child AFTER UPDATE OF state ON work_items
WHEN NEW.state IS NOT OLD.state AND NEW.state IN ('CANCELLED', 'SUPERSEDED', 'FAILED', 'COMPLETED', 'WAITING_REVIEW', 'REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED')
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

-- =====================================================================================================
-- 8. Organization acts of Employees (D-C4-04): idempotent per Work Item and Work-Item-global step, like
-- tool intents (a resumed run replays the recorded outcome, never repeats the act).
-- =====================================================================================================
CREATE TABLE org_act_records (
  work_item_id  TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  step          INTEGER NOT NULL CHECK (step BETWEEN 0 AND 100000),
  run_id        TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  employee_id   TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  action        TEXT    NOT NULL CHECK (length(action) BETWEEN 1 AND 64),
  args_sha256   TEXT    NOT NULL CHECK (length(args_sha256) = 64),
  outcome       TEXT    NOT NULL CHECK (outcome IN ('DONE', 'REFUSED', 'WAIT')),
  result_code   TEXT    NOT NULL CHECK (length(result_code) BETWEEN 1 AND 64),
  result_ref    TEXT             CHECK (result_ref IS NULL OR length(result_ref) BETWEEN 3 AND 161),
  created_at    TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (work_item_id, step)
) STRICT, WITHOUT ROWID;
CREATE TRIGGER org_act_records_append_only_u BEFORE UPDATE ON org_act_records BEGIN SELECT RAISE(ABORT, 'organization act records are append-only'); END;
CREATE TRIGGER org_act_records_append_only_d BEFORE DELETE ON org_act_records BEGIN SELECT RAISE(ABORT, 'organization act records are append-only'); END;

-- =====================================================================================================
-- 9. Time-correct organization attribution of every governed run (Stage 17 / C6 seam): who the Employee
-- was, organizationally, when the run began. Immutable: later organization changes never rewrite it.
-- =====================================================================================================
CREATE TABLE run_org_snapshots (
  run_id                TEXT NOT NULL PRIMARY KEY REFERENCES runs (id) ON DELETE RESTRICT,
  employee_id           TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  org_scope             TEXT NOT NULL CHECK (org_scope IN ('COMPANY', 'DEPARTMENT')),
  department_id         TEXT          REFERENCES departments (id) ON DELETE RESTRICT,
  position_id           TEXT          REFERENCES org_positions (id) ON DELETE RESTRICT,
  assignment_id         TEXT          REFERENCES position_assignments (id) ON DELETE RESTRICT,
  assignment_kind       TEXT          CHECK (assignment_kind IS NULL OR assignment_kind IN ('PRIMARY', 'ACTING')),
  manager_ref           TEXT NOT NULL CHECK (length(manager_ref) BETWEEN 3 AND 161),
  director_employee_id  TEXT          REFERENCES employees (id) ON DELETE RESTRICT,
  ceo_employee_id       TEXT          REFERENCES employees (id) ON DELETE RESTRICT,
  source                TEXT NOT NULL CHECK (source IN ('ASSIGNMENT', 'LEGACY_PROJECTION')),
  captured_at           TEXT NOT NULL CHECK (captured_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((org_scope = 'DEPARTMENT') = (department_id IS NOT NULL)),
  CHECK ((source = 'ASSIGNMENT') = (assignment_id IS NOT NULL AND position_id IS NOT NULL AND assignment_kind IS NOT NULL))
) STRICT, WITHOUT ROWID;
CREATE INDEX run_org_snapshots_employee ON run_org_snapshots (employee_id);
CREATE INDEX run_org_snapshots_department ON run_org_snapshots (department_id);
CREATE TRIGGER run_org_snapshots_immutable_u BEFORE UPDATE ON run_org_snapshots BEGIN SELECT RAISE(ABORT, 'a run organization snapshot is immutable'); END;
CREATE TRIGGER run_org_snapshots_immutable_d BEFORE DELETE ON run_org_snapshots BEGIN SELECT RAISE(ABORT, 'a run organization snapshot is immutable'); END;

-- =====================================================================================================
-- 10. P-07 (D-R1-03): a deployment that produced a charged (or possibly billed) failed model-call attempt
-- for a Work Item is not selected again for that Work Item automatically. A later use needs an explicit,
-- evidenced Founder release for exactly that Work Item and deployment. A release covers exactly the charged /
-- possibly billed attempts that existed when it was recorded (covered_failures): any later one excludes again.
-- (A count, not a timestamp: two events in one millisecond can never make a release cover the future.)
-- =====================================================================================================
CREATE TABLE charged_exclusion_releases (
  id               TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id     TEXT NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  deployment_id    TEXT NOT NULL REFERENCES deployments (id) ON DELETE RESTRICT,
  covered_failures INTEGER NOT NULL CHECK (covered_failures >= 1),
  released_by_ref  TEXT NOT NULL CHECK (released_by_ref GLOB 'founder:*'),
  reason_code      TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  evidence_ref     TEXT NOT NULL CHECK (length(evidence_ref) BETWEEN 3 AND 200),
  created_at       TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX charged_exclusion_releases_pair ON charged_exclusion_releases (work_item_id, deployment_id, created_at);
CREATE TRIGGER charged_exclusion_releases_append_only_u BEFORE UPDATE ON charged_exclusion_releases BEGIN SELECT RAISE(ABORT, 'exclusion releases are append-only'); END;
CREATE TRIGGER charged_exclusion_releases_append_only_d BEFORE DELETE ON charged_exclusion_releases BEGIN SELECT RAISE(ABORT, 'exclusion releases are append-only'); END;

-- =====================================================================================================
-- 11. Canonical Strong-v1 organization skeleton (release-owned seed of Product authority only):
-- Stage 10 §9 + D-R1-05 Department Map (Strategic Market Intelligence, Growth, Brand & Creative, Product,
-- Engineering), one Director seat per Department (Stage 10 §5), the company-scoped CEO seat under the
-- Founder (D-R1-04), and the Product App Store Release & Reputation Lead seat (Stage 10 §10). No Employee,
-- no headcount, no name, no budget, no authority is seeded: seats are vacant until the Founder assigns
-- them. An existing Department with a canonical code (created under C2) is adopted, not duplicated.
-- Baseline instant: the Stage 10 closure date.
-- =====================================================================================================
INSERT INTO departments (id, code, name, status, created_at, updated_at)
  SELECT 'c4d00000-0000-4000-8000-000000000001', 'strategic-market-intelligence', 'Strategic Market Intelligence', 'ACTIVE', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z'
   WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'strategic-market-intelligence');
INSERT INTO departments (id, code, name, status, created_at, updated_at)
  SELECT 'c4d00000-0000-4000-8000-000000000002', 'growth', 'Growth', 'ACTIVE', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z'
   WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'growth');
INSERT INTO departments (id, code, name, status, created_at, updated_at)
  SELECT 'c4d00000-0000-4000-8000-000000000003', 'brand-creative', 'Brand & Creative', 'ACTIVE', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z'
   WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'brand-creative');
INSERT INTO departments (id, code, name, status, created_at, updated_at)
  SELECT 'c4d00000-0000-4000-8000-000000000004', 'product', 'Product', 'ACTIVE', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z'
   WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'product');
INSERT INTO departments (id, code, name, status, created_at, updated_at)
  SELECT 'c4d00000-0000-4000-8000-000000000005', 'engineering', 'Engineering', 'ACTIVE', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z'
   WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'engineering');

-- The CEO seat: company-scoped, reports to the Founder (D-R1-04). Its holder is onboarded later through a
-- Founder-authorized flow; C4 invents no CEO identity, persona, model or profile.
INSERT INTO org_positions (id, code, title, scope, department_id, kind, role_ref, reports_to_position_id, reports_to_founder, accountability_json, status, source, version, created_by_ref, created_at, updated_at)
VALUES ('c4e00000-0000-4000-8000-000000000001', 'company.ceo', 'Chief Executive Officer', 'COMPANY', NULL, 'CEO', 'role:company.ceo', NULL, 1,
        '["company-level synthesis and coordination under the Founder","receives Department reports and requests","challenges priorities and staffing requests","brings decision-ready proposals to the Founder"]',
        'ACTIVE', 'CANONICAL_MAP', 1, 'system:release-c4', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z');

-- One Director seat per canonical Department, reporting to the CEO seat (Stage 10 §5; D-R1-04).
INSERT INTO org_positions (id, code, title, scope, department_id, kind, role_ref, reports_to_position_id, reports_to_founder, accountability_json, status, source, version, created_by_ref, created_at, updated_at)
SELECT s.id, s.code, s.title, 'DEPARTMENT', (SELECT d.id FROM departments d WHERE d.code = s.dept), 'DIRECTOR', s.role, 'c4e00000-0000-4000-8000-000000000001', 0,
       '["goals","priorities","quality","team capacity","risk","budget discipline","staff development","work allocation","cross-department coordination","final department-level synthesis"]',
       'ACTIVE', 'CANONICAL_MAP', 1, 'system:release-c4', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z'
  FROM (SELECT 'c4e00000-0000-4000-8000-000000000011' AS id, 'director.strategic-market-intelligence' AS code, 'Strategic Market Intelligence Director' AS title, 'strategic-market-intelligence' AS dept, 'role:director.strategic-market-intelligence' AS role
        UNION ALL SELECT 'c4e00000-0000-4000-8000-000000000012', 'director.growth', 'Growth Director', 'growth', 'role:director.growth'
        UNION ALL SELECT 'c4e00000-0000-4000-8000-000000000013', 'director.brand-creative', 'Brand & Creative Director', 'brand-creative', 'role:director.brand-creative'
        UNION ALL SELECT 'c4e00000-0000-4000-8000-000000000014', 'director.product', 'Product Director', 'product', 'role:director.product'
        UNION ALL SELECT 'c4e00000-0000-4000-8000-000000000015', 'director.engineering', 'Engineering Director', 'engineering', 'role:director.engineering') AS s;

-- Stage 10 §10: the persistent pre-launch App Store Release & Reputation Lead role within Product.
INSERT INTO org_positions (id, code, title, scope, department_id, kind, role_ref, reports_to_position_id, reports_to_founder, accountability_json, status, source, version, created_by_ref, created_at, updated_at)
VALUES ('c4e00000-0000-4000-8000-000000000021', 'product.app-store-release-reputation-lead', 'App Store Release & Reputation Lead', 'DEPARTMENT',
        (SELECT id FROM departments WHERE code = 'product'), 'LEAD', 'role:product.app-store-release-reputation-lead', 'c4e00000-0000-4000-8000-000000000014', 0,
        '["store policy and compliance readiness","submission requirements","metadata and readiness review","privacy, permission and declaration coordination","release submission coordination","rejection-risk identification and follow-up","ratings and review monitoring","review-response coordination","reputation analysis","feedback escalation to Product and Engineering","store listing quality and conversion collaboration","responsible rating-request strategy (never prohibited review practices)"]',
        'ACTIVE', 'CANONICAL_MAP', 1, 'system:release-c4', '2026-09-26T00:00:00.000Z', '2026-09-26T00:00:00.000Z');

INSERT INTO org_position_history (position_id, version, change_kind, from_value, to_value, reason_code, actor_ref, occurred_at)
  SELECT id, 1, 'CREATED', NULL, status, 'canonical.map', 'system:release-c4', created_at FROM org_positions WHERE source = 'CANONICAL_MAP';

-- Baseline Charters: mission / scope / boundaries from Stage 10 §9–§12 and D-R1-05 (Engineering). Outcomes,
-- measures, risks and the budget envelope are not decided by Product authority yet: they stay empty for the
-- Founder to complete in a new version. No headcount, no seat count.
INSERT INTO department_charters (id, department_id, version, status, mission, outcomes_json, scope_json, boundaries_json, director_position_id, seats_json, recurring_responsibilities_json, dependencies_json, budget_envelope_id, measures_json, risks_json, source, effective_from, effective_to, created_by_ref, created_at)
SELECT c.id, (SELECT d.id FROM departments d WHERE d.code = c.dept), 1, 'BASELINE', c.mission, '[]', c.scope, c.boundaries,
       (SELECT p.id FROM org_positions p WHERE p.code = 'director.' || c.dept), c.seats, '[]', c.deps, NULL, '[]', '[]', 'PRODUCT_AUTHORITY',
       '2026-09-26T00:00:00.000Z', NULL, 'system:release-c4', '2026-09-26T00:00:00.000Z'
  FROM (
    SELECT 'c4c00000-0000-4000-8000-000000000001' AS id, 'strategic-market-intelligence' AS dept,
           'Independent strategic function for market, competitive and consumer intelligence, market entry and strategic challenge (Stage 10 section 9.1).' AS mission,
           '["market intelligence","competitive intelligence","consumer behavior","opportunity and threat analysis","market entry","strategic challenge","interpretation of Founder ideas and assumptions","Egypt / Saudi / Arab competence with global expansion capability"]' AS scope,
           '["independent strategic function, not subordinate to Growth","its Director may have a direct strategic relationship with the Founder"]' AS boundaries,
           '["director.strategic-market-intelligence"]' AS seats, '[]' AS deps
    UNION ALL SELECT 'c4c00000-0000-4000-8000-000000000002', 'growth',
           'Acquisition, growth experiments, SEO, channel performance, funnel and conversion, launch growth and growth analytics (Stage 10 section 9.2).',
           '["acquisition","growth experiments","SEO as a dedicated specialist capability or role","channel performance","funnel and conversion","launch growth","growth analytics"]',
           '["independent from Brand & Creative","strategic market intelligence belongs to Strategic Market Intelligence"]',
           '["director.growth"]', '[]'
    UNION ALL SELECT 'c4c00000-0000-4000-8000-000000000003', 'brand-creative',
           'Brand strategy, messaging, creative direction, visual design, content and copy, campaign creative, video / motion / short-form production and brand consistency (Stage 10 section 9.3).',
           '["brand strategy","messaging","creative direction","visual design","content and copy","campaign creative","video, motion and short-form production","brand consistency"]',
           '["independent from Growth","creative tooling (e.g. video editing) is subject to Tool policy"]',
           '["director.brand-creative"]', '[]'
    UNION ALL SELECT 'c4c00000-0000-4000-8000-000000000004', 'product',
           'Product intelligence, usage and feedback synthesis, product and competitor-product research, product recommendations and release / store-readiness coordination (Stage 10 section 9.4, section 10).',
           '["product intelligence","product, usage and feedback synthesis","product research","competitor-product research","product recommendations","release and store-readiness coordination"]',
           '["the Founder remains final Product Authority initially"]',
           '["director.product","product.app-store-release-reputation-lead"]',
           '["engineering: implementation support","brand-creative: store listing collaboration","growth: store conversion collaboration"]'
    UNION ALL SELECT 'c4c00000-0000-4000-8000-000000000005', 'engineering',
           'Software engineering delivery, architecture quality, implementation reliability, code and repository health, testing and release engineering, production-readiness coordination and technical debt / risk management (D-R1-05).',
           '["software engineering delivery","architecture quality","implementation reliability","code and repository health","testing and release engineering","production-readiness coordination","technical debt and technical risk management","engineering capability development","cross-functional implementation support for Product and other Departments"]',
           '["does not absorb Product Authority","the Director title grants no merge, production deployment, infrastructure / secrets, budget or external publishing authority"]',
           '["director.engineering"]', '["product: implementation support"]'
  ) AS c;
