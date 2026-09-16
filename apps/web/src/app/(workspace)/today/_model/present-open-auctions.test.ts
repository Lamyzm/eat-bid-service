import { describe, expect, test } from 'bun:test';

import { fixtureNow, laterRow, noSnapshotFixture, openAuctionsFixture, todayRow, tomorrowRow, unknownClosesRow } from '../__fixtures__/open-auctions';
import { dDayOf, presentOpenAuction, presentOpenAuctionList } from './present-open-auctions';

describe('열린 공고 표시 변환', () => {
  test('KST 자정 직전 마감은 오늘 마감으로 세고 시각만 보인다', () => {
    // KST 2026-09-07 23:59 = UTC 14:59, 기준 시각은 KST 10:30.
    const presented = presentOpenAuction({ ...todayRow, closesAt: '2026-09-07T14:59:00Z' }, fixtureNow);
    expect(presented.closes).toEqual({ tone: 'today', label: '오늘', clockText: '23:59', dDay: 0, at: '2026-09-07T14:59:00Z' });
  });

  test('UTC로는 같은 날이지만 KST로 다음 날인 마감은 D-1이다', () => {
    expect(dDayOf(tomorrowRow.closesAt!, fixtureNow)).toBe(1);
    const presented = presentOpenAuction(tomorrowRow, fixtureNow);
    expect(presented.closes).toEqual({ tone: 'tomorrow', label: '내일', clockText: '00:30', dDay: 1, at: tomorrowRow.closesAt });
    // 사흘 뒤는 날짜까지 보인다.
    expect(presentOpenAuction(laterRow, fixtureNow).closes).toEqual({ tone: 'later', label: '사흘 뒤', clockText: '11:00', dDay: 3, at: laterRow.closesAt });
  });

  test('마감을 관측하지 못한 행은 미확인이고 D-day가 없다', () => {
    expect(presentOpenAuction(unknownClosesRow, fixtureNow).closes).toEqual({ tone: 'unknown', label: '마감 미확인', clockText: '', dDay: null, at: null });
  });

  test('기관이 없는 행과 기관 이름만 없는 행은 다른 문구를 낸다', () => {
    expect(presentOpenAuction(laterRow, fixtureNow).organization).toEqual({ text: '기관 미확인', tone: 'missing', organizationId: null, type: null });
    expect(presentOpenAuction(tomorrowRow, fixtureNow).organization).toEqual({ text: '이름 미확인', tone: 'unnamed', organizationId: '3102', type: 'school' });
    expect(presentOpenAuction(todayRow, fixtureNow).organization).toMatchObject({ text: '창원 남산초등학교', tone: 'named', type: 'unknown' });
  });

  test('상세를 아직 따지 않은 행은 품목·하한·지역·금액이 미확인이고 값을 지어내지 않는다', () => {
    const presented = presentOpenAuction(laterRow, fixtureNow);
    expect(presented.itemLabel).toBeNull();
    expect(presented.floorRateText).toBe('미확인');
    expect(presented.region).toEqual({ sido: null, sigungu: null });
    expect(presented.baseAmountText).toBe('미확인');
    // 참여 0은 빈 문자열이다. 값을 버리는 것이 아니라 전면에 세우지 않는 것이며(사용자 결정 2026-09-16),
    // 못 센 판의 `—`와 섞이지 않는다.
    expect(presented.bidCountText).toBe('');
    expect(presented.orgSummary).toBeNull();
  });

  test('참여를 못 센 판은 0이 아니라 —다', () => {
    expect(presentOpenAuction(tomorrowRow, fixtureNow).bidCountText).toBe('—');
    expect(presentOpenAuction(todayRow, fixtureNow).bidCountText).toBe('5');
  });

  test('금액은 천 단위 구분이고 기관 요약은 직전 회차의 명단·개찰일을 싣되 낙찰 투찰률은 싣지 않는다', () => {
    const presented = presentOpenAuction(todayRow, fixtureNow);
    expect(presented.baseAmountText).toBe('2,761,700');
    expect(presented.floorRateText).toBe('90');
    expect(presented.region).toEqual({ sido: { codeValueId: '41', text: '경상남도' }, sigungu: { codeValueId: '43', text: '창원시' } });
    // 낙찰 투찰률은 표시 모델에 아예 없다. 같은 값이 행마다 서면 앵커링이다(decision-support §11).
    expect(presented.orgSummary).toEqual({
      attemptCount: 17,
      medianListText: '5',
      listCountSampleCount: 12,
      lastRound: { kind: 'observed', listText: '17곳', dateText: '09-02' }
    });
    // 개찰된 회차가 없는 기관과 명단을 관측하지 못한 회차는 다른 문구다. 0곳으로 채우면 아무도 안 들어온
    // 판이 된다(AGENTS 3).
    expect(presentOpenAuction(tomorrowRow, fixtureNow).orgSummary).toMatchObject({
      medianListText: '—',
      lastRound: { kind: 'none', text: '개찰 회차 없음' }
    });
    expect(presentOpenAuction({
      ...todayRow,
      orgSummary: { ...todayRow.orgSummary!, lastRound: { ...todayRow.orgSummary!.lastRound!, listCount: null, belowDayFloorCount: null } }
    }, fixtureNow).orgSummary!.lastRound).toEqual({ kind: 'observed', listText: '명단 미관측', dateText: '09-02' });
  });

  test('같은 하한율에서 본 회차가 없는 행은 값을 지어내지 않고 그 사실을 말한다', () => {
    // 요약의 코호트는 (기관, 하한율)이다. 코호트가 비어 있는 것과 요약 자체가 없는 것은 다른 사실이다.
    const emptyCohort = presentOpenAuction({
      ...todayRow,
      orgSummary: { attemptCount: 0, medianListCount: null, listCountSampleCount: 0, lastRound: null }
    }, fixtureNow);
    expect(emptyCohort.orgSummary).toEqual({
      attemptCount: 0,
      medianListText: '—',
      listCountSampleCount: 0,
      lastRound: { kind: 'none', text: '같은 하한 회차 없음' }
    });
    // 하한율을 관측하지 못한 행은 코호트를 만들 수 없어 요약 블록이 통째로 없다.
    expect(presentOpenAuction(laterRow, fixtureNow).orgSummary).toBeNull();
  });

  test('활성 build가 없는 것과 조건에 맞는 공고가 없는 것을 다른 종류로 낸다', () => {
    // build가 없으면 목록이 비어 있어도 "공고가 없다"고 말할 수 없다. 종류를 화면이 아니라 여기서 정한다.
    expect(presentOpenAuctionList(noSnapshotFixture, fixtureNow).view).toEqual({ kind: 'no-snapshot' });
    const empty = { ...openAuctionsFixture, auctions: [], meta: { ...openAuctionsFixture.meta, sampleCount: 0 } };
    expect(presentOpenAuctionList(empty, fixtureNow).view).toEqual({ kind: 'empty' });
  });

  test('목록 표시는 응답 순서를 그대로 두고 기준 시각과 두 build의 계보를 줄로 낸다', () => {
    const presentation = presentOpenAuctionList(openAuctionsFixture, fixtureNow);
    expect(presentation.view.kind).toBe('list');
    const rows = presentation.view.kind === 'list' ? presentation.view.rows : [];
    expect(rows.map((row) => row.auctionAttemptId)).toEqual(['5796468', '5796470', '5796471', '5796472']);
    expect(presentation.sampleCount).toBe(4);
    expect(presentation.asOfText).toBe('09-07 10:30');
    // 한 문장으로 이으면 좁은 기둥에서 줄바꿈 자리가 폭에 따라 달라져 어디까지가 스냅샷 얘기인지 흐려진다.
    expect(presentation.lineageLines).toEqual([
      '열린 공고 스냅샷 build 601 · mart-r2 · 09-07 10:00 산출',
      '지역 체계 eat:auction-location-sigungu',
      '기관 회차 요약 build 501 · mart-r1'
    ]);
  });
});
