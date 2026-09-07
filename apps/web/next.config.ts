import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@teach/contracts'],
  allowedDevOrigins: ['127.0.0.1'],
  webpack(config) {
    config.resolve.alias['@teach/contracts'] = resolve(
      __dirname,
      '../../packages/contracts/dist/index.js',
    );
    return config;
  },
};
export default config;
