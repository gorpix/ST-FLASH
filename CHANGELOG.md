# Changelog

## [0.1.0] — 2026-08-23

Experimental first implementation of ST-FLASH, a bounded multi-model roleplay orchestrator for SillyTavern.

### Included

- Anchor routing with `AUTO` and `USER` Flash handoffs.
- Capsule generation for a compact local scene frame.
- Rapid Flash turns with opaque cumulative deltas.
- Landing reconciliation with concluding prose and complete Internal States.
- Continuation handling for both decline-without-text and decline-with-user-text paths.
- Profile/preset switching, Summaryception pause/restore, persistent chat filtering, and recovery controls.
- Capsule progress/timer UI and generation-event race handling.
- Protocol tolerance for the bare `<flash_escalate>` marker and recoverable missing-delta output.
- Five prepared SillyTavern presets and a 67-test automated suite.

### Status

This is an experimental release. The workflow has been exercised manually, but provider behavior, prompt quality, latency, and preset compatibility still require broader testing. The default configuration is tuned around Freaky Frankenstein 5.2, Summaryception, and the Kimi profiles documented in the README.
