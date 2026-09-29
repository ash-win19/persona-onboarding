import type { ServerResponse } from 'node:http';

// Writes a Responses API stream the way OpenAI does: text deltas, then completion.
export function streamText(
  res: ServerResponse,
  chunks: string[],
  status = 'completed',
) {
  res.setHeader('Content-Type', 'text/event-stream');
  const send = (data: Record<string, unknown>) =>
    res.write(`event: ${String(data.type)}\ndata: ${JSON.stringify(data)}\n\n`);
  chunks.forEach((delta, index) =>
    send({
      type: 'response.output_text.delta',
      item_id: 'msg_reply',
      output_index: 0,
      content_index: 0,
      delta,
      sequence_number: index,
    }),
  );
  send({
    type: status === 'completed' ? 'response.completed' : 'response.incomplete',
    sequence_number: chunks.length,
    response: {
      id: 'resp_reply',
      object: 'response',
      status,
      output: [],
    },
  });
  res.end();
}
