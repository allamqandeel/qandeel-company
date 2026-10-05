-- QANDEEL COMPANY operational schema — migration 0016: L1-01 live-provider foundation.
-- IMMUTABLE once released (see 0001). Migrations 0001–0015 are unchanged.
--
--   price_card_schedules    the optional time-banded / cached-input billing basis of an immutable price card
--                           (off-peak rates, UTC peak windows, peak weekdays, published holidays, basis source + date).
--                           The card's own rates stay the PEAK, all-cache-miss reservation rates; a schedule only
--                           discounts them (datastore gate), and it is as immutable as the card it belongs to.
--   usage_records           + cached_input_tokens (a subset of input_tokens) and the billing_band the settlement
--                           applied (FLAT / PEAK / OFF_PEAK), so billed_micros is the truthful provider bill.
--   model_identity_checks   content-free, append-only qualification facts: what the provider said a model alias
--                           currently is (public name, limits) against what the Company expects (alias drift).
--
-- Conventions as in 0001: STRICT tables, UUID ids, fixed-width UTC text timestamps, no hard delete, append-only
-- history. Amounts are INTEGER micro-units / token counts; no accounting arithmetic is done in SQL. No column stores
-- a secret: the provider's credential stays an opaque `vault:<name>` reference on model_providers.

CREATE TABLE price_card_schedules (
  price_card_id                  TEXT    NOT NULL PRIMARY KEY REFERENCES price_cards (id) ON DELETE RESTRICT,
  billed_cached_input_per_mtok   INTEGER NOT NULL CHECK (billed_cached_input_per_mtok BETWEEN 0 AND 1000000000000000),
  off_peak_input_per_mtok        INTEGER NOT NULL CHECK (off_peak_input_per_mtok BETWEEN 0 AND 1000000000000000),
  off_peak_cached_input_per_mtok INTEGER NOT NULL CHECK (off_peak_cached_input_per_mtok BETWEEN 0 AND 1000000000000000),
  off_peak_output_per_mtok       INTEGER NOT NULL CHECK (off_peak_output_per_mtok BETWEEN 0 AND 1000000000000000),
  peak_windows_json              TEXT    NOT NULL CHECK (json_valid(peak_windows_json) AND json_type(peak_windows_json) = 'array' AND json_array_length(peak_windows_json) BETWEEN 1 AND 64 AND length(peak_windows_json) <= 4096),
  peak_weekdays_json             TEXT    NOT NULL CHECK (json_valid(peak_weekdays_json) AND json_type(peak_weekdays_json) = 'array' AND json_array_length(peak_weekdays_json) BETWEEN 1 AND 7),
  holiday_dates_json             TEXT    NOT NULL CHECK (json_valid(holiday_dates_json) AND json_type(holiday_dates_json) = 'array' AND json_array_length(holiday_dates_json) <= 64 AND length(holiday_dates_json) <= 4096),
  basis_source                   TEXT    NOT NULL CHECK (length(basis_source) BETWEEN 9 AND 256 AND basis_source GLOB 'https://*'),
  basis_date                     TEXT    NOT NULL CHECK (basis_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  created_at                     TEXT    NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE TRIGGER price_card_schedules_immutable_u BEFORE UPDATE ON price_card_schedules BEGIN SELECT RAISE(ABORT, 'price schedules are immutable; add a new price card version'); END;
CREATE TRIGGER price_card_schedules_immutable_d BEFORE DELETE ON price_card_schedules BEGIN SELECT RAISE(ABORT, 'price schedules are immutable; add a new price card version'); END;
-- A schedule only discounts: no off-peak or cached rate may exceed the card's peak (reservation) rate it discounts,
-- and only a METERED card may carry one (FREE / SUBSCRIPTION cards bill nothing per call).
CREATE TRIGGER price_card_schedules_never_above_peak BEFORE INSERT ON price_card_schedules
WHEN (SELECT billing_mode FROM price_cards WHERE id = NEW.price_card_id) IS NOT 'METERED'
  OR NEW.billed_cached_input_per_mtok > (SELECT billed_input_per_mtok FROM price_cards WHERE id = NEW.price_card_id)
  OR NEW.off_peak_input_per_mtok > (SELECT billed_input_per_mtok FROM price_cards WHERE id = NEW.price_card_id)
  OR NEW.off_peak_output_per_mtok > (SELECT billed_output_per_mtok FROM price_cards WHERE id = NEW.price_card_id)
  OR NEW.off_peak_cached_input_per_mtok > NEW.billed_cached_input_per_mtok
BEGIN SELECT RAISE(ABORT, 'a price schedule only discounts the card''s peak (reservation) rates'); END;

ALTER TABLE usage_records ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens BETWEEN 0 AND 1000000000000);
ALTER TABLE usage_records ADD COLUMN billing_band TEXT CHECK (billing_band IS NULL OR billing_band IN ('FLAT', 'PEAK', 'OFF_PEAK'));
-- Cached input is a subset of input: a settlement claiming more cache hits than input tokens is refused by the datastore.
CREATE TRIGGER usage_records_cached_within_input BEFORE INSERT ON usage_records
WHEN NEW.cached_input_tokens > NEW.input_tokens
BEGIN SELECT RAISE(ABORT, 'cached input tokens never exceed input tokens'); END;

CREATE TABLE model_identity_checks (
  id                         TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  provider_code              TEXT    NOT NULL CHECK (length(provider_code) BETWEEN 1 AND 64),
  model_code                 TEXT    NOT NULL CHECK (length(model_code) BETWEEN 1 AND 64),
  expected_name              TEXT    NOT NULL CHECK (length(expected_name) BETWEEN 1 AND 120),
  observed_name              TEXT             CHECK (observed_name IS NULL OR length(observed_name) BETWEEN 1 AND 120),
  observed_context_window    INTEGER          CHECK (observed_context_window IS NULL OR observed_context_window BETWEEN 1 AND 1000000000000),
  observed_max_output_tokens INTEGER          CHECK (observed_max_output_tokens IS NULL OR observed_max_output_tokens BETWEEN 1 AND 1000000000000),
  result                     TEXT    NOT NULL CHECK (result IN ('MATCH', 'DRIFT', 'MODEL_MISSING', 'UNREACHABLE', 'AUTH', 'BILLING', 'RATE_LIMITED', 'PROVIDER_ERROR', 'CONTRACT_VIOLATION', 'CREDENTIAL_UNAVAILABLE')),
  checked_at                 TEXT    NOT NULL CHECK (checked_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z')
) STRICT;
CREATE INDEX model_identity_checks_model ON model_identity_checks (provider_code, model_code, checked_at);
CREATE TRIGGER model_identity_checks_append_only_u BEFORE UPDATE ON model_identity_checks BEGIN SELECT RAISE(ABORT, 'identity checks are append-only'); END;
CREATE TRIGGER model_identity_checks_append_only_d BEFORE DELETE ON model_identity_checks BEGIN SELECT RAISE(ABORT, 'identity checks are append-only'); END;

-- The governed confirmation gains the structured-only PROVIDER_PROVISION intent (D-L1-06). The intent catalogue is a
-- datastore CHECK (0009 / 0011 / 0012 / 0014 precedent): the table is recreated with the extended list, every row kept.
CREATE TEMP TABLE c4_copy_founder_action_previews AS SELECT * FROM main.founder_action_previews;
DROP TABLE main.founder_action_previews;
CREATE TABLE founder_action_previews (
  id             TEXT    NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  session_id     TEXT    NOT NULL REFERENCES founder_sessions (id) ON DELETE RESTRICT,
  intent_kind    TEXT    NOT NULL CHECK (intent_kind IN ('APPROVAL_DECIDE', 'GOAL_APPROVE', 'GOAL_STATE', 'GOAL_PROPOSE', 'STAFFING_DECIDE', 'CONFLICT_RESOLVE', 'BUDGET_CEILING', 'DELEGATE_WORK',
                                                         'TOOL_RECONCILE', 'RESERVATION_RECONCILE', 'JOB_RECONCILE', 'REVIEW_ESCALATION_RESOLVE', 'SYSTEMIC_DECIDE', 'ATTRIBUTION_DECIDE', 'LESSON_DECIDE', 'OUTCOME_VERIFY', 'PROMOTION_DECIDE',
                                                         'SOURCE_REGISTER', 'SOURCE_DECIDE', 'EVIDENCE_BIND', 'EVIDENCE_UNBIND', 'OUTCOME_CONTEST_RESOLVE',
                                                         'PILOT_CREATE', 'PILOT_ADVANCE',
                                                         'PROVIDER_PROVISION')),
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
