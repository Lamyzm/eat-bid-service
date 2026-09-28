/** @module 책임: 분석 meta의 달별 제외 공고 수를 표본 옆에 둘 한 문장으로 옮긴다. */
import type { AnalysisTimeSeriesV1Response } from '@eatbid/contracts/api/v1/analysis';

/**
 * 발행에서 뺀 공고가 있는 달과 수를 말한다(ADR 0061 결정 6). 표본 수나 보유율과 한 비율로 섞지 않고 따로
 * 적는다 — 섞으면 "빼고 다 들어왔다"를 "다 들어왔다"로 읽게 된다. 제외가 없거나 자료가 준비되지 않았으면
 * 말할 것이 없다. 제외 수는 지역·기관 축이 없는 전국 수라 문장도 그렇게 말한다.
 */
export function presentExclusionNote(response: AnalysisTimeSeriesV1Response): string | null {
  const { meta } = response;
  if (meta.state !== 'ready') return null;
  const months = meta.periodCoverage.filter((segment) => segment.exclusions.excludedAuctionCount > 0);
  if (months.length === 0) return null;
  const excluded = months.reduce((sum, segment) => sum + segment.exclusions.excludedAuctionCount, 0);
  const unresolved = months.reduce(
    (sum, segment) => sum + segment.exclusions.unresolvedAuctionCount,
    0
  );
  const byMonth = months
    .map((segment) => `${segment.period.from.slice(0, 7)} ${segment.exclusions.excludedAuctionCount}건`)
    .join(', ');
  const remaining =
    unresolved === 0
      ? '모두 다시 반영됐어요.'
      : `그중 ${unresolved}건은 아직 반영되지 않아 표본에서 빠졌거나 이전 내용으로 들어 있어요.`;
  return `이 기간 전국 수집에서 원천 형식 문제로 발행에서 뺀 공고가 ${excluded}건 있어요(${byMonth}). ${remaining}`;
}
