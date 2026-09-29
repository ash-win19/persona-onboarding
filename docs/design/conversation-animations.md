# Conversation animations

The user confirmed the recommended plan after two interview rounds. Implementation branch: `feat/conversation-animations`.

## Accepted scope

The user accepted these decisions in the first interview round:

- Replace the existing text thinking indicator and call animation. Keep the conversation layout, composer, and call controls.
- Show listening, thinking, and speaking during calls, driven by actual call activity and audio levels.
- Match Persona's existing monochrome colors.

## Behavior before this change

The text thinking row and call banner live in `frontend/src/app/chat.tsx`. The row previously showed the Persona mark and pulsing dots. The banner showed decorative bars while a call was connected.

The text indicator followed the local `busy` flag. The initial request could time out after 15 seconds while backend generation continued. Recovery polling also has a bounded wait. Session polling still exposes the pending operation, which now determines whether the agent is thinking.

`frontend/src/app/use-voice.ts` already exposed permission, connecting, active, and idle phases. It owned the microphone stream, remote playback, and a provider data channel, but did not expose conversational activity or audio levels to the UI.

The new visuals must preserve the existing call rules in [Browser calls](../voice.md): explicit microphone consent, typed participation, interruptions, control-loss cleanup, and continued chat after hangup. Existing status text and recovery controls remain available.

## Library findings

[`thinking-orbs`](https://libraries.dev/orbs) provides a canvas `ThinkingOrb`. Its named states are animation presets; they do not detect what the agent is doing. Current upstream source supports a monochrome theme and an optional tint.

[`voice-glow`](https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/voice-glow) provides `VoiceBeam`, which decorates the bottom edge of a container. It accepts an existing media stream or an audio-level getter, has a monochrome palette, and exposes a processing animation.

Both packages declare React 18 or newer and MIT licensing. The implementation pins `thinking-orbs` 0.3.2 and `voice-glow` 0.2.1 after checking their published types. It uses `theme="light"`, the orb's 20-pixel working preset, and the beam's monochrome palette with neutral band colors. The landing page's older `dark` prop is not used.

## Decision tree

| Decision | Status | Depends on |
| --- | --- | --- |
| Keep current layout and controls | Accepted | None |
| Use real call activity and audio levels | Accepted | None |
| Match the monochrome palette | Accepted | None |
| Define listening, thinking, and speaking | Accepted | Real activity |
| Choose which participant drives audio levels | Accepted | Audio reactivity |
| Choose orb size and beam placement | Accepted | Layout and palette |
| Define indicator behavior for long text replies | Accepted | Text indicator scope |
| Review the complete implementation plan | Confirmed | All product decisions |

The user accepted all recommendations in the second interview round:

1. Define listening as a live call ready for user speech, thinking as preparing a reply, and speaking as actual agent playback. Silence while ready still counts as listening.
2. Drive the beam from microphone levels while listening and agent playback levels while speaking. An interruption returns the visual to the user.
3. Put a 20-pixel orb beside the existing thinking text and the voice beam along the bottom of the existing call banner.
4. Keep the thinking indicator visible while the backend confirms ongoing generation, even after a local request timeout. Show recovery wording when current backend status cannot be confirmed.

## Implementation constraints

- Derive visual activity separately from the saved call lifecycle. Keep backend ownership and conversation state authoritative.
- Reuse the microphone stream and remote playback already owned by the call. The visual components must not request another microphone stream or alter speech-processing settings.
- Scope event handlers, meters, and cleanup to the current call attempt so a late event cannot animate a later call.
- Preserve the app's reduced-motion behavior with a static indicator and readable status. Stop visual animation in hidden tabs without stopping an otherwise valid call.
- Keep permission, connection, playback-blocked, and failure states explicit. A connected transport or completed generation alone is insufficient evidence that the agent is speaking.
- Exercise the existing voice, conversation layout, and introduction checks, adding coverage for activity transitions, interruption, cleanup, and reduced motion.

## Documentation

The agreed activity terms are recorded in `CONTEXT.md`. Rendering and implementation details belong in this plan. The library choice is reversible and does not warrant an ADR.

## Implementation

`conversation-animation.tsx` loads the two renderers on the client. The voice beam sits behind the call banner's text and controls. Reduced motion uses a static line; hidden tabs unmount the beam while the call continues. Neither renderer requests microphone access.

`voice-activity.ts` maps provider events to the agreed phases and rejects events for retired replies. Speaking requires both an output-audio event and local playback readiness. Generation completion keeps the speaking state until output drains. Spoken and submitted-text interruptions retire the previous reply, while tool work retains thinking.

`voice-meter.ts` analyses the existing input and output streams without connecting them to an audio destination. A per-frame getter samples the current speaker without React state updates for each audio sample. The call closes its analyser nodes and audio context on cleanup.

The text row uses confirmed backend generation state, including after a request timeout. Sending and connection recovery have separate text and a paused orb. Failed and completed operations stop the thinking indicator.

Provider event semantics were checked against the [Realtime server events reference](https://developers.openai.com/api/reference/resources/realtime/server-events#output_audio_buffer.started).

## Verification

- Nineteen unit checks passed, covering activity ordering, late events, tool work, audio-source selection, and meter cleanup alongside the existing API tests.
- All 29 browser checks passed. The eight voice checks were repeated after the final event-handling changes and passed. Coverage includes microphone denial, setup races, typed and spoken interruption, blocked playback recovery, hidden tabs, reduced motion, long text replies, and existing sign-in and Gmail recovery.
- Type checking and lint passed. Desktop orb and call-banner screenshots and the 375-pixel mobile fallback were inspected.
- The production build succeeds with `BACKEND_URL=http://localhost:3001 npm run build -- --webpack`. The default Turbopack production build hit an environment permission error when its CSS worker tried to bind a local port. The package's build command remains unchanged.
- Voice events and media behavior were simulated in browser tests. A live provider call and microphone calibration have not been verified in this change.
