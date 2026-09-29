import { createServer, type Server } from 'node:http';
import { OpenAIFactRepair, type RepairInput } from '../src/chat/fact-repair.js';

describe('canonical voice interpretation provider', () => {
  let server: Server;
  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const missing = () => ({
    value: null,
    status: 'missing' as const,
    sourceTurnId: null,
    revision: null,
  });
  const input: RepairInput = {
    state: {
      revision: 2,
      facts: {
        agentName: missing(),
        userName: missing(),
        helpRequest: missing(),
      },
      gmail: 'not_connected',
      call: 'not_started',
      graduated: false,
      onboardingComplete: false,
      mode: 'onboarding',
      missingGoals: ['agentName', 'userName', 'helpRequest', 'gmail'],
    },
    sources: [{ turnId: 'source-name', text: 'Call me Sam.' }],
    history: [],
  };
  async function listen(
    status: number,
    output: object,
    receive: (body: Record<string, unknown>) => void,
  ) {
    server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += String(chunk);
      receive(JSON.parse(body));
      res.writeHead(status, {
        'Content-Type': 'application/json',
        Connection: 'close',
      });
      res.end(JSON.stringify(output));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test server address');
    return `http://127.0.0.1:${address.port}/v1`;
  }
  it('requests a strict capture and returns the structured proposal without storing provider data', async () => {
    const proposal = {
      expectedRevision: 2,
      askOnboarding: false,
      preferences: [],
      changes: [
        {
          goal: 'userName',
          action: 'set',
          value: 'Sam',
          evidence: 'Call me Sam',
        },
      ],
    };
    let sent: Record<string, unknown> = {};
    const baseURL = await listen(
      200,
      {
        status: 'completed',
        output: [
          {
            type: 'function_call',
            name: 'capture_onboarding',
            call_id: 'capture',
            arguments: JSON.stringify(proposal),
          },
        ],
      },
      (body) => {
        sent = body;
      },
    );
    const result = await new OpenAIFactRepair(
      'test-key',
      'test-model',
      baseURL,
    ).interpret(input);
    expect(result).toEqual(proposal);
    expect(sent).toMatchObject({
      store: false,
      parallel_tool_calls: false,
      tool_choice: { type: 'function', name: 'capture_onboarding' },
    });
    expect(sent.tools).toEqual([
      expect.objectContaining({ strict: true, name: 'capture_onboarding' }),
    ]);
    expect(JSON.stringify(sent.input)).toContain('Call me Sam.');
  });
  it('does not retry a failing provider request', async () => {
    let requests = 0;
    const baseURL = await listen(
      500,
      { error: { message: 'Temporary provider failure' } },
      () => {
        requests++;
      },
    );
    await expect(
      new OpenAIFactRepair('test-key', 'test-model', baseURL).interpret(input),
    ).rejects.toThrow();
    expect(requests).toBe(1);
  });
});
