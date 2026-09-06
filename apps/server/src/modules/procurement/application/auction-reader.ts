/** @module 책임: 공고 조회 port와 저장 기술을 드러내지 않는 application record 형태를 소유한다. */
import type { AuctionId } from "../domain/auction-id";
import type { BidRate, Money, Temporal } from "@eatbid/domain";

/**
 * core 코드 하나를 가리키는 참조다. 정체성은 `codeValueId`이며 `code`는 `scheme` 안에서만 뜻이 있다.
 * 두 값을 함께 들고 다녀야 화면이 "이 지역 코드가 어느 체계의 것인가"를 판정할 수 있다(AGENTS 2·6).
 */
export interface CodeReferenceRecord {
  readonly codeValueId: bigint;
  readonly code: string;
  readonly scheme: string;
  readonly label: string | null;
}

export interface AuctionRecord {
  readonly auctionId: AuctionId;
  readonly revisionId: bigint;
  readonly title: string;
  readonly status: string;
  readonly displayBidNumber: string | null;
  readonly announcedAt: Temporal.Instant;
  readonly deadlineAt: Temporal.Instant | null;
  readonly openedAt: Temporal.Instant | null;
  readonly baseAmount: Money;
  readonly plannedAmount: Money | null;
  // 구매기관은 이름이 아니라 숫자 ID로만 식별하며 관계가 없는 revision은 unknown(null)이다.
  readonly organization: {
    readonly organizationId: bigint;
    readonly name: string | null;
    readonly type: string;
  } | null;
  /**
   * 분포 코호트의 키다. 하한율은 사정률 축(분모 예정가격)의 상수라 `BidRate`이며, 기초금액 분모의
   * `BaseRelativeBidRate`와 같은 축이 아니다(AGENTS 15). 둘 다 관측되지 않으면 블록째 null이다.
   */
  readonly terms: {
    readonly floorRate: BidRate | null;
    readonly awardMethod: CodeReferenceRecord | null;
  } | null;
  readonly location: {
    readonly sido: CodeReferenceRecord | null;
    readonly sigungu: CodeReferenceRecord | null;
  } | null;
  // 품목은 아직 CodeScheme이 없어 관측 라벨뿐이다. 조인 키나 코호트 키로 승격시키지 않는다.
  readonly classification: { readonly itemLabel: string } | null;
  readonly provenance: {
    readonly sourceSystem: string;
    readonly externalBidId: string;
    readonly observationId: bigint;
    readonly normalizedRecordId: bigint;
    readonly contentSha256: string;
  };
}

/**
 * 애플리케이션 포트는 저장소 행이나 query builder를 노출하지 않는다.
 * 도메인 값과 출처만 반환해야 저장 기술이 use case의 계약을 바꾸지 못한다.
 */
export interface AuctionReader {
  findById(id: AuctionId): Promise<AuctionRecord | null>;
}
