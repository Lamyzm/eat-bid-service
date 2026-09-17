/**
 * @module 책임: 저장된 조건 조합의 조회·저장·삭제 port와 그 결과 record, 예상 실패를 정의한다.
 *
 * 관심 지역 port와 나눈 이유는 함께 바뀌는 이유가 다르기 때문이다. 이쪽이 바뀌는 이유는 사용자가 이름
 * 붙여 저장하는 조건 한 벌의 모양이고, 저쪽은 지역 축의 코드 체계와 확인 규칙이다(ADR 0045).
 *
 * **건수는 여기 없다.** 조합이 몇 건인지는 열린 공고를 세는 일이고 그 mart와 열림 술어는 procurement가
 * 소유한다. 이 port는 "어떤 조합이 저장돼 있나"까지만 답한다.
 */
import type { AuctionItemAtom } from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";

/**
 * 저장되는 필터 atom 한 벌이다. 건수·라벨·묶음 이름은 없다 — 셋 다 파생값이라 저장하면 다음 날
 * 거짓말을 한다.
 *
 * 날짜 축이 없는 것도 같은 이유다. 오늘 저장한 `9월 15일`은 내일 지난 날짜라 조합이 가리키는 판이
 * 사라진다. 조합은 그 시점의 집합이 아니라 **조건**을 가리킨다.
 */
export interface FilterCombinationFilterRecord {
  readonly sidoCodeValueId: bigint | null;
  readonly sigunguCodeValueIds: readonly bigint[];
  readonly itemAtoms: readonly AuctionItemAtom[];
  readonly baseAmountMin: string | null;
  readonly baseAmountMax: string | null;
  /** 공고지역 미관측 행까지 셀지다. 지역 축의 모집단을 바꾸므로 지역과 같이 저장한다(EAT-267). */
  readonly regionUnknownIncluded: boolean;
}

export interface FilterCombinationRecord {
  readonly filterCombinationId: bigint;
  readonly name: string;
  readonly filter: FilterCombinationFilterRecord;
  readonly createdAt: Temporal.Instant;
}

export interface SaveFilterCombinationInput {
  readonly workspaceId: bigint;
  readonly principalId: bigint;
  readonly name: string;
  readonly filter: FilterCombinationFilterRecord;
}

/**
 * 상한 초과와 이름 중복을 값으로 돌려준다. 둘 다 잘못된 요청이 아니라 **지금 저장 상태와의 충돌**이라
 * 예외가 아니라 결과이며, controller가 409로 번역한다.
 */
export type SaveFilterCombinationResult =
  | { readonly kind: "saved"; readonly combination: FilterCombinationRecord }
  | { readonly kind: "limit-reached" }
  | { readonly kind: "duplicate-name" };

export type DeleteFilterCombinationResult = { readonly kind: "deleted" } | { readonly kind: "not-found" };

export interface FilterCombinationRepository {
  listCombinations(workspaceId: bigint): Promise<readonly FilterCombinationRecord[]>;
  saveCombination(input: SaveFilterCombinationInput): Promise<SaveFilterCombinationResult>;
  deleteCombination(input: {
    readonly workspaceId: bigint;
    readonly filterCombinationId: bigint;
  }): Promise<DeleteFilterCombinationResult>;
}

export class FilterCombinationDependencyUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor(cause: unknown) {
    super("Filter combination repository is unavailable", { cause });
    this.name = "FilterCombinationDependencyUnavailable";
  }
}

export class FilterCombinationLimitReached extends Error {
  readonly code = "CONFLICT" as const;

  constructor() {
    super("Workspace already stores the maximum number of filter combinations");
    this.name = "FilterCombinationLimitReached";
  }
}

export class FilterCombinationNameTaken extends Error {
  readonly code = "CONFLICT" as const;

  constructor() {
    super("Workspace already stores a filter combination with that name");
    this.name = "FilterCombinationNameTaken";
  }
}

export class FilterCombinationNotFound extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor() {
    super("Filter combination not found in this workspace");
    this.name = "FilterCombinationNotFound";
  }
}
