# 13: Start over without old calls, callbacks or replies contaminating the new conversation

Published: [AW-84](https://linear.app/ashwinworkspace/issue/AW-84/start-over-without-old-calls-callbacks-or-replies-contaminating-the). Label: ready-for-agent.

## What to build

A user selects Start over and receives a fresh conversation with no old names, task, transcript or stored Gmail connection. Outstanding work from the previous conversation cannot reappear.

## Scope

Implement the user reset across persisted state, credentials, active transport and multiple tabs. Reset describes app-held data deletion, not deletion from independent provider retention systems.

## Acceptance criteria

- [ ] Start over clears app transcript, accepted facts, help request, goal outcomes and stored Gmail credentials, then shows a fresh conversation.
- [ ] The previous call and generation stop, and other tabs lose authority to write into the new conversation.
- [ ] A late model reply, tool call, transcript event, call timer or OAuth callback from before reset cannot repopulate data or affect the new call.
- [ ] Repeating the reset request does not create inconsistent state or leave credentials attached to an orphaned conversation.
- [ ] The fresh conversation has a new valid browser/session association; the user can start chatting immediately after the reset commits.
- [ ] Deleting browser storage alone is not treated as a server-side deletion request, and the UI does not promise provider-side erasure.
- [ ] Tests verify actual app data and credential removal, not just disappearance from the current screen.

## High-level implementation

Make reset an atomic invalidation boundary before performing external cleanup. Advance or replace the conversation generation, revoke old ownership, delete scoped app data and then open a fresh conversation.

## Low-level implementation

- Use a transaction to invalidate the previous conversation's authority and remove its data and token material; keep minimal non-content tombstone/operation data only where needed to reject stale work.
- Bind callback, tool, response, timer and retry acceptance to a conversation generation and authorized attempt, not only a browser cookie.
- Rotate the anonymous session association safely through the same-origin response and prevent reset replay from exposing another user's state.
- Cancel local and backend transports after invalidation; provider cleanup failure cannot make stale writes valid again.
- Synchronize reset state to other tabs and discard obsolete pending UI entries and playback buffers.
- Test reset against in-flight Gmail exchange, model completion, typed cancellation and call timeout races.

## Development plan

1. Specify reset transaction and generation fencing.
2. Implement scoped deletion, credential removal and session reassociation.
3. Wire Start over and multi-tab cleanup states.
4. Exercise delayed work and repeated reset failures end to end.

## Verification and demo

Start a call and Gmail consent, reset before either completes, then deliver their old events. Confirm the fresh conversation remains empty and accepts a new message without old data returning.

## Blocked by

- [AW-76: Interrupt spoken replies with speech or typed messages](https://linear.app/ashwinworkspace/issue/AW-76/interrupt-spoken-replies-with-speech-or-typed-messages)
- [AW-78: Respect refusals and deferrals across visits while offering voice](https://linear.app/ashwinworkspace/issue/AW-78/respect-refusals-and-deferrals-across-visits-while-offering-voice)
- [AW-79: Keep one controlling tab and support explicit takeover](https://linear.app/ashwinworkspace/issue/AW-79/keep-one-controlling-tab-and-support-explicit-takeover)
- [AW-81: Recover Gmail connection attempts, expiry and late callbacks](https://linear.app/ashwinworkspace/issue/AW-81/recover-gmail-connection-attempts-expiry-and-late-callbacks)
- [AW-83: End calls safely at the time limit or when backend control is lost](https://linear.app/ashwinworkspace/issue/AW-83/end-calls-safely-at-the-time-limit-or-when-backend-control-is-lost)

## Design references

- Agreed reset boundary: app transcript, names, help request and stored Gmail connection.
- Clearing browser storage loses access; it does not silently erase server data.
