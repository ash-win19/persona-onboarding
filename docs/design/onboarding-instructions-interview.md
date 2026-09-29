# Onboarding instruction redesign

Status: both decision rounds and the complete instruction design accepted. The user approved implementation and shipping. See [the instruction design](onboarding-instructions.md) and the executable prompts referenced there.

## Requirements supplied by the user

- The onboarding agent is responsible for onboarding a new user into Persona.
- Its questions should be specific and move toward getting the user ready for the main experience.
- Attempt to collect an agent name, a user name, a verified Gmail connection, and something the user wants help with.
- Attempt a voice call to collect the information other than the agent name. A browser voice simulator is sufficient.
- Accept out-of-order answers and recover from interruptions, including hangups.
- Keep the experience conversational and steer gently. The assignment allows early graduation to demonstrate value.

## Evidence from the initial implementation review

- `backend/src/chat/model.ts:118` defines fact interpretation. `model.ts:204` defines the response role as a personal assistant and requires substantive task help immediately.
- `backend/src/chat/onboarding.ts:286` selects the next goal and returns fixed question strings. Both text and voice must use the server-selected question, so prompt changes alone cannot contextualize every question.
- `backend/src/chat/calls.ts:524` defines the voice instructions and reuses interpretation rules.
- `backend/src/chat/onboarding.ts:229` derives graduation from an accepted help request. Completion requires both names, a help request, and verified Gmail; a completed call is not a completion requirement.
- There is no separate post-onboarding agent or implemented handoff. The same reply model continues helping in the same chat.
- At the start of this interview, the glossary defined graduation as starting help. ADR 0001 and the earlier design interview explicitly accepted early substantive help. The new remit reopened that boundary; round 2 settles its replacement.
- The existing deferral policy permits another invitation during a later visit. The earlier interview defines that behavior explicitly; the phrase "beyond the current visit" should be clarified rather than assumed to require postponement across multiple future visits.

The [Persona product page](https://yourpersona.com/band) presents a personal assistant for delegated tasks such as appointments, life administration, and follow-ups. It is product context, not evidence that this trial implements those actions. The trial currently supports conversational assistance, voice, and verified Gmail connection without inbox reading or sending.

## Decision tree

| Decision | Status | Unlocks |
| --- | --- | --- |
| Onboarding agent responsibility | Confirmed: onboarding a new user into Persona | Boundary between onboarding and task execution |
| R1. Handling an actionable task during onboarding | Accepted: prepare the first task; substantive task work belongs to the main experience | Early graduation, transition behavior, first-value examples |
| R2. Depth of information collected | Accepted: one concrete outcome and only the context needed to understand it | Task clarification rules, contextual questions, stopping criteria |
| R3. Graduation trigger and outstanding goals | Accepted: first task plus one attempt at each eligible goal; explicit early exit permitted without a task | Transition instructions and amendment to ADR 0001 |
| R4. Destination after onboarding | Accepted: same identity and chat, separate main-experience instructions | Separation of onboarding instructions from task assistance |
| Conversation and voice steering | Retain prior consent, refusal and recovery decisions; contextual examples drafted | Question wording, calls, Gmail explanations and recovery examples |
| Implementation scope and acceptance examples | Drafted: prompt separation, authoritative transition, contextual questions and existing recovery guarantees | Final shared-understanding review before runtime changes |

## Round 1, accepted

1. If the user says "I have an interview tomorrow", should the onboarding agent prepare the first task for the main experience, or deliver one small useful result before transitioning? Accepted: capture the task, briefly describe the first useful action, and continue toward the next eligible onboarding goal or early graduation. Keep substantive task execution outside the onboarding role.
2. Beyond the four assignment goals, should onboarding build a broader profile of work, routines and preferences, or collect only enough context to identify the first concrete outcome? Accepted: the first outcome and only the context needed to make it clear. Accept other volunteered details without turning them into more required questions.

The user accepted both recommendations. These decisions narrow the onboarding role; round 2 settles the graduation trigger. They do not require a separate deployed agent. A concrete first task can be captured without asking follow-up questions when the user's message is already clear enough.

## Round 2, accepted

3. What causes onboarding to end when some goals remain incomplete? Accepted: on the normal path, identify a clear first task and make one contextual attempt at each eligible outstanding goal, including the voice invitation, then give a short transition summary. Do not wait indefinitely for every goal to succeed. An explicit request to get started ends intake earlier. Preserve missing, declined and deferred states accurately; an unanswered offer is not a refusal. If the user explicitly skips everything without a first task, allow them to leave intake without inventing one.
4. What should this trial do after onboarding ends? Accepted: continue in the same chat with the same assistant identity, using a separate set of instructions for the main experience. Carry forward confirmed facts and the first task. Use the existing conversational help capabilities; introduce no new inbox actions or external integrations.

The user accepted both recommendations. No further product-choice round is needed. The final review presents the complete prompt draft, worked examples and supporting runtime changes together, so the user can confirm the shared understanding before implementation.

The existing refusal, deferral, consent and recovery rules remain accepted. These include no repeated unsolicited request after refusal, no repeated offer in the same visit, no automatic redial, and preserving confirmed details after interruption. The prompt draft explains the Gmail connection without promising inbox actions that the trial cannot perform.

## Documentation during the interview

The glossary now distinguishes the onboarding role, first task, main experience and revised graduation. ADR 0005 records the role boundary and amends the immediate-help trigger in ADR 0001. The instruction draft specifies how the accepted decisions apply to text, voice, refusals, interrupted delivery and the same-chat transition. The final shared understanding was confirmed with "Looks good, ship this!" Runtime implementation is authorized.
