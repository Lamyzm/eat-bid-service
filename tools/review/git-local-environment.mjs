/** @module 책임: Git이 선언한 저장소 전용 환경 변수를 pre-push 자식 경계에서 제거한다. */
import { execFileSync } from "node:child_process";

/** 현재 Git 버전이 저장소에만 유효하다고 선언한 환경 변수 이름을 조회한다. */
export function readRepositoryLocalGitVariables(repoRoot) {
  return new Set(
    execFileSync("git", ["rev-parse", "--local-env-vars"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((name) => name.toUpperCase()),
  );
}

/** Windows의 대소문자 무관 환경 키까지 포함해 Git-local 값만 제외한 복사본을 만든다. */
export function withoutRepositoryLocalGitVariables(environment, localVariables) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) => value !== undefined && !localVariables.has(name.toUpperCase()),
    ),
  );
}

/** 전용 pre-push process도 정화해 그 안에서 이어지는 모든 advisory spawn을 격리한다. */
export function removeRepositoryLocalGitVariables(environment, localVariables) {
  for (const name of Object.keys(environment)) {
    if (localVariables.has(name.toUpperCase())) delete environment[name];
  }
}
