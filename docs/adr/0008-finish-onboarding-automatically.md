# Finish onboarding automatically once the details are in

Onboarding felt like a form: every reply was a fixed server string, a call invitation interrupted the flow, and a starter plan had to be approved with an exact "yes" before the dashboard opened. The user restated the purpose. Onboarding only gets to know the person, by collecting a name for the assistant, their name, a Google connection and their first task, and then hands off to the app, where the work happens.

Onboarding now finishes by itself in the same commit that saves the last missing detail. Required details are the assistant name, the user name, verified Gmail, verified Google Calendar when the server can connect it, and the tasks or an explicit "nothing yet". The saved task list is accepted automatically and still appears on the dashboard. There is no plan review, no approval step and no call invitation; Start a call stays available.

The server still owns what is saved and which step comes next. The model now writes every onboarding reply, in text and voice, from one short guide prompt that receives the saved status and that step. The guide keeps steering toward missing details instead of offering each one once per visit, while declined and postponed steps are left alone.

This supersedes the plan-acceptance requirement in ADR 0007. The Gmail requirement stays; Calendar is added when it is available. The trade-off is that users no longer review a plan before entering the dashboard, and a user who cannot complete Google consent still cannot finish.
