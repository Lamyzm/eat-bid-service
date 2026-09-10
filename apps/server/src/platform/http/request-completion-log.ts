/**
 * @module 책임: 한 응답의 완료 로그를 완료 interceptor와 exception filter 중 누가 남기는지 응답마다 한 번만
 * 정하고, 로그에 실을 수 있는 route 표현을 매칭된 template으로 좁힌다.
 *
 * Nest는 guard를 interceptor보다 먼저 실행하므로 guard가 끊은 요청은 완료 interceptor에 닿지 않는다. 그 응답의
 * 요약을 filter가 남기되 interceptor가 이미 맡은 응답에는 두 번 남기지 않으려면 "누가 맡았는가"가 응답 객체에
 * 실려야 한다. 요청 전역 store에 두지 않는 이유는 그 store가 상관관계 ID만 담는다고 선언돼 있기 때문이다.
 */
import type { Request, Response } from "express";

const completionLogOwnerKey = Symbol("eatbid.completionLogOwner");

type ObservedResponse = Response & { [completionLogOwnerKey]?: true };

/** 완료 interceptor가 이 응답의 finish/close를 기록하겠다고 선언한다. 선언은 응답이 끝나기 전에 일어난다. */
export function claimCompletionLog(response: Response): void {
  (response as ObservedResponse)[completionLogOwnerKey] = true;
}

export function completionLogClaimed(response: Response): boolean {
  return (response as ObservedResponse)[completionLogOwnerKey] === true;
}

export function routeTemplate(request: Request): string {
  // raw URL에는 query나 민감 식별자가 섞일 수 있으므로 로그에는 매칭된 템플릿만 남긴다. wildcard route는
  // 어떤 operation도 가리키지 않으므로(Nest의 prefix 아래 catch-all이 그렇다) template 대신 "unmatched"로 둔다.
  const path = request.route?.path;
  if (typeof path !== "string" || path.includes("*")) return "unmatched";
  return `${request.baseUrl ?? ""}${path}` || "/";
}
