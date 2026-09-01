import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendReviewAudit,
  buildReviewCacheIdentity,
  readReviewCache,
  withReviewLock,
  writeReviewCache,
} from "./review-state.mjs";

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-review-state-"));
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  const commonDirectory = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return {
    root,
    commonDirectory: path.resolve(root, commonDirectory),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

const identityInput = {
  policyVersion: "eatbid.codex-advisory/v1",
  promptVersion: "eatbid.frontend-review-context/v1",
  schemaVersion: "eatbid.codex-review/v1",
  codexVersion: "codex-cli 1.2.3",
  model: "cli-default",
  baseRef: "origin/main",
  baseCommit: "a".repeat(40),
  mergeBase: "a".repeat(40),
  head: "b".repeat(40),
  pathHash: "c".repeat(64),
  diffStatHash: "d".repeat(64),
  promptSha256: "e".repeat(64),
  schemaSha256: "f".repeat(64),
};

test("캐시 식별자는 정책·prompt·schema·Codex·model과 Git 범위를 모두 포함한다", () => {
  const first = buildReviewCacheIdentity(identityInput);
  assert.deepEqual(first.metadata, identityInput);
  assert.match(first.key, /^[a-f0-9]{64}$/);

  for (const field of Object.keys(identityInput)) {
    const changed = buildReviewCacheIdentity({
      ...identityInput,
      [field]: `${identityInput[field]}-변경`,
    });
    assert.notEqual(changed.key, first.key, `${field} 변경은 cache key를 바꿔야 한다`);
  }
});

test("검증 성공 결과만 Git common dir 캐시에 기록하고 다시 읽는다", () => {
  const fixture = repository();
  try {
    const identity = buildReviewCacheIdentity(identityInput);
    const result = {
      schemaVersion: "eatbid.codex-review/v1",
      summary: "검토 완료",
      findings: [],
    };

    assert.equal(
      writeReviewCache({ repoRoot: fixture.root, identity, status: "unavailable", result }),
      false,
    );
    assert.equal(readReviewCache({ repoRoot: fixture.root, identity }), null);
    assert.equal(
      writeReviewCache({ repoRoot: fixture.root, identity, status: "success", result }),
      true,
    );
    assert.deepEqual(readReviewCache({ repoRoot: fixture.root, identity }), result);
  } finally {
    fixture.close();
  }
});

test("동일 저장소의 동시 리뷰는 Git common dir 잠금으로 거부한다", async () => {
  const fixture = repository();
  try {
    await withReviewLock(fixture.root, async () => {
      await assert.rejects(
        () => withReviewLock(fixture.root, async () => undefined),
        (error) => error?.code === "EATBID_REVIEW_LOCKED",
      );
    });
  } finally {
    fixture.close();
  }
});

test("종료된 owner의 stale 잠금은 검증 후 격리하고 새 리뷰를 허용한다", async () => {
  const fixture = repository();
  try {
    const stateDirectory = path.join(fixture.commonDirectory, "eatbid-code-review");
    const lockPath = path.join(stateDirectory, "run.lock");
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({ createdAt: "2020-01-01T00:00:00.000Z", pid: 2_147_483_647 })}\n`,
      "utf8",
    );

    assert.equal(await withReviewLock(fixture.root, async () => "실행됨"), "실행됨");
    assert.ok(readdirSync(stateDirectory).some((name) => name.startsWith("run.lock.recovered-")));
  } finally {
    fixture.close();
  }
});

test("감사 로그는 허용된 hash·상태·시간만 남기고 prompt와 원문 결과를 버린다", () => {
  const fixture = repository();
  try {
    appendReviewAudit({
      repoRoot: fixture.root,
      status: "success",
      reason: null,
      base: identityInput.baseCommit,
      head: identityInput.head,
      pathHash: identityInput.pathHash,
      diffStatHash: identityInput.diffStatHash,
      cacheKey: "1".repeat(64),
      promptSha256: identityInput.promptSha256,
      durationMilliseconds: 123,
      findingCount: 2,
      prompt: "절대 기록하면 안 되는 prompt",
      patch: "절대 기록하면 안 되는 patch",
      environment: { DATABASE_URL: "secret" },
      result: { summary: "절대 기록하면 안 되는 결과" },
    });

    const audit = readFileSync(
      path.join(fixture.commonDirectory, "eatbid-code-review", "audit.jsonl"),
      "utf8",
    );
    assert.match(audit, /"status":"success"/);
    assert.match(audit, /"durationMilliseconds":123/);
    assert.doesNotMatch(
      audit,
      /절대 기록하면 안 되는|DATABASE_URL|secret|patch|environment|result/,
    );
  } finally {
    fixture.close();
  }
});
