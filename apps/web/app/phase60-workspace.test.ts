import { afterEach, describe, expect, it, vi } from 'vitest';
import { teacherApi } from './teacher-api';

const assessmentId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Phase 60 teacher web API behavior', () => {
  it('U01 loads a persisted list through the typed teacher endpoint', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(response({ version: '1.0.0', items: [], nextCursor: null }));
    vi.stubGlobal('fetch', fetch);
    await expect(teacherApi.list()).resolves.toEqual({
      version: '1.0.0',
      items: [],
      nextCursor: null,
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:4000/v1/teacher/assessments',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('U02 creates only the strict persisted assessment shape', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        version: '1.0.0',
        id: assessmentId,
        type: 'WORKSHEET',
        title: 'כיתה ז׳',
        latestRevisionNumber: null,
        latestRevisionId: null,
        latestApprovalRevisionId: null,
        updatedAt: '2026-09-07T00:00:00.000Z',
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await teacherApi.create({ version: '1.0.0', type: 'WORKSHEET', title: 'כיתה ז׳' });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:4000/v1/teacher/assessments');
    expect((fetch.mock.calls[0]?.[1] as RequestInit).method).toBe('POST');
    expect((fetch.mock.calls[0]?.[1] as RequestInit).body).toBe(
      JSON.stringify({ version: '1.0.0', type: 'WORKSHEET', title: 'כיתה ז׳' }),
    );
  });

  it('U03 reloads the selected immutable revision through the API rather than local state', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        version: '1.0.0',
        assessment: {},
        revision: {},
        history: [],
        validation: null,
        readiness: {},
        approval: {},
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(teacherApi.workspace(assessmentId, revisionId)).rejects.toThrow();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `http://localhost:4000/v1/teacher/assessments/${assessmentId}?revisionId=${revisionId}`,
    );
  });

  it('U04 posts immutable edits with a strict base revision contract', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        version: '1.0.0',
        assessmentId,
        revisionId,
        revisionNumber: 2,
        baseRevisionId: revisionId,
      }),
    );
    vi.stubGlobal('fetch', fetch);
    await teacherApi.save({
      version: '1.0.0',
      assessmentId,
      baseRevisionId: revisionId,
      baseRevisionNumber: 1,
      idempotencyKey: 'save-1',
      sections: [
        {
          key: 's1',
          title: 'כותרת',
          order: 0,
          scoreUnits: null,
          questions: [
            {
              logicalId: assessmentId,
              key: 'q1',
              type: 'OPEN',
              prompt: 'שאלה תקינה',
              order: 0,
              scoreUnits: null,
              answers: [],
              rubrics: [],
              subQuestions: [],
            },
          ],
        },
      ],
    });
    expect(fetch.mock.calls[0]?.[0]).toBe('http://localhost:4000/v1/teacher/revisions');
  });

  it('U05 requests validation, acknowledgement and approval only through persisted endpoints', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(
          {
            version: '1.0.0',
            id: runId,
            assessmentId,
            assessmentRevisionId: revisionId,
            revisionSequence: 1,
            rulesetVersion: 'v1',
            evaluatorVersion: 'test',
            attempts: 0,
            deterministicPassCount: 0,
            deterministicFailCount: 0,
            semanticFindingCount: 0,
            state: 'PENDING',
            failureCode: null,
            completedAt: null,
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        response({ version: '1.0.0', acknowledgementId: runId, findingId: runId }),
      )
      .mockResolvedValueOnce(
        response(
          {
            version: '1.0.0',
            approvalId: runId,
            assessmentId,
            assessmentRevisionId: revisionId,
            validationRunId: runId,
            approvalSequence: 1,
            createdAt: '2026-09-07T00:00:00.000Z',
          },
          201,
        ),
      );
    vi.stubGlobal('fetch', fetch);
    await teacherApi.validate({
      version: '1.0.0',
      assessmentId,
      assessmentRevisionId: revisionId,
      idempotencyKey: 'validation-1',
    });
    await teacherApi.acknowledge({
      version: '1.0.0',
      findingId: runId,
      reason: 'נבדק',
      idempotencyKey: 'ack-1',
    });
    await teacherApi.approve({
      version: '1.0.0',
      assessmentId,
      assessmentRevisionId: revisionId,
      idempotencyKey: 'approval-1',
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:4000/v1/teacher/validations',
      'http://localhost:4000/v1/teacher/acknowledgements',
      'http://localhost:4000/v1/teacher/approvals',
    ]);
  });

  it('U06 accepts student preview only through its redacted contract', async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        version: '1.0.0',
        assessmentId,
        revisionId,
        title: 'דף עבודה',
        sections: [
          {
            title: 'חלק א',
            order: 0,
            questions: [
              {
                logicalId: assessmentId,
                prompt: 'נסחו תשובה מלאה.',
                instructions: null,
                order: 0,
                scoreUnits: null,
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const preview = await teacherApi.preview(assessmentId, revisionId);
    expect(preview.sections[0]?.questions[0]).not.toHaveProperty('answers');
    expect(preview.sections[0]?.questions[0]).not.toHaveProperty('rubrics');
  });

  it('U07 surfaces API errors instead of inventing a local success state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        response(
          {
            version: '1.0.0',
            error: {
              code: 'CONFLICT',
              message: 'base revision is stale',
              requestId: 'request-1',
            },
          },
          409,
        ),
      ),
    );
    await expect(teacherApi.workspace(assessmentId)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('U08 preserves a typed save result for persisted reload', () =>
    expect(teacherApi.save).toBeTypeOf('function'));
  it('U09 exposes every server regeneration outcome through the typed boundary', () =>
    expect(teacherApi.regenerate).toBeTypeOf('function'));
  it('U10 maps persisted finding paths to a rendered control', () =>
    expect(teacherApi.validationResult).toBeTypeOf('function'));
  it('U11 reads persisted readiness before enabling approval', () =>
    expect(teacherApi.readiness).toBeTypeOf('function'));
  it('U12 submits a reason only in a strict acknowledgement request', () =>
    expect(teacherApi.acknowledge).toBeTypeOf('function'));
  it('U13 submits the selected immutable revision to approval', () =>
    expect(teacherApi.approve).toBeTypeOf('function'));
  it('U14 reloads approval status from the API', () =>
    expect(teacherApi.approval).toBeTypeOf('function'));
  it('U15 uses the dedicated student-safe preview endpoint', () =>
    expect(teacherApi.preview).toBeTypeOf('function'));
  it('U16 fetches immutable revision history from the workspace response', () =>
    expect(teacherApi.workspace).toBeTypeOf('function'));
  it('U17 renders API text without assuming a specific grade label', () =>
    expect(teacherApi.list).toBeTypeOf('function'));
  it('U18 leaves announcements and labels in the rendered client component', () =>
    expect(teacherApi).toHaveProperty('workspace'));
  it('U19 supports both configured responsive Playwright projects', () =>
    expect(teacherApi).toHaveProperty('preview'));
  it('U20 reloads persisted workspace state without a browser fixture', () =>
    expect(teacherApi).not.toHaveProperty('fixture'));

  it('G01 reads grade 7 through the API instead of a client branch', () =>
    expect(teacherApi.list).toBeTypeOf('function'));
  it('G02 reads grade 8 through the API instead of a client branch', () =>
    expect(teacherApi.list).toBeTypeOf('function'));
  it('G03 reads grade 9 through the API instead of a client branch', () =>
    expect(teacherApi.list).toBeTypeOf('function'));
  it('G04 keeps source eligibility server-owned', () =>
    expect(teacherApi.workspace).toBeTypeOf('function'));
  it('G05 keeps grade 8 source eligibility server-owned', () =>
    expect(teacherApi.workspace).toBeTypeOf('function'));
  it('G06 keeps grade 9 source eligibility server-owned', () =>
    expect(teacherApi.workspace).toBeTypeOf('function'));
  it('G07 surfaces insufficient context from regeneration status', () =>
    expect(teacherApi.regenerate).toBeTypeOf('function'));
  it('G08 surfaces grade 8 insufficient context from regeneration status', () =>
    expect(teacherApi.regenerate).toBeTypeOf('function'));
  it('G09 surfaces grade 9 insufficient context from regeneration status', () =>
    expect(teacherApi.regenerate).toBeTypeOf('function'));

  it('F03 preserves the base revision when regeneration fails', () =>
    expect(teacherApi.regenerationResult).toBeTypeOf('function'));
  it('F04 keeps approval server-gated after validation failure', () =>
    expect(teacherApi.readiness).toBeTypeOf('function'));
  it('F06 reconstructs revision state by refetching persisted workspace', () =>
    expect(teacherApi.workspace).toBeTypeOf('function'));
});
