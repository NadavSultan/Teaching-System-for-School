import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { CONTRACT_VERSION, type AuthenticatedPrincipal } from '@teach/contracts';

@Injectable()
export class AuthService {
  constructor() {
    if (process.env.NODE_ENV === 'production' && process.env.AUTH_ADAPTER !== 'managed') {
      throw new Error('Production requires a configured managed authentication adapter');
    }
    if (process.env.AUTH_ADAPTER === 'managed')
      throw new Error('Managed authentication adapter is not implemented in Phase 10');
  }

  authenticate(request: Request): AuthenticatedPrincipal {
    if (
      !['development', 'test'].includes(process.env.NODE_ENV ?? 'development') ||
      !['development', 'test'].includes(process.env.AUTH_ADAPTER ?? 'development')
    )
      throw new UnauthorizedException();
    const userId = request.header('x-dev-user-id');
    const email = request.header('x-dev-user-email') ?? 'teacher@example.test';
    if (!userId) throw new UnauthorizedException('Development identity header is required');
    return {
      version: CONTRACT_VERSION,
      userId,
      email,
      provider: 'development',
      providerSubject: `dev:${userId}`,
      platformAdmin: false,
    };
  }
}
