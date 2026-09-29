# Invite-only sign-in

Ship a minimal Persona-branded email and password page before the existing conversation. Only operator-created accounts can enter. There is no registration, Google sign-in, or required password-change screen. Gmail remains an optional integration inside onboarding.

Each account owns one conversation. Returning users resume it from any signed-in browser. Sign-out revokes the session and ends an active call. Anonymous cookies from the previous release must not grant access. Existing anonymous history is retained, but must never be automatically attached to a different person signing into a shared browser.

The operator can create multiple demo accounts and reset passwords through a private command using database credentials. Store salted password hashes, never plaintext passwords in the database or repository. Password resets revoke existing sessions. Use expiring, opaque HttpOnly cookies, existing origin checks, generic sign-in errors, and persistent login throttling.

Verification uses the existing agreed public HTTP and browser UI seams. Verify sign-in, invalid credentials, anonymous rejection across chat/voice/Gmail, account isolation, returning sessions, sign-out, expiry, password reset, and existing onboarding behavior. Review against main at e9e1a1624e32242ff8d760db254cdd983770da36, then merge and verify both production deployments.

## Managing trial accounts

Run these commands from `backend/` after building. The ignored `backend/.env` supplies the database connection. Keep the password in an ignored file such as `backend/.env.password`, with permissions restricted to your user. Passwords must contain 12–256 characters. The command reads the file without printing the password or putting it in shell history.

```sh
npm run build
npm run account -- create tanay@yourpersona.com --password-file .env.password
npm run account -- reset-password tanay@yourpersona.com --password-file .env.password
npm run account -- list
```

Use a different password for each account. Creating an existing email fails; use `reset-password` deliberately. Remove the temporary password file when finished. Sessions expire after 30 days. Login permits ten attempts per email per fifteen minutes and sixty total attempts per minute, stored in Postgres so restarting Render does not bypass the limits.

Authentication controls access, not spending. Invited accounts can use the existing text and voice features; this release does not add per-account AI budgets. Legacy anonymous history remains in storage for operator-managed recovery but is not automatically claimed on sign-in.
