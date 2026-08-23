# ST-FLASH

ST-FLASH is an experimental adaptive multi-model roleplay orchestrator for SillyTavern.

The five-role v0.1 pipeline uses three model profiles:

- **Anchor:** Kimi K3 Max with the full FF5.2 context and Summaryception enabled.
- **Capsule:** Kimi K2.7 Code Highspeed extracts a compact local frame.
- **Flash:** Kimi K2.7 Code Highspeed handles rapid user/NPC microturns with compact deltas.
- **Landing:** Kimi K3 Low or High writes concluding prose and reconstructs complete FF5.2 Internal States.
- **Continuation:** Kimi K3 Low handles both decline branches: appending to the interrupted Anchor reply when no user text is supplied, or answering the user's decline/steering text as a new ordinary turn.

Anchor runs on the A profile, Capsule and Flash share the B profile, and Landing and Continuation share the C profile. `FF5.2 custom` is not an ST-FLASH route.

The prompt protocol has been validated manually, including a long Flash exchange followed by successful Landing reconciliation. Extension implementation is in progress on the `implementation` branch; the controller, role adapters, Summaryception adapter, settings UI, prepared presets, and automated unit tests are present. The live SillyTavern installation is not modified until the integration suite is green and a backup is created.

## Runtime flow

1. Anchor writes ordinary prose or ends at a useful interaction boundary with a terminal `<flash_handoff entry="AUTO|USER"/>` marker.
2. ST-FLASH strips the marker from display and offers Flash mode. Optional text entered with Accept becomes the first Flash user turn. Optional text entered with Decline steers Continuation.
3. Capsule creates the compact local frame. Flash then handles rapid user/NPC microturns and emits one hidden delta per assistant turn.
4. Landing always writes concluding prose plus complete Internal States, then archives the raw Flash segment from future model context.
5. Summaryception is enabled for Anchor and both Continuation paths, disabled during Flash and Landing, and restored before the next Anchor turn.

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
