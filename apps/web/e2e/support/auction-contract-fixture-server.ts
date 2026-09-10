import { auctionV1Operations, auctionV1ResponseSchema } from '@eatbid/contracts/api/v1/auctions';

import {
  ACTIVATE_BUILD_PATH,
  COUNTS_PATH,
  RESET_PATH,
  activateNextBuild,
  countRequest,
  observedCounts,
  resetObservations
} from './cache-observability';
import { auctionRosterResponse } from './auction-roster-fixture';
import { myBusinessesResponse } from './my-businesses-fixture';
import { openAuctionsResponse } from './open-auctions-fixture';
import { sessionResponse } from './session-fixture';
import { organizationAttemptsResponse } from './organization-attempts-fixture';
import { winRateDistributionResponse } from './win-rate-distribution-fixture';

// 호가창이 코호트를 만들 재료다. 하한율 90·낙찰방식 003·경남 창원은 남산초 실관측 회차의 값이며
// 이 셋이 없으면 비교집단 탭이 조회 자체를 만들지 못한다.
const COHORT_TERMS = {
  floorRate: { value: '90.000', unit: 'percentage-points' },
  awardMethod: { codeValueId: '31', code: '003', scheme: 'eat:award-method', label: '적격심사' }
} as const;
const COHORT_LOCATION = {
  sido: { codeValueId: '41', code: '48', scheme: 'eat:auction-location-sido', label: '경상남도' },
  sigungu: { codeValueId: '43', code: '48120', scheme: 'eat:auction-location-sigungu', label: '창원시' }
} as const;
const COHORT_CLASSIFICATION = { itemLabel: '축산' } as const;

const HOSTNAME = '127.0.0.1';
// 캐시 e2e는 프로덕션 빌드로 도는 별도 web 인스턴스를 쓰므로 fixture도 자기 포트에서 따로 뜬다.
// 두 스위트가 같은 fixture 프로세스를 공유하면 요청 카운터가 서로 섞인다.
const PORT = Number(process.env.EATBID_FIXTURE_PORT ?? 4410);
const SUCCESS_AUCTION_ID = '9007199254740993';
const FAILURE_AUCTION_ID = '9007199254740994';
const MISSING_AUCTION_ID = '9007199254740996';
const REDUCED_MOTION_AUCTION_ID = '9007199254741000';
const OPEN_AUCTION_ID = '5796468';
const CLOSED_AUCTION_ID = '5780681';
const LONG_HEADER_AUCTION_ID = '5796470';
const SUCCESS_RESPONSE_DELAY_MILLISECONDS = 350;
const REDUCED_MOTION_RESPONSE_DELAY_MILLISECONDS = 5_000;
const OPEN_DEADLINE_OFFSET_MILLISECONDS = 24 * 60 * 60 * 1_000;
const OPEN_OPENED_OFFSET_MILLISECONDS = 27 * 60 * 60 * 1_000;
const CLOSED_DEADLINE_OFFSET_MILLISECONDS = -2 * 24 * 60 * 60 * 1_000;
const CLOSED_OPENED_OFFSET_MILLISECONDS = CLOSED_DEADLINE_OFFSET_MILLISECONDS + 3 * 60 * 60 * 1_000;

// `Date#toISOString()`은 항상 밀리초 3자리를 붙이는데, instantTextSchema는 소수부 마지막 자리가
// 0이면(트레일링 제로) 거부한다. offset 계산은 요청 시각(ms)에 의존해 밀리초가 매번 달라지므로
// 그 자리가 0으로 떨어지는 순간(10회 중 1회꼴)마다 fixture 응답이 계약 검증에서 깨진다. 초 단위로
// 내려 소수부 자체를 없애 이 경합을 구조적으로 제거한다.
function instantSecondsIso(millis: number): string {
  return new Date(Math.floor(millis / 1_000) * 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function auctionResponse(auctionId: string) {
  return auctionV1ResponseSchema.parse({
    identity: {
      auctionId,
      revisionId: '9007199254740995',
      externalBidId: 'fixture-opaque-id',
      displayBidNumber: null,
      title: '급식 식재료',
      status: 'OPEN'
    },
    organization: { organizationId: '3101', name: '창원 남산초등학교', type: 'school' },
    schedule: {
      announcedAt: '2026-08-30T00:00:00Z',
      deadlineAt: null,
      openedAt: null
    },
    pricing: {
      baseAmount: { amount: '1234567890.50', currency: 'KRW' },
      plannedAmount: null
    },
    provenance: {
      sourceSystem: 'eat',
      observationId: '9007199254740997',
      normalizedRecordId: '9007199254740999',
      contentSha256: 'a'.repeat(64)
    },
    terms: COHORT_TERMS,
    location: COHORT_LOCATION,
    classification: COHORT_CLASSIFICATION,
    participation: null
  });
}

// rail 상태(진행 중)는 응답 시각과 마감·개찰의 상대 위치로만 판정된다(EAT-36). 고정 시각을 쓰면 테스트를
// 실행하는 날짜가 마감을 지나는 순간부터 배너 문장이 바뀌어 폭 검사가 흔들린다. 요청을 받은 순간 기준
// +1일(마감)·+1일 3시간(개찰)으로 매번 다시 계산해 진행 중 상태를 항상 재현한다.
function openAuctionResponse(auctionId: string) {
  const now = Date.now();
  return auctionV1ResponseSchema.parse({
    identity: {
      auctionId,
      revisionId: '5796469',
      externalBidId: 'fixture-open-opaque-id',
      displayBidNumber: null,
      title: '창원 남산초등학교 축산물 구매',
      status: 'OPEN'
    },
    organization: { organizationId: '3101', name: '창원 남산초등학교', type: 'school' },
    schedule: {
      announcedAt: '2026-09-01T00:00:00Z',
      deadlineAt: instantSecondsIso(now + OPEN_DEADLINE_OFFSET_MILLISECONDS),
      openedAt: instantSecondsIso(now + OPEN_OPENED_OFFSET_MILLISECONDS)
    },
    pricing: {
      baseAmount: { amount: '2761700.00', currency: 'KRW' },
      plannedAmount: null
    },
    provenance: {
      sourceSystem: 'eat',
      observationId: '9007199254740997',
      normalizedRecordId: '9007199254740999',
      contentSha256: 'a'.repeat(64)
    },
    terms: COHORT_TERMS,
    location: COHORT_LOCATION,
    classification: COHORT_CLASSIFICATION,
    // 목록 관측 BID_CNT다. 요청 30분 전 4곳, 25시간 전 2곳이라 상세가 "…기준 · (그 날짜) 대비 +2"를 그린다.
    // 두 관측이 25시간 떨어져 있어 KST 달력일이 반드시 달라지고, 표시된 비교 날짜가 최신 날짜와 다른지 볼 수 있다.
    participation: {
      latest: { bidCount: 4, observedAt: instantSecondsIso(now - 30 * 60 * 1000) },
      dayEarlier: { bidCount: 2, observedAt: instantSecondsIso(now - 25 * 60 * 60 * 1000) }
    }
  });
}

// 운영에서 관측된 긴 헤더 재료다(EAT-82). 기관명이 길고 품목 라벨이 쉼표로 이어진 여러 품목이면 헤더 칩 줄이
// 768폭 근거 열을 넘겨 문서를 가로로 밀었다. 남산초 코호트는 그대로 두어 과거 회차·비교집단 fixture가 같은
// 조회로 채워지게 하고 헤더 재료만 바꾼다.
function longHeaderAuctionResponse(auctionId: string) {
  const open = openAuctionResponse(auctionId);
  return auctionV1ResponseSchema.parse({
    ...open,
    identity: {
      ...open.identity,
      externalBidId: 'fixture-long-header-opaque-id',
      displayBidNumber: 'E260818-651960-0',
      title: '금정구종합사회복지관식자재납품업체 선정입찰공고'
    },
    classification: { itemLabel: '농산물 , 수산물 , 육류 , 가공식품 , 김치류 , 곡류 , 가금류' }
  });
}

// 개찰 완료 rail 상태도 같은 이유로 요청 시각 기준 상대 오프셋으로 매번 다시 계산한다(마감 −2일,
// 개찰 −2일+3시간, 둘 다 과거라 항상 개찰 완료로 판정된다).
function closedAuctionResponse(auctionId: string) {
  const now = Date.now();
  return auctionV1ResponseSchema.parse({
    identity: {
      auctionId,
      revisionId: '5780682',
      externalBidId: 'fixture-closed-opaque-id',
      displayBidNumber: null,
      title: '개찰 완료 공고',
      status: 'CLOSED'
    },
    organization: { organizationId: '3101', name: '창원 남산초등학교', type: 'school' },
    schedule: {
      announcedAt: '2026-08-10T00:00:00Z',
      deadlineAt: instantSecondsIso(now + CLOSED_DEADLINE_OFFSET_MILLISECONDS),
      openedAt: instantSecondsIso(now + CLOSED_OPENED_OFFSET_MILLISECONDS)
    },
    pricing: {
      baseAmount: { amount: '2761700.00', currency: 'KRW' },
      plannedAmount: null
    },
    provenance: {
      sourceSystem: 'eat',
      observationId: '9007199254740997',
      normalizedRecordId: '9007199254740999',
      contentSha256: 'a'.repeat(64)
    },
    terms: COHORT_TERMS,
    location: COHORT_LOCATION,
    classification: COHORT_CLASSIFICATION,
    // 마감 직전 관측 하나만 남은 개찰 완료 공고다. 하루 전 관측이 없으면 증감을 그리지 않는다.
    participation: {
      latest: { bidCount: 13, observedAt: instantSecondsIso(now + CLOSED_DEADLINE_OFFSET_MILLISECONDS - 10 * 60 * 1000) },
      dayEarlier: null
    }
  });
}

function auctionPath(auctionId: string): string {
  return auctionV1Operations.find.buildPath({ path: { auctionId } });
}

function problemResponse(status: 404 | 503): Response {
  const problem = auctionV1Operations.find.problemResponses[status].schema.parse(
    status === 404
      ? {
          type: 'https://eatbid.dev/problems/auction-not-found',
          title: '공고를 찾을 수 없음',
          status,
          code: 'AUCTION_NOT_FOUND',
          requestId: 'fixture-request-404'
        }
      : {
          type: 'https://eatbid.dev/problems/dependency-unavailable',
          title: '의존성을 사용할 수 없음',
          status,
          code: 'DEPENDENCY_UNAVAILABLE',
          requestId: 'fixture-request-503'
        }
  );
  return Response.json(problem, { status });
}

/** 공개 operation만 재현하며 제품 코드에서 import하지 않는 브라우저 검증 전용 서버다. */
Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') return new Response('ok');
    // 관측·제어 경로는 계약 operation이 아니라 캐시 e2e가 쓰는 검증 표면이다. `__` 접두사로 공개
    // 경로와 겹치지 않게 두고, 요청 카운터보다 앞에 두어 제어 호출 자체가 카운트되지 않게 한다.
    if (pathname === COUNTS_PATH) return Response.json(observedCounts());
    if (pathname === ACTIVATE_BUILD_PATH) return Response.json({ activations: activateNextBuild() });
    if (pathname === RESET_PATH) {
      resetObservations();
      return new Response(null, { status: 204 });
    }
    countRequest(pathname);
    if (request.method !== 'GET') return new Response(null, { status: 405 });

    // 로그인 게이트가 걸린 뒤로 업무 화면은 세션 계약을 먼저 읽는다. 이 fixture가 답하지 않으면
    // 모든 스위트가 화면이 아니라 게이트에서 멈춘다.
    const session = sessionResponse(request);
    if (session) return session;

    // 설정 화면은 세션 다음에 등록 사업자 목록을 읽는다. 서버가 읽어 넘긴 목록이 첫 페인트에 있는지
    // 보려면 이 응답이 있어야 한다.
    const businesses = myBusinessesResponse(request);
    if (businesses) return businesses;

    // 목록 경로는 `:auctionId` 경로보다 앞에서 본다. 경로가 다르므로 순서는 읽기 편의일 뿐이다.
    const openAuctions = openAuctionsResponse(request);
    if (openAuctions) return openAuctions;

    // 명단은 `:auctionId/roster`라 상세 경로와 구별되지만, 상세 분기가 pathname 완전 일치이므로 앞에 둔다.
    const roster = auctionRosterResponse(request);
    if (roster) return roster;

    if (pathname === auctionPath(SUCCESS_AUCTION_ID)) {
      await Bun.sleep(SUCCESS_RESPONSE_DELAY_MILLISECONDS);
      return Response.json(auctionResponse(SUCCESS_AUCTION_ID));
    }
    if (pathname === auctionPath(REDUCED_MOTION_AUCTION_ID)) {
      await Bun.sleep(REDUCED_MOTION_RESPONSE_DELAY_MILLISECONDS);
      return Response.json(auctionResponse(REDUCED_MOTION_AUCTION_ID));
    }
    if (pathname === auctionPath(OPEN_AUCTION_ID)) return Response.json(openAuctionResponse(OPEN_AUCTION_ID));
    if (pathname === auctionPath(CLOSED_AUCTION_ID)) return Response.json(closedAuctionResponse(CLOSED_AUCTION_ID));
    if (pathname === auctionPath(LONG_HEADER_AUCTION_ID)) return Response.json(longHeaderAuctionResponse(LONG_HEADER_AUCTION_ID));
    if (pathname === auctionPath(FAILURE_AUCTION_ID)) return problemResponse(503);
    if (pathname === auctionPath(MISSING_AUCTION_ID)) return problemResponse(404);

    const organizationResponse = organizationAttemptsResponse(request);
    if (organizationResponse) return organizationResponse;

    const distributionResponse = winRateDistributionResponse(request);
    if (distributionResponse) return distributionResponse;

    return new Response(null, { status: 404 });
  }
});
