import { getCorsOptions } from './cors.config.js';

describe('CORS configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows localhost for local development without configuration', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('FRONTEND_URL', undefined);

    expect(getCorsOptions()).toEqual({ origin: ['http://localhost:3000'] });
  });

  it('requires an explicit frontend origin in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FRONTEND_URL', undefined);

    expect(getCorsOptions).toThrow('FRONTEND_URL must be set in production.');
  });

  it('normalizes a trailing slash to a browser origin', () => {
    vi.stubEnv('FRONTEND_URL', 'https://frontend.example.com/');

    expect(getCorsOptions()).toEqual({
      origin: ['https://frontend.example.com'],
    });
  });

  it.each([
    '*',
    'https://frontend.example.com/onboarding',
    'https://frontend.example.com?query=value',
    'https://frontend.example.com#fragment',
    'https://user:password@frontend.example.com',
    'file:///tmp/frontend',
  ])('rejects an invalid frontend origin: %s', (origin) => {
    vi.stubEnv('FRONTEND_URL', origin);

    expect(getCorsOptions).toThrow();
  });
});
