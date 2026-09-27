-- QANDEEL COMPANY operational schema — migration 0003: durable wake generation (D-C1-23).
-- IMMUTABLE once released (see 0001).
--
-- The durable queue is the truth. The wake file watched through fs.watch is only a low-latency
-- hint, and the operating system does not guarantee its delivery. This single-row counter is the
-- lost-hint recovery truth: triggers advance it inside the same transaction as every queue change
-- that can make work newly actionable for a running runtime (a job becomes QUEUED or its due time
-- moves; termination is requested for a job). The Runtime Supervisor observes the counter on its
-- existing lease heartbeat and pumps when it moved, so a missed hint is discovered within one
-- heartbeat interval. No trigger reads time or calls a function.

CREATE TABLE runtime_wake (
  id          INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  generation  INTEGER NOT NULL CHECK (generation >= 0)
) STRICT;

INSERT INTO runtime_wake (id, generation) VALUES (1, 0);

CREATE TRIGGER runtime_wake_monotonic BEFORE UPDATE ON runtime_wake
WHEN NEW.generation <= OLD.generation OR NEW.id <> OLD.id
BEGIN SELECT RAISE(ABORT, 'wake generation only ever increases'); END;
CREATE TRIGGER runtime_wake_no_delete BEFORE DELETE ON runtime_wake
BEGIN SELECT RAISE(ABORT, 'the wake generation row is permanent'); END;

CREATE TRIGGER queue_jobs_wake_on_insert AFTER INSERT ON queue_jobs
WHEN NEW.state = 'QUEUED'
BEGIN UPDATE runtime_wake SET generation = generation + 1 WHERE id = 1; END;

CREATE TRIGGER queue_jobs_wake_on_update AFTER UPDATE ON queue_jobs
WHEN (NEW.state = 'QUEUED' AND (OLD.state <> 'QUEUED' OR NEW.available_at <> OLD.available_at))
  OR NEW.cancel_requested <> OLD.cancel_requested
BEGIN UPDATE runtime_wake SET generation = generation + 1 WHERE id = 1; END;
