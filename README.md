# persona-onboarding

A conversational onboarding experience for Persona, the personal AI assistant.

The onboarding collects four things (a name for the assistant, the user's name, a connected Gmail account, and something the user wants help with) through an iMessage-style text thread and an in-browser simulated voice call. It is built to stay conversational, recover from user errors such as call hangups, and let users who already know what they need move into the main experience early.

## Structure

- `frontend/`: the web app (landing page, text thread, and voice call simulator).
- `backend/`: the onboarding brain (session state, conversation controller, voice and Gmail integrations).
