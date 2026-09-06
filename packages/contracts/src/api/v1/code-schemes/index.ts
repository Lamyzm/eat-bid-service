// 이 진입점은 Web이 소비해도 안전한 코드 체계 계약만 공개하고 generator 표면은 재수출하지 않는다.
export { regionCodeV1Schema, type RegionCodeV1 } from "../../../values/region-code";
export {
  listCodesMetaSchema,
  listCodesV1ResponseSchema,
  type ListCodesMeta,
  type ListCodesV1Response,
} from "./list-codes.response";
export {
  codeSchemeV1OperationRegistry,
  codeSchemeV1Operations,
  listCodesQuerySchema,
} from "./operations";
