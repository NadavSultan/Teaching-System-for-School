export type TelemetryConfig = {
  serviceName: string;
  environment: string;
  otlpEndpoint?: string;
};

/** OpenTelemetry-compatible configuration seam. Phase 10 deliberately installs no exporter. */
export function telemetryConfig(): TelemetryConfig {
  return {
    serviceName: 'api',
    environment: process.env.NODE_ENV ?? 'development',
    ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? { otlpEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }
      : {}),
  };
}
