import { HttpException, HttpStatus } from '@nestjs/common';
import { AccessDeniedError } from '@teach/domain';
import { EditorSaveError, IdempotencyConflictError, TeacherWorkspaceError } from '@teach/db';

export function mapTeacherWorkspaceError(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (error instanceof Error && error.message === 'Malformed request')
    throw new HttpException('Malformed request', HttpStatus.BAD_REQUEST);
  if (error && typeof error === 'object' && (error as { name?: string }).name === 'ZodError')
    throw new HttpException('Malformed request', HttpStatus.BAD_REQUEST);
  if (
    error instanceof AccessDeniedError ||
    (error instanceof TeacherWorkspaceError && error.code === 'RESOURCE_UNAVAILABLE')
  )
    throw new HttpException('Resource not found or unavailable', HttpStatus.NOT_FOUND);
  if (error instanceof EditorSaveError && error.code === 'RESOURCE_UNAVAILABLE')
    throw new HttpException('Resource not found or unavailable', HttpStatus.NOT_FOUND);
  if (
    error instanceof TeacherWorkspaceError &&
    ['STALE_REVISION', 'IDEMPOTENCY_CONFLICT'].includes(error.code)
  )
    throw new HttpException('Request conflicts with current state', HttpStatus.CONFLICT);
  if (
    error instanceof EditorSaveError &&
    ['STALE_BASE', 'IDEMPOTENCY_CONFLICT'].includes(error.code)
  )
    throw new HttpException('Request conflicts with current state', HttpStatus.CONFLICT);
  if (error instanceof IdempotencyConflictError)
    throw new HttpException('Request conflicts with current state', HttpStatus.CONFLICT);
  if (
    error instanceof TeacherWorkspaceError &&
    [
      'VALIDATION_REQUIRED',
      'VALIDATION_PENDING',
      'VALIDATION_PROCESSING',
      'VALIDATION_FAILED',
      'DETERMINISTIC_BLOCKER',
      'SEMANTIC_BLOCKER',
      'WARNING_ACKNOWLEDGEMENT_REQUIRED',
      'VALIDATION_VERSION_STALE',
      'SOURCE_ELIGIBILITY_CHANGED',
    ].includes(error.code)
  )
    throw new HttpException(error.code, HttpStatus.UNPROCESSABLE_ENTITY);
  const databaseCode =
    error && typeof error === 'object'
      ? String(
          (error as { code?: unknown; meta?: { code?: unknown } }).code === 'P2010'
            ? (error as { meta?: { code?: unknown } }).meta?.code
            : (error as { code?: unknown }).code,
        )
      : '';
  if (databaseCode === 'P5029' || databaseCode === 'P5030')
    throw new HttpException('Revision is not ready for approval', HttpStatus.UNPROCESSABLE_ENTITY);
  if (
    error instanceof EditorSaveError &&
    ['CURRICULUM_UNAVAILABLE', 'INVALID_EDITOR_SNAPSHOT'].includes(error.code)
  )
    throw new HttpException('Request cannot be processed', HttpStatus.UNPROCESSABLE_ENTITY);
  throw new HttpException('An internal error occurred', HttpStatus.INTERNAL_SERVER_ERROR);
}
