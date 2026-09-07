import { Injectable } from '@nestjs/common';
import {
  acknowledgeSemanticWarning,
  approveAssessmentRevision,
  createAssessment,
  getApprovalStatus,
  getApprovalHistory,
  getGenerationResult,
  getGenerationStatus,
  getRevisionValidationReadiness,
  getStudentSafePreview,
  getTeacherWorkspace,
  getValidationResult,
  getValidationStatus,
  listTeacherAssessments,
  requestRevisionValidation,
  requestTeacherQuestionRegeneration,
  resolveAccessContext,
  saveEditedRevision,
} from '@teach/db';
import type { AuthenticatedPrincipal } from '@teach/contracts';

@Injectable()
export class TeacherWorkspaceService {
  private async context(principal: AuthenticatedPrincipal, organizationId: string) {
    return resolveAccessContext(principal, organizationId);
  }
  async list(principal: AuthenticatedPrincipal, organizationId: string, cursor?: string) {
    return listTeacherAssessments(await this.context(principal, organizationId), cursor);
  }
  async workspace(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    assessmentId: string,
    revisionId?: string,
  ) {
    return getTeacherWorkspace(
      await this.context(principal, organizationId),
      assessmentId,
      revisionId,
    );
  }
  async preview(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    assessmentId: string,
    revisionId: string,
  ) {
    return getStudentSafePreview(
      await this.context(principal, organizationId),
      assessmentId,
      revisionId,
    );
  }
  async create(principal: AuthenticatedPrincipal, organizationId: string, body: unknown) {
    return createAssessment(await this.context(principal, organizationId), body);
  }
  async save(principal: AuthenticatedPrincipal, organizationId: string, body: unknown) {
    return saveEditedRevision(await this.context(principal, organizationId), body);
  }
  async regenerate(principal: AuthenticatedPrincipal, organizationId: string, body: unknown) {
    return requestTeacherQuestionRegeneration(await this.context(principal, organizationId), body);
  }
  async generationStatus(principal: AuthenticatedPrincipal, organizationId: string, id: string) {
    return getGenerationStatus(await this.context(principal, organizationId), id);
  }
  async generationResult(principal: AuthenticatedPrincipal, organizationId: string, id: string) {
    return getGenerationResult(await this.context(principal, organizationId), id);
  }
  async requestValidation(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    body: unknown,
  ) {
    return requestRevisionValidation(await this.context(principal, organizationId), body);
  }
  async validationStatus(principal: AuthenticatedPrincipal, organizationId: string, id: string) {
    return getValidationStatus(await this.context(principal, organizationId), id);
  }
  async validationResult(principal: AuthenticatedPrincipal, organizationId: string, id: string) {
    return getValidationResult(await this.context(principal, organizationId), id);
  }
  async acknowledge(principal: AuthenticatedPrincipal, organizationId: string, body: unknown) {
    return acknowledgeSemanticWarning(await this.context(principal, organizationId), body);
  }
  async readiness(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    assessmentId: string,
    revisionId: string,
  ) {
    return getRevisionValidationReadiness(
      await this.context(principal, organizationId),
      assessmentId,
      revisionId,
    );
  }
  async approve(principal: AuthenticatedPrincipal, organizationId: string, body: unknown) {
    return approveAssessmentRevision(await this.context(principal, organizationId), body);
  }
  async approvalStatus(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    assessmentId: string,
    revisionId: string,
  ) {
    return getApprovalStatus(
      await this.context(principal, organizationId),
      assessmentId,
      revisionId,
    );
  }
  async approvalHistory(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    assessmentId: string,
  ) {
    return getApprovalHistory(await this.context(principal, organizationId), assessmentId);
  }
}
