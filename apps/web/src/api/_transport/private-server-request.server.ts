/** @module 책임: RSC 요청의 인증 쿠키만 골라 Nest로 전달하는 캐시 금지 server request adapter를 조립한다. */
import 'server-only';

import { cookies } from 'next/headers';

import { readServerApiOrigin } from './api-origin';
import { createContractRequest } from './request-contract';

/**
 * provider가 소유한 쿠키 이름만 전달한다. 요청 헤더 전체를 relay하면 내부 origin 호출에 사용자 헤더가
 * 섞이고, 그 중 하나가 다음 hop에서 의미를 갖는 순간 조용한 권한 경로가 된다(ADR 0032 §1).
 *
 * 이름 규칙의 근거는 설치본 `better-auth/cookies`다. prefix 기본값이 `better-auth`이고 `Secure` 배포는
 * `__Secure-`를 앞에 붙이며, 구분자는 `.`과 `-` 둘 다 쓰인다. 서버가 `advanced.cookiePrefix`를 바꾸면
 * 이 규칙도 같이 바꿔야 한다.
 */
const authCookieName = /^(?:__Secure-)?better-auth[.-]/;

async function authCookieHeader(): Promise<string | undefined> {
  const store = await cookies();
  const forwarded = store
    .getAll()
    .filter((cookie) => authCookieName.test(cookie.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`);
  return forwarded.length ? forwarded.join('; ') : undefined;
}

/**
 * 개인 응답 전용 server adapter다. `serverRequest`와 나누는 이유는 하나다. 공개 read는 `use cache`
 * 경계 안에서 실행되고 그 안에서는 `cookies()`를 읽을 수 없으므로, 쿠키를 읽는 adapter를 하나로 합치면
 * 공개 read가 통째로 깨진다. 이 adapter를 쓰는 함수에는 `use cache`를 두지 않는다(ADR 0028 §4).
 */
export const privateServerRequest = createContractRequest({
  fetch: async (input, init) => {
    const cookie = await authCookieHeader();
    return fetch(input, {
      ...init,
      // 개인 응답은 어떤 공유 캐시에도 남지 않는다. 서버가 붙이는 `private, no-store`와 같은 판정을
      // 요청 쪽에서도 한 번 더 고정해 Next data cache가 사용자 간에 응답을 재사용하지 못하게 한다.
      cache: 'no-store',
      headers: cookie === undefined ? init?.headers : { ...init?.headers, cookie }
    });
  },
  resolveOrigin: () => readServerApiOrigin(process.env)
});
