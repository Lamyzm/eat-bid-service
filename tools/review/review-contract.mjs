/** @module 책임: provider 중립 리뷰 요청·결과 version, provider 순서, 폴백 허용 reason과 결과 검증 규칙을 소유한다. */

export const SCHEMA_VERSION = "eatbid.ai-review/v2";
export const POLICY_VERSION = "eatbid.ai-advisory/v2";
export const PROVIDERS = Object.freeze(["codex", "claude"]);

/**
 * 폴백을 허용하는 provider-local 장애만 열거한다. 공통 preflight·lock·사용자 취소·wrapper 내부 오류를
 * 다음 모델로 넘기면 공통 결함이 provider 장애로 위장되므로 enum 밖의 reason은 만들 수 없다.
 */
export const FALLBACK_REASONS = Object.freeze(
  new Set([
    "missing-cli",
    "cli-version",
    "auth-unavailable",
    "quota-exhausted",
    "rate-limited",
    "provider-overloaded",
    "timeout",
    "process-failed",
    "invalid-output",
    "tool-failed",
  ]),
);

export function resolveProviderOrder({ provider = "auto", prefer } = {}) {
  if (provider !== "auto" && !PROVIDERS.includes(provider)) {
    throw new Error(`지원하지 않는 provider입니다: ${provider}`);
  }
  if (prefer !== undefined) {
    if (provider !== "auto") throw new Error("prefer는 provider=auto에서만 사용할 수 있습니다.");
    if (!PROVIDERS.includes(prefer)) throw new Error(`지원하지 않는 prefer 값입니다: ${prefer}`);
  }
  if (provider !== "auto") return { mode: "explicit", order: [provider] };
  const order = prefer ? [prefer, ...PROVIDERS.filter((name) => name !== prefer)] : [...PROVIDERS];
  return { mode: "auto", order };
}

export function providerError(provider, reason, message) {
  if (!PROVIDERS.includes(provider)) throw new Error(`알 수 없는 provider입니다: ${provider}`);
  if (!FALLBACK_REASONS.has(reason)) throw new Error(`허용되지 않는 provider reason입니다: ${reason}`);
  const error = new Error(message);
  error.code = "EATBID_PROVIDER_ERROR";
  error.provider = provider;
  error.reason = reason;
  error.fallbackAllowed = true;
  return error;
}

export function isProviderError(error) {
  return error?.code === "EATBID_PROVIDER_ERROR" && FALLBACK_REASONS.has(error.reason);
}

export function validateReviewOutput(value, changedPaths, lineCounts = new Map()) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("리뷰 결과가 객체가 아닙니다.");
  const rootKeys = Object.keys(value).sort();
  if (rootKeys.join("\0") !== ["findings", "schemaVersion", "summary"].join("\0")) {
    throw new Error("리뷰 결과에 알 수 없는 필드가 있습니다.");
  }
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.summary !== "string" ||
    value.summary.length > 2000
  ) {
    throw new Error("리뷰 결과 version 또는 summary가 유효하지 않습니다.");
  }
  if (!Array.isArray(value.findings) || value.findings.length > 50) {
    throw new Error("리뷰 finding 수가 유효하지 않습니다.");
  }
  const allowedPaths = new Set(changedPaths);
  for (const finding of value.findings) {
    if (!finding || typeof finding !== "object" || !allowedPaths.has(finding.path)) {
      throw new Error("리뷰 finding 경로가 변경 범위 밖입니다.");
    }
    const findingKeys = Object.keys(finding).sort();
    if (
      findingKeys.join("\0") !==
      ["body", "confidence", "lineEnd", "lineStart", "path", "title"].join("\0")
    ) {
      throw new Error("리뷰 finding에 알 수 없는 필드가 있습니다.");
    }
    if (
      !Number.isInteger(finding.lineStart) ||
      !Number.isInteger(finding.lineEnd) ||
      finding.lineStart < 1 ||
      finding.lineEnd < finding.lineStart
    ) {
      throw new Error("리뷰 finding 줄 범위가 유효하지 않습니다.");
    }
    const maximumLine = lineCounts.get(finding.path);
    if (Number.isInteger(maximumLine) && finding.lineEnd > maximumLine) {
      throw new Error("리뷰 finding 줄 범위가 변경 파일을 벗어났습니다.");
    }
    if (
      !["high", "medium", "low"].includes(finding.confidence) ||
      typeof finding.title !== "string" ||
      finding.title.length < 1 ||
      finding.title.length > 160 ||
      typeof finding.body !== "string" ||
      finding.body.length < 1 ||
      finding.body.length > 4000
    ) {
      throw new Error("리뷰 finding 필드가 유효하지 않습니다.");
    }
  }
  return value;
}
