/**
 * @module 책임: principal에게 회수되지 않은 운영자 권한이 있는지만 답하는 읽기 전용 port를 정의한다.
 *
 * 부여·회수 쓰기를 이 port에 두지 않는다. guard가 쓰는 표면이 읽기 하나여야 요청 경로가 권한을 스스로 만들 수
 * 없다. 부여는 운영 절차(`docs/operations/operator-grant.md`)가 남기는 기록이다(ADR 0032 §3).
 */
export interface OperatorGrantReader {
  hasActiveGrant(principalId: bigint): Promise<boolean>;
}
