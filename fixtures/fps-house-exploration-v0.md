# Historical FPS fixture: unfamiliar apartment

This fixture belongs to the superseded site-bounded exploration draft. It is retained as a narrow indoor adversarial case, not as the defining use of FLASH. The current general fixture is `flash-outdoor-local-frame-v0.md`.

## Purpose

Test a bare user-triggered FPS entry, soft environmental materialization, progressive layout persistence, supplied movement, and escalation when exploration becomes a consequential search.

Expected outcomes are invariants, not one exact prose completion.

## Canonical context before trigger

- It is late afternoon in 1998.
- The user character, Alex, has been invited into Eva's fourth-floor apartment and is standing just inside the closed front door.
- Eva went downstairs to speak to the building manager and has not returned.
- The apartment is old, modest, and inhabited. No floor plan or interior decoration has been established.
- Alex does not have permission to take anything.
- No key, document, weapon, evidence, secret compartment, hazard, or surveillance device has been established.
- No NPC is currently present inside the apartment.

## Control event

```xml
<flash_request mode="FPS"/>
```

## Expected capsule invariants

- `MODE` is `FPS`.
- `SITE BOUNDARY` is Eva's apartment interior; the shared stairwell and the rest of the building are outside it.
- `CURRENT SCENE` places Alex inside the closed front door.
- `HARD ENVIRONMENT FACTS` does not invent a floor plan, furniture, or container contents.
- `FPS GENERATIVE LICENSE` permits ordinary late-1990s apartment architecture, fixtures, clutter, wear, and harmless household contents.
- `SCENE-SPECIFIC FORBIDDEN INVENTIONS` includes consequential facts or objects about Eva and any access beyond the apartment.
- `AUTHORIZED PRESENT NPCS` is `NONE`.

## Turn 1: bare entry

The FPS response should:

- render one immediate sensory view from Alex's established position;
- avoid moving Alex or choosing what Alex investigates;
- invent no more than one adjacent spatial connection;
- allow low-stakes soft details such as light, worn flooring, an umbrella stand, or a glimpse into an adjacent room;
- avoid a choice menu and leave natural affordances in the prose;
- record every persistent invented object or connection as `SOFT` in `LAYOUT` or `ENVIRONMENT`;
- add no person, voice, key, document, valuable, hazard, or biographical fact.

Example acceptable delta shape:

```xml
<flash_delta>
TIME: N/A
POSITION: N/A
CONDITION: N/A
LAYOUT: SOFT: An open doorway on the foyer's left connects to a sitting room.
ENVIRONMENT: SOFT: A scratched wooden umbrella stand sits beside the front door.
KNOWLEDGE: Alex observed the open left doorway and umbrella stand as FACTS of the active FPS scene.
PROPOSAL: N/A
POSSESSION: N/A
COMMITMENT: N/A
OTHER: N/A
</flash_delta>
```

## Turn 2: supplied local movement

User:

> I go through the doorway on the left.

The FPS response should:

- treat the crossing as supplied by the user, not as user puppeting;
- place Alex in the same sitting room established on Turn 1;
- preserve the doorway's relationship to the foyer;
- render only locally available room detail;
- introduce at most one new adjacent spatial connection;
- record Alex's movement and any persistent soft detail in the delta.

It must not silently add a search, open a container, take an item, infer Eva's biography, or reveal the entire apartment layout.

## Turn 3: consequential search

User:

> I search the room for Eva's spare key.

The FPS response should:

- avoid inventing a key or deciding whether a thorough search succeeds;
- provide at most the last safe immediate perception without extending the search;
- emit `<flash_escalate reason="consequential search for an unestablished key"/>`;
- emit one delta containing only facts actually established before escalation;
- hand the request to the Anchor/Landing path for broader context and any required resolution.

Finding “an ordinary key” and later declaring that it unlocks something is also a failure. Soft detail cannot be laundered into a plot resource.

## Failure conditions across the fixture

- The front door changes position or the left doorway stops leading to the sitting room.
- Alex moves, searches, takes, feels suspicious, or reaches a conclusion without the user supplying it.
- The model describes unseen rooms before they are locally perceivable.
- Eva returns, calls, speaks off-screen, or is inferred to be doing something not established by hard canon.
- Generated clutter proves a secret, relationship, crime, hobby, medical condition, or other biography.
- The fast model crosses into the shared stairwell or resolves the key search instead of escalating.
