/**
 * @module 책임: 계정 port를 identity 질의와 등록 사업자 질의 두 묶음에 연결하는 adapter 경계만 소유한다.
 *
 * 두 묶음을 나눈 이유는 함께 바뀌는 이유가 다르기 때문이다. 하나는 인증 주체와 워크스페이스 초기화의
 * 경쟁 조건을, 다른 하나는 등록 사업자의 소유·상한·원본 대조를 지킨다.
 */
import type { ResolvedPrincipal } from "../../../../platform/auth/principal-reader";
import type {
  AccountRepository,
  ChangeLocationInput,
  ChangeLocationResult,
  InitializeAccountInput,
  RegisterBusinessInput,
  RegisterBusinessResult,
  RegisteredBusinessRecord,
} from "../../application/account-repository";
import { initializeAccount, readPrincipal } from "./account-identity-queries";
import { changeLocation, readBusinesses, registerBusiness } from "./registered-business-queries";
import type { AccountDatabase } from "./account-sql";

export type { AccountDatabase } from "./account-sql";
export { isUniqueViolation } from "./account-sql";

export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly database: AccountDatabase) {}

  findPrincipalBySubject(subject: string): Promise<ResolvedPrincipal | null> {
    return readPrincipal(this.database, subject);
  }

  initializeAccount(input: InitializeAccountInput): Promise<ResolvedPrincipal> {
    return initializeAccount(this.database, input);
  }

  listBusinesses(workspaceId: bigint): Promise<readonly RegisteredBusinessRecord[]> {
    return readBusinesses(this.database, workspaceId);
  }

  registerBusiness(input: RegisterBusinessInput): Promise<RegisterBusinessResult> {
    return registerBusiness(this.database, input);
  }

  changeLocation(input: ChangeLocationInput): Promise<ChangeLocationResult> {
    return changeLocation(this.database, input);
  }
}
