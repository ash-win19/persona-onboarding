# Useful work during onboarding

The September 29 call exposed a gap between collecting a task and helping with it. After the user supplied a test email and its body, the assistant repeatedly requested the subject. It advertised unsupported capabilities, guessed a name that was not saved, and sometimes returned only a capture error.

The revised role produces a small, reversible result immediately. Test and sample requests use sensible defaults. Existing context supplies the body, recipient and corrections; a missing preferred name or Gmail connection does not block writing a draft. Only a material ambiguity can justify a task question, with the existing maximum of two across channels. Frustration or a repeated request stops optional discovery.

Writing and sending are distinct. Persona can produce a complete email draft now, but this trial cannot send it. The assistant states that limit alongside the result without starting a subject/body interview. It describes only capabilities actually available. Unclear speech and recipient names cannot establish the user's identity.

Both names, verified Gmail, a task choice and current-plan acceptance still control dashboard entry. Useful work during setup does not bypass that rule. The accepted plan continues from any result already produced. Save and exit and the explicit no-task choice retain their meaning.

## Prompt locations

- `backend/src/chat/prompts.ts`: shared authority, useful-work behavior, onboarding role, continuing-task role and voice instructions.
- `backend/src/chat/model.ts`: strict interpretation contract with examples and one correction attempt after invalid evidence.
- `backend/src/chat/starter-plan.ts`: field descriptions for task evidence, no-task choices and clarification.
- `backend/src/chat/fact-repair.ts`: canonical current-call input and correction feedback.
- `backend/src/chat/daily-model.ts`: shares the useful-work rules after the dashboard opens.

The rewrite uses short labeled sections, concrete trigger/action examples and explicit failure behavior, following the [OpenAI voice prompting guidance](https://developers.openai.com/api/docs/guides/voice-prompting). It keeps the configured models unchanged.

## Runtime changes required by the prompts

Previously the server's onboarding reply could contain only a setup question or plan, so a prompt asking for useful work had no output path. The capture now has a separate bounded `assistance` result. The server persists it with the assessment and combines it with the next permitted setup action. The latest saved result supports follow-ups without adding older raw call transcripts to recovery requests. A prefixed draft does not prevent the current plan from being marked presented or accepted.

A repeated proposal for an already-known name or task is a no-op. New facts still require canonical evidence. When a task value is paraphrased but its evidence is valid, the saved task uses the exact quoted request instead. Names keep their stricter value validation. A refusal about another setup goal cannot erase tasks using the same evidence. Pure setup deferrals cannot add a generated question or repeat an earlier result. One automatic correction attempt handles invalid captures; terminal failures keep the existing recovery controls.

Some voice tool continuations previously requested an unconstrained reply or stopped after a tool response. They now render the server's reply in the current audio/text mode, preserving interruption, ownership and generation checks. Speech interpretation remains limited to the active call. This does not add sending tools or claim every provider failure can be recovered automatically.

## Regression cases

Synthetic live-model checks cover immediate test-email drafts, reusing a supplied body after frustration, supported capabilities, separating a recipient from the user's identity, mandatory Gmail, no-task completion and current-plan acceptance. Deterministic checks cover a draft before setup, plan approval after a prefixed result, saved-result recovery, bounded speech repair, stale proposals and voice tool continuation. Actual microphone transcription and Gmail-provider behavior still require manual verification.
