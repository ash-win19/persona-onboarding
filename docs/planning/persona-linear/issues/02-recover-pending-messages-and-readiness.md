# 02: Recover pending messages while the backend wakes or reconnects

Published: [AW-73](https://linear.app/ashwinworkspace/issue/AW-73/recover-pending-messages-while-the-backend-wakes-or-reconnects). Label: ready-for-agent.

## What to build

A user opening a sleeping service or losing a connection sees an honest connecting state. Retrying a message never duplicates it, and the app does not claim unsaved progress is saved.

## Scope

Add service readiness, durable acknowledgement and idempotent text retries across the deployed path. Browser crash recovery of never-submitted drafts is outside this slice.

## Acceptance criteria

- [ ] Opening the page checks backend and database readiness and shows connecting, ready or recoverable failure without an endless unlabelled spinner.
- [ ] A message stays pending until its durable commit is acknowledged; a lost acknowledgement followed by retry creates exactly one accepted turn.
- [ ] The same submission identifier is reused across retries, including a deliberate retry after a network error.
- [ ] Backend or database unavailability preserves the visible pending text and offers retry without discarding the committed transcript.
- [ ] The app exposes a readiness result that the later call-start flow can use; neither a live frontend nor a process-only health check implies database readiness.
- [ ] Tests reproduce a lost response after commit, a database outage and a backend wake-up on the selected hosts.

## High-level implementation

Separate service readiness from message delivery status. Use a stable client submission ID and a transactional server-side deduplication record so the UI can safely reconcile a retry with an already accepted message.

## Low-level implementation

- Persist a unique submission key scoped to the authorized conversation, its payload identity and accepted result. Reject reuse with conflicting content.
- Commit the deduplication record and state change atomically. Use the accepted operation ID to prevent duplicate assistant generation when a request is replayed.
- Return acknowledgement data sufficient to reconcile the optimistic UI entry with the canonical saved turn.
- Use bounded readiness and retry attempts with backoff and an explicit retry control; cancel obsolete page requests on teardown.
- Ensure readiness proves a small database operation without exposing credentials or infrastructure details in the UI.
- Keep operational failure data separate from conversational content; emit identifiers, timings and error codes rather than raw requests.

## Development plan

1. Add an idempotent submit contract and database uniqueness enforcement.
2. Add readiness and transient-failure responses.
3. Build pending-message reconciliation and bounded reconnect UI.
4. Exercise failures locally and confirm the sleeping-backend flow in the deployed browser.

## Verification and demo

Drop the response after the server commits, press retry and verify one message and one reply. Disconnect the database and confirm no false saved state. Reconnect and finish the same exchange.

## Blocked by

- [AW-72: Resume a saved text conversation on the deployed stack](https://linear.app/ashwinworkspace/issue/AW-72/resume-a-saved-text-conversation-on-the-deployed-stack)

## Design references

- Accepted rule: no saved acknowledgement before a durable commit.
- Render wake-up is an accepted free-hosting trade-off; do not rely on outbound model traffic to prevent sleeping.
