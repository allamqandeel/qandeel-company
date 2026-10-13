# Skill Need Guidelines — SN-2 (P1-CONTEXT-INTEL-01 G4-C2-CORR-01, D-P1-14)

**Status:** frozen definitions of what each CEO Skill is *needed* for. They are the specification of the Skill
selection (`SKILL_NEED_TABLE` SN-2, mind) and the only labelling instructions given to the authors and reviewers of the
development, validation and held-out sets. Changing them is a new version (SN-3) and voids earlier measurements.

## 1. The unit and the three labels

The unit is one message from the Founder to the CEO in their conversation. The CEO answers it. For each of the six CEO
Skills give exactly one label:

| Label | Meaning |
|---|---|
| **TASK_REQUIRED** | What the reply must deliver falls inside this Skill's core method: a reply written without applying it would be materially wrong, unsafe or substantially weaker. |
| **SUPPORTING** | The Skill would plausibly improve the reply, but the reply does not hinge on it: the subject appears as background, is a secondary aspect of the ask, or the need is plausible but uncertain. |
| **NOT_NEEDED** | The Skill adds nothing material to this reply. |

## 2. General rules

1. **The ask decides, not the topic.** First identify what the reply must deliver: a fact or status, an explanation, a
   decision or recommendation, a judgment of evidence, an economic judgment, an assignment of ownership, a reconciliation
   between Departments, a check of a boundary, a conversation about the Founder–CEO working relationship, a transformation
   of given text, or an acknowledgement. Then label each Skill by whether *that delivery* needs it.
2. **A mention is not a need.** A word, a person, a Director, a Department, a decision, a number or a market that appears
   in the message is not by itself a reason for TASK_REQUIRED. Background sentences ("Sara from Growth told me…", "after
   last week's decision…") at most make a Skill SUPPORTING.
3. **Indirect asks count.** A need can be implied without the Skill's vocabulary ("Can we afford this?" is economics;
   "Let the agency see our user chats so they can tune the ads" is a privacy boundary; "Nobody is picking this up" is
   ownership).
4. **Several asks.** When a message carries several independent asks, label each Skill by the strongest need among them.
5. **The most specific Skill.** When the ask is a decision whose core is economics or evidence, organization, the
   Departments or markets, or a boundary, the Skill of that core is TASK_REQUIRED. Executive judgment is TASK_REQUIRED only
   when the judgment itself is the core (§3.3); otherwise it is at most SUPPORTING.
6. **Simple messages** — a fact, a status, a date, a definition, a lookup, a greeting, thanks, a note that asks nothing,
   or a transformation of given text (translate, summarize, rewrite, proofread) — need no task Skill: the five task Skills
   are NOT_NEEDED (at most SUPPORTING where a boundary or the relationship is touched in passing), and founder-partnership
   is NOT_NEEDED or SUPPORTING. A short message that asks for a boundary-crossing act is **not** simple ("Send me the
   users' chat logs" needs governance).
7. **When unsure between two labels,** prefer SUPPORTING over NOT_NEEDED if the Skill has a reasonable functional role in
   the reply, and SUPPORTING over TASK_REQUIRED if the reply would still be sound without it. Never use TASK_REQUIRED for a
   Skill only because it is generally useful to a CEO.

## 3. The Skills

### 3.1 ceo.governance-discipline — authority, approvals, data and privacy
**TASK_REQUIRED** when the reply must determine or uphold a boundary:
- whether an act is inside held authority or needs review, Founder approval or a Founder-only decision; granting,
  delegating or raising authority, permissions, access or a budget cap;
- privacy and data: anything that would involve private QANDEEL App user conversations or content, personal data, or
  confidential / restricted material leaving its scope (sharing with a vendor, agency, investor, partner or the public);
- a request to skip, bypass or act around an approval or rule ("just do it, no need to log it", "don't wait for
  approval"), or authority claimed only by a message;
- a high-risk external act on the Company's behalf: signing, a legal commitment, publishing or posting externally,
  paying, an external statement, a security incident.

**SUPPORTING** when a boundary is in the background, or approvals are a secondary step of a larger plan.
**NOT_NEEDED** when no authority, data, privacy or external-act aspect exists.

### 3.2 ceo.founder-partnership — the Founder–CEO relationship and channel
**TASK_REQUIRED** when the ask is about the relationship or the channel itself:
- the Founder asks for the CEO's honest view of the Founder's *own* idea, plan or decision, asks to be challenged, or
  asks whether the CEO agrees or disagrees with the Founder;
- decision rights between the Founder and the CEO: who decides, the Founder's Product Authority, executing a Founder
  decision the CEO disagrees with, the Founder overriding the CEO;
- the Founder's attention, time or involvement; what the CEO should bring to the Founder, how to report or escalate;
- delivering bad news or an admitted mistake to the Founder, trust, or the Founder's frustration with the CEO.

**SUPPORTING** for any other substantive message whose reply is a recommendation, an escalation or news the Founder will
act on (the Founder communication form: what happened, why it matters, the recommendation, the decision needed).
**NOT_NEEDED** for simple messages (§2.6).

### 3.3 ceo.executive-judgment — prioritization and consequential calls
**TASK_REQUIRED** when the judgment itself is the core of the reply:
- prioritizing, ranking, sequencing or cutting among several competing initiatives, goals or demands on scarce resources
  ("what first", "what do we stop", "where do we focus");
- a consequential call whose core is a strategic trade-off not reducible to one specialist domain: a go / no-go on a
  costly, long-commitment or hard-to-reverse act, speed against safety or quality, a bet under real uncertainty;
- leading a crisis response (stabilize, protect users and trust, communicate, then fix causes);
- stress-testing a plan when asked ("poke holes in this", "what am I missing", "what could go wrong").

**SUPPORTING** for any other ask for a recommendation, an opinion or a plan, and a decision whose core belongs to another
Skill's domain (§2.5).
**NOT_NEEDED** for facts, status, explanations, transformations and acknowledgements, and for a decision that is only
mentioned ("the decision we took last week").

### 3.4 ceo.evidence-and-economics — evidence and Company economics
**TASK_REQUIRED** when the reply must:
- judge whether a claim, a result or a report is true or strong enough (a reported success, PASS or "it worked", metrics
  a team presents, a vendor's claim), or say what evidence a decision needs;
- reason about money or resources: cost, spend, budget allocation, pricing, return, unit economics, acquisition cost,
  runway or burn, opportunity cost, AI / model cost, whether something is worth what it costs;
- design or size a test, an experiment or a measurement that would settle a question.

**SUPPORTING** when numbers or money are background or one consideration among others.
**NOT_NEEDED** when a figure is only looked up ("What's our MRR?") with no judgment asked; asking whether the figure is
enough or good is a judgment.

### 3.5 ceo.organization-leadership — ownership, delegation, roles and people
**TASK_REQUIRED** when the reply must:
- assign or clarify ownership, responsibility or delegation for an outcome ("who should own…", "nobody owns…");
- decide roles, structure, a hire, a Director seat, team composition or reporting lines;
- assess or handle a person's or a Director's performance, readiness, development or morale, a conflict between people,
  or accountability after a failure;
- set how the CEO coordinates and challenges the Directors.

**SUPPORTING** when people or Directors act in the story but the ask is about something else, or delegation is a
secondary part of a plan.
**NOT_NEEDED** when a Director is only a source or a recipient ("ask the Growth Director for the numbers").

### 3.6 ceo.cross-functional-synthesis — the Departments together, and markets
**TASK_REQUIRED** when the reply must:
- reconcile conflicting positions or recommendations of two or more Departments (or their Directors);
- integrate the work of two or more Departments into one decision or plan (launch readiness across Product,
  Engineering, Growth and Brand; a product date against an engineering reliability, security or data-loss risk);
- judge a market question: entering, comparing or prioritizing markets (Egypt, Saudi Arabia, the Gulf…), or
  market-specific behaviour, regulation, payment or positioning.

**SUPPORTING** for one Department's matter with plausible effects on others, or a market named as background.
**NOT_NEEDED** when one Department is only where a fact lives, or one team's status is asked.

## 4. The Company (context for every label)

QANDEEL COMPANY builds the QANDEEL App (an Arabic-first AI app whose user conversations are private). The Founder is the
sovereign authority and the Product Authority. The CEO leads five Departments, each with a Director: Strategic Market
Intelligence, Growth, Brand and Creative, Product, and Engineering. Markets: Egypt, Saudi Arabia, the Gulf and the wider
Arabic market. Budgets are hard ceilings set through governance.
