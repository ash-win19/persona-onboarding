import { DEFAULT_MODEL, reasoningFor } from '../src/chat/config.js';
import { interpretation, interpretationFor } from '../src/chat/model.js';

describe('text model options', () => {
  it('defaults to gpt-6-luna with an explicit reasoning effort', () => {
    expect(DEFAULT_MODEL).toBe('gpt-6-luna');
    expect(reasoningFor(DEFAULT_MODEL, 'low')).toEqual({
      reasoning: { effort: 'low' },
    });
  });

  it('sends no reasoning to gpt-4.1-mini so it can be restored', () => {
    expect(reasoningFor('gpt-4.1-mini', 'low')).toEqual({});
  });

  it('adds the no-task note only for reasoning models', () => {
    expect(interpretationFor('gpt-4.1-mini')).toBe(interpretation);
    expect(interpretationFor(DEFAULT_MODEL)).toContain(
      'I do not need help yet',
    );
  });
});
