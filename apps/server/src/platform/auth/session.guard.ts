/**
 * @module 책임: 요청의 provider 세션과 bigint principal 해소를 controller 앞에서 판정하고 그 결과를
 * ExecutionContext에 명시적으로 실어 준다.
 *
 * 해소 결과를 요청 전역 store에 숨기지 않는 이유: `RequestContextStore`는 상관관계 ID만 담는다고 이미
 * 선언돼 있고, 인증 정보를 그 store로 전달하면 어떤 코드든 조용히 주체를 꺼내 쓰는 service locator가 된다.
 */
import {
  CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedSubject } from "./auth-identity";
import { AUTH_TOKENS } from "./auth.tokens";
import type { PrincipalReader, ResolvedPrincipal } from "./principal-reader";
import { webHeadersOf } from "./request-headers";
import { AuthDependencyUnavailable, type SessionAuthenticator } from "./session-authenticator";

const subjectKey = Symbol("eatbid.authenticatedSubject");
const principalKey = Symbol("eatbid.resolvedPrincipal");

type AuthenticatedRequest = Request & {
  [subjectKey]?: AuthenticatedSubject;
  [principalKey]?: ResolvedPrincipal;
};

export function readAuthenticatedSubject(request: unknown): AuthenticatedSubject {
  const subject = (request as AuthenticatedRequest)[subjectKey];
  if (!subject) throw new UnauthorizedException();
  return subject;
}

export function readResolvedPrincipal(request: unknown): ResolvedPrincipal {
  const principal = (request as AuthenticatedRequest)[principalKey];
  if (!principal) throw new UnauthorizedException();
  return principal;
}

async function authenticate(
  authenticator: SessionAuthenticator,
  request: AuthenticatedRequest,
): Promise<AuthenticatedSubject> {
  let subject: AuthenticatedSubject | null;
  try {
    subject = await authenticator.authenticate(webHeadersOf(request));
  } catch (error) {
    // 인증 의존성 장애를 401로 바꾸면 사용자는 자기 세션이 만료됐다고 읽고 재로그인을 반복한다.
    if (error instanceof AuthDependencyUnavailable) throw new ServiceUnavailableException();
    throw error;
  }
  if (subject === null) throw new UnauthorizedException();
  request[subjectKey] = subject;
  return subject;
}

/** 아직 app 계정이 없어도 되는 요청, 즉 초기화 command만 이 guard를 쓴다. */
@Injectable()
export class ProviderSessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH_TOKENS.sessionAuthenticator) private readonly authenticator: SessionAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await authenticate(this.authenticator, context.switchToHttp().getRequest<AuthenticatedRequest>());
    return true;
  }
}

/**
 * app 관계를 요구하는 요청의 guard다. 세션 없음(401)과 초기화 미완료(403)를 다른 상태로 돌려준다.
 * 둘을 401 하나로 합치면 화면이 재로그인을 권하는데, 재로그인은 초기화를 대신하지 않는다.
 */
@Injectable()
export class PrincipalGuard implements CanActivate {
  constructor(
    @Inject(AUTH_TOKENS.sessionAuthenticator) private readonly authenticator: SessionAuthenticator,
    @Inject(AUTH_TOKENS.principalReader) private readonly reader: PrincipalReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const subject = await authenticate(this.authenticator, request);
    let principal: ResolvedPrincipal | null;
    try {
      principal = await this.reader.findBySubject(subject.subject);
    } catch {
      throw new ServiceUnavailableException();
    }
    if (principal === null) throw new ForbiddenException();
    request[principalKey] = principal;
    return true;
  }
}
