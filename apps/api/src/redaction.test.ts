import { expect, it } from 'vitest';
import { redact } from './redaction.js';

it('redacts credentials and request bodies recursively', () => {
  const text = JSON.stringify(
    redact({
      headers: { authorization: 'Bearer secret', cookie: 'session=x' },
      body: { private: true },
      safe: 'ok',
    }),
  );
  expect(text).not.toContain('Bearer secret');
  expect(text).not.toContain('session=x');
  expect(text).not.toContain('private');
  expect(text).toContain('ok');
});
