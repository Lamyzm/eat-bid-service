/** @module 책임: 기관 흐름 차트의 기존 표시 모델·계열 토글·오른쪽 회차 선택을 캔버스와 접근 가능한 조작에 연결한다. */
'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Button } from '@/shared/ui/button';
import type { HistoryPresentation } from '../_model/attempt-history';
import { buildFlowChartModel, type FlowChartPoint } from '../_model/flow-chart-model';
import { decideMyRateLine } from '../_model/flow-series';
import { useBidRate } from './bid-rate-context';
import { useFlowSeriesVisibility } from './flow-legend';
import { useOptionalAttemptSelection } from './attempt-selection';
import type { FlowChartController } from './create-flow-chart';

type Props = { readonly presentation: HistoryPresentation; readonly myRate: string | null; readonly focus?: boolean };

function FlowChartCanvas({ presentation, myRate, focus = false }: Props) {
  const [model] = useState(() => buildFlowChartModel(presentation));
  const [inspection, setInspection] = useState<readonly FlowChartPoint[]>([]);
  const [error, setError] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const controller = useRef<FlowChartController | null>(null);
  const selection = useOptionalAttemptSelection();
  const visible = useFlowSeriesVisibility();
  const { rate } = useBidRate();
  const line = decideMyRateLine({ myRate, bidRate: rate });
  const ownRate = line.kind === 'drawn' ? line.rate : null;
  const inspect = useEffectEvent((points: readonly FlowChartPoint[], choose: boolean) => {
    setInspection(points);
    if (choose && points.length === 1) selection?.select(points[0]!.row.attemptId);
  });
  const initialize = useEffectEvent((api: FlowChartController) => {
    api.update(visible, ownRate);
    api.focus(focus);
    api.select(selection?.row?.attemptId);
  });
  useEffect(() => {
    let cancelled = false;
    // 큰 엔진을 서버 렌더나 다른 탭의 초기 bundle에 넣지 않는다. 늦게 도착한 import는 해제된 DOM을 만들지 않는다.
    import('./create-flow-chart').then(({ createFlowChart }) => {
      if (cancelled || !element.current || model.points.length === 0) return;
      const api = createFlowChart(element.current, model, (points, choose) => inspect(points, choose));
      controller.current = api;
      initialize(api);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; controller.current?.remove(); controller.current = null; };
  }, [model]);
  useEffect(() => { controller.current?.update(visible, ownRate); }, [visible, ownRate]);
  useEffect(() => { controller.current?.focus(focus); }, [focus]);
  useEffect(() => { controller.current?.select(selection?.row?.attemptId); }, [selection?.row?.attemptId]);

  return (
    <figure className='m-0 flex min-h-0 flex-col gap-2' aria-label='회차별 낙찰률 흐름'>
      <div className='flex flex-wrap items-center gap-1'>
        <span className='mr-auto text-sm font-semibold'>낙찰률 <span className='text-xs font-normal text-muted-foreground'>예정가격 대비 · %</span></span>
        <Button variant='ghost' size='sm' aria-label='비율 축 확대' onClick={() => controller.current?.zoom(0.7)}>＋</Button>
        <Button variant='ghost' size='sm' aria-label='비율 축 축소' onClick={() => controller.current?.zoom(1 / 0.7)}>−</Button>
        <Button variant='ghost' size='sm' onClick={() => controller.current?.fit()}>전체 값</Button>
        <Button variant='ghost' size='sm' onClick={() => controller.current?.reset()}>기본 범위</Button>
      </div>
      {model.points.length === 0 ? <p className='grid min-h-48 place-items-center text-sm text-muted-foreground'>선택한 조건의 낙찰 기록이 없습니다.</p> : error ? <p role='alert' className='text-sm text-muted-foreground'>차트를 불러오지 못했습니다. 아래 과거 회차 표에서 기록을 확인해 주세요.</p> : (
        <div ref={element} data-slot='flow-canvas' aria-label='낙찰률 차트. 점을 누르거나 아래 회차 표에서 참여 기록을 여세요.' className='h-[clamp(260px,38dvh,440px)] min-w-0' />
      )}
      <div className='min-h-8 text-xs text-muted-foreground' aria-live='polite'>
        {inspection.length ? <div className='flex flex-wrap gap-1'>{inspection.map(({ row }) => <Button key={row.attemptId} variant='secondary' size='sm' onClick={() => selection?.select(row.attemptId)} disabled={!selection}>
          {row.openedYear}.{row.openedText.slice(3).replace('-', '.')} · {row.itemLabel} · {row.winRateText}% · 회차 {row.attemptId}
        </Button>)}</div> : '점을 누르면 해당 회차의 참여 기록을 오른쪽에서 볼 수 있어요.'}
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
  const revision = JSON.stringify([props.presentation.buildId, props.presentation.cohort, props.presentation.selectedItem?.codeValueId, props.presentation.rows.map((row) => [row.attemptId, row.winRateText, row.secondRateText])]);
  return <FlowChartCanvas key={revision} {...props} />;
}
