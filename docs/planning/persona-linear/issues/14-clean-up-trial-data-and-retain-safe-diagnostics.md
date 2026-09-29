# 14: Clean up abandoned trial conversations and retain safe diagnostics

Published: [AW-85](https://linear.app/ashwinworkspace/issue/AW-85/clean-up-abandoned-trial-conversations-and-retain-safe-diagnostics). Label: ready-for-agent.

## What to build

The operator can remove abandoned trial conversations and credentials through a controlled cleanup command and can diagnose recent failures using identifiers and error codes without exposing message content or tokens.

## Scope

Implement the agreed seven-day operational-log retention and operator cleanup. Do not automatically age-delete ordinary conversation history while the user still owns it.

## Acceptance criteria

- [ ] Operational diagnostics contain event IDs, timestamps, status changes, timings and error codes, with no raw audio, OAuth credentials or model secrets.
- [ ] Operational records older than seven days can be purged repeatably without deleting canonical conversation history or needed retry/ownership records.
- [ ] An operator can preview a cleanup selection and explicitly execute removal of chosen abandoned trial conversations and credentials.
- [ ] Cleanup uses the same invalidation rules as Start over so late work cannot recreate deleted state.
- [ ] Active conversations are not accidentally selected as abandoned; the command reports selected, skipped, removed and failed counts.
- [ ] The app makes no claim that local cleanup deletes provider-managed retention data.
- [ ] Operator instructions cover cleanup and reconnect diagnosis without depending on persistent local files on Render.

## High-level implementation

Separate content-bearing canonical records from short-lived operational diagnostics. Reuse the reset deletion boundary in an authenticated operator workflow with preview and explicit execution.

## Low-level implementation

- Classify stored tables/records by canonical conversation, deduplication/authority or operational purpose; apply seven-day retention only to the last group.
- Use structured logging and redaction at emission boundaries rather than trying to clean up sensitive log output afterward.
- Provide a CLI or equivalent operator entry point that requires operator credentials, shows a dry-run selection and accepts explicit identifiers or a reviewed cutoff.
- Exclude active attempts/owners from an abandoned-session selection unless explicitly handled through a deliberate termination path.
- Execute cleanup in bounded batches with per-conversation transactions and idempotent results so retry resumes safely after a partial failure.
- Document how to run retention and cleanup with the selected free hosts; do not add a paid worker or an unapproved automatic deletion schedule.

## Development plan

1. Audit stored record classes and log emission fields.
2. Implement operational retention and the scoped cleanup operation.
3. Add preview/report output and operator documentation.
4. Test active-session exclusion, partial retry and late-event rejection.

## Verification and demo

Create active and abandoned test conversations, preview cleanup, execute only the abandoned selection and inspect resulting counts. Purge old diagnostics and verify an active conversation and its retry safety still work.

## Blocked by

- [AW-84: Start over without old calls, callbacks or replies contaminating the new conversation](https://linear.app/ashwinworkspace/issue/AW-84/start-over-without-old-calls-callbacks-or-replies-contaminating-the)

## Design references

- Accepted retention: app conversation until reset; operational metadata for seven days.
- The application does not record raw audio and does not expose credentials to logs or model context.
