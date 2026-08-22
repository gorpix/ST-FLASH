# FLASH automatic fixture: short-timescale interactive events

## Purpose

Test that the Anchor automatically routes immediate, interruptible situations into FLASH even when they are physical rather than conversational. The fixture covers fight onset, a non-combat hazard, consequential escalation, and false positives.

Expected outcomes are invariants, not one exact prose completion. These cases test routing and authority separately: a situation may qualify for FLASH even though its eventual outcome must return to the broad model.

## Case 1: fight begins

### Canonical context before the response

- The user-controlled character, Mara, is face-to-face with Rook in a narrow tavern passage.
- Rook is an established actor. He is furious, has just threatened Mara, and has one empty hand clenched at his side.
- No weapon, injury, combat result, or user reaction has been established.
- The newest user turn says: `I shove him back. "Then make me leave."`

### Expected Anchor behavior

- The Anchor may resolve only the immediate ordinary consequence of the supplied shove and establish Rook's authorized reaction.
- If Rook starts a fight, the response stops at the first interruptible physical beat—for example, as he regains balance and begins a swing—before contact or Mara's reaction is decided.
- It appends exactly `<flash_handoff entry="AUTO"/>` and omits Internal States.
- The handoff prose does not supply Mara's dodge, guard, thoughts, injury, or counterattack.
- The capsule records Rook, the passage geometry that matters, current positions, the ongoing incoming action, and the absence of a decided outcome.

### Failure conditions

- The Anchor narrates an exchange of blows or decides who wins before handoff.
- It makes the punch connect merely because it initiated the swing.
- It refuses FLASH solely because the situation is combat.
- It invents a weapon or additional attacker to intensify the event.

## Case 2: immediate non-combat hazard

### Canonical context before the response

- The user-controlled character, Ilya, is helping an established mechanic steady a suspended engine in a workshop.
- An established chain is under visible strain, and both characters are within arm's reach of the workbench controls.
- The next ordinary story beat is that one chain link begins to deform. It has not broken, and no injury or damage has occurred.

### Expected Anchor behavior

- The Anchor may describe the first perceptible failure beat and stop where Ilya can immediately intervene.
- It appends `<flash_handoff entry="AUTO"/>` without resolving whether the chain breaks or presenting a choice menu.
- The capsule gives FLASH only the established equipment, actors, positions, immediate hazard, and locally relevant mechanics.
- FLASH may play through safe close reactions over short turns but must escalate before deciding major injury, destruction, or a consequential skilled check.

## Case 3: consequential boundary after entry

Continue Case 1 in FLASH until Mara explicitly attempts a dangerous maneuver whose success would end the fight or cause major injury.

Expected behavior:

- FLASH may render only the last safe immediate perception or authorized reaction.
- It does not decide the maneuver's success, the winner, major injury, or a required dice result.
- It emits `<flash_escalate reason="consequential combat outcome"/>` and records only changes actually established before escalation.
- Landing or the broad model then adjudicates the consequential outcome.

## Case 4: fast events that stay NORMAL

The following do not qualify merely because they happen quickly:

- an already-thrown glass falls and shatters where no user action can affect it;
- an ordinary unopposed door opening completes in one beat;
- a requested attack whose hit, damage, or dice result must be adjudicated before any new response point exists;
- a compressed summary of an entire chase or fight;
- a surprise attacker or hazard unsupported by the scene and invented only to create a FLASH handoff.

Expected behavior:

- The Anchor writes the appropriate complete NORMAL response and Internal States.
- It does not append a handoff marker.

## Cross-case routing invariants

- Meaningful immediate participation, not urgency alone, is the routing signal.
- The first FLASH response point is concrete and naturally interruptible.
- The Anchor does not withhold an outcome the user has already earned.
- The prospect of a later consequential outcome does not block entry; FLASH's authority boundary controls when to escalate.
- No response labels the prose as a "quick-time event" or adds a timer, button prompt, or game-like option list unless another active preset explicitly requires that style.
