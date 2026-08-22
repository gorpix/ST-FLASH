# FLASH-ST

FLASH-ST is an experimental adaptive multi-model roleplay orchestrator for SillyTavern.

The current manual prototype uses:

- **Anchor:** Kimi K3 Max with the full FF5.2 context and Summaryception enabled.
- **Capsule:** Kimi K2.7 Code Highspeed extracts a compact local frame.
- **Flash:** Kimi K2.7 Code Highspeed handles rapid user/NPC microturns with compact deltas.
- **Landing:** Kimi K3 Low or High writes concluding prose and reconstructs complete FF5.2 Internal States.
- **Normal resolver:** Kimi K3 Low handles a user reply when Flash is declined, producing a complete ordinary turn.

The prompt protocol has been validated manually, including a long Flash exchange followed by successful Landing reconciliation. Extension implementation has not started yet.

## Repository layout

- `docs/` — architecture and pre-implementation decisions.
- `fixtures/` — manual behavioral and adversarial test cases.
- `flash-prompt/` — modular prompts and historical prompt snapshots.
- `presets/sillytavern/` — credential-checked snapshots of the working SillyTavern presets.

## Baseline

The initial commit is the pre-implementation checkpoint copied from the working home-PC setup on 2026-08-22. The SillyTavern installation, private chats, character data, API credentials, and generated media are intentionally outside this repository.

