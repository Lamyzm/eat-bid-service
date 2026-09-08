/** @module 책임: 실제 dev 차트 엔진과 공통 표를 예시 이력에 연결해 분석 공간·선택 상세·확대 배치를 비교한다. */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  createFlowChart,
  type FlowChartController,
} from "../../../../apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/create-flow-chart";
import { buildFlowChartModel } from "../../../../apps/web/src/app/(workspace)/auctions/[auctionId]/_model/flow-chart-model";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/shared/ui/table";
import { IconArrowsMaximize, IconArrowsMinimize, IconInfoCircle } from "@tabler/icons-react";
import { Button } from "./controls";
import { history, type Panel } from "./review-data";

const presentation = {
  organizationId: "1",
  rows: history,
  nextCursor: null,
  sampleCount: history.length,
  buildId: null,
  sourceReleaseId: null,
  computedAtText: null,
  calcVersion: null,
  coverage: null,
  regionScheme: null,
  selectedItem: null,
};
const model = buildFlowChartModel(presentation);
export function Analysis({
  focus,
  setFocus,
  selected,
  select,
  panel,
}: {
  focus: boolean;
  setFocus: (value: boolean) => void;
  selected: string;
  select: (id: string) => void;
  panel: (value: Panel) => void;
}) {
  const chartHost = useRef<HTMLDivElement>(null);
  const chart = useRef<FlowChartController | null>(null);
  const onSelect = useEffectEvent(select);
  const [runnerUp, setRunnerUp] = useState(false);
  useEffect(() => {
    if (!chartHost.current) return;
    chart.current = createFlowChart(chartHost.current, model, (points, choose) => {
      if (choose && points.length === 1) onSelect(points[0]!.row.attemptId);
    });
    return () => {
      chart.current?.remove();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    chart.current?.focus(focus);
  }, [focus]);
  useEffect(() => {
    chart.current?.select(selected);
  }, [selected]);
  useEffect(() => {
    chart.current?.update(
      { win: true, runnerUp, otherItems: false, myRate: false, listCount: false },
      null,
    );
  }, [runnerUp]);
  return (
    <div className={`analysis-body ${focus ? "focus" : ""}`}>
      <header className="analysis-heading">
        <div>
          <div className="eyebrow">가람고등학교 · 축산물</div>
          <h1>9월 급식 식재료 구매</h1>
          <p>
            오늘 14:00 마감 <span>기초금액 32,460,000원 · 하한율 88.000%</span>
          </p>
        </div>
        <Button variant="outline" onClick={() => panel("notice")}>
          <IconInfoCircle />
          공고 정보
        </Button>
      </header>
      <div className="analysis-filters">
        <strong>과거 이력</strong>
        <span className="filter-chip">가람고등학교</span>
        <span className="filter-chip">축산물</span>
        <span className="filter-chip">하한율 88.000%</span>
        <span className="filter-chip">12개월</span>
      </div>
      <section className="chart-section" aria-label="과거 낙찰률 차트">
        <div className="section-heading">
          <div>
            <h2>
              낙찰률 추이 <small>예정가격 대비 · %</small>
            </h2>
            <p>2025.09–2026.08 · 12회</p>
          </div>
          <div className="chart-actions">
            <Button variant="ghost" aria-pressed={runnerUp} onClick={() => setRunnerUp(!runnerUp)}>
              2등값 {runnerUp ? "켜짐" : "꺼짐"}
            </Button>
            <Button variant="ghost" onClick={() => chart.current?.fit()}>
              전체 값
            </Button>
            <Button variant="secondary" onClick={() => setFocus(!focus)}>
              {focus ? <IconArrowsMinimize /> : <IconArrowsMaximize />}
              {focus ? "일반 보기" : "크게 보기"}
            </Button>
          </div>
        </div>
        <div ref={chartHost} className="review-chart" data-testid="review-chart" />
        <div className="chart-caption">
          <span>점을 누르거나 과거 회차에서 기록을 열어보세요</span>
          <span>개찰일 (KST)</span>
        </div>
      </section>
      <section className="history-section" aria-label="과거 회차">
        <div className="section-heading">
          <h2>
            과거 회차 <small>12회</small>
          </h2>
          <span className="muted">최근 개찰순</span>
        </div>
        <div className="history-scroll">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>개찰일</TableHead>
                <TableHead>기관 / 품목</TableHead>
                <TableHead className="numeric">낙찰률</TableHead>
                <TableHead className="numeric">2등값</TableHead>
                <TableHead className="numeric">참여</TableHead>
                <TableHead>기록</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.toReversed().map((row) => (
                <TableRow
                  key={row.attemptId}
                  data-state={selected === row.attemptId ? "selected" : undefined}
                >
                  <TableCell>
                    {row.openedYear}.{row.openedText.slice(3).replace("-", ".")}
                  </TableCell>
                  <TableCell>
                    가람고등학교 <span className="muted">· 축산물</span>
                  </TableCell>
                  <TableCell className="numeric rate">{row.winRateText}%</TableCell>
                  <TableCell className="numeric">{row.secondRateText}%</TableCell>
                  <TableCell className="numeric">{row.listCount}개</TableCell>
                  <TableCell>
                    <Button
                      variant={selected === row.attemptId ? "secondary" : "ghost"}
                      aria-label={`${row.openedText} 참여 기록`}
                      onClick={() => select(row.attemptId)}
                    >
                      기록 보기
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
