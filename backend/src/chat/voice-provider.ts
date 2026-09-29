import { captureOnboardingTool } from './model.js';
import WebSocket from 'ws';

export const VOICE_PROVIDER = Symbol('VOICE_PROVIDER');
export type VoiceEvent = {
  type: string;
  event_id?: string;
  item_id?: string;
  previous_item_id?: string | null;
  transcript?: string;
  response_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  audio_end_ms?: number;
  item?: {
    id: string;
    type: string;
    role?: string;
    content?: { type: string; text?: string; transcript?: string }[];
  };
  response?: {
    id: string;
    status: string;
    metadata?: { generation?: string; sourceItem?: string };
    output?: {
      id: string;
      type: string;
      role?: string;
      content?: { type: string; text?: string; transcript?: string }[];
    }[];
  };
  error?: { code?: string };
};
export interface VoiceConnection {
  providerId: string;
  sdp: string;
  send(event: Record<string, unknown>): void;
  healthy(): boolean;
  close(): Promise<void>;
}
export interface VoiceProvider {
  connect(
    sdp: string,
    instructions: string,
    onEvent: (event: VoiceEvent) => void,
    onClose: () => void,
  ): Promise<VoiceConnection>;
}

export class OpenAIVoiceProvider implements VoiceProvider {
  constructor(
    private readonly key: string,
    private readonly model: string,
  ) {}

  async connect(
    sdp: string,
    instructions: string,
    onEvent: (event: VoiceEvent) => void,
    onClose: () => void,
  ): Promise<VoiceConnection> {
    const form = new FormData();
    form.set('sdp', sdp);
    form.set(
      'session',
      JSON.stringify({
        type: 'realtime',
        model: this.model,
        instructions,
        output_modalities: ['audio'],
        max_output_tokens: 900,
        audio: {
          input: {
            transcription: { model: 'gpt-4o-mini-transcribe' },
            turn_detection: {
              type: 'server_vad',
              create_response: false,
              interrupt_response: true,
            },
          },
          output: { voice: 'marin' },
        },
        tools: [
          {
            type: 'function',
            name: captureOnboardingTool.name,
            description: captureOnboardingTool.description,
            parameters: captureOnboardingTool.parameters,
          },
          {
            type: 'function',
            name: 'saved_context',
            description:
              'Get current facts and confirm the application server is controlling this call. Use at the start and before claiming a saved change.',
            parameters: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
          },
        ],
        tool_choice: 'auto',
      }),
    );
    const created = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}` },
      body: form,
      signal: AbortSignal.timeout(18000),
    });
    if (!created.ok) throw new Error('VOICE_SETUP_FAILED');
    const providerId = created.headers.get('location')?.split('/').pop();
    if (!providerId || !/^rtc_[A-Za-z0-9_-]+$/.test(providerId))
      throw new Error('VOICE_ID_MISSING');
    const answer = await created.text();
    const socket = new WebSocket(
      `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(providerId)}`,
      {
        headers: { Authorization: `Bearer ${this.key}` },
        handshakeTimeout: 10000,
        maxPayload: 2 * 1024 * 1024,
      },
    );
    let closing = false;
    let lastPong = Date.now();
    let heartbeat: NodeJS.Timeout | undefined;
    const healthy = () =>
      !closing &&
      socket.readyState === WebSocket.OPEN &&
      Date.now() - lastPong < 10000;
    socket.on('pong', () => {
      lastPong = Date.now();
    });
    const close = async () => {
      if (closing) return;
      closing = true;
      clearInterval(heartbeat);
      socket.close();
      await fetch(
        `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(providerId)}/hangup`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.key}` },
          signal: AbortSignal.timeout(5000),
        },
      ).catch(() => undefined);
    };
    socket.on('message', (data) => {
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        onEvent(JSON.parse(bytes.toString('utf8')) as VoiceEvent);
      } catch {
        onClose();
      }
    });
    socket.on('close', () => {
      if (!closing) onClose();
    });
    socket.on('error', () => {
      if (!closing) onClose();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('VOICE_CONTROL_TIMEOUT')),
          12000,
        );
        socket.once('open', () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.once('error', () => {
          clearTimeout(timeout);
          reject(new Error('VOICE_CONTROL_FAILED'));
        });
      });
      lastPong = Date.now();
      heartbeat = setInterval(() => {
        if (!healthy()) {
          clearInterval(heartbeat);
          socket.terminate();
          onClose();
        } else socket.ping();
      }, 3000);
      heartbeat.unref();
      return {
        healthy,
        providerId,
        sdp: answer,
        send: (event) => {
          if (socket.readyState !== WebSocket.OPEN)
            throw new Error('VOICE_CONTROL_LOST');
          socket.send(JSON.stringify(event));
        },
        close,
      };
    } catch (error) {
      await close();
      throw error;
    }
  }
}
