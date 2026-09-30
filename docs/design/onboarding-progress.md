# Onboarding with visible progress and a confirmed plan

Implementation design, September 29, 2026. The [interview](onboarding-progress-interview.md) records the accepted decisions and subsequent clarification: allow an explicit no-task choice, use zero or one task clarification normally, and a second only for unresolved essential ambiguity. Changes are on the feature branch for review.

## Finish rule

New-user onboarding finishes when the assistant name and user name are accepted, Gmail is verified, the tasks or an explicit no-task choice are saved, and the user accepts the current starter plan. Persist acceptance and completion together, then open the dashboard. A model saying “all set” never supplies this evidence.

Gmail is required, as requested. If authorization fails or the user refuses, keep progress saved and show a connection action or Retry. Do not repeatedly ask for consent in the conversation. Save and exit returns to the public entry page with an option to resume; it ends any active call and preserves accepted details. Sign out remains a separate action. Existing completion and dashboard-entry records remain unchanged after this change.

## Interface

Keep the conversation as the primary area. Place a narrow, visually quiet progress rail on its right on wide screens, aligned with the first conversation content and fixed within the available page height as the transcript scrolls. Use the connected vertical checks from [the supplied timeline](https://blocks.so/onboarding/onboarding-06), with short labels and accepted values instead of descriptions or timestamps.

The desktop content area should fit a conversation column around 680 pixels, a 48-pixel gap and a rail around 240 pixels. These are starting dimensions, not reasons to create horizontal overflow. Below the width needed for both columns, put a compact expandable progress summary above the transcript; keep the composer full-width. Keyboard and screen-reader order stays conversation, progress summary and actions in a coherent reading sequence.

Example before the user has supplied a task:

```text
Conversation                                  Your setup

Atom                                           ✓ Assistant
“What would you like help with?”                  Atom
                                               │
                                               ✓ You
                                                 Ashwin
                                               │
                                               ✓ Gmail
                                                 Connected
                                               │
                                               ● Your tasks
                                                 Still to add

[ Message Atom                         ↑ ]
```

Use four information rows: Assistant, You, Gmail and Your tasks. A fifth compact row, Plan, shows “Not ready,” “Review,” or “Accepted” so four checked details do not falsely suggest that onboarding has already ended. The tasks row can contain a short list when the user supplies multiple tasks. Do not show a percentage that implies all work takes equal time.

The visual states are a check for saved, a filled dot for the current action, and an empty circle for pending. Pair each symbol with accessible status text and do not depend on color. Announce newly saved details politely once. Respect reduced motion. Long names wrap; Gmail shows Connected with the verified address available in its detail, rather than forcing a long address into the narrow rail.

Checks are automatic. Names and tasks have an accessible Edit action so a speech recognition error can be corrected without restarting the chat. Editing a required fact updates the saved state; editing task content replaces any unaccepted proposal. Use text labels rather than an unexplained pencil icon alone.

Keep one canonical Gmail status in the rail, with Connect Gmail or Retry as needed. Remove redundant success banners once that status is visible. Keep transient failure feedback beside the relevant action. Offer voice once with an actual Start a call control. A typed yes to a call offer highlights that control; it does not open another consent interview.

## Conversation sequence

1. Accept all volunteered information, in any order. Update the scratchpad after the server saves it. Do not make users give a detail twice because they spoke it rather than typed it.
2. Ask only for missing required information. Assistant naming stays in text, as required by the original assignment. Let users continue the other collection on an optional browser call.
3. Ask zero task clarification questions if the requested outcome is clear. Otherwise ask one focused task question across text and voice. A second is allowed only if the answer still leaves an essential ambiguity. After that, use explicit assumptions in the plan. “Stop asking questions” skips any remaining task clarification.
4. Save every task the user supplies. Propose an order rather than requiring them to choose a single task. The first item is the starting point; later items remain available on the dashboard.
5. Once all four information goals are fulfilled, display a short starter plan in the conversation, with up to three brief actions and any required input. Ask “Does this plan work for you?” This is the final acceptance question, not another task discovery question.
6. Accept Looks good, or an unambiguous typed/spoken acceptance of that current proposal. Change plan invites a direct correction and presents the revised plan without reopening task discovery.
7. Save acceptance and dashboard entry atomically. Show “Your plan is saved. Let's get started.” and route directly to the dashboard. Preserve the transcript and any active call. Do not add a countdown, second Continue button or further onboarding question.

A clear task is an intended outcome, not a fully specified work order. “Draft an email” is enough to propose drafting from the recipient and purpose supplied during task work. Unknown details need not prevent saving the task or reviewing a plan.

## Plan example for the supplied conversation

```text
Here's the plan:

1. Make a grocery list from what you need.
2. Summarize the DevDay notes or transcript you share.
3. Sketch a gym session that fits your available time.

I'll start with the groceries. I can work with information you provide here;
I can't fetch today's announcements or buy groceries for you.

Does this plan work for you?

[ Looks good ]  [ Change plan ]
```

The exact actions must follow the user's actual intent and available capabilities. Do not fabricate current-event details, imply inbox access, promise to send mail or claim a task has already been performed. The accepted plan appears on dashboard arrival; task work then continues from it rather than starting a new intake conversation.

## Proposed onboarding system instructions

```text
You are Persona's onboarding guide. Help the user name their assistant,
introduce themselves, connect Gmail, and agree on a short plan for the tasks
they want help with. Your job ends when the saved current plan is accepted
and the server completes onboarding.

Use the server's scratchpad and next action as the source of truth. Save all
clear facts, corrections and tasks the user supplies, even out of order.
Keep the assistant's name separate from the user's name. Never acknowledge
a save, a connection or completion before the server confirms it.

Ask one question at a time. Never ask for a known detail. Ask for the
assistant's name only in text. A nickname is sufficient for the user's name.
Do not ask for a profile of the user's work, routines or preferences.

For the user's tasks, ask no clarification when the outcome is clear. You
normally ask zero or one task clarification question. A second is allowed
only for an essential unresolved ambiguity, across text and voice combined. Ask only about a missing detail that changes the
proposed starting action. After that limit, state reasonable assumptions
in the plan. If the user asks you to stop asking questions, propose the plan
as soon as required setup is ready. Never ask “what task?” again when one
has already been saved.

If several tasks are supplied, save all of them and propose a simple order.
Do not force the user to choose one or discard another. Keep the proposal
brief, normally one sentence or up to three short actions. Include needed
input or capability limits. Do not execute the tasks during onboarding.

Gmail is required. Refer to the actual Connect Gmail control beside the
conversation. Explain once that this trial verifies the account address
and does not read or send messages. Never promise to provide a link later,
claim you opened a page, request credentials, or ask repeatedly if the user
is ready. Wait for verified connection status. On refusal or failure,
preserve progress, point to the available connection/retry action and Save
and exit, and stop prompting for consent.

Offer the browser call once as an optional way to continue. The user starts
it with Start a call. A yes to that offer is not acceptance of a task plan.
A hangup preserves progress; it is not a refusal and never causes redial.

When the server says the required details are ready, propose the starter
plan and ask “Does this plan work for you?” Accept only an unambiguous yes
to the currently pending plan, or the Looks good action. “Yes, but...” and
corrections revise the proposal; show the revised plan for acceptance.
Do not treat a yes to Gmail, a call or another question as plan acceptance.

After committed plan acceptance, say the plan is saved and move to the
dashboard. Ask no more setup questions. Continue with the same identity,
task context and active call. Missing information for doing the work can be
resolved in the dashboard without reopening onboarding.

Use concise, direct replies. Avoid readiness loops, repeated menus,
“Anything else?”, unsupported promises and generic filler. If the user is
frustrated, acknowledge it once and take the next concrete permitted step.
```

Shared authority and capability rules remain in force. The voice addition must require the same saved scratchpad, clarification count and pending proposal as text; the model cannot reset them by changing channels or starting another call.

## Runtime guarantees

Prompt changes alone cannot guarantee progress. The server must own the four accepted facts, the ordered task list, the task clarification count, the current proposal and its acceptance. Completion requires the accepted proposal to match current saved task information and verified Gmail status.

Use one capture path before selecting the next onboarding action in text and voice. Every finalized user speech input must be accounted for, including split adjacent speech and interruptions. Capturing one fact must not make an omitted task unrecoverable. Save a task when its outcome is clear, even if execution details are missing. If capture is delayed or fails, show a recoverable save state and preserve the user's words instead of asking them to repeat the task.

Bind acceptance to a proposal version. A typed/spoken yes is valid only when the delivered current plan is awaiting acceptance and no intervening question gives yes another meaning. A button identifies its proposal explicitly. Reject stale approvals, preserve saved corrections, and do not route on a failed save. Repeated acceptance is safe and leads to the same dashboard state.

Replace the old automatic graduation after attempted invitations and the explicit skip bypass for unfinished new users. Keep existing dashboard entry records valid. Avoid the current intermediate state in which a text reply starts substantive task work while the user remains on the onboarding page.

Dashboard navigation must keep the existing conversation and call owner alive. Call playback must not block the transition indefinitely; a text acknowledgement remains available if audio is interrupted. Do not ask the user to confirm a second time because acknowledgement playback failed.

## Focused verification after implementation

Verify the supplied failure path, split spoken tasks, one-question budget across text/voice/reconnect, Gmail denial and retry, plan revision followed by stale approval, repeated acceptance, active-call dashboard navigation, refresh during a failed save, and preservation of existing dashboard access. Check the rail at desktop and mobile sizes with keyboard and screen reader status announcements. Keep verification focused on these changed behaviors.

## Implementation limits

Automatic capture is limited to finalized speech in the current active call. Previously stored transcripts remain available, but this change does not add a new export of older calls for automatic recovery. A failed capture can be retried during the call. Existing completion markers are preserved; the migration only adds storage for the new intake state.
