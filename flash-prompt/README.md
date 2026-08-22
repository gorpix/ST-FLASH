# FLASH prompt pack

This folder is the portable source for the FLASH prompt profiles. It is independent of any particular SillyTavern installation.

## Ready to paste

`presets/flash-main-v0.7-minimal.txt` is the current minimal main prompt. It keeps the permissive local-frame authority while leaving all output styling, POV, and length rules to separate modules. `flash-main-v0.6-compact.txt` and `flash-system-v0.5-permissive.txt` retain progressively expanded wording as reference snapshots.

`capsule/capsule-generator-v1.0-local-frame.txt` is the current capsule generator. It extracts the smallest useful LOCAL FRAME for several immediate turns, whether entry was user-triggered or automatically routed, and separates canonical anchors from a contextual GENERATIVE RANGE.

`landing/landing-reconciler-v0.4-prose.txt` is the current manual landing prompt. It reconciles the rolling frame, treats deltas as fallible notes, retains only generated details needed for future material, spatial, or causal continuity, and requires roughly 150 words of concluding prose unless the user explicitly requests a state-only landing. Earlier versions are retained as design snapshots.

`continuation/decline-continuation-v0.1-simple.txt` completes an existing K3-max assistant message after a FLASH offer is declined. It preserves A's text, forbids supplying a missing user response, avoids a duplicate header, and appends one complete FF5.2 state.

`anchor/anchor-flash-router-v0.4.txt` is the current Anchor contract. In addition to a trusted general user trigger, it automatically routes reply-bearing exchanges and short-timescale interactive events such as fights, chases, accidents, escapes, hazards, and urgent physical tasks. Automatic routing does not authorize unsupported events, and consequential outcomes still escalate back to the broad model. NORMAL responses remain ordinary FF5.2 responses with complete Internal States. The `v0.3` conditional state-output files remain compatible because the handoff marker format is unchanged.

The current behavioral boundary—including the rolling working set, generated local detail, continuous movement, escalation, and required fixtures—is in `../docs/local-frame-mode-v0.md`. The earlier site-bounded FPS document is retained only as a superseded design snapshot.

The general manual fixture is `../fixtures/flash-outdoor-local-frame-v0.md`. It tests a bare trigger in nature, embodied interaction, a moving local frame, return continuity, consequential search, and distant-transition escalation. `../fixtures/flash-auto-quick-event-v0.md` tests automatic entry for a fight and other short-timescale events, plus false positives and consequential-outcome escalation. The apartment fixture remains as a narrower indoor adversarial case.

## Source modules

The files in `modules/` contain the v0.4 prompt split into functional sections. Their intended order is:

1. `00-core.txt`
2. `10-output-style.txt` (maintained separately; not included in the compact main prompt)
3. Optional `11-output-length.txt`
4. Optional `12-hybrid-pov.txt`
5. `20-user-authority.txt`
6. `30-flash-authority.txt`
7. `40-escalation.txt`
8. `50-flash-delta.txt`

The monolithic preset is presently a snapshot of those modules. When a module changes, update the combined preset before pasting it into SillyTavern.

## Planned FF-compatible modules

POV, output length, tense, narration style, dialogue formatting, and other Freaky Frankenstein compatibility rules remain separate from the core. Compact backups for the current output length and Hybrid POV choices are included in `modules/`.
