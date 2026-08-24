import { describe, expect, it } from 'vitest';
import {
  eligibleKnowledgeItemSchema,
  ingestionRequestSchema,
  retrievalRequestSchema,
  sourceCreationSchema,
  sourceVersionRegistrationSchema,
} from './index.js';

describe('Phase 30 contracts', () => {
  it('rejects trusted lifecycle, tenant, hash, and reviewer fields', () => {
    expect(() =>
      sourceCreationSchema.parse({
        version: '1.0.0',
        title: 'x',
        visibility: 'ORGANIZATION_PRIVATE',
        origin: 'fixture',
        organizationId: crypto.randomUUID(),
        lifecycle: 'ACTIVE',
      }),
    ).toThrow();
    expect(() =>
      sourceVersionRegistrationSchema.parse({
        version: '1.0.0',
        sourceId: crypto.randomUUID(),
        idempotencyKey: 'k',
        content: 'שלום',
        contentReference: 'fixture://one',
        contentMimeType: 'text/plain',
        curriculumVersionId: crypto.randomUUID(),
        curriculumNodeIds: [crypto.randomUUID()],
        contentHash: 'bad',
      }),
    ).toThrow();
  });
  it('bounds retrieval and ingestion requests without relaxing empty-query eligibility', () => {
    expect(
      retrievalRequestSchema.parse({
        version: '1.0.0',
        query: '',
        organizationId: crypto.randomUUID(),
        curriculumVersionId: crypto.randomUUID(),
        curriculumNodeIds: [],
        limit: 20,
      }).query,
    ).toBe('');
    expect(
      ingestionRequestSchema.parse({
        version: '1.0.0',
        sourceVersionId: crypto.randomUUID(),
        pipelineVersion: 'plain-v1',
      }).pipelineVersion,
    ).toBe('plain-v1');
    expect(() =>
      retrievalRequestSchema.parse({
        version: '1.0.0',
        query: 'x',
        organizationId: crypto.randomUUID(),
        curriculumVersionId: crypto.randomUUID(),
        curriculumNodeIds: [],
        limit: 51,
      }),
    ).toThrow();
  });
  it('rejects unknown persisted response fields at the mapping boundary', () => {
    expect(() =>
      eligibleKnowledgeItemSchema.parse({
        version: '1.0.0',
        id: crypto.randomUUID(),
        sourceVersionId: crypto.randomUUID(),
        locator: 'p:1',
        textHash: 'a'.repeat(64),
        metadata: {},
        score: 0,
        rank: 1,
        curriculumVersionId: crypto.randomUUID(),
        curriculumNodeId: crypto.randomUUID(),
        visibility: 'PLATFORM_SHARED',
        leakedText: 'no',
      }),
    ).toThrow();
  });
});
