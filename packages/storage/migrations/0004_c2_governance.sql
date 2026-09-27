-- QANDEEL COMPANY operational schema — migration 0004: C2 governance (Employees, principals,
-- models / deployments, tools, grants, approvals, budgets, reservations, usage).
-- IMMUTABLE once released (see 0001). Migrations 0001–0003 are unchanged.
--
-- Conventions as in 0001: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete,
-- append-only history. Amounts are INTEGER money micro-units / token counts; no accounting
-- arithmetic is done in SQL (an overflowing SQL integer expression becomes REAL). CHECKs make the
-- datastore itself refuse negative amounts, out-of-range amounts and a reservation beyond a cap.
-- No column stores a secret: credential columns hold an opaque `vault:<name>` reference only.

CREATE TABLE departments (
  id          TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code        TEXT NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 64),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  status      TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at  TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at  TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER departments_no_delete BEFORE DELETE ON departments BEGIN SELECT RAISE(ABORT, 'departments are durable history'); END;
CREATE TRIGGER departments_identity_immutable BEFORE UPDATE OF id, code, created_at ON departments
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'department identity is immutable'); END;

-- Persistent Employees (Stage 4). Identity never references a provider, model, session, run or process.
CREATE TABLE employees (
  id                       TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  given_name               TEXT    NOT NULL CHECK (length(given_name) BETWEEN 2 AND 40),
  family_name              TEXT    NOT NULL CHECK (length(family_name) BETWEEN 2 AND 40),
  name_origin              TEXT    NOT NULL CHECK (name_origin = 'EG'),
  profile_json             TEXT    NOT NULL CHECK (json_valid(profile_json) AND length(profile_json) <= 8192),
  cognitive_profile_json   TEXT    NOT NULL CHECK (json_valid(cognitive_profile_json) AND length(cognitive_profile_json) <= 512),
  role_ref                 TEXT    NOT NULL CHECK (length(role_ref) BETWEEN 3 AND 161),
  position_ref             TEXT    NOT NULL CHECK (length(position_ref) BETWEEN 3 AND 161),
  department_id            TEXT    NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  manager_ref              TEXT    NOT NULL CHECK (length(manager_ref) BETWEEN 3 AND 161),
  state                    TEXT    NOT NULL CHECK (state IN ('CANDIDATE', 'TRAINING', 'SHADOW', 'PROBATION', 'ACTIVE', 'PAUSED', 'ON_LEAVE', 'RETRAINING', 'SUSPENDED', 'RETIRED')),
  qualification_refs_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(qualification_refs_json) AND json_type(qualification_refs_json) = 'array' AND length(qualification_refs_json) <= 4096),
  version                  INTEGER NOT NULL CHECK (version >= 1),
  created_at               TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at               TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (state <> 'ACTIVE' OR json_array_length(qualification_refs_json) > 0)
) STRICT;
-- Stage 1 §4: every persistent employee has a distinct name.
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

-- Real QANDEEL employment history (Stage 4 §3, §9): lifecycle, assignment and qualification changes.
CREATE TABLE employee_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  version        INTEGER NOT NULL CHECK (version >= 1),
  change_kind    TEXT    NOT NULL CHECK (change_kind IN ('CREATED', 'LIFECYCLE', 'ASSIGNMENT', 'QUALIFICATION', 'PROFILE')),
  from_state     TEXT,
  to_state       TEXT    NOT NULL,
  detail_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND length(detail_json) <= 1024),
  reason_code    TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref      TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at    TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (employee_id, version)
) STRICT;
CREATE TRIGGER employee_history_append_only_u BEFORE UPDATE ON employee_history BEGIN SELECT RAISE(ABORT, 'employee history is append-only'); END;
CREATE TRIGGER employee_history_append_only_d BEFORE DELETE ON employee_history BEGIN SELECT RAISE(ABORT, 'employee history is append-only'); END;

-- Principals: Human (Founder) identity ≠ Employee ≠ Runtime principal (D14-A.2). An Employee is
-- never a credential and never impersonates the Founder.
CREATE TABLE principals (
  id           TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  ref          TEXT NOT NULL UNIQUE CHECK (length(ref) BETWEEN 3 AND 161),
  kind         TEXT NOT NULL CHECK (kind IN ('FOUNDER', 'EMPLOYEE', 'SYSTEM')),
  employee_id  TEXT          REFERENCES employees (id) ON DELETE RESTRICT,
  status       TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at   TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((kind = 'EMPLOYEE') = (employee_id IS NOT NULL)),
  CHECK (kind <> 'EMPLOYEE' OR ref = 'employee:' || employee_id),
  CHECK (kind <> 'FOUNDER' OR ref GLOB 'founder:*')
) STRICT;
CREATE UNIQUE INDEX principals_one_founder ON principals (kind) WHERE kind = 'FOUNDER' AND status = 'ACTIVE';
CREATE TRIGGER principals_no_delete BEFORE DELETE ON principals BEGIN SELECT RAISE(ABORT, 'principals are durable history'); END;
CREATE TRIGGER principals_identity_immutable BEFORE UPDATE OF id, ref, kind, employee_id, created_at ON principals
WHEN NEW.id IS NOT OLD.id OR NEW.ref IS NOT OLD.ref OR NEW.kind IS NOT OLD.kind OR NEW.employee_id IS NOT OLD.employee_id OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'principal identity is immutable'); END;

-- Which Employee (and Department) a Run executed for: Work Item → Run → Employee → Department.
CREATE TABLE run_attributions (
  run_id         TEXT NOT NULL PRIMARY KEY REFERENCES runs (id) ON DELETE RESTRICT,
  work_item_id   TEXT NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id    TEXT NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  department_id  TEXT NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  created_at     TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE INDEX run_attributions_employee ON run_attributions (employee_id);
CREATE TRIGGER run_attributions_immutable_u BEFORE UPDATE ON run_attributions BEGIN SELECT RAISE(ABORT, 'run attribution is immutable'); END;
CREATE TRIGGER run_attributions_immutable_d BEFORE DELETE ON run_attributions BEGIN SELECT RAISE(ABORT, 'run attribution is immutable'); END;

-- Model catalog (Stage 13 D13-B): Provider → Model → Deployment Profile (+ versioned price cards).
CREATE TABLE model_providers (
  id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code            TEXT    NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 64),
  locality        TEXT    NOT NULL CHECK (locality IN ('LOCAL', 'EXTERNAL')),
  status          TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'HOLD', 'RETIRED')),
  hold_reason     TEXT             CHECK (hold_reason IS NULL OR length(hold_reason) <= 64),
  credential_ref  TEXT             CHECK (credential_ref IS NULL OR (credential_ref GLOB 'vault:[a-z0-9]*' AND length(credential_ref) <= 64 AND credential_ref NOT GLOB '*[^a-z0-9:.-]*')),
  version         INTEGER NOT NULL CHECK (version >= 1),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at      TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (status <> 'HOLD' OR hold_reason IS NOT NULL)
) STRICT;
CREATE TRIGGER model_providers_no_delete BEFORE DELETE ON model_providers BEGIN SELECT RAISE(ABORT, 'providers are retired, never deleted'); END;
CREATE TRIGGER model_providers_identity_immutable BEFORE UPDATE OF id, code, locality, created_at ON model_providers
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.locality IS NOT OLD.locality OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'provider identity is immutable'); END;

CREATE TABLE models (
  id           TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  provider_id  TEXT NOT NULL REFERENCES model_providers (id) ON DELETE RESTRICT,
  code         TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  created_at   TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (provider_id, code)
) STRICT;
CREATE TRIGGER models_immutable_u BEFORE UPDATE ON models BEGIN SELECT RAISE(ABORT, 'model identity is immutable'); END;
CREATE TRIGGER models_no_delete BEFORE DELETE ON models BEGIN SELECT RAISE(ABORT, 'models are durable history'); END;

CREATE TABLE deployments (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code                   TEXT    NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 64),
  model_id               TEXT    NOT NULL REFERENCES models (id) ON DELETE RESTRICT,
  pinned_revision        TEXT    NOT NULL CHECK (length(pinned_revision) BETWEEN 1 AND 64),
  reasoning_class        TEXT    NOT NULL CHECK (reasoning_class IN ('E1', 'E2', 'E3', 'E4')),
  qualification          TEXT    NOT NULL CHECK (qualification IN ('CANDIDATE', 'BENCHMARK', 'SHADOW', 'CHALLENGER', 'LIMITED_PRODUCTION', 'QUALIFIED')),
  task_classes_json      TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(task_classes_json) AND json_type(task_classes_json) = 'array' AND length(task_classes_json) <= 2048),
  egress_max_data_class  TEXT             CHECK (egress_max_data_class IS NULL OR egress_max_data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  status                 TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'HOLD', 'RETIRED')),
  hold_reason            TEXT             CHECK (hold_reason IS NULL OR length(hold_reason) <= 64),
  circuit_failures       INTEGER NOT NULL DEFAULT 0 CHECK (circuit_failures BETWEEN 0 AND 1000000),
  circuit_open_until     TEXT             CHECK (circuit_open_until IS NULL OR circuit_open_until GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  context_window_tokens  INTEGER NOT NULL CHECK (context_window_tokens BETWEEN 1 AND 100000000),
  max_output_tokens      INTEGER NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 10000000),
  price_card_id          TEXT             REFERENCES price_cards (id) ON DELETE RESTRICT,
  version                INTEGER NOT NULL CHECK (version >= 1),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at             TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (status <> 'HOLD' OR hold_reason IS NOT NULL)
) STRICT;
CREATE TRIGGER deployments_no_delete BEFORE DELETE ON deployments BEGIN SELECT RAISE(ABORT, 'deployments are retired, never deleted'); END;
-- A materially changed deployment is a new deployment profile (D13-B.6): identity, model, pinned
-- revision and reasoning class never change in place.
CREATE TRIGGER deployments_identity_immutable BEFORE UPDATE OF id, code, model_id, pinned_revision, reasoning_class, created_at ON deployments
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.model_id IS NOT OLD.model_id OR NEW.pinned_revision IS NOT OLD.pinned_revision
  OR NEW.reasoning_class IS NOT OLD.reasoning_class OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'deployment identity is immutable; register a new deployment profile'); END;
-- External egress stops at D2 in C2 (D-C2-13): D4 never leaves the machine, and D3 needs a qualified
-- conditional egress profile (account / endpoint / region / features / retention) C2 does not have.
CREATE TRIGGER deployments_external_egress_closed_i BEFORE INSERT ON deployments
WHEN NEW.egress_max_data_class IN ('D3', 'D4')
  AND (SELECT p.locality FROM models m JOIN model_providers p ON p.id = m.provider_id WHERE m.id = NEW.model_id) IS NOT 'LOCAL'
BEGIN SELECT RAISE(ABORT, 'D3/D4 egress to an external provider is closed'); END;
CREATE TRIGGER deployments_external_egress_closed_u BEFORE UPDATE OF egress_max_data_class ON deployments
WHEN NEW.egress_max_data_class IN ('D3', 'D4')
  AND (SELECT p.locality FROM models m JOIN model_providers p ON p.id = m.provider_id WHERE m.id = NEW.model_id) IS NOT 'LOCAL'
BEGIN SELECT RAISE(ABORT, 'D3/D4 egress to an external provider is closed'); END;

-- Versioned, immutable price cards: every usage record points at the exact card it was priced with.
CREATE TABLE price_cards (
  id                        TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  deployment_id             TEXT    NOT NULL REFERENCES deployments (id) ON DELETE RESTRICT,
  version                   INTEGER NOT NULL CHECK (version >= 1),
  currency                  TEXT    NOT NULL CHECK (length(currency) = 3 AND currency NOT GLOB '*[^A-Z]*'),
  billing_mode              TEXT    NOT NULL CHECK (billing_mode IN ('METERED', 'SUBSCRIPTION', 'FREE')),
  billed_input_per_mtok     INTEGER NOT NULL CHECK (billed_input_per_mtok BETWEEN 0 AND 1000000000000000),
  billed_output_per_mtok    INTEGER NOT NULL CHECK (billed_output_per_mtok BETWEEN 0 AND 1000000000000000),
  billed_per_call           INTEGER NOT NULL CHECK (billed_per_call BETWEEN 0 AND 1000000000000000),
  economic_input_per_mtok   INTEGER NOT NULL CHECK (economic_input_per_mtok BETWEEN 0 AND 1000000000000000),
  economic_output_per_mtok  INTEGER NOT NULL CHECK (economic_output_per_mtok BETWEEN 0 AND 1000000000000000),
  economic_per_call         INTEGER NOT NULL CHECK (economic_per_call BETWEEN 0 AND 1000000000000000),
  created_by_ref            TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at                TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (deployment_id, version),
  CHECK (billing_mode = 'METERED' OR (billed_input_per_mtok = 0 AND billed_output_per_mtok = 0 AND billed_per_call = 0))
) STRICT;
CREATE TRIGGER price_cards_immutable_u BEFORE UPDATE ON price_cards BEGIN SELECT RAISE(ABORT, 'price cards are immutable; add a new version'); END;
CREATE TRIGGER price_cards_immutable_d BEFORE DELETE ON price_cards BEGIN SELECT RAISE(ABORT, 'price cards are immutable; add a new version'); END;

-- Router Policy per task class (versioned; one ACTIVE version per task class).
CREATE TABLE route_policies (
  id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  task_class      TEXT    NOT NULL CHECK (length(task_class) BETWEEN 1 AND 64),
  version         INTEGER NOT NULL CHECK (version >= 1),
  policy_json     TEXT    NOT NULL CHECK (json_valid(policy_json) AND length(policy_json) <= 4096),
  status          TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  created_by_ref  TEXT    NOT NULL CHECK (length(created_by_ref) BETWEEN 3 AND 161),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (task_class, version)
) STRICT;
CREATE UNIQUE INDEX route_policies_one_active ON route_policies (task_class) WHERE status = 'ACTIVE';
CREATE TRIGGER route_policies_content_immutable BEFORE UPDATE ON route_policies
WHEN NEW.id IS NOT OLD.id OR NEW.task_class IS NOT OLD.task_class OR NEW.version IS NOT OLD.version OR NEW.policy_json IS NOT OLD.policy_json
  OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at OR OLD.status = 'SUPERSEDED'
BEGIN SELECT RAISE(ABORT, 'route policies are immutable; add a new version'); END;
CREATE TRIGGER route_policies_no_delete BEFORE DELETE ON route_policies BEGIN SELECT RAISE(ABORT, 'route policies are durable history'); END;

-- Tool Registry (Stage 7 §15, Stage 12 §11/§51).
CREATE TABLE tools (
  id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code            TEXT    NOT NULL UNIQUE CHECK (length(code) BETWEEN 1 AND 64),
  driver_code     TEXT    NOT NULL CHECK (length(driver_code) BETWEEN 1 AND 64),
  egress          TEXT    NOT NULL CHECK (egress IN ('NONE', 'EXTERNAL')),
  status          TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'HOLD', 'RETIRED')),
  hold_reason     TEXT             CHECK (hold_reason IS NULL OR length(hold_reason) <= 64),
  credential_ref  TEXT             CHECK (credential_ref IS NULL OR (credential_ref GLOB 'vault:[a-z0-9]*' AND length(credential_ref) <= 64 AND credential_ref NOT GLOB '*[^a-z0-9:.-]*')),
  version         INTEGER NOT NULL CHECK (version >= 1),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at      TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (status <> 'HOLD' OR hold_reason IS NOT NULL)
) STRICT;
CREATE TRIGGER tools_no_delete BEFORE DELETE ON tools BEGIN SELECT RAISE(ABORT, 'tools are retired, never deleted'); END;
CREATE TRIGGER tools_identity_immutable BEFORE UPDATE OF id, code, driver_code, egress, created_at ON tools
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.driver_code IS NOT OLD.driver_code OR NEW.egress IS NOT OLD.egress OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'tool identity is immutable'); END;

CREATE TABLE tool_actions (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  tool_id                TEXT    NOT NULL REFERENCES tools (id) ON DELETE RESTRICT,
  code                   TEXT    NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
  risk_level             TEXT    NOT NULL CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3', 'R4')),
  side_effects           TEXT    NOT NULL CHECK (side_effects IN ('NONE', 'IDEMPOTENT', 'UNSAFE')),
  mutates_external       INTEGER NOT NULL CHECK (mutates_external IN (0, 1)),
  requires_idempotency   INTEGER NOT NULL CHECK (requires_idempotency IN (0, 1)),
  data_class_ceiling     TEXT    NOT NULL CHECK (data_class_ceiling IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  -- Highest data class the action's RESULT may carry back into the run's context (D14-B.1).
  result_data_class      TEXT    NOT NULL CHECK (result_data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  args_schema_json       TEXT    NOT NULL CHECK (json_valid(args_schema_json) AND length(args_schema_json) <= 4096),
  cost_per_call_micros   INTEGER NOT NULL CHECK (cost_per_call_micros BETWEEN 0 AND 1000000000000000),
  status                 TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (tool_id, code),
  CHECK (mutates_external = 0 OR (requires_idempotency = 1 AND side_effects <> 'NONE' AND risk_level IN ('R3', 'R4'))),
  CHECK (side_effects = 'NONE' OR requires_idempotency = 1),
  CHECK (risk_level <> 'R0' OR side_effects = 'NONE')
) STRICT;
CREATE TRIGGER tool_actions_definition_immutable BEFORE UPDATE ON tool_actions
WHEN NEW.id IS NOT OLD.id OR NEW.tool_id IS NOT OLD.tool_id OR NEW.code IS NOT OLD.code OR NEW.risk_level IS NOT OLD.risk_level OR NEW.side_effects IS NOT OLD.side_effects
  OR NEW.mutates_external IS NOT OLD.mutates_external OR NEW.requires_idempotency IS NOT OLD.requires_idempotency OR NEW.data_class_ceiling IS NOT OLD.data_class_ceiling OR NEW.result_data_class IS NOT OLD.result_data_class
  OR NEW.args_schema_json IS NOT OLD.args_schema_json OR NEW.cost_per_call_micros IS NOT OLD.cost_per_call_micros OR NEW.created_at IS NOT OLD.created_at OR OLD.status = 'RETIRED'
BEGIN SELECT RAISE(ABORT, 'tool action definitions are immutable; register a new action'); END;
CREATE TRIGGER tool_actions_no_delete BEFORE DELETE ON tool_actions BEGIN SELECT RAISE(ABORT, 'tool actions are durable history'); END;
CREATE TRIGGER tool_actions_external_egress_closed BEFORE INSERT ON tool_actions
WHEN NEW.data_class_ceiling IN ('D3', 'D4') AND (SELECT egress FROM tools WHERE id = NEW.tool_id) = 'EXTERNAL'
BEGIN SELECT RAISE(ABORT, 'an external tool action accepts at most D2'); END;

-- Catalog change history (qualification, holds, egress approvals, circuits, policy activations).
CREATE TABLE catalog_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('provider', 'deployment', 'tool', 'route_policy')),
  entity_id    TEXT NOT NULL CHECK (length(entity_id) = 36),
  change_kind  TEXT NOT NULL CHECK (length(change_kind) BETWEEN 1 AND 64),
  from_value   TEXT          CHECK (from_value IS NULL OR length(from_value) <= 64),
  to_value     TEXT          CHECK (to_value IS NULL OR length(to_value) <= 64),
  reason_code  TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX catalog_history_entity ON catalog_history (entity_id, id);
CREATE TRIGGER catalog_history_append_only_u BEFORE UPDATE ON catalog_history BEGIN SELECT RAISE(ABORT, 'catalog history is append-only'); END;
CREATE TRIGGER catalog_history_append_only_d BEFORE DELETE ON catalog_history BEGIN SELECT RAISE(ABORT, 'catalog history is append-only'); END;

-- Explicit permission grants (Stage 3 §1, D14-C). No grant, no action. Grants never inherit.
CREATE TABLE permission_grants (
  id                   TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  employee_id          TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  capability           TEXT    NOT NULL CHECK (length(capability) BETWEEN 1 AND 128),
  resource_scope       TEXT    NOT NULL CHECK (length(resource_scope) BETWEEN 1 AND 161),
  risk_ceiling         TEXT    NOT NULL CHECK (risk_ceiling IN ('R0', 'R1', 'R3')),
  data_class_ceiling   TEXT    NOT NULL CHECK (data_class_ceiling IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  expires_at           TEXT             CHECK (expires_at IS NULL OR expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  max_uses             INTEGER          CHECK (max_uses IS NULL OR max_uses BETWEEN 1 AND 1000000),
  uses                 INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND (max_uses IS NULL OR uses <= max_uses)),
  status               TEXT    NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  granted_by_ref       TEXT    NOT NULL CHECK (granted_by_ref GLOB 'founder:*'),
  reason_code          TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  created_at           TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  revoked_at           TEXT             CHECK (revoked_at IS NULL OR revoked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  revoked_by_ref       TEXT             CHECK (revoked_by_ref IS NULL OR length(revoked_by_ref) <= 161),
  CHECK ((status = 'REVOKED') = (revoked_at IS NOT NULL))
) STRICT;
CREATE INDEX permission_grants_subject ON permission_grants (employee_id, capability) WHERE status = 'ACTIVE';
CREATE TRIGGER permission_grants_scope_immutable BEFORE UPDATE ON permission_grants
WHEN NEW.id IS NOT OLD.id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.capability IS NOT OLD.capability OR NEW.resource_scope IS NOT OLD.resource_scope
  OR NEW.risk_ceiling IS NOT OLD.risk_ceiling OR NEW.data_class_ceiling IS NOT OLD.data_class_ceiling OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.max_uses IS NOT OLD.max_uses OR NEW.granted_by_ref IS NOT OLD.granted_by_ref OR NEW.created_at IS NOT OLD.created_at
  OR OLD.status = 'REVOKED' OR NEW.uses < OLD.uses
BEGIN SELECT RAISE(ABORT, 'a grant''s scope is immutable; revoked grants are history'); END;
CREATE TRIGGER permission_grants_no_delete BEFORE DELETE ON permission_grants BEGIN SELECT RAISE(ABORT, 'grants are revoked, never deleted'); END;

-- Durable, scoped approvals (Stage 3 §3/§5). Arguments are referenced by SHA-256 only.
CREATE TABLE approvals (
  id                TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  subject_ref       TEXT    NOT NULL CHECK (length(subject_ref) BETWEEN 3 AND 161),
  requested_by_ref  TEXT    NOT NULL CHECK (length(requested_by_ref) BETWEEN 3 AND 161),
  action            TEXT    NOT NULL CHECK (length(action) BETWEEN 1 AND 128),
  resource_ref      TEXT    NOT NULL CHECK (length(resource_ref) BETWEEN 1 AND 161),
  work_item_id      TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  risk_level        TEXT    NOT NULL CHECK (risk_level IN ('R0', 'R1', 'R2', 'R3', 'R4')),
  data_class        TEXT    NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  args_sha256       TEXT    NOT NULL CHECK (length(args_sha256) = 64),
  fingerprint       TEXT    NOT NULL CHECK (length(fingerprint) = 64),
  limits_json       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(limits_json) AND length(limits_json) <= 512),
  state             TEXT    NOT NULL CHECK (state IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CONSUMED', 'REVOKED')),
  max_uses          INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000),
  uses              INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  expires_at        TEXT             CHECK (expires_at IS NULL OR expires_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  decided_by_ref    TEXT             CHECK (decided_by_ref IS NULL OR decided_by_ref GLOB 'founder:*'),
  decided_at        TEXT             CHECK (decided_at IS NULL OR decided_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  reason_code       TEXT             CHECK (reason_code IS NULL OR length(reason_code) <= 64),
  rerequest_of      TEXT             REFERENCES approvals (id) ON DELETE RESTRICT,
  version           INTEGER NOT NULL CHECK (version >= 1),
  created_at        TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at        TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK (state IN ('PENDING') OR (decided_by_ref IS NOT NULL AND decided_at IS NOT NULL) OR state IN ('EXPIRED', 'REVOKED')),
  CHECK (subject_ref <> decided_by_ref OR decided_by_ref IS NULL),
  -- R4 is Founder-only and R2 needs independent review: neither is ever approved through this table.
  CHECK (state NOT IN ('APPROVED', 'CONSUMED') OR risk_level IN ('R0', 'R1', 'R3'))
) STRICT;
CREATE INDEX approvals_fingerprint ON approvals (fingerprint, state);
CREATE INDEX approvals_pending ON approvals (state) WHERE state = 'PENDING';
CREATE TRIGGER approvals_scope_immutable BEFORE UPDATE ON approvals
WHEN NEW.id IS NOT OLD.id OR NEW.subject_ref IS NOT OLD.subject_ref OR NEW.requested_by_ref IS NOT OLD.requested_by_ref OR NEW.action IS NOT OLD.action
  OR NEW.resource_ref IS NOT OLD.resource_ref OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.risk_level IS NOT OLD.risk_level
  OR NEW.data_class IS NOT OLD.data_class OR NEW.args_sha256 IS NOT OLD.args_sha256 OR NEW.fingerprint IS NOT OLD.fingerprint
  OR NEW.limits_json IS NOT OLD.limits_json OR NEW.max_uses IS NOT OLD.max_uses OR NEW.created_at IS NOT OLD.created_at
  OR OLD.state IN ('REJECTED', 'EXPIRED', 'CONSUMED', 'REVOKED') OR NEW.version <> OLD.version + 1 OR NEW.uses < OLD.uses
BEGIN SELECT RAISE(ABORT, 'an approval''s scope is immutable and a decided approval is history'); END;
CREATE TRIGGER approvals_no_delete BEFORE DELETE ON approvals BEGIN SELECT RAISE(ABORT, 'approvals are durable history'); END;

CREATE TABLE approval_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_id  TEXT NOT NULL REFERENCES approvals (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT,
  to_state     TEXT NOT NULL,
  reason_code  TEXT NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (approval_id, version)
) STRICT;
CREATE TRIGGER approval_history_append_only_u BEFORE UPDATE ON approval_history BEGIN SELECT RAISE(ABORT, 'approval history is append-only'); END;
CREATE TRIGGER approval_history_append_only_d BEFORE DELETE ON approval_history BEGIN SELECT RAISE(ABORT, 'approval history is append-only'); END;

-- The C1 fail-closed approval gate now has a real authority path: a Work Item may leave
-- WAITING_APPROVAL toward execution only when bound to an approved, in-scope work_item.execute
-- approval. R4 work never leaves toward execution (Founder-only sovereign action).
ALTER TABLE work_items ADD COLUMN approval_id TEXT REFERENCES approvals (id) ON DELETE RESTRICT;

CREATE TRIGGER work_items_approval_binding_immutable BEFORE UPDATE OF approval_id ON work_items
WHEN OLD.approval_id IS NOT NULL AND NEW.approval_id IS NOT OLD.approval_id
BEGIN SELECT RAISE(ABORT, 'a work item approval binding is immutable'); END;

CREATE TRIGGER work_items_approval_gate BEFORE UPDATE OF state ON work_items
WHEN NEW.state IN ('READY', 'ASSIGNED', 'IN_PROGRESS')
  AND (OLD.approval_required = 1 OR OLD.risk_level IN ('R3', 'R4'))
  AND (OLD.risk_level = 'R4' OR NOT EXISTS (
    SELECT 1 FROM approvals a
     WHERE a.id = NEW.approval_id AND a.work_item_id = NEW.id AND a.action = 'work_item.execute'
       AND a.state IN ('APPROVED', 'CONSUMED') AND a.decided_by_ref GLOB 'founder:*'))
BEGIN SELECT RAISE(ABORT, 'work requiring approval is released only through a valid Founder approval'); END;

CREATE TRIGGER work_items_approval_gate_insert BEFORE INSERT ON work_items
WHEN NEW.state IN ('READY', 'ASSIGNED', 'IN_PROGRESS') AND (NEW.approval_required = 1 OR NEW.risk_level IN ('R3', 'R4'))
BEGIN SELECT RAISE(ABORT, 'work requiring approval is never created released'); END;

-- Hierarchical hard budget envelopes (Stage 3 §6, D13-G.4): Company → Department → Employee →
-- Work Item → Run. reserved + spent never exceeds the cap (plus any recorded overrun, which is
-- truthfully recorded when a provider reports usage beyond its enforced bounds).
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
  UNIQUE (scope, scope_id),
  CHECK ((scope = 'COMPANY') = (parent_id IS NULL)),
  CHECK (reserved_money + spent_money <= cap_money + overrun_money),
  CHECK (reserved_tokens + spent_tokens <= cap_tokens + overrun_tokens),
  CHECK (scope = 'WORK_ITEM' OR (run_cap_money IS NULL AND run_cap_tokens IS NULL))
) STRICT;
CREATE INDEX budgets_parent ON budgets (parent_id);
CREATE TRIGGER budgets_identity_immutable BEFORE UPDATE ON budgets
WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.scope_id IS NOT OLD.scope_id OR NEW.parent_id IS NOT OLD.parent_id
  OR NEW.currency IS NOT OLD.currency OR NEW.created_by_ref IS NOT OLD.created_by_ref OR NEW.created_at IS NOT OLD.created_at
  OR NEW.version <> OLD.version + 1 OR NEW.spent_money < OLD.spent_money OR NEW.spent_tokens < OLD.spent_tokens
  OR NEW.overrun_money < OLD.overrun_money OR NEW.overrun_tokens < OLD.overrun_tokens
BEGIN SELECT RAISE(ABORT, 'budget identity is immutable and spend is never reduced'); END;
CREATE TRIGGER budgets_no_delete BEFORE DELETE ON budgets BEGIN SELECT RAISE(ABORT, 'budgets are durable history'); END;

CREATE TABLE budget_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_id    TEXT    NOT NULL REFERENCES budgets (id) ON DELETE RESTRICT,
  change_kind  TEXT    NOT NULL CHECK (change_kind IN ('CREATED', 'CAP_CHANGED')),
  cap_money    INTEGER NOT NULL CHECK (cap_money BETWEEN 0 AND 1000000000000000),
  cap_tokens   INTEGER NOT NULL CHECK (cap_tokens BETWEEN 0 AND 1000000000000),
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER budget_history_append_only_u BEFORE UPDATE ON budget_history BEGIN SELECT RAISE(ABORT, 'budget history is append-only'); END;
CREATE TRIGGER budget_history_append_only_d BEFORE DELETE ON budget_history BEGIN SELECT RAISE(ABORT, 'budget history is append-only'); END;

-- Worst-case reservations made before any model or tool call (D13-G.5), against the Run budget
-- and every ancestor. RESERVED / RECONCILIATION_REQUIRED amounts are held; SETTLED / RELEASED are final.
CREATE TABLE budget_reservations (
  id              TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  budget_id       TEXT    NOT NULL REFERENCES budgets (id) ON DELETE RESTRICT,
  run_id          TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  job_id          TEXT    NOT NULL REFERENCES queue_jobs (id) ON DELETE RESTRICT,
  fencing_token   INTEGER NOT NULL CHECK (fencing_token >= 1),
  work_item_id    TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id     TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  department_id   TEXT    NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
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
  CHECK ((purpose = 'MODEL_CALL') = (deployment_id IS NOT NULL AND price_card_id IS NOT NULL AND route_policy_id IS NOT NULL)),
  CHECK ((purpose = 'TOOL_CALL') = (tool_action_id IS NOT NULL))
) STRICT;
CREATE INDEX budget_reservations_run ON budget_reservations (run_id);
CREATE INDEX budget_reservations_open ON budget_reservations (state) WHERE state IN ('RESERVED', 'RECONCILIATION_REQUIRED');
CREATE TRIGGER budget_reservations_amounts_immutable BEFORE UPDATE ON budget_reservations
WHEN NEW.id IS NOT OLD.id OR NEW.budget_id IS NOT OLD.budget_id OR NEW.run_id IS NOT OLD.run_id OR NEW.money IS NOT OLD.money OR NEW.tokens IS NOT OLD.tokens
  OR NEW.purpose IS NOT OLD.purpose OR NEW.attempt_kind IS NOT OLD.attempt_kind OR NEW.fencing_token IS NOT OLD.fencing_token OR NEW.created_at IS NOT OLD.created_at
  OR OLD.state IN ('SETTLED', 'RELEASED')
BEGIN SELECT RAISE(ABORT, 'reservation amounts are immutable and a settled / released reservation is final'); END;
CREATE TRIGGER budget_reservations_no_delete BEFORE DELETE ON budget_reservations BEGIN SELECT RAISE(ABORT, 'reservations are durable history'); END;

-- Usage / cost events (D13-G.1–3, .6–.7): raw quantities, billed and economic cost, the price card
-- version, and full attribution. Append-only; one row per settled reservation.
CREATE TABLE usage_records (
  id                  TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  reservation_id      TEXT    NOT NULL UNIQUE REFERENCES budget_reservations (id) ON DELETE RESTRICT,
  run_id              TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  work_item_id        TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id         TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  department_id       TEXT    NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
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
CREATE INDEX usage_records_run ON usage_records (run_id);
CREATE INDEX usage_records_employee ON usage_records (employee_id);
CREATE TRIGGER usage_records_append_only_u BEFORE UPDATE ON usage_records BEGIN SELECT RAISE(ABORT, 'usage records are append-only'); END;
CREATE TRIGGER usage_records_append_only_d BEFORE DELETE ON usage_records BEGIN SELECT RAISE(ABORT, 'usage records are append-only'); END;

-- Durable tool intent / result (Stage 12 §4/§11, Stage 15 D15-C). Arguments are referenced by
-- SHA-256; the bounded result is kept for idempotent replay (operational state, not telemetry).
CREATE TABLE tool_invocations (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  tool_action_id   TEXT    NOT NULL REFERENCES tool_actions (id) ON DELETE RESTRICT,
  idempotency_key  TEXT    NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  args_sha256      TEXT    NOT NULL CHECK (length(args_sha256) = 64),
  work_item_id     TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id      TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  run_id           TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  fencing_token    INTEGER NOT NULL CHECK (fencing_token >= 1),
  grant_id         TEXT    NOT NULL REFERENCES permission_grants (id) ON DELETE RESTRICT,
  approval_id      TEXT             REFERENCES approvals (id) ON DELETE RESTRICT,
  reservation_id   TEXT             REFERENCES budget_reservations (id) ON DELETE RESTRICT,
  state            TEXT    NOT NULL CHECK (state IN ('INTENT_RECORDED', 'SUCCEEDED', 'FAILED', 'RETRYABLE', 'RECONCILIATION_REQUIRED')),
  attempts         INTEGER NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 1000),
  failure_code     TEXT             CHECK (failure_code IS NULL OR length(failure_code) <= 64),
  result_json      TEXT             CHECK (result_json IS NULL OR (json_valid(result_json) AND length(result_json) <= 4096)),
  result_sha256    TEXT             CHECK (result_sha256 IS NULL OR length(result_sha256) = 64),
  created_at       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at       TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (tool_action_id, idempotency_key),
  CHECK ((state = 'SUCCEEDED') = (result_sha256 IS NOT NULL))
) STRICT;
CREATE INDEX tool_invocations_run ON tool_invocations (run_id);
CREATE TRIGGER tool_invocations_identity_immutable BEFORE UPDATE ON tool_invocations
WHEN NEW.id IS NOT OLD.id OR NEW.tool_action_id IS NOT OLD.tool_action_id OR NEW.idempotency_key IS NOT OLD.idempotency_key
  OR NEW.args_sha256 IS NOT OLD.args_sha256 OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.employee_id IS NOT OLD.employee_id
  OR NEW.created_at IS NOT OLD.created_at OR OLD.state IN ('SUCCEEDED', 'FAILED')
BEGIN SELECT RAISE(ABORT, 'a tool invocation''s identity is immutable and a finished invocation is history'); END;
CREATE TRIGGER tool_invocations_no_delete BEFORE DELETE ON tool_invocations BEGIN SELECT RAISE(ABORT, 'tool invocations are durable history'); END;

-- Approval decisions and tool reconciliations that make parked work actionable advance the durable
-- wake generation through the existing queue_jobs triggers (0003), in the same transaction.
