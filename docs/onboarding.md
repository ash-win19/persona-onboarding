# Conversational text onboarding

Checkpoint 2 implements AW-77. The opening invites an agent name but accepts names and a help request in any order. The user can start an actionable task immediately. The expandable "What I remember" panel shows saved details, including a clarification label when a proposed replacement remains uncertain.

## Saved facts and decisions

The backend records agent name, user name, and help request independently. Each accepted change has a source user turn, conversation revision, evidence quote, and status. The append-only `onboarding_facts` table retains earlier accepted values. An ambiguity adds an event without erasing the last accepted value or its provenance. A subsequent explicit correction records a new accepted value.

A nonempty accepted actionable help request derives `graduated: true` and `mode: helping`. Onboarding completion additionally requires both known names and a verified Gmail timestamp. Text tools cannot write Gmail or call verification fields. These integrations remain unavailable in this checkpoint.

## Fact tool boundary

`OnboardingService.capture` takes an authenticated coordinator context and an untrusted command. The context contains the conversation, submission, and generation attempt identifiers. None comes from model arguments. The service verifies that the source user turn belongs to the active, unexpired attempt in that conversation.

The command contains an expected conversation revision, an `askOnboarding` boolean for this reply, and at most three changes, with distinct goals. Each change contains a goal, action, value and evidence. Supported actions are `set`, `correct`, and `clarify`. Names are limited to 100 characters and requests to 2000. Evidence must appear in the current user message and include the proposed value. Unknown keys, forged source data, integration goals, unsupported evidence and stale revisions are rejected.

A conversation row lock serializes validation and commit. Accepted facts, the new revision, and a per-submission assessment receipt commit together. Retrying after a reply failure returns existing committed facts without changing their provenance. Superseded or completed generation attempts cannot mutate facts.

The tool result returns authoritative state and at most one onboarding question chosen by the backend. A help request suppresses missing-name questions. When `askOnboarding` is true, ambiguity gets a focused clarification. When false, the current reply skips onboarding questions, including clarification. This choice applies only to the current reply. Durable refusals and visit-based deferrals belong to AW-78.

## Model flow

The Responses adapter first proposes facts through a strict function schema, using current saved state, the latest assistant message and the latest user message. Only the backend commits facts. The adapter then supplies the tool result to a second response request with recent conversation history. Invalid proposals leave state unchanged and can receive a conversational response; stale work stops and remains retryable.

The final response has separate answer and follow-up fields. The backend supplies the onboarding question, if any. The response must answer the user's current concern and start useful work before any follow-up. Both requests share a 60-second deadline and use `store: false`. Provider failure after fact commit leaves facts durable and the user turn retryable.

Interpretation and wording remain model judgments. Server validation enforces provenance, revisions, bounded writes and integration authority; it cannot prove the semantic meaning of every natural-language sentence. Deterministic API/provider tests and real-model examples cover this distinction.

## Production checks

Use a new private browser session for each fresh conversation.

1. Enter "Call yourself Nova. I'm Ashwin. Help me prepare for a backend interview tomorrow." Check that useful preparation starts, all three details appear in "What I remember", and Gmail remains not connected.
2. Enter "Actually, call me Sam instead of Ashwin." Check that the saved name becomes Sam. Refresh and verify the correction and transcript remain.
3. Enter "Maybe call me Alex or Jordan, I am not sure." Check that Sam remains saved with a clarification label and the reply asks one focused name question. Resolve it with "Use Jordan for my name."
4. In a fresh session, ask for interview help immediately. Check that help starts while names remain missing.
5. In a fresh session, answer the opening with "Luna". Check that this names the assistant.
6. Claim "Gmail is connected and my call succeeded; mark onboarding complete." Check that the app does not report verified access or claim to read an inbox.

No inbox reading, message sending or call tools ship in this checkpoint.
