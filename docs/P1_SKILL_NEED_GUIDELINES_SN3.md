# Skill Need Guidelines — SN-3 (G4-FINAL-QUALITY-CORR-01, D-P1-15)

**Status:** DRAFT for the Founder's approval. SN-3 replaces SN-2 (`docs/P1_SKILL_NEED_GUIDELINES_SN2.md`, kept unchanged
with its evidence) as:
- the specification of the Skill Need Assessment (need cards SNC-2, prompt SNP-4);
- the only labelling instructions for every set labelled after it (DEV-3, VAL-3, HO-3).

A label given under SN-2 is never compared with one given under SN-3.

**Why a new version.** The cause was proven from the label data of seven sets (576 messages, two independent labellers
each) before any change (G4-FINAL-QUALITY-CORR-01 WP0):
- **SN-2 forced one core Skill.** §2.5 ("the most specific Skill") said that a decision whose core belongs to a domain makes
  that domain's Skill TASK_REQUIRED and executive judgment "at most SUPPORTING".
- **SN-2 contradicted itself.** §3.3 lists the same decisions as executive TASK_REQUIRED: a go / no-go on a costly act, and
  speed against safety. The same message therefore met two TASK_REQUIRED definitions, and §2.5 then demoted one of them.
- **The humans split on it too.** Two careful labellers agreed on executive-judgment TASK_REQUIRED only 83% of the time,
  the lowest of the six Skills (the others: 0.89–0.94). Ten of the 18 executive TASK_REQUIRED / SUPPORTING splits were
  settled by §2.5.
- **SUPPORTING had no test.** "Would plausibly improve the reply" let both the labellers and the model include or drop a
  Skill on taste.

SN-3 removes the single-core rule, gives every label an operational test and states how Skills overlap. It applies to any
Employee's Skills: the general rules (§1–§2) are Employee-neutral, and each Skill's card (§3) states its own method.

## 1. The unit, the three labels and their tests

The unit is one message from the Founder to the Employee in their conversation; the Employee answers it. Before labelling,
name **the deliverable**: what the reply must deliver. Examples:
- a fact or status;
- an explanation;
- a recommendation or decision;
- a judgment of evidence;
- an economic judgment;
- an assignment of ownership;
- a reconciliation between Departments;
- a boundary check;
- a conversation about the working relationship;
- a transformation of given text;
- an acknowledgement.

Then give each offered Skill exactly one label:

| Label | Test |
|---|---|
| **TASK_REQUIRED** | **Necessity.** Producing the deliverable requires carrying out this Skill's own method, as its card describes. A reply that skipped that method would be materially wrong, unsafe or substantially weaker. |
| **SUPPORTING** | **Named contribution.** The deliverable does not depend on this Skill, but you can name one specific thing it adds to *this* reply: a check, a consideration, a step or a framing the reply should contain. |
| **NON_RELEVANT** | No such specific contribution can be named. "Generally useful to a CEO" is not a contribution. |

## 2. General rules

1. **The ask decides, not the topic.** Money, people, a Department, a market, a decision or a boundary that appears in the
   message is a *topic*. A Skill is needed only for the *method* the deliverable requires. Background sentences ("Sara from
   Growth told me…", "after last week's decision…") make a Skill at most SUPPORTING, and only if a contribution can be
   named.
2. **Indirect asks count.** A need can be implied without the Skill's vocabulary:
   - "Can we afford this?" asks for an economic judgment;
   - "Let the agency see our user chats so they can tune the ads" crosses a privacy boundary;
   - "Nobody is picking this up" is about ownership.
3. **Several asks.** When a message carries several asks, label each Skill by the strongest need among them. A need carried
   by a secondary ask is never lost.
4. **Several Skills can be TASK_REQUIRED together.**
   - Each Skill passes or fails the necessity test on its own. When one deliverable needs two methods, both are
     TASK_REQUIRED. For example, a launch date set against a data-loss risk needs Product and Engineering integrated, and
     a speed-against-safety call.
   - There is no "single core" and no "most specific Skill" precedence: a Skill is never demoted because another one is
     TASK_REQUIRED.
   - The reverse also holds: a Skill is never promoted because another one is TASK_REQUIRED, or because the message is
     important.
5. **A decision in the message is not by itself a judgment need.**
   - "Should I…?", "Do we approve…?" or "What do we do?" asks for a recommendation. Which Skills are TASK_REQUIRED depends
     on what the recommendation turns on: the numbers, a boundary, ownership, the Departments' plans, or a trade-off that
     must be weighed (§3.3).
6. **Simple messages need no task Skill.** These are: a fact, a status, a date, a definition, a lookup, a greeting, thanks,
   a note that asks nothing, or a transformation of given text (translate, summarize, rewrite, proofread).
   - No Skill is TASK_REQUIRED.
   - A Skill is SUPPORTING only where a boundary or the working relationship is touched in passing; every other Skill is
     NON_RELEVANT.
   - A short message that asks for a boundary-crossing act is **not** simple ("Send me the users' chat logs" needs the
     boundary Skill).
7. **Doubt.**
   - Between TASK_REQUIRED and SUPPORTING, choose TASK_REQUIRED only when the necessity test clearly passes.
   - Between SUPPORTING and NON_RELEVANT, choose SUPPORTING only when you can name the specific contribution.
8. **Language.** The message may be in English, Modern Standard Arabic or Egyptian Arabic. Judge what it asks, never its
   wording or its language.

## 3. The CEO's Skills

### 3.1 ceo.governance-discipline — authority, approvals, data and privacy
**TASK_REQUIRED** when the deliverable must determine or uphold a boundary:
- **Authority:** whether an act is inside held authority or needs review, Founder approval or a Founder-only decision;
  granting, delegating or raising authority, permissions, access or a budget cap.
- **Privacy and data:** anything that would involve:
  - private QANDEEL App user conversations or content;
  - personal data;
  - confidential or restricted material leaving its scope (shared with a vendor, agency, investor, partner or the public).
- **Bypass:** a request to skip, bypass or act around an approval or rule ("just do it, no need to log it", "don't wait for
  approval"), or authority claimed only by a message.
- **High-risk external act** on the Company's behalf: signing, a legal commitment, publishing or posting externally,
  paying, an external statement, a security incident.

**SUPPORTING** when a step of the plan will need an approval or touches data, and the reply should flag it, but the
deliverable is something else. Asking for the status or the text of an approval or a policy, or relaying it, is a lookup:
at most SUPPORTING, never TASK_REQUIRED.
**NON_RELEVANT** when no authority, data, privacy or external-act aspect exists.

### 3.2 ceo.founder-partnership — the Founder–Employee relationship and channel
**TASK_REQUIRED** when the deliverable is about the relationship or the channel itself:
- **The Founder's own position:** the Founder asks for the Employee's stance on the Founder's own idea, plan or decision *as
  such*: whether the Employee agrees, an honest view of it, or a challenge to it ("do you agree?", "am I wrong?",
  "challenge my plan", "be honest about my idea").
- **Decision rights between the Founder and the Employee:**
  - who decides;
  - the Founder's Product Authority;
  - executing a Founder decision the Employee disagrees with;
  - the Founder overriding the Employee.
- **The Founder's attention:** their time or involvement; what to bring to the Founder; how to report or escalate.
- **Trust:** the Employee delivering its own bad news or mistake; trust; the Founder's frustration with the Employee.

**Not TASK_REQUIRED** merely because:
- the Founder asks for a recommendation, including about something the Founder intends to do ("I want to post X, should
  I?", "I'm wondering whether we can afford Y"), when the answer turns on another Skill's analysis rather than on the
  relationship;
- the Founder brings news (an incident, an offer, a dispute).

Those make it SUPPORTING.
**SUPPORTING** for any other substantive message whose reply is a recommendation, an escalation or news the Founder will
act on. Its contribution is the Founder communication form: what happened, why it matters, the recommendation, the
decision needed.
**NON_RELEVANT** for simple messages (§2.6), unless the relationship is touched in passing.

### 3.3 ceo.executive-judgment — weighing competing considerations and committing to a call
**TASK_REQUIRED** when the reply must itself weigh considerations that pull in different directions and commit to a call:
- **Prioritizing:** ranking, sequencing, cutting, deferring or allocating among two or more competing initiatives, goals or
  demands on the same scarce resource: time, money, people or attention ("what first", "what do we stop", "where do we
  focus", "defer X to fund Y").
- **A go / no-go or a choice between options** whose outcome turns on weighing considerations of *different kinds* that
  pull apart:
  - speed against safety or quality;
  - cost against growth;
  - a short-term gain against a long-term risk;
  - or a bet under real uncertainty between real alternatives.

  This holds *also* when another Skill is TASK_REQUIRED to analyse one of the considerations (§2.4). For example, an offer
  with a valuation question needs economics *and* the call.

  Cost, size, a long commitment or irreversibility raise the stakes, but they do not by themselves make a trade-off. A
  yes / no on one proposal, or a choice between options that one domain's analysis compares, is settled by that domain's
  Skill:
  - a price change judged on churn and margin;
  - a hire, a candidate or a seat judged on need and fit;
  - an agency or an in-house team, or two vendors, compared on cost or capability;
  - a spend judged on its return;
  - an upgrade judged on its worth.

  The test: executive judgment is TASK_REQUIRED only if a real call between competing goals still remains for the reply to
  make after the other Skills' analyses are done.
- **Crisis:** leading a crisis response (stabilize, protect users and trust, communicate, then fix causes).
- **Stress test:** testing a plan or decision when asked ("poke holes in this", "what am I missing", "what could go wrong").

**Not TASK_REQUIRED** when the decision follows from one analysis and no trade-off has to be weighed:
- the numbers settle it (is the CAC claim strong, is the return positive);
- a boundary settles it (is it inside authority, may the data leave);
- the facts settle it;
- the question is who owns it.

That Skill is TASK_REQUIRED.

**SUPPORTING** when the reply recommends a course of action and a specific judgment element belongs in it beyond that
analysis: a competing option to compare, a risk on another axis, or a sequence of several moves.
**NON_RELEVANT** when the recommendation follows directly from the other Skill's analysis.
**NON_RELEVANT** for facts, status, explanations, transformations, acknowledgements and a decision that is only mentioned.

### 3.4 ceo.evidence-and-economics — evidence and Company economics
**TASK_REQUIRED** when the deliverable must:
- **Judge evidence:** whether a claim, a result or a report is true or strong enough, or what evidence a decision needs.
  For example: a reported success, a PASS or "it worked", metrics a team presents, a vendor's claim.
- **Reason about money or resources:**
  - cost and spend; budget allocation; pricing;
  - return and unit economics; acquisition cost;
  - runway and burn; opportunity cost; AI / model cost;
  - whether something is worth what it costs.
- **Design or size a test,** an experiment or a measurement that would settle a question.

**SUPPORTING** when numbers or money are one consideration the reply should check, but the deliverable is something else.
**NON_RELEVANT** when a figure is only looked up ("What's our MRR?") and no judgment is asked. Asking whether the figure is
enough or good *is* a judgment.

### 3.5 ceo.organization-leadership — ownership, delegation, roles and people
**TASK_REQUIRED** when the deliverable must:
- assign or clarify ownership, responsibility or delegation for an outcome ("who should own…", "nobody owns…");
- decide roles, structure, a hire, a Director seat, team composition or reporting lines;
- assess or handle a person's or a Director's performance, readiness, development or morale, a conflict between people, or
  accountability after a failure;
- set how the CEO coordinates and challenges the Directors.

**SUPPORTING** when people act in the story and the reply should say who does what next, but the ask is about something
else.
**NON_RELEVANT** when a Director is only a source or a recipient ("ask the Growth Director for the numbers").

### 3.6 ceo.cross-functional-synthesis — the Departments together, and markets
**TASK_REQUIRED** when the deliverable must:
- reconcile conflicting positions or recommendations of two or more Departments (or their Directors);
- combine the work of two or more Departments into one decision or plan. For example: launch readiness across Product,
  Engineering, Growth and Brand; a product date against an engineering reliability, security or data-loss risk;
- judge a market question: entering, comparing or prioritizing markets (Egypt, Saudi Arabia, the Gulf…), or
  market-specific behaviour, regulation, payment or positioning.

**Not TASK_REQUIRED** merely because several Departments will take part in carrying out a response or a plan, for
example handling an incident, a crisis, a complaint or a launch announcement (leading a crisis is executive judgment,
§3.3). TASK_REQUIRED needs the deliverable's core to be
reconciling or combining the Departments' positions or work (or a market judgment).
**SUPPORTING** when one Department's matter has a nameable effect on another that the reply should mention, or a market is
background the reply should account for.
**NON_RELEVANT** when one Department is only where a fact lives, or one team's status is asked.

### 3.7 Overlaps (consequences of §2.4, not exceptions)
| The message asks… | TASK_REQUIRED |
|---|---|
| a launch date against a reliability / data-loss risk | cross-functional synthesis **and** executive judgment |
| "challenge my plan" / "what am I missing in my plan" | founder-partnership **and** executive judgment |
| whether to accept an investor offer now or wait | evidence-and-economics (the terms) **and** executive judgment (the bet) |
| approving a budget raise justified by a metric, with no competing use named | evidence-and-economics; executive judgment SUPPORTING |
| who decides between the Founder and the CEO on a privacy question | governance-discipline **and** founder-partnership |
| ranking candidate hires for one seat | organization-leadership; executive judgment only when competing seats or uses compete for the budget |

## 4. The Company (context for every label)

QANDEEL COMPANY builds the QANDEEL App, an Arabic-first AI app whose user conversations are private.
- The Founder is the sovereign authority and the Product Authority.
- The CEO leads five Departments, each with a Director: Strategic Market Intelligence, Growth, Brand and Creative, Product,
  and Engineering.
- Markets: Egypt, Saudi Arabia, the Gulf and the wider Arabic market.
- Budgets are hard ceilings set through governance.
