/** 도메인 계약 — 성격별 분리, 재export만 (import 경로 불변) */
// Category 이름이 category.ts(타입 별칭)와 auction.ts(zod 스키마) 양쪽에 있다.
// 검증에 쓰는 zod 쪽을 Category로 내보내고, SSOT의 나머지는 명시 재export한다.
export * from "./auction.js";
export { CATEGORIES, CATEGORY_OTHER, NAMED_CATEGORIES, isCategory, categoryOrder } from "./category.js";
export * from "./firm.js";
export * from "./query.js";
