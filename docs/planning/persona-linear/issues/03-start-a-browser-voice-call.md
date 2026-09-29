# 03: Start a browser voice call with backend control and saved turns

Published: [AW-74](https://linear.app/ashwinworkspace/issue/AW-74/start-a-browser-voice-call-with-backend-control-and-saved-turns). Label: ready-for-agent.

## What to build

A user explicitly accepts a call, grants microphone access and speaks with the agent. The call shares their existing conversation, and NestJS receives provider events and controls the live session.

## Scope

Prove the selected voice architecture with ordinary dialogue, saved finalized turns and a server-controlled tool acknowledgement. Full onboarding policy, rich interruptions and recovery are separate slices.

## Acceptance criteria

- [ ] No microphone capture or call starts before an explicit user action; permission denial and unavailable devices leave text usable.
- [ ] Browser audio uses direct WebRTC to OpenAI Realtime, while the Render backend attaches its sideband to the same provider call.
- [ ] Call setup succeeds only after backend and database readiness and backend control is established; failed setup cleans up partially opened resources.
- [ ] Finalized provider turns appear in the existing transcript and survive refresh as committed data; asynchronous arrival does not scramble their identities.
- [ ] A bounded test tool is handled and acknowledged by NestJS, demonstrating server control without exposing long-lived provider credentials.
- [ ] The prototype records call setup, response and interruption timing observations on the deployed stack; measured limitations are documented rather than hidden.

## High-level implementation

Create an app-owned call attempt linked to a conversation, with a temporary provider session seeded from saved context. The browser owns media; NestJS owns control and persists provider events as they become available.

## Low-level implementation

- Persist attempt ID, lifecycle state, provider call reference, controlling browser identity and timestamps. Reserve a single active attempt atomically.
- Authorize call setup from the conversation cookie, create provider access server-side and attach the sideband before showing the call as active.
- Track provider item/event IDs separately from local turn IDs; deduplicate event delivery and correlate asynchronous transcription.
- Provide explicit microphone, connecting, active and end-call controls in the same transcript UI.
- Close peer connection, microphone tracks and server socket on failed setup or an explicit end action.
- Do not add a separate transcription/model/database chain before every spoken response. Ordinary dialogue stays in Realtime; tools require backend acknowledgement.

## Development plan

1. Implement the call-attempt contract and provider adapter.
2. Connect browser WebRTC and backend sideband to one call.
3. Persist finalized events and render the live transcript.
4. Verify a real call and server-handled tool on the selected free runtime.

## Verification and demo

Start from a saved text exchange, accept voice, speak one turn and see it persisted. Deny microphone access in a second run. Prove a sideband tool round trip and record observed timings.

## Blocked by

- [AW-73: Recover pending messages while the backend wakes or reconnects](https://linear.app/ashwinworkspace/issue/AW-73/recover-pending-messages-while-the-backend-wakes-or-reconnects)

## Design references

- https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime
- https://developers.openai.com/api/docs/guides/voice-server-controls?api=realtime#with-webrtc
