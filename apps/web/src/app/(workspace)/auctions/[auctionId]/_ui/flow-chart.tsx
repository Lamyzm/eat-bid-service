/** @module 책임: 기관 흐름 차트의 기존 표시 모델·계열 토글·오른쪽 회차 선택·내 투찰 점을 캔버스와 접근 가능한 조작에 연결한다. */
'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Button } from '@/shared/ui/button';
import type { HistoryPresentation } from '../_model/attempt-history';
import { buildFlowChartModel, type FlowInspection } from '../_model/flow-chart-model';
import { decideMyRateLine } from '../_model/flow-series';
import { buildOwnPoints, type OwnChartPoint } from '../_model/own-bid-points';
import { useBidRate } from './bid-rate-context';
import { useFlowSeriesVisibility } from './flow-legend';
import { useOptionalAttemptSelection } from './attempt-selection';
import { useOptionalOwnBid } from './own-bid/own-bid-context';
import type { FlowChartController } from './create-flow-chart';

type Props = { readonly presentation: HistoryPresentation; readonly myRate: string | null; readonly focus?: boolean };

// provider가 없거나 점이 없는 동안 같은 참조를 돌려줘 effect가 헛돌지 않게 한다.
const NO_OWN_POINTS: readonly OwnChartPoint[] = [];

function dayLabel(item: FlowInspection): string {
  const { row } = item.point;
  return `${row.openedYear}.${row.openedText.slice(3).replace('-', '.')}`;
}

function InspectionButton({ item, onChoose, disabled }: { readonly item: FlowInspection; readonly onChoose: (attemptId: string) => void; readonly disabled: boolean }) {
  const { row } = item.point;
  return (
    <Button variant='secondary' size='sm' onClick={() => onChoose(row.attemptId)} disabled={disabled}>
      {item.kind === 'win'
        ? `${dayLabel(item)} · ${row.itemLabel} · ${row.winRateText}% · 회차 ${row.attemptId}`
        // 실제 제출은 exact 비율과 관측 금액을 그대로 읽는다. 금액이 없으면 계산 금액으로 채우지 않는다.
        : `${dayLabel(item)} · 내 투찰 ${item.point.rateText}% · ${item.point.amountText === null ? '금액 미확인' : `${item.point.amountText}원`} · 회차 ${row.attemptId}`}
    </Button>
  );
}

function FlowChartCanvas({ presentation, myRate, focus = false }: Props) {
  const [model] = useState(() => buildFlowChartModel(presentation));
  const [inspection, setInspection] = useState<readonly FlowInspection[]>([]);
  const [error, setError] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const controller = useRef<FlowChartController | null>(null);
  const selection = useOptionalAttemptSelection();
  const visible = useFlowSeriesVisibility();
  const { rate } = useBidRate();
  const ownBid = useOptionalOwnBid();
  // 점 좌표는 회차 행이 있어야 만들 수 있고 그 행은 이 차트가 이미 갖고 있다. provider는 관측만 넘긴다(EAT-139).
  const observations = ownBid?.observations ?? null;
  const ownPoints = useMemo(
    () => (observations === null ? NO_OWN_POINTS : buildOwnPoints(presentation.rows, observations)),
    [observations, presentation.rows]
  );
  const line = decideMyRateLine({ myRate, bidRate: rate });
  const ownRate = line.kind === 'drawn' ? line.rate : null;
  const inspect = useEffectEvent((items: readonly FlowInspection[], choose: boolean) => {
    setInspection(items);
    if (choose && items.length === 1) selection?.select(items[0]!.point.row.attemptId);
  });
  const initialize = useEffectEvent((api: FlowChartController) => {
    api.update(visible, ownRate);
    api.focus(focus);
    api.select(selection?.attempt?.attemptId);
    api.setOwnSubmissions(ownPoints);
  });
  useEffect(() => {
    let cancelled = false;
    // 큰 엔진을 서버 렌더나 다른 탭의 초기 bundle에 넣지 않는다. 늦게 도착한 import는 해제된 DOM을 만들지 않는다.
    // 낙찰 점이 하나도 없어도 개찰일 달력이 있으면 엔진을 세운다. 내 투찰만 있는 회차도 그려야 한다.
    import('./create-flow-chart').then(({ createFlowChart }) => {
      if (cancelled || !element.current || model.calendar.length === 0) return;
      const api = createFlowChart(element.current, model, (items, choose) => inspect(items, choose));
      controller.current = api;
      initialize(api);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; controller.current?.remove(); controller.current = null; };
  }, [model]);
  useEffect(() => { controller.current?.update(visible, ownRate); }, [visible, ownRate]);
  useEffect(() => { controller.current?.focus(focus); }, [focus]);
  useEffect(() => { controller.current?.select(selection?.attempt?.attemptId); }, [selection?.attempt?.attemptId]);
  // own 계열만 갈아 끼운다. 캔버스를 다시 만들거나 범위를 되돌리지 않으므로 사용자의 확대·선택이 유지된다.
  useEffect(() => { controller.current?.setOwnSubmissions(ownPoints); }, [ownPoints]);
  // 후보 버튼은 현재 점 집합에 있는 제출만 보인다. 사업자·계정이 바뀌면 이전 제출의 비율·금액이 담긴 버튼이
  // 다음 crosshair 이벤트까지 남는데, 그것은 앞 사람의 개인 자료다. 낙찰 후보는 공개 사실이라 그대로 둔다.
  const ownSubmissionIds = new Set(ownPoints.map((point) => point.submissionId));
  const visibleInspection = inspection.filter((item) => item.kind === 'win' || ownSubmissionIds.has(item.point.submissionId));

  return (
    <figure className='m-0 flex min-h-0 flex-col gap-2' aria-label='회차별 낙찰률 흐름' data-own-points={ownPoints.length}>
      <div className='flex flex-wrap items-center gap-1'>
        <span className='mr-auto text-sm font-semibold'>낙찰률 <span className='text-xs font-normal text-muted-foreground'>예정가격 대비 · %</span></span>
        <Button variant='ghost' size='sm' aria-label='비율 축 확대' onClick={() => controller.current?.zoom(0.7)}>＋</Button>
        <Button variant='ghost' size='sm' aria-label='비율 축 축소' onClick={() => controller.current?.zoom(1 / 0.7)}>−</Button>
        <Button variant='ghost' size='sm' onClick={() => controller.current?.fit()}>전체 값</Button>
        <Button variant='ghost' size='sm' onClick={() => controller.current?.reset()}>기본 범위</Button>
      </div>
      {model.calendar.length === 0 ? <p className='grid min-h-48 place-items-center text-sm text-muted-foreground'>선택한 조건의 낙찰 기록이 없습니다.</p> : error ? <p role='alert' className='text-sm text-muted-foreground'>차트를 불러오지 못했습니다. 아래 과거 회차 표에서 기록을 확인해 주세요.</p> : (
        <>
          {model.points.length === 0 ? <p className='text-sm text-muted-foreground'>선택한 조건의 낙찰 기록이 없습니다.</p> : null}
          {/* 엔진이 캔버스를 그려 넣는 자리다. 맨 div는 role이 generic이라 이름이 무시되므로 그림으로 선언해
              대체 텍스트를 싣는다. 안의 캔버스에는 읽을 것이 없고 초점 대상도 없다. */}
          <div ref={element} data-slot='flow-canvas' role='img' aria-label='낙찰률 차트. 점을 누르거나 아래 회차 표에서 참여 기록을 여세요.' className='h-[clamp(260px,38dvh,440px)] min-w-0' />
        </>
      )}
      <div className='min-h-8 text-xs text-muted-foreground' aria-live='polite'>
        {visibleInspection.length ? (
          <div className='flex flex-wrap gap-1'>
            {visibleInspection.map((item) => (
              <InspectionButton
                key={item.kind === 'win' ? `win:${item.point.row.attemptId}` : `own:${item.point.submissionId}`}
                item={item}
                onChoose={(attemptId) => selection?.select(attemptId)}
                disabled={!selection}
              />
            ))}
          </div>
        ) : '점을 누르면 해당 회차의 참여 기록을 오른쪽에서 볼 수 있어요.'}
      </div>
      <figcaption className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
        <span>{model.points.length}회 표시 · 조회 표본 {presentation.sampleCount}회</span>
        <span>{presentation.cohort?.period ? `${presentation.cohort.period.from}–${presentation.cohort.period.to}` : '조회 기간 미확인'}</span>
        <span>{focus ? '휠로 날짜 확대 · 드래그로 이동' : '일반 휠은 페이지 이동 · 날짜 축 드래그로 확대'}</span>
        <span className='ml-auto'>개찰일 (KST)</span>
      </figcaption>
    </figure>
  );
}

export function FlowChart(props: Props) {
  // 확대 주소만 바뀌면 같은 캔버스를 유지한다. 데이터 release·조건·표시 행이 바뀔 때만 범위를 초기화한다.
  // own 응답·사업자 ID는 여기에 넣지 않는다. 그 값이 바뀔 때 캔버스를 다시 만들면 사용자의 확대가 사라진다.
  const revision = JSON.stringify([props.presentation.buildId, props.presentation.cohort, props.presentation.selectedItem?.codeValueId, props.presentation.rows.map((row) => [row.attemptId, row.winRateText, row.secondRateText])]);
  return <FlowChartCanvas key={revision} {...props} />;
}
