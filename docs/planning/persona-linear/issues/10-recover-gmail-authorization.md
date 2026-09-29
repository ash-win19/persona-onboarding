# 10: Recover Gmail connection attempts, expiry and late callbacks

Published: [AW-81](https://linear.app/ashwinworkspace/issue/AW-81/recover-gmail-connection-attempts-expiry-and-late-callbacks). Label: ready-for-agent.

## What to build

Closing consent, denying access or returning with expired credentials does not restart onboarding. A user can reconnect deliberately, and duplicate or late callbacks cannot corrupt the conversation.

## Scope

Complete the Gmail integration lifecycle, including testing-token expiry, revoked access and callback races. Cross-device account recovery and inbox features remain excluded.

## Acceptance criteria

- [ ] Closed, timed-out, denied and failed attempts remain distinct from connected and permit an explicit retry or deferral.
- [ ] Duplicate callbacks apply at most one integration state change and do not exchange the same code repeatedly or duplicate transcript acknowledgements.
- [ ] An older attempt cannot overwrite a newer successful Gmail connection.
- [ ] A valid callback after a call has ended updates the same conversation and acknowledges the result in the current channel.
- [ ] Expired or revoked credentials move to a reconnect-needed state while preserving names, the help request and transcript.
- [ ] Testing-mode refresh-token expiry after seven days is documented, and expiry recovery is exercised using controlled credentials/errors.
- [ ] Malformed, expired or session-mismatched callbacks are rejected without exposing tokens or provider details.

## High-level implementation

Treat authorization as an attempt-based integration lifecycle. The backend accepts only current, valid transitions and keeps connection validity independent from conversation continuity.

## Low-level implementation

- Add explicit attempt deadlines and status transitions with compare-and-set acceptance, replay protection and a one-time completion result.
- Choose the latest accepted connection using a connection generation rather than callback arrival order.
- Implement credential refresh on demand and classify authorization invalidation separately from transient provider failures.
- Validate access at resume or another relevant integration action so an expired grant does not remain indefinitely represented as healthy.
- Publish committed connection changes to the active conversation channel; never revive an ended call to announce success.
- Ensure retries create a fresh attempt and preserved refusal/deferral policy remains in force unless the user explicitly reopens connection.

## Development plan

1. Model attempt and credential lifecycle transitions.
2. Implement idempotent callback handling and credential invalidation.
3. Add reconnect UI and current-channel acknowledgements.
4. Test duplicate, reordered, late, revoked and expired authorization outcomes.

## Verification and demo

Close consent and retry successfully. Replay a callback, deliver an old callback after a newer one, then simulate expired credentials. Verify the same conversation survives and only the valid connection wins.

## Blocked by

- [AW-80: Connect Gmail through browser consent and verify access](https://linear.app/ashwinworkspace/issue/AW-80/connect-gmail-through-browser-consent-and-verify-access)

## Design references

- https://developers.google.com/identity/protocols/oauth2#expiration
- Accepted rule: Gmail reconnect never resets conversation continuity.
