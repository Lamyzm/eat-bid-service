import { parseApiOrigin } from '../src/api/_transport/api-origin';

export interface ApiRewriteOptions {
  readonly nodeEnv: string | undefined;
  readonly apiUrl: string | undefined;
}

export interface ApiRewrite {
  readonly source: string;
  readonly destination: string;
}

export function createApiRewrites(options: ApiRewriteOptions): ApiRewrite[] {
  if (options.nodeEnv !== 'development') return [];
  if (!options.apiUrl) throw new Error('development API_URL이 설정되지 않았습니다.');
  const origin = parseApiOrigin(options.apiUrl);
  return [{ source: '/api/:path*', destination: `${origin}/api/:path*` }];
}
