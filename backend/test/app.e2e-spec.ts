import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { getCorsOptions } from './../src/cors.config.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    vi.stubEnv('FRONTEND_URL', 'https://frontend.example.com');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.enableCors(getCorsOptions());
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('allows browser requests from the configured frontend', () => {
    return request(app.getHttpServer())
      .get('/')
      .set('Origin', 'https://frontend.example.com')
      .expect('Access-Control-Allow-Origin', 'https://frontend.example.com')
      .expect(200)
      .expect('Hello World!');
  });

  it('does not grant CORS access to other origins', async () => {
    const response = await request(app.getHttpServer())
      .get('/')
      .set('Origin', 'https://other.example.com')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('handles preflight requests for the configured frontend', () => {
    return request(app.getHttpServer())
      .options('/')
      .set('Origin', 'https://frontend.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type')
      .expect(204)
      .expect('Access-Control-Allow-Origin', 'https://frontend.example.com')
      .expect('Access-Control-Allow-Methods', /POST/)
      .expect('Access-Control-Allow-Headers', /content-type/i);
  });

  it('does not grant preflight access to other origins', async () => {
    const response = await request(app.getHttpServer())
      .options('/')
      .set('Origin', 'https://other.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
});
