# 08: Keep one controlling tab and support explicit takeover

Published: [AW-79](https://linear.app/ashwinworkspace/issue/AW-79/keep-one-controlling-tab-and-support-explicit-takeover). Label: ready-for-agent.

## What to build

Opening Persona in a second tab shows the saved conversation safely. The user can take control explicitly, ending the previous tab's call without allowing two agents to write concurrently.

## Scope

Enforce control ownership across browser tabs, backend operations, generation and provider callbacks. No cross-device login or recovery is added.

## Acceptance criteria

- [ ] A second tab opens the same conversation read-only, with an explicit take-control action.
- [ ] Only the current owner can submit turns, start a call or initiate state-changing tools.
- [ ] Taking control atomically advances ownership, ends the previous call and enables the new tab.
- [ ] The previous tab becomes read-only and cannot mutate state even if its UI is stale or it bypasses disabled controls.
- [ ] Late model tools, provider events that mutate facts and OAuth initiation requests from the previous owner cannot create unauthorized changes.
- [ ] Racing takeovers settle on one owner, and abandoned ownership can recover after a tab closes without permanently locking the conversation.

## High-level implementation

Use a durable ownership record with a fencing epoch. Treat browser visibility as a convenience only; every authoritative backend mutation validates the current owner or the explicitly permitted integration callback context.

## Low-level implementation

- Persist tab identity, owner epoch, liveness/expiry and active call association. Never treat possession of a conversation ID alone as authority.
- Use a transaction or compare-and-set operation for takeover and increment the epoch before old work can commit.
- Carry ownership and response identities into call setup and generated tool work; reject stale writes at commit time.
- Provide a bounded owner-status channel or polling path through the existing HTTP surface so other tabs update promptly.
- Stop the old media session and sideband best-effort after invalidating its authority. Network failure must not let its writes regain validity.
- Keep server-verified OAuth callbacks valid only under their explicit attempt/generation rules; ordinary ownership transfer does not blindly authenticate arbitrary callbacks.

## Development plan

1. Define owner epoch and recovery semantics.
2. Enforce ownership in backend mutation boundaries.
3. Add read-only and takeover UI states plus old-call teardown.
4. Test two real tabs, races and stale direct API requests.

## Verification and demo

Start a call in tab A, open tab B and take control. Verify tab A stops, tab B can continue from saved context, and a stale write from tab A is rejected by the backend.

## Blocked by

- [AW-74: Start a browser voice call with backend control and saved turns](https://linear.app/ashwinworkspace/issue/AW-74/start-a-browser-voice-call-with-backend-control-and-saved-turns)

## Design references

- Agreed decision: one control owner, one live call and one response generator per conversation.
- PostgreSQL is authoritative; in-memory flags alone cannot enforce ownership.
