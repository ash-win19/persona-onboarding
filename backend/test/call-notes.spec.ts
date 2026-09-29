import { withCallNotes } from '../src/chat/model.js';

describe('call notes', () => {
  it('leaves a text-only conversation unchanged', () => {
    expect(
      withCallNotes([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello', callId: null },
      ]),
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ]);
  });

  it('brackets each call and returns only fields the model accepts', () => {
    const notes = withCallNotes([
      { role: 'user', content: 'Help with my interview', callId: null },
      { role: 'assistant', content: 'Shall we practise?', callId: 'one' },
      { role: 'user', content: 'Yes', callId: 'one' },
      { role: 'assistant', content: 'Next question', callId: 'two' },
      { role: 'user', content: 'Back in text', callId: null },
    ]);
    expect(notes.map((item) => item.role)).toEqual([
      'user',
      'developer',
      'assistant',
      'user',
      'developer',
      'developer',
      'assistant',
      'developer',
      'user',
    ]);
    expect(notes[1].content).toMatch(/voice call started/);
    expect(notes[4].content).toMatch(/voice call ended/);
    expect(notes.every((item) => !('callId' in item))).toBe(true);
  });
});
