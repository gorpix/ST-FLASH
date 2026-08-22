# Superseded: site-bounded FPS draft

This draft overfit the user-triggered mode to building exploration. It is retained as a design snapshot only. The current specification is `local-frame-mode-v0.md`, which defines FLASH as a rolling, zoomed-in local simulator for dialogue, nature, streets, movement, physical tasks, and mixed scenes.

## Decision

FLASH gains a user-triggered `FPS` profile: **Flash Perspective Simulator**. It may begin from any established physical scene, including a scene with no present NPC and no dialogue boundary.

FPS is not a truth-preserving view of a fully specified world. It is an immersive, locally generative simulation. The UI must make that product boundary clear when the user enters the mode; the prose itself should remain in-world.

The existing dialogue-oriented profile remains `INTERACTION`. Automatic routing may still offer `INTERACTION`, but `FPS` is entered only by an explicit user action in v0.

## User-facing trigger

The eventual extension should expose a FLASH/FPS button and an optional `/flash` command. Both produce an out-of-band control event:

```xml
<flash_request mode="FPS"/>
```

The control event is not roleplay speech and must not be stored as something the user character said. For manual tests, the same exact marker may be injected as a system/control message.

If the user includes an action with the trigger, the action remains an ordinary user-authored roleplay action. The control marker only selects the model path.

## Entry lifecycle

1. The user triggers FPS from an existing physical scene.
2. The Anchor emits no new roleplay prose. It freezes the last complete Internal States and emits `<flash_handoff mode="FPS"/>`.
3. The capsule generator reads full context and creates an FPS capsule. It separates hard environment facts from the bounded license to invent soft detail. If the trigger accompanies a user action, the capsule baseline is the instant before that action.
4. The orchestrator passes any accompanying user action unchanged after the capsule. The fast model renders only what is locally perceivable from the user's current position. A bare trigger produces an establishing sensory beat; an accompanying action is resolved if it is within FPS authority.
5. Each accepted turn appends one hidden delta. Newly invented detail is recorded as `SOFT` and cannot be silently changed later in the same session.
6. Explicit exit, interruption, turn/time limit, malformed output, or escalation invokes Landing.
7. Landing reconciles the transcript against hard canon. Compatible soft details that became durable, navigational, or interacted-with are promoted into canonical state. Incidental texture may remain only in the transcript.

If there is no established physical scene—for example, the roleplay is at an abstract character-creation screen—the trigger fails cleanly and ordinary mode remains active.

## Two levels of environmental truth

### Hard canon

Facts established by full context, lore, the user's actions, or the last valid Internal States. FPS may reveal or interact with them but never contradict them.

Examples: the apartment is on the fourth floor; the kitchen door is locked; Mara is present; the user already holds the brass key.

### Soft canon

Low-consequence detail invented under the capsule's generative license. Once visible in prose, it becomes fixed for the rest of that FPS session. Landing may promote it if it matters to continuity.

Examples: weak afternoon light on the parquet; a chipped blue mug beside the sink; dust collected along the skirting board; the bedroom lies past the short hall.

Soft canon is not permission to invent plot. A detail cannot be introduced as “ambient” and then used as evidence, a secret, a unique solution, or a consequential resource.

## FPS authority

FPS may:

- render sight, sound, smell, temperature, texture, scale, lighting, and ordinary bodily sensation available from the current position;
- instantiate mundane architecture, fixtures, clutter, wear, and low-stakes personal traces that fit established context;
- establish adjacent rooms or subareas inside the bounded current site, one locally perceivable connection at a time;
- resolve explicit, ordinary, unopposed user actions such as looking under a table, opening an ordinary unlocked cupboard, or walking through a visible open doorway;
- supply mundane container contents when their contents carry no plot, identity, safety, possession, or resource consequence;
- continue authorized present NPCs when they naturally react to the user's supplied action;
- advance only the short amount of time directly consumed by the supplied action and response.

FPS may not invent or decide:

- a new person, creature, arrival, voice, or off-screen event;
- evidence, secrets, passwords, keys, weapons, valuables, money, medicine, hazards, traps, surveillance, or unique/special items;
- biographical or relationship facts about a resident merely from environmental cues;
- access through a locked, guarded, forbidden, or otherwise consequential boundary;
- a new building, remote destination, time skip, scene cut, or exit from the capsule's bounded site;
- combat, a skilled contest, a major injury, discovery success, or any outcome that needs a roll or broader narrative judgment;
- the user character's unsupplied speech, thought, decision, attention, movement, or action.

Environmental cues may suggest an interpretation but must not prove it. A row of race medals may make a room look like it belongs to a runner; it does not establish who won them unless hard canon does.

## Spatial policy

The capsule defines a `SITE BOUNDARY`, not a fully generated map. FPS reveals the site progressively.

- Known geometry is hard canon.
- Newly materialized geometry is soft canon.
- A connection becomes fixed when it is described: if the kitchen is said to be left of the hall, it stays there.
- Only an adjacent, perceivable connection may be added in one turn.
- Crossing a mundane visible threshold requires an explicit user action.
- Crossing the site boundary or a consequential threshold escalates.

This keeps exploration open-ended without allowing the fast model to teleport, remodel the house between turns, or author a whole unseen floor plan in advance.

## Perception and user authority

FPS uses immediate embodied second person for directly caused or available sensation: “Cold air touches your wrist” and “From here, you can see…” are allowed. It must not turn perception into an unsupplied choice: “You study the photograph,” “you become suspicious,” and “you walk closer” are forbidden unless the user supplied those acts.

An explicit user statement supplies authority for that action. If the user writes “I cross the hall and open the cupboard,” FPS may narrate the crossing, the opening, and their immediate sensory consequences. It may not add “then you search every drawer.”

## Landing policy

Landing uses this order:

1. User-authored speech and actions.
2. Hard facts from full context and the last valid Internal States.
3. Visible FPS transcript events.
4. Compatible `SOFT` layout and environment details.
5. Deltas as fallible reconciliation notes.

Hard canon repairs a contradiction; details are never averaged. Landing should retain position, access state, changed objects, interacted-with details, and layout needed to revisit the site. It should not bloat Internal States with every smell, shadow, or decorative adjective.

## Required adversarial fixtures

Before implementation, manually test at least:

1. an empty established room with a bare FPS trigger;
2. progressive exploration through three adjacent rooms;
3. revisiting a generated room without layout or object drift;
4. a user searching specifically for a key, weapon, document, or evidence;
5. an ordinary cupboard containing harmless mundane items;
6. a locked door and an attempted forced entry;
7. personal clutter that suggests but does not establish biography;
8. an authorized NPC interrupting exploration;
9. an attempted exit beyond the site boundary;
10. hard canon contradicting a plausible soft detail;
11. a user action that bundles allowed movement with a disallowed discovery;
12. a long session that tests accumulated geometry and object persistence.

FPS remains behind the existing implementation gate. This document and the v0 prompts define a manual-testable protocol; they do not establish that the fast-model path is reliable enough to ship.
