import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Patch,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CONTRACT_VERSION } from '@teach/contracts';
import { databaseReady, databaseReadyAt, prisma, resolveAccessContext } from '@teach/db';
import { AccessDeniedError, authorizeWorkspace } from '@teach/domain';
import { AuthService } from './auth.js';
import { TeacherWorkspaceModule } from './teacher-workspace.module.js';

@Injectable()
export class WorkspaceService {
  async context(principal: ReturnType<AuthService['authenticate']>, organizationId: string) {
    const context = await resolveAccessContext(principal, organizationId);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: principal.userId, organizationId } },
      include: { organization: true },
    });
    authorizeWorkspace(context, membership.organizationId, 'READ_WORKSPACE_CONTEXT');
    return {
      version: CONTRACT_VERSION,
      principal,
      organization: {
        id: membership.organization.id,
        name: membership.organization.name,
        workspaceType: membership.organization.workspaceType,
      },
      membership: {
        organizationId: membership.organizationId,
        role: membership.role,
        status: membership.status,
      },
    };
  }

  async rename(
    principal: ReturnType<AuthService['authenticate']>,
    organizationId: string,
    name: string,
  ) {
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: principal.userId, organizationId } },
      include: { user: true, organization: true },
    });
    if (!membership) throw new AccessDeniedError();
    authorizeWorkspace(
      {
        principal,
        organizationId: membership.organizationId,
        userStatus: membership.user.status,
        membershipStatus: membership.status,
        role: membership.role,
        organizationStatus: membership.organization.status,
        workspaceType: membership.organization.workspaceType,
      },
      membership.organizationId,
      'RENAME_WORKSPACE',
    );
    return prisma.organization.update({ where: { id: organizationId }, data: { name } });
  }
}

@Controller()
export class AppController {
  constructor(
    private readonly auth: AuthService,
    private readonly workspaces: WorkspaceService,
  ) {}
  @Get('/health/live') live(@Req() request: Request) {
    return { version: CONTRACT_VERSION, status: 'ok', service: 'api', requestId: request.id };
  }
  @Get('/health/ready') async ready(@Req() request: Request) {
    const ready = process.env.READINESS_DATABASE_URL
      ? await databaseReadyAt(process.env.READINESS_DATABASE_URL)
      : await databaseReady();
    if (!ready)
      throw new HttpException(
        {
          version: CONTRACT_VERSION,
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service is not ready',
            requestId: request.id,
          },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    return {
      version: CONTRACT_VERSION,
      status: 'ok',
      service: 'api',
      requestId: request.id,
      checks: { database: 'ok' },
    };
  }
  @Get('/v1/me/workspace') async workspace(
    @Req() request: Request,
    @Headers('x-organization-id') organizationId?: string,
  ) {
    const principal = this.auth.authenticate(request);
    if (!organizationId) throw new HttpException('Organization context is required', 400);
    try {
      return await this.workspaces.context(principal, organizationId);
    } catch (error) {
      if (error instanceof AccessDeniedError)
        throw new HttpException('Resource not found or unavailable', 404);
      throw error;
    }
  }

  @Patch('/v1/me/workspace')
  async renameWorkspace(
    @Req() request: Request,
    @Headers('x-organization-id') organizationId: string | undefined,
    @Body() body: unknown,
  ) {
    const principal = this.auth.authenticate(request);
    if (!organizationId) throw new HttpException('Organization context is required', 400);
    const name =
      body && typeof body === 'object' && 'name' in body && typeof body.name === 'string'
        ? body.name.trim()
        : '';
    if (!name || name.length > 200) throw new HttpException('A valid name is required', 400);
    try {
      const organization = await this.workspaces.rename(principal, organizationId, name);
      return {
        version: CONTRACT_VERSION,
        organization: {
          id: organization.id,
          name: organization.name,
          workspaceType: organization.workspaceType,
        },
      };
    } catch (error) {
      if (error instanceof AccessDeniedError)
        throw new HttpException('Resource not found or unavailable', 404);
      throw error;
    }
  }
}

@Module({
  imports: [TeacherWorkspaceModule],
  controllers: [AppController],
  providers: [AuthService, WorkspaceService],
})
export class AppModule {}
