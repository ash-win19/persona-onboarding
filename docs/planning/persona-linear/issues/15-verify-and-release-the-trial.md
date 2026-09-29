# 15: Verify the complete onboarding trial on the selected free hosts

Published: [AW-86](https://linear.app/ashwinworkspace/issue/AW-86/verify-the-complete-onboarding-trial-on-the-selected-free-hosts). Label: ready-for-agent.

## What to build

An evaluator receives a deployed trial that demonstrates useful help, real browser voice, real Gmail authorization and recovery under deliberate misuse, with reproducible setup and known limitations.

## Scope

Integrate and release the completed slices. This is the final end-to-end acceptance gate, not a replacement for tests owned by each earlier ticket.

## Acceptance criteria

- [ ] The deployed app attempts all four onboarding goals and offers voice with consent while allowing early useful help.
- [ ] A real browser call proves spoken and typed interruptions, hangup, refresh, the time limit and return to the same saved conversation.
- [ ] A real allowlisted Gmail account connects, and denial, expiry, duplicate callback and late-result cases preserve conversation continuity.
- [ ] The stress suite rejects stale writes after takeover/reset, deduplicates retried turns and honors persistent refusals and visit deferrals.
- [ ] Backend wake-up, provider/control loss and database unavailability expose honest pending/reconnecting states and recover committed progress.
- [ ] Deployment and operator documentation identify the free hosts, required configuration names, migrations, evaluator allowlisting, cleanup procedure and known limitations without including secrets.
- [ ] All relevant builds, type/lint checks and automated acceptance tests pass; real-provider verification is reported separately from mocked tests.

## High-level implementation

Validate complete user journeys across the already implemented layers and close integration defects before declaring the trial ready. Produce one evaluator runbook and evidence tied to the deployed revision.

## Low-level implementation

- Build a scenario matrix spanning goal order, corrections, refusal, deferral, graduation, call lifecycle, ownership, reset and Gmail outcomes.
- Use deterministic provider adapters and a controlled clock for race and failure coverage, then perform bounded real-provider smoke tests.
- Capture state transitions, correlation IDs and timings needed to reproduce failures without recording raw audio or sensitive payloads.
- Verify migrations and environment validation from a clean deployment and confirm the frontend callback origin matches Google configuration.
- Run the cold-backend and backend-restart exercises on the actual Vercel/Render/Neon path, not only localhost.
- Document observed voice timing, free-plan interruptions, same-browser recovery limits and testing-mode Gmail expiry as practical trial constraints.

## Development plan

1. Assemble the scenario matrix and evaluator runbook.
2. Run deterministic end-to-end acceptance and fix integration failures.
3. Deploy the tested revision and perform real voice and Gmail smoke tests.
4. Record the release evidence, operational steps and remaining limitations.

## Verification and demo

An evaluator opens the deployed app, asks for help early, enters a call, interrupts it, connects Gmail, hangs up and refreshes. A second run intentionally refuses goals, loses connectivity, takes over from another tab and resets during pending work.

## Blocked by

- [AW-82: Collect onboarding details and guide Gmail consent during a call](https://linear.app/ashwinworkspace/issue/AW-82/collect-onboarding-details-and-guide-gmail-consent-during-a-call)
- [AW-85: Clean up abandoned trial conversations and retain safe diagnostics](https://linear.app/ashwinworkspace/issue/AW-85/clean-up-abandoned-trial-conversations-and-retain-safe-diagnostics)

## Design references

- Project acceptance gate: committed progress survives interruptions; stale work cannot mutate current state.
- Free hosting is fixed; real model usage uses existing credits.
