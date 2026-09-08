/** @module 책임: guard가 판정한 주체와 principal을 controller 인자로 명시적으로 주입한다. */
import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthenticatedSubject } from "./auth-identity";
import type { ResolvedPrincipal } from "./principal-reader";
import { readAuthenticatedSubject, readResolvedPrincipal } from "./session.guard";

export const ProviderSubject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSubject =>
    readAuthenticatedSubject(context.switchToHttp().getRequest()),
);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ResolvedPrincipal =>
    readResolvedPrincipal(context.switchToHttp().getRequest()),
);
