import { onboardingGuide, roleInstructions } from '../src/chat/prompts.js';
import type { OnboardingState } from '../src/chat/onboarding.js';

const fact = (value: string | null, status = value ? 'known' : 'missing') => ({
  value,
  status: status as 'known' | 'missing' | 'ambiguous',
  sourceTurnId: null,
  revision: null,
});
const goal = (outcome = 'open') => ({
  outcome: outcome as 'open' | 'declined' | 'deferred',
  eligible: outcome === 'open',
  introduced: false,
});
const state = (overrides: Partial<OnboardingState> = {}): OnboardingState => ({
  revision: 3,
  facts: {
    agentName: fact('Nova'),
    userName: fact(null),
    helpRequest: fact(null),
  },
  gmail: 'not_connected',
  calendar: 'not_connected',
  calendarAvailable: false,
  call: 'not_started',
  graduated: false,
  onboardingComplete: false,
  mode: 'onboarding',
  missingGoals: ['userName', 'helpRequest', 'gmail'],
  intake: {
    tasks: ['prepare for my interview'],
    noTasks: false,
    questionsAsked: 0,
    clarification: null,
    plan: null,
    ready: false,
  },
  policy: {
    visitId: 'visit',
    goals: {
      agentName: goal(),
      userName: goal(),
      helpRequest: goal(),
      gmail: goal('deferred'),
      voice: goal(),
    },
  },
  ...overrides,
});

describe('onboarding guide', () => {
  it('describes saved details and the one step to take this turn', () => {
    const prompt = onboardingGuide(state(), { next: 'userName' });
    expect(prompt).toContain('You are Nova, a personal assistant in Persona.');
    expect(prompt).toContain('- Your name: "Nova"');
    expect(prompt).toContain('- Their name: not given yet');
    expect(prompt).toContain('- First task: "prepare for my interview"');
    expect(prompt).toContain('connecting Google (later)');
    expect(prompt).toContain('This turn: Ask what you should call them.');
    expect(prompt).not.toContain('Google Calendar');
  });

  it('mentions Calendar only when the server can connect it', () => {
    const prompt = onboardingGuide(state({ calendarAvailable: true }));
    expect(prompt).toContain('Connect Google Calendar');
    expect(prompt).toContain('- Google Calendar: not connected');
  });

  it('closes warmly once onboarding finishes, and marks an unsaved turn', () => {
    const unnamed = state({
      facts: {
        agentName: fact(null),
        userName: fact(null),
        helpRequest: fact(null),
      },
    });
    expect(onboardingGuide(unnamed)).toContain("you don't have a name yet");
    expect(onboardingGuide(unnamed, { unsaved: true })).toContain(
      "Their last message couldn't be saved.",
    );
    expect(onboardingGuide(state(), { finished: true })).toContain(
      "Tell them warmly they're all set",
    );
    expect(
      onboardingGuide(state(), { next: 'userName', exit: true }),
    ).toContain("They asked to skip setup. It can't be skipped");
  });

  it('keeps the main-experience instructions after graduation', () => {
    expect(roleInstructions(state({ graduated: true }))).toContain(
      'continuing the same conversation after onboarding',
    );
  });
});
