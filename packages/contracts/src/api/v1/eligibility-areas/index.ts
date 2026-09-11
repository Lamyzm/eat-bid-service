// 이 진입점은 Web이 소비해도 안전한 참가제한지역 계약만 공개한다.
export {
  eligibilityAreaSchema,
  maxEligibilityAreaSelection,
  type EligibilityArea,
} from "../../../values/eligibility-area";
export { eligibilityAreaGroupSchema, type EligibilityAreaGroup } from "./eligibility-area.resource";
export {
  listEligibilityAreasMetaSchema,
  listEligibilityAreasV1ResponseSchema,
  type ListEligibilityAreasMeta,
  type ListEligibilityAreasV1Response,
} from "./list-eligibility-areas.response";
export {
  previewRegionCoverageCommandSchema,
  REGION_COVERAGE_WINDOW_DAYS,
  type PreviewRegionCoverageCommand,
  type PreviewRegionCoverageCommandInput,
} from "./region-coverage.command";
export {
  regionCoveragePeakDaySchema,
  regionCoverageTodaySchema,
  regionCoverageV1ResponseSchema,
  regionCoverageWindowSchema,
  type RegionCoverageToday,
  type RegionCoverageV1Response,
  type RegionCoverageWindow,
} from "./region-coverage.response";
export { eligibilityAreaV1OperationRegistry, eligibilityAreaV1Operations } from "./operations";
