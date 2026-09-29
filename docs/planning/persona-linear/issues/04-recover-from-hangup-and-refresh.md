# 04: Continue in text after a hangup, refresh or failed call

Published: [AW-75](https://linear.app/ashwinworkspace/issue/AW-75/continue-in-text-after-a-hangup-refresh-or-failed-call). Label: ready-for-agent.

## What to build

A user can hang up halfway through an answer, refresh during a call or encounter a voice failure, then continue typing with their committed progress intact.

## Scope

Complete call teardown and recovery across browser, backend, provider and database. Never guess words that were not finalized or silently restart the microphone.

## Acceptance criteria

- [ ] Hangup stops playback and capture, closes call resources and returns to text without an automatic redial.
- [ ] Previously committed turns remain available after hangup, refresh and backend restart.
- [ ] Reloading an interrupted call shows its recovered terminal state rather than falsely showing an active microphone session.
- [ ] Late final transcript events belonging to a valid ended attempt can be reconciled without reopening the call; obsolete responses cannot restart playback.
- [ ] Speech lost before a usable final transcript is not fabricated. The agent can ask a focused clarification when the next step needs it.
- [ ] Technical failures offer an explicit retry and preserve chat whenever backend and database remain reachable.

## High-level implementation

Treat call termination as an idempotent state transition independent from conversation lifetime. Recover from durable app state and reconcile finalized provider events by attempt and item identifiers.

## Low-level implementation

- Define ended and failed reasons for user hangup, permission failure, connection loss, page exit and backend restart; do not conflate refusal with technical failure.
- Make end-call requests idempotent and safe when provider cleanup has already happened or the browser unload notification never arrives.
- On session restore, reconcile abandoned active attempts using ownership and liveness data instead of trusting an old active flag.
- Persist received finalized turns promptly. Mark incomplete speech distinctly from committed content.
- Scope all late callbacks to their call attempt and current conversation generation; ignore events that would reactivate a terminated attempt.
- Separate stopping audio from deleting conversation state, and keep controls accessible after recovery.

## Development plan

1. Specify call lifecycle transitions and event acceptance rules.
2. Implement idempotent end and restore reconciliation.
3. Connect browser teardown and text fallback.
4. Run hangup, reload, provider disconnect and backend restart scenarios.

## Verification and demo

Speak a completed turn, begin another and hang up. Confirm the completed turn survives and no missing words are invented. Refresh during a second call and continue typing in the recovered conversation.

## Blocked by

- [AW-74: Start a browser voice call with backend control and saved turns](https://linear.app/ashwinworkspace/issue/AW-74/start-a-browser-voice-call-with-backend-control-and-saved-turns)

## Design references

- Accepted behavior: hangup resumes in chat without automatic redial.
- Temporary provider sessions never replace the durable conversation.
