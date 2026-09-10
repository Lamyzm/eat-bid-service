import { describe, expect, test } from "bun:test";
import { claimCompletionLog, completionLogClaimed, routeTemplate } from "./request-completion-log";

describe("요청 완료 로그 소유권", () => {
  test("완료 interceptor가 선언한 응답만 완료 로그를 맡은 것으로 본다", () => {
    const response = {} as never;
    expect(completionLogClaimed(response)).toBe(false);
    claimCompletionLog(response);
    expect(completionLogClaimed(response)).toBe(true);
    // 다른 응답 객체에는 선언이 번지지 않는다.
    expect(completionLogClaimed({} as never)).toBe(false);
  });

  test("route에는 매칭된 template만 남기고 wildcard와 미매칭은 unmatched로 둔다", () => {
    expect(routeTemplate({ baseUrl: "", route: { path: "/api/v1/auctions/:auctionId" } } as never))
      .toBe("/api/v1/auctions/:auctionId");
    // Nest의 미매칭 404 handler는 prefix 아래 wildcard route라 어떤 operation도 가리키지 않는다.
    expect(routeTemplate({ baseUrl: "/api", route: { path: "*path" } } as never)).toBe("unmatched");
    expect(routeTemplate({ url: "/docs?token=secret", baseUrl: "" } as never)).toBe("unmatched");
    expect(routeTemplate({ baseUrl: "", route: { path: "" } } as never)).toBe("/");
  });
});
