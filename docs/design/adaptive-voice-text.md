# Adaptive voice and text during onboarding

Accepted design, September 29, 2026. Based on `origin/main` at `980aaf6`. Prepared on `feat/adaptive-voice-text`. The initial proposal is retained below as design context. The subsequently accepted [onboarding finish rule](../adr/0007-require-plan-acceptance-to-finish-onboarding.md) supersedes the early-graduation policy below: new users accept a starter plan after required setup, and Save and exit preserves unfinished onboarding. This feature retains that rule while allowing all call modes through plan acceptance. The implementation and current behavior are documented in [Browser calls](../voice.md). Automated verification covers controlled providers; real-device and real-provider checks must be reported separately.

The user should be able to speak, type, listen, or read while continuing the same call conversation. Changing how they communicate must preserve their task, accepted details, and onboarding progress. Everything runs in the browser; phone numbers are unnecessary.

## Existing foundation

The current app already supports typed messages during a browser call. [Chat submission](../../frontend/src/app/chat.tsx) routes these messages to `/calls/turns`. [Calls.type](../../backend/src/chat/calls.ts) saves the input, advances the response generation, cancels the previous response, clears queued audio, and injects the text into the live call. Stable submission IDs prevent duplicate accepted input. Existing [backend tests](../../backend/test/voice.e2e-spec.ts) and [browser tests](../../frontend/test/browser/voice.spec.ts) cover typed interruption and retaining the call. These tests were inspected, not executed for this design.

The missing product behavior is explicit microphone and reply controls. [useVoice](../../frontend/src/app/use-voice.ts) currently exposes call start, end, playback recovery, and typed-turn activity, but no microphone mute or silent-reply preference. The [voice provider](../../backend/src/chat/voice-provider.ts) configures audio output for ordinary replies.

Daily conversations have separate message storage. [DashboardFrame](../../frontend/src/app/dashboard-frame.tsx) keeps the original conversation mounted while showing a daily chat, with a call banner linking back to it. A daily-chat message does not currently become input to that active call. Preserve this distinction when adding the feature.

## Experience

Keep the transcript and composer visible during calls. Put two independent controls beside End call: microphone on/off and spoken/text replies. Offer an "I'll type" shortcut that turns the microphone off while retaining spoken replies. Merely focusing the composer does not change either preference.

| Common use | Microphone | Agent reply | What the user sees |
| --- | --- | --- | --- |
| Talk normally | On | Speech with text | "Mic on" and a composer that remains usable |
| Type and listen in public | Off | Speech with text | "Mic off. Type your reply." |
| Continue quietly | Off | Text only | "Mic off. Replies are text only." |

The controls also allow speaking while receiving text replies. Always show their actual state. A muted microphone must never be labelled "Listening". Keyboard access and accessible toggle names must work without relying on the animation or color.

Example: Persona asks about an interview. The user taps "I'll type", then sends "Tomorrow, backend role. Let's start now." The microphone turns off immediately, the agent uses the typed context, and the accepted early exit starts interview help. The user still hears replies through headphones. Selecting text replies stops sound immediately and continues the exchange on screen. Switching back never plays old buffered audio.

Typing a draft leaves the current answer alone. Sending it interrupts an obsolete answer. Each accepted message stays visible even if several arrive quickly; only the latest response remains active, and it considers all accepted input rather than dropping earlier messages in the burst.

Across dashboard navigation, extend the persistent call banner into an expandable call panel with transcript, "Message this call", mic, reply, and hangup controls. Label daily-chat composers separately. Keep the live call attached to its original conversation through graduation; do not silently move it into a daily thread or send a message to both destinations.

## Conversational behavior

Collect volunteered details in any order. Answer the current concern first and ask at most one relevant question. Clarify information that changes the next action; do not require a profile interview for a clear task.

Respect existing graduation policy in [ADR 0005](../adr/0005-separate-onboarding-from-task-assistance.md): the ordinary path identifies a task and makes a contextual attempt at each eligible goal. An explicit request such as "skip setup" or "let's start now" exits sooner, even without a task. Make the existing early-exit action available during calls too. Graduation and complete setup remain separate. A clear task can make the start-now action useful without silently redefining the ordinary graduation rule.

After a committed exit, keep the assistant, call, and accepted context, switch to task assistance, and give a useful first result. A silent reply must be able to deliver the handoff; navigation cannot wait for an audio-played event that will never occur. Daily chats remain separate as described in [ADR 0006](../adr/0006-separate-daily-chats-from-onboarding.md).

Record refusals, postponements, and missing answers separately. A hangup, silence, background noise, failed permission request, or disconnect does not mean refusal. Do not repeat declined requests unless the user reopens them. Do not keep prompting because a person takes time to type. Integration status still requires verified backend evidence, regardless of what a spoken or typed message claims.

## State and ownership

Keep these independent rather than building one large list of combined states:

| State | Values or meaning |
| --- | --- |
| Conversation phase | Onboarding or helping, committed by the backend |
| Call lifecycle | Idle, requesting permission, connecting, active, ended, failed |
| Microphone | On or off, enforced immediately in the browser |
| Reply preference | Speech with text, or text only |
| Current response | Queued, generating, delivering, interrupted, completed, failed |
| Input receipt | Sending, accepted, unconfirmed, rejected |

Every turn belongs to a conversation. Calls, responses, and provider items have separate identities. Keep existing tab ownership, ownership epochs, revisions, and generation checks. Add a monotonically increasing preference revision so delayed replies and preference acknowledgements cannot restore an older mode.

Microphone off must disable outgoing audio immediately and discard uncommitted microphone input at the mode-change cutoff. Preserve utterances already accepted before that cutoff. Reject delayed work from discarded audio. Never turn the microphone on because of a model response, navigation, preference retry, or transport recovery; the user must enable it.

Text-only replies must silence local playback before waiting for the server, cancel obsolete audio, clear buffers, and request subsequent text output. Keep local audio suppressed if the preference update fails. Show that failure and offer ordinary text continuation. Validate provider behavior during implementation; prompt wording alone cannot enforce silence.

## Implementation approach

Extend the existing call module instead of starting a second assistant for call text. Share submission acceptance between text and call paths through one interface that accepts the conversation, authenticated owner, stable submission ID, and content. Under the conversation lock, resolve whether an active call can receive the input. The caller receives a durable input receipt and response status. Keep provider routing, retries, cancellation, and transcript reconciliation inside that module.

Retain the existing endpoints as adapters where useful. Add a call-preference command with call ID, preference revision, microphone intent, and reply preference. Server acknowledgement governs response routing; local microphone and playback restrictions take effect immediately. Persist preferences for the current call so status reconciliation cannot reset them.

On submitted text, locally stop obsolete playback without waiting for a network round trip, then reconcile the durable receipt. Serialize accepted speech, typed input, preference changes, and response creation. The latest accepted input can supersede a response; a late transcript from an earlier reserved speech item cannot become a newer correction merely because transcription finished later. Old responses and tool proposals cannot mutate current facts or resume playback.

Separate durable input acceptance from successful answer delivery. The current call path marks a submission completed when input is saved, before the assistant finishes. Recovery needs to distinguish "message saved, answer interrupted" from "message not confirmed". If hangup races with send, look up the same submission ID before resending through ordinary text. An accepted input with no finished answer must remain resumable without saving a duplicate user turn. A failed or unconfirmed send stays visible with retry controls.

Keep one canonical assistant turn per response. Track text availability separately from audio playback and interruption. Text-only output must enter usable conversation history and satisfy appropriate onboarding invitation and handoff delivery checks without pretending audio played. Update call context, memory, recap, and journey consumers together. A saved or displayed text message does not prove the user read it, and generated audio does not prove the user heard it. Interim speech transcripts remain provisional until finalized.

Suggested implementation locations are `use-voice.ts` for browser controls and local media enforcement, `chat.tsx` and `dashboard-frame.tsx` for call composition and navigation, `calls.ts` and `calls.controller.ts` for serialized commands and recovery, and `voice-provider.ts` for reply-format handling. Review `onboarding.ts`, journey handling, transcript storage, and memory delivery filters before adding text-only call replies.

## Recovery

An intentional hangup stops media immediately and leaves the saved conversation usable in text. A refresh, expired call, lost tab control, or connection failure stops voice and preserves accepted content. Another call requires user action. Keep the existing ten-minute call limit; neither typing nor switching reply preference restarts it.

Microphone denial leaves chat available. Do not claim unsent audio was saved after a connection failure. If speech was interrupted before a fact was confirmed, ask one focused clarification when relevant instead of inventing the answer. A late finalized transcript can fill its original history position within the existing allowed completion window; it cannot reverse a newer correction or restart an ended call.

Preserve a pending typed message and its submission ID through recoverable failures. When backend state is unavailable, show "Not confirmed" and reconcile on recovery. Do not silently generate another reply or drop the draft. End-call recap generation must continue to yield to new user input so it does not compete with the ongoing text conversation.

## Stress-test acceptance

| Scenario | Required result |
| --- | --- |
| Type while the agent speaks | Obsolete sound stops, input appears once, call remains active |
| Repeated Send and lost acknowledgements | One accepted input and recoverable response status |
| Several typed messages in quick succession | All input retained in order, one current response |
| Speech ends as text is sent | Earlier speech retains its position; delayed work cannot undo a correction |
| Mute during an utterance | No new captured audio is sent; discarded partial input cannot later change facts |
| Select text replies during speech | Sound stops locally; no stale buffered audio plays after toggling back |
| Preference request fails or replies arrive out of order | Local privacy choice remains enforced and failure is visible |
| Hang up before, during, or after send acceptance | Receipt reconciliation preserves input without duplication |
| Refresh, network loss, backend restart, or tab takeover | Media stops, saved state survives, no automatic redial or unmute |
| Deny mic permission or block audio playback | Text remains available and controls explain actual state |
| Graduate while muted with text replies | Handoff completes without waiting for audio, context stays intact |
| Navigate into a daily chat during a call | Call controls remain reachable; each composer has one clear destination |
| Contradictory names, off-topic input, refusal, or silence | Clarify only when needed; do not restart the questionnaire |
| Claim Gmail is connected or instruct the agent to ignore state rules | Verified integration and fact rules remain authoritative |

Implement in slices: microphone control and call-panel access first, text-only replies with delivery accounting second, then receipt recovery and event-race coverage. Add deterministic backend and browser tests at the existing interfaces. Complete manual voice checks on desktop and mobile with permission denial, autoplay restrictions, noisy input, and a real provider before claiming readiness for stress testing. Record event timings without message or audio content to diagnose delayed cancellation and reply latency.
