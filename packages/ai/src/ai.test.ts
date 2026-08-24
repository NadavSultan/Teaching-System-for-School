import { expect, it } from 'vitest';
import { DeterministicFakeModelGateway } from './index.js';

it('returns deterministic fake model responses without network access', async () => {
  const gateway = new DeterministicFakeModelGateway();
  const request = {
    operationId: 'same',
    idempotencyKey: 'same',
    operation: 'DRAFT' as const,
    promptTemplateVersion: 'draft-v1',
    promptTemplateHash: 'hash',
    modelConfigurationVersion: 'fake-v1',
    modelConfigurationHash: 'hash',
    responseSchemaVersion: '1.0.0',
    responseSchemaHash: 'hash',
    input: {
      specification: {
        sections: [
          {
            key: 's1',
            order: 1,
            questions: [{ key: 'q1', order: 1, type: 'OPEN', difficulty: 'LOW', scoreUnits: null }],
          },
        ],
      },
      context: [],
    },
  };
  expect(await gateway.execute(request)).toEqual(await gateway.execute(request));
});
