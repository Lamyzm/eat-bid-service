import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const prePushScript = fileURLToPath(new URL("./pre-push.mjs", import.meta.url));

function createPnpmProbe(directory) {
  const outputPath = path.join(directory, "child-environment.json");
  const probePath = path.join(directory, "probe.mjs");
  writeFileSync(
    probePath,
    'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.EATBID_ENV_PROBE_PATH, JSON.stringify(process.env));\n',
    "utf8",
  );

  if (process.platform === "win32") {
    writeFileSync(
      path.join(directory, "pnpm.cmd"),
      `@"${process.execPath}" "${probePath}" %*\r\n`,
      "utf8",
    );
  } else {
    const executable = path.join(directory, "pnpm");
    writeFileSync(
      executable,
      `#!/bin/sh\nexec "${process.execPath}" "${probePath}" "$@"\n`,
      "utf8",
    );
    chmodSync(executable, 0o755);
  }

  return outputPath;
}

test("pre-push 자식은 저장소 전용 Git 환경을 제거하고 일반 환경은 보존한다", () => {
  const fixtureDirectory = mkdtempSync(path.join(tmpdir(), "eatbid-pre-push-env-"));
  try {
    const outputPath = createPnpmProbe(fixtureDirectory);
    const localGitVariables = new Set(
      execFileSync("git", ["rev-parse", "--local-env-vars"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      })
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((name) => name.toUpperCase()),
    );
    assert.ok(localGitVariables.has("GIT_INDEX_FILE"));

    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.toUpperCase() !== "PATH"),
    );
    environment.PATH = `${fixtureDirectory}${path.delimiter}${process.env.PATH}`;
    environment.EATBID_ENV_PROBE_PATH = outputPath;
    environment.INFISICAL_PROJECT_ID = "infisical-환경-보존";
    environment.Git_Index_File = path.join(fixtureDirectory, "오염.index");

    const result = spawnSync(process.execPath, [prePushScript], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
      input: "refs/heads/feature abc refs/heads/feature def\n",
      windowsHide: true,
    });

    assert.equal(result.status, 0, result.stderr);
    const childEnvironment = JSON.parse(readFileSync(outputPath, "utf8"));
    assert.equal(
      Object.keys(childEnvironment).some((name) => localGitVariables.has(name.toUpperCase())),
      false,
    );
    assert.equal(childEnvironment.INFISICAL_PROJECT_ID, "infisical-환경-보존");
    assert.match(childEnvironment.PATH, new RegExp(fixtureDirectory.replaceAll("\\", "\\\\"), "iu"));
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});
