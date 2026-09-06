// 이 진입점은 Web이 소비해도 안전한 공고 계약만 공개하고 Server/generator 표면은 재수출하지 않는다.
export type {
  OperationBodyInput,
  OperationPathInput,
  OperationQueryInput,
  OperationSuccess,
  PublicHttpOperation,
} from "../../operation";
export { auctionResourceSchema, type AuctionResource } from "./resource";
export { auctionClassificationSchema, type AuctionClassification } from "../../../resources/procurement/classification";
export { auctionLocationSchema, type AuctionLocation } from "../../../resources/procurement/location";
export { auctionTermsSchema, type AuctionTerms } from "../../../resources/procurement/terms";
export { codeReferenceSchema, type CodeReference } from "../../../values/code-reference";
export { auctionV1ResponseSchema, type AuctionV1Response } from "./get-auction.response";
export { auctionV1OperationRegistry, auctionV1Operations } from "./operations";
