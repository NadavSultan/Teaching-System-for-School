import { expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from './index.js';

it('returns deterministic fake model responses without network access', async () => {
  const gateway = new DeterministicFakeModelGateway();
  expect(await gateway.execute({ operationId: 'same', input: {} })).toEqual(
    await gateway.execute({ operationId: 'same', input: {} }),
  );
});
