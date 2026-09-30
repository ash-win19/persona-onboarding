import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

export const CALENDAR_SCOPE =
  'https://www.googleapis.com/auth/calendar.events.owned';
export type GoogleTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  idToken?: string;
};
export type CalendarEvent = {
  id: string;
  etag: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  htmlLink?: string;
  attendees?: { email: string; responseStatus?: string }[];
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
  conferenceData?: {
    createRequest?: { requestId?: string; status?: { statusCode: string } };
    entryPoints?: { entryPointType: string; uri: string }[];
  };
};
export class CalendarError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
    readonly retryAfter = 0,
  ) {
    super(code);
  }
}

@Injectable()
export class CalendarProvider {
  private readonly clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  private readonly secret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  private readonly redirect = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? '';
  available() {
    return !!(this.clientId && this.secret && this.redirect);
  }
  authorize(state: string, challenge: string, nonce: string) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirect,
      response_type: 'code',
      scope: 'openid email ' + CALENDAR_SCOPE,
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.href;
  }
  private async token(values: Record<string, string>): Promise<GoogleTokens> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.secret,
        ...values,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      id_token?: string;
      error?: string;
    };
    if (data.error === 'invalid_grant')
      throw new CalendarError('RECONNECT_REQUIRED', 401);
    if (!response.ok || !data.access_token || !data.expires_in)
      throw new CalendarError('TOKEN_UNAVAILABLE', response.status);
    const scope =
      data.scope ??
      (values.grant_type === 'refresh_token' ? CALENDAR_SCOPE : '');
    if (!scope.split(' ').includes(CALENDAR_SCOPE))
      throw new CalendarError('RECONNECT_REQUIRED', 403);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      scope,
      idToken: data.id_token,
    };
  }
  exchange(code: string, verifier: string) {
    return this.token({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: this.redirect,
    });
  }
  refresh(refreshToken: string) {
    return this.token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }
  async identity(idToken: string) {
    const ticket = await new OAuth2Client(this.clientId).verifyIdToken({
      idToken,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || !payload.email_verified)
      throw new CalendarError('IDENTITY_INVALID');
    return {
      subject: payload.sub,
      email: payload.email,
      nonce: (payload as typeof payload & { nonce?: string }).nonce,
    };
  }
  async request<T>(
    token: string,
    path: string,
    method = 'GET',
    body?: unknown,
    etag?: string,
  ): Promise<T> {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/' + path,
      {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
          ...(etag ? { 'If-Match': etag } : {}),
        },
        ...(body === undefined || method === 'GET'
          ? {}
          : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: { errors?: { reason?: string }[] };
      };
      const reason = data.error?.errors?.[0]?.reason;
      const code =
        response.status === 401 || reason === 'insufficientPermissions'
          ? 'RECONNECT_REQUIRED'
          : response.status === 429 ||
              reason === 'rateLimitExceeded' ||
              reason === 'userRateLimitExceeded'
            ? 'RATE_LIMIT'
            : response.status === 404
              ? 'EVENT_NOT_FOUND'
              : response.status === 409
                ? 'EVENT_EXISTS'
                : response.status === 412
                  ? 'EVENT_CHANGED'
                  : response.status >= 500
                    ? 'GOOGLE_UNAVAILABLE'
                    : 'CALENDAR_REJECTED';
      throw new CalendarError(
        code,
        response.status,
        Number(response.headers.get('retry-after')) || 0,
      );
    }
    return (await response.json()) as T;
  }
  verifyAccess(token: string) {
    return this.request(token, 'events?maxResults=1&fields=kind');
  }
  getEvent(token: string, id: string) {
    return this.request<CalendarEvent>(
      token,
      'events/' + encodeURIComponent(id),
    );
  }
  insertEvent(token: string, body: unknown) {
    return this.request<CalendarEvent>(
      token,
      'events?conferenceDataVersion=1&sendUpdates=none',
      'POST',
      body,
    );
  }
  invite(token: string, event: CalendarEvent, body: unknown) {
    return this.request<CalendarEvent>(
      token,
      'events/' +
        encodeURIComponent(event.id) +
        '?conferenceDataVersion=1&sendUpdates=all',
      'PUT',
      body,
      event.etag,
    );
  }
}
