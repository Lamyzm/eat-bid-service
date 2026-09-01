import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { hunkSides, renderDiffSection, splitPatchByFile } from "./review-diff.mjs";
import { hasSensitiveContent } from "./sensitive-content.mjs";

const hunk = (file, body) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${body}\n`;

test("unified diff를 파일 단위로 나누고 rename header는 새 경로를 쓴다", () => {
  const patch = `${hunk("src/a.ts", "+const a = 1;")}${hunk("docs/b.md", "+본문")}diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\n`;
  assert.deepEqual(
    splitPatchByFile(patch).map((chunk) => chunk.path),
    ["src/a.ts", "docs/b.md", "new.ts"],
  );
  assert.match(splitPatchByFile(patch)[1].text, /\+본문/);
});

test("hunk를 old side와 new side로 접두어를 벗겨 재구성한다", () => {
  const text = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,2 @@\n const a = 1;\n-const b = 2;\n+const c = 3;\n\\ No newline at end of file\n";
  assert.deepEqual(hunkSides(text), ["const a = 1;\nconst b = 2;", "const a = 1;\nconst c = 3;"]);
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
    assert.match(section, /삭제된 파일/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("삭제된 민감 경로 hunk와 삭제 전용 credential hunk는 HEAD에 파일이 없어도 제외한다", () => {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-review-diff-"));
  try {
    const patch = [
      "diff --git a/.env b/.env\ndeleted file mode 100644\n--- a/.env\n+++ /dev/null\n@@ -1 +0,0 @@\n-DATABASE_URL=postgres://user:pw-secret-value@host/db\n",
      "diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,4 +1,3 @@\n export const config = {\n-  password: \"old-secret-value-1234\",\n   host: \"db\",\n };\n",
      hunk("src/kept.ts", "+export const kept = true;"),
    ].join("");
    const section = renderDiffSection({ repoRoot: root, patch });
    assert.doesNotMatch(section, /pw-secret-value|old-secret-value-1234/);
    assert.match(section, /\.env.*denied-path/);
    assert.match(section, /src\/config\.ts.*sensitive-content/);
    assert.match(section, /export const kept = true;/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("접두어가 붙은 원문은 credential 검사를 통과하지만 old side 복원은 잡아낸다", () => {
  const chunk =
    "diff --git a/src/config.ts b/src/config.ts\n--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,4 +1,3 @@\n export const config = {\n-  password: \"old-secret-value-1234\",\n   host: \"db\",\n };\n";
  assert.equal(hasSensitiveContent(chunk, "src/config.ts"), false);
  assert.equal(hasSensitiveContent(hunkSides(chunk)[0], "src/config.ts"), true);
});

test("민감 경로에서 rename된 hunk와 quote된 header는 old 경로 기준으로 제외한다", () => {
  const patch = [
    'diff --git a/credentials.json b/config.json\nsimilarity index 60%\nrename from credentials.json\nrename to config.json\n--- a/credentials.json\n+++ b/config.json\n@@ -1 +1 @@\n-{"token":"old-secret-value-1234"}\n+{"keep":true}\n',
    'diff --git "a/we\\"ird.ts" "b/we\\"ird.ts"\n--- "a/we\\"ird.ts"\n+++ "b/we\\"ird.ts"\n@@ -1 +1 @@\n+export const weird = 1;\n',
    hunk("src/kept.ts", "+export const kept = true;"),
  ].join("");
  const section = renderDiffSection({ repoRoot: "C:/repo", patch });
  assert.doesNotMatch(section, /old-secret-value-1234|weird = 1/);
  assert.match(section, /credentials\.json → config\.json.*denied-path/);
  assert.match(section, /quoted-path/);
  assert.match(section, /export const kept = true;/);
});

test("context 밖 깊은 속성의 credential 삭제 줄은 line 수준 fallback으로 제외한다", () => {
  const patch =
    "diff --git a/src/big.ts b/src/big.ts\n--- a/src/big.ts\n+++ b/src/big.ts\n@@ -40,3 +40,2 @@\n   host: \"db\",\n-  password: \"deep-secret-value-1234\",\n   port: 5432,\n";
  assert.equal(hasSensitiveContent(hunkSides(patch)[0], "src/big.ts"), false);
  const section = renderDiffSection({ repoRoot: "C:/repo", patch });
  assert.doesNotMatch(section, /deep-secret-value-1234/);
  assert.match(section, /src\/big\.ts.*sensitive-content/);
});

test("diff 안의 backtick fence보다 긴 fence를 써서 조기에 닫히지 않는다", () => {
  const section = renderDiffSection({ repoRoot: "C:/repo", patch: hunk("docs/a.md", "+```js\n+code\n+```") });
  const fence = section.match(/(`{4,})diff\n/)?.[1];
  assert.equal(fence, "````");
  assert.ok(section.trimEnd().endsWith("````"));
});

test("patch가 없으면 diff section은 없음을 명시하고 근거를 발명하지 않는다", () => {
  assert.match(renderDiffSection({ repoRoot: "C:/repo", patch: undefined }), /diff 없음/);
});
