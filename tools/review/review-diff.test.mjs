import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { renderDiffSection, splitPatchByFile } from "./review-diff.mjs";

const hunk = (file, body) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${body}\n`;

test("unified diff를 파일 단위로 나누고 경로를 슬래시로 정규화한다", () => {
  const patch = `${hunk("src/a.ts", "+const a = 1;")}${hunk("docs/b.md", "+본문")}`;
  assert.deepEqual(
    splitPatchByFile(patch).map((chunk) => chunk.path),
    ["src/a.ts", "docs/b.md"],
  );
  assert.match(splitPatchByFile(patch)[1].text, /\+본문/);
});

test("diff section은 credential이 있는 hunk와 binary patch를 제외하고 사유만 남긴다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-review-diff-"));
  try {
    mkdirSync(path.join(root, "src"), { recursive: true });
    writeFileSync(path.join(root, "src", "safe.ts"), "export const safe = 1;\n", "utf8");
    writeFileSync(path.join(root, "src", "leak.ts"), "export const apiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234';\n", "utf8");
    const patch = [
      hunk("src/safe.ts", "+export const safe = 1;"),
      hunk("src/leak.ts", "+export const apiKey = 'sk-proj-abcdefghijklmnopqrstuvwxyz1234';"),
      "diff --git a/img.png b/img.png\nGIT binary patch\nliteral 3\nKc$@(M\n\n",
    ].join("");
    const section = renderDiffSection({ repoRoot: root, patch });
    assert.match(section, /^## 변경 diff/);
    assert.match(section, /export const safe = 1;/);
    assert.doesNotMatch(section, /sk-proj-abcdefghijklmnopqrstuvwxyz1234/);
    assert.doesNotMatch(section, /GIT binary patch|Kc\$@\(M/);
    assert.match(section, /src\/leak\.ts.*sensitive-content/);
    assert.match(section, /img\.png.*binary/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("patch가 없으면 diff section은 없음을 명시하고 근거를 발명하지 않는다", () => {
  assert.match(renderDiffSection({ repoRoot: "C:/repo", patch: undefined }), /diff 없음/);
});
