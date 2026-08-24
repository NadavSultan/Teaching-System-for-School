import { describe, expect, it } from 'vitest';
import {
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
});
