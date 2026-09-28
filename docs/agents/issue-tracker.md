# Issue tracker

Persona uses Linear in Ashwin Workspace, team AW. Use the authenticated Linear CLI with `--workspace ashwinworkspace`.

Checkpoint 1 implements AW-72 and AW-73. Their approved specifications are saved in `docs/planning/persona-linear/issues/01-resume-a-saved-text-conversation.md` and `02-recover-pending-messages-and-readiness.md`. Read the current Linear descriptions when reviewing.

Test the public session/turn/readiness HTTP API and the user-facing browser flow. Use the database and model-provider seams approved in those tickets to reproduce external failures. Keep production-provider smoke tests separate from deterministic tests.

Review this implementation against the starting main revision `af101d7a012e205aa294ba63a4c35d0c87b6b86e`. Do not modify unrelated issue states or projects.
