# ST-FLASH / Microturns
## Pre-implementation plan

> Historical planning gate: implementation began after the manually validated five-preset workflow was frozen. The current implementation status and runtime roles are documented in the repository README. References below to three roles, a Normal resolver, or implementation not having started describe earlier design stages.

This is the gate before writing a SillyTavern extension. The objective is to prove the prompt protocol, state contract, model roles, and user experience manually first. Coding begins only after the required decisions and tests below are complete.

The current project contains a first FLASH prompt pack and a plaintext extraction of the FF5.2 modules. Those are working materials, not yet a frozen specification.

## 1. Freeze the product boundary

Write a one-page behavior specification that answers these questions without using words such as “usually” or “if it feels right.”

- What exactly is a composite response?
  - Anchor/lead prose only.
  - Anchor prose followed by an approval request.
  - Approved flash microturns.
  - Landing/commit prose and final state.
- Is approval visible to the user, and what exact message means approve, decline, stop, or continue?
- Does a declined flash end with the anchor model, with a separate landing model, or with a normal user turn?
- Can the user interrupt a flash segment, and what happens to a partially completed segment?
- Is there exactly one flash segment per composite response?
- What is the maximum number of B turns in one segment?
- What ends a segment: explicit user stop, natural pause, authority boundary, time/turn limit, escalation, or model decision?
- Which model produces the initial prose, which model produces microturns, and which model performs landing/state commit?
- Which model and reasoning setting are the initial fixed configuration? Do not begin with automatic model selection.
- What is the fallback when any call fails, times out, returns malformed output, or contradicts the capsule?

Initial scope should be deliberately narrow: one active flash session, one segment per composite response, a small fixed turn limit, no combat resolution, no scene transition, and no automatic long-term-memory rewrite.

The user-triggered local-frame profile in `local-frame-mode-v0.md` adds one explicit exception: continuous nearby movement may roll the zoomed-in frame without becoming a scene transition. A time skip, montage, remote cut, or jump to a distant destination remains a scene transition and must escalate.

**Deliverable:** `docs/product-behavior-v0.md` containing the lifecycle as a state diagram or numbered sequence and the visible user experience for every branch.

## 2. Establish the source-of-truth hierarchy

The system needs an explicit conflict policy before it can reconcile state. Define the authority order, for example:

1. The user’s newest message and actions.
2. The ordinary full-context roleplay and established character/lore information.
3. The latest canonical Internal States checkpoint.
4. The current flash session’s saved state.
5. Validated flash deltas from B.
6. A’s handoff or predicted direction.
7. Any model inference not explicitly established.

Specify what happens when two levels conflict. In particular:

- A’s intended direction is never an event.
- A’s mid-turn checkpoint is provisional until the flash segment is committed.
- A claim heard by an NPC is not automatically a fact learned by every NPC.
- A proposal is not a commitment until someone accepts it.
- A visible action that changes position, time, condition, knowledge, possession, or commitment must be represented in state.
- Unknown and unchanged are different values.
- A contradiction is repaired by the higher-authority source, not averaged.

**Deliverable:** a short authority and conflict-resolution document with examples of at least ten contradictions.

## 3. Separate static context from mutable state

Do not make every capsule regenerate the same character information. Define four separate objects:

### Static cast cards

These change only when the character sheet, lore, or style configuration changes. A card should contain only information needed during flash:

- identity and role;
- voice and dialogue habits;
- relationship facts relevant to the current scene;
- knowledge boundaries and hard behavioral limits;
- consent/safety or authority restrictions that must survive every turn.

Give each cast-card collection a version or hash. If the underlying character or lore changes, start a new version rather than silently reusing the old one.

### Session anchor

Created once at flash start. It identifies the scene, active NPCs, relevant nearby objects, POV/tense/style contract, and the initial canonical state. It may reference static cast cards by ID.

### Mutable flash state

Owned by the orchestrator and updated after each accepted turn. It should cover only:

- flash turn number;
- elapsed time;
- positions and proximity;
- physical conditions;
- knowledge changes, labelled FACT or CLAIM;
- possession/item changes;
- proposals;
- accepted or reaffirmed commitments;
- escalation or unresolved items.

### Transcript

The visible user and NPC exchange. The transcript is evidence, not a state summary. The state record should cite the turn that established a fact where practical.

**Deliverable:** example JSON or XML fixtures for a cast card, session anchor, mutable state, and transcript. These are contracts, not implementation internals.

## 4. Finalize the prompt-module policy

Use the extracted FF5.2 module file as an inventory. For every module, mark it:

- retained unchanged;
- retained but compressed;
- anchor-only;
- flash-only;
- landing-only;
- replaced by capsule data;
- deliberately removed.

The FLASH prompt should not reproduce the entire FF5.2 system. It should contain only behavior that cannot be supplied by the capsule or by the shared style modules.

At minimum, decide and test compressed versions of:

- POV and tense;
- narration/action-beat style;
- dialogue formatting and NPC voice;
- user-character authority;
- knowledge boundaries and anti-omniscience;
- flash movement/time limits;
- escalation behavior;
- output and delta formatting.

Do not let the capsule spend output tokens restating static prose style. Pass the style as a small named module or compact style card.

For each role, define a separate prompt pack:

- **Anchor:** full-context reasoning and initial prose/state checkpoint.
- **Flash:** short local reaction, no user puppeting, no scene transition, delta only.
- **Landing/commit:** transcript reconciliation, final prose, complete canonical state.

Do not assume the same prompt can serve all three roles with a few lines removed.

**Deliverable:** a module manifest listing module IDs, order, owner role, estimated tokens, and whether each module is static or dynamic.

## 5. Define the capsule and delta contracts

The contract must be machine-parseable but readable during debugging. Decide whether XML, JSON, or a line-oriented format is the canonical wire format. Do not support multiple formats in v0.1.

The initial capsule should contain:

- session ID;
- cast-card version;
- capsule/state version;
- active NPC IDs;
- scene/location and local authority limits;
- style module IDs;
- canonical starting state;
- optional anchor handoff note, clearly labelled as a plan rather than fact.

Each flash response should contain:

- visible prose;
- exactly one delta object;
- session ID and flash turn number;
- base state version;
- typed changes only;
- an escalation marker when needed.

Each delta should be a delta, not a cumulative state summary. The orchestrator applies it to the saved state. Models should never be asked to reconstruct an arbitrarily long chain such as “F1 + F2 + F3 + F4” in prose.

Define validation rules:

- one visible response and one delta maximum;
- no unknown fields in strict mode;
- explicit `None` or empty values for unchanged categories;
- turn number must be monotonic;
- base version must match the orchestrator’s current version;
- a malformed or ambiguous delta is rejected or sent to repair, never silently applied;
- text outside the visible response and the delta is treated as invalid output.

**Deliverable:** schema documents plus at least five valid and ten invalid examples.

## 6. Decide persistence and checkpoint behavior

“Automatic saving” must belong to the extension, not to model memory. Decide:

- where the session lives: per chat, per character, or per browser/session;
- when it is created, resumed, paused, invalidated, and deleted;
- whether a refresh, browser reload, or model change ends it;
- how a saved state is associated with the exact chat message that created it;
- how static cast-card changes invalidate an existing session;
- how many deltas may accumulate before a fresh canonical checkpoint is required;
- whether the landing model or the anchor model owns rebase/checkpoint generation;
- how a user edits or rolls back a bad delta.

Use a bounded delta window. A practical first policy is to keep recent deltas for debugging, but periodically replace them with a complete canonical state generated from the transcript and accepted events. Do not build a permanent event-sourcing system before the basic flow works.

**Deliverable:** session lifecycle rules and rollback/rebase examples.

## 7. Build the manual evaluation fixture set

Before coding, collect a fixed, anonymized test set. Each fixture needs:

- the relevant ordinary chat context;
- character/lore data;
- the expected capsule contents;
- the user message;
- expected visible behavior;
- expected state changes;
- forbidden actions;
- the model and settings used;
- latency and token measurements.

Include at least these cases:

1. ordinary short dialogue;
2. ambiguous flirtation or emotionally loaded dialogue;
3. a user action that must not be taken over;
4. local movement and changed proximity;
5. a claim heard by one NPC only;
6. an accepted commitment versus an unaccepted proposal;
7. item transfer or possession change;
8. time advance with simultaneous physical beats;
9. a third-party NPC interjection already authorized by the capsule;
10. an unauthorized new character/location/object;
11. a request for combat, skilled contest, or major injury;
12. a contradiction between A’s plan and the actual user exchange;
13. a contradiction between capsule state and transcript;
14. multiple active NPCs with different knowledge;
15. a long enough flash segment to expose cumulative drift;
16. a style/POV constraint inherited from a compressed module;
17. malformed delta, missing turn number, and duplicate turn number;
18. timeout or provider failure at each model boundary.

**Deliverable:** a versioned `fixtures/` set with expected outcomes. The expected outcomes should be facts and invariants, not one exact prose completion.

## 8. Benchmark the actual model roles

Run the same fixtures manually with the candidate configurations. Do not rely on general impressions of K3-low, K2.7-code-highspeed, DeepSeek Flash, or any other model.

Measure separately:

- time to first visible text;
- time to complete flash turn;
- time to complete the composite response;
- input and output tokens for each call;
- estimated cost under the actual provider;
- parse/format failure rate;
- state accuracy;
- forbidden-action rate;
- style continuity;
- perceived continuity between anchor, flash, and landing prose;
- recovery time after an error.

Compare against at least:

- one capable model producing an ordinary response;
- one capable model producing a short response;
- the proposed anchor + flash path;
- the proposed anchor + flash + landing path, if landing is retained.

Set go/no-go thresholds before reviewing the results. They should be relative to the ordinary baseline rather than based on an idealized number. The flash path must improve the user-visible interaction enough to justify its extra calls and state machinery.

**Deliverable:** a benchmark table and a written decision. A fast model that frequently violates authority or corrupts state does not pass.

## 9. Test prompt compression independently of orchestration

For each compressed module, run an A/B test:

- full FF5.2 module;
- compressed module;
- no module;
- compressed module plus capsule/style card.

Judge the results on the same fixtures. Record which behaviors were lost, not merely whether the prose “felt good.” Pay special attention to:

- user-character agency;
- NPC knowledge boundaries;
- dialogue voice;
- POV and tense;
- prohibited transitions;
- correct event classification.

Do not compress a module merely because it saves tokens. If the loss causes state or continuity errors, retain the module or move the information into a structured capsule field.

**Deliverable:** a compression report with accepted wording and rejected shortcuts.

## 10. Specify the user-facing interaction

Write the UX contract before implementation:

- what the user sees while the anchor is thinking;
- whether the approval request is visible in the roleplay text or in extension controls;
- how a user approves, declines, interrupts, or resumes;
- whether B’s microturns are streamed one at a time or buffered;
- whether internal deltas are hidden, expandable, or copied to a debug panel;
- how the user knows a flash session is active;
- how errors are displayed without corrupting the roleplay;
- how a user forces ordinary mode for the next response;
- how a user resets the saved session state.

The visible experience must not depend on the user understanding capsules, deltas, model names, or internal state machinery.

**Deliverable:** a short UX spec with screenshots or text mockups for success, approval, decline, interruption, escalation, and failure.

## 11. Define observability and debugging requirements

Every composite response should be diagnosable after the fact. Decide what is recorded locally:

- session and state versions;
- model/provider role;
- prompt-module manifest version;
- input/output token counts when available;
- timestamps and durations;
- raw model outputs or a privacy-safe debug equivalent;
- parser/validator errors;
- accepted and rejected deltas;
- final state checkpoint.

Provide a way to export one failing composite response as a self-contained fixture. Without this, prompt debugging will become anecdotal and model changes will be impossible to compare.

**Deliverable:** a debug-record format and one manually assembled example.

## 12. Resolve security and data boundaries

Before implementation, decide:

- what roleplay data is written to disk;
- whether raw transcripts and hidden states are retained;
- how API keys and provider configuration are excluded from exports;
- whether debug logs can contain sensitive or adult material;
- how session data is cleared;
- whether imported preset files are treated strictly as data;
- what happens when a provider returns unexpected markup or attempts to inject instructions.

Do not let debugging convenience silently turn every private chat into a permanent archive.

**Deliverable:** a short data-retention and export policy.

## 13. Prepare the project for implementation

Only after the previous gates pass, organize the project into stable source areas. A reasonable structure is:

```text
docs/
  product-behavior-v0.md
  authority-and-conflicts.md
  contracts/
  evaluations/
  ux-spec.md
flash-prompt/
  modules/
  presets/
fixtures/
  capsules/
  transcripts/
  expected/
src/                 # do not create until the implementation gate passes
```

Add a project-level `AGENTS.md` only when the architecture and file conventions are stable. It should describe repository rules and test commands, not contain a second competing copy of the prompt.

Create a Git repository on the home PC, make an initial snapshot of the manually validated prompt pack and fixtures, and then begin extension work from a clean checkpoint.

## Implementation gate

Do not start extension programming until all of these are true:

- The composite-response lifecycle is unambiguous.
- The exact initial model roles and fallback behavior are chosen.
- Static cast data is separated from mutable flash state.
- Capsule, delta, escalation, and checkpoint schemas exist with valid and invalid examples.
- Authority and conflict rules are written down.
- The prompt-module manifest and compressed wording are frozen for v0.1.
- The manual fixture set covers ordinary, adversarial, and failure cases.
- The candidate model path beats the ordinary baseline on predeclared latency/quality criteria.
- The user-facing approval/interruption/error behavior is specified.
- A debug record can reproduce a failed composite response.
- Data retention and export behavior are understood.
- The project is backed up and version-controlled on the home PC.

If any one of these is unresolved, keep doing prompt and fixture work. The extension should automate a protocol that is already understandable and testable, not discover the protocol through code.

## Suggested order of work now

1. Finish the module inventory and mark what survives in Anchor, Flash, and Landing.
2. Write the static cast-card and mutable-state examples.
3. Freeze the capsule and delta schemas.
4. Build the manual adversarial fixture set.
5. Run compression A/B tests.
6. Benchmark the candidate model configurations against ordinary RP.
7. Decide whether Landing is necessary or whether Anchor can commit the result.
8. Specify approval, interruption, error, and reset behavior.
9. Freeze v0.1 prompts and fixtures.
10. Set up Git on the home PC and only then begin extension design and programming.
