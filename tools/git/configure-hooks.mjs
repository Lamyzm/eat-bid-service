/** @module 책임: clone과 worktree가 저장소 공용 Git hook 경로 하나만 사용하도록 설정한다. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: repoRoot,
    stdio: "ignore",
    windowsHide: true,
  });
} catch {
  // source archive처럼 Git metadata가 없는 설치에서는 package 설치 자체를 실패시키지 않는다.
}
