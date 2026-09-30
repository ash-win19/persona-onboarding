# Conversational onboarding

Onboarding gets to know a new user so Persona can help them in the app. It collects four things: a name for the assistant, the user's name, a Google connection (Gmail, plus Calendar when the server can connect it) and their first task or an explicit "nothing yet". As soon as the last one is saved, onboarding finishes and the dashboard opens. There is no plan to approve. See [ADR 0008](adr/0008-finish-onboarding-automatically.md).

The original conversation and active call remain available after graduation. The dashboard starts separate daily chats for new work, using the saved names and tasks as context. See [app flow](app-flow.md).

## Instructions to review

- `backend/src/chat/prompts.ts` holds the onboarding guide (`onboardingGuide`): the role, the four details, how to talk, and a status block the server fills in each turn with saved details and the one step to take next. The same guide drives text and voice; calls add a short voice note.
- `backend/src/chat/model.ts` has the interpretation prompt that turns each message into a strict `capture_onboarding` proposal, then streams the guide's reply.
- `backend/src/chat/opening.ts` has the saved greeting.
- `backend/src/chat/onboarding.ts` validates quoted evidence, saves progress, picks the next step and finishes onboarding.
- `backend/src/chat/calls.ts` captures finalized call speech, then asks the voice model to reply using the guide.
- `frontend/src/app/onboarding-progress.tsx` shows the saved details and pending steps.

## How a turn works

1. The interpreter proposes names, tasks, a no-task choice, explicit refusals or deferrals, and exit requests, each with an exact quote from the user.
2. The server validates the quotes, saves what is clear and picks the next step in order: assistant name, user name, Google, first task. Unclear names come first. Declined steps, and steps postponed during this visit, are skipped.
3. The guide writes the reply: it reacts to what the user said, then asks for that one step. It does not start task work. When nothing is left to ask, it simply responds.
4. If the saved details are complete, the same commit finishes onboarding and the guide writes a short closing line. The browser shows it for a moment, then opens the dashboard.

Every saved detail must match the user's own words. When the interpreter proposes something that doesn't, such as a task quoted from older history, the server drops that item and saves the rest of the turn. Losing the whole turn to one bad item made calls repeat "Sorry, I didn't catch that". If the dropped item was new, the guide asks the user to confirm it. Spelled-out names count as a match: "Adam, A-T-O-M" can save Atom. On a call, saving a transcript bumps the conversation revision without changing onboarding, so an interpretation that started earlier is still accepted unless onboarding itself changed. The realtime model's own capture tool, used after onboarding, stays strict and keeps its repair loop. A malformed proposal still fails; on a call that uses fixed wording pointing to Retry saved speech.

## Finishing and leaving

Finishing needs both names, verified Gmail, verified Calendar when available, and a task choice. It also waits until no newer input is still being interpreted. When a detail arrives outside a reply, such as returning from Google consent, the browser asks the server to finish and a closing line is saved as the handoff turn. Finishing is idempotent.

Save and exit returns to the landing page without graduating. The next visit resumes saved progress. A Google refusal or failed authorization leaves the step pending; the user can connect later from Your setup.

## Voice

Calls use the same guide and the same next step. The voice model speaks its own words rather than a server script. It may ask for the assistant's name, and confirms a name it is unsure it heard. An active call continues across dashboard entry.

## Verification

Backend tests cover the step order, moving past a postponed step, finishing in the same text reply or call turn, finishing after Gmail and Calendar connect, holding the finish while newer speech is pending, the guide prompt contents and repaired proposals. Browser tests cover the progress rail and the timed hand-off to the dashboard.

`test/onboarding-live.e2e-spec.ts` is opt-in with `PERSONA_LIVE_MODEL=1`. It uses a real model with synthetic messages and a disposable local database, never production conversation storage. Real microphone and OAuth-provider behavior still need manual verification.
