/**
 * @module 책임: 계정 초기화와 등록 사업자·위치 저장의 application port와 그 결과 record를 정의한다.
 *
 * record는 DB row도 HTTP DTO도 아니다. 특히 `supplierPartyId`는 저장된 열이 아니라 읽는 시점에 원본
 * 사업자번호와 정확 대조해 얻은 값이며, 그래서 나중에 원본이 그 사업자를 처음 관측하면 같은 등록이
 * 저절로 연결된다(ADR 0032 §7).
 */
import type { Temporal } from "@eatbid/domain";
import type { ResolvedPrincipal } from "../../../platform/auth/principal-reader";

export interface RegisteredBusinessLocationRecord {
  readonly addressText: string;
  readonly updatedAt: Temporal.Instant;
}

export interface RegisteredBusinessRecord {
  readonly registeredBusinessId: bigint;
  readonly businessNumber: string;
  readonly registeredAt: Temporal.Instant;
  /** 원본에서 아직 관측되지 않은 사업자는 `null`이다. 실패가 아니라 구분되는 상태다. */
  readonly supplierPartyId: bigint | null;
  readonly location: RegisteredBusinessLocationRecord | null;
}

export type RegisterBusinessResult =
  | { readonly kind: "registered"; readonly business: RegisteredBusinessRecord }
  | { readonly kind: "already-registered" }
  /** 활성 등록이 계약 상한에 도달했다. 넘겨 저장하면 그 다음 목록 조회가 응답 검증에서 깨진다. */
  | { readonly kind: "limit-reached" };

/**
 * 존재하지 않는 등록과 남의 워크스페이스 등록을 같은 값으로 합치지 않는다. 화면이 "권한 없음"과
 * "없는 자원"을 구분하지 못하면 사용자가 계정을 잘못 고른 상황을 안내할 수 없다. 여기서 보호하는 자원의
 * 존재 자체는 비밀이 아니고, 403 응답 본문에도 대상이 무엇인지 적지 않는다(ADR 0032 §6).
 */
export type ChangeLocationResult =
  | { readonly kind: "changed"; readonly business: RegisteredBusinessRecord }
  | { readonly kind: "forbidden" }
  | { readonly kind: "not-found" };

export interface InitializeAccountInput {
  readonly subject: string;
  /** 조직 이름을 묻지 않기 위해 서버가 정한 초기 이름이다. 이름 변경은 owner의 나중 선택이다. */
  readonly workspaceName: string;
}

export interface RegisterBusinessInput {
  readonly workspaceId: bigint;
  readonly principalId: bigint;
  readonly businessNumber: string;
}

export interface ChangeLocationInput {
  readonly workspaceId: bigint;
  readonly principalId: bigint;
  readonly registeredBusinessId: bigint;
  /** `null`은 위치 미설정으로 되돌린다는 뜻이다. 빈 문자열을 저장하지 않는다. */
  readonly addressText: string | null;
}

export interface AccountRepository {
  findPrincipalBySubject(subject: string): Promise<ResolvedPrincipal | null>;
  /** 여러 번 불러도 같은 관계를 돌려주고, 경쟁에서 진 시도는 주인 없는 행을 남기지 않는다. */
  initializeAccount(input: InitializeAccountInput): Promise<ResolvedPrincipal>;
  listBusinesses(workspaceId: bigint): Promise<readonly RegisteredBusinessRecord[]>;
  registerBusiness(input: RegisterBusinessInput): Promise<RegisterBusinessResult>;
  changeLocation(input: ChangeLocationInput): Promise<ChangeLocationResult>;
}

export class AccountDependencyUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor(cause: unknown) {
    super("Account repository is unavailable", { cause });
    this.name = "AccountDependencyUnavailable";
  }
}

export class RegisteredBusinessNotFound extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor() {
    super("Registered business was not found in this workspace");
    this.name = "RegisteredBusinessNotFound";
  }
}

/**
 * 워크스페이스를 바꾸는 일은 `owner`만 한다(ADR 0032 §3). 화면에서 버튼만 감추면 권한이 있는 척하는
 * 클라이언트가 그대로 통과하므로 판정은 여기 한 곳에서 한다.
 */
export class WorkspaceRoleForbidden extends Error {
  readonly code = "FORBIDDEN" as const;

  constructor() {
    super("Workspace owner role is required for this command");
    this.name = "WorkspaceRoleForbidden";
  }
}

export class RegisteredBusinessForbidden extends Error {
  readonly code = "FORBIDDEN" as const;

  constructor() {
    super("Registered business belongs to another workspace");
    this.name = "RegisteredBusinessForbidden";
  }
}

export class RegisteredBusinessConflict extends Error {
  readonly code = "CONFLICT" as const;

  constructor() {
    super("This workspace already registered the business number");
    this.name = "RegisteredBusinessConflict";
  }
}
