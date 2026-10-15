import { describe, expect, test } from 'bun:test';
import { Temporal } from '@eatbid/domain';

import { linesResponse, myBidsResponse, regionsResponse } from '@/app/(workspace)/floor/__fixtures__/floor-lines';
import { floorPeriod } from '@/entities/floor-line/floor-period';
import { findRegion, presentFloorData, presentRegionGroups } from '@/app/(workspace)/floor/_features/floor-board/model/present-floor';
import { presentRecentEntry } from '@/entities/floor-line/floor-entry';
import { presentSummary } from './present-summary';

const period = floorPeriod(Temporal.PlainDate.from('2026-10-15'), '1y');
const region = findRegion(presentRegionGroups(regionsResponse), '459')!;
const data = presentFloorData({ lines: linesResponse(), mine: { kind: 'bids', response: myBidsResponse() }, region });

describe('하한선 자리 요약', () => {
  test('범위는 사정률을 앞에, 기초금액 대비 %와 1억 공고 금액을 이름 붙여 함께 말한다', () => {
    const view = presentSummary(data, period);
    expect(view.headline).toBe('경남 김해시 · 최근 1년 하한율 90% 공고 243건');
    expect(view.range?.strong).toMatch(/^사정률 \d+\.\d~\d+\.\d$/);
    expect(view.range?.rest).toMatch(/기초금액의 \d+\.\d~\d+\.\d%, 1억이면 [\d,]+만 원~[\d,]+만 원이에요\.$/);
  });

  test('범위 바로 뒤에 그 안에 넣어도 절반은 하한 미달이라는 한계를 붙인다', () => {
    expect(presentSummary(data, period).caution).toStartWith('이 안에 넣으면 된다는 뜻이 아니에요. 가운데인 사정률');
  });

  test('이번 달 줄은 개찰이 끝난 공고를 최근 순으로 셋까지 사정률 소수 셋째 자리로 적는다', () => {
    expect(presentSummary(data, period).thisMonth).toBe(
      '이번 달(10월) 개찰이 끝난 하한율 90% 공고 3건 · 10.13 가상중학교13 사정률 99.708 · 10.8 가상중학교08 사정률 100.133 · 10.2 가상중학교02 사정률 99.556'
    );
  });

  test('공고가 적으면 범위를 말하지 않는다', () => {
    const view = presentSummary({ ...data, points: data.points.slice(0, 5) }, period);
    expect(view.range).toBeNull();
    expect(view.caution).toBe('이 기간엔 공고가 적어 범위를 말하기 어려워요.');
  });

  test('다른 화면의 입구 줄과 같은 창·같은 함수라 범위와 이번 달 수가 같다', () => {
    const entry = presentRecentEntry({ response: linesResponse(), place: '김해시', regionId: '459', currentMonth: period.currentMonth, form: 'mine' });
    const view = presentSummary(data, period);
    expect(entry.strong).toBe(view.range?.strong ?? null);
    expect(entry.rest).toContain('이번 달 개찰 3건');
    expect(view.thisMonth).toContain('공고 3건');
  });
});
