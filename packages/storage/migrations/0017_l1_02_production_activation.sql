-- QANDEEL COMPANY operational schema — migration 0017: L1-02 first production Company activation.
-- IMMUTABLE once released (see 0001). Migrations 0001–0016 are unchanged.
--
--   academy_packages          a release-pinned Academy package (code, version, exact digest) in this Company:
--                             QUALIFYING (its Skill versions registered, statically reviewed and benchmarked) →
--                             INSTALLED (the Founder's one install confirmation). Never re-created, never deleted.
--   academy_package_skills    which registered Skill version carries which package skill code.
--   skill_security_reviews    the deterministic STATIC security review of one Skill version (reviewer, checks, verdict;
--                             codes only). Append-only; it is honest about its scope (text-only native Skills).
--   skill_benchmark_runs      one bounded behavioural benchmark case run of one Skill version, WITH the exact version
--                             or as the BASELINE without it; scored only by the deterministic rubric (never a model).
--   run_benchmark_modes       the fenced SKILL_BENCHMARK execution mode of a run (the only path in which a SANDBOXED,
--                             not-yet-approved Skill version may enter a context). Append-only.
--   work_answers              the typed deliverable (bounded prose + closed decision facets) of an answer-bearing Work
--                             Item: an Academy attempt, a benchmark case, shadow work. Local governed business content
--                             (never telemetry); one per Work Item; append-only.
--   founder_action_previews   the governed confirmation gains the structured-only L1-02 intents (hire into a seat,
--                             trainee lifecycle steps, model access, package qualification and install, the Academy's
--                             Founder acts and the activation decision).
--
-- Conventions as in 0001: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete, append-only
-- history. No column stores a secret or a model's chain of thought.

CREATE TABLE academy_packages (
  id                   TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  code                 TEXT    NOT NULL CHECK (length(code) BETWEEN 2 AND 96),
  package_version      INTEGER NOT NULL CHECK (package_version BETWEEN 1 AND 10000),
  package_sha256       TEXT    NOT NULL CHECK (length(package_sha256) = 64 AND package_sha256 NOT GLOB '*[^0-9a-f]*'),
  role_ref             TEXT    NOT NULL CHECK (role_ref GLOB 'role:*' AND length(role_ref) <= 96),
  subject_employee_id  TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  state                TEXT    NOT NULL CHECK (state IN ('QUALIFYING', 'INSTALLED')),
  program_id           TEXT             REFERENCES academy_programs (id) ON DELETE RESTRICT,
  program_version_id   TEXT             REFERENCES academy_program_versions (id) ON DELETE RESTRICT,
  blueprint_id         TEXT             REFERENCES role_blueprints (id) ON DELETE RESTRICT,
  qualified_by_ref     TEXT    NOT NULL CHECK (qualified_by_ref GLOB 'founder:*'),
  installed_by_ref     TEXT             CHECK (installed_by_ref IS NULL OR installed_by_ref GLOB 'founder:*'),
  created_at           TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  installed_at         TEXT             CHECK (installed_at IS NULL OR installed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'INSTALLED') = (program_version_id IS NOT NULL AND program_id IS NOT NULL AND blueprint_id IS NOT NULL AND installed_by_ref IS NOT NULL AND installed_at IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX academy_packages_identity ON academy_packages (code, package_version);
CREATE TRIGGER academy_packages_no_delete BEFORE DELETE ON academy_packages BEGIN SELECT RAISE(ABORT, 'academy packages are history'); END;
CREATE TRIGGER academy_packages_forward_only BEFORE UPDATE ON academy_packages
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.package_version IS NOT OLD.package_version OR NEW.package_sha256 IS NOT OLD.package_sha256
  OR NEW.subject_employee_id IS NOT OLD.subject_employee_id OR NEW.qualified_by_ref IS NOT OLD.qualified_by_ref OR NEW.created_at IS NOT OLD.created_at
  OR OLD.state <> 'QUALIFYING' OR NEW.state <> 'INSTALLED'
BEGIN SELECT RAISE(ABORT, 'an academy package is installed once and never rewritten'); END;

CREATE TABLE academy_package_skills (
  package_id        TEXT NOT NULL REFERENCES academy_packages (id) ON DELETE RESTRICT,
  skill_code        TEXT NOT NULL CHECK (length(skill_code) BETWEEN 2 AND 96),
  skill_id          TEXT NOT NULL REFERENCES skills (id) ON DELETE RESTRICT,
  skill_version_id  TEXT NOT NULL REFERENCES skill_versions (id) ON DELETE RESTRICT,
  PRIMARY KEY (package_id, skill_code)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX academy_package_skills_version ON academy_package_skills (skill_version_id);
CREATE TRIGGER academy_package_skills_append_only_u BEFORE UPDATE ON academy_package_skills BEGIN SELECT RAISE(ABORT, 'package skills are append-only'); END;
CREATE TRIGGER academy_package_skills_append_only_d BEFORE DELETE ON academy_package_skills BEGIN SELECT RAISE(ABORT, 'package skills are append-only'); END;

CREATE TABLE skill_security_reviews (
  skill_version_id  TEXT    NOT NULL PRIMARY KEY REFERENCES skill_versions (id) ON DELETE RESTRICT,
  reviewer_ref      TEXT    NOT NULL CHECK (reviewer_ref GLOB 'system:*' AND length(reviewer_ref) <= 96),
  scope             TEXT    NOT NULL CHECK (scope IN ('TEXT_ONLY_NATIVE_SKILL')),
  checks_json       TEXT    NOT NULL CHECK (json_valid(checks_json) AND json_type(checks_json) = 'array' AND length(checks_json) <= 2048),
  passed            INTEGER NOT NULL CHECK (passed IN (0, 1)),
  reviewed_at       TEXT    NOT NULL CHECK (reviewed_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE TRIGGER skill_security_reviews_append_only_u BEFORE UPDATE ON skill_security_reviews BEGIN SELECT RAISE(ABORT, 'security reviews are append-only'); END;
CREATE TRIGGER skill_security_reviews_append_only_d BEFORE DELETE ON skill_security_reviews BEGIN SELECT RAISE(ABORT, 'security reviews are append-only'); END;

CREATE TABLE skill_benchmark_runs (
  id                TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  package_id        TEXT    NOT NULL REFERENCES academy_packages (id) ON DELETE RESTRICT,
  skill_version_id  TEXT    NOT NULL REFERENCES skill_versions (id) ON DELETE RESTRICT,
  case_code         TEXT    NOT NULL CHECK (length(case_code) BETWEEN 2 AND 96),
  arm               TEXT    NOT NULL CHECK (arm IN ('WITH_SKILL', 'BASELINE')),
  work_item_id      TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id       TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  state             TEXT    NOT NULL CHECK (state IN ('OPEN', 'SCORED', 'VOID')),
  checks_json       TEXT             CHECK (checks_json IS NULL OR (json_valid(checks_json) AND json_type(checks_json) = 'array' AND length(checks_json) <= 2048)),
  score_pct         INTEGER          CHECK (score_pct IS NULL OR score_pct BETWEEN 0 AND 100),
  passed            INTEGER          CHECK (passed IS NULL OR passed IN (0, 1)),
  void_reason       TEXT             CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 1 AND 64),
  created_at        TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  scored_at         TEXT             CHECK (scored_at IS NULL OR scored_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  CHECK ((state = 'SCORED') = (checks_json IS NOT NULL AND score_pct IS NOT NULL AND passed IS NOT NULL AND scored_at IS NOT NULL)),
  CHECK ((state = 'VOID') = (void_reason IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX skill_benchmark_runs_work_item ON skill_benchmark_runs (work_item_id);
-- One live (open or scored) run per version, case and arm: a voided run may be replaced, a scored one never.
CREATE UNIQUE INDEX skill_benchmark_runs_one_live ON skill_benchmark_runs (skill_version_id, case_code, arm) WHERE state <> 'VOID';
CREATE TRIGGER skill_benchmark_runs_no_delete BEFORE DELETE ON skill_benchmark_runs BEGIN SELECT RAISE(ABORT, 'benchmark runs are history'); END;
CREATE TRIGGER skill_benchmark_runs_decide_once BEFORE UPDATE ON skill_benchmark_runs
WHEN NEW.id IS NOT OLD.id OR NEW.package_id IS NOT OLD.package_id OR NEW.skill_version_id IS NOT OLD.skill_version_id OR NEW.case_code IS NOT OLD.case_code
  OR NEW.arm IS NOT OLD.arm OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.created_at IS NOT OLD.created_at
  OR OLD.state <> 'OPEN'
BEGIN SELECT RAISE(ABORT, 'a benchmark run is scored or voided exactly once'); END;

CREATE TABLE run_benchmark_modes (
  run_id            TEXT NOT NULL PRIMARY KEY REFERENCES runs (id) ON DELETE RESTRICT,
  benchmark_run_id  TEXT NOT NULL REFERENCES skill_benchmark_runs (id) ON DELETE RESTRICT,
  created_at        TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT, WITHOUT ROWID;
CREATE TRIGGER run_benchmark_modes_append_only_u BEFORE UPDATE ON run_benchmark_modes BEGIN SELECT RAISE(ABORT, 'run benchmark modes is append-only'); END;
CREATE TRIGGER run_benchmark_modes_append_only_d BEFORE DELETE ON run_benchmark_modes BEGIN SELECT RAISE(ABORT, 'run benchmark modes is append-only'); END;

CREATE TABLE work_answers (
  id            TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  work_item_id  TEXT    NOT NULL REFERENCES work_items (id) ON DELETE RESTRICT,
  run_id        TEXT    NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  employee_id   TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  body          TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 6000),
  body_sha256   TEXT    NOT NULL CHECK (length(body_sha256) = 64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'),
  facets_json   TEXT    NOT NULL CHECK (json_valid(facets_json) AND json_type(facets_json) = 'object' AND length(facets_json) <= 512),
  created_at    TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE UNIQUE INDEX work_answers_one_per_item ON work_answers (work_item_id);
CREATE TRIGGER work_answers_append_only_u BEFORE UPDATE ON work_answers BEGIN SELECT RAISE(ABORT, 'answers are append-only'); END;
CREATE TRIGGER work_answers_append_only_d BEFORE DELETE ON work_answers BEGIN SELECT RAISE(ABORT, 'answers are append-only'); END;

-- The governed confirmation gains the structured-only L1-02 intents (D-L1-13). The intent catalogue is a datastore CHECK
-- (0009 / 0011 / 0012 / 0014 / 0016 precedent): the table is recreated with the extended list, every row kept.
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
                                                         'ACADEMY_PROBATION_EVIDENCE', 'ACADEMY_PROBATION_REVIEW', 'ACADEMY_CALIBRATION', 'ACTIVATION_DECIDE')),
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
