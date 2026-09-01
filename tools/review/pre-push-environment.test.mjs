import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  readRepositoryLocalGitVariables,
  removeRepositoryLocalGitVariables,
  withoutRepositoryLocalGitVariables,
} from "./git-local-environment.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const prePushScript = fileURLToPath(new URL("./pre-push.mjs", import.meta.url));

function createPnpmProbe(directory) {
  const outputPath = path.join(directory, "child-environment.json");
  const probePath = path.join(directory, "probe.mjs");
  writeFileSync(
    probePath,
    [
      'import { writeFileSync } from "node:fs";',
      'import path from "node:path";',
      'const localNames = new Set(JSON.parse(process.env.EATBID_LOCAL_GIT_VARIABLES));',
      'const observation = {',
      '  localGitKeys: Object.keys(process.env).filter((name) => localNames.has(name.toUpperCase())),',
      '  infisicalMarker: process.env.INFISICAL_PROJECT_ID,',
      '  pathContainsProbe: process.env.PATH.split(path.delimiter).includes(process.env.EATBID_PROBE_DIRECTORY),',
      '};',
      'writeFileSync(process.env.EATBID_ENV_PROBE_PATH, JSON.stringify(observation));',
      '',
    ].join("\n"),
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

function mixedCase(name, index) {
  return [...name]
    .map((character, characterIndex) =>
      /[A-Z]/u.test(character) && (characterIndex + index) % 2 === 0
        ? character.toLowerCase()
        : character,
    )
    .join("");
}

test("Git이 선언한 저장소 전용 환경 전체를 대소문자와 무관하게 제거한다", () => {
  const localGitVariables = readRepositoryLocalGitVariables(repositoryRoot);
  const dirtyEnvironment = { INFISICAL_PROJECT_ID: "infisical-환경-보존" };
  [...localGitVariables].forEach((name, index) => {
    dirtyEnvironment[mixedCase(name, index)] = `오염-${index}`;
  });

  const copiedEnvironment = withoutRepositoryLocalGitVariables(
    dirtyEnvironment,
    localGitVariables,
  );
  const mutatedEnvironment = { ...dirtyEnvironment };
  removeRepositoryLocalGitVariables(mutatedEnvironment, localGitVariables);

  for (const environment of [copiedEnvironment, mutatedEnvironment]) {
    assert.equal(
      Object.keys(environment).some((name) => localGitVariables.has(name.toUpperCase())),
      false,
    );
    assert.equal(environment.INFISICAL_PROJECT_ID, "infisical-환경-보존");
  }
});

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
    environment.EATBID_LOCAL_GIT_VARIABLES = JSON.stringify([...localGitVariables]);
    environment.EATBID_PROBE_DIRECTORY = fixtureDirectory;
    environment.INFISICAL_PROJECT_ID = "infisical-환경-보존";
    environment.Git_Index_File = path.join(fixtureDirectory, "오염.index");
    environment.EATBID_SENSITIVE_SENTINEL = "민감값-절대-기록-금지";

    const result = spawnSync(process.execPath, [prePushScript], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: environment,
      input: "refs/heads/feature abc refs/heads/feature def\n",
      windowsHide: true,
    });

    assert.equal(result.status, 0, result.stderr);
    const rawObservation = readFileSync(outputPath, "utf8");
    const observation = JSON.parse(rawObservation);
    assert.deepEqual(observation.localGitKeys, []);
    assert.equal(observation.infisicalMarker, "infisical-환경-보존");
    assert.equal(observation.pathContainsProbe, true);
    assert.doesNotMatch(rawObservation, /민감값-절대-기록-금지/u);
    assert.doesNotMatch(rawObservation, /EATBID_SENSITIVE_SENTINEL/u);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
});
