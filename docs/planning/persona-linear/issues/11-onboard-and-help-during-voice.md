# 11: Collect onboarding details and guide Gmail consent during a call

Published: [AW-82](https://linear.app/ashwinworkspace/issue/AW-82/collect-onboarding-details-and-guide-gmail-consent-during-a-call). Label: ready-for-agent.

## What to build

During a call the agent learns the user's name and help request, guides browser Gmail consent, and starts helping without repeating details already captured in chat.

## Scope

Integrate the common onboarding policy and verified Gmail events with Realtime dialogue. Agent naming remains a chat invitation rather than a scripted voice requirement.

## Acceptance criteria

- [ ] A call starts with the accepted facts and goal outcomes from the existing conversation, including prior corrections, refusals and deferrals.
- [ ] The agent attempts the user name, help request and Gmail connection when eligible, without following a fixed form sequence or re-asking answered questions.
- [ ] Spoken fact proposals are validated and committed by NestJS through the same tools as text, and the resulting facts survive the call.
- [ ] Gmail consent happens in browser UI while voice explains the action; only a verified callback allows a connected acknowledgement.
- [ ] An actionable spoken help request starts useful conversational work even with missing onboarding goals.
- [ ] A Gmail result or correction received during the call updates subsequent dialogue without starting another call or losing the transcript.
- [ ] Prompt-injection attempts to fake Gmail success or override refusal policy do not mutate authoritative state.

## High-level implementation

Reuse the existing coordinator and tool contracts from text. Realtime receives a compact authoritative context and permitted actions; browser UI exposes consent while the backend delivers verified integration events.

## Low-level implementation

- Adapt bounded fact, goal and graduation tools to the provider's tool-call events, preserving conversation revision, ownership and call-attempt identity.
- Seed the call with known names, active help request, goal outcomes and relevant delivered conversation history.
- Update provider context after committed changes and verified integrations; do not acknowledge success from uncommitted proposals.
- Render a Gmail action in the same conversation while voice is active, with clear pending and result state.
- Do not gate every ordinary utterance through a separate transcription or interpretation request. Measure any tool-driven latency and keep it visible in prototype notes.
- Capture source provider item IDs for spoken facts and handle asynchronous transcript arrival without attaching a fact to the wrong turn.

## Development plan

1. Map existing coordinator tools to the Realtime adapter.
2. Add policy-aware voice instructions and saved-context seeding.
3. Connect browser consent and verified event delivery during calls.
4. Run mixed text/voice onboarding and injection scenarios.

## Verification and demo

Provide an agent name in chat, start a call, volunteer a user name and task, connect Gmail through the browser, then receive useful help. Confirm no duplicate questions and no claimed connection before verification.

## Blocked by

- [AW-74: Start a browser voice call with backend control and saved turns](https://linear.app/ashwinworkspace/issue/AW-74/start-a-browser-voice-call-with-backend-control-and-saved-turns)
- [AW-78: Respect refusals and deferrals across visits while offering voice](https://linear.app/ashwinworkspace/issue/AW-78/respect-refusals-and-deferrals-across-visits-while-offering-voice)
- [AW-80: Connect Gmail through browser consent and verify access](https://linear.app/ashwinworkspace/issue/AW-80/connect-gmail-through-browser-consent-and-verify-access)

## Design references

- Agreed decision: ordinary dialogue is live; consequential state changes require backend results.
- Voice attempts everything except agent naming; consent remains a browser action.
