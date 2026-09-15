/** @module 책임: 이식 가능한 계약 root와 각 계약이 낼 생성 artifact 파일명의 대응을 단일 목록으로 소유한다. */
import { normalizedAuctionV1Schema } from "./ingestion/v1/normalized-auction";
import { normalizedCodeReleaseV1Schema } from "./ingestion/v1/normalized-code-release";
import { normalizedCodeVocabularyV1Schema } from "./ingestion/v1/normalized-code-vocabulary";
import { normalizedAuctionV2Schema } from "./ingestion/v2/normalized-auction";

// artifact 파일명이 registry 항목의 일부인 이유: emitter가 계약마다 하나의 추적 생성물을 내고, 그
// 대응을 한 곳에서만 정한다. 이름이 코드 두 곳에 흩어지면 drift 검사가 무엇을 비교하는지 흐려진다.
export const portableContracts = Object.freeze([
  { id: "EatbidIngestionAuctionV1", artifact: "ingestion-v1.schema.json", schema: normalizedAuctionV1Schema },
  { id: "EatbidIngestionAuctionV2", artifact: "ingestion-v2.schema.json", schema: normalizedAuctionV2Schema },
  { id: "EatbidCodeReleaseV1", artifact: "code-release-v1.schema.json", schema: normalizedCodeReleaseV1Schema },
  { id: "EatbidCodeVocabularyV1", artifact: "code-vocabulary-v1.schema.json", schema: normalizedCodeVocabularyV1Schema },
] as const);

export type PortableContractId = (typeof portableContracts)[number]["id"];
