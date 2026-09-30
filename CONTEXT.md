# Persona

Personal intelligence that helps a person turn their intentions into useful daily work.

## Language

**Agent**:
The personal assistant that the user names and talks to during onboarding.
_Avoid_: User, customer

**Onboarding agent**:
The assistant role that gets to know a new user: it collects the onboarding goals, then hands off to the main experience. Substantive task work belongs to the main experience.
_Avoid_: General-purpose assistant

**User**:
The person introducing themselves and asking the agent for help.
_Avoid_: Agent

**Help request**:
A task or problem the user asks the agent to help with.
_Avoid_: Support ticket

**First task**:
The concrete outcome the user wants Persona to help with first, together with only the context needed to understand it. Identifying the first task does not require a broader profile of the user's work, routines or preferences.
_Avoid_: User profile

**Onboarding scratchpad**:
The visible summary of onboarding details accepted from the conversation, including the assistant name, user name, Gmail and Calendar connections and task choice. Its progress marks distinguish saved details from information still needed.
_Avoid_: Private reasoning, conversation transcript

**Task choice**:
The tasks the user wants help with, or their explicit decision that they have no tasks yet. An unanswered question is not a no-task choice.
_Avoid_: Required task

**Starter plan**:
The ordered list of the user's saved tasks, accepted automatically when onboarding finishes and shown on the dashboard. The user does not review or approve it.
_Avoid_: Completed task, general capabilities menu

**Main experience**:
The workspace where a person manages priorities and starts daily conversations with their assistant. It carries forward their accepted onboarding details.
_Avoid_: Onboarding

**Onboarding conversation**:
The initial exchange in which a person introduces themselves and their first task. It remains available as a separate conversation after graduation.
_Avoid_: Daily conversation

**Daily conversation**:
A separate exchange about an activity, task, plan or question. A new chat starts with no messages while retaining the person's accepted profile details.
_Avoid_: Onboarding, call

**Priority**:
An intention the person saves to work on, which they can mark complete or reopen. A completed priority records the person's choice, not an action performed by the assistant.
_Avoid_: Automation, reminder

**Integration**:
An external service a person connects to Persona. Connection status does not imply support for every action offered by that service.
_Avoid_: Connection page

**Call**:
A live voice exchange within a conversation, during which the user can interrupt the agent.
_Avoid_: Conversation, voice message

**Listening**:
The call is ready for the user's speech, including quiet moments when the agent is waiting for the user.
_Avoid_: User speaking, call connected

**Thinking**:
The agent is preparing a reply to the current exchange.
_Avoid_: Connecting, retrying

**Speaking**:
The agent's voice reply is playing for the user during a call.
_Avoid_: Reply generated, call active

**Onboarding goal**:
One of the details collected before a new user enters the dashboard: an assistant name, a user name, a verified Google connection (Gmail, plus Calendar when the server can connect it) or a task choice.
_Avoid_: Delivered invitation

**Graduation**:
The transition from onboarding into the main experience. It happens automatically in the same commit that establishes the last onboarding goal.
_Avoid_: Invitation delivered, setup attempted

**Onboarding completion**:
The state in which the assistant name, user name and task choice are known and the Google connection is confirmed.
_Avoid_: All questions asked

**Save and exit**:
Leaving unfinished onboarding with accepted details preserved for the next visit. It does not complete onboarding or provide dashboard access.
_Avoid_: Skip setup, graduation

**Gmail connection**:
The user's authorization for the agent to access their Gmail account, with access confirmed. Knowing an email address or linking a Google identity alone is not a Gmail connection.
_Avoid_: Google sign-in, email address

**Refusal**:
A user's decision not to fulfill an onboarding goal or accept a call invitation. The agent does not bring up that declined request again unless the user reopens it.
_Avoid_: Deferral, unanswered question

**Deferral**:
A user's decision to postpone an onboarding request until a later visit. The request may be offered once in a later visit when relevant.
_Avoid_: Refusal

**Visit**:
A period of user activity within a conversation. A later interaction begins a new visit after 30 minutes without user activity and with no active call; refreshes and Gmail redirects do not start a new visit by themselves.
_Avoid_: Call, conversation

**Control owner**:
The browser tab currently allowed to direct a conversation. Other tabs can display the conversation without directing it.
_Avoid_: User, agent

**Takeover**:
An explicit transfer of conversation control to another tab that ends the previous tab's call.
_Avoid_: Refresh, reconnect
