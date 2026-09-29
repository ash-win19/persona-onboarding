export const GMAIL_PROVIDER = Symbol('GMAIL_PROVIDER');
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
export type Tokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
};
export class GmailAuthorizationError extends Error {}
export interface GmailProvider {
  available(): boolean;
  authorize(state: string, challenge: string): string;
  exchange(code: string, verifier: string): Promise<Tokens>;
  refresh(token: string): Promise<Tokens>;
  profile(token: string): Promise<string>;
}
export class GoogleGmailProvider implements GmailProvider {
  constructor(
    private readonly clientId: string,
    private readonly secret: string,
    private readonly redirect: string,
  ) {}
  available() {
    return !!this.clientId && !!this.secret && !!this.redirect;
  }
  authorize(state: string, challenge: string) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirect,
      response_type: 'code',
      scope: GMAIL_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.href;
  }
  private async token(values: Record<string, string>): Promise<Tokens> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.secret,
        ...values,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
    };
    if (data.error === 'invalid_grant' || response.status === 401)
      throw new GmailAuthorizationError('AUTHORIZATION_INVALID');
    if (!response.ok || !data.access_token || !Number.isFinite(data.expires_in))
      throw new Error('GMAIL_TOKEN_UNAVAILABLE');
    const scope =
      data.scope ?? (values.grant_type === 'refresh_token' ? GMAIL_SCOPE : '');
    if (!scope.split(' ').includes(GMAIL_SCOPE))
      throw new GmailAuthorizationError('SCOPE_MISSING');
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in! * 1000,
      scope,
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
  refresh(token: string) {
    return this.token({ grant_type: 'refresh_token', refresh_token: token });
  }
  async profile(token: string) {
    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress',
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (response.status === 401)
      throw new GmailAuthorizationError('AUTHORIZATION_INVALID');
    if (response.status === 403) {
      const data = (await response.json()) as {
        error?: { errors?: { reason?: string }[] };
      };
      if (
        data.error?.errors?.some((error) =>
          ['authError', 'insufficientPermissions', 'domainPolicy'].includes(
            error.reason ?? '',
          ),
        )
      )
        throw new GmailAuthorizationError('AUTHORIZATION_INVALID');
      throw new Error('GMAIL_PROFILE_UNAVAILABLE');
    }
    if (!response.ok) throw new Error('GMAIL_PROFILE_UNAVAILABLE');
    const data = (await response.json()) as { emailAddress?: unknown };
    if (
      typeof data.emailAddress !== 'string' ||
      !data.emailAddress.includes('@') ||
      data.emailAddress.length > 320
    )
      throw new Error('GMAIL_PROFILE_INVALID');
    return data.emailAddress;
  }
}
