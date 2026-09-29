import { ReplyPreview } from '../src/chat/model.js';

describe('reply preview', () => {
  const run = (chunks: string[], dropQuestions: boolean) => {
    const out: string[] = [];
    const preview = new ReplyPreview((text) => out.push(text), dropQuestions);
    for (const chunk of chunks) preview.push(chunk);
    preview.flush();
    return out;
  };

  it('passes every delta through when the model may ask a follow-up', () => {
    expect(run(['Here', ' is a plan', '. Ready?'], false)).toEqual([
      'Here',
      ' is a plan',
      '. Ready?',
    ]);
  });

  it('releases whole sentences and drops questions when the server asks', () => {
    const out = run(
      ['Nova it', ' is. What is', ' your name? Here', ' is a tip! Last'],
      true,
    );
    expect(out).toEqual(['Nova it is.', ' Here is a tip!', ' Last']);
    expect(out.join('')).toBe(
      'Nova it is. What is your name? Here is a tip! Last'.replace(
        /[^.!?。！？]*[?？]/gu,
        '',
      ),
    );
  });
});
