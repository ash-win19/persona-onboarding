# 12: End calls safely at the time limit or when backend control is lost

Published: [AW-83](https://linear.app/ashwinworkspace/issue/AW-83/end-calls-safely-at-the-time-limit-or-when-backend-control-is-lost). Label: ready-for-agent.

## What to build

A call warns before its ten-minute limit and returns to chat. If the backend loses control while audio still works, the app pauses or ends voice instead of continuing an uncontrolled conversation.

## Scope

Add the trial call deadline and control-liveness recovery on the selected free hosts. Automatic redial and invisible controller handoffs are excluded.

## Acceptance criteria

- [ ] An active call has a persisted ten-minute deadline and receives a warning before voice ends; a new call requires explicit user action.
- [ ] Ending at the limit preserves committed context and the user can immediately continue in text when services are reachable.
- [ ] Loss of backend control is detected through a bounded liveness mechanism even if browser-to-provider audio remains connected.
- [ ] Detected control loss stops or pauses audio and offers explicit retry; it never leaves a healthy-call indicator while control is unavailable.
- [ ] If the backend or database is unavailable, text remains pending with reconnecting status rather than pretending it is a functioning fallback.
- [ ] Old timers or liveness events cannot end a newer call or revive an ended attempt.
- [ ] A real call on the selected runtime exercises the deadline and a forced sideband disconnect; observed recovery timings are recorded.

## High-level implementation

Persist the call deadline and use backend liveness plus browser enforcement to bound a temporary provider session. The durable attempt identity makes timer and disconnect handling idempotent.

## Low-level implementation

- Store server-issued call start/deadline and terminal reason with the attempt. Return authoritative timing to the browser rather than trusting only a local timer.
- Use a bounded browser-to-backend control-status check that reports sideband and storage readiness; document the actual detection interval selected during implementation.
- On control loss, cancel playback and media promptly, invalidate further tool authority and perform best-effort provider cleanup.
- Use attempt-scoped timers in backend and browser, and reconcile overdue calls during restore when a process restart lost in-memory timers.
- Return to text using the existing readiness and pending-message contract; never replay a failed call automatically.
- Inject liveness failure and use a controlled clock for most deadline tests, then perform one real-duration smoke run.

## Development plan

1. Define deadline, warning and liveness contracts.
2. Implement persisted enforcement and attempt-scoped cleanup.
3. Add warning, reconnecting and explicit retry UI.
4. Run accelerated failure tests plus deployed real-duration verification.

## Verification and demo

Force sideband loss while media remains connected and verify the app stops voice. Start a new call, observe its warning and ten-minute end, then continue the saved conversation in text.

## Blocked by

- [AW-75: Continue in text after a hangup, refresh or failed call](https://linear.app/ashwinworkspace/issue/AW-75/continue-in-text-after-a-hangup-refresh-or-failed-call)

## Design references

- Accepted cap: ten minutes per call, warning beforehand, explicit action for another call.
- Backend control or storage loss must not be hidden behind an apparently healthy audio connection.
