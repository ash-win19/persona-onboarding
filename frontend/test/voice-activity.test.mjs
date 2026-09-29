import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initialVoiceActivity,
  interruptVoice,
  receiveVoiceEvent,
} from "../src/lib/voice-activity.ts";

const created = (id) => ({ type: "response.created", response: { id } });
const playback = (type, id) => ({
  type: `output_audio_buffer.${type}`,
  response_id: id,
});
const completed = (id, output) => ({
  type: "response.done",
  response: { id, status: "completed", output },
});
const audio = [{ type: "message", content: [{ type: "audio" }] }];

function playing(id = "reply") {
  let state = receiveVoiceEvent(initialVoiceActivity(), created(id));
  return receiveVoiceEvent(state, playback("started", id));
}

test("listens through silence, waits after speech, and speaks through generation completion", () => {
  let state = initialVoiceActivity();
  assert.equal(state.phase, "listening");
  state = receiveVoiceEvent(state, {
    type: "input_audio_buffer.speech_started",
  });
  assert.equal(state.phase, "listening");
  state = receiveVoiceEvent(state, { type: "input_audio_buffer.committed" });
  assert.equal(state.phase, "thinking");
  state = receiveVoiceEvent(state, created("reply"));
  state = receiveVoiceEvent(state, playback("started", "reply"));
  assert.equal(state.phase, "speaking");
  state = receiveVoiceEvent(state, completed("reply", audio));
  assert.equal(state.phase, "speaking");
  state = receiveVoiceEvent(state, playback("stopped", "reply"));
  assert.equal(state.phase, "listening");
  assert.equal(receiveVoiceEvent(state, playback("started", "reply")), state);
});

test("speech interruption rejects late audio and cancellation from the old reply", () => {
  let state = receiveVoiceEvent(playing("old"), {
    type: "input_audio_buffer.speech_started",
  });
  assert.equal(state.phase, "listening");
  state = receiveVoiceEvent(state, { type: "input_audio_buffer.committed" });
  state = receiveVoiceEvent(state, created("new"));
  for (const event of [
    playback("started", "old"),
    playback("stopped", "old"),
    playback("cleared", "old"),
    completed("old", audio),
  ]) {
    assert.equal(receiveVoiceEvent(state, event), state);
  }
  assert.equal(state.phase, "thinking");
  state = receiveVoiceEvent(state, playback("started", "new"));
  assert.equal(state.phase, "speaking");
});

test("a typed interruption waits for a new response, without accepting old output", () => {
  const state = interruptVoice(playing("old"), true);
  assert.equal(state.phase, "thinking");
  assert.equal(state.userSpeaking, false);
  assert.equal(receiveVoiceEvent(state, playback("started", "old")), state);
});

test("a response arriving while the user is speaking cannot take attention back", () => {
  let state = receiveVoiceEvent(initialVoiceActivity(), {
    type: "input_audio_buffer.speech_started",
  });
  state = receiveVoiceEvent(state, created("late"));
  assert.equal(state.phase, "listening");
  assert.equal(receiveVoiceEvent(state, playback("started", "late")), state);
});

test("tool completion keeps thinking; a completed text-only response or failure clears it", () => {
  let state = receiveVoiceEvent(initialVoiceActivity(), created("tool"));
  state = receiveVoiceEvent(
    state,
    completed("tool", [{ type: "function_call" }]),
  );
  assert.equal(state.phase, "thinking");
  state = receiveVoiceEvent(state, created("text"));
  state = receiveVoiceEvent(
    state,
    completed("text", [{ type: "message", content: [{ type: "text" }] }]),
  );
  assert.equal(state.phase, "listening");
  state = receiveVoiceEvent(state, created("failed"));
  state = receiveVoiceEvent(state, {
    type: "response.done",
    response: { id: "failed", status: "failed" },
  });
  assert.equal(state.phase, "listening");
});

test("draining an earlier reply does not clear a newer pending response", () => {
  let state = receiveVoiceEvent(playing("old"), created("new"));
  state = receiveVoiceEvent(state, playback("stopped", "old"));
  assert.equal(state.phase, "thinking");
  assert.equal(state.responseId, "new");
});

test("unknown and malformed events do not change activity", () => {
  const state = playing();
  for (const event of [
    null,
    [],
    7,
    "text",
    {},
    { type: "response.created" },
    { type: "rate_limits.updated" },
  ]) {
    assert.equal(receiveVoiceEvent(state, event), state);
  }
});

test("finishing spoken audio keeps thinking while a tool is still running", () => {
  let state = playing("tool");
  state = receiveVoiceEvent(
    state,
    completed("tool", [...audio, { type: "function_call" }]),
  );
  state = receiveVoiceEvent(state, playback("stopped", "tool"));
  assert.equal(state.phase, "thinking");
  state = receiveVoiceEvent(state, created("answer"));
  state = receiveVoiceEvent(state, playback("started", "answer"));
  assert.equal(state.phase, "speaking");
});

test("a delayed response for an earlier speech item cannot replace the current turn", () => {
  let state = receiveVoiceEvent(initialVoiceActivity(), {
    type: "input_audio_buffer.speech_started",
    item_id: "current-input",
  });
  state = receiveVoiceEvent(state, {
    type: "input_audio_buffer.committed",
    item_id: "current-input",
  });
  state = receiveVoiceEvent(state, {
    type: "response.created",
    response: { id: "late", metadata: { sourceItem: "old-input" } },
  });
  assert.equal(state.phase, "thinking");
  assert.equal(receiveVoiceEvent(state, playback("started", "late")), state);
  assert.equal(
    receiveVoiceEvent(state, {
      type: "input_audio_buffer.committed",
      item_id: "old-input",
    }),
    state,
  );
});

test("a request-level error does not prevent an ongoing response from playing", () => {
  let state = receiveVoiceEvent(initialVoiceActivity(), created("reply"));
  state = receiveVoiceEvent(state, {
    type: "error",
    error: { code: "conversation_already_has_active_response" },
  });
  assert.equal(state.phase, "thinking");
  state = receiveVoiceEvent(state, playback("started", "reply"));
  assert.equal(state.phase, "speaking");
});
