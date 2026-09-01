import assert from "node:assert/strict";
import test from "node:test";

import { validateCommitMessage } from "./check-commit-message.mjs";

test("한국어 요약과 선택적인 Conventional Commit 접두사를 허용한다", () => {
  for (const message of [
    "프론트엔드 기반을 정리한다\n",
    "feat(web): 공고 화면 기반을 연결한다\n",
    "fix!: 계약 경계를 바로잡는다\n\n검증 오류를 조기에 차단한다.\n",
  ]) {
    assert.deepEqual(validateCommitMessage(message), { ok: true, errors: [] });
  }
});

test("영문이나 비어 있는 커밋 요약을 거부한다", () => {
  for (const message of ["", "feat(web): add review hook\n", "Merge branch 'main'\n"]) {
    const result = validateCommitMessage(message);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  }
});

test("Git trailer와 URL 및 코드 블록을 제외한 설명 문단은 한국어를 요구한다", () => {
  assert.equal(
    validateCommitMessage(
      "feat(review): 한국어 gate를 추가한다\n\nhttps://example.com/spec\n\n```ts\nconst value = true;\n```\n\nCo-authored-by: Codex <codex@example.com>\n",
    ).ok,
    true,
  );
  assert.equal(
    validateCommitMessage("feat(review): 한국어 gate를 추가한다\n\nOnly English prose remains.\n")
      .ok,
    false,
  );
  assert.equal(
    validateCommitMessage(
      "feat(review): 한국어 gate를 추가한다\n\nToken: English prose is not a terminal trailer\n\n이유를 설명한다.\n",
    ).ok,
    false,
  );
});
