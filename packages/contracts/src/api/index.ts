// 범용 Web transport가 resource를 알지 않고 operation protocol과 공개 오류 계약만 소비하는 진입점이다.
export { problemCodeSchema, problemDetailsSchema } from "../common/problem-details";
export type { ProblemCode, ProblemDetails } from "../common/problem-details";
export {
  createOperationRegistry,
  defineOperation,
  pathParameter,
} from "./operation";
export type {
  HttpMethod,
  OperationBodyInput,
  OperationPathInput,
  OperationQueryInput,
  OperationResponse,
  OperationSuccess,
  OperationVersioning,
  PublicHttpOperation,
  SemanticRoute,
} from "./operation";
