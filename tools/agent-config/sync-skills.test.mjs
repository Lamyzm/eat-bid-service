import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectSkillProjection, writeSkillProjection } from "./sync-skills.mjs";

function fixture(canonical, projection) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-skills-"));
  const write = (base, files) => {
    mkdirSync(path.join(root, base), { recursive: true });
    for (const [relativePath, contents] of Object.entries(files)) {
      const target = path.join(root, base, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf8");
    }
  };
  write("canonical", canonical);
  write("projection", projection);
  return {
    canonicalRoot: path.join(root, "canonical"),
    projectionRoot: path.join(root, "projection"),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("byte가 같은 projection은 통과하고 누락·추가·drift는 경로별로 실패한다", () => {
  const same = fixture({ "a/SKILL.md": "# a\r\n" }, { "a/SKILL.md": "# a\r\n" });
  try {
    assert.deepEqual(inspectSkillProjection(same), {
      ok: true,
      missing: [],
      extra: [],
      drifted: [],
      synced: ["a/SKILL.md"],
    });
  } finally {
    same.close();
  }
  const broken = fixture(
    { "a/SKILL.md": "# a\n", "b/SKILL.md": "# b\n", "b/references/x.md": "x\n" },
    { "a/SKILL.md": "# a 수정\n", "c/SKILL.md": "# c\n", "b/SKILL.md": "# b\n" },
  );
  try {
    assert.deepEqual(inspectSkillProjection(broken), {
      ok: false,
      missing: ["b/references/x.md"],
      extra: ["c/SKILL.md"],
      drifted: ["a/SKILL.md"],
      synced: ["b/SKILL.md"],
    });
  } finally {
    broken.close();
  }
});

test("write는 canonical을 그대로 복사하고 projection에만 있는 파일과 빈 디렉터리를 제거한다", () => {
  const target = fixture({ "a/SKILL.md": "# a\n" }, { "a/SKILL.md": "old", "z/SKILL.md": "extra" });
  try {
    const result = writeSkillProjection(target);
    assert.deepEqual(result, { written: ["a/SKILL.md"], removed: ["z/SKILL.md"] });
    assert.equal(readFileSync(path.join(target.projectionRoot, "a", "SKILL.md"), "utf8"), "# a\n");
    assert.equal(existsSync(path.join(target.projectionRoot, "z")), false);
    assert.equal(inspectSkillProjection(target).ok, true);
  } finally {
    target.close();
  }
});

test("Windows 구분자로 만든 경로도 보고서에서는 슬래시로 정규화한다", () => {
  const target = fixture({ "deep/nested/SKILL.md": "n\n" }, {});
  try {
    assert.deepEqual(inspectSkillProjection(target).missing, ["deep/nested/SKILL.md"]);
  } finally {
    target.close();
  }
});

test("저장소의 루트 skill projection은 canonical과 byte 단위로 같다", () => {
  const report = inspectSkillProjection({
    canonicalRoot: ".agents/skills",
    projectionRoot: ".claude/skills",
  });
  assert.deepEqual(
    { missing: report.missing, extra: report.extra, drifted: report.drifted },
    { missing: [], extra: [], drifted: [] },
  );
  assert.ok(report.synced.length >= 3);
});
