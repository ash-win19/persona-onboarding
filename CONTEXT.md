# Persona onboarding

The conversation in which a person names their assistant, introduces themselves, connects Gmail and describes something they need help with.

## Language

**Agent**:
The personal assistant that the user names and talks to during onboarding.
_Avoid_: User, customer

**User**:
The person introducing themselves and asking the agent for help.
_Avoid_: Agent

**Help request**:
A task or problem the user asks the agent to help with.
_Avoid_: Support ticket

**Conversation**:
The ongoing exchange between a user and their agent, which can continue through text, voice and later visits.
_Avoid_: Call, onboarding step

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
One of the four things onboarding attempts to obtain: an agent name, a user name, a Gmail connection or a help request. A goal may remain unmet when the user begins receiving help.
_Avoid_: Required step

**Graduation**:
The point at which the agent starts helping with an actionable help request. Graduation does not mean every onboarding goal is complete.
_Avoid_: Onboarding completion

**Onboarding completion**:
The state in which the agent name, user name and help request are known and Gmail access is confirmed.
_Avoid_: Graduation

**Gmail connection**:
The user's authorization for the agent to access their Gmail account, with access confirmed. Knowing an email address or linking a Google identity alone is not a Gmail connection.
_Avoid_: Google sign-in, email address

**Refusal**:
A user's decision not to fulfill an onboarding goal or accept a call invitation. The agent does not bring up that declined request again unless the user reopens it.
_Avoid_: Deferral, unanswered question

**Deferral**:
A user's decision to postpone an onboarding request beyond the current visit.
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
