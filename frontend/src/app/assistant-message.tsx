import { memo, useId } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const AssistantMessage = memo(function AssistantMessage({
  content,
}: {
  content: string;
}) {
  const id = useId();
  return (
    <div className="assistant-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ clobberPrefix: `message-${id}-` }}
        skipHtml
      >
        {content}
      </Markdown>
    </div>
  );
});
