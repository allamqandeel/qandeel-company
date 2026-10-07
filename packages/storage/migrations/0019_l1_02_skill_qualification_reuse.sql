-- QANDEEL COMPANY operational schema — migration 0019: L1-02 reusable Skill qualification (D-L1-27).
-- IMMUTABLE once released (see 0001). Migrations 0001–0018 are unchanged.
--
-- A Skill Version is qualified ONCE, on its own immutable evidence, inside the one package that OWNS that qualification:
-- `academy_package_skills` keeps exactly that meaning (0017: one row per version — the one-version-one-owner index is
-- unchanged). A later package may CONSUME an already-qualified version instead of qualifying a new one: that is a
-- separate, append-only binding here, so provenance is never ambiguous —
--
--   academy_package_skills         QUALIFY_NEW   the package owns the version's qualification (review + benchmark rows)
--   academy_package_skill_reuses   REUSE_QUALIFIED  the package consumes a version owned by `source_package_id`, bound
--                                                 to the version's qualification fingerprint (SQF-1) and to the digest of
--                                                 the owner's scored evidence at the moment of binding
--
-- Many packages may reuse one version (many-to-one consumption); it still has exactly one owner. A package binds each of
-- its Skill codes exactly once, by one of the two relations, never both. Nothing existing is rewritten: no package of
-- v1–v4 has a reuse row, and every existing row keeps its meaning.

CREATE TABLE academy_package_skill_reuses (
  package_id                 TEXT NOT NULL REFERENCES academy_packages (id) ON DELETE RESTRICT,
  skill_code                 TEXT NOT NULL CHECK (length(skill_code) BETWEEN 2 AND 96),
  skill_id                   TEXT NOT NULL REFERENCES skills (id) ON DELETE RESTRICT,
  skill_version_id           TEXT NOT NULL REFERENCES skill_versions (id) ON DELETE RESTRICT,
  source_package_id          TEXT NOT NULL REFERENCES academy_packages (id) ON DELETE RESTRICT,
  qualification_fingerprint  TEXT NOT NULL CHECK (length(qualification_fingerprint) = 64 AND qualification_fingerprint NOT GLOB '*[^0-9a-f]*'),
  evidence_sha256            TEXT NOT NULL CHECK (length(evidence_sha256) = 64 AND evidence_sha256 NOT GLOB '*[^0-9a-f]*'),
  bound_by_ref               TEXT NOT NULL CHECK (bound_by_ref GLOB 'founder:*'),
  bound_at                   TEXT NOT NULL CHECK (bound_at GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9].[0-9][0-9][0-9]Z'),
  PRIMARY KEY (package_id, skill_code),
  CHECK (source_package_id <> package_id)
) STRICT, WITHOUT ROWID;
-- One binding per Skill identity per package (no duplicate semantic Skill through reuse).
CREATE UNIQUE INDEX academy_package_skill_reuses_identity ON academy_package_skill_reuses (package_id, skill_id);
CREATE INDEX academy_package_skill_reuses_version ON academy_package_skill_reuses (skill_version_id);
CREATE TRIGGER academy_package_skill_reuses_append_only_u BEFORE UPDATE ON academy_package_skill_reuses BEGIN SELECT RAISE(ABORT, 'package skill reuses are append-only'); END;
CREATE TRIGGER academy_package_skill_reuses_append_only_d BEFORE DELETE ON academy_package_skill_reuses BEGIN SELECT RAISE(ABORT, 'package skill reuses are append-only'); END;
-- The source must be the version's one qualification owner (same Skill code and identity), registered under BQM-2 (BQM-1
-- evidence is never reusable); and the consuming package must not also own a qualification for the same Skill code.
CREATE TRIGGER academy_package_skill_reuses_provenance BEFORE INSERT ON academy_package_skill_reuses
WHEN NOT EXISTS (SELECT 1 FROM academy_package_skills o JOIN academy_packages p ON p.id = o.package_id
                 WHERE o.package_id = NEW.source_package_id AND o.skill_version_id = NEW.skill_version_id AND o.skill_id = NEW.skill_id
                   AND o.skill_code = NEW.skill_code AND p.benchmark_method = 'BQM-2')
  OR EXISTS (SELECT 1 FROM academy_package_skills o WHERE o.package_id = NEW.package_id AND (o.skill_code = NEW.skill_code OR o.skill_id = NEW.skill_id))
BEGIN SELECT RAISE(ABORT, 'a reused Skill Version names its one BQM-2 qualification owner, and a package binds each Skill once'); END;
-- Symmetric: a package never owns a qualification for a Skill code or identity it already consumes by reuse.
CREATE TRIGGER academy_package_skills_not_reused BEFORE INSERT ON academy_package_skills
WHEN EXISTS (SELECT 1 FROM academy_package_skill_reuses r WHERE r.package_id = NEW.package_id AND (r.skill_code = NEW.skill_code OR r.skill_id = NEW.skill_id))
BEGIN SELECT RAISE(ABORT, 'a package binds each Skill once: it does not own a qualification it consumes by reuse'); END;
