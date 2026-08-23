# ST-FLASH

ST-FLASH is a sorta roleplay orchestrator for SillyTavern.
Built around the Freaky Frankenstein 5.2 preset, Summaryception and Kimi K3 / K2.7-code-highspeed models.

Good luck with other configurations.
It should generally work as long as your fast model has structured output.

The five-role v0.1 pipeline uses three model profiles:

- **Anchor:** Kimi K3 Max with the full FF5.2 context and Summaryception enabled.
- **Capsule:** Kimi K2.7 Code Highspeed extracts a compact local frame.
- **Flash:** Kimi K2.7 Code Highspeed handles rapid user/NPC microturns with compact deltas.
- **Landing:** Kimi K3 Low or High writes concluding prose and reconstructs complete FF5.2 Internal States.
- **Continuation:** Kimi K3 Low handles both decline branches: appending to the interrupted Anchor reply when no user text is supplied, or answering the user's decline/steering text as a new ordinary turn.

Anchor runs on the A profile, Capsule and Flash share the B profile, and Landing and Continuation share the C profile. `FF5.2 custom` is not an ST-FLASH route. Not really sure it's needed either.

Undocumented module edits have been made to the FF5.2 preset.

## Runtime flow

1. Anchor writes ordinary prose or ends at a useful interaction boundary with a terminal `<flash_handoff entry="AUTO|USER"/>` marker.
2. ST-FLASH strips the marker from display and offers Flash mode. Optional text entered with Accept becomes the first Flash user turn. Optional text entered with Decline steers Continuation.
3. Capsule creates the compact local frame. Flash then handles rapid user/NPC microturns and emits one hidden delta per assistant turn.
4. Landing always writes concluding prose plus complete Internal States, then archives the raw Flash segment from future model context.
5. Summaryception is enabled for Anchor and both Continuation paths, disabled during Flash and Landing, and restored before the next Anchor turn.

## Installation

In SillyTavern, open **Extensions → Install Extension**, paste the repository URL below, and install:

`https://github.com/gorpix/ST-FLASH`

Then import the five JSON presets from `presets/prepared/` and configure the three model profiles and exact preset names in the ST-FLASH settings panel.

## Repository layout

- `docs/` — architecture and pre-implementation decisions.
- `fixtures/` — manual behavioral and adversarial test cases.
- `flash-prompt/` — modular prompts and historical prompt snapshots.
- `presets/sillytavern/` — credential-checked snapshots of the working SillyTavern presets.
- `presets/prepared/` — the five generated presets intended for installation.
- `src/` — orchestration, role switching, protocol parsing, persistence, and UI logic.
- `tests/` — Node unit and controller integration tests.
- `tools/prepare-presets.mjs` — regenerates installable presets from the prompt sources.

## Development

```powershell
npm test
node tools/prepare-presets.mjs --source presets/sillytavern --target presets/prepared
```

## Baseline

The initial commit is the pre-implementation checkpoint copied from the working home-PC setup on 2026-08-22. The SillyTavern installation, private chats, character data, API credentials, and generated media are intentionally outside this repository.

# Requirements

Unknown: Summaryception

# Pending

Testing,

# To-Do

Lots of stuff. Delegation/escalation prompt tuning is first priority. Make it preset-agnostic.
