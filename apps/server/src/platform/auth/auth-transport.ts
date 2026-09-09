/**
 * @module 책임: provider 원문 인증 전송을 body parser 앞 Express slot에 붙이고, 인증을 켜지 않은 배포가
 * 로그인 가능한 것처럼 보이지 않게 닫는다.
 */
import { toNodeHandler } from "better-auth/node";
import type { Express, Request, Response } from "express";
import { problemForStatus } from "../http/problem-details.filter";
import { requestIdOf } from "../request-context/request-context.middleware";
import { AUTH_BASE_PATH, type AuthInstance } from "./auth-instance";

// Better Auth handler는 요청 본문을 스스로 읽는다. `express.json()` 뒤에 서면 이미 소비된 stream을 만나
// 서명·상태 검증이 통째로 실패하므로 이 mount는 파서 앞 slot에만 놓는다.
const authRoutePattern = `${AUTH_BASE_PATH}/*path`;

export function createAuthTransportMount(auth: AuthInstance | null): (application: Express) => void {
  return (application: Express): void => {
    if (auth === null) {
      // 404로 두면 "경로가 없다"로 읽혀 배포 설정 누락이 오래 숨는다. 없는 것은 경로가 아니라 의존성이다.
      application.all([AUTH_BASE_PATH, authRoutePattern], (request: Request, response: Response): void => {
        response.status(503).type("application/problem+json").send(
          problemForStatus(503, requestIdOf(request)),
        );
      });
      return;
    }
    application.all([AUTH_BASE_PATH, authRoutePattern], toNodeHandler(auth));
  };
}
