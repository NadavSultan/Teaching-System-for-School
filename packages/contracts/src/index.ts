import { z } from 'zod';

export const CONTRACT_VERSION = '1.0.0' as const;
export const uuidSchema = z.string().uuid();

export const healthSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  status: z.enum(['ok', 'unavailable']),
  service: z.string().min(1),
  requestId: z.string().min(1),
  checks: z.record(z.enum(['ok', 'unavailable'])).optional(),
});

export const roleSchema = z.enum(['TEACHER', 'COORDINATOR', 'SCHOOL_ADMIN', 'PLATFORM_ADMIN']);
export const membershipSummarySchema = z.object({
  organizationId: uuidSchema,
  role: roleSchema,
  status: z.enum(['ACTIVE', 'INACTIVE']),
});
export const organizationSummarySchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(200),
  workspaceType: z.enum(['PERSONAL', 'SCHOOL']),
});
export const authenticatedPrincipalSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  userId: uuidSchema,
  email: z.string().email(),
  provider: z.string().min(1),
  providerSubject: z.string().min(1),
  platformAdmin: z.boolean(),
});
export const workspaceContextSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  principal: authenticatedPrincipalSchema,
  organization: organizationSummarySchema,
  membership: membershipSummarySchema,
});
export const apiErrorSchema = z.object({
  version: z.literal(CONTRACT_VERSION),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});

export type AuthenticatedPrincipal = z.infer<typeof authenticatedPrincipalSchema>;
export type WorkspaceContext = z.infer<typeof workspaceContextSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
