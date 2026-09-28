# 06: Capture names and help requests conversationally and start helping early

Published: [AW-77](https://linear.app/ashwinworkspace/issue/AW-77/capture-names-and-help-requests-conversationally-and-start-helping). Label: ready-for-agent.

## What to build

A user can provide names and a help request in any order, correct themselves, or ask for help immediately. The agent remembers accepted facts and begins useful work without forcing a form.

## Scope

Implement the text-first onboarding decision loop and reusable backend fact tools. Keep graduation independent of onboarding completion. Voice uses these tools in its later integration slice.

## Acceptance criteria

- [ ] The opening invites an agent name while accepting any additional volunteered information without discarding it.
- [ ] One message containing agent name, user name and a help request saves all three; the next reply does not ask for known facts again.
- [ ] An explicit correction replaces the relevant accepted fact, retains its provenance and affects subsequent replies.
- [ ] Ambiguous information triggers a focused clarification instead of overwriting a known fact with a guess.
- [ ] An actionable request produces useful conversational help in the same exchange even when names, Gmail or voice remain incomplete.
- [ ] Graduation and onboarding completion are separate derived outcomes; typed claims cannot mark Gmail connected or a call successful.
- [ ] The agent asks at most one onboarding question at a time and responds to the user's current concern before steering back.

## High-level implementation

Represent independent onboarding goals instead of a single form step. The model proposes interpretations and responses; NestJS validates changes and chooses allowed actions from authoritative state.

## Low-level implementation

- Persist accepted facts with source turn, revision and status, plus a help request and helping/onboarding experience mode.
- Expose bounded fact and goal tools with explicit schema validation, expected revision and authorized conversation context.
- Reject stale or prohibited changes, including user-text claims of integration success. Return committed tool results before the model can acknowledge saved facts.
- Compute completion from both names, an actionable request and verified Gmail status; let graduation depend only on enough context to help.
- Add a first-task response path for conversational work such as interview preparation. Do not add inbox-reading or message-sending tools.
- Keep tool contracts reusable by the future Realtime adapter and policy logic testable independently from wording variation.

## Development plan

1. Define goal, fact and graduation transitions using the agreed glossary.
2. Implement validated mutations and context assembly for the text model.
3. Wire opening, clarification, correction and early-help responses.
4. Test observable state changes and representative conversations.

## Verification and demo

Send both names and an interview-preparation request together, then correct the user's name. In a new conversation, request interview help immediately and confirm help starts with missing onboarding goals still recorded.

## Blocked by

- [AW-72: Resume a saved text conversation on the deployed stack](https://linear.app/ashwinworkspace/issue/AW-72/resume-a-saved-text-conversation-on-the-deployed-stack)

## Design references

- Agreed decision: graduation is distinct from onboarding completion.
- Onboarding attempts four goals: agent name, user name, verified Gmail connection and a help request.
