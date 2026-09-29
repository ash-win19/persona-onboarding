# Chat presentation fixes

Status: approved. The user confirmed all five fixes, contextual Gmail visibility, official Gmail branding and clearing the input hint after the first typed or spoken user message. Implementation branch: `bug/chat-presentation`, based on main after streamed text replies merged.

## Requested behavior

1. Replace the visible "Back to latest" pill with a circular down-arrow button. Keep its scroll behavior, keyboard access and accessible name.
2. Format assistant replies as GitHub-flavored Markdown with ordinary paragraph spacing. Apply the same presentation while replies stream and after they are saved. Preserve the existing font and monochrome palette.
3. Show the user's pending message without "Not yet confirmed" underneath it. Keep actual connection failures and retry actions in the existing notice area outside the message bubble.
4. Place one Gmail control immediately above the message input, outside the scrolling transcript. Keep connection, reconnect and account-detail states in that position. Use the official current Gmail product icon and Google Sans for the Gmail action label, scoped to this control.
5. Remove the composer placeholder after the first pending or saved user message, typed or spoken, including when restoring an existing conversation.

## Decision tree

| Decision | Status | Depends on |
| --- | --- | --- |
| Circular down-arrow control | Requested | None |
| Markdown for saved and streamed assistant replies | Requested | None |
| Pending bubble contains message text only | Requested | None |
| One Gmail control above the composer | Requested | None |
| Gmail first appears when relevant | Confirmed | Gmail placement |
| Official Gmail icon and matching font | Requested | Gmail placement |
| Placeholder clears after first user message | Confirmed; pending or saved, typed or spoken | Placeholder removal |
| Shared understanding and implementation | Confirmed | All decisions settled |

## Code findings

- The jump button contains visible label text and uses content-sized padding, producing a pill.
- Both assistant rendering paths wrap raw content in one paragraph. The shared paragraph rule preserves blank lines with a 1.8 line height. The backend intentionally separates the call invitation with a blank line, so the frontend gives that separation a full empty line instead of a controlled paragraph margin.
- Pending user bubbles always include the delivery label, including healthy submissions. The frontend already handles genuine failure and retry notices separately.
- GmailConnection mounts once after the message log. Each reply moves it down the transcript. The current relevance rule uses onboarding state or a saved Gmail mention; existing connections and attempts can also make the control visible.
- The placeholder depends on whether a call is active, not whether the user has started conversing.

## Implementation

Use one assistant-message renderer in both saved and streaming paths. Use [react-markdown](https://github.com/remarkjs/react-markdown) with [remark-gfm](https://github.com/remarkjs/remark-gfm) for paragraphs, emphasis, headings, links, lists, quotes, inline and fenced code, tables, task lists and strikethrough. These packages support CommonMark and GitHub-flavored Markdown without injecting raw HTML. Keep their default URL handling and omit raw HTML execution.

Scope Markdown styles to assistant messages. Use normal paragraph whitespace, a compact gap between paragraphs and readable line height. Keep user messages as plain text with their intentional line breaks. Let wide code blocks and tables scroll within the message width. Preserve scroll anchoring while streamed content changes height.

Remove the pending delivery label and its unused CSS. Use normal message opacity so submission looks like the message the user sent. Keep pending IDs, saved-state reconciliation, retry behavior and the thinking orb intact.

Move the existing GmailConnection instance, with its conversation key and callbacks, into the composer area immediately above the form. Preserve popup cleanup, account reset isolation, connection notices and control ownership. Check the details popover on narrow and short viewports.

Derive the placeholder from pending and saved conversation content rather than a component-local flag, so refreshes and later visits apply the same rule. Preserve the accessible "Message Persona" label when the placeholder is empty. A fresh conversation restores the initial hint.

## Gmail branding sources

The user requested authentic Gmail branding, including its icon and font. The implementation bundles the unmodified [Gmail 2026 SVG](https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web/192px.svg) used by Google's Gmail product page. Google [announced refreshed Workspace icons in May 2026](https://workspaceupdates.googleblog.com/2026/05/introducing-fresh-visual-identity-for-Google-Workspace-app-icons.html). Google [documents Google Sans use in Gmail and its public font release](https://design.google/library/google-sans-flex-font); its [official font repository](https://github.com/googlefonts/googlesans) supplies the font and license. The font is self-hosted through Next's local font loader. Source attribution and the font license accompany the assets. The rest of Persona keeps its existing typography and colors.

## Verification

- Check Markdown semantics and paragraph spacing for the call-invitation example, lists, links, code and tables, including streaming and its transition to the saved reply.
- Confirm the circular arrow has no visible text and still jumps to the newest message without stealing the user's reading position during polling.
- Confirm healthy pending messages contain only user text, while failed or disconnected requests retain working retry controls.
- Confirm exactly one Gmail control appears above the composer across successive replies, with no Gmail control inside the transcript. Retain account reset and stale callback coverage.
- Check placeholder behavior before the agreed cutoff, during a pending send, after saving, after refresh and after a fresh conversation.
- Check narrow/mobile and short-height layouts, including visible Gmail details, notices and an expanded draft. Run the existing conversation, streaming, introduction, voice and Gmail tests plus lint, type checking and a production build.

## Verification results

- All 40 browser checks passed, including streamed Markdown before completion, message retries, the thinking orb, Gmail account reset isolation and voice behavior.
- All 19 frontend unit tests, type checking and lint passed.
- The production build passed with `BACKEND_URL=http://localhost:3001 npm run build -- --webpack`. A production screenshot with sample messages confirmed the final appearance.
- Desktop Markdown and Gmail layouts at 375x740 and 375x350 were visually inspected. Paragraph gaps stay below 15 pixels, wide code blocks scroll within the message, and Gmail details fit the viewport.

## Domain documentation

The existing definitions of conversation and Gmail connection still apply. "Placeholder" names the input hint; it is a general UI term, so it does not belong in the domain glossary. These presentation choices are easy to reverse and do not warrant an ADR. The accepted behavior is recorded here and in the conversation-introduction document.
