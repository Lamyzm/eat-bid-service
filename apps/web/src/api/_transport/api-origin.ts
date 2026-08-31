// API origin은 absolute origin만 허용해 path 중복, credential 노출과 임의 protocol을 차단한다.
export function parseApiOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('API_URL은 유효한 absolute URL이어야 합니다.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('API_URL protocol은 http 또는 https여야 합니다.');
  }
  if (url.username || url.password) throw new Error('API_URL에 credential을 포함할 수 없습니다.');
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API_URL은 path, query, hash가 없는 origin이어야 합니다.');
  }
  return url.origin;
}

export interface ServerApiEnvironment {
  readonly API_URL?: string;
  readonly NODE_ENV?: string;
}

// 운영에서는 명시적 origin을 강제하고, 로컬 개발에서만 고정된 Nest 기본값을 허용한다.
export function readServerApiOrigin(environment: ServerApiEnvironment): string {
  const value =
    environment.API_URL ??
    (environment.NODE_ENV === 'development' ? 'http://localhost:4400' : undefined);
  if (!value) throw new Error('API_URL이 설정되지 않았습니다.');
  return parseApiOrigin(value);
}
