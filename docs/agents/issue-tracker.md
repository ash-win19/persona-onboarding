# Issue tracker

Persona uses Linear in Ashwin Workspace, team AW. Use the authenticated Linear CLI with `--workspace ashwinworkspace`.

Checkpoint 2 implements AW-77. Its approved specification is saved in `docs/planning/persona-linear/issues/06-capture-facts-and-start-helping.md`. Checkpoint 1, AW-72 and AW-73, is already deployed. Read the current Linear descriptions when reviewing.

Test the public session/turn/readiness HTTP API and the user-facing browser flow. Test the bounded fact-tool contract through the authorized coordinator. Use the database and model-provider seams approved in the tickets to reproduce external failures. Keep production-provider smoke tests separate from deterministic tests.

Review this implementation against the starting main revision `82091f5616431b96ae04235e28eb400984c9fd89`. Do not modify unrelated issue states or projects.
