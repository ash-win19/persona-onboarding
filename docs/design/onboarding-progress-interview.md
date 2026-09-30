# Onboarding progress and plan confirmation

Design interview opened September 29, 2026. This revisits the shipped onboarding behavior after the user's supplied conversation showed repeated questions and no clear finish. The decisions below were settled before implementation; the final clarification supersedes the initial one-question limit.

## Evidence

The supplied transcript shows the assistant repeatedly promising a Gmail authorization link before admitting it could not supply one. Gmail eventually connected through the existing browser control. After the user asked for a summary of that day's OpenAI DevDay, the assistant repeatedly asked which details they wanted, supplied an unverified generic claim, and later asked for the first task again. The user explicitly asked whether onboarding was complete and ended the call frustrated.

The transcript proves these conversational failures. It does not, by itself, establish which fact proposals were accepted by the server or which phase was active for every response.

The shipped behavior distinguishes graduation from completion of every setup item. The user has replaced that normal finish rule: both names, verified Gmail and a task must be saved, then the user accepts a first-task plan before dashboard entry. The glossary and implementation now follow the final agreed completion rule.

## Confirmed requirements

- Show an onboarding scratchpad next to the conversation, taking the vertical connected checkmarks from the [reference timeline](https://blocks.so/onboarding/onboarding-06).
- Track the assistant name, user name, verified Gmail connection and first task from saved information. Do not ask the user to manually tick off facts they have already supplied.
- Keep the component compact, without the reference's descriptive paragraphs or timestamps.
- Collect information in any order and avoid repeating questions about accepted facts.
- Ask only a small number of useful clarification questions, propose a short plan, and complete the normal onboarding path when the user accepts it.
- Move to the dashboard after accepting the plan. Do not start another setup interview.
- Preserve conversational text and voice, including recovery from interruptions.

## Round 1: accepted decisions

1. Gmail is mandatory alongside both names, the task and accepted plan. The user chose this over the recommendation to make Gmail optional.
2. At most one task clarification question across text and voice. A clear task uses zero. Then propose a plan with explicit assumptions. Stop clarification immediately when the user asks to stop.
3. Short labels and saved values, with a right-hand rail on desktop and an expandable summary above chat on mobile.

## Round 2: accepted decisions

4. Replace Skip with Save and exit. Gmail refusal/failure remains pending with Retry and no repeated chat prompts.
5. Accept the displayed current plan using Looks good, a typed yes, or a spoken yes when that plan is awaiting confirmation. Then enter the dashboard immediately with the same conversation and active call. No additional confirmation or countdown.
6. Save all supplied tasks and propose a simple order in the plan, without a separate prioritization interview.

## Remaining edge cases

- Names need a preferred label, not a legal identity. A nickname can satisfy the user's name. Refusal leaves the row pending, without repeating the same question. Save and exit preserves the unfinished onboarding.
- A yes to a call, Gmail or a different assistant question is not plan acceptance. A changed proposal invalidates any old acceptance request. “Yes, but...” modifies the proposal rather than silently locking the old version.
- Previously completed users must stay on the dashboard. Apply the revised completion gate to unfinished onboarding; do not erase existing task context or return established users to setup.

## Proposed behavior to review

The scratchpad should update from the same committed state that decides whether onboarding can finish. A checkmark means an accepted fact or verified connection, not a model claim. A skipped item needs its own status rather than a false success checkmark. The plan needs a visible pending-confirmation state so the four information items being saved do not imply that the user has already accepted the plan.

Plan confirmation should identify the proposal being accepted. Save that acceptance and the phase transition together; refreshes, retries and continued speech must not reopen the completed onboarding flow. Editing the task before acceptance replaces the proposal. Editing it from the dashboard is ordinary task work.

The onboarding agent should use a bounded sequence of actions: capture new information, ask for a required missing detail, propose a plan, or commit an accepted plan. It should not independently decide to ask another broad question when the saved state already permits the next action.

Gmail guidance should name the actual Connect Gmail control and wait for verified connection status. It must not promise a future link, claim to open a page itself, or repeatedly ask whether the user is ready. The same principle applies to Start a call.

The current trial cannot browse current events, read inbox messages or send mail. A proposed plan must state its available action and any needed user input. For the transcript's DevDay request, offer to summarize supplied notes or a transcript rather than inventing announcements. Adding browsing or email actions is outside this onboarding redesign.

## Implementation investigation

The current executable role instructions are in `backend/src/chat/prompts.ts`. Persisted onboarding decisions are in `backend/src/chat/onboarding.ts`. Dashboard readiness is derived in `backend/src/chat/journey.ts`, and `ChatService.journey` prepares and enters the dashboard.

Code inspection at `64f5cdc` found that saving a spoken transcript does not itself extract facts. The voice model chooses whether to call `capture_onboarding`; repair runs after rejected calls, not after omitted capture. A successful capture can also mark multiple speech items assessed even if it omitted the task. Therefore a task visible in the transcript can remain missing from saved onboarding state. Reliable capture must precede the decision to ask another question, and task omissions must remain recoverable from their original source.

The current UI already consumes authoritative values and statuses and can carry an active call across dashboard navigation. Reuse that persistence and call continuity, replacing invitation-based graduation and the five-second handoff countdown with the agreed completion rule.

## Review

All six interview decisions are settled. The [consolidated design](onboarding-progress.md) contains the interface, completion rule, proposed system instructions, examples and implementation boundaries. The user confirmed the intended flow, permitting one or two task clarification questions according to actual ambiguity, and then accepted completion with an explicit no-task choice. Implementation began on that basis.

## Final clarification

The onboarding agent should make life easier, not conduct an interview. Clear tasks use zero questions; unclear ones normally use one, with a second only if essential ambiguity remains. The user explicitly approved completion after names and Gmail when they say they have no tasks yet. The final plan confirmation remains the single action that locks the saved choices and opens the dashboard.
