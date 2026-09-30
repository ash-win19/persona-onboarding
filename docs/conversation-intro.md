# Persona starts the conversation

The approved design keeps the existing chat shell and composer. Once saved history loads, a new conversation's hero moves upward and fades into Persona's first message over about 450 milliseconds. The saved opening is "Hi there! I'm your new assistant, and I don't have a name yet. What would you like to call me?" There is no extra setup page or name field. Starting with a task remains supported.

Typing or starting a call ends the animation immediately without remounting the composer or discarding a draft. Reduced motion bypasses the transition. Opening history shows a quiet loading state; returning users never briefly see a new-user hero. The server claims the introduction once per conversation, including across tabs and sign-ins. Existing untouched conversations receive the same opening; conversations with history retain their transcript.

Start a call stays available beside the composer. After the browser connection is ready, Persona speaks first using confirmed context. It picks up the next onboarding step, including the assistant's name, or continues an existing task. Starting a call never requires a name first. Existing refusal, deferral, interruption and hangup behavior still applies.

One Gmail control sits directly above the composer, outside the transcript. It appears after Gmail is introduced in the conversation, or when an existing connection needs attention. Its action uses the official Gmail icon and Google Sans. The initial input hint disappears after the first pending or saved user message, typed or spoken, and stays blank when that conversation is restored. Its consent explanation remains accurate for the trial's metadata permission and account-address verification.

Verification covers opening persistence and duplicate prevention, restoring history, typing during the transition, reduced motion, contextual Gmail, and initiating/interruption of a voice opening. Existing account isolation, text, call, Gmail and reset checks remain required.
