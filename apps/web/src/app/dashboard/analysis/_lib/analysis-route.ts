/** @module 책임: 분석 화면의 typed dynamic path와 선택 query를 안전하게 직렬화한다. */
interface AnalysisRouteInput {
  schoolId: string;
  bidNumber?: string;
  rate?: string;
  baseAmount?: string;
}

export type AnalysisRoute =
  | `/dashboard/analysis/${string}`
  | `/dashboard/analysis/${string}?${string}`;

export function buildAnalysisRoute({
  schoolId,
  bidNumber,
  rate,
  baseAmount
}: AnalysisRouteInput): AnalysisRoute {
  const pathname: `/dashboard/analysis/${string}` =
    `/dashboard/analysis/${encodeURIComponent(schoolId)}`;
  const searchParams = new URLSearchParams();
  if (bidNumber !== undefined) searchParams.set('bidNo', bidNumber);
  if (rate !== undefined) searchParams.set('rate', rate);
  if (baseAmount !== undefined) searchParams.set('base', baseAmount);
  const query = searchParams.toString();
  if (!query) return pathname;
  const route: `/dashboard/analysis/${string}?${string}` = `${pathname}?${query}`;
  return route;
}
