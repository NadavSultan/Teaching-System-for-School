import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@teach/contracts'],
  allowedDevOrigins: ['127.0.0.1'],
};
export default config;
