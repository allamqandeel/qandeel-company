-- QANDEEL COMPANY operational schema — migration 0017: L1 Academy attempt answers.
-- Append-only extension. Migrations 0001–0016 are unchanged.
--
-- An Academy answer is durable evidence produced by the candidate's governed run. It carries no
-- score, approval, calibration, probation decision or activation authority.

CREATE TABLE academy_attempt_answers (
  attempt_id       TEXT NOT NULL PRIMARY KEY REFERENCES academy_attempts (id) ON DELETE RESTRICT,
  work_item_id     TEXT NOT NULL UNIQUE REFERENCES work_items (id) ON DELETE RESTRICT,
  run_id           TEXT NOT NULL REFERENCES runs (id) ON DELETE RESTRICT,
  manifest_id      TEXT NOT NULL REFERENCES context_manifests (id) ON DELETE RESTRICT,
  step             INTEGER NOT NULL CHECK (step >= 0),
  answer           TEXT NOT NULL CHECK (length(answer) BETWEEN 1 AND 16000),
  answer_sha256    TEXT NOT NULL CHECK (length(answer_sha256) = 64 AND answer_sha256 NOT GLOB '*[^0-9a-f]*'),
  summary_code     TEXT NOT NULL CHECK (length(summary_code) BETWEEN 1 AND 64 AND summary_code NOT GLOB '*[^a-z0-9.-]*'),
  data_class       TEXT NOT NULL CHECK (data_class IN ('D0', 'D1', 'D2', 'D3', 'D4')),
  recorded_at      TEXT NOT NULL CHECK (recorded_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  UNIQUE (run_id, step)
) STRICT;

CREATE TRIGGER academy_attempt_answers_append_only_u BEFORE UPDATE ON academy_attempt_answers
BEGIN SELECT RAISE(ABORT, 'academy attempt answers are append-only evidence'); END;
CREATE TRIGGER academy_attempt_answers_append_only_d BEFORE DELETE ON academy_attempt_answers
BEGIN SELECT RAISE(ABORT, 'academy attempt answers are append-only evidence'); END;
