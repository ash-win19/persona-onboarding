# 09: Connect Gmail through browser consent and verify access

Published: [AW-80](https://linear.app/ashwinworkspace/issue/AW-80/connect-gmail-through-browser-consent-and-verify-access). Label: ready-for-agent.

## What to build

A user connects Gmail from a conversational button. Persona shows connected only after the backend verifies real Gmail API access, and the existing conversation remains intact.

## Scope

Implement the real consent and successful callback path plus safe denial handling. This grants metadata access but fetches only the verified profile email address. Inbox actions are excluded.

## Acceptance criteria

- [ ] The chat offers a Gmail connection button and accurately explains that consent permits Gmail metadata and headers, although this trial only fetches the account address.
- [ ] Google consent returns through the frontend's same-origin callback path and restores the same anonymous conversation.
- [ ] The backend validates the OAuth attempt and granted scope, exchanges the code server-side and verifies access with users.getProfile requesting emailAddress.
- [ ] Only a successful verified result marks Gmail connected and contributes to onboarding completion; a typed address or 'I connected it' does not.
- [ ] Denial leaves the conversation usable and records a non-success outcome without claiming connected.
- [ ] Tokens remain server-side, are protected at rest, and never enter browser-visible state, model context or application logs.
- [ ] A real allowlisted evaluator account completes the flow in the external testing project.

## High-level implementation

Attach a Gmail connection to the existing conversation, independently of session identity. Use a one-time server-bound OAuth attempt and publish a verified integration event into the conversation coordinator.

## Low-level implementation

- Persist OAuth attempts with conversation identity, expiry, nonce/state binding, generation and completion status. Use approved redirect destinations and defend against CSRF and replay.
- Request gmail.metadata, exchange credentials on NestJS and inspect granted permissions before calling the Gmail profile endpoint.
- Store the verified email and connection status separately from encrypted token material; keep the encryption secret outside the database and browser.
- Apply the integration result and completion recomputation transactionally, with a unique attempt/event ID for idempotency.
- Render pending, connected and denied status as conversational UI rather than adding a separate setup form.
- Document Google testing setup, required redirect registration and evaluator allowlisting without placing secrets in documentation.

## Development plan

1. Set up the testing OAuth configuration and callback contract.
2. Implement attempt persistence, code exchange and profile verification.
3. Connect the chat button, callback return and verified status.
4. Run a real allowlisted consent and a denial case.

## Verification and demo

From an anonymous conversation, connect a test Gmail account, return to the same transcript and verify the confirmed address. Repeat with denial and with a typed false claim of connection.

## Blocked by

- [AW-77: Capture names and help requests conversationally and start helping early](https://linear.app/ashwinworkspace/issue/AW-77/capture-names-and-help-requests-conversationally-and-start-helping)

## Design references

- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
- https://developers.google.com/workspace/gmail/api/auth/scopes
