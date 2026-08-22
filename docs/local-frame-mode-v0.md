# FLASH local frame v0

## Decision

FLASH is a temporary **zoomed-in local simulator**. It is not a dialogue mode and not an exploration mode. A user may trigger it from any established immediate roleplay context: a conversation, forest path, shoreline, street corner, moving vehicle, physical task, fight buildup, quiet room, or any mixture of actors, action, and environment.

The fast model receives the smallest useful working context that can stay coherent for several short turns. It may fill local gaps with contextually coherent generated detail. It may not use that temporary authority to decide the larger scene or world.

Automatic handoff covers both reply-bearing dialogue and short-timescale interactive events. A user trigger remains the general path and does not require dialogue, an NPC, a building, or a fixed location.

## Product intuition

Ordinary mode sees the scene broadly and owns consequential narrative state. FLASH narrows the lens:

- **Broad mode:** “They spend the afternoon crossing the foothills and reach the village before dark.”
- **FLASH:** wet grass catches at the character's boots; a shallow runnel crosses the next few metres of trail; someone nearby answers; the user decides each immediate movement.

The benefit is not environmental description by itself. It is rapid participation at close temporal, spatial, and causal scale.

## User-facing trigger

The eventual extension should expose a FLASH button and optional `/flash` command. Both produce a trusted, out-of-band control event:

```xml
<flash_request/>
```

The event is not roleplay speech and must not be stored as something the user character said. For manual tests, the same exact marker may be injected as a system/control message.

If the trigger accompanies roleplay text, that text remains the first unresolved user turn inside FLASH. The Anchor must not answer it before handoff.

## Entry lifecycle

1. The user triggers FLASH, or the Anchor automatically identifies a useful reply-bearing exchange or short-timescale local event.
2. On a user trigger, the Anchor emits no new prose and outputs `<flash_handoff entry="USER"/>`. On an automatic route, it writes only the opening beat and outputs `<flash_handoff entry="AUTO"/>`.
3. The capsule generator extracts a compact LOCAL FRAME from full context. For user entry with accompanying roleplay content, the frame is the instant before that content.
4. The orchestrator passes the capsule, then the unresolved user content if any. A bare trigger asks the fast model to render the immediate context at the current scale.
5. FLASH produces short local beats and deltas. The frame may roll gradually with continuous nearby movement.
6. Explicit exit, interruption, frame exhaustion, turn/time limit, malformed output, or escalation invokes Landing.
7. Landing reconciles material changes and continuity anchors into complete canonical state without preserving every incidental generated detail.

If no immediate roleplay context exists—for example, the chat is still at an abstract setup screen—the trigger fails cleanly instead of inventing an entire starting scenario.

## Automatic short-timescale routing

The automatic router may enter FLASH when an immediate situation is better played through several rapid user interventions than resolved in one broad response. Typical cases include the onset or close beats of a fight, struggle, chase, escape, accident, imminent hazard, or urgent physical task. Dialogue is not required.

Temporal scale alone is not enough. Entry requires a concrete local response point, meaningful user influence over what happens next, and room for at least two short turns. A falling cup with an already-determined harmless outcome, a combat montage, or a dice result that must be adjudicated before the user can act should stay NORMAL.

The router owns the handoff boundary, not permission to manufacture drama. It must not invent an unsupported attacker, crash, trap, or other major event merely to trigger FLASH. When the broad model is otherwise authorized to establish such an event, it may write only the first interruptible beat and then hand off.

Consequential stakes do not by themselves block entry. FLASH may simulate the safe immediate beats of a fight or hazard, then escalate before deciding a dice check, major injury, decisive combat result, irreversible loss, or other outcome reserved for broad authority.

## The LOCAL FRAME contract

The capsule is a working set, not a scene summary.

### Center

The immediate place, interaction, or activity under the lens: beside a stream, at a workbench, halfway through an argument, crouched behind a wall, walking along a market street.

### Scale

The practical close scale at which the next few turns occur: arm's reach, room/clearing, street segment, immediate moving vicinity. Scale describes resolution, not an absolute geometric boundary.

### Immediate horizon

What can presently be perceived, answered, reached, or affected in the next few turns. Distant context may remain visible as background without becoming fully simulated.

### Canonical anchors

Established details that cannot drift: current actors, terrain or geometry that matters, positions, relevant objects, ongoing actions, known weather, relationships, knowledge limits, commitments, and unresolved local facts.

### Generative range

Categories of missing detail the fast model may materialize coherently at the current scale: sensory texture, terrain, vegetation, ambient life, architecture, surfaces, mundane objects, weather texture, or conversational/physical micro-behavior.

Generative range is intentionally contextual. A pine forest, nightclub queue, moving train, and surgical bay should not receive the same kinds of invented detail.

## Generated local detail

Generated detail is accepted simulation content, not an error. It may make the moment concrete and support ordinary interaction.

Examples:

- roots make one patch of an established forest trail uneven;
- insects move over the water beside an established riverbank;
- a takeaway cup sits on an otherwise unspecified station bench;
- an NPC shifts their grip during an established tense conversation;
- a screwdriver rolls slightly when the user bumps an established workbench.

Persistent generated detail is marked `GENERATED` in the hidden delta. Once shown, it stays coherent while relevant and if the user immediately returns to it.

Generated detail does not automatically acquire broad narrative authority. A generated glint in the weeds cannot later become the murder weapon, magical key, or unique quest solution unless the Anchor authorizes that development. This boundary prevents a fast local model from accidentally deciding the larger plot while still allowing it to improvise freely at close scale.

## FLASH authority

FLASH may:

- combine environment, dialogue, observation, and physical action in whatever proportion the immediate turn needs;
- continue established actors authorized by the capsule;
- resolve explicit, ordinary, unopposed user actions and their immediate consequences;
- continue immediate local beats of a struggle, chase, contest, or skilled task until a consequential outcome needs broader judgment;
- render locally available sensation, terrain, weather texture, architecture, vegetation, ambient non-consequential life, surfaces, objects, and micro-movement;
- materialize contextually coherent mundane detail within GENERATIVE RANGE;
- let the local frame roll with continuous nearby movement;
- allow ordinary interaction with established or generated local detail;
- advance only the short time directly consumed by the response.

FLASH must not:

- control the user character beyond explicitly supplied speech and actions;
- contradict canonical anchors or silently rewrite still-relevant generated details;
- introduce a significant new character, creature, arrival, remote event, or lore fact;
- turn generated texture into a major secret, clue, threat, opportunity, unique solution, or consequential resource without authorization;
- resolve consequential combat, a skilled contest, dangerous maneuver, consequential discovery, major injury, irreversible commitment, or other outcome requiring broad judgment;
- perform a time skip, travel montage, remote cut, or jump to a distant destination;
- alter hidden agendas, quests, factions, narrative seeds, or global state.

## Rolling-frame policy

The frame is bounded by attention and continuity, not by a house, parcel, room, or fixed map.

- Continuous nearby movement may translate the center: down a trail, along a beach, through a crowd, across a room, or around a vehicle.
- Each response renders only the immediate result, not the whole route or destination.
- Anchors that leave the horizon may fall out of the active working set, but interacted-with or navigationally important details remain available if the user turns back.
- A significant change of scene, long travel, montage, or jump to a distant target escalates.
- After a bounded number of turns, the orchestrator should rebase the capsule around the new center rather than asking the model to carry an ever-growing trail of deltas.

The rebase interval must be benchmarked. A starting manual-test policy is rebase after 6–10 fast turns or sooner when the center, active actors, or practical scale changes substantially.

## Perception and user authority

Immediate embodied second person is allowed for physically available or directly caused sensation: “The stream is cold against your fingers” after the user puts a hand in it, or “From here, the path disappears behind the reeds.” It must not become an unsupplied choice: “You study the ridge,” “you grow suspicious,” and “you head uphill” are forbidden unless supplied by the user.

An explicit user action supplies authority for that action. If the user writes “I kneel and put my hand in the stream,” FLASH may resolve the kneeling, contact, and immediate response of water, mud, clothing, or nearby actors. It may not add “then you drink.”

## Landing policy

Landing uses this order:

1. User-authored speech and actions.
2. Canonical facts from full context and the last valid Internal States.
3. Visible FLASH actions and events compatible with levels 1–2.
4. Compatible generated local details.
5. Deltas as fallible reconciliation notes.

Landing retains final positions, conditions, commitments, changed objects, knowledge, and generated details needed for future continuity. Incidental texture that passed out of the rolling frame does not need to bloat Internal States.

## Required adversarial fixtures

Before implementation, manually test at least:

1. bare trigger in a forest with no NPC present;
2. close observation and ordinary interaction beside a stream;
3. rolling movement down a trail without rendering the full route;
4. turning back to a generated landmark without drift;
5. user-triggered FLASH in the middle of dialogue;
6. a mixed turn containing speech, object use, and nearby movement;
7. a physical repair or crafting task with ordinary local consequences;
8. an urban street or crowd with ambient but non-significant people;
9. a moving vehicle whose immediate context changes continuously;
10. a user request for a consequential clue, rare resource, or hidden threat;
11. a move toward a distant destination that should escalate;
12. a long segment that requires local-frame rebase;
13. hard canon contradicting plausible generated texture;
14. an explicit user action that must be resolved without adding another action;
15. a shift from environmental observation into conversation with an authorized actor.
16. automatic handoff at the first interruptible beat of a fight or struggle;
17. automatic handoff for a non-combat urgent event such as a chase, accident, escape, hazard, or time-sensitive physical task;
18. a fast but non-interactive event that must remain NORMAL;
19. a FLASH fight or hazard that escalates before a consequential outcome.

FLASH remains behind the existing implementation gate. This specification and its prompts define a manual-testable protocol; they do not establish that the fast-model path is reliable enough to ship.
