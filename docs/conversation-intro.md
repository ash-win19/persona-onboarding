# Persona starts the conversation

The approved design keeps the existing chat shell and composer. Once saved history loads, a new conversation's hero moves upward and fades into Persona's first message over about 450 milliseconds. The saved opening is "Hi, I'm Persona. What would you like to call me?" There is no extra setup page or name field. Starting with a task remains supported.

Typing or starting a call ends the animation immediately without remounting the composer or discarding a draft. Reduced motion bypasses the transition. Opening history shows a quiet loading state; returning users never briefly see a new-user hero. The server claims the introduction once per conversation, including across tabs and sign-ins. Existing untouched conversations receive the same opening; conversations with history retain their transcript.

Start a call stays available beside the composer. After the browser connection is ready, Persona speaks first using confirmed context. It asks for the user's name when appropriate or continues an existing task. Assistant naming is never required to start a call and stays outside voice. Existing refusal, deferral, interruption and hangup behavior still applies.

Gmail appears in context after it is introduced in the conversation, or when an existing connection needs attention. Its consent explanation remains accurate for the trial's metadata permission and account-address verification.

Verification covers opening persistence and duplicate prevention, restoring history, typing during the transition, reduced motion, contextual Gmail, and initiating/interruption of a voice opening. Existing account isolation, text, call, Gmail and reset checks remain required.
