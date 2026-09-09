/**
 * @module 책임: 등록 사업자 한 건의 소유 판정과 원본 대조 결과를 호출자의 읽기 스냅샷 안에서 돌려주는
 * port를 정의한다.
 *
 * 목록 port(`AccountRepository.listBusinesses`)와 나눈 이유는 소비자가 다르기 때문이다. 목록은 설정
 * 화면이 자기 워크스페이스 전체를 보는 조회이고, 이 port는 다른 모듈이 "이 요청자가 이 사업자를
 * 기준으로 삼아도 되는가"를 자기 조회와 같은 스냅샷에서 확인하려고 부른다. 스냅샷을 인자로 받는 이유는
 * 그 판정과 뒤이은 사실 조회가 서로 다른 시점을 보면 권한과 자료가 어긋난 응답이 만들어지기 때문이다.
 */
import type { TransactionHandle } from "../../../platform/database/unit-of-work";
import type { RegisteredBusinessRecord } from "./account-repository";

/**
 * 네 결과를 값으로 구분한다. 없는 등록과 남의 워크스페이스 등록을 합치면 화면이 "권한 없음"과 "없는
 * 자원"을 안내할 수 없고(ADR 0032 §6), 증거 불일치를 미관측으로 낮추면 있는 증거를 감춘다.
 */
export type RegisteredBusinessLookup =
  | { readonly kind: "found"; readonly business: RegisteredBusinessRecord }
  | { readonly kind: "not-found" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "evidence-conflict" };

export interface RegisteredBusinessLookupInput {
  readonly workspaceId: bigint;
  readonly registeredBusinessId: bigint;
}

export interface RegisteredBusinessReader {
  find(snapshot: TransactionHandle, input: RegisteredBusinessLookupInput): Promise<RegisteredBusinessLookup>;
}
