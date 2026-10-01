-- QANDEEL COMPANY operational schema — migration 0013: C7-B Governed Company → App operational controls.
-- The persistent App Operations & Release Lead seat (Product, under the Product Director); the closed catalogue of the
-- seven approved control families; the (empty) register of approved Remote Configuration families; R3 control
-- proposals; immutable control series and append-only issued revisions (Company DESIRED state only — there is no
-- applied / delivered / effective state anywhere); the bounded refusal counter that closes the Company-side storage
-- amplification of C7-A intake refusals (R-C7A-04); and one outbox aggregate. Nothing here executes anything, stores a
-- credential or a key, or touches the App.
-- IMMUTABLE once released (see 0001). Migrations 0001–0012 are unchanged; the outbox is replaced only by the
-- row-preserving rebuild of D-C4-01 (copied whole to TEMP, re-created, every row copied back BEFORE the triggers are
-- re-created; DROP TABLE's implicit delete fires no trigger; parent references deferred to COMMIT).
--
-- Conventions as in 0001–0012: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete, append-only
-- history, forward-only updates; ids, codes, counts and hashes only (Rules A / B / C).

PRAGMA defer_foreign_keys = ON;

-- =====================================================================================================
-- 1. The persistent QANDEEL App Operations & Release Lead seat (APP-OPS-01 §16, PO-OPS-09): Product Department, reports
-- to the Product Director, a LEAD seat like the App Store Release & Reputation Lead (Stage 10 §10), which stays exactly
-- as it is — the two roles are distinct. Release-created (CANONICAL_MAP), vacant: no Employee, persona, model or grant
-- is created, and the seat grants nothing (Title ≠ Authority). An existing seat with this code is adopted.
-- =====================================================================================================
INSERT INTO org_positions (id, code, title, scope, department_id, kind, role_ref, reports_to_position_id, reports_to_founder, accountability_json, status, source, version, created_by_ref, created_at, updated_at)
SELECT 'c7b00000-0000-4000-8000-000000000001', 'product.app-operations-release-lead', 'QANDEEL App Operations & Release Lead', 'DEPARTMENT', d.id, 'LEAD',
       'role:product.app-operations-release-lead', dir.id, 0,
       '["app operational health","release and rollout coordination","approved operational diagnostics coordination (content-free)","provider and model operational route holds","operational incident coordination","maintaining the App to Company operations contract","proposing governed operational controls (never issuing them alone)"]',
       'ACTIVE', 'CANONICAL_MAP', 1, 'system:release-c7b', COALESCE((SELECT MAX(occurred_at) FROM audit_events), '2026-10-01T00:00:00.000Z'), COALESCE((SELECT MAX(occurred_at) FROM audit_events), '2026-10-01T00:00:00.000Z')
  FROM departments d JOIN org_positions dir ON dir.code = 'director.product' AND dir.department_id = d.id
 WHERE d.code = 'product' AND NOT EXISTS (SELECT 1 FROM org_positions WHERE code = 'product.app-operations-release-lead');
INSERT INTO org_position_history (position_id, version, change_kind, from_value, to_value, reason_code, actor_ref, occurred_at)
  SELECT id, 1, 'CREATED', NULL, status, 'canonical.map', 'system:release-c7b', created_at FROM org_positions WHERE id = 'c7b00000-0000-4000-8000-000000000001';

-- The Product charter lists the seat through the existing versioning: the current version is superseded (history kept,
-- never edited) and a new version copies it whole with the seat added, as the current version again (BASELINE while the
-- Founder has not completed it, ACTIVE once a Founder version exists). Its instant is Company time — the latest audited
-- instant, never before the superseded version — never the host wall clock.
UPDATE department_charters SET status = 'SUPERSEDED', effective_to = MAX(effective_from, COALESCE((SELECT MAX(occurred_at) FROM audit_events), effective_from))
 WHERE department_id = (SELECT id FROM departments WHERE code = 'product') AND status IN ('BASELINE', 'ACTIVE')
   AND NOT EXISTS (SELECT 1 FROM json_each(seats_json) j WHERE j.value = 'product.app-operations-release-lead');
INSERT INTO department_charters (id, department_id, version, status, mission, outcomes_json, scope_json, boundaries_json, director_position_id, seats_json, recurring_responsibilities_json, dependencies_json, budget_envelope_id, measures_json, risks_json, source, effective_from, effective_to, created_by_ref, created_at)
  SELECT 'c7b00000-0000-4000-8000-000000000002', c.department_id, c.version + 1, CASE c.source WHEN 'FOUNDER' THEN 'ACTIVE' ELSE 'BASELINE' END, c.mission, c.outcomes_json, c.scope_json, c.boundaries_json, c.director_position_id,
         json_insert(c.seats_json, '$[#]', 'product.app-operations-release-lead'), c.recurring_responsibilities_json, c.dependencies_json, c.budget_envelope_id, c.measures_json, c.risks_json,
         'PRODUCT_AUTHORITY', c.effective_to, NULL, 'system:release-c7b', c.effective_to
    FROM department_charters c
   WHERE c.department_id = (SELECT id FROM departments WHERE code = 'product') AND c.status = 'SUPERSEDED'
     AND c.version = (SELECT MAX(x.version) FROM department_charters x WHERE x.department_id = c.department_id)
     AND NOT EXISTS (SELECT 1 FROM json_each(c.seats_json) j WHERE j.value = 'product.app-operations-release-lead')
     AND NOT EXISTS (SELECT 1 FROM department_charters k WHERE k.department_id = c.department_id AND k.status IN ('BASELINE', 'ACTIVE'));

-- =====================================================================================================
-- 2. The closed catalogue of the seven approved control families (APP-OPS-01 §11, PO-OPS-07). Frozen: an eighth family
-- needs a later controlled Product / Architecture release; no row is ever added, changed or removed at runtime.
-- =====================================================================================================
CREATE TABLE app_control_families (
  family            TEXT    NOT NULL PRIMARY KEY CHECK (family IN ('FEATURE_FLAG', 'KILL_SWITCH', 'MAINTENANCE_MODE', 'ROLLOUT_CONTROL', 'MINIMUM_SUPPORTED_VERSION', 'APPROVED_REMOTE_CONFIGURATION', 'ROUTE_HOLD')),
  ordinal           INTEGER NOT NULL UNIQUE CHECK (ordinal BETWEEN 1 AND 7),
  scope_kinds_json  TEXT    NOT NULL CHECK (json_valid(scope_kinds_json) AND json_type(scope_kinds_json) = 'array' AND length(scope_kinds_json) <= 128),
  grant_resource    TEXT    NOT NULL UNIQUE CHECK (length(grant_resource) BETWEEN 3 AND 64)
) STRICT;
INSERT INTO app_control_families (family, ordinal, scope_kinds_json, grant_resource) VALUES
  ('FEATURE_FLAG', 1, '["CAPABILITY"]', 'feature-flag'),
  ('KILL_SWITCH', 2, '["CAPABILITY"]', 'kill-switch'),
  ('MAINTENANCE_MODE', 3, '["APP","CAPABILITY","SURFACE"]', 'maintenance-mode'),
  ('ROLLOUT_CONTROL', 4, '["COHORT"]', 'rollout-control'),
  ('MINIMUM_SUPPORTED_VERSION', 5, '["PLATFORM","PLATFORM_CAPABILITY"]', 'minimum-supported-version'),
  ('APPROVED_REMOTE_CONFIGURATION', 6, '["APP","CAPABILITY","SURFACE"]', 'approved-remote-configuration'),
  ('ROUTE_HOLD', 7, '["PROVIDER","ROUTE"]', 'route-hold');
CREATE TRIGGER app_control_families_closed_i BEFORE INSERT ON app_control_families BEGIN SELECT RAISE(ABORT, 'the seven control families are closed; a new family needs a controlled Product / Architecture release'); END;
CREATE TRIGGER app_control_families_closed_u BEFORE UPDATE ON app_control_families BEGIN SELECT RAISE(ABORT, 'the seven control families are closed; a new family needs a controlled Product / Architecture release'); END;
CREATE TRIGGER app_control_families_closed_d BEFORE DELETE ON app_control_families BEGIN SELECT RAISE(ABORT, 'the seven control families are closed; a new family needs a controlled Product / Architecture release'); END;

-- =====================================================================================================
-- 3. The register of APPROVED Remote Configuration families (PO-OPS-18). EMPTY in this release: no family has been
-- approved by Product Owner + Architecture, so Remote Configuration fails closed. A family is one typed, bounded,
-- scope-limited value (no free text: BOOLEAN, bounded INTEGER or a closed ENUM). Only a later controlled release adds
-- one (it re-creates the guard below in the same migration); nothing at runtime can.
-- =====================================================================================================
CREATE TABLE app_remote_config_families (
  code                       TEXT    NOT NULL CHECK (length(code) BETWEEN 2 AND 64 AND code GLOB '[a-z]*' AND code NOT GLOB '*[^a-z0-9.-]*'),
  version                    INTEGER NOT NULL CHECK (version >= 1),
  value_type                 TEXT    NOT NULL CHECK (value_type IN ('BOOLEAN', 'INTEGER', 'ENUM')),
  min_value                  INTEGER          CHECK (min_value IS NULL OR min_value BETWEEN -1000000000 AND 1000000000),
  max_value                  INTEGER          CHECK (max_value IS NULL OR max_value BETWEEN -1000000000 AND 1000000000),
  enum_json                  TEXT             CHECK (enum_json IS NULL OR (json_valid(enum_json) AND json_type(enum_json) = 'array' AND length(enum_json) <= 1024)),
  scope_kinds_json           TEXT    NOT NULL CHECK (json_valid(scope_kinds_json) AND json_type(scope_kinds_json) = 'array' AND length(scope_kinds_json) <= 64),
  product_approval_ref       TEXT    NOT NULL CHECK (length(product_approval_ref) BETWEEN 3 AND 161),
  architecture_approval_ref  TEXT    NOT NULL CHECK (length(architecture_approval_ref) BETWEEN 3 AND 161),
  approved_at                TEXT    NOT NULL CHECK (approved_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (code, version),
  CHECK ((value_type = 'INTEGER') = (min_value IS NOT NULL AND max_value IS NOT NULL)),
  CHECK (min_value IS NULL OR min_value <= max_value),
  CHECK ((value_type = 'ENUM') = (enum_json IS NOT NULL))
) STRICT, WITHOUT ROWID;
CREATE TRIGGER app_remote_config_families_release_only BEFORE INSERT ON app_remote_config_families
BEGIN SELECT RAISE(ABORT, 'NO_APPROVED_REMOTE_CONFIG_FAMILY: an approved Remote Configuration family enters only through a controlled Product + Architecture release'); END;
CREATE TRIGGER app_remote_config_families_immutable_u BEFORE UPDATE ON app_remote_config_families BEGIN SELECT RAISE(ABORT, 'an approved Remote Configuration family is immutable'); END;
CREATE TRIGGER app_remote_config_families_immutable_d BEFORE DELETE ON app_remote_config_families BEGIN SELECT RAISE(ABORT, 'an approved Remote Configuration family is immutable'); END;

-- =====================================================================================================
-- 4. Control proposals (R3). An Employee holding the App Operations & Release Lead seat, with an explicit Founder-created
-- R3 grant, proposes one exact revision from a governed run; its independent review is the existing action review and
-- its Founder approval the existing approval engine, both bound to `fingerprint`. A proposal never issues itself.
-- PROPOSED → AWAITING_FOUNDER (review satisfied; a PENDING R3 approval) → ISSUED | REJECTED; PROPOSED → REVIEW_REJECTED |
-- REJECTED (this exact act was already rejected by the Founder);
-- PROPOSED / AWAITING_FOUNDER → STALE (another revision of the series was issued first).
-- =====================================================================================================
CREATE TABLE app_control_proposals (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id          TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  run_id                TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  proposer_employee_id  TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  proposer_position_id  TEXT    NOT NULL REFERENCES org_positions (id) ON DELETE RESTRICT,
  grant_id              TEXT    NOT NULL REFERENCES permission_grants (id) ON DELETE RESTRICT,
  family                TEXT    NOT NULL REFERENCES app_control_families (family) ON DELETE RESTRICT,
  scope_kind            TEXT    NOT NULL CHECK (scope_kind IN ('APP', 'CAPABILITY', 'SURFACE', 'COHORT', 'PLATFORM', 'PLATFORM_CAPABILITY', 'PROVIDER', 'ROUTE')),
  scope_json            TEXT    NOT NULL CHECK (json_valid(scope_json) AND json_type(scope_json) = 'object' AND length(scope_json) <= 512),
  operation             TEXT    NOT NULL CHECK (operation IN ('SET', 'RELEASE')),
  value_json            TEXT             CHECK (value_json IS NULL OR (json_valid(value_json) AND json_type(value_json) = 'object' AND length(value_json) <= 512)),
  reason_code           TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64 AND reason_code NOT GLOB '*[^a-z0-9.-]*'),
  evidence_refs_json    TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND json_array_length(evidence_refs_json) <= 8 AND length(evidence_refs_json) <= 1200),
  expected_revision     INTEGER NOT NULL CHECK (expected_revision >= 0),
  fingerprint           TEXT    NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  state                 TEXT    NOT NULL CHECK (state IN ('PROPOSED', 'AWAITING_FOUNDER', 'ISSUED', 'REJECTED', 'REVIEW_REJECTED', 'STALE')),
  review_request_id     TEXT             REFERENCES review_requests (id) ON DELETE RESTRICT,
  approval_id           TEXT             REFERENCES approvals (id) ON DELETE RESTRICT,
  revision_id           TEXT             CHECK (revision_id IS NULL OR length(revision_id) = 36),
  version               INTEGER NOT NULL CHECK (version >= 1),
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at            TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (work_item_id, fingerprint),
  CHECK ((operation = 'RELEASE') = (value_json IS NULL)),
  CHECK (state NOT IN ('AWAITING_FOUNDER', 'ISSUED', 'REJECTED') OR approval_id IS NOT NULL),
  CHECK ((state = 'ISSUED') = (revision_id IS NOT NULL))
) STRICT;
CREATE INDEX app_control_proposals_state ON app_control_proposals (state, family);
CREATE INDEX app_control_proposals_series ON app_control_proposals (family, scope_json, state);

-- Seat eligibility AND an explicit R3 grant, re-checked by the datastore (Title ≠ Authority; a grant without the seat or
-- its scoped acting coverage cannot impersonate the operating role; nobody self-grants: R3 grants are Founder-created).
CREATE TRIGGER app_control_proposals_governed BEFORE INSERT ON app_control_proposals
WHEN NEW.state <> 'PROPOSED' OR NEW.version <> 1 OR NEW.approval_id IS NOT NULL OR NEW.revision_id IS NOT NULL
  OR NOT EXISTS (SELECT 1 FROM org_positions p WHERE p.id = NEW.proposer_position_id AND p.code = 'product.app-operations-release-lead' AND p.status = 'ACTIVE')
  OR NOT EXISTS (SELECT 1 FROM position_assignments a WHERE a.position_id = NEW.proposer_position_id AND a.employee_id = NEW.proposer_employee_id
                    AND a.status = 'ACTIVE' AND a.effective_from <= NEW.created_at AND (a.effective_to IS NULL OR a.effective_to > NEW.created_at)
                    AND (a.kind = 'PRIMARY' OR json_array_length(a.acting_scope_json) = 0 OR EXISTS (SELECT 1 FROM json_each(a.acting_scope_json) s WHERE s.value = 'control.propose')))
  OR NOT EXISTS (SELECT 1 FROM permission_grants g WHERE g.id = NEW.grant_id AND g.employee_id = NEW.proposer_employee_id AND g.status = 'ACTIVE'
                    AND g.capability = 'app-control.issue' AND g.risk_ceiling = 'R3' AND g.granted_by_ref GLOB 'founder:*'
                    AND (g.expires_at IS NULL OR g.expires_at > NEW.created_at) AND (g.max_uses IS NULL OR g.uses < g.max_uses)
                    AND (g.resource_scope = '*' OR g.resource_scope = (SELECT f.grant_resource FROM app_control_families f WHERE f.family = NEW.family)))
  OR NOT EXISTS (SELECT 1 FROM app_control_families f, json_each(f.scope_kinds_json) k WHERE f.family = NEW.family AND k.value = NEW.scope_kind)
  OR json_extract(NEW.scope_json, '$.kind') IS NOT NEW.scope_kind
BEGIN SELECT RAISE(ABORT, 'a control proposal needs the App Operations & Release Lead seat, an explicit Founder-created R3 grant and a scope its family admits'); END;
-- The proposed act is immutable; its state only moves forward.
CREATE TRIGGER app_control_proposals_forward BEFORE UPDATE ON app_control_proposals
WHEN NEW.id IS NOT OLD.id OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.run_id IS NOT OLD.run_id OR NEW.proposer_employee_id IS NOT OLD.proposer_employee_id
  OR NEW.proposer_position_id IS NOT OLD.proposer_position_id OR NEW.grant_id IS NOT OLD.grant_id OR NEW.family IS NOT OLD.family OR NEW.scope_kind IS NOT OLD.scope_kind
  OR NEW.scope_json IS NOT OLD.scope_json OR NEW.operation IS NOT OLD.operation OR NEW.value_json IS NOT OLD.value_json OR NEW.reason_code IS NOT OLD.reason_code
  OR NEW.evidence_refs_json IS NOT OLD.evidence_refs_json OR NEW.expected_revision IS NOT OLD.expected_revision OR NEW.fingerprint IS NOT OLD.fingerprint
  OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR (OLD.approval_id IS NOT NULL AND NEW.approval_id IS NOT OLD.approval_id) OR (OLD.revision_id IS NOT NULL AND NEW.revision_id IS NOT OLD.revision_id)
  OR NOT ((OLD.state = 'PROPOSED' AND NEW.state IN ('PROPOSED', 'AWAITING_FOUNDER', 'REVIEW_REJECTED', 'REJECTED', 'STALE'))
       OR (OLD.state = 'AWAITING_FOUNDER' AND NEW.state IN ('ISSUED', 'REJECTED', 'STALE')))
BEGIN SELECT RAISE(ABORT, 'a control proposal is immutable and only moves forward'); END;
CREATE TRIGGER app_control_proposals_no_delete BEFORE DELETE ON app_control_proposals BEGIN SELECT RAISE(ABORT, 'control proposals are durable history'); END;

CREATE TABLE app_control_proposal_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  proposal_id  TEXT    NOT NULL REFERENCES app_control_proposals (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT,
  to_state     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (length(actor_ref) BETWEEN 3 AND 161),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (proposal_id, version)
) STRICT;
CREATE TRIGGER app_control_proposal_history_append_only_u BEFORE UPDATE ON app_control_proposal_history BEGIN SELECT RAISE(ABORT, 'control proposal history is append-only'); END;
CREATE TRIGGER app_control_proposal_history_append_only_d BEFORE DELETE ON app_control_proposal_history BEGIN SELECT RAISE(ABORT, 'control proposal history is append-only'); END;

-- =====================================================================================================
-- 5. Control series: the stable identity of one logical control — one family on one exact scope. Immutable.
-- =====================================================================================================
CREATE TABLE app_control_series (
  id          TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  family      TEXT NOT NULL REFERENCES app_control_families (family) ON DELETE RESTRICT,
  scope_kind  TEXT NOT NULL CHECK (scope_kind IN ('APP', 'CAPABILITY', 'SURFACE', 'COHORT', 'PLATFORM', 'PLATFORM_CAPABILITY', 'PROVIDER', 'ROUTE')),
  scope_json  TEXT NOT NULL CHECK (json_valid(scope_json) AND json_type(scope_json) = 'object' AND length(scope_json) <= 512),
  created_at  TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (family, scope_json)
) STRICT;
CREATE TRIGGER app_control_series_immutable_u BEFORE UPDATE ON app_control_series BEGIN SELECT RAISE(ABORT, 'a control series identity is immutable'); END;
CREATE TRIGGER app_control_series_no_delete BEFORE DELETE ON app_control_series BEGIN SELECT RAISE(ABORT, 'control series are durable history'); END;

-- =====================================================================================================
-- 6. Issued revisions: append-only Company DESIRED state. `company_state` is ISSUED and nothing else: the Company never
-- records what the App applied. Each revision is the next of its series (compare-and-swap on the prior revision), the
-- exact proposal that was independently reviewed (R3, the maker excluded) and Founder-approved, issued by the Founder
-- who approved it. A RELEASE removes the Company overlay; it is a new revision, never a deletion.
-- =====================================================================================================
CREATE TABLE app_control_revisions (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  series_id          TEXT    NOT NULL REFERENCES app_control_series (id) ON DELETE RESTRICT,
  revision           INTEGER NOT NULL CHECK (revision >= 1),
  prior_revision_id  TEXT             REFERENCES app_control_revisions (id) ON DELETE RESTRICT,
  family             TEXT    NOT NULL REFERENCES app_control_families (family) ON DELETE RESTRICT,
  scope_kind         TEXT    NOT NULL CHECK (scope_kind IN ('APP', 'CAPABILITY', 'SURFACE', 'COHORT', 'PLATFORM', 'PLATFORM_CAPABILITY', 'PROVIDER', 'ROUTE')),
  scope_json         TEXT    NOT NULL CHECK (json_valid(scope_json) AND json_type(scope_json) = 'object' AND length(scope_json) <= 512),
  operation          TEXT    NOT NULL CHECK (operation IN ('SET', 'RELEASE')),
  value_json         TEXT             CHECK (value_json IS NULL OR (json_valid(value_json) AND json_type(value_json) = 'object' AND length(value_json) <= 512)),
  reason_code        TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  proposal_id        TEXT    NOT NULL UNIQUE REFERENCES app_control_proposals (id) ON DELETE RESTRICT,
  proposer_ref       TEXT    NOT NULL CHECK (proposer_ref GLOB 'employee:*'),
  review_request_id  TEXT    NOT NULL UNIQUE REFERENCES review_requests (id) ON DELETE RESTRICT,
  approval_id        TEXT    NOT NULL UNIQUE REFERENCES approvals (id) ON DELETE RESTRICT,
  issued_by_ref      TEXT    NOT NULL CHECK (issued_by_ref GLOB 'founder:*'),
  issued_at          TEXT    NOT NULL CHECK (issued_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  digest             TEXT    NOT NULL UNIQUE CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
  company_state      TEXT    NOT NULL CHECK (company_state = 'ISSUED'),
  UNIQUE (series_id, revision),
  CHECK ((revision = 1) = (prior_revision_id IS NULL)),
  CHECK ((operation = 'RELEASE') = (value_json IS NULL))
) STRICT;
CREATE INDEX app_control_revisions_issued ON app_control_revisions (issued_at, id);

-- The series order: exactly the next revision after the current one (no skip, no rollback, no second current revision),
-- of the series' own family and scope; a RELEASE removes a live SET only.
CREATE TRIGGER app_control_revisions_sequence BEFORE INSERT ON app_control_revisions
WHEN NEW.revision <> COALESCE((SELECT MAX(r.revision) FROM app_control_revisions r WHERE r.series_id = NEW.series_id), 0) + 1
  OR NEW.prior_revision_id IS NOT (SELECT r.id FROM app_control_revisions r WHERE r.series_id = NEW.series_id ORDER BY r.revision DESC LIMIT 1)
  OR NOT EXISTS (SELECT 1 FROM app_control_series s WHERE s.id = NEW.series_id AND s.family = NEW.family AND s.scope_kind = NEW.scope_kind AND s.scope_json = NEW.scope_json)
  OR (NEW.operation = 'RELEASE' AND (SELECT r.operation FROM app_control_revisions r WHERE r.id = NEW.prior_revision_id) IS NOT 'SET')
BEGIN SELECT RAISE(ABORT, 'a control revision is exactly the next revision of its own series (stale, skipped or concurrent revisions are refused)'); END;

-- R3 in Strong v1: the revision is exactly its proposal, independently reviewed (a satisfied required ACTION review of
-- that fingerprint, which the maker never decided) and approved by the Founder who issues it (an APPROVED R3 approval of
-- that fingerprint). Review alone, approval alone, a changed act or a reused approval cannot issue.
CREATE TRIGGER app_control_revisions_r3_governed BEFORE INSERT ON app_control_revisions
WHEN NOT EXISTS (SELECT 1 FROM app_control_proposals p
                  WHERE p.id = NEW.proposal_id AND p.state = 'AWAITING_FOUNDER' AND p.family = NEW.family AND p.scope_kind = NEW.scope_kind AND p.scope_json = NEW.scope_json
                    AND p.operation = NEW.operation AND p.value_json IS NEW.value_json AND p.reason_code = NEW.reason_code AND p.expected_revision = NEW.revision - 1
                    AND p.review_request_id = NEW.review_request_id AND p.approval_id = NEW.approval_id AND 'employee:' || p.proposer_employee_id = NEW.proposer_ref)
  OR NOT EXISTS (SELECT 1 FROM review_requests q JOIN app_control_proposals p ON p.id = NEW.proposal_id
                  WHERE q.id = NEW.review_request_id AND q.kind = 'REQUIRED' AND q.subject_kind = 'ACTION' AND q.state = 'SATISFIED' AND q.risk_level = 'R3'
                    AND q.work_item_id = p.work_item_id AND q.subject_fingerprint = p.fingerprint AND q.subject_ref = 'app_control_proposal:' || p.id)
  OR EXISTS (SELECT 1 FROM review_decisions d JOIN review_assignments a ON a.id = d.assignment_id
              WHERE d.request_id = NEW.review_request_id AND d.counts = 1 AND 'employee:' || a.reviewer_employee_id = NEW.proposer_ref)
  OR NOT EXISTS (SELECT 1 FROM approvals x JOIN app_control_proposals p ON p.id = NEW.proposal_id
                  WHERE x.id = NEW.approval_id AND x.state = 'APPROVED' AND x.action = 'app-control.issue' AND x.risk_level = 'R3'
                    AND x.args_sha256 = p.fingerprint AND x.work_item_id = p.work_item_id AND x.decided_by_ref = NEW.issued_by_ref)
BEGIN SELECT RAISE(ABORT, 'an issued control is exactly its proposal, independently reviewed (never by its maker) and approved by the issuing Founder (R3)'); END;

-- The closed family / scope / value contract, held by the datastore (TypeScript bypassed or not): the family's own scope
-- kinds; scope identifiers that are short opaque codes (no user, PII, selector or expression); the family's one typed
-- value (no free text, no extra key, no repeated key); Remote Configuration only under an APPROVED register family;
-- Route Hold only a hold.
CREATE TRIGGER app_control_revisions_conform BEFORE INSERT ON app_control_revisions
WHEN NOT EXISTS (SELECT 1 FROM app_control_families f, json_each(f.scope_kinds_json) k WHERE f.family = NEW.family AND k.value = NEW.scope_kind)
  OR json_extract(NEW.scope_json, '$.kind') IS NOT NEW.scope_kind
  OR (SELECT COUNT(*) FROM json_each(NEW.scope_json)) <> (SELECT COUNT(DISTINCT key) FROM json_each(NEW.scope_json))
  OR (SELECT COUNT(*) FROM json_each(NEW.scope_json)) <> 1 + (CASE NEW.scope_kind WHEN 'APP' THEN 0 WHEN 'COHORT' THEN 2 WHEN 'PLATFORM_CAPABILITY' THEN 2 ELSE 1 END)
  OR EXISTS (SELECT 1 FROM json_each(NEW.scope_json) j WHERE j.key <> 'kind' AND NOT (
               (j.key = 'platform' AND NEW.scope_kind IN ('PLATFORM', 'PLATFORM_CAPABILITY') AND j.value IN ('IOS', 'ANDROID', 'WEB'))
            OR (j.key <> 'platform' AND j.type = 'text' AND length(j.value) BETWEEN 2 AND 64 AND j.value GLOB '[a-z]*' AND j.value NOT GLOB '*[^a-z0-9.-]*'
                AND j.value NOT GLOB '*[.-]' AND j.value NOT GLOB '*[.-][.-]*' AND j.value NOT GLOB '*[0-9][0-9][0-9][0-9][0-9][0-9]*'
                AND ((j.key = 'capability' AND NEW.scope_kind IN ('CAPABILITY', 'COHORT', 'PLATFORM_CAPABILITY')) OR (j.key = 'surface' AND NEW.scope_kind = 'SURFACE')
                  OR (j.key = 'cohort' AND NEW.scope_kind = 'COHORT') OR (j.key = 'provider' AND NEW.scope_kind = 'PROVIDER') OR (j.key = 'route' AND NEW.scope_kind = 'ROUTE')))))
  OR (NEW.value_json IS NOT NULL AND (SELECT COUNT(*) FROM json_each(NEW.value_json)) <> (SELECT COUNT(DISTINCT key) FROM json_each(NEW.value_json)))
  OR (NEW.operation = 'SET' AND NOT (CASE NEW.family
        WHEN 'FEATURE_FLAG' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 1 AND json_extract(NEW.value_json, '$.state') IN ('DISABLED', 'INTERNAL', 'LIMITED_ROLLOUT', 'ENABLED', 'EMERGENCY_DISABLED')
        WHEN 'KILL_SWITCH' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 1 AND json_extract(NEW.value_json, '$.effect') IS 'OUT_OF_SERVICE'
        WHEN 'MAINTENANCE_MODE' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 1 AND json_extract(NEW.value_json, '$.reason') IN ('PLANNED_MAINTENANCE', 'INFRASTRUCTURE_WORK', 'DATA_MIGRATION', 'INCIDENT_MITIGATION', 'DEPENDENCY_UNAVAILABLE', 'SECURITY_REMEDIATION')
        WHEN 'ROLLOUT_CONTROL' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 1 AND json_extract(NEW.value_json, '$.exposure') IN ('INTERNAL', 'LIMITED_ROLLOUT', 'ENABLED')
        WHEN 'MINIMUM_SUPPORTED_VERSION' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 1 AND json_type(NEW.value_json, '$.minVersion') = 'text'
             AND length(json_extract(NEW.value_json, '$.minVersion')) BETWEEN 5 AND 14
             AND json_extract(NEW.value_json, '$.minVersion') NOT GLOB '*[^0-9.]*' AND json_extract(NEW.value_json, '$.minVersion') NOT GLOB '*..*'
             AND json_extract(NEW.value_json, '$.minVersion') NOT GLOB '.*' AND json_extract(NEW.value_json, '$.minVersion') NOT GLOB '*.'
             AND json_extract(NEW.value_json, '$.minVersion') NOT GLOB '0[0-9]*' AND json_extract(NEW.value_json, '$.minVersion') NOT GLOB '*.0[0-9]*'
             AND json_extract(NEW.value_json, '$.minVersion') NOT GLOB '*[0-9][0-9][0-9][0-9][0-9]*'
             AND length(json_extract(NEW.value_json, '$.minVersion')) - length(replace(json_extract(NEW.value_json, '$.minVersion'), '.', '')) = 2
        WHEN 'APPROVED_REMOTE_CONFIGURATION' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 2 AND EXISTS (
             SELECT 1 FROM app_remote_config_families f, json_each(f.scope_kinds_json) k
              WHERE f.code = json_extract(NEW.value_json, '$.family') AND k.value = NEW.scope_kind AND (
                    (f.value_type = 'BOOLEAN' AND json_type(NEW.value_json, '$.value') IN ('true', 'false'))
                 OR (f.value_type = 'INTEGER' AND json_type(NEW.value_json, '$.value') = 'integer' AND json_extract(NEW.value_json, '$.value') BETWEEN f.min_value AND f.max_value)
                 OR (f.value_type = 'ENUM' AND json_type(NEW.value_json, '$.value') = 'text' AND EXISTS (SELECT 1 FROM json_each(f.enum_json) e WHERE e.value = json_extract(NEW.value_json, '$.value')))))
        WHEN 'ROUTE_HOLD' THEN (SELECT COUNT(*) FROM json_each(NEW.value_json)) = 1 AND json_extract(NEW.value_json, '$.hold') IS 'HELD'
        ELSE 0 END))
BEGIN SELECT RAISE(ABORT, 'a control revision must match its family''s closed scope and typed value (no free text, no extra field, no unapproved Remote Configuration, a Route Hold only holds)'); END;

-- Issued history is never updated or deleted (a later revision supersedes; a RELEASE removes the overlay).
CREATE TRIGGER app_control_revisions_append_only_u BEFORE UPDATE ON app_control_revisions BEGIN SELECT RAISE(ABORT, 'issued control revisions are append-only history'); END;
CREATE TRIGGER app_control_revisions_append_only_d BEFORE DELETE ON app_control_revisions BEGIN SELECT RAISE(ABORT, 'issued control revisions are append-only history'); END;

-- =====================================================================================================
-- 7. R-C7A-04, the Company-side part: refused intake is coalesced, not audited row by row. One counter per (registered
-- source id — or `unresolved` — , refusal reason code, hour window): the first refusal of a window is audited as before
-- (reason code only), the rest only count. Attacker-supplied strings never become a key (an unregistered key is
-- `unresolved`; the reason is a bounded code). Nothing of the refused payload is stored. Network / edge rate limiting is
-- NOT this: it stays with L1 / App-side Production Integration. History before this release is folded in from the audit.
-- =====================================================================================================
CREATE TABLE external_intake_refusal_windows (
  source_ref    TEXT    NOT NULL CHECK (source_ref = 'unresolved' OR length(source_ref) = 36),
  reason_code   TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64 AND reason_code NOT GLOB '*[^A-Z0-9_]*'),
  window_start  TEXT    NOT NULL CHECK (window_start GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:00:00.000Z'),
  refusals      INTEGER NOT NULL CHECK (refusals >= 1),
  first_at      TEXT    NOT NULL CHECK (first_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  last_at       TEXT    NOT NULL CHECK (last_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (source_ref, reason_code, window_start),
  CHECK (last_at >= first_at)
) STRICT, WITHOUT ROWID;
INSERT INTO external_intake_refusal_windows (source_ref, reason_code, window_start, refusals, first_at, last_at)
  SELECT CASE WHEN entity_id IN (SELECT id FROM external_sources) THEN entity_id ELSE 'unresolved' END,
         CASE WHEN reason_code IS NOT NULL AND length(reason_code) BETWEEN 1 AND 64 AND reason_code NOT GLOB '*[^A-Z0-9_]*' THEN reason_code ELSE 'OTHER' END,
         substr(occurred_at, 1, 13) || ':00:00.000Z', COUNT(*), MIN(occurred_at), MAX(occurred_at)
    FROM audit_events WHERE action = 'external.intake_rejected'
   GROUP BY 1, 2, 3;
-- A key is a registered source (or `unresolved`); a counter only grows, forward in time.
CREATE TRIGGER external_intake_refusal_windows_bounded_key BEFORE INSERT ON external_intake_refusal_windows
WHEN NEW.source_ref <> 'unresolved' AND NOT EXISTS (SELECT 1 FROM external_sources s WHERE s.id = NEW.source_ref)
BEGIN SELECT RAISE(ABORT, 'a refusal counter is keyed by a registered source id or unresolved, never by a supplied string'); END;
CREATE TRIGGER external_intake_refusal_windows_forward BEFORE UPDATE ON external_intake_refusal_windows
WHEN NEW.source_ref IS NOT OLD.source_ref OR NEW.reason_code IS NOT OLD.reason_code OR NEW.window_start IS NOT OLD.window_start OR NEW.first_at IS NOT OLD.first_at
  OR NEW.refusals <> OLD.refusals + 1 OR NEW.last_at < OLD.last_at
BEGIN SELECT RAISE(ABORT, 'a refusal counter only counts forward'); END;
CREATE TRIGGER external_intake_refusal_windows_no_delete BEFORE DELETE ON external_intake_refusal_windows BEGIN SELECT RAISE(ABORT, 'refusal counters are durable history'); END;

-- =====================================================================================================
-- 8. The provider-neutral outbox (0001 / 0012) gains one aggregate, `app_control` (proposals and issued revisions — ids,
-- families, operations and fingerprints only). One event system; no second bus, no transport.
-- =====================================================================================================
CREATE TEMP TABLE c4_copy_events AS SELECT * FROM main.events;
DROP TABLE main.events;
CREATE TABLE events (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT    NOT NULL UNIQUE CHECK (length(id) = 36),
  type            TEXT    NOT NULL CHECK (length(type) BETWEEN 1 AND 64),
  version         INTEGER NOT NULL CHECK (version >= 1),
  aggregate_type  TEXT    NOT NULL CHECK (aggregate_type IN ('work_item', 'job', 'run', 'artifact', 'runtime', 'backup', 'external_source', 'app_control')),
  aggregate_id    TEXT    NOT NULL CHECK (length(aggregate_id) = 36),
  correlation_id  TEXT    NOT NULL CHECK (length(correlation_id) = 36),
  causation_id    TEXT             CHECK (causation_id IS NULL OR length(causation_id) = 36),
  created_at      TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  payload_json    TEXT    NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 2048),
  dispatched_at   TEXT             CHECK (dispatched_at IS NULL OR dispatched_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  dispatch_count  INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_count >= 0)
) STRICT;
INSERT INTO events (seq, id, type, version, aggregate_type, aggregate_id, correlation_id, causation_id, created_at, payload_json, dispatched_at, dispatch_count)
  SELECT seq, id, type, version, aggregate_type, aggregate_id, correlation_id, causation_id, created_at, payload_json, dispatched_at, dispatch_count FROM temp.c4_copy_events;
DROP TABLE temp.c4_copy_events;
CREATE INDEX events_pending ON events (seq) WHERE dispatched_at IS NULL;
CREATE INDEX events_aggregate ON events (aggregate_id, seq);
CREATE TRIGGER events_envelope_immutable BEFORE UPDATE ON events
WHEN NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type OR NEW.version IS NOT OLD.version
  OR NEW.aggregate_type IS NOT OLD.aggregate_type OR NEW.aggregate_id IS NOT OLD.aggregate_id
  OR NEW.correlation_id IS NOT OLD.correlation_id OR NEW.causation_id IS NOT OLD.causation_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.payload_json IS NOT OLD.payload_json
BEGIN SELECT RAISE(ABORT, 'event envelopes are immutable; only delivery metadata changes'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are durable history'); END;
