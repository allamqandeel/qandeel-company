-- QANDEEL COMPANY operational schema — migration 0023: Skill Need Assessment results (G4-C2-SNA-01, D-P1-15).
-- IMMUTABLE once released (see 0001). Additive only: one new append-only table; no existing table, row or rule changes.
--
-- One durable, immutable decision per Founder reply: how much the reply needs each eligible Skill the Employee holds,
-- bound to the exact message (id + body hash), the exact Skill versions offered, the need card set and the classifier
-- prompt. The first writer wins (UNIQUE reply): the assessment's own result (MODEL), or the conservative fallback sealed
-- by the send (not provisioned), by the assessment (no valid answer) or by the reply (window passed / assessment ended).
-- A late result can never replace a decision the reply already planned with. Content-free: codes, ids and hashes only —
-- never the message, the cards or the model output (Rule A).

CREATE TABLE skill_need_assessments (
  id                       TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  reply_work_item_id       TEXT    NOT NULL UNIQUE REFERENCES work_items (id) ON DELETE RESTRICT,
  assessment_work_item_id  TEXT             REFERENCES work_items (id) ON DELETE RESTRICT,
  employee_id              TEXT    NOT NULL REFERENCES employees (id) ON DELETE RESTRICT,
  message_id               TEXT    NOT NULL REFERENCES communication_messages (id) ON DELETE RESTRICT,
  message_sha256           TEXT    NOT NULL CHECK (length(message_sha256) = 64 AND message_sha256 NOT GLOB '*[^0-9a-f]*'),
  policy                   TEXT    NOT NULL CHECK (policy GLOB 'SNA-[0-9]*' AND length(policy) <= 16),
  prompt_version           TEXT             CHECK (prompt_version IS NULL OR (length(prompt_version) BETWEEN 1 AND 16)),
  prompt_sha256            TEXT             CHECK (prompt_sha256 IS NULL OR (length(prompt_sha256) = 64 AND prompt_sha256 NOT GLOB '*[^0-9a-f]*')),
  cards_version            TEXT    NOT NULL CHECK (length(cards_version) BETWEEN 1 AND 16),
  cards_sha256             TEXT    NOT NULL CHECK (length(cards_sha256) = 64 AND cards_sha256 NOT GLOB '*[^0-9a-f]*'),
  offered_json             TEXT    NOT NULL CHECK (json_valid(offered_json) AND json_type(offered_json) = 'array' AND length(offered_json) <= 8192),
  source                   TEXT    NOT NULL CHECK (source IN ('MODEL', 'FALLBACK')),
  outcome                  TEXT    NOT NULL CHECK (length(outcome) BETWEEN 1 AND 32 AND outcome NOT GLOB '*[^A-Z_]*'),
  tiers_json               TEXT    NOT NULL CHECK (json_valid(tiers_json) AND json_type(tiers_json) = 'object' AND length(tiers_json) <= 4096),
  run_id                   TEXT             REFERENCES runs (id) ON DELETE RESTRICT,
  manifest_id              TEXT             REFERENCES context_manifests (id) ON DELETE RESTRICT,
  sealed_by                TEXT    NOT NULL CHECK (sealed_by IN ('SEND', 'ASSESSMENT', 'REPLY')),
  created_at               TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  -- Only a model result is a classification; it always names its assessment, run, manifest and prompt.
  CHECK ((source = 'MODEL') = (outcome = 'CLASSIFIED')),
  CHECK (source = 'FALLBACK' OR (sealed_by = 'ASSESSMENT' AND assessment_work_item_id IS NOT NULL AND run_id IS NOT NULL AND manifest_id IS NOT NULL AND prompt_sha256 IS NOT NULL))
) STRICT;

CREATE INDEX skill_need_assessments_assessment ON skill_need_assessments (assessment_work_item_id) WHERE assessment_work_item_id IS NOT NULL;

CREATE TRIGGER skill_need_assessments_append_only_u BEFORE UPDATE ON skill_need_assessments
BEGIN SELECT RAISE(ABORT, 'skill need assessments are append-only'); END;
CREATE TRIGGER skill_need_assessments_append_only_d BEFORE DELETE ON skill_need_assessments
BEGIN SELECT RAISE(ABORT, 'skill need assessments are append-only'); END;
