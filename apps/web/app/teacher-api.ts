'use client';

import {
  apiErrorSchema,
  assessmentCreationSchema,
  approvalResultSchema,
  approvalStatusSchema,
  editorSaveResultSchema,
  generationResultSchema,
  generationStatusSchema,
  studentSafePreviewSchema,
  teacherAssessmentListResponseSchema,
  teacherAssessmentCreateResultSchema,
  teacherWorkspaceSchema,
  validationAcknowledgementSchema,
  validationAcknowledgementResultSchema,
  validationReadinessSchema,
  validationResultSchema,
  validationStatusSchema,
  z,
  type ApprovalRequest,
  type EditorSaveRequest,
} from '@teach/contracts';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class TeacherApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function browserHeaders(): HeadersInit {
  // The selected organization is routing metadata, never a database credential.
  const organizationId = process.env.NEXT_PUBLIC_TEACHER_ORGANIZATION_ID;
  return organizationId ? { 'x-organization-id': organizationId } : {};
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}/v1/teacher${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...browserHeaders(),
      ...init?.headers,
    },
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    const error = apiErrorSchema.parse(json).error;
    throw new TeacherApiError(error.code, error.message);
  }
  return schema.parse(json);
}

export const teacherApi = {
  list: () => request('/assessments', teacherAssessmentListResponseSchema),
  create: (body: unknown) =>
    request('/assessments', teacherAssessmentCreateResultSchema, {
      method: 'POST',
      body: JSON.stringify(assessmentCreationSchema.parse(body)),
    }),
  workspace: (assessmentId: string, revisionId?: string) =>
    request(
      `/assessments/${assessmentId}${revisionId ? `?revisionId=${revisionId}` : ''}`,
      teacherWorkspaceSchema,
    ),
  preview: (assessmentId: string, revisionId: string) =>
    request(
      `/assessments/${assessmentId}/revisions/${revisionId}/student-preview`,
      studentSafePreviewSchema,
    ),
  save: (body: EditorSaveRequest) =>
    request('/revisions', editorSaveResultSchema, { method: 'POST', body: JSON.stringify(body) }),
  regenerate: (body: unknown) =>
    request('/regenerations', generationStatusSchema, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  regenerationResult: (runId: string) =>
    request(`/regenerations/${runId}/result`, generationResultSchema),
  validate: (body: unknown) =>
    request('/validations', validationStatusSchema, { method: 'POST', body: JSON.stringify(body) }),
  validationResult: (runId: string) =>
    request(`/validations/${runId}/result`, validationResultSchema),
  acknowledge: (body: unknown) =>
    request('/acknowledgements', validationAcknowledgementResultSchema, {
      method: 'POST',
      body: JSON.stringify(validationAcknowledgementSchema.parse(body)),
    }),
  readiness: (assessmentId: string, revisionId: string) =>
    request(
      `/assessments/${assessmentId}/revisions/${revisionId}/readiness`,
      validationReadinessSchema,
    ),
  approve: (body: ApprovalRequest) =>
    request('/approvals', approvalResultSchema, { method: 'POST', body: JSON.stringify(body) }),
  approval: (assessmentId: string, revisionId: string) =>
    request(`/assessments/${assessmentId}/revisions/${revisionId}/approval`, approvalStatusSchema),
  approvalHistory: (assessmentId: string) =>
    request(`/assessments/${assessmentId}/approvals`, z.array(z.unknown())),
};
