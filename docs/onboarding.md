# Conversational onboarding

Persona has two instruction sets within one continuous conversation. Onboarding collects the assistant name, user name, Gmail connection and a first task, and offers a browser call. The main experience then performs task work with the same assistant identity and saved context.

## Instructions to review

- `backend/src/chat/prompts.ts` defines shared authority rules, onboarding, task assistance and voice instructions.
- `backend/src/chat/model.ts` defines interpretation, the strict capture schema and streaming text composition. A concurrent structured request personalizes the single server-authorized onboarding question; failure uses the goal-specific fallback.
- `backend/src/chat/onboarding.ts` validates facts and exit evidence, chooses eligible goals and owns graduation.
- `backend/src/chat/calls.ts` applies the active role to live calls, their openings and repair responses.
- [The approved design](design/onboarding-instructions.md) includes examples and [ADR 0005](adr/0005-separate-onboarding-from-task-assistance.md) explains the role boundary.

## Graduation and completed setup

An accepted help request no longer automatically graduates a new user. The normal path makes one delivered invitation for each eligible outstanding goal, including voice, and graduates once a clear first task is known. The last invitation stays available for the user to answer; the next reply uses the main role. An explicit request to leave setup commits graduation before the reply, even without a task.

The phase is durable. Migration preserves existing users who already had an accepted help request in the main experience. It does not graduate new users on subsequent migrations. Refresh, corrections, unavailable Gmail and interrupted calls do not restart intake.

Onboarding completion remains separate: both names and a first task must be known, and Gmail must be verified. A successful call is not required for completion. Refused, deferred, unanswered and unavailable goals keep their actual statuses after graduation.

## Facts and invitation delivery

The capture tool proposes explicit facts, corrections, preferences, optional memory and `exitEvidence`. Values and evidence must match the canonical user source and current revision. Assistant and user names remain distinct. Ambiguous proposals preserve prior accepted values. The server, rather than user claims, owns integration state and completion.

An exit quote represents a global request to leave setup. Skipping one question or deferring Gmail does not imply a global exit. Exit intent is preserved during voice repairs and failed-reply retries. Acknowledgements use committed results only.

Selecting an onboarding question does not consume an invitation. Text counts it when the assistant reply is committed; voice requires a played, uninterrupted response and finalized transcript. Failed generation and unheard speech leave the goal available. Explicit refusals persist until reopened; deferrals apply for the current visit, with a later relevant invitation permitted.

Text answers retain streaming. The server selects the goal and validates the contextual question's structured goal identifier and single-question shape. Natural-language meaning remains a model judgment, covered by behavioral tests rather than claimed as mechanically proven. Voice uses the same allowed goal and current phase.

## Verification

The backend suites cover evidence, stale proposals, phase persistence, normal and explicit graduation, retries, interrupted playback, live voice role changes, Gmail verification and unchanged authentication/recovery behavior. `test/onboarding-live.e2e-spec.ts` is opt-in with `PERSONA_LIVE_MODEL=1`; it uses a real OpenAI model and a disposable local database. It never uses production conversation storage.

The trial verifies Gmail account access with metadata authorization. It does not fetch messages, send mail, browse or perform external tasks in either role.
