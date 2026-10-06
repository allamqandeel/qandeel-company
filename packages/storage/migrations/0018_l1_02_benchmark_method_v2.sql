-- QANDEEL COMPANY operational schema — migration 0018: L1-02 Benchmark Qualification Method v2 (D-L1-23).
-- IMMUTABLE once released (see 0001). Migrations 0001–0017 are unchanged.
--
-- Evidence becomes self-describing; nothing existing is reinterpreted. Every default below describes the rows that exist
-- before this migration truthfully: packages v1, v2 and v3 were qualified by BQM-1, each of their benchmark runs is the
-- single observation of its case and arm, scored (or still to be scored) by rubric R1; no answer recorded before this
-- migration recorded its ANSWER-contract version (NULL = unrecorded — the AC-1/2/3 history is documented, never
-- back-filled).
--
--   academy_packages       + benchmark_method          BQM-1 | BQM-2 (pinned at registration, never rewritten)
--                          + method_sha256             the pinned BQM-2 declaration digest (NULL for BQM-1)
--                          + answer_contract_version   the pinned ANSWER-contract version (NULL for BQM-1)
--                          + answer_contract_sha256    the pinned ANSWER-contract digest (NULL for BQM-1)
--   skill_benchmark_runs   + observation_no            1..5 (BQM-1 rows: 1)
--                          + rubric_version            R1 | R2 (BQM-1 rows: R1; fixed at creation)
--                          + answered_class            the reasoning class of the call that produced the observation's
--                                                      outcome (written once, with the score; NULL for BQM-1 rows)
--                          + observation_outcome       ANSWERED | INVALID_OUTPUT (written once, with the score)
--   work_answers           + answer_contract_version / answer_contract_sha256 of the build that recorded the answer
--
-- The one-live index moves to (version, case, arm, observation): a voided observation may be replaced, a scored one
-- never. The decide-once and forward-only triggers are recreated to cover the new columns.

ALTER TABLE academy_packages ADD COLUMN benchmark_method TEXT NOT NULL DEFAULT 'BQM-1' CHECK (benchmark_method IN ('BQM-1', 'BQM-2'));
ALTER TABLE academy_packages ADD COLUMN method_sha256 TEXT CHECK (method_sha256 IS NULL OR (length(method_sha256) = 64 AND method_sha256 NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE academy_packages ADD COLUMN answer_contract_version TEXT CHECK (answer_contract_version IS NULL OR answer_contract_version GLOB 'AC-[1-9]*');
ALTER TABLE academy_packages ADD COLUMN answer_contract_sha256 TEXT CHECK (answer_contract_sha256 IS NULL OR (length(answer_contract_sha256) = 64 AND answer_contract_sha256 NOT GLOB '*[^0-9a-f]*'));

DROP TRIGGER academy_packages_forward_only;
CREATE TRIGGER academy_packages_forward_only BEFORE UPDATE ON academy_packages
WHEN NEW.id IS NOT OLD.id OR NEW.code IS NOT OLD.code OR NEW.package_version IS NOT OLD.package_version OR NEW.package_sha256 IS NOT OLD.package_sha256
  OR NEW.subject_employee_id IS NOT OLD.subject_employee_id OR NEW.qualified_by_ref IS NOT OLD.qualified_by_ref OR NEW.created_at IS NOT OLD.created_at
  OR NEW.benchmark_method IS NOT OLD.benchmark_method OR NEW.method_sha256 IS NOT OLD.method_sha256
  OR NEW.answer_contract_version IS NOT OLD.answer_contract_version OR NEW.answer_contract_sha256 IS NOT OLD.answer_contract_sha256
  OR OLD.state <> 'QUALIFYING' OR NEW.state <> 'INSTALLED'
BEGIN SELECT RAISE(ABORT, 'an academy package is installed once and never rewritten'); END;
-- A BQM-2 package carries all three pins; a BQM-1 package carries none.
CREATE TRIGGER academy_packages_method_pins BEFORE INSERT ON academy_packages
WHEN (NEW.benchmark_method = 'BQM-2') <> (NEW.method_sha256 IS NOT NULL AND NEW.answer_contract_version IS NOT NULL AND NEW.answer_contract_sha256 IS NOT NULL)
  OR (NEW.benchmark_method = 'BQM-1' AND (NEW.method_sha256 IS NOT NULL OR NEW.answer_contract_version IS NOT NULL OR NEW.answer_contract_sha256 IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'a BQM-2 package pins its method and ANSWER contract; a BQM-1 package pins neither'); END;

ALTER TABLE skill_benchmark_runs ADD COLUMN observation_no INTEGER NOT NULL DEFAULT 1 CHECK (observation_no BETWEEN 1 AND 5);
ALTER TABLE skill_benchmark_runs ADD COLUMN rubric_version TEXT NOT NULL DEFAULT 'R1' CHECK (rubric_version IN ('R1', 'R2'));
ALTER TABLE skill_benchmark_runs ADD COLUMN answered_class TEXT CHECK (answered_class IS NULL OR answered_class IN ('E0', 'E1', 'E2', 'E3', 'E4'));
ALTER TABLE skill_benchmark_runs ADD COLUMN observation_outcome TEXT CHECK (observation_outcome IS NULL OR observation_outcome IN ('ANSWERED', 'INVALID_OUTPUT'));

DROP INDEX skill_benchmark_runs_one_live;
-- One live (open or scored) observation per version, case, arm and observation number: a voided one may be replaced, a
-- scored one never. BQM-1 rows (observation 1) keep exactly their previous one-live meaning.
CREATE UNIQUE INDEX skill_benchmark_runs_one_live ON skill_benchmark_runs (skill_version_id, case_code, arm, observation_no) WHERE state <> 'VOID';

DROP TRIGGER skill_benchmark_runs_decide_once;
CREATE TRIGGER skill_benchmark_runs_decide_once BEFORE UPDATE ON skill_benchmark_runs
WHEN NEW.id IS NOT OLD.id OR NEW.package_id IS NOT OLD.package_id OR NEW.skill_version_id IS NOT OLD.skill_version_id OR NEW.case_code IS NOT OLD.case_code
  OR NEW.arm IS NOT OLD.arm OR NEW.work_item_id IS NOT OLD.work_item_id OR NEW.employee_id IS NOT OLD.employee_id OR NEW.created_at IS NOT OLD.created_at
  OR NEW.observation_no IS NOT OLD.observation_no OR NEW.rubric_version IS NOT OLD.rubric_version
  OR OLD.state <> 'OPEN'
BEGIN SELECT RAISE(ABORT, 'a benchmark run is scored or voided exactly once'); END;

ALTER TABLE work_answers ADD COLUMN answer_contract_version TEXT CHECK (answer_contract_version IS NULL OR answer_contract_version GLOB 'AC-[1-9]*');
ALTER TABLE work_answers ADD COLUMN answer_contract_sha256 TEXT CHECK (answer_contract_sha256 IS NULL OR (length(answer_contract_sha256) = 64 AND answer_contract_sha256 NOT GLOB '*[^0-9a-f]*'));
