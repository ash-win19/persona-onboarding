# Browser calls

A call belongs to the saved conversation. The browser sends microphone audio directly to OpenAI Realtime over WebRTC. NestJS creates the provider call and attaches a sideband WebSocket before returning the SDP answer. Long-lived keys stay on Render. The server handles the saved-context tool and commits finalized transcripts.

Each page receives a distinct tab identity. PostgreSQL stores the controlling tab, an ownership epoch, and a 15-second lease. The browser renews it every three seconds. Takeover advances the epoch and ends the previous call in the same transaction. Text completions and fact tools from old ownership are rejected. A tab can recover abandoned ownership when its lease expires.

Calls have a persisted ten-minute deadline and a warning one minute before it. Browser control checks have a five-second request deadline and run every three seconds. Backend checks run every three seconds. A detected storage or control failure stops browser media; server cleanup is best effort if storage is unreachable. Process restart reconciles attempts from the previous server instance. No call restarts automatically.

Finalized provider items reserve transcript order before asynchronous transcription completes. Duplicate final events are ignored. Assistant transcripts record generated, played, or interrupted delivery separately from text; generated text is not proof that a user heard all of it. Hangup retains committed content. A thirty-second window accepts already-in-flight final transcripts from a valid ended call, while takeover rejects old authority immediately.

Set `OPENAI_REALTIME_MODEL` on Render to select the Realtime model. The default is `gpt-realtime-mini`. Voice uses the existing `OPENAI_API_KEY`. Model usage is billed to the existing OpenAI project.

## Verification

Deterministic provider and HTTP tests cover asynchronous final transcripts, duplicate events, sideband tools, ownership, hangup, deadline and control loss. Browser checks cover microphone denial and explicit consent. Real-provider observations and deployed revisions belong in release receipts; these tests do not prove real audio latency.

Sources: [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime), [sideband control](https://developers.openai.com/api/docs/guides/voice-server-controls?api=realtime#with-webrtc), [interruption and truncation](https://developers.openai.com/api/docs/guides/realtime-conversations#interruption-and-truncation).
