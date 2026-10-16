# Founder-approved employee specifications

This folder holds the professional specifications of persistent Employees that the Founder approved, one Markdown file
per person (for example `MAJED_EL_KEDWANY_APPROVED_SPEC.md`). COMPANY-TALENT-01 (D-TALENT-01, D-TALENT-03).

## What a specification is

- **It is the source of an identity profile.** The Founder (or a proposing leader) drafts the profile in the Staff &
  Training hall's Identity studio from the specification, and the Founder approves it there. The profile's `sourceRef`
  points to the file here (`doc:docs/talent/<file>.md`). The approved profile, not this file, is what the runtime uses.
- **It is not authority.** It grants no permission, budget, seat or tool. It is neither a canonical authority document nor
  part of `docs/authority/`, and it never overrides one.
- **It is not real QANDEEL history.** A designed pre-QANDEEL background in a specification stays labelled as designed
  (Stage 4 §3). It is never presented as a real employer, degree or QANDEEL achievement.
- **It holds no secret** and no private user content.

## Changing a specification

The Founder approves a new version of the specification and, in the Identity studio, a new profile version.
`EMPLOYEE_IDENTITY_REVISE` then binds that version to the Employee:

- **MINOR:** no certification is affected.
- **MATERIAL:** the Employee's VALID certifications become REVIEW_DUE.

The earlier versions stay as history.

## Files

| Person | Seat | File | State |
|---|---|---|---|
| Majed El Kedwany (ماجد الكدواني) | Strategic Market Intelligence Director | `MAJED_EL_KEDWANY_APPROVED_SPEC.md` (verbatim, SHA-256 `ccdc184aa568bc06dc1f7ac739a5b973dc5a932275902abf647e12fc04ebbc55`) | Received 2026-10-16. Derived profile and program: `MAJED_EL_KEDWANY.talent.json`. Not created in LIVE. |

## Derived data (`*.talent.json`)

A `*.talent.json` file is what the Founder enters in the Staff & Training studio for one person: the identity profile
fields, and the Academy program sections added to the studio template. It names its specification and the
specification's SHA-256. It is data, not code: nothing in the product reads it. The acceptance tests and the real-UI
proof read it to show that the general studio creates and approves the person. In LIVE, the Founder enters it through
the studio and approves it there.

### How `MAJED_EL_KEDWANY.talent.json` follows the specification

| Specification | Derived |
|---|---|
| §1 identity and personality, §2 expertise, §3 responsibilities and limits, §7 data rules | The identity profile, written in the kernel's English and condensed to the 2,400-character kernel limit. The manager is not named: the runtime reads the reporting line live. There is no designed background, because the specification gives none. |
| §2 C (no large budget assumed) | `workBehaviour` and the lean-launch Skill. |
| §3 "does not alone approve pricing, product, launch, expansion, spending, hiring or publication" | `boundaries`, plus the strategic-challenge Skill. Authority stays with grants (Title ≠ Authority). |
| §4 six capability groups | One program, not six packages. It has six Skills (one per group, each with a benchmark case) and six critical competencies. Evidence-Based Decisions passes at 75; the others at 70. Each competency retrains in its matching curriculum category. No approved Skill in this build matches these groups, so in LIVE the Founder may switch a Skill to reuse an approved one in the studio. |
| §5 five practical tests | Tests 1–4 are assessments. Test 5 (misleading evidence) is the hidden holdout. `assessmentTrials` is 5, so all five must pass. The practice scenario comes from §6 days 1–30. Founder Calibration is required. |
| §6 first 90 days | Three internal shadow briefs, one per 30-day phase, with no external effect. Probation needs all three. The real objectives after activation are set as Goals through the existing governed path after the Founder activates him. Nothing here creates them. |
| §7 budget and access | Not in the derived data. The CEO details the qualification and operating needs, and the Founder approves the Department budget, envelope, model access and policies as separate confirmations. |
