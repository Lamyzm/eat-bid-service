/** @module 책임: 계약 불일치와 표준 Problem 및 일반 HTTP 실패를 구분하는 오류 타입을 제공한다. */
import type { ProblemCode, ProblemDetails } from '@eatbid/contracts/api';

export class ContractResponseError extends Error {
  readonly name = 'ContractResponseError';

  constructor(
    readonly operationId: string,
    readonly status: number,
    options?: ErrorOptions
  ) {
    super(`응답이 ${operationId}의 공개 계약과 일치하지 않습니다.`, options);
  }
}

export class HttpProblemError extends Error {
  readonly name = 'HttpProblemError';
  readonly code: ProblemCode;
  readonly requestId: string;
  readonly status: number;

  constructor(readonly problem: ProblemDetails) {
    super(`HTTP ${problem.status}: ${problem.code}`);
    this.code = problem.code;
    this.requestId = problem.requestId;
    this.status = problem.status;
  }
}

export class HttpStatusError extends Error {
  readonly name = 'HttpStatusError';

  constructor(
    readonly status: number,
    readonly requestId?: string
  ) {
    super(`검증 가능한 Problem Details 없이 HTTP ${status} 응답을 받았습니다.`);
  }
}
