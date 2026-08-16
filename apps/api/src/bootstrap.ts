import { randomUUID } from 'node:crypto';
import { HttpException, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { CONTRACT_VERSION } from '@teach/contracts';
import { AppModule } from './app.module.js';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const server = app.getHttpAdapter().getInstance();
  server.use(helmet());
  server.use((request: Request, response: Response, next: NextFunction) => {
    request.id = request.header('x-request-id')?.slice(0, 128) || randomUUID();
    response.setHeader('x-request-id', request.id);
    response.once('finish', () =>
      console.log(
        JSON.stringify({
          service: 'api',
          environment: process.env.NODE_ENV ?? 'development',
          correlationId: request.id,
          event: 'http.completed',
          method: request.method,
          path: request.path,
          status: response.statusCode,
        }),
      ),
    );
    next();
  });
  server.use(express.json({ limit: '100kb' }));
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'x-request-id',
      'x-dev-user-id',
      'x-dev-user-email',
      'x-organization-id',
    ],
  });
  app.useGlobalFilters({
    catch(exception: unknown, host) {
      const response = host.switchToHttp().getResponse<Response>();
      const request = host.switchToHttp().getRequest<Request>();
      const externalStatus =
        exception && typeof exception === 'object' && 'status' in exception
          ? Number(exception.status)
          : undefined;
      const status =
        exception instanceof HttpException
          ? exception.getStatus()
          : externalStatus && externalStatus >= 400 && externalStatus < 600
            ? externalStatus
            : 500;
      response.status(status).json({
        version: CONTRACT_VERSION,
        error: {
          code:
            status === 404
              ? 'NOT_FOUND'
              : status === 401
                ? 'UNAUTHENTICATED'
                : status === 413
                  ? 'PAYLOAD_TOO_LARGE'
                  : status === 503
                    ? 'SERVICE_UNAVAILABLE'
                    : status >= 500
                      ? 'INTERNAL_ERROR'
                      : 'BAD_REQUEST',
          message:
            status === 503
              ? 'Service is not ready'
              : status >= 500
                ? 'An internal error occurred'
                : exception instanceof Error
                  ? exception.message
                  : 'Request failed',
          requestId: request.id,
        },
      });
    },
  });
  if (process.env.NODE_ENV !== 'production')
    SwaggerModule.setup(
      '/docs',
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Teaching System API').setVersion('1.0.0').build(),
      ),
    );
  app.enableShutdownHooks();
  return app;
}
