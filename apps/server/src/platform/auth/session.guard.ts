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
    // 인증 의존성 장애를 401로 바꾸면 사용자는 자기 세션이 만료됐다고 읽고 재로그인을 반복한다. 503에 원인을
    // 싣는 이유는 filter의 거부 로그가 그 분류를 남겨 provider 장애와 설정 누락을 구분하게 하기 위해서다.
    if (error instanceof AuthDependencyUnavailable) {
      throw new ServiceUnavailableException(undefined, { cause: error });
    }
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
    } catch (error) {
      // reader는 driver 오류를 typed failure로 바꾸지 않으므로(같은 port를 쓰는 use case도 catch-all로 감싼다)
      // 여기서 DB 장애와 reader 결함을 타입으로 가르지 못한다. 대신 원인을 503에 실어 거부 로그의 오류 분류가
      // 둘을 구분하게 한다. 원인 없는 503은 로그에서 "인증을 켜지 않은 배포"와 구분되지 않는다.
      throw new ServiceUnavailableException(undefined, { cause: error });
    }
    if (principal === null) throw new ForbiddenException();
    request[principalKey] = principal;
    return true;
  }
}
