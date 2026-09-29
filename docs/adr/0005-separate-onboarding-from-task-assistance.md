# Separate onboarding from task assistance

Accepted product decision. The user approved the complete instruction design and implementation.

The previous assistant began substantive task work as soon as a help request was captured, which let onboarding drift into general assistance. The onboarding role will instead identify one first task, explain the intended first action, and make one contextual attempt at each eligible remaining goal, including voice, before transitioning. The user can explicitly leave setup earlier, even without a task; all outstanding goals retain their actual status.

The main experience continues under the same assistant identity in the same chat, with separate instructions and the saved context. This keeps onboarding focused without blocking access to useful help, at the cost of maintaining an explicit transition instead of deriving graduation from the presence of a help request. It amends the immediate-help trigger in ADR 0001 while preserving the distinction between graduation and completed setup. Neither graduation nor the new role adds inbox actions or other capabilities to the trial.
