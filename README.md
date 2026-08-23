# ST-FLASH

ST-FLASH is a sorta roleplay orchestrator for SillyTavern.
Built around the Freaky Frankenstein 5.2 preset, Summaryception and Kimi K3 / K2.7-code-highspeed models.

Good luck with other configurations.
It should generally work as long as your fast model has structured output.

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

# Requirements

Unknown: Summaryception

# Pending

Testing,

# To-Do

Lots of stuff. Delegation/escalation prompt tuning is first priority. Make it preset-agnostic.
