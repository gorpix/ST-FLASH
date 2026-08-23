# ST-FLASH v0.1.0

ST-FLASH is an experimental bounded roleplay orchestrator for SillyTavern. It lets a high-quality Anchor model hand a local exchange to a fast Flash model, then returns the scene to a Landing model for reconciliation.

## What is included

- Five prepared presets: Anchor, Capsule, Flash, Landing, and Continuation.
- Automatic and user-triggered Flash handoffs.
- Compact capsule context and cumulative Flash deltas.
- Hidden Flash transcript handling and final Internal States regeneration.
- Decline steering, recovery/retry controls, and persistent chat filtering.
- Summaryception pause/restore integration.
- Capsule generation progress and elapsed-time display.
- Protocol parsing for the canonical bare `<flash_escalate>` marker plus older compatible forms.

## Verification

- Presets regenerate successfully from the checked-in sources.
- Automated tests: 67 passed, 0 failed.
- Manual provider testing is still required; this release does not claim broad model or preset compatibility.

## Installation

1. In SillyTavern, open **Extensions → Install Extension**, paste `https://github.com/gorpix/ST-FLASH`, and install.
2. Import the five JSON files from `presets/prepared/` into the appropriate SillyTavern preset collection.
3. Configure the three model profiles and the exact preset names in the ST-FLASH settings panel.
4. Keep a backup of the working SillyTavern presets and chat data before testing.

The extension does not include API credentials, private chats, character cards, Summaryception itself, or a complete FF5.2 preset installation.

## Important limitations

This is a v0.1 experiment, not a stable general-purpose extension. It is tuned around the documented FF5.2/Summaryception workflow and requires models that follow the structured capsule/delta/Internal States contracts. Prompt quality, provider latency, continuation behavior, and compatibility with other presets remain empirical questions.
