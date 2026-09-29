export type VoicePhase = "listening" | "thinking" | "speaking";

export type VoiceActivity = {
  phase: VoicePhase;
  responseId: string | null;
  audioResponseId: string | null;
  userSpeaking: boolean;
  inputItemId: string | null;
  awaitingTool: boolean;
  retiredResponses: string[];
};

export function initialVoiceActivity(): VoiceActivity {
  return {
    phase: "listening",
    responseId: null,
    audioResponseId: null,
    userSpeaking: false,
    inputItemId: null,
    awaitingTool: false,
    retiredResponses: [],
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function interruptVoice(
  state: VoiceActivity,
  typed: boolean,
): VoiceActivity {
  return {
    ...state,
    phase: typed ? "thinking" : "listening",
    userSpeaking: !typed,
    inputItemId: null,
    awaitingTool: false,
    retiredResponses: Array.from(
      new Set([
        ...state.retiredResponses,
        ...[state.responseId, state.audioResponseId].filter(
          (id): id is string => id !== null,
        ),
      ]),
    ),
    responseId: null,
    audioResponseId: null,
  };
}

// Provider generation and output playback have different lifetimes. In
// particular, response.done must not stop a reply that is still playing.
export function receiveVoiceEvent(
  state: VoiceActivity,
  event: unknown,
): VoiceActivity {
  if (!record(event)) return state;
  const response = record(event.response) ? event.response : undefined;
  const id =
    typeof event.response_id === "string"
      ? event.response_id
      : typeof response?.id === "string"
        ? response.id
        : null;
  if (id && state.retiredResponses.includes(id)) return state;

  switch (event.type) {
    case "input_audio_buffer.speech_started":
      return {
        ...interruptVoice(state, false),
        inputItemId: typeof event.item_id === "string" ? event.item_id : null,
      };
    case "input_audio_buffer.speech_stopped":
    case "input_audio_buffer.committed":
      if (
        state.inputItemId &&
        typeof event.item_id === "string" &&
        event.item_id !== state.inputItemId
      )
        return state;
      return { ...state, phase: "thinking", userSpeaking: false };
    case "response.created": {
      if (!id) return state;
      const source = record(response?.metadata)
        ? response.metadata.sourceItem
        : undefined;
      if (
        state.userSpeaking ||
        (state.inputItemId &&
          typeof source === "string" &&
          source !== state.inputItemId)
      )
        return { ...state, retiredResponses: [...state.retiredResponses, id] };
      return {
        ...state,
        responseId: id,
        awaitingTool: false,
        phase: state.audioResponseId ? "speaking" : "thinking",
      };
    }
    case "output_audio_buffer.started":
      if (!id || state.userSpeaking || id !== state.responseId) return state;
      return { ...state, audioResponseId: id, phase: "speaking" };
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      if (!id || id !== state.audioResponseId) return state;
      return {
        ...state,
        audioResponseId: null,
        responseId: state.responseId === id ? null : state.responseId,
        retiredResponses: [...state.retiredResponses, id],
        phase:
          state.awaitingTool || (state.responseId && state.responseId !== id)
            ? "thinking"
            : "listening",
      };
    case "response.done": {
      if (!id || id !== state.responseId) return state;
      if (response?.status !== "completed") {
        return {
          ...state,
          responseId: null,
          audioResponseId: null,
          phase: "listening",
          awaitingTool: false,
          retiredResponses: [...state.retiredResponses, id],
        };
      }
      const output = Array.isArray(response.output) ? response.output : [];
      const hasAudio = output.some(
        (item: unknown) =>
          record(item) &&
          Array.isArray(item.content) &&
          item.content.some(
            (part: unknown) =>
              record(part) &&
              ["audio", "output_audio"].includes(String(part.type)),
          ),
      );
      const hasTool = output.some(
        (item: unknown) => record(item) && item.type === "function_call",
      );
      if (hasTool)
        return {
          ...state,
          awaitingTool: true,
          phase: state.audioResponseId ? "speaking" : "thinking",
        };
      if (state.audioResponseId || hasAudio) return state;
      return {
        ...state,
        phase: "listening",
        responseId: null,
        retiredResponses: [...state.retiredResponses, id],
      };
    }
    case "error":
      // Cancelling an already completed response is a harmless race.
      if (
        record(event.error) &&
        event.error.code === "response_cancel_not_active"
      )
        return state;
      // Request-level errors do not necessarily terminate an active response.
      // Its response.done event remains the authority for failure.
      if (state.phase !== "thinking" || state.responseId) return state;
      return { ...state, phase: "listening", responseId: null };
    default:
      return state;
  }
}
