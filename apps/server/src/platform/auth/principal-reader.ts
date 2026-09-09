/**
 * @module 책임: provider 주체를 bigint principal과 기본 워크스페이스로 해소하는 읽기 전용 port를 정의한다.
 *
 * 이 port에 쓰기 연산을 두지 않는다. 요청 경로가 계정을 다시 만들 수 있으면 회수된 계정이 조용히
 * 되살아나고 모든 읽기 endpoint가 쓰기 트랜잭션을 갖게 된다. 계정 생성은 명시적 초기화 command 하나다.
 */
import type { WorkspaceRole } from "@eatbid/contracts";

export interface ResolvedWorkspace {
  readonly workspaceId: bigint;
  readonly name: string;
  readonly role: WorkspaceRole;
}

export interface ResolvedPrincipal {
  readonly principalId: bigint;
  /** 초기화가 끝나면 항상 있다. 초기화 전에는 principal 자체가 없다. */
  readonly workspace: ResolvedWorkspace;
}

export interface PrincipalReader {
  /** 아직 초기화되지 않은 주체는 `null`이다. 이는 오류가 아니라 구분되는 상태다. */
  findBySubject(subject: string): Promise<ResolvedPrincipal | null>;
}
