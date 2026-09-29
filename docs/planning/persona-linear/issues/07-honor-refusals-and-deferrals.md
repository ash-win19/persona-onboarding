# 07: Respect refusals and deferrals across visits while offering voice

Published: [AW-78](https://linear.app/ashwinworkspace/issue/AW-78/respect-refusals-and-deferrals-across-visits-while-offering-voice). Label: ready-for-agent.

## What to build

The agent offers a call and missing onboarding goals without nagging. A clear refusal persists, while 'not now' postpones the request until a later relevant visit.

## Scope

Apply the same invitation and reminder policy across text and active calls. Distinguish refusal, deferral, unanswered questions, hangups and technical failures.

## Acceptance criteria

- [ ] The agent attempts a voice invitation without making acceptance a condition for useful help or graduation.
- [ ] An explicit refusal of a goal or call suppresses unsolicited reminders across refreshes and later visits until the user reopens the topic.
- [ ] 'Not now' defers the request beyond the current visit; refresh and OAuth navigation do not create an eligible new visit.
- [ ] A new visit begins only after 30 minutes without user activity and with no active call.
- [ ] A deferred request may be revisited once when relevant in a later visit; returning to the app never starts voice automatically.
- [ ] Hangup continues in text, and a technical failure offers retry without recording a refusal.
- [ ] Invitations and policy decisions are persisted so changing channels does not reset them.

## High-level implementation

Make invitation eligibility a backend policy based on each goal's outcome and visit identity. The model gets allowed next actions and current refusal/deferral state rather than improvising repeated setup prompts.

## Low-level implementation

- Persist user activity, visit identity, offered-at markers and distinct goal outcomes. Record active-call state when evaluating visit boundaries.
- Update activity from meaningful user actions; do not reset deferrals from polling, provider output, refresh or OAuth callbacks.
- Add eligibility checks for initial invitations, later reminders and explicit user reopening. Prevent concurrent generation from issuing duplicate invitations.
- Pass policy constraints to text and Realtime instructions and validate any tool-driven goal transition.
- Record offered, declined, attempted, connected and ended voice outcomes separately; consent must still precede microphone capture.
- Use a controlled clock in deterministic tests to cover the inactivity threshold without slow wall-clock tests.

## Development plan

1. Define refusal, deferral and visit transitions.
2. Implement persisted eligibility checks and bounded reminder markers.
3. Integrate policy with invitations and model context in both channels.
4. Test return visits, redirects, technical failures and topic reopening.

## Verification and demo

Decline Gmail, refresh and return later without another unsolicited offer. Defer voice, stay active past the clock threshold and confirm no new visit. Return after inactivity and receive at most one relevant invitation.

## Blocked by

- [AW-74: Start a browser voice call with backend control and saved turns](https://linear.app/ashwinworkspace/issue/AW-74/start-a-browser-voice-call-with-backend-control-and-saved-turns)
- [AW-77: Capture names and help requests conversationally and start helping early](https://linear.app/ashwinworkspace/issue/AW-77/capture-names-and-help-requests-conversationally-and-start-helping)

## Design references

- Glossary: refusal lasts until user reopening; deferral lasts beyond the current visit.
- Accepted visit boundary: 30 minutes without user activity and no active call.
