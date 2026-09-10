import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import { attemptsFixture } from '../../../__fixtures__/attempts';
import { presentHistory } from '../../history/model/attempt-history';
import { BidRateProvider } from '../../../_lib/bid-rate-context';
import { FlowChart } from './flow-chart';

const presentation = presentHistory(attemptsFixture, '7');
function show(value = presentation, focus = false) {
  return render(<BidRateProvider initialRate={null}><FlowChart presentation={value} myRate={null} focus={focus} /></BidRateProvider>);
}

describe('캔버스 흐름의 접근 가능한 표시와 조작', () => {
  test('같은 표시 모델의 정확한 분모와 표본을 보이고 SVG 그림을 복제하지 않는다', () => {
    const screen = show();
    expect(screen.getByRole('figure', { name: '회차별 낙찰률 흐름' })).toBeTruthy();
    // 캔버스 자리는 맨 div가 아니라 이름을 가진 그림이다. 맨 div면 role이 generic이라 이름이 무시된다.
    expect(screen.getByRole('img', { name: /^낙찰률 차트\./ })).toBe(screen.container.querySelector<HTMLElement>('[data-slot=flow-canvas]')!);
    expect(screen.getByText('예정가격 대비 · %')).toBeTruthy();
    expect(screen.getByText('20회 표시 · 조회 표본 92회')).toBeTruthy();
    expect(screen.container.querySelector('svg')).toBeNull();
  });

  test('휠을 못 쓰는 이용자도 확대·축소·범위 복귀 버튼에 접근할 수 있다', () => {
    const screen = show();
    for (const name of ['비율 축 확대', '비율 축 축소', '전체 값', '기본 범위']) expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  test('일반 보기와 집중 보기의 휠 역할을 구별한다', () => {
    const normal = show();
    expect(normal.getByText(/일반 휠은 페이지 이동/)).toBeTruthy();
    normal.unmount();
    expect(show(presentation, true).getByText(/휠로 날짜 확대/)).toBeTruthy();
  });

  test('빈 조건을 정상 0 값으로 채우지 않고 기록 없음으로 표시한다', () => {
    const screen = show({ ...presentation, rows: [], sampleCount: 0 });
    expect(screen.getByText('선택한 조건의 낙찰 기록이 없습니다.')).toBeTruthy();
    expect(screen.container.querySelector('[data-slot=flow-canvas]')).toBeNull();
  });

  test('낙찰 기록이 없어도 개찰일이 있으면 캔버스 자리를 만들고 낙찰 없음을 문장으로 말한다', () => {
    const noWins = { ...presentation, rows: presentation.rows.map((row) => ({ ...row, winRateText: null, winRateMilli: null })) };
    const screen = show(noWins);
    expect(screen.container.querySelector('[data-slot=flow-canvas]')).not.toBeNull();
    expect(screen.getByText('선택한 조건의 낙찰 기록이 없습니다.')).toBeTruthy();
  });

  test('own provider가 없으면 내 투찰 점을 0으로 표시하고 캔버스 조작은 그대로다', () => {
    const screen = show();
    expect(screen.getByRole('figure').getAttribute('data-own-points')).toBe('0');
    expect(screen.getByRole('button', { name: '전체 값' })).toBeTruthy();
  });

  test('차트에는 읽을 값과 조건만 보이고 운영 추적 식별자는 노출하지 않는다', () => {
    const screen = show();
    expect(screen.queryByText('자료 기준')).toBeNull();
    expect(screen.container.textContent).not.toContain('build 501');
    expect(screen.queryByText('내 값 90.000')).toBeNull();
  });
});
