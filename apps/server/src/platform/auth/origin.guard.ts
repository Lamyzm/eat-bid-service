/**
 * @module 책임: 상태를 바꾸는 canonical 요청이 신뢰하는 origin에서 왔는지 확인해 cross-site 위조를 막는다.
 *
 * `SameSite=Lax` 쿠키만으로도 cross-site POST에는 세션이 실리지 않지만, 그 방어는 브라우저 구현과
 * 쿠키 속성 하나에 전부 걸려 있다. 서버가 같은 판정을 한 번 더 하면 쿠키 설정이 바뀌어도 남는다.
 */
import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

const stateChangingMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);

@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(allowedOrigins: readonly string[]) {
    this.allowed = new Set(allowedOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== "http") return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (!stateChangingMethods.has(request.method.toUpperCase())) return true;
    const origin = request.headers.origin;
    // `Origin`이 없는 상태 변경 요청도 거부한다. 브라우저는 이 요청에 항상 헤더를 붙이므로, 없다는 것은
    // 브라우저가 아니거나 헤더를 지우는 경로를 지났다는 뜻이다. 서버 간 호출은 이 ingress를 쓰지 않는다.
    if (typeof origin !== "string" || !this.allowed.has(origin)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
