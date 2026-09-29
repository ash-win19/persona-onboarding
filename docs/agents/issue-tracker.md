# Issue tracker

Persona uses Linear in Ashwin Workspace, team AW. Use the authenticated Linear CLI with `--workspace ashwinworkspace`.

The active release covers checkpoints 3–6: AW-74, AW-75, AW-79, AW-83; AW-76, AW-78; AW-80, AW-81, AW-82; AW-84, AW-85, AW-86. Approved specifications are under `docs/planning/persona-linear/issues/`. Read current Linear descriptions when reviewing.

The agreed test seams are the public session, ownership, turn, call and OAuth HTTP APIs, provider adapters, controlled clock and browser UI. Use isolated databases and deterministic external-provider adapters for races. Report real-provider and production smoke checks separately. Reset and cleanup tests verify removed app data and credentials at the database boundary, as explicitly required by AW-84 and AW-85.

The release starts from deployed main `6c8d1455a6df2c261bbd4a3fc474cddde6ca7693`. Review each checkpoint against its preceding deployed revision. Do not modify unrelated issue states or projects.
