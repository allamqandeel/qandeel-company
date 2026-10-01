-- QANDEEL COMPANY operational schema — migration 0012: C7-A Operational Data + External Outcome Core.
-- Governed sources of content-free operational facts (the frozen APP-OPS-01 domains) and of external outcome evidence
-- (search, web, store, business, campaign, social, App health); their versioned contracts; accepted, normalized,
-- provenance-bound records with replay / conflict detection; Founder bindings of a record to Company work or a Goal;
-- and the C6 seams those records feed (outcome verification, review-pool judgments, the outbox, the Founder's
-- governed confirmation). There is no raw payload anywhere: a record holds normalized, declared scalars only.
-- IMMUTABLE once released (see 0001). Migrations 0001–0011 are unchanged; objects they created are replaced here
-- only by the row-preserving rebuild of D-C4-01 (copied whole to TEMP, re-created, every row copied back BEFORE the
-- triggers are re-created; DROP TABLE's implicit delete fires no trigger; parent references deferred to COMMIT).
--
-- Conventions as in 0001–0011: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete, append-only
-- history, forward-only updates; ids, codes, counts and hashes only (Rules A / B / C).

PRAGMA defer_foreign_keys = ON;

-- =====================================================================================================
-- 1. Governed sources. A source is a stable identity (a provider-neutral key and family) whose lifecycle never
-- silently becomes trusted: DRAFT until the Founder ACTIVATEs it; SUSPENDED fails closed for new evidence and keeps
-- history; RETIRED is final. Nothing here stores a credential: a provider credential never enters SQLite.
-- =====================================================================================================
CREATE TABLE external_sources (
  id                    TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  source_key            TEXT    NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 3 AND 64 AND source_key NOT GLOB '*[^a-z0-9.-]*'),
  lane                  TEXT    NOT NULL CHECK (lane IN ('OPERATIONAL_EVENT', 'EXTERNAL_OUTCOME')),
  family                TEXT    NOT NULL CHECK (family IN ('APP_OPERATIONS', 'SEARCH', 'WEB_ANALYTICS', 'APP_STORE', 'BUSINESS', 'CAMPAIGN', 'SOCIAL', 'APP_HEALTH')),
  state                 TEXT    NOT NULL CHECK (state IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED')),
  registered_by_ref     TEXT    NOT NULL CHECK (registered_by_ref GLOB 'founder:*'),
  decided_by_ref        TEXT             CHECK (decided_by_ref IS NULL OR decided_by_ref GLOB 'founder:*'),
  decision_reason_code  TEXT             CHECK (decision_reason_code IS NULL OR length(decision_reason_code) BETWEEN 1 AND 64),
  version               INTEGER NOT NULL CHECK (version >= 1),
  created_at            TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at            TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  -- The App's operational stream is the operational lane; every other family is an outcome lane.
  CHECK ((lane = 'OPERATIONAL_EVENT') = (family = 'APP_OPERATIONS')),
  CHECK (state = 'DRAFT' OR (decided_by_ref IS NOT NULL AND decision_reason_code IS NOT NULL))
) STRICT;
CREATE INDEX external_sources_state ON external_sources (state);
CREATE TRIGGER external_sources_no_delete BEFORE DELETE ON external_sources BEGIN SELECT RAISE(ABORT, 'a governed source is retired, never deleted'); END;
CREATE TRIGGER external_sources_forward BEFORE UPDATE ON external_sources
WHEN NEW.id IS NOT OLD.id OR NEW.source_key IS NOT OLD.source_key OR NEW.lane IS NOT OLD.lane OR NEW.family IS NOT OLD.family
  OR NEW.registered_by_ref IS NOT OLD.registered_by_ref OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1
  OR OLD.state = 'RETIRED'
  OR (NEW.state IS NOT OLD.state AND NOT ((OLD.state = 'DRAFT' AND NEW.state IN ('ACTIVE', 'RETIRED'))
                                       OR (OLD.state = 'ACTIVE' AND NEW.state IN ('SUSPENDED', 'RETIRED'))
                                       OR (OLD.state = 'SUSPENDED' AND NEW.state IN ('ACTIVE', 'RETIRED'))))
BEGIN SELECT RAISE(ABORT, 'a governed source keeps its identity and moves forward only (RETIRED is final)'); END;

CREATE TABLE external_source_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    TEXT    NOT NULL REFERENCES external_sources (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT,
  to_state     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (actor_ref GLOB 'founder:*'),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (source_id, version)
) STRICT;
CREATE TRIGGER external_source_history_append_only_u BEFORE UPDATE ON external_source_history BEGIN SELECT RAISE(ABORT, 'source history is append-only'); END;
CREATE TRIGGER external_source_history_append_only_d BEFORE DELETE ON external_source_history BEGIN SELECT RAISE(ABORT, 'source history is append-only'); END;

-- A source's contract (a closed, versioned schema of the release, pinned by its digest). A new version supersedes
-- the current one for NEW intake; records keep the contract they were accepted under.
CREATE TABLE external_source_contracts (
  id                 TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  source_id          TEXT    NOT NULL REFERENCES external_sources (id) ON DELETE RESTRICT,
  contract_code      TEXT    NOT NULL CHECK (length(contract_code) BETWEEN 2 AND 48 AND contract_code NOT GLOB '*[^a-z0-9.-]*'),
  contract_version   INTEGER NOT NULL CHECK (contract_version BETWEEN 1 AND 10000),
  contract_sha256    TEXT    NOT NULL CHECK (length(contract_sha256) = 64 AND contract_sha256 NOT GLOB '*[^0-9a-f]*'),
  state              TEXT    NOT NULL CHECK (state IN ('CURRENT', 'SUPERSEDED')),
  registered_by_ref  TEXT    NOT NULL CHECK (registered_by_ref GLOB 'founder:*'),
  created_at         TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at         TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (source_id, contract_code, contract_version)
) STRICT;
CREATE UNIQUE INDEX external_source_contracts_one_current ON external_source_contracts (source_id) WHERE state = 'CURRENT';
CREATE TRIGGER external_source_contracts_no_delete BEFORE DELETE ON external_source_contracts BEGIN SELECT RAISE(ABORT, 'a source contract is superseded, never deleted'); END;
CREATE TRIGGER external_source_contracts_forward BEFORE UPDATE ON external_source_contracts
WHEN NEW.id IS NOT OLD.id OR NEW.source_id IS NOT OLD.source_id OR NEW.contract_code IS NOT OLD.contract_code OR NEW.contract_version IS NOT OLD.contract_version
  OR NEW.contract_sha256 IS NOT OLD.contract_sha256 OR NEW.registered_by_ref IS NOT OLD.registered_by_ref OR NEW.created_at IS NOT OLD.created_at
  OR OLD.state <> 'CURRENT' OR NEW.state <> 'SUPERSEDED'
BEGIN SELECT RAISE(ABORT, 'a source contract version is immutable; it is superseded once'); END;
CREATE TRIGGER external_source_contracts_live_source BEFORE INSERT ON external_source_contracts
WHEN NEW.state <> 'CURRENT' OR NOT EXISTS (SELECT 1 FROM external_sources s WHERE s.id = NEW.source_id AND s.state <> 'RETIRED')
BEGIN SELECT RAISE(ABORT, 'a contract version is registered CURRENT on a source that is not retired'); END;
-- Nothing becomes trusted without a contract to validate against.
CREATE TRIGGER external_sources_activation_needs_contract BEFORE UPDATE ON external_sources
WHEN NEW.state = 'ACTIVE' AND OLD.state <> 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM external_source_contracts c WHERE c.source_id = NEW.id AND c.state = 'CURRENT')
BEGIN SELECT RAISE(ABORT, 'a source is activated only with a current contract'); END;

-- =====================================================================================================
-- 2. Accepted records. One row per producer occurrence (source + producer event id): an exact replay is a no-op, a
-- different fingerprint under the same identity is a conflict (section 3) and never overwrites this row. Event time
-- (occurred_at, as the producer stated it) and receipt time (received_at) are distinct; arrival order is not truth.
-- `normalized_fields_json` holds declared scalar fields only — never a raw payload, never a pseudonym.
-- =====================================================================================================
CREATE TABLE external_records (
  id                      TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  source_id               TEXT    NOT NULL REFERENCES external_sources (id) ON DELETE RESTRICT,
  contract_id             TEXT    NOT NULL REFERENCES external_source_contracts (id) ON DELETE RESTRICT,
  producer_event_id       TEXT    NOT NULL CHECK (length(producer_event_id) BETWEEN 1 AND 128 AND producer_event_id NOT GLOB '*[^-A-Za-z0-9._:]*'),
  lane                    TEXT    NOT NULL CHECK (lane IN ('OPERATIONAL_EVENT', 'EXTERNAL_OUTCOME')),
  record_type             TEXT    NOT NULL CHECK (length(record_type) BETWEEN 3 AND 64 AND record_type GLOB '[a-z]*.[a-z]*' AND record_type NOT GLOB '*[^a-z0-9._]*'),
  domain                  TEXT    NOT NULL CHECK (length(domain) BETWEEN 3 AND 32 AND domain NOT GLOB '*[^A-Z_]*'),
  occurred_at             TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  received_at             TEXT    NOT NULL CHECK (received_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  scope_kind              TEXT             CHECK (scope_kind IS NULL OR scope_kind IN ('SITE', 'PAGE_GROUP', 'APP', 'STORE_LISTING', 'CAMPAIGN', 'SOCIAL_ACCOUNT', 'BUSINESS_LINE', 'RELEASE')),
  scope_ref               TEXT             CHECK (scope_ref IS NULL OR (length(scope_ref) BETWEEN 1 AND 48 AND scope_ref NOT GLOB '*[^-a-z0-9._]*')),
  window_from             TEXT             CHECK (window_from IS NULL OR window_from GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  window_to               TEXT             CHECK (window_to IS NULL OR window_to GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  value_num               REAL             CHECK (value_num IS NULL OR (value_num >= 0 AND value_num <= 1000000000000000)),
  unit                    TEXT             CHECK (unit IS NULL OR unit IN ('COUNT', 'RATIO', 'MONEY_MICROS', 'POSITION', 'RATING_MILLI', 'MILLISECONDS')),
  normalized_fields_json  TEXT    NOT NULL CHECK (json_valid(normalized_fields_json) AND json_type(normalized_fields_json) = 'object' AND length(normalized_fields_json) <= 1024),
  user_scoped             INTEGER NOT NULL CHECK (user_scoped IN (0, 1)),
  failure_signal          INTEGER NOT NULL CHECK (failure_signal IN (0, 1)),
  fingerprint             TEXT    NOT NULL CHECK (length(fingerprint) = 64 AND fingerprint NOT GLOB '*[^0-9a-f]*'),
  status                  TEXT    NOT NULL CHECK (status = 'ACCEPTED'),
  UNIQUE (source_id, producer_event_id),
  -- Lanes stay distinct: an outcome observation names its scope, value and unit; an operational fact has none of them.
  CHECK ((lane = 'EXTERNAL_OUTCOME') = (scope_kind IS NOT NULL AND scope_ref IS NOT NULL AND value_num IS NOT NULL AND unit IS NOT NULL)),
  CHECK (lane = 'EXTERNAL_OUTCOME' OR (window_from IS NULL AND window_to IS NULL)),
  CHECK ((window_from IS NULL) = (window_to IS NULL)),
  CHECK (window_from IS NULL OR (window_from < window_to AND window_to <= occurred_at)),
  CHECK (lane = 'OPERATIONAL_EVENT' OR (failure_signal = 0 AND user_scoped = 0))
) STRICT;
CREATE INDEX external_records_source ON external_records (source_id, received_at);
CREATE INDEX external_records_occurred ON external_records (lane, occurred_at);
CREATE TRIGGER external_records_append_only_u BEFORE UPDATE ON external_records BEGIN SELECT RAISE(ABORT, 'an accepted record is never rewritten (a conflicting replay is recorded, never applied)'); END;
CREATE TRIGGER external_records_append_only_d BEFORE DELETE ON external_records BEGIN SELECT RAISE(ABORT, 'accepted records are durable evidence'); END;
-- Only an ACTIVE governed source, under its CURRENT contract and lane, creates evidence.
CREATE TRIGGER external_records_governed_source BEFORE INSERT ON external_records
WHEN NOT EXISTS (SELECT 1 FROM external_sources s JOIN external_source_contracts c ON c.source_id = s.id
                 WHERE s.id = NEW.source_id AND c.id = NEW.contract_id AND s.state = 'ACTIVE' AND c.state = 'CURRENT' AND s.lane = NEW.lane)
BEGIN SELECT RAISE(ABORT, 'an external record is accepted only from an ACTIVE governed source under its current contract'); END;
-- No payload bag: declared field names only (never a user pseudonym), scalar values, identifier-shaped text.
CREATE TRIGGER external_records_fields_declared BEFORE INSERT ON external_records
WHEN EXISTS (SELECT 1 FROM json_each(NEW.normalized_fields_json) f
             WHERE f.key NOT IN ('service', 'state', 'errorClass', 'errorCode', 'release', 'platform', 'count', 'component', 'operation', 'p50Ms', 'p95Ms', 'sample',
                                 'provider', 'model', 'calls', 'path', 'category', 'costMicros', 'currency', 'units', 'feature', 'plan', 'active', 'started', 'cancelled',
                                 'ratio', 'store', 'averageMilli', 'ratingsCount', 'code')
                OR f.type NOT IN ('integer', 'real', 'text')
                OR (f.type = 'text' AND (length(f.value) > 48 OR f.value GLOB '*[^-A-Za-z0-9._]*')))
BEGIN SELECT RAISE(ABORT, 'a record holds declared, bounded scalar fields only (no payload, no free text, no pseudonym)'); END;

-- =====================================================================================================
-- 3. Conflicting replays: the same producer identity with a different fingerprint. Recorded (auditable), never
-- applied; the first accepted record stands and is no longer usable evidence while a conflict exists.
-- =====================================================================================================
CREATE TABLE external_record_conflicts (
  id                       TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  record_id                TEXT    NOT NULL REFERENCES external_records (id) ON DELETE RESTRICT,
  source_id                TEXT    NOT NULL REFERENCES external_sources (id) ON DELETE RESTRICT,
  conflicting_fingerprint  TEXT    NOT NULL CHECK (length(conflicting_fingerprint) = 64 AND conflicting_fingerprint NOT GLOB '*[^0-9a-f]*'),
  received_at              TEXT    NOT NULL CHECK (received_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (record_id, conflicting_fingerprint)
) STRICT;
CREATE INDEX external_record_conflicts_source ON external_record_conflicts (source_id, received_at);
CREATE TRIGGER external_record_conflicts_append_only_u BEFORE UPDATE ON external_record_conflicts BEGIN SELECT RAISE(ABORT, 'conflicts are append-only'); END;
CREATE TRIGGER external_record_conflicts_append_only_d BEFORE DELETE ON external_record_conflicts BEGIN SELECT RAISE(ABORT, 'conflicts are append-only'); END;
CREATE TRIGGER external_record_conflicts_differ BEFORE INSERT ON external_record_conflicts
WHEN NOT EXISTS (SELECT 1 FROM external_records x WHERE x.id = NEW.record_id AND x.source_id = NEW.source_id AND x.fingerprint <> NEW.conflicting_fingerprint)
BEGIN SELECT RAISE(ABORT, 'a conflict is a different fingerprint under an accepted record''s identity'); END;

-- =====================================================================================================
-- 4. Bindings: the Founder's explicit statement that an accepted record is relevant to a Company subject. No fuzzy
-- matching, no timing inference, no Employee self-binding. An operational fact is never outcome evidence; it may only
-- explain a Work Item's failure as an external dependency. Ending or superseding a binding keeps its history.
-- =====================================================================================================
CREATE TABLE external_evidence_bindings (
  id               TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  record_id        TEXT    NOT NULL REFERENCES external_records (id) ON DELETE RESTRICT,
  role             TEXT    NOT NULL CHECK (role IN ('OUTCOME_EVIDENCE', 'DEPENDENCY_FAILURE')),
  subject_kind     TEXT    NOT NULL CHECK (subject_kind IN ('WORK_ITEM', 'GOAL')),
  subject_id       TEXT    NOT NULL CHECK (length(subject_id) = 36),
  state            TEXT    NOT NULL CHECK (state IN ('ACTIVE', 'REVOKED', 'SUPERSEDED')),
  bound_by_ref     TEXT    NOT NULL CHECK (bound_by_ref GLOB 'founder:*'),
  reason_code      TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  ended_by_ref     TEXT             CHECK (ended_by_ref IS NULL OR ended_by_ref GLOB 'founder:*'),
  end_reason_code  TEXT             CHECK (end_reason_code IS NULL OR length(end_reason_code) BETWEEN 1 AND 64),
  superseded_by    TEXT             REFERENCES external_evidence_bindings (id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  version          INTEGER NOT NULL CHECK (version >= 1),
  created_at       TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  updated_at       TEXT    NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'ACTIVE') = (ended_by_ref IS NULL AND end_reason_code IS NULL)),
  CHECK ((state = 'SUPERSEDED') = (superseded_by IS NOT NULL)),
  CHECK (role = 'OUTCOME_EVIDENCE' OR subject_kind = 'WORK_ITEM')
) STRICT;
CREATE UNIQUE INDEX external_evidence_bindings_one_live ON external_evidence_bindings (record_id, role, subject_kind, subject_id) WHERE state = 'ACTIVE';
CREATE INDEX external_evidence_bindings_subject ON external_evidence_bindings (subject_kind, subject_id, state);
CREATE TRIGGER external_evidence_bindings_no_delete BEFORE DELETE ON external_evidence_bindings BEGIN SELECT RAISE(ABORT, 'a binding is ended, never deleted'); END;
CREATE TRIGGER external_evidence_bindings_forward BEFORE UPDATE ON external_evidence_bindings
WHEN NEW.id IS NOT OLD.id OR NEW.record_id IS NOT OLD.record_id OR NEW.role IS NOT OLD.role OR NEW.subject_kind IS NOT OLD.subject_kind
  OR NEW.subject_id IS NOT OLD.subject_id OR NEW.bound_by_ref IS NOT OLD.bound_by_ref OR NEW.reason_code IS NOT OLD.reason_code
  OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1 OR OLD.state <> 'ACTIVE' OR NEW.state NOT IN ('REVOKED', 'SUPERSEDED')
BEGIN SELECT RAISE(ABORT, 'a binding keeps what it bound; it is revoked or superseded once'); END;
-- A binding names an existing subject and a record that may play its role: outcome evidence is an outcome-lane
-- observation; a dependency failure is an operational fact that signals a failure, bound to a Work Item. The record
-- is unconflicted and its source ACTIVE (a suspended source's history is kept, never newly used).
CREATE TRIGGER external_evidence_bindings_governed BEFORE INSERT ON external_evidence_bindings
WHEN NEW.state <> 'ACTIVE'
  OR (NEW.subject_kind = 'WORK_ITEM' AND NOT EXISTS (SELECT 1 FROM work_items w WHERE w.id = NEW.subject_id))
  OR (NEW.subject_kind = 'GOAL' AND NOT EXISTS (SELECT 1 FROM goals g WHERE g.id = NEW.subject_id))
  OR NOT EXISTS (SELECT 1 FROM external_records x JOIN external_sources s ON s.id = x.source_id
                 WHERE x.id = NEW.record_id AND s.state = 'ACTIVE'
                   AND ((NEW.role = 'OUTCOME_EVIDENCE' AND x.lane = 'EXTERNAL_OUTCOME') OR (NEW.role = 'DEPENDENCY_FAILURE' AND x.lane = 'OPERATIONAL_EVENT' AND x.failure_signal = 1)))
  OR EXISTS (SELECT 1 FROM external_record_conflicts k WHERE k.record_id = NEW.record_id)
BEGIN SELECT RAISE(ABORT, 'a binding names an existing subject and an unconflicted record of an ACTIVE source that may play its role'); END;

CREATE TABLE external_binding_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  binding_id   TEXT    NOT NULL REFERENCES external_evidence_bindings (id) ON DELETE RESTRICT,
  version      INTEGER NOT NULL CHECK (version >= 1),
  from_state   TEXT,
  to_state     TEXT    NOT NULL,
  reason_code  TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  actor_ref    TEXT    NOT NULL CHECK (actor_ref GLOB 'founder:*'),
  occurred_at  TEXT    NOT NULL CHECK (occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (binding_id, version)
) STRICT;
CREATE TRIGGER external_binding_history_append_only_u BEFORE UPDATE ON external_binding_history BEGIN SELECT RAISE(ABORT, 'binding history is append-only'); END;
CREATE TRIGGER external_binding_history_append_only_d BEFORE DELETE ON external_binding_history BEGIN SELECT RAISE(ABORT, 'binding history is append-only'); END;

-- =====================================================================================================
-- 5. C6 outcome verification (0010) replaces its pre-C7 refusal ("no EXTERNAL_OUTCOME", a CHECK) with the governed
-- rule: EXTERNAL_OUTCOME is cited exactly when the verification cites `external_record:<id>` references, and every
-- such reference is USABLE for the verified Work Item — an outcome-lane record of an ACTIVE source, unconflicted,
-- under an ACTIVE OUTCOME_EVIDENCE binding to that Work Item. No source / evidence: the class stays refused.
-- Verifier authority is unchanged (the 0010 triggers are re-created exactly).
-- =====================================================================================================
CREATE TEMP TABLE c4_copy_outcome_verifications AS SELECT * FROM main.outcome_verifications;
DROP TABLE main.outcome_verifications;
CREATE TABLE outcome_verifications (
  id                     TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id           TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  verdict                TEXT    NOT NULL CHECK (verdict IN ('ACHIEVED', 'NOT_ACHIEVED', 'INCONCLUSIVE')),
  evidence_classes_json  TEXT    NOT NULL CHECK (json_valid(evidence_classes_json) AND json_type(evidence_classes_json) = 'array' AND json_array_length(evidence_classes_json) >= 1 AND length(evidence_classes_json) <= 512),
  evidence_refs_json     TEXT    NOT NULL CHECK (json_valid(evidence_refs_json) AND json_type(evidence_refs_json) = 'array' AND json_array_length(evidence_refs_json) >= 1 AND length(evidence_refs_json) <= 4096),
  verifier_kind          TEXT    NOT NULL CHECK (verifier_kind IN ('FOUNDER', 'REVIEW_POOL')),
  verifier_ref           TEXT    NOT NULL CHECK (verifier_ref GLOB 'founder:*' OR verifier_ref GLOB 'review_request:*'),
  review_request_id      TEXT             REFERENCES review_requests (id) ON DELETE RESTRICT,
  reason_code            TEXT    NOT NULL CHECK (length(reason_code) BETWEEN 1 AND 64),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((verifier_kind = 'FOUNDER') = (verifier_ref GLOB 'founder:*')),
  CHECK ((verifier_kind = 'REVIEW_POOL') = (review_request_id IS NOT NULL)),
  CHECK (review_request_id IS NULL OR verifier_ref = 'review_request:' || review_request_id)
) STRICT;
INSERT INTO outcome_verifications (id, work_item_id, verdict, evidence_classes_json, evidence_refs_json, verifier_kind, verifier_ref, review_request_id, reason_code, created_at)
  SELECT id, work_item_id, verdict, evidence_classes_json, evidence_refs_json, verifier_kind, verifier_ref, review_request_id, reason_code, created_at FROM temp.c4_copy_outcome_verifications;
DROP TABLE temp.c4_copy_outcome_verifications;
CREATE UNIQUE INDEX outcome_verifications_one_decisive ON outcome_verifications (work_item_id) WHERE verdict <> 'INCONCLUSIVE';
CREATE TRIGGER outcome_verifications_append_only_u BEFORE UPDATE ON outcome_verifications BEGIN SELECT RAISE(ABORT, 'outcome verifications are append-only'); END;
CREATE TRIGGER outcome_verifications_append_only_d BEFORE DELETE ON outcome_verifications BEGIN SELECT RAISE(ABORT, 'outcome verifications are append-only'); END;
CREATE TRIGGER outcome_verifications_need_review BEFORE INSERT ON outcome_verifications
WHEN NOT EXISTS (SELECT 1 FROM work_items w WHERE w.id = NEW.work_item_id AND w.state IN ('REVIEWED', 'OUTCOME_VERIFIED', 'CLOSED'))
BEGIN SELECT RAISE(ABORT, 'an outcome is verified only after independent review'); END;
CREATE TRIGGER outcome_verifications_by_review_keys BEFORE INSERT ON outcome_verifications
WHEN NEW.verifier_kind = 'REVIEW_POOL' AND (
     NOT EXISTS (SELECT 1 FROM review_requests r JOIN review_plans p ON p.id = r.plan_id
                 WHERE r.id = NEW.review_request_id AND r.work_item_id = NEW.work_item_id AND r.kind = 'REQUIRED' AND r.subject_kind = 'OUTPUT'
                   AND r.state = 'SATISFIED' AND r.risk_level <> 'R4' AND p.operational_judgment = 'REVIEW_POOL')
  OR (NEW.verdict <> 'INCONCLUSIVE' AND EXISTS (SELECT 1 FROM review_decisions d WHERE d.request_id = NEW.review_request_id AND d.counts = 1 AND d.outcome = 'PASS'
                 AND NOT EXISTS (SELECT 1 FROM review_outcome_judgments j WHERE j.decision_id = d.id AND j.verdict = NEW.verdict))))
BEGIN SELECT RAISE(ABORT, 'a pool verification rests on a satisfied review whose passing keys all judged this verdict'); END;
CREATE TRIGGER outcome_verifications_external_evidence_governed BEFORE INSERT ON outcome_verifications
WHEN (EXISTS (SELECT 1 FROM json_each(NEW.evidence_classes_json) c WHERE c.value = 'EXTERNAL_OUTCOME')
      AND NOT EXISTS (SELECT 1 FROM json_each(NEW.evidence_refs_json) r WHERE r.value GLOB 'external_record:*'))
  OR (EXISTS (SELECT 1 FROM json_each(NEW.evidence_refs_json) r WHERE r.value GLOB 'external_record:*')
      AND NOT EXISTS (SELECT 1 FROM json_each(NEW.evidence_classes_json) c WHERE c.value = 'EXTERNAL_OUTCOME'))
  OR EXISTS (SELECT 1 FROM json_each(NEW.evidence_refs_json) r WHERE r.value GLOB 'external_record:*' AND NOT EXISTS (
       SELECT 1 FROM external_records x JOIN external_sources s ON s.id = x.source_id JOIN external_evidence_bindings b ON b.record_id = x.id
        WHERE 'external_record:' || x.id = r.value AND x.lane = 'EXTERNAL_OUTCOME' AND s.state = 'ACTIVE'
          AND b.state = 'ACTIVE' AND b.role = 'OUTCOME_EVIDENCE' AND b.subject_kind = 'WORK_ITEM' AND b.subject_id = NEW.work_item_id
          AND NOT EXISTS (SELECT 1 FROM external_record_conflicts k WHERE k.record_id = x.id)))
BEGIN SELECT RAISE(ABORT, 'EXTERNAL_OUTCOME is cited only with usable governed evidence bound to this Work Item'); END;

-- The review-pool judgment companion (0010): a reviewer may judge from EXTERNAL_OUTCOME only when its own counting
-- decision cites usable governed evidence bound to the reviewed Work Item.
CREATE TEMP TABLE c4_copy_review_outcome_judgments AS SELECT * FROM main.review_outcome_judgments;
DROP TABLE main.review_outcome_judgments;
CREATE TABLE review_outcome_judgments (
  decision_id            TEXT    NOT NULL PRIMARY KEY REFERENCES review_decisions (id) ON DELETE RESTRICT,
  request_id             TEXT    NOT NULL REFERENCES review_requests (id) ON DELETE RESTRICT,
  verdict                TEXT    NOT NULL CHECK (verdict IN ('ACHIEVED', 'NOT_ACHIEVED', 'INCONCLUSIVE')),
  evidence_classes_json  TEXT    NOT NULL CHECK (json_valid(evidence_classes_json) AND json_type(evidence_classes_json) = 'array' AND json_array_length(evidence_classes_json) BETWEEN 1 AND 8 AND length(evidence_classes_json) <= 512),
  created_at             TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
INSERT INTO review_outcome_judgments (decision_id, request_id, verdict, evidence_classes_json, created_at)
  SELECT decision_id, request_id, verdict, evidence_classes_json, created_at FROM temp.c4_copy_review_outcome_judgments;
DROP TABLE temp.c4_copy_review_outcome_judgments;
CREATE INDEX review_outcome_judgments_request ON review_outcome_judgments (request_id);
CREATE TRIGGER review_outcome_judgments_append_only_u BEFORE UPDATE ON review_outcome_judgments BEGIN SELECT RAISE(ABORT, 'outcome judgments are append-only'); END;
CREATE TRIGGER review_outcome_judgments_append_only_d BEFORE DELETE ON review_outcome_judgments BEGIN SELECT RAISE(ABORT, 'outcome judgments are append-only'); END;
CREATE TRIGGER review_outcome_judgments_of_counting_review BEFORE INSERT ON review_outcome_judgments
WHEN NOT EXISTS (SELECT 1 FROM review_decisions d JOIN review_requests r ON r.id = d.request_id JOIN work_items w ON w.id = r.work_item_id
                 WHERE d.id = NEW.decision_id AND d.request_id = NEW.request_id AND d.counts = 1 AND d.reviewer_employee_id IS NOT NULL
                   AND r.kind = 'REQUIRED' AND r.subject_kind = 'OUTPUT' AND w.owner_ref IS NOT 'employee:' || d.reviewer_employee_id)
BEGIN SELECT RAISE(ABORT, 'an outcome judgment belongs to an independent counting output review decision'); END;
CREATE TRIGGER review_outcome_judgments_external_evidence_governed BEFORE INSERT ON review_outcome_judgments
WHEN EXISTS (SELECT 1 FROM json_each(NEW.evidence_classes_json) c WHERE c.value = 'EXTERNAL_OUTCOME')
 AND (NOT EXISTS (SELECT 1 FROM review_decisions d, json_each(d.evidence_refs_json) r WHERE d.id = NEW.decision_id AND r.value GLOB 'external_record:*')
   OR EXISTS (SELECT 1 FROM review_decisions d JOIN review_requests q ON q.id = d.request_id, json_each(d.evidence_refs_json) r
               WHERE d.id = NEW.decision_id AND r.value GLOB 'external_record:*' AND NOT EXISTS (
                 SELECT 1 FROM external_records x JOIN external_sources s ON s.id = x.source_id JOIN external_evidence_bindings b ON b.record_id = x.id
                  WHERE 'external_record:' || x.id = r.value AND x.lane = 'EXTERNAL_OUTCOME' AND s.state = 'ACTIVE'
                    AND b.state = 'ACTIVE' AND b.role = 'OUTCOME_EVIDENCE' AND b.subject_kind = 'WORK_ITEM' AND b.subject_id = q.work_item_id
                    AND NOT EXISTS (SELECT 1 FROM external_record_conflicts k WHERE k.record_id = x.id))))
BEGIN SELECT RAISE(ABORT, 'a judgment cites EXTERNAL_OUTCOME only with usable governed evidence bound to the reviewed Work Item'); END;

-- =====================================================================================================
-- 6. The provider-neutral outbox (0001) gains one aggregate, `external_source` (the C7-A source lifecycle, accepted
-- records, conflicts and bindings — ids, codes and counts only). One event system; no second bus.
-- =====================================================================================================
CREATE TEMP TABLE c4_copy_events AS SELECT * FROM main.events;
DROP TABLE main.events;
CREATE TABLE events (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  id              TEXT    NOT NULL UNIQUE CHECK (length(id) = 36),
  type            TEXT    NOT NULL CHECK (length(type) BETWEEN 1 AND 64),
  version         INTEGER NOT NULL CHECK (version >= 1),
  aggregate_type  TEXT    NOT NULL CHECK (aggregate_type IN ('work_item', 'job', 'run', 'artifact', 'runtime', 'backup', 'external_source')),
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

-- =====================================================================================================
-- 7. The Founder's governed confirmation (0009 / 0011) gains the C7-A structured intents: registering a source or a
-- new contract version, deciding its lifecycle, and binding / unbinding evidence. Same rebuild as R2-21.
-- =====================================================================================================
CREATE TEMP TABLE c4_copy_founder_action_previews AS SELECT * FROM main.founder_action_previews;
DROP TABLE main.founder_action_previews;
CREATE TABLE founder_action_previews (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  session_id     TEXT    NOT NULL REFERENCES founder_sessions (id) ON DELETE RESTRICT,
  intent_kind    TEXT    NOT NULL CHECK (intent_kind IN ('APPROVAL_DECIDE', 'GOAL_APPROVE', 'GOAL_STATE', 'GOAL_PROPOSE', 'STAFFING_DECIDE', 'CONFLICT_RESOLVE', 'BUDGET_CEILING', 'DELEGATE_WORK',
                                                         'TOOL_RECONCILE', 'RESERVATION_RECONCILE', 'JOB_RECONCILE', 'REVIEW_ESCALATION_RESOLVE', 'SYSTEMIC_DECIDE', 'ATTRIBUTION_DECIDE', 'LESSON_DECIDE', 'OUTCOME_VERIFY', 'PROMOTION_DECIDE',
                                                         'SOURCE_REGISTER', 'SOURCE_DECIDE', 'EVIDENCE_BIND', 'EVIDENCE_UNBIND')),
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
