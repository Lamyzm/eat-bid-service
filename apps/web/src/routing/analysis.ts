/** @module 책임: 동결된 legacy dashboard/today 화면이 쓰는 분석 route builder의 옛 import 경로를 유지한다. */
// 이 shim은 routing 층의 canonical 규칙 위반이며 삭제 전용 ledger로 추적한다. dashboard/today는
// fingerprint로 동결된 legacy 화면이라 import 한 줄도 바꿀 수 없으므로 그 route를 RSC로 전환할 때 함께 삭제한다.
export { buildAnalysisRoute } from '../app/dashboard/analysis/_lib/analysis-route';
export type { AnalysisRoute } from '../app/dashboard/analysis/_lib/analysis-route';
