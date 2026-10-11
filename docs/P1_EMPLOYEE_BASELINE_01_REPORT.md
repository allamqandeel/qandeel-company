# P1-EMPLOYEE-BASELINE-01: shared communication standard, adaptive reasoning for new hires, Arabic Founder alerts

Decision: D-P1-10 (`docs/architecture/DECISION_LOG.md`). Base: main `bc7cc1e`. One PR: not merged and not installed.

- Nothing on LIVE was changed.
- No hire or activation was made.
- No paid call was made.

## Results

| Part | Result | What was reused |
|---|---|---|
| A: company communication standard | COMPLETE | The context seam (D-P1-05) and the CEO's D-P1-09 language rules. Their general part moved into the shared standard. |
| B: AUTO / E1 / E4 for new hires | COMPLETE | AUTO (D-P1-04), the existing `EMPLOYEE_HIRE` act, the per-message level, the standing-profile act and the level availability reasons. |
| C: Arabic Founder Attention texts | COMPLETE | The existing card. Only its words changed; its buttons and acts did not. |

## A: who gets what

| Context | Standard | CEO conversation + language guidance |
|---|---|---|
| Founder ↔ CEO conversation | once | yes, after the standard (no rule repeated) |
| Founder ↔ any other Employee | once | no (each keeps its own identity) |
| CEO brief to the Founder | once | no |
| Academy attempt, benchmark, background work | no | no |

The standard sets how well an Employee writes:
- the Founder's language (Egyptian Arabic or English);
- the formal register for documents;
- no repeated titles, flattery or literal translation;
- plain terms;
- fact, analysis, assumption and recommendation kept apart;
- the Employee's own disagreement and initiative.

It does not set the Employee's voice. Kernels, certifications and profiles are unchanged; the CEO's kernel SHA-256 is
pinned.

## B: the new-hire profile

- **Default:** AUTO, standing default E1, ceiling E4, BALANCED.
- **What the Founder may state instead:** a lower ceiling, or an E2 start.
- **Refused:** a start outside E1 / E2, E0, or a ceiling below the start.
- **What a new hire does not get:**
  - The new hire stays a CANDIDATE, with no budget, grant or work.
  - E3 / E4 still need the task's route policy, a provisioned deployment and the budget.
  - Academy routes stay at E2.
- **Certification:** the profile is set before qualification, so the certificate is earned on AUTO / E1 / E4. No existing
  certification changes.
- **Existing Employees:** none changes. Ahmed stays AUTO / E1 / E4, and his certificate stays REVIEW_DUE.

## C: examples (the card's own words; data in brackets is inserted as is)

| Case | Arabic text on the card |
|---|---|
| Held money | فيه مبلغ محجوز مقابل استدعاء لم تتأكد فاتورته. راجع الفوترة قبل تحرير الحجز، وما تعتبرش المبلغ مصروفًا أو غير مصروف من غير دليل. |
| Approval | مطلوب موافقتك (مستوى المخاطرة [R2]) على استخدام أداة لـ [Ahmed Zaki] |
| Uncertain effect | فيه أثر خارجي مش متأكدين إنه حصل — أكّد هل اتنفذ ولا لأ. مش هيتكرر من غير إجابتك. |
| Staffing | طلب تعيين في وظيفة [Director, Product] — الرئيس التنفيذي بيوصي بالموافقة. |
| Brief | الكارت نوعه «ملخص من الرئيس التنفيذي». السطر الرئيسي «مطلوب منك قرار». العناوين: إيه اللي بيحصل / ليه ده مهم / التوصية / القرار المطلوب. |

- All fifteen cases are inventoried in `ATTENTION_CASES`.
- **Still in English:**
  - "Founder attention", the lanes, the buttons (Release, Dismiss, Show in company, Approve…) and their acts;
  - the company map, the chat and every other surface.
- **RTL:** applies inside the card's text only.

## Validation

- **New tests:**
  - `storage/test/p1-employee-baseline.test.ts`: A and B.
  - `command-center-ui/test/p1-attention-arabic.test.ts`: C.
  - `command-center/test/p1-employee-baseline-surface.test.ts`: the hire preview.
- **Updated tests:**
  - `storage/test/p1-ceo-quality.test.ts`: the rules now live in the standard plus the CEO's part.
  - `runtime/test/l1/l1-02-activation.test.ts`: a default hire's ceiling is E4.
- **The validation plan:** FULL (storage and governance). The local preflight runs here; the FULL continuity proof runs
  once on the PR's GitHub gate.
