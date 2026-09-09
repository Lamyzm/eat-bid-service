/** @module 책임: 조립 지점별 시간 예산과 재시도 규칙을 정의하고 주입된 fetch를 ky로 감싼 한 번의 응답으로 되돌린다. */
import type { ElapsedMilliseconds } from '@eatbid/domain';
// 아래 재시도 다리가 ky의 `HTTPError` 생성자와 "throwHttpErrors가 꺼져 있으면 ky가 응답 본문을 읽지
// 않는다"는 내부 동작에 기대므로, minor 상향이 계약 판정을 조용히 바꾸지 않도록 정확한 버전에 고정한다.
import ky, { HTTPError, type NormalizedOptions } from 'ky';

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

/**
 * 시간 값은 이 파일에만 둔다. `@eatbid/domain`의 `seconds()`와 같은 의미지만 그 runtime은 client bundle에
 * 넣지 않기로 했으므로(apps/web AGENTS.md) 단위를 지키는 브랜드 타입만 빌려 오고 변환은 여기서 끝낸다.
 */
function elapsedSeconds(value: number): ElapsedMilliseconds {
  return (value * 1_000) as ElapsedMilliseconds;
}

export interface TransportResilience {
  /** 시도 하나의 상한이자 재시도를 포함한 전체 예산이다. 두 값을 같게 두어 재시도가 지연을 곱하지 못하게 한다. */
  readonly timeout: ElapsedMilliseconds;
  /** 조회에만 적용되는 추가 시도 횟수다. 0이면 한 번만 보낸다. */
  readonly retryLimit: number;
}

/**
 * 조립 지점마다 예산이 다르다. 서버 렌더는 사용자가 빈 화면을 보는 시간이고 브라우저 조회는 이미 그려진
 * 화면 위에서 기다리므로, 같은 상류를 부르더라도 참을 수 있는 길이가 다르다.
 */
export const transportResilience = {
  /**
   * 공개 서버 조회. 운영 실측에서 결정 화면 응답 전체가 0.35~0.49초이므로 3초는 정상의 열 배이고,
   * `use cache` 안에서 도는 조회라 같은 3초를 전체 예산으로도 써서 재시도 두 번이 렌더 예산을 넘기지 못하게 한다.
   */
  publicServerRead: { timeout: elapsedSeconds(3), retryLimit: 2 },
  /**
   * 개인 서버 조회. 캐시에 담기지 않아 요청마다 상류를 부르므로 시간 제한은 공개 조회와 같게 두고,
   * 재시도는 한 번만 남겨 로그인 직후 화면이 실패를 오래 숨기지 않게 한다.
   */
  privateServerRead: { timeout: elapsedSeconds(3), retryLimit: 1 },
  /**
   * 브라우저 조회. 상호작용 이후 조회라 이미 그려진 화면이 대기 상태를 말할 수 있고 모바일 네트워크의
   * 왕복이 서버 내부 호출보다 느리므로 8초까지 허용하되 재시도는 서버 공개 조회와 같은 두 번으로 맞춘다.
   */
  browserRead: { timeout: elapsedSeconds(8), retryLimit: 2 }
} as const satisfies Record<string, TransportResilience>;

/**
 * 다시 보내면 답이 달라질 수 있는 status만 재시도한다. 서버가 잠시 뒤에 다시 오라고 말했거나(408·429)
 * 상류가 잠깐 무너진 경우(5xx)이며, 나머지 4xx는 같은 요청을 몇 번 보내도 같은 계약 실패다.
 */
const retryableStatuses = [408, 429, 500, 502, 503, 504];

/** 조회만 재시도한다. ky 기본값은 put·delete까지 포함하므로 명시적으로 좁혀 쓰기의 중복 실행을 막는다. */
const retryableMethods = ['get', 'head'] as const;

/**
 * ky는 스스로 `Request`를 만들기 때문에 절대 URL이 필요하다. 브라우저는 `location`으로 상대 경로를
 * 풀지만 Node runtime에는 그 전역이 없어 `Failed to parse URL`로 죽는다(Node 24에서 확인). same-origin
 * 조립 지점이 두 runtime에서 같게 돌도록 해석되지 않는 예약 도메인(RFC 2606)을 붙여 ky 내부 표현만
 * 만들고, 실제 호출에는 원래 상대 경로를 그대로 넘긴다.
 */
const sameOriginBase = 'http://same-origin.invalid';

/**
 * ky가 status를 직접 보게 하면(`throwHttpErrors` 기본값) 오류를 만들면서 응답 본문을 끝까지 읽어
 * `error.response.json()`이 죽는다. Node 24에서 재시도 대상 503과 재시도 대상이 아닌 404 모두
 * `bodyUsed: true`로 관측했다. 그러면 Problem Details가 사라져 404가 `notFound()`로 가지 못하므로,
 * 본문을 건드리지 않는 이 경로를 유지하고 재시도 신호만 직접 만든다. ky는 이 snapshot을 재시도 판정에
 * 쓰지 않고 오류에 보관만 하며, 그 오류는 이 모듈 밖으로 나가지 않는다.
 */
const retrySignalOptions = {} as NormalizedOptions;

export interface ResilientRequest {
  readonly fetch: FetchImplementation;
  readonly target: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: BodyInit;
  readonly signal?: AbortSignal;
  readonly resilience?: TransportResilience;
}

function isRetryableMethod(method: string): boolean {
  const normalized = method.toLowerCase();
  return retryableMethods.some((allowed) => allowed === normalized);
}

function kyInput(target: string): string {
  return target.startsWith('/') ? `${sameOriginBase}${target}` : target;
}

/**
 * 주입된 fetch를 ky로 감싸 시간 제한과 재시도를 얹는다. ky의 `HTTPError`는 재시도를 시작시키는 내부 신호일
 * 뿐이며, 성공이든 실패든 호출자에게는 항상 `Response` 하나를 돌려주어 계약 판정이 유일한 해석 경로로 남는다.
 */
export async function sendWithResilience(request: ResilientRequest): Promise<Response> {
  const retryLimit =
    request.resilience && isRetryableMethod(request.method) ? request.resilience.retryLimit : 0;
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    body: request.body
  };

  try {
    return await ky(kyInput(request.target), {
      ...init,
      signal: request.signal,
      // 오류 응답은 지금처럼 계약이 읽는다. ky가 status만 보고 던지게 두면 새 오류 경로가 하나 더 생긴다.
      throwHttpErrors: false,
      timeout: request.resilience?.timeout ?? false,
      totalTimeout: request.resilience?.timeout,
      retry: {
        limit: retryLimit,
        methods: [...retryableMethods],
        statusCodes: retryableStatuses,
        afterStatusCodes: retryableStatuses
      },
      /**
       * 늦은 바인딩. ky가 module load 시점의 전역 fetch를 잡으면 Next가 감싼 fetch를 우회해 서버 캐시와
       * 계측이 조용히 죽으므로, 주입된 구현만 호출 시점에 부르고 ky가 만든 signal만 이어 붙인다.
       */
      fetch: async (attempt) => {
        // ky는 시도마다 자신이 만든 `Request`를 넘긴다. 선언된 입력 타입이 더 넓어 좁히기만 하고 값은 쓰지 않는다.
        const managed = attempt instanceof Request ? attempt : new Request(kyInput(request.target));
        // 예산이 없으면 transport가 스스로 끊을 이유가 없어 호출자의 signal을 그대로 넘기고, 예산이 있으면
        // 시간 제한과 호출자 취소를 함께 묶은 ky의 signal을 넘겨 취소가 실제 요청까지 닿게 한다.
        const signal = request.resilience ? managed.signal : request.signal;
        const response = await request.fetch(request.target, { ...init, signal });
        // ky는 던져진 오류만 재시도한다. 재시도 대상 status만 여기서 ky의 신호로 바꾸고 아래에서 응답으로 되돌린다.
        if (retryLimit > 0 && retryableStatuses.includes(response.status)) {
          throw new HTTPError(response, managed, retrySignalOptions);
        }
        return response;
      }
    });
  } catch (error) {
    // 재시도를 다 쓴 신호다. 본문을 읽지 않은 마지막 응답을 그대로 계약에 넘긴다.
    if (error instanceof HTTPError) return error.response;
    throw error;
  }
}
