# Separate graduation from onboarding completion

Amended by [ADR 0005](0005-separate-onboarding-from-task-assistance.md). Graduation and completion remain separate; the new decision replaces the immediate graduation trigger below with a bounded onboarding role and an explicit transition.

The user accepted starting useful conversational help as soon as a help request is actionable, even when names, Gmail or a call remain incomplete. Model graduation separately from onboarding completion so unmet goals remain visible without blocking unrelated help. This allows incomplete setup in the main experience and requires the agent to honor refusals and revisit deferred requests appropriately rather than enforcing a fixed sequence.
