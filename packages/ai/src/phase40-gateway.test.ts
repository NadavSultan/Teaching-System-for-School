import { describe, expect, it } from 'vitest';
import { DeterministicFakeModelGateway, GatewayFailure, liveEvaluationPreflight } from './index.js';

const request = (operationId: string) => ({
  operationId,
  idempotencyKey: operationId,
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
    context: [{ knowledgeItemId: '00000000-0000-4000-8000-000000000001' }],
  },
});

describe('Phase 40 deterministic gateway outcomes', () => {
  it('covers the ten required injected outcome classes', async () => {
    const outcomes = [
      'valid-draft',
      'valid-regeneration',
      'malformed',
      'schema-violation',
      'timeout',
      'rate-limit',
      'transient',
      'permanent',
      'over-budget',
      'replay',
    ] as const;
    for (const outcome of outcomes) {
      const gateway = new DeterministicFakeModelGateway({ [outcome]: outcome });
      if (['timeout', 'rate-limit', 'transient', 'permanent'].includes(outcome)) {
        await expect(gateway.execute(request(outcome))).rejects.toBeInstanceOf(GatewayFailure);
      } else {
        const response = await gateway.execute(request(outcome));
        expect(response.requestId).toBe(`fake:${outcome}`);
        expect(response.usage.totalTokens).toBeGreaterThanOrEqual(0);
      }
    }
    expect(outcomes).toHaveLength(10);
  });

  it('fails closed for live evaluation by default', () => {
    expect(liveEvaluationPreflight()).toEqual({
      enabled: false,
      reason: 'LIVE_PROVIDER_EVALUATION_REQUIRES_OWNER_APPROVAL_AND_SEPARATE_ADAPTER',
    });
  });
});
