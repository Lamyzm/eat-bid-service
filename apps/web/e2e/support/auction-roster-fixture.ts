/** @module 책임: 회차 명단 조회(getAuctionRoster) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다. 선택한 회차의 실제 명단이 오른쪽 패널에 열리는지 보려면 이 응답이 필요하다. */
import { auctionRosterV1ResponseSchema, auctionV1Operations } from '@eatbid/contracts/api/v1/auctions';

import namsanAttemptsFixture from './fixtures/namsan-attempts.json';

const operation = auctionV1Operations.roster;
const ROSTER_PATH_PATTERN = new RegExp(`^${operation.openApiPath.replace('{auctionId}', '([^/]+)')}$`);

type FixtureAttempt = {
  readonly attemptId: string;
  readonly winRate: { readonly value: string } | null;
  readonly secondRate: { readonly value: string } | null;
  readonly listCount: number | null;
};

const NAMSAN_ATTEMPTS = (namsanAttemptsFixture as { readonly attempts: readonly FixtureAttempt[] }).attempts;

const OBSERVED_AT = '2026-09-06T17:18:17Z';
const PROVENANCE = {
  sourceSystem: 'eat',
  observationId: '4',
  normalizedRecordId: '5',
  contentSha256: 'b'.repeat(64)
} as const;

// 원천 BID_CALC_AMT의 자리표시자다. 제출 금액과 같은 값으로 채우면 화면이 두 사실을 구분하지 못한다(ADR 0041).
const SOURCE_CALCULATED_PLACEHOLDER = { amount: '10000000043768.00', currency: 'KRW' } as const;
const BASE_AMOUNT = 2_761_700;

function statusOf(rank: number): { readonly codeValueId: string; readonly code: string; readonly scheme: string; readonly label: string } {
  return rank === 1
    ? { codeValueId: '2', code: '001', scheme: 'eat:bid-status', label: '낙찰' }
    : { codeValueId: '3', code: '005', scheme: 'eat:bid-status', label: '낙찰실패' };
}

/**
 * 명단 행은 회차의 관측 낙찰률에서 규칙적으로 벌린 합성 값이다. 실제 업체 이름을 쓰지 않으며 순위와
 * 비율의 관계(1등이 낙찰률, 2등이 2등가)만 화면이 읽을 수 있게 유지한다.
 */
function submissions(attempt: FixtureAttempt, count: number) {
  const winRate = Number(attempt.winRate?.value ?? '90.500');
  const secondRate = Number(attempt.secondRate?.value ?? (winRate + 0.05).toFixed(3));
  return Array.from({ length: count }, (_, index) => {
    const rank = index + 1;
    const rate = rank === 1 ? winRate : rank === 2 ? secondRate : Number((secondRate + index * 0.037).toFixed(3));
    return {
      submissionId: `${attempt.attemptId}${rank.toString().padStart(3, '0')}`,
      rosterOrdinal: index,
      supplier: {
        supplierPartyId: `${9000 + rank}`,
        sourceSupplierAccountId: `${8000 + rank}`,
        name: `합성 참여업체 ${rank}`
      },
      sourceCalculatedAmount: SOURCE_CALCULATED_PLACEHOLDER,
      // 계약은 소수 두 자리 정확값만 받는다. 부동소수 나눗셈 결과를 그대로 문자열로 만들면 자릿수가 흔들린다.
      submittedAmount: { amount: (BASE_AMOUNT * (rate / 100)).toFixed(2), currency: 'KRW' },
      bidRate: { value: rate.toFixed(3), unit: 'percentage-points' },
      rank,
      submittedAt: null,
      sourceStatus: statusOf(rank),
      withdrawal: null
    };
  });
}

/** 이 operation 경로가 아니면 null을 돌려줘 호출부가 다음 route로 넘어가게 한다. */
export function auctionRosterResponse(request: Request): Response | null {
  const url = new URL(request.url);
  const match = url.pathname.match(ROSTER_PATH_PATTERN);
  if (!match) return null;

  const auctionId = decodeURIComponent(match[1]!);
  // 화면이 고정한 revision을 그대로 되돌린다. 요청이 없으면 최신 해석(여기서는 99)이다.
  const revisionId = url.searchParams.get('revisionId') ?? '99';
  const attempt = NAMSAN_ATTEMPTS.find((candidate) => candidate.attemptId === auctionId);
  // 이 fixture가 모르는 회차는 명단 블록을 관측하지 못한 회차로 답한다. 빈 배열을 실제 0명으로 꾸미지 않는다.
  if (!attempt || attempt.listCount === null || attempt.listCount === 0) {
    return Response.json(
      auctionRosterV1ResponseSchema.parse({
        auctionId,
        revisionId,
        state: 'not-observed',
        rows: [],
        award: null,
        meta: { rowCount: 0, sourceRosterSize: null, observedAt: OBSERVED_AT, provenance: PROVENANCE }
      })
    );
  }

  // 명단 수가 큰 회차도 그대로 그리면 패널 높이 회귀를 볼 수 있다. 관측 수를 줄여 꾸미지 않는다.
  const rows = submissions(attempt, attempt.listCount);
  return Response.json(
    auctionRosterV1ResponseSchema.parse({
      auctionId,
      revisionId,
      state: 'observed',
      rows,
      award: {
        rosterOrdinal: 0,
        sourceCalculatedAmount: SOURCE_CALCULATED_PLACEHOLDER,
        bidRate: rows[0]!.bidRate,
        secondRate: rows[1]?.bidRate ?? null
      },
      meta: {
        rowCount: rows.length,
        sourceRosterSize: rows.length,
        observedAt: OBSERVED_AT,
        provenance: PROVENANCE
      }
    })
  );
}
