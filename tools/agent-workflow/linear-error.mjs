/** @module 책임: Linear GraphQL 경계의 실패를 다른 오류와 구분하는 단일 오류 타입을 소유한다. */

// client와 issue 발행 모듈이 같은 오류 타입을 던져야 호출자가 "Linear 때문에 실패했다"를 한 번에
// 판정할 수 있다. 두 모듈이 서로를 import하면 순환이 되므로 타입만 여기로 분리한다.
export class LinearApiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LinearApiError";
  }
}
