/** @module 책임: 분석 요청들이 고정해 재사용할 입력 기준과 실제 mart build 계보 참조를 소유한다. */
import { z } from "zod";
import { instantTextSchema } from "../../../atoms/instant";
import { martBuildLineageSchema } from "../../../values/mart-lineage";

// 준비된 분석에 없는 build를 실을 수 없다. 기존 계보 family를 좁히고 미발행은 meta의 별도 상태로 둔다.
export const analysisBuildLineageSchema = martBuildLineageSchema.safeExtend({
  buildId: martBuildLineageSchema.shape.buildId.unwrap(),
  sourceReleaseId: martBuildLineageSchema.shape.sourceReleaseId.unwrap(),
  calcVersion: martBuildLineageSchema.shape.calcVersion.unwrap(),
  computedAt: martBuildLineageSchema.shape.computedAt.unwrap(),
  coverage: martBuildLineageSchema.shape.coverage.unwrap(),
});
export const analysisSnapshotSchema = z.strictObject({
  sourceCutoffAt: instantTextSchema,
  issuedAt: instantTextSchema,
  expiresAt: instantTextSchema,
  observationPolicyVersion: z.string().min(1).max(64),
  /**
   * 이 답이 **실제로 읽은** build들이다. 읽지 않은 mart의 계보를 싣지 않는다 — 싣는 순간 답이 그것에
   * 의존한다고 말하는 것이고, 그 mart가 회수되면 답과 무관한 이유로 응답이 깨진다.
   *
   * 처음에는 관측 mart와 분포 mart 둘을 묶을 것으로 보고 길이를 2로 못박았으나, EAT-198 측정이 비교군
   * 밀도를 미리 접어 둔 분포 표가 아니라 회차 요약에서 바로 접기로 정했다(임의 명단 범위를 분포 표가
   * 답할 수 없다). 그래서 지금 시간축 조회는 build 하나만 읽는다.
   */
  builds: z.array(z.strictObject({
    purpose: z.enum(["observations", "distribution"]),
    lineage: analysisBuildLineageSchema,
  })).min(1).max(2),
}).meta({
  id: "AnalysisSnapshot",
  description: "실제 입력을 검증한 공급자가 발급한 계보 묶음. 동일 시각이나 동일 build 번호만으로 정합성을 증명하지 않는다.",
});
export type AnalysisSnapshot = z.infer<typeof analysisSnapshotSchema>;
