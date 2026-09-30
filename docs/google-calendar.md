# Google Meet scheduling

Persona can create a Google Meet on the connected Google account's primary calendar and ask Calendar to email its standard invitation. The meeting card shows the real Calendar and Meet links. Scheduling works in daily text chats and the original conversation's text/voice experience after onboarding.

## Enable the integration

Use the same Google OAuth web client already configured for Gmail. Enable **Google Calendar API** in that client's Google Cloud project. Add the Calendar callback to the client's authorized redirect URIs:

```text
https://usepersona.vercel.app/api/calendar/callback
```

Set these backend environment variables:

```text
CALENDAR_SCHEDULING_ENABLED=true
GOOGLE_CALENDAR_REDIRECT_URI=https://usepersona.vercel.app/api/calendar/callback
```

Keep the existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and stable `GMAIL_TOKEN_KEY`. The feature uses the same encryption format as Gmail but stores its own credentials. For local development, register and configure `http://localhost:3000/api/calendar/callback` instead. The frontend proxies this callback to the backend.

The OAuth request uses `openid`, `email`, and `https://www.googleapis.com/auth/calendar.events.owned`. Add the Calendar scope to the project's consent configuration. If the project is in testing, allowlist the organizer as a test user. Use an account whose Google/Workspace policy permits Meet creation. No Gmail send permission or separate Meet REST API is required. See [Google Calendar authorization](https://developers.google.com/workspace/calendar/api/auth) and [conference creation](https://developers.google.com/workspace/calendar/api/guides/create-events).

Restart the backend after changing configuration. Startup applies additive migrations. Connect Calendar through **Settings → Integrations** or the connection control in a conversation. Google may ask for consent again because Gmail's existing grant does not include Calendar.

## Demo

Use a recipient inbox you control. After onboarding, ask:

> Schedule a 30-minute Google Meet with alex@example.com tomorrow at 3 PM Pacific, titled "Persona demo", and email the invitation.

Replace the address with your actual demo recipient. If Calendar is not connected, Persona saves the request and shows Connect Google Calendar. The current controlling tab continues the saved request after consent. The OAuth callback itself performs no scheduling.

Watch the meeting card change from scheduling to scheduled. Open the event, open its Meet link, then inspect the recipient's invitation and RSVP controls. Calendar accepting the notification request does not prove inbox delivery; verify that last step in the recipient account.

## Implementation

- `CalendarProvider` performs Google OAuth and Calendar requests. `Calendar` verifies Google identity, stores encrypted grants, and serializes token refreshes.
- `MeetingAssistant` handles scheduling dialogue in text. Voice exposes the same prepare, execute, and status tools through the backend sideband connection. Both call `Meetings`; onboarding cannot execute these tools.
- `calendar_attempts` and `calendar_connections` isolate Calendar from Gmail. `meeting_requests` combines the draft, frozen operation, lease, and reconciliation record in one row, with a revision and unique originating request key.
- The runner creates an organizer-only event with a stable event ID, waits for the Meet conference, then uses an ETag-conditional update to add attendees with `sendUpdates=all`. An operation marker written with that update allows recovery after a lost response without a second invitation mutation.
- PostgreSQL stores progress. The runner recovers expired leases after a restart and continues accepted requests independently of chat generation or audio playback. Hosting suspension can delay work until the backend wakes.
- Invalid or ambiguous dates, DST transitions, missing attendee addresses, expired times, and stale tool invocations are rejected before execution. The default duration is 30 minutes. Browser timezone is a fallback; an explicit timezone in the request takes precedence.
- The UI polls for authoritative results. A failed assistant reply does not erase or rerun an accepted meeting. Recovery reuses its provider event ID. Stop tracking ends local recovery and leaves any Google event/invitations in place.
- Reset and fresh-start cannot erase a running or unresolved external action. Resolve it or use Stop tracking first. Deleting Persona's conversation never cancels meetings in Google Calendar.

The feature defaults to disabled. Turning the flag off stops new scheduling, while the runner can finish and reconcile already accepted operations. Keep the credentials and operation records during rollback.

## Version-one limits

The user supplies the time and recipient email addresses. There is no availability search, contact lookup, recurring meeting, rescheduling, cancellation, separate Gmail message, or delivery/RSVP tracking. Manage created events in Google Calendar. Up to ten recipients are supported, with a duration from five minutes to eight hours.

## Validation for this change

Backend/frontend type checks, lint, and production builds; the existing Gmail integration checks; a local scheduling smoke check with temporary PostgreSQL and a fake Google provider covering delayed conference creation, lost invitation response, repeat execution, and ambiguous DST times. Real Google consent, conference creation, and recipient delivery require the configured accounts above and are not established by the local smoke check.

Browser verification also exercised the actual NestJS and Next.js applications with the configured OpenAI model, an isolated PostgreSQL database, and a simulated Google provider. The demo prompt saved September 30, 2026 at 3 PM Pacific while the UTC date was already September 30, resumed after simulated consent, and rendered the event and Meet links. Refresh preserved the result with exactly one event creation and one invitation request. Desktop and 390-pixel mobile views rendered without horizontal overflow or JavaScript errors. A capability question created no meeting; a missing recipient prompted a question, and the follow-up address completed the existing request with the correct local date and default duration.

That verification found and fixed two model-instruction issues: requests must be saved before asking for Calendar connection, and relative dates need the server-computed local reference clock instead of only a UTC timestamp. Text and voice now receive the same reference-clock format. Real Google consent, inbox delivery, and a live voice scheduling session remain unverified.
