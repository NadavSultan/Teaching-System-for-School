import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Module } from '@nestjs/common';
import { uuidSchema } from '@teach/contracts';
import { AuthService } from './auth.js';
import { mapTeacherWorkspaceError } from './teacher-workspace.error-mapper.js';
import { TeacherWorkspaceService } from './teacher-workspace.service.js';

const id = uuidSchema;
const organization = uuidSchema;

@Controller('/v1/teacher')
export class TeacherWorkspaceController {
  constructor(
    private readonly auth: AuthService,
    private readonly service: TeacherWorkspaceService,
  ) {}
  private principal(request: Request) {
    return this.auth.authenticate(request);
  }
  private organization(value: string | undefined) {
    return organization.parse(value);
  }
  private async run<T>(operation: () => Promise<T>) {
    try {
      return await operation();
    } catch (error) {
      return mapTeacherWorkspaceError(error);
    }
  }
  @Get('/assessments') list(
    @Req() request: Request,
    @Headers('x-organization-id') org?: string,
    @Query() query?: Record<string, unknown>,
  ) {
    return this.run(() => {
      if (
        !query ||
        Object.keys(query).some((key) => key !== 'cursor') ||
        (query.cursor !== undefined &&
          (typeof query.cursor !== 'string' || query.cursor.length > 500))
      )
        throw new Error('Malformed request');
      return this.service.list(
        this.principal(request),
        this.organization(org),
        query.cursor as string | undefined,
      );
    });
  }
  @Get('/assessments/:assessmentId') workspace(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('assessmentId') assessmentId: string,
    @Query('revisionId') revisionId?: string,
  ) {
    return this.run(() =>
      this.service.workspace(
        this.principal(request),
        this.organization(org),
        id.parse(assessmentId),
        revisionId ? id.parse(revisionId) : undefined,
      ),
    );
  }
  @Get('/assessments/:assessmentId/revisions/:revisionId/student-preview') preview(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('assessmentId') assessmentId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.run(() =>
      this.service.preview(
        this.principal(request),
        this.organization(org),
        id.parse(assessmentId),
        id.parse(revisionId),
      ),
    );
  }
  @Post('/assessments') create(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Body() body: unknown,
  ) {
    return this.run(() =>
      this.service.create(this.principal(request), this.organization(org), body),
    );
  }
  @Post('/revisions') save(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Body() body: unknown,
  ) {
    return this.run(() => this.service.save(this.principal(request), this.organization(org), body));
  }
  @Post('/regenerations') regenerate(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Body() body: unknown,
  ) {
    return this.run(() =>
      this.service.regenerate(this.principal(request), this.organization(org), body),
    );
  }
  @Get('/regenerations/:id') generationStatus(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('id') runId: string,
  ) {
    return this.run(() =>
      this.service.generationStatus(
        this.principal(request),
        this.organization(org),
        id.parse(runId),
      ),
    );
  }
  @Get('/regenerations/:id/result') generationResult(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('id') runId: string,
  ) {
    return this.run(() =>
      this.service.generationResult(
        this.principal(request),
        this.organization(org),
        id.parse(runId),
      ),
    );
  }
  @Post('/validations') requestValidation(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Body() body: unknown,
  ) {
    return this.run(() =>
      this.service.requestValidation(this.principal(request), this.organization(org), body),
    );
  }
  @Get('/validations/:id') validationStatus(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('id') runId: string,
  ) {
    return this.run(() =>
      this.service.validationStatus(
        this.principal(request),
        this.organization(org),
        id.parse(runId),
      ),
    );
  }
  @Get('/validations/:id/result') validationResult(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('id') runId: string,
  ) {
    return this.run(() =>
      this.service.validationResult(
        this.principal(request),
        this.organization(org),
        id.parse(runId),
      ),
    );
  }
  @Post('/acknowledgements') acknowledge(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Body() body: unknown,
  ) {
    return this.run(() =>
      this.service.acknowledge(this.principal(request), this.organization(org), body),
    );
  }
  @Get('/assessments/:assessmentId/revisions/:revisionId/readiness') readiness(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('assessmentId') assessmentId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.run(() =>
      this.service.readiness(
        this.principal(request),
        this.organization(org),
        id.parse(assessmentId),
        id.parse(revisionId),
      ),
    );
  }
  @Post('/approvals') approve(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Body() body: unknown,
  ) {
    return this.run(() =>
      this.service.approve(this.principal(request), this.organization(org), body),
    );
  }
  @Get('/assessments/:assessmentId/revisions/:revisionId/approval') approvalStatus(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('assessmentId') assessmentId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.run(() =>
      this.service.approvalStatus(
        this.principal(request),
        this.organization(org),
        id.parse(assessmentId),
        id.parse(revisionId),
      ),
    );
  }
  @Get('/assessments/:assessmentId/approvals') approvalHistory(
    @Req() request: Request,
    @Headers('x-organization-id') org: string | undefined,
    @Param('assessmentId') assessmentId: string,
  ) {
    return this.run(() =>
      this.service.approvalHistory(
        this.principal(request),
        this.organization(org),
        id.parse(assessmentId),
      ),
    );
  }
}

@Module({
  controllers: [TeacherWorkspaceController],
  providers: [AuthService, TeacherWorkspaceService],
})
export class TeacherWorkspaceModule {}
