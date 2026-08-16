import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.js';

const originalEnvironment = process.env.NODE_ENV;
const originalAdapter = process.env.AUTH_ADAPTER;
afterEach(() => {
  process.env.NODE_ENV = originalEnvironment;
  process.env.AUTH_ADAPTER = originalAdapter;
});

describe('authentication configuration', () => {
  it('fails closed when development authentication is configured in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_ADAPTER = 'development';
    expect(() => new AuthService()).toThrow('Production requires');
  });
  it('does not pretend an unimplemented managed adapter is available', () => {
    process.env.NODE_ENV = 'production';
    process.env.AUTH_ADAPTER = 'managed';
    expect(() => new AuthService()).toThrow('not implemented');
  });
});
