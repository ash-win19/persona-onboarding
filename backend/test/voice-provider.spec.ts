import {
  DEFAULT_REALTIME_MODEL,
  OpenAIVoiceProvider,
} from '../src/chat/voice-provider.js';

async function sessionFor(model: string) {
  let body: FormData | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      body = init.body as FormData;
      return Promise.resolve(new Response(null, { status: 400 }));
    }),
  );
  await expect(
    new OpenAIVoiceProvider('key', model).connect(
      'sdp',
      'instructions',
      () => Promise.resolve(),
      () => undefined,
    ),
  ).rejects.toThrow('VOICE_SETUP_FAILED');
  return JSON.parse(body!.get('session') as string) as Record<string, any>;
}

describe('OpenAI voice session', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the current realtime and transcription models with low reasoning', async () => {
    const session = await sessionFor(DEFAULT_REALTIME_MODEL);
    expect(session.model).toBe('gpt-realtime-2.1-mini');
    expect(session.reasoning).toEqual({ effort: 'low' });
    expect(session.audio.input.transcription).toEqual({
      model: 'gpt-transcribe',
    });
  });

  it('omits reasoning for the previous model so it can be restored', async () => {
    const session = await sessionFor('gpt-realtime-mini');
    expect(session.model).toBe('gpt-realtime-mini');
    expect(session).not.toHaveProperty('reasoning');
  });
});
