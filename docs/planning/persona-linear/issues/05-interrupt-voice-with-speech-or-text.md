# 05: Interrupt spoken replies with speech or typed messages

Published: [AW-76](https://linear.app/ashwinworkspace/issue/AW-76/interrupt-spoken-replies-with-speech-or-typed-messages). Label: ready-for-agent.

## What to build

A user can interrupt the agent naturally or type while it speaks. Outdated playback stops, the new input takes precedence, and the call stays open for the next spoken reply.

## Scope

Implement turn supersession and accurate delivery state for live voice. Explicit hangup and page recovery are covered by the separate call-recovery slice.

## Acceptance criteria

- [ ] Speaking while the agent talks interrupts audible output and lets the new user turn lead the next response.
- [ ] Submitting typed text during speech cancels stale generation and buffered playback without ending the call.
- [ ] The typed turn appears once in the shared transcript; the next reply is spoken and appears in text while the call remains active.
- [ ] A late response or state proposal from a superseded turn cannot overwrite the newer turn's accepted state or resume stale playback.
- [ ] Interrupted assistant output is marked accurately; a fully generated transcript is never presented as proof all words were heard.
- [ ] Rapid consecutive typed messages and repeated cancel events settle into one current response rather than overlapping agents.

## High-level implementation

Give each accepted user turn a revision and each response a generation identity. Superseding input cancels the previous response and clears pending audio while retaining the call transport.

## Low-level implementation

- Use provider interruption controls for voice activity and explicit response cancellation plus output buffer clearing for typed input.
- Correlate provider item IDs, local turn IDs, response IDs and the conversation revision; maintain separate generated and delivered/interrupted status.
- Serialize turn acceptance on the backend and reject stale tool mutations against their expected generation or revision.
- Deduplicate typed submissions through the existing idempotency contract rather than treating provider echo events as new user turns.
- Make cancellation repeatable and handle completion racing with cancellation without restoring stale UI content.
- Preserve relevant heard context when seeding later responses; do not include unheard generated material as an unquestioned completed exchange.

## Development plan

1. Define response supersession and delivery semantics.
2. Wire provider cancellation and browser playback clearing.
3. Enforce stale response rejection in state-changing operations.
4. Test rapid interruptions with deterministic events and a real browser call.

## Verification and demo

While a long answer plays, type a correction. Verify playback stops, one corrected turn is saved, the call remains open and the next answer uses the correction. Repeat using spoken interruption.

## Blocked by

- [AW-74: Start a browser voice call with backend control and saved turns](https://linear.app/ashwinworkspace/issue/AW-74/start-a-browser-voice-call-with-backend-control-and-saved-turns)

## Design references

- https://developers.openai.com/api/reference/resources/realtime/client-events#output_audio_buffer.clear
- Accepted rule: backend validation protects saved state; conversational compliance also needs prompt and stress testing.
