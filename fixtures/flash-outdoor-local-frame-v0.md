# FLASH manual fixture: rolling outdoor local frame

## Purpose

Test that user-triggered FLASH creates a compact zoomed-in working context rather than an indoor exploration mode. The fixture covers a bare trigger in nature, ordinary embodied interaction, generated detail, continuous frame movement, return continuity, consequential search, and distant-transition escalation.

Expected outcomes are invariants, not one exact prose completion.

## Canonical context before trigger

- It is late afternoon on an overcast spring day.
- The user character, Mira, is alone on a marked foothill trail beside a shallow stream.
- The trail continues uphill toward a fire lookout approximately two hours away.
- Mira has stopped walking but has not knelt, touched the water, or chosen a direction.
- The ground is damp from earlier rain. No exact vegetation, stones, insects, sounds, or shape of the next bend has been established.
- No dangerous animal, hidden person, rare resource, lost object, hazard, or clue has been established.

## Control event

```xml
<flash_request/>
```

## Expected capsule invariants

- `ENTRY` is `USER`.
- `LOCAL FRAME.CENTER` is Mira's immediate position beside the stream and trail.
- `SCALE` is the nearby trail/stream margin, not the entire route or valley.
- `IMMEDIATE HORIZON` includes what can be perceived or reached in the next few turns.
- Canonical anchors contain the stream, marked uphill trail, damp ground, overcast conditions, and distant lookout relationship without inventing local detail.
- `GENERATIVE RANGE` permits plausible foothill vegetation, water behavior, ordinary terrain texture, weather texture, ambient sound, insects, and mundane natural objects.
- `AUTHORIZED LOCAL ACTORS` is `NONE`.
- The capsule does not generate a map, pre-decide the next bend, or summarize the two-hour route.

## Turn 1: bare entry

The FLASH response should:

- render one immediate local beat from Mira's established position;
- combine close sensory and spatial detail naturally;
- avoid moving Mira or choosing what she attends to;
- allow generated details such as ferns, exposed roots, a flat stone, water noise, or a dragonfly;
- avoid revealing the wider route or adding a significant animal/person/event;
- record persistent generated detail as `GENERATED` under `MATERIALIZED`;
- leave natural affordances in prose without presenting a choice menu.

Example acceptable delta shape:

```xml
<flash_delta>
TIME: N/A
LOCAL_FRAME: N/A
POSITION: N/A
CONDITION: N/A
ACTORS: N/A
MATERIALIZED: GENERATED: A flat grey stone projects from the near bank below a patch of ferns.
ENVIRONMENT: N/A
KNOWLEDGE: Mira can observe the stone and ferns as local scene facts.
PROPOSAL: N/A
POSSESSION: N/A
COMMITMENT: N/A
OTHER: N/A
</flash_delta>
```

## Turn 2: supplied embodied interaction

User:

> I kneel on the bank and put my right hand in the stream.

The FLASH response should:

- resolve exactly the supplied kneeling and contact;
- describe immediate water, mud, sleeve, temperature, balance, sound, or ambient-life consequences as locally appropriate;
- preserve the generated stone and ferns if they remain relevant;
- update position/condition/environment accurately;
- not add drinking, washing, searching, standing, or an emotional conclusion.

## Turn 3: rolling movement

User:

> I get up and follow the trail around the next bend.

The FLASH response should:

- resolve only this short continuous movement;
- roll `LOCAL_FRAME.CENTER` to the nearby bend;
- retain enough relationship to the stream and previous bank for an immediate turn-back;
- materialize only the new immediate horizon, not the remaining route or lookout;
- avoid treating movement as a new broad scene.

If Mira immediately returns to the stream, the flat stone and ferns must not change or disappear merely because they briefly left the active horizon.

## Turn 4A: consequential local search

User:

> I search the bank for the missing silver locket.

Expected behavior:

- do not invent the locket or decide a consequential search outcome;
- render at most the last safe immediate perception;
- emit `<flash_escalate reason="consequential search for an unestablished item"/>`;
- append one delta containing only events actually established before escalation.

A generated glint, scrap, or ordinary object may not be laundered into the locket.

## Turn 4B: distant transition

Alternative user turn:

> I keep going until I reach the fire lookout.

Expected behavior:

- do not montage two hours of travel or render arrival;
- provide at most the last safe immediate movement/perception;
- escalate because reaching the lookout requires broad travel and a meaningful scene transition.

## Failure conditions across the fixture

- FLASH behaves like a room crawler or describes nature as a floor plan.
- Mira moves, searches, drinks, thinks, or chooses without supplied authority.
- The model generates the entire trail, distant destination, or unseen landscape in advance.
- Generated texture becomes a significant threat, clue, rare resource, or plot event.
- The frame cannot move continuously, or moving causes recent generated anchors to drift immediately.
- A mundane nearby action escalates merely because it changes the local frame.
