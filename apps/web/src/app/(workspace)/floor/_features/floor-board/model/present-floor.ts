/**
 * @module 책임: 하한선 자리의 세 조회 결과(지역 목록·공고별 하한선·내 사업자 투찰)를 화면 하나가 쓰는 직렬화 가능한 표시 모델로 바꾼다.
 *
 * 서버(RSC)에서 한 번 돈다. 시각은 여기서 KST 글자와 epoch 밀리초로 바꿔 둔다 — 브라우저 묶음에 시간대 계산(Temporal)을 넣지
 * 않기 위해서다. 같은 기관 이름은 한 번만 싣고 점은 번호로 가리킨다. 3년 창이면 점이 수천 개라 이름을 점마다 실으면 문서가 두 배가 된다.
 */
import { Temporal } from '@eatbid/domain';
import type { FloorLineRegionsV1Response, FloorLinesV1Response, MyFloorBidsRead } from '@/api/floor-lines';

import type { FloorPeriod } from '@/app/(workspace)/floor/_lib/floor-period';

const WEEKDAY = ['', '월', '화', '수', '목', '금', '토', '일'];
const UNKNOWN_LABEL = '이름 없음';

export interface FloorRegionOption {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

export interface FloorRegionGroup {
  readonly id: string;
  readonly label: string;
  readonly sigungu: readonly FloorRegionOption[];
}

export interface FloorPoint {
  readonly attemptId: string;
  /** 개찰 시각 epoch 밀리초다. 그림의 가로축이다. */
  readonly t: number;
  /** KST 달(`2026-09`)이다. */
  readonly month: string;
  /** `2026.10.13(월) 10:00 개찰` */
  readonly opened: string;
  /** `2026.10.13` — 앞 다섯 글자를 떼면 `10.13`이다. */
  readonly date: string;
  /** 하한선, 기초금액 대비 %다. */
  readonly floor: number;
  /** `organizations` 안의 번호다. 이름이 관측되지 않았으면 null이다. */
  readonly organization: number | null;
  /** 기초금액(원)이다. 원 단위 문장에만 쓰고 계산 근거로 되돌려 보내지 않는다. */
  readonly baseAmount: number;
}

export interface FloorLadder {
  readonly attemptId: string;
  readonly validBidderCount: number;
  /** 하한 위로 낸 업체마다 가장 낮은 값, 낮은 순, 열 곳까지(기초금액 대비 %). */
  readonly lowest: readonly number[];
}

export type FloorMineOutcome =
  | { readonly kind: 'below-floor' }
  | { readonly kind: 'valid'; readonly rank: number; readonly validBidderCount: number; readonly won: boolean };

export interface FloorMineBid {
  readonly attemptId: string;
  readonly supplier: string;
  /** 기초금액 대비 %다. */
  readonly rate: number;
  readonly outcome: FloorMineOutcome;
}

/** 우리 값 층의 상태다. 운영자가 아니면 층 자체가 없고, 못 읽은 것과 넣은 공고가 없는 것은 다른 말을 한다. */
export type FloorMine =
  | { readonly kind: 'bids'; readonly bids: readonly FloorMineBid[]; readonly unlinkedBusinessCount: number }
  | { readonly kind: 'not-operator' }
  | { readonly kind: 'read-failed' };

export interface FloorProvenance {
  readonly ruleVersion: string;
  readonly ruleSourceRounds: number;
  readonly buildId: string | null;
  readonly computedAt: string | null;
}

export interface FloorData {
  readonly region: { readonly id: string; readonly sidoId: string; readonly place: string };
  readonly organizations: readonly string[];
  readonly points: readonly FloorPoint[];
  /** `1~10등` 층을 켰을 때만 배열이다. */
  readonly ladders: readonly FloorLadder[] | null;
  readonly mine: FloorMine;
  /** 확률 0.005~0.995의 하한선 분위수(기초금액 대비 %) 199개다. */
  readonly quantiles: readonly number[];
  readonly provenance: FloorProvenance;
}

/**
 * 화면 상태다. 지역 목록을 못 읽으면 고를 수조차 없어 따로 말하고, 지역을 아직 안 골랐거나 없는 지역이면 고르라고 한다.
 * 지역은 골랐는데 점을 못 읽은 것은 고르기 단추를 남긴 채 실패만 말한다. `regionId`는 시도한 시군구다 — 기간만 바꿔도 지역이
 * 남아야 하므로 고르기 막대가 이 값을 주소에 함께 싣는다.
 */
export type FloorScreenView =
  | { readonly kind: 'regions-failed'; readonly period: FloorPeriod }
  | {
      readonly kind: 'pick';
      readonly reason: 'none' | 'not-found' | 'empty';
      readonly groups: readonly FloorRegionGroup[];
      readonly period: FloorPeriod;
      readonly regionId: string | null;
    }
  | {
      readonly kind: 'lines-failed';
      readonly groups: readonly FloorRegionGroup[];
      readonly period: FloorPeriod;
      readonly regionId: string;
      readonly sidoId: string;
    }
  | { readonly kind: 'ready'; readonly groups: readonly FloorRegionGroup[]; readonly period: FloorPeriod; readonly data: FloorData };

export function presentRegionGroups(response: FloorLineRegionsV1Response): FloorRegionGroup[] {
  return response.groups
    .map((group) => ({
      id: group.sido.codeValueId,
      label: group.sido.label ?? UNKNOWN_LABEL,
      sigungu: group.sigungu
        .map((entry) => ({ id: entry.region.codeValueId, label: entry.region.label ?? UNKNOWN_LABEL, count: entry.pointCount }))
        .toSorted((left, right) => left.label.localeCompare(right.label, 'ko'))
    }))
    .toSorted((left, right) => left.label.localeCompare(right.label, 'ko'));
}

/** 고른 시군구가 어느 시도에 드는지 찾는다. 목록에 없으면 이 기간에 하한율 90% 공고가 없는 지역이다. */
export function findRegion(groups: readonly FloorRegionGroup[], regionId: string): { readonly group: FloorRegionGroup; readonly option: FloorRegionOption } | null {
  for (const group of groups) {
    const option = group.sigungu.find((entry) => entry.id === regionId);
    if (option !== undefined) return { group, option };
  }
  return null;
}

const pad = (value: number) => String(value).padStart(2, '0');

function openedText(local: Temporal.ZonedDateTime): string {
  return `${local.year}.${pad(local.month)}.${pad(local.day)}(${WEEKDAY[local.dayOfWeek]}) ${pad(local.hour)}:${pad(local.minute)} 개찰`;
}

function minuteText(local: Temporal.ZonedDateTime): string {
  return `${local.year}.${local.month}.${local.day} ${pad(local.hour)}:${pad(local.minute)}`;
}

function presentMine(read: MyFloorBidsRead | { readonly kind: 'read-failed' }): FloorMine {
  if (read.kind === 'forbidden') return { kind: 'not-operator' };
  if (read.kind !== 'bids') return { kind: 'read-failed' };
  return {
    kind: 'bids',
    unlinkedBusinessCount: read.response.meta.unlinkedBusinessCount,
    bids: read.response.bids.map((bid) => ({
      attemptId: bid.attemptId,
      supplier: bid.supplier.name ?? '내 업체',
      rate: Number(bid.rate.value),
      outcome:
        bid.outcome.kind === 'below-floor'
          ? { kind: 'below-floor' }
          : { kind: 'valid', rank: bid.outcome.rank, validBidderCount: bid.outcome.validBidderCount, won: bid.outcome.won }
    }))
  };
}

export function presentFloorData(input: {
  readonly lines: FloorLinesV1Response;
  readonly mine: MyFloorBidsRead | { readonly kind: 'read-failed' };
  readonly region: { readonly group: FloorRegionGroup; readonly option: FloorRegionOption };
}): FloorData {
  const organizations: string[] = [];
  const organizationIndex = new Map<string, number>();
  const points = input.lines.points
    .map((point): FloorPoint => {
      const opened = Temporal.Instant.from(point.openedAt);
      const local = opened.toZonedDateTimeISO('Asia/Seoul');
      let organization: number | null = null;
      if (point.organizationName !== null) {
        organization = organizationIndex.get(point.organizationName) ?? organizations.length;
        if (organization === organizations.length) {
          organizations.push(point.organizationName);
          organizationIndex.set(point.organizationName, organization);
        }
      }
      return {
        attemptId: point.attemptId,
        t: opened.epochMilliseconds,
        month: local.toPlainDate().toPlainYearMonth().toString(),
        opened: openedText(local),
        date: `${local.year}.${local.month}.${local.day}`,
        floor: Number(point.floor.value),
        organization,
        baseAmount: Number(point.baseAmount.amount)
      };
    })
    .toSorted((left, right) => left.t - right.t);
  const build = input.lines.meta.build;
  return {
    region: {
      id: input.region.option.id,
      sidoId: input.region.group.id,
      place: `${input.region.group.label} ${input.region.option.label}`
    },
    organizations,
    points,
    ladders:
      input.lines.ladders?.map((ladder) => ({
        attemptId: ladder.attemptId,
        validBidderCount: ladder.validBidderCount,
        lowest: ladder.lowest.values.map(Number)
      })) ?? null,
    mine: presentMine(input.mine),
    quantiles: input.lines.rule.quantiles.values.map(Number),
    provenance: {
      ruleVersion: input.lines.rule.version,
      ruleSourceRounds: input.lines.rule.sourceRounds,
      buildId: build.buildId,
      computedAt: build.computedAt === null ? null : minuteText(Temporal.Instant.from(build.computedAt).toZonedDateTimeISO('Asia/Seoul'))
    }
  };
}
