import type { NextConfig } from 'next';
// 이 파일은 cleanup 때 Web root의 next.config.ts로 복사되므로 root 기준 import를 사용한다.
import { createApiRewrites } from './config/api-rewrites';

const nextConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: {
    compilationMode: 'annotation'
  },
  rewrites: async () =>
    createApiRewrites({
      nodeEnv: process.env.NODE_ENV,
      apiUrl: process.env.API_URL ?? 'http://localhost:4400'
    }),
  // ADR 0028: canonical route는 static shell + Suspense streaming이며 legacy dashboard와 /s/[token]만 instant=false로 제외한다.
  cacheComponents: true,
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.slingacademy.com',
        port: ''
      },
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
        port: ''
      },
      {
        protocol: 'https',
        hostname: 'clerk.com',
        port: ''
      }
    ]
  },
  // client-safe 계약 subpath는 dist 선행 build 없이 workspace source를 직접 추적한다.
  transpilePackages: ['@eatbid/contracts', 'geist'],
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
  }
};

export default nextConfig;
