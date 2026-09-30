# Conversational onboarding

Onboarding saves the assistant name, user name, verified Gmail connection and task choice. A task choice can contain several tasks or an explicit "nothing yet." The assistant proposes a short plan. Accepting that current plan through Looks good, text or voice saves it and opens the dashboard immediately.

The original conversation and active call remain available after graduation. The dashboard starts separate daily chats for new work, using the saved names, tasks and accepted plan as context. See [app flow](app-flow.md).

## Instructions to review

- `backend/src/chat/prompts.ts` defines the onboarding role and shared text and voice rules.
- `backend/src/chat/model.ts` interprets user statements through the strict capture schema. During onboarding, it returns the server-authorized reply after capture.
- `backend/src/chat/starter-plan.ts` tracks tasks, clarification count and the current plan.
- `backend/src/chat/onboarding.ts` validates quoted evidence, saves progress and owns plan acceptance and graduation.
- `backend/src/chat/calls.ts` captures finalized current-call speech before generating the next onboarding reply.
- `frontend/src/app/onboarding-progress.tsx` displays the saved details and pending steps.
- [The approved design](design/onboarding-progress.md) records the flow and [ADR 0007](adr/0007-require-plan-acceptance-to-finish-onboarding.md) explains the completion rule.

## A bounded conversation

Clear tasks need no clarification. Normally the assistant asks at most one task question. A second is allowed only if the answer leaves an essential ambiguity about the desired outcome. The count persists across text, calls and reconnects. For clear requests, the assistant produces a small useful result immediately with sensible defaults. Missing names or Gmail do not block a draft. If the user asks to stop the questions, it delivers the supported result and carries the remaining work into the plan.

The assistant saves all stated tasks and suggests an order. It does not ask the user to invent a task or choose between several tasks before showing a plan. The plan states what Persona can actually do; Gmail authorization does not imply support for reading or sending mail.

A narrow desktop rail shows Assistant, You, Gmail, Your tasks and Plan with saved values and progress marks. Mobile uses an expandable summary above the chat. Gmail has a connection action in this rail, so the assistant never promises an unavailable link.

## Useful work during setup

The assistant produces a draft, list or explanation before the next permitted setup step. A test email gets a subject and body immediately. It reuses wording already supplied and distinguishes writing the draft from sending it. This trial cannot send mail, even with Gmail connected.

The structured response separates `assistance` from facts and the plan. The server saves this result with its assessment, appends at most the permitted setup action, and marks a displayed plan correctly even when a draft precedes it. The last result is available as context for follow-ups. It does not grant tool access or count as a profile fact.

Invalid text captures and current-call interpretations receive one automatic correction attempt. Unchanged saved facts are no-ops, so repeating a task cannot invalidate an otherwise useful reply. A preference about a call or Gmail cannot also erase the task list using the same evidence. Voice tool continuations use the server reply instead of opening a new generic conversation. Failures after the bounded retry preserve the existing recovery controls.

See [the prompt rewrite](design/onboarding-useful-work.md) for the behavior and regression cases.

## Finishing and leaving

New users need both names, verified Gmail and a task choice before accepting a plan. Acceptance requires the current, presented plan and no unfinished user input. A typed or spoken affirmative only accepts a plan that is awaiting confirmation; an unrelated or quoted "yes" does not finish onboarding. Changing the intake invalidates the prior plan. Acceptance and dashboard entry commit together, and repeated acceptance is safe.

Save and exit returns to the landing page without graduating. The next visit resumes saved progress. Gmail refusal or authorization failure leaves Gmail pending; it does not trigger repeated chat prompts or grant dashboard access. The user can retry from the rail.

Existing graduation and dashboard-entry records retain their prior meaning and access. The migration adds intake storage without resetting older completion markers.

## Facts and call recovery

Capture proposals need evidence from canonical user messages or finalized current-call speech, with the current revision and control owner. Assistant and user names remain distinct. The server verifies Gmail; user claims cannot mark it connected.

A call is offered after the assistant is named, but voice is optional. Finalized speech is interpreted before the next onboarding reply. The same saved clarification count and plan apply in text and voice. An active call continues across dashboard entry. Current-call capture failures expose Retry saved speech; older ended-call transcripts stay in history and are not automatically included in a new recovery request. Ending a call before capture finishes can require the user to repeat an unsaved detail in text.

## Verification

Focused backend tests cover mandatory Gmail, explicit no-task choices, multiple tasks, clarification limits, stale and repeated plan approval, quoted or qualified affirmatives and automatic capture of current-call speech. Browser tests cover desktop and mobile progress, immediate dashboard entry and Save and exit resumption.

`test/onboarding-live.e2e-spec.ts` is opt-in with `PERSONA_LIVE_MODEL=1`. It uses a real model with synthetic messages and a disposable local database, never production conversation storage. Actual microphone and OAuth-provider behavior still need manual verification.
