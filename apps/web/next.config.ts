import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// 기반 설정은 plugin wrapper보다 먼저 선언해 framework option의 권위를 한 곳에 둔다.
const baseConfig: NextConfig = {
  typedRoutes: true,
  reactCompiler: {
    compilationMode: 'annotation'
  },
  // Cache Components는 route/Suspense/auth/cache 조합을 별도로 검토하기 전까지 활성화하지 않는다.
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.slingacademy.com',
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

let configWithPlugins = baseConfig;

// local 환경에서 Sentry가 꺼져 있어도 같은 기반 Next 설정을 사용한다.
if (!process.env.NEXT_PUBLIC_SENTRY_DISABLED) {
  configWithPlugins = withSentryConfig(configWithPlugins, {
    org: process.env.NEXT_PUBLIC_SENTRY_ORG,
    project: process.env.NEXT_PUBLIC_SENTRY_PROJECT,
    // source map upload log는 CI에서만 출력한다.
    silent: !process.env.CI,

    // stack trace 가독성을 위해 더 넓은 source map을 올리며 build 비용 증가는 허용한다.
    widenClientFileUpload: true,

    // ad blocker 영향을 줄이기 위해 browser request를 Next.js rewrite로 전달한다.
    tunnelRoute: '/monitoring',

    // application telemetry와 무관한 Sentry 자체 telemetry는 전송하지 않는다.
    telemetry: false,

    // Sentry v10부터 component annotation과 tree shake 설정은 webpack namespace에 있다.
    webpack: {
      reactComponentAnnotation: {
        enabled: true
      },
      treeshake: {
        removeDebugLogging: true
      }
    },

    // org/project가 없으면 잘못된 destination으로 source map을 올리지 않는다.
    sourcemaps: {
      disable: !process.env.NEXT_PUBLIC_SENTRY_ORG || !process.env.NEXT_PUBLIC_SENTRY_PROJECT
    }
  });
}

const nextConfig = configWithPlugins;
export default nextConfig;
