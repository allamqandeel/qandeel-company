# QANDEEL COMPANY — STAGE 5
## Memory & Knowledge Architecture — Canonical Closure v1

**Status:** CLOSED / ACCEPTED  
**Gate:** B5 — PASSED (design contract)  
**Date:** 2026-09-26  
**Weight:** 8% of Strong v1

# 1. Memory Is Not One Thing

Persistent employee memory is separated into explicit classes:

- Professional Memory
- Experience Memory
- Relationship / Collaboration Memory
- Current Work Memory
- Personal Lessons

These are distinct from:
- Company Canonical Truth
- Company Knowledge
- Decisions
- Policies
- Evidence

# 2. Company Knowledge Layers

Shared knowledge is layered by scope:

- Company-wide
- Department
- Role-specific
- Market-specific
- Restricted
- Founder-only

Employees retrieve only what is relevant and authorized.

# 3. Memory Write Policy

Events and conversations do not automatically become durable memory.

A Memory Write Policy decides:
- whether an item should be stored;
- memory class;
- scope;
- confidence;
- retention;
- provenance;
- review requirements.

Employees may propose memories, but the memory system decides how and where they are stored.

# 4. Learning Validation

A mistake is not automatically a lesson.

Learning pipeline:

Event / Outcome
→ Observation
→ Hypothesis / Lesson Candidate
→ Review
→ Validated Lesson
→ Employee Learning / Department Knowledge / SOP / Training / Policy, depending on authority.

Personal inference does not automatically become company knowledge.

# 5. Founder Corrections

Founder corrections may directly challenge employee memory.

Rules:
- corrections are explicit and auditable;
- prior memory is not silently rewritten;
- incorrect/stale memory is marked Superseded / Incorrect / Stale as appropriate;
- the correction context and reason are preserved;
- future retrieval should favor the corrected interpretation where applicable.

# 6. Memory Aging and Status

Memory may carry:
- creation time;
- source;
- context;
- confidence;
- last validation time;
- status.

Possible statuses include:
- Active
- Low Confidence
- Stale
- Superseded
- Incorrect
- Archived

Old memory does not necessarily disappear, but its retrieval influence may decay.

# 7. Canonical Truth Wins

When memory conflicts with canonical truth:
- canonical truth wins immediately;
- the employee must be informed that prior memory is outdated or wrong;
- future behavior should not continue treating both as equally valid.

If two memories conflict and no canonical truth resolves them, the conflict is reviewed/escalated before important action.

# 8. Context-Aware Retrieval

Memory retrieval must consider:
- current task;
- market;
- role;
- project;
- customer/user context;
- time;
- validity;
- confidence;
- authority;
- privacy.

A useful lesson from one market or context must not be assumed valid in another without appropriate reasoning/validation.

# 9. Relevant Retrieval, Not Full History

Employee boot/run context must not load the employee's entire memory history.

The system retrieves only:
- identity;
- relevant company truth;
- relevant work state;
- relevant memories;
- open dependencies/messages;
- role/market knowledge required for the task.

This is required for both quality and token-cost control.

# 10. Shared Knowledge Promotion

Not every employee lesson is shared company-wide.

Validated learning may be promoted to:
- Personal Memory
- Role Knowledge
- Department Knowledge
- Market Knowledge
- Company-wide Institutional Knowledge
- Restricted Knowledge

Promotion requires provenance, scope, and validation.

# 11. Cross-Department Knowledge Use

Employees may request knowledge from other departments without receiving unrestricted copies of those departments' memories.

Knowledge sharing is:
- scoped;
- permission-aware;
- attributable;
- context-bound.

# 12. Session Is Not Memory

A model session is a temporary execution container, not employee memory.

Sessions may be:
- resumed when useful;
- rotated;
- compacted;
- terminated when stale, corrupted, too large, or inefficient.

A new session must reconstruct the employee from persistent Identity + Work State + Relevant Memory + Canonical Truth.

Employee continuity must not depend on preserving a chat thread forever.

# 13. Technical Memory Safeguards

Strong v1 must support design/implementation for:
- memory compaction;
- duplicate-memory detection;
- stale-memory detection;
- conflict detection;
- corruption checks;
- retrieval scoring;
- context budgeting;
- retention policies;
- session reset/rotation;
- provenance;
- access controls.

Exact storage/retrieval algorithms remain implementation decisions for later runtime stages.

# 14. Gate B5 Closure

B5 is satisfied because Strong v1 now has an accepted memory/knowledge contract covering:
- memory classes;
- company knowledge layers;
- write policy;
- learning validation;
- Founder correction;
- aging/staleness;
- canonical truth precedence;
- context-aware retrieval;
- shared knowledge promotion;
- cross-department access;
- session independence;
- technical memory safeguards.

**Gate B5 — PASSED (design contract)**  
**Stage 5 — CLOSED / ACCEPTED**
