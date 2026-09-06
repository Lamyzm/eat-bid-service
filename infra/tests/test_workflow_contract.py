from __future__ import annotations

import ast
import os
import re
import shlex
from collections.abc import Iterable, Mapping
from itertools import pairwise
from pathlib import Path
from uuid import UUID

import pytest
import yaml
from conftest import ManifestSet
from eatbid.cli import build_parser
from eatbid.core.record_types import is_projectable_record_type
from eatbid.source.eat.registry import require
from eatbid.source.eat.schema_contract import REVIEWED_EAT_SCHEMA_CONTRACTS

ROOT = Path(__file__).parents[2]
PRODUCT_KUSTOMIZATION = ROOT / "infra" / "product" / "kustomization.yaml"
PLATFORM_APPLICATION = ROOT / "infra" / "platform" / "argo-workflows.application.yaml"
LIVE_APPLICATION = ROOT / "infra" / "argocd" / "application.yaml"
CLI = ROOT / "apps" / "dataplane" / "src" / "eatbid" / "cli.py"
BUILD_WORKFLOW = ROOT / ".github" / "workflows" / "build.yml"

SCHEDULED_COMMANDS = ("discover", "capture", "normalize", "validate", "project")
# DAG task 이름과 CLI 명령 이름이 하나 어긋난다. `marts` 단계는 `build-marts`를 부른다 — 단계는
# 무엇을 다시 만드는지를, 명령은 무엇을 실행하는지를 이름으로 말한다.
SCHEDULED_TASKS = (*SCHEDULED_COMMANDS, "marts")
TASK_COMMANDS = {**{name: name for name in SCHEDULED_COMMANDS}, "marts": "build-marts"}
SHELL_STAGES = ("capture", "normalize", "validate", "project", "marts")
PYTHON_ENTRYPOINT_TEMPLATES = ("discover", "replay")
# shell 단계가 `$NAME`으로 읽는 값의 표본이다. BUILD_SHA만 container env가 아니라 image ENV에서 온다.
SAMPLE_STAGE_ENV = {
    "BUILD_SHA": "a" * 64,
    "EATBID_WORKFLOW_MODE": "poll-open",
    "EATBID_RUN_ID": "00000000-0000-0000-0000-000000000001",
    "EATBID_PARSER_VERSION": "eat-v1",
    "EATBID_WORKFLOW_CREATED_AT": "2026-09-04T03:00:00Z",
    "EATBID_RESULT_DIR": "/tmp/eatbid",
    "EATBID_SOURCE_RELEASE_ID": "00000000-0000-0000-0000-000000000002",
    "EATBID_DETAIL_RUN_ID": "00000000-0000-0000-0000-000000000003",
    "EATBID_PUBLICATION_ID": "00000000-0000-0000-0000-000000000004",
    "EATBID_EXTERNAL_BID_ID": "5610615",
    "EATBID_OBSERVATION_ID": "7",
    "EATBID_MART_CALC_VERSION": "mart-r1",
}
SHELL_CLOCK = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
SHELL_VARIABLE = re.compile(r"\$\{?([A-Z_][A-Z0-9_]*)\}?")
PRODUCT_IMAGES = {
    "eatbid-web",
    "eatbid-server",
    "eatbid-dataplane",
    "eatbid-migration",
}


def _mapping(value: object) -> Mapping[str, object]:
    assert isinstance(value, Mapping)
    return value


def _sequence(value: object) -> list[object]:
    assert isinstance(value, list)
    return value


def _metadata(document: Mapping[str, object]) -> Mapping[str, object]:
    return _mapping(document["metadata"])


def _spec(document: Mapping[str, object]) -> Mapping[str, object]:
    return _mapping(document["spec"])


def _templates(workflow_template: Mapping[str, object]) -> dict[str, Mapping[str, object]]:
    return {
        str(template["name"]): template
        for item in _sequence(_spec(workflow_template)["templates"])
        if isinstance(item, Mapping)
        for template in (item,)
    }


def _all_mappings(value: object) -> Iterable[Mapping[str, object]]:
    if isinstance(value, Mapping):
        yield value
        for child in value.values():
            yield from _all_mappings(child)
    elif isinstance(value, list):
        for child in value:
            yield from _all_mappings(child)


def _images(manifests: ManifestSet) -> list[str]:
    return [
        str(mapping["image"])
        for document in manifests.documents
        for mapping in _all_mappings(document)
        if "image" in mapping
    ]


def _env(container: Mapping[str, object], name: str) -> Mapping[str, object]:
    matches = [
        _mapping(item)
        for item in _sequence(container.get("env", []))
        if isinstance(item, Mapping) and item.get("name") == name
    ]
    assert len(matches) == 1, (name, len(matches))
    return matches[0]


def _secret_ref(env: Mapping[str, object]) -> tuple[str, str]:
    value_from = _mapping(env["valueFrom"])
    secret_key_ref = _mapping(value_from["secretKeyRef"])
    return str(secret_key_ref["name"]), str(secret_key_ref["key"])


def _cli_commands() -> tuple[str, ...]:
    module = ast.parse(CLI.read_text(encoding="utf-8"))
    assignment = next(
        node
        for node in module.body
        if isinstance(node, ast.AnnAssign)
        and isinstance(node.target, ast.Name)
        and node.target.id == "COMMAND_METHODS"
    )
    # CLI는 kebab-case 명령과 snake_case method의 대응을 dict 하나에 둔다. 실행 없이 그 literal만
    # 읽어 workflow가 부르는 명령과 대조한다.
    commands = ast.literal_eval(assignment.value)
    assert isinstance(commands, dict)
    return tuple(commands)


def test_product와_base_render가_kind_구성을_유지한다(
    manifests: ManifestSet, base_manifests: ManifestSet
) -> None:
    assert manifests.kinds.count("WorkflowTemplate") == 1
    assert manifests.kinds.count("CronWorkflow") == 2
    # migration(schema)과 db-provisioning(권한) 둘뿐이다. 여기를 늘리기 전에 새 Job이 왜 hook이어야
    # 하는지 먼저 답해야 한다.
    assert manifests.kinds.count("Job") == 2
    assert {
        _metadata(job)["name"] for job in manifests.of_kind("Job")
    } == {"eatbid-migration", "eatbid-db-provisioning"}
    assert manifests.kinds.count("CronJob") == 0
    assert manifests.kinds.count("Application") == 0
    assert manifests.kinds.count("Secret") == 0

    assert base_manifests.kinds.count("CronJob") == 4
    assert {
        _metadata(cron_job)["name"] for cron_job in base_manifests.of_kind("CronJob")
    } == {"daily-refresh", "poll-open-day", "poll-open-off", "poll-open-weekend"}


def test_live_application은_main의_product_composition을_소비한다() -> None:
    application = yaml.safe_load(LIVE_APPLICATION.read_text(encoding="utf-8"))
    assert application["spec"]["source"] == {
        "repoURL": "https://github.com/Lamyzm/eat-bid-service",
        "targetRevision": "main",
        "path": "infra/product",
    }
    # cutover는 source만 옮긴다. 자동 sync가 켜져 있으므로 수집 schedule은 계속 정지 상태여야 한다.
    assert application["spec"]["destination"] == {
        "server": "https://kubernetes.default.svc",
        "namespace": "eatbid",
    }
    assert application["spec"]["syncPolicy"]["automated"] == {
        "prune": True,
        "selfHeal": True,
    }


def test_workflow_template가_현재_CLI와_지속_가능한_boundary를_사용한다(
    manifests: ManifestSet,
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    spec = _spec(workflow_template)
    assert spec["entrypoint"] == "scheduled-pipeline"
    assert spec["serviceAccountName"] == "eatbid-dataplane"
    # withParam fan-out은 발견 건수만큼 pod를 만들므로 workflow 전체 동시성 상한이 없으면 단일 노드의
    # kubelet pod 상한(110)과 DB 연결을 한 번에 소진한다(2026-09-05 backfill 131건 중 22건 실패).
    parallelism = spec["parallelism"]
    assert isinstance(parallelism, int) and 1 <= parallelism <= 16
    reviewed_parser_versions = {key[2] for key in REVIEWED_EAT_SCHEMA_CONTRACTS}
    workflow_parameters = {
        item["name"]: item["value"]
        for item in _sequence(_mapping(spec["arguments"])["parameters"])
        if isinstance(item, Mapping)
    }
    template_parser_version = workflow_parameters["parser-version"]
    # 검토된 version은 eat-v1·eat-v2 둘이지만 기본값은 발행 경로가 열린 version이어야 한다. eat-v2는
    # EAT-43 전까지 projection에서 typed 실패로 멈추므로(ADR 0029 후속 결정) 기본값이 되면 크롤 예산만
    # 쓰고 core에는 아무것도 도착하지 않는다.
    assert template_parser_version in reviewed_parser_versions
    assert is_projectable_record_type(
        require("bid-detail", parser_version=template_parser_version).record_type
    )

    templates = _templates(workflow_template)
    tasks = _dag_tasks(workflow_template)
    assert [task["name"] for task in tasks] == list(SCHEDULED_TASKS)
    assert [task["template"] for task in tasks] == list(SCHEDULED_TASKS)
    assert tasks[0].get("dependencies", []) == []
    for previous, current in pairwise(SCHEDULED_TASKS):
        task = next(task for task in tasks if task["name"] == current)
        assert task["dependencies"] == [previous]

    assert _cli_commands() == (*SCHEDULED_COMMANDS, "replay", "build-marts")
    assert "replay" in templates
    assert "marts" in templates
    # verify pod는 만들지 않는다. build의 `verified` 전이가 이미 행 수 검증을 갖는다(ADR 0034).
    assert "verify" not in templates
    # 어떤 template도 튜닝 상수를 인자에 박지 않는다. 페이지 크기·기간·지역 수 같은 값이
    # 여기 들어오면 workflow 매니페스트가 CLI와 별개의 두 번째 설정 원천이 된다.
    for template in templates.values():
        container = template.get("container")
        if container is None:
            continue
        for argument in _sequence(_mapping(container)["args"]):
            assert not re.search(r"--[\w-]+[=\s]+\"?\d", str(argument)), argument
    assert "retryStrategy" not in yaml.safe_dump(workflow_template)
    assert "artifact" not in yaml.safe_dump(workflow_template).lower()

    source_limited = []
    for name in ("discover", "capture"):
        synchronization = _mapping(templates[name]["synchronization"])
        semaphores = [_mapping(item) for item in _sequence(synchronization["semaphores"])]
        key_ref = _mapping(semaphores[0]["configMapKeyRef"])
        source_limited.append((key_ref["name"], key_ref["key"]))
    assert source_limited == [
        ("eatbid-workflow-limits", "eatbid-source-limit"),
        ("eatbid-workflow-limits", "eatbid-source-limit"),
    ]

    project_sync = _mapping(templates["project"]["synchronization"])
    project_mutexes = [_mapping(item) for item in _sequence(project_sync["mutexes"])]
    assert project_mutexes == [{"name": "eatbid-core-publication"}]

    # mart 빌드가 core 발행과 같은 mutex를 쓰면 다음 수집의 발행이 빌드를 기다려 소스 관측이 늦어진다.
    marts_sync = _mapping(templates["marts"]["synchronization"])
    marts_mutexes = [_mapping(item) for item in _sequence(marts_sync["mutexes"])]
    assert marts_mutexes == [{"name": "eatbid-mart-build"}]
    assert "semaphores" not in marts_sync
    # mart 빌드는 fan-out하지 않는다. 한 mart를 한 build로 통째로 다시 만드는 것이 원자 단위다.
    assert "withParam" not in next(task for task in tasks if task["name"] == "marts")

    containers = [
        _mapping(templates[name]["container"])
        for name in (*SCHEDULED_COMMANDS, "marts", "replay")
    ]
    dataplane_images = {str(container["image"]) for container in containers}
    assert len(dataplane_images) == 1
    assert re.fullmatch(
        r"ghcr\.io/lamyzm/eatbid-dataplane@sha256:[0-9a-f]{64}",
        next(iter(dataplane_images)),
    )
    for container in containers:
        template_name = next(
            name
            for name in (*SCHEDULED_COMMANDS, "marts", "replay")
            if templates[name]["container"] is container
        )
        command = str(_sequence(container["args"])[0])
        if template_name in PYTHON_ENTRYPOINT_TEMPLATES:
            assert container["command"] == ["python", "-c"]
            assert '"--build-sha", os.environ["BUILD_SHA"]' in command
        else:
            assert container["command"] == ["/bin/sh", "-ec"]
            assert command.startswith(f"exec eatbid {TASK_COMMANDS[template_name]} ")
            assert '--build-sha "$BUILD_SHA"' in command
            assert "$(BUILD_SHA)" not in command
        assert _env(container, "EATBID_PARSER_VERSION")["value"] == (
            "{{workflow.parameters.parser-version}}"
        )
        assert _secret_ref(_env(container, "DATABASE_URL")) == (
            "eatbid-database-dataplane",
            "DATABASE_URL",
        )
        assert _secret_ref(_env(container, "R2_SECRET_ACCESS_KEY")) == (
            "eatbid-r2",
            "R2_SECRET_ACCESS_KEY",
        )

    limit = manifests.named("ConfigMap", "eatbid-workflow-limits")
    assert limit["data"] == {"eatbid-source-limit": "1"}
    service_account = manifests.named("ServiceAccount", "eatbid-dataplane")
    assert service_account["imagePullSecrets"] == [{"name": "ghcr-pull"}]


def test_cron_workflow는_활성이고_pipeline만_schedule한다(
    manifests: ManifestSet,
) -> None:
    cron_workflows = manifests.of_kind("CronWorkflow")
    assert {_metadata(cron)["name"] for cron in cron_workflows} == {
        "eatbid-poll-open",
        "eatbid-daily-reconcile",
    }

    expected_schedules = {
        "eatbid-poll-open": "*/30 8-19 * * 1-5",
        "eatbid-daily-reconcile": "0 7 * * *",
    }
    expected_modes = {
        "eatbid-poll-open": "poll-open",
        "eatbid-daily-reconcile": "daily-reconcile",
    }
    for cron in cron_workflows:
        name = str(_metadata(cron)["name"])
        spec = _spec(cron)
        assert "schedule" not in spec
        assert spec["schedules"] == [expected_schedules[name]]
        assert spec["timezone"] == "Asia/Seoul"
        # 2026-09-05 수집 cutover(EAT-51): 항상 켜진 VM 클러스터에서 스케줄을 켠다. 다시 멈추는 결정은
        # manifest와 이 단언을 같은 커밋에서 바꾼다.
        assert spec["suspend"] is False
        workflow_spec = _mapping(spec["workflowSpec"])
        template_ref = _mapping(workflow_spec["workflowTemplateRef"])
        assert template_ref == {"name": "eatbid-dataplane"}
        parameters = {
            item["name"]: item["value"]
            for item in _sequence(_mapping(workflow_spec["arguments"])["parameters"])
            if isinstance(item, Mapping)
        }
        assert parameters == {"mode": expected_modes[name]}

    rendered = yaml.safe_dump_all(manifests.documents)
    assert "backfill" not in rendered
    assert "entrypoint: replay" not in rendered


def _execute_replay_script(
    manifests: ManifestSet,
    monkeypatch: object,
    observation_ids_json: str,
) -> list[str]:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    replay = _mapping(_templates(workflow_template)["replay"])
    container = _mapping(replay["container"])
    script = str(_sequence(container["args"])[0])
    captured: list[str] = []

    def capture_execvp(executable: str, argv: list[str]) -> None:
        assert executable == "eatbid"
        captured.extend(argv)

    environment = {
        "BUILD_SHA": "a" * 64,
        "EATBID_RUN_ID": "00000000-0000-0000-0000-000000000001",
        "EATBID_PARSER_VERSION": "eat-v1",
        "EATBID_SOURCE_RELEASE_ID": "00000000-0000-0000-0000-000000000003",
        "EATBID_PUBLICATION_ID": "00000000-0000-0000-0000-000000000002",
        "EATBID_OBSERVATION_IDS_JSON": observation_ids_json,
        "EATBID_STARTED_AT": "2026-08-29T05:00:00Z",
        "EATBID_NORMALIZED_AT": "2026-08-29T05:01:00Z",
        "EATBID_VALIDATED_AT": "2026-08-29T05:02:00Z",
        "EATBID_ACTIVATED_AT": "2026-08-29T05:03:00Z",
    }
    for key, value in environment.items():
        monkeypatch.setenv(key, value)  # type: ignore[attr-defined]
    monkeypatch.setattr(os, "execvp", capture_execvp)  # type: ignore[attr-defined]
    exec(compile(script, "<replay-entrypoint>", "exec"), {})  # noqa: S102
    return captured


def test_replay_JSON_ID가_정확히_반복된_CLI_argv가_된다(
    manifests: ManifestSet, monkeypatch: object
) -> None:
    argv = _execute_replay_script(manifests, monkeypatch, "[7, 3]")
    assert argv[0:2] == ["eatbid", "replay"]
    observation_flags = [
        value
        for index, value in enumerate(argv)
        if index > 0 and argv[index - 1] == "--observation-id"
    ]
    assert observation_flags == ["7", "3"]
    assert argv.count("--observation-id") == 2
    parsed = build_parser().parse_args(argv[1:])
    assert parsed.source_release_id == UUID("00000000-0000-0000-0000-000000000003")


def _dag_tasks(workflow_template: Mapping[str, object]) -> list[Mapping[str, object]]:
    dag = _mapping(_templates(workflow_template)["scheduled-pipeline"]["dag"])
    return [_mapping(task) for task in _sequence(dag["tasks"])]


def _task_arguments(task: Mapping[str, object]) -> dict[str, str]:
    arguments = _mapping(task.get("arguments", {}))
    return {
        str(item["name"]): str(item["value"])
        for item in _sequence(arguments.get("parameters", []))
        if isinstance(item, Mapping)
    }


def _input_names(template: Mapping[str, object]) -> set[str]:
    inputs = _mapping(template.get("inputs", {}))
    return {
        str(item["name"])
        for item in _sequence(inputs.get("parameters", []))
        if isinstance(item, Mapping)
    }


def _output_paths(template: Mapping[str, object]) -> dict[str, str]:
    outputs = _mapping(template.get("outputs", {}))
    return {
        str(item["name"]): str(_mapping(_mapping(item)["valueFrom"])["path"])
        for item in _sequence(outputs.get("parameters", []))
        if isinstance(item, Mapping)
    }


def _render_shell_argv(command: str, environment: Mapping[str, str]) -> list[str]:
    """`sh -ec` 문자열을 표본 env로 펼친다. 시계 치환과 `$NAME` 확장 외의 shell 기능은 없어야 한다."""
    rendered = command.replace(SHELL_CLOCK, "2026-09-04T03:05:00Z")
    assert "$(" not in rendered, command
    assert "`" not in rendered, command
    rendered = SHELL_VARIABLE.sub(lambda match: environment[match.group(1)], rendered)
    argv = shlex.split(rendered)
    assert argv[0] == "exec"
    return argv[1:]


def _execute_discover_script(
    manifests: ManifestSet, monkeypatch: object, environment: Mapping[str, str]
) -> list[str]:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    container = _mapping(_templates(workflow_template)["discover"]["container"])
    script = str(_sequence(container["args"])[0])
    captured: list[str] = []

    def capture_execvp(executable: str, argv: list[str]) -> None:
        assert executable == "eatbid"
        captured.extend(argv)

    for key in list(SAMPLE_STAGE_ENV) + ["EATBID_START_DATE", "EATBID_END_DATE", "EATBID_RELEASE_NAME"]:
        monkeypatch.delenv(key, raising=False)  # type: ignore[attr-defined]
    for key, value in environment.items():
        monkeypatch.setenv(key, value)  # type: ignore[attr-defined]
    monkeypatch.setattr(os, "execvp", capture_execvp)  # type: ignore[attr-defined]
    exec(compile(script, "<discover-entrypoint>", "exec"), {})  # noqa: S102
    return captured


def _flag_value(argv: list[str], flag: str) -> str:
    assert argv.count(flag) == 1, (flag, argv)
    return argv[argv.index(flag) + 1]


@pytest.mark.parametrize("mode", ["poll-open", "daily-reconcile"])
def test_discover_단계는_mode를_CLI에_넘기고_예약_모드의_창은_CLI가_번역한다(
    manifests: ManifestSet, monkeypatch: object, tmp_path: Path, mode: str
) -> None:
    environment = {
        **SAMPLE_STAGE_ENV,
        "EATBID_WORKFLOW_MODE": mode,
        "EATBID_RESULT_DIR": str(tmp_path / "result"),
        "EATBID_START_DATE": "",
        "EATBID_END_DATE": "",
        "EATBID_RELEASE_NAME": "",
    }
    argv = _execute_discover_script(manifests, monkeypatch, environment)

    assert argv[0:2] == ["eatbid", "discover"]
    parsed = build_parser().parse_args(argv[1:])
    assert (parsed.mode, parsed.start_date, parsed.end_date) == (mode, "", "")
    assert parsed.run_id == UUID(environment["EATBID_RUN_ID"])
    assert parsed.detail_run_id != parsed.run_id
    assert parsed.source_release_id not in {parsed.run_id, parsed.detail_run_id}
    assert parsed.as_of.isoformat() == "2026-09-04T03:00:00+00:00"
    assert parsed.release_name
    assert parsed.result_dir == tmp_path / "result"
    # 뒤 단계가 받을 publication 정체성은 discover가 먼저 파일로 남긴다.
    assert UUID((tmp_path / "result" / "publication_id").read_text(encoding="utf-8"))


def test_discover_단계는_같은_workflow에서_같은_정체성을_다시_만든다(
    manifests: ManifestSet, monkeypatch: object, tmp_path: Path
) -> None:
    environment = {
        **SAMPLE_STAGE_ENV,
        "EATBID_WORKFLOW_MODE": "backfill",
        "EATBID_RESULT_DIR": str(tmp_path / "result"),
        "EATBID_START_DATE": "20250901",
        "EATBID_END_DATE": "20251130",
        "EATBID_RELEASE_NAME": "2025 가을 backfill",
    }
    first = build_parser().parse_args(
        _execute_discover_script(manifests, monkeypatch, environment)[1:]
    )
    second = build_parser().parse_args(
        _execute_discover_script(manifests, monkeypatch, environment)[1:]
    )

    assert (first.source_release_id, first.detail_run_id) == (
        second.source_release_id,
        second.detail_run_id,
    )
    assert (first.mode, first.start_date, first.end_date) == ("backfill", "20250901", "20251130")
    assert first.release_name == "2025 가을 backfill"


def test_discover_단계는_workflow_uid_없이_CLI를_부르지_않는다(
    manifests: ManifestSet, monkeypatch: object, tmp_path: Path
) -> None:
    for broken in ("", "not-a-uuid"):
        with pytest.raises(SystemExit) as error:
            _execute_discover_script(
                manifests,
                monkeypatch,
                {**SAMPLE_STAGE_ENV, "EATBID_RUN_ID": broken, "EATBID_RESULT_DIR": str(tmp_path)},
            )
        assert error.value.code == 64


@pytest.mark.parametrize("template_name", SHELL_STAGES)
def test_shell_단계의_argv는_CLI_parser의_필수_인자를_모두_채운다(
    manifests: ManifestSet, template_name: str
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    template = _templates(workflow_template)[template_name]
    container = _mapping(template["container"])
    command = str(_sequence(container["args"])[0])

    argv = _render_shell_argv(command, SAMPLE_STAGE_ENV)
    assert argv[0:2] == ["eatbid", TASK_COMMANDS[template_name]]
    parsed = build_parser().parse_args(argv[1:])
    # 발견 뒤의 모든 단계는 detail run 정체성으로 돈다. 첫 live 실행에서 discovery run으로 발행을
    # 시도해 membership 오류가 났던 것이 근거다.
    assert parsed.run_id == UUID(SAMPLE_STAGE_ENV["EATBID_DETAIL_RUN_ID"])
    assert parsed.source_release_id == UUID(SAMPLE_STAGE_ENV["EATBID_SOURCE_RELEASE_ID"])
    assert parsed.build_sha == SAMPLE_STAGE_ENV["BUILD_SHA"]

    declared = {
        str(item["name"])
        for item in _sequence(container["env"])
        if isinstance(item, Mapping)
    }
    referenced = set(SHELL_VARIABLE.findall(command))
    assert referenced - {"BUILD_SHA"} <= declared, referenced - declared
    for name in _input_names(template):
        assert any(
            _env(container, str(item["name"]))["value"] == f"{{{{inputs.parameters.{name}}}}}"
            for item in _sequence(container["env"])
            if isinstance(item, Mapping) and "value" in item
        ), name


@pytest.mark.parametrize("template_name", SHELL_STAGES)
def test_이미지가_굽는_release_commit_40자_BUILD_SHA로도_argv가_통과한다(
    manifests: ManifestSet, template_name: str
) -> None:
    """왜: 이미지는 `ENV BUILD_SHA=$GIT_SHA`로 40자 release commit을 굽는다. 64자 표본만 두면
    첫 실제 실행이 인자 단계 exit 2로 죽는 EAT-58 회귀를 이 계약이 잡지 못한다."""
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    template = _templates(workflow_template)[template_name]
    command = str(_sequence(_mapping(template["container"])["args"])[0])
    release_commit = "9c9ff63f479d03f0fbfcc036954e8470b182bb61"

    argv = _render_shell_argv(command, {**SAMPLE_STAGE_ENV, "BUILD_SHA": release_commit})

    assert build_parser().parse_args(argv[1:]).build_sha == release_commit


def test_DAG는_discover_output으로_capture와_normalize를_fan_out한다(
    manifests: ManifestSet,
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)
    tasks = {str(task["name"]): task for task in _dag_tasks(workflow_template)}

    discover_outputs = _output_paths(templates["discover"])
    result_dir = _env(_mapping(templates["discover"]["container"]), "EATBID_RESULT_DIR")["value"]
    assert discover_outputs == {
        "source-release-id": f"{result_dir}/source_release_id",
        "detail-run-id": f"{result_dir}/detail_run_id",
        "publication-id": f"{result_dir}/publication_id",
        "external-bid-ids": f"{result_dir}/external_bid_ids",
        "discovered-count": f"{result_dir}/discovered_count",
    }
    assert _output_paths(templates["capture"]) == {
        "observation-id": f"{result_dir}/observation_id"
    }

    assert tasks["capture"]["withParam"] == (
        "{{tasks.discover.outputs.parameters.external-bid-ids}}"
    )
    assert tasks["normalize"]["withParam"] == (
        "{{tasks.capture.outputs.parameters.observation-id}}"
    )
    assert "withParam" not in tasks["validate"]
    assert "withParam" not in tasks["project"]

    for name in SHELL_STAGES:
        arguments = _task_arguments(tasks[name])
        assert set(arguments) == _input_names(templates[name]), name
        assert arguments["source-release-id"] == (
            "{{tasks.discover.outputs.parameters.source-release-id}}"
        )
        assert arguments["detail-run-id"] == (
            "{{tasks.discover.outputs.parameters.detail-run-id}}"
        )
    assert _task_arguments(tasks["capture"])["external-bid-id"] == "{{item}}"
    assert _task_arguments(tasks["normalize"])["observation-id"] == "{{item}}"
    for name in ("validate", "project", "marts"):
        assert _task_arguments(tasks[name])["publication-id"] == (
            "{{tasks.discover.outputs.parameters.publication-id}}"
        )


def test_replay_DAG는_core를_다시_앉힌_뒤_같은_marts_task를_잇는다(
    manifests: ManifestSet,
) -> None:
    """왜: replay가 core를 다시 앉혀도 mart를 다시 만들지 않으면 화면이 옛 build를 계속 읽는다."""
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)
    dag = _mapping(templates["replay-pipeline"]["dag"])
    tasks = {str(_mapping(task)["name"]): _mapping(task) for task in _sequence(dag["tasks"])}

    assert set(tasks) == {"replay", "marts"}
    assert tasks["replay"].get("dependencies", []) == []
    assert tasks["marts"]["dependencies"] == ["replay"]
    assert tasks["marts"]["template"] == "marts"
    # replay-pipeline이 받는 입력만으로 replay가 완전히 채워져야 ad hoc 실행이 CLI에서 멈추지 않는다.
    assert _input_names(templates["replay-pipeline"]) == _input_names(templates["replay"])
    for name, value in _task_arguments(tasks["replay"]).items():
        assert value == f"{{{{inputs.parameters.{name}}}}}", name
    marts_arguments = _task_arguments(tasks["marts"])
    assert set(marts_arguments) == _input_names(templates["marts"])
    # replay는 discovery 없이 workflow uid 하나로 돈다.
    assert marts_arguments["detail-run-id"] == "{{workflow.uid}}"


def test_workflow_parameter는_mode_외에_backfill_창만_추가로_받는다(
    manifests: ManifestSet,
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    parameters = {
        str(item["name"]): item["value"]
        for item in _sequence(_mapping(_spec(workflow_template)["arguments"])["parameters"])
        if isinstance(item, Mapping)
    }
    assert parameters == {
        "mode": "poll-open",
        "parser-version": "eat-v1",
        "calc-version": "mart-r1",
        "start-date": "",
        "end-date": "",
        "release-name": "",
    }
    discover_env = _mapping(_templates(workflow_template)["discover"]["container"])
    assert _env(discover_env, "EATBID_WORKFLOW_MODE")["value"] == "{{workflow.parameters.mode}}"
    assert _env(discover_env, "EATBID_START_DATE")["value"] == "{{workflow.parameters.start-date}}"
    assert _env(discover_env, "EATBID_END_DATE")["value"] == "{{workflow.parameters.end-date}}"
    assert _env(discover_env, "EATBID_WORKFLOW_CREATED_AT")["value"] == (
        "{{workflow.creationTimestamp}}"
    )


def test_replay_JSON_ID가_shell_확장_없이_fail_closed한다(
    manifests: ManifestSet, monkeypatch: object
) -> None:
    invalid_values = (
        "[]",
        "[7, 7]",
        '["7"]',
        "[0]",
        "[-1]",
        "[true]",
        "[9223372036854775808]",
        "",
        "not-json",
        "{}",
        '["*"]',
        '["7; touch /tmp/eatbid-injection"]',
        '["$(touch /tmp/eatbid-substitution)"]',
    )
    for value in invalid_values:
        with pytest.raises(SystemExit) as error:
            _execute_replay_script(manifests, monkeypatch, value)
        assert error.value.code == 64


def test_migration은_sync_wave_1_hook이고_유한하며_secret_DATABASE_URL만_사용한다(
    manifests: ManifestSet,
) -> None:
    job = manifests.named("Job", "eatbid-migration")
    annotations = _mapping(_metadata(job)["annotations"])
    # PreSync면 빈 클러스터에서 postgres보다 먼저 돌아 sync가 멈춘다(EAT-50 실측).
    # wave 0(postgres·Secret) → 1(migration) → 2(db-provisioning) → 3(server·web) 순서다.
    assert annotations["argocd.argoproj.io/hook"] == "Sync"
    assert annotations["argocd.argoproj.io/sync-wave"] == "1"
    assert annotations["argocd.argoproj.io/hook-delete-policy"] == "BeforeHookCreation,HookSucceeded"
    for name in ("server", "web"):
        app_annotations = _mapping(_metadata(manifests.named("Deployment", name)).get("annotations", {}))
        assert app_annotations["argocd.argoproj.io/sync-wave"] == "3", name
    postgres_annotations = _mapping(_metadata(manifests.named("Deployment", "postgres")).get("annotations", {}))
    assert "argocd.argoproj.io/sync-wave" not in postgres_annotations
    spec = _spec(job)
    assert spec["activeDeadlineSeconds"] == 600
    assert spec["backoffLimit"] == 1
    pod_spec = _mapping(_mapping(_mapping(spec["template"])["spec"])["containers"][0])
    assert re.fullmatch(
        r"ghcr\.io/lamyzm/eatbid-migration@sha256:[0-9a-f]{64}",
        str(pod_spec["image"]),
    )
    assert _secret_ref(_env(pod_spec, "DATABASE_URL")) == (
        "eatbid-database-migrator",
        "DATABASE_URL",
    )
    assert _mapping(_mapping(spec["template"])["spec"])["restartPolicy"] == "Never"


def test_product_render는_hostPath와_literal_database_credential을_포함하지_않는다(
    manifests: ManifestSet,
) -> None:
    for document in manifests.documents:
        for mapping in _all_mappings(document):
            assert "hostPath" not in mapping
            if mapping.get("name") in {"DATABASE_URL", "POSTGRES_PASSWORD", "PGPASSWORD"}:
                assert "value" not in mapping
                assert "valueFrom" in mapping

    rendered = yaml.safe_dump_all(manifests.documents)
    assert "postgres://" not in rendered
    assert "POSTGRES_PASSWORD: eatbid" not in rendered


def test_database_credential은_cross_assignment_없이_consumer별로_분리된다(
    manifests: ManifestSet,
) -> None:
    postgres_pod = _mapping(_mapping(_spec(manifests.named("Deployment", "postgres"))["template"])["spec"])
    server_pod = _mapping(_mapping(_spec(manifests.named("Deployment", "server"))["template"])["spec"])
    migration_pod = _mapping(_mapping(_spec(manifests.named("Job", "eatbid-migration"))["template"])["spec"])
    postgres = _mapping(_sequence(postgres_pod["containers"])[0])
    server = _mapping(_sequence(server_pod["containers"])[0])
    migration = _mapping(_sequence(migration_pod["containers"])[0])
    workflow = manifests.workflow_template("eatbid-dataplane")
    dataplane = _mapping(_templates(workflow)["discover"]["container"])

    assert _secret_ref(_env(postgres, "POSTGRES_USER"))[0] == "eatbid-postgres-bootstrap"
    assert _secret_ref(_env(server, "DATABASE_URL"))[0] == "eatbid-database-api"
    assert _secret_ref(_env(migration, "DATABASE_URL"))[0] == "eatbid-database-migrator"
    assert _secret_ref(_env(dataplane, "DATABASE_URL"))[0] == "eatbid-database-dataplane"

    rendered = yaml.safe_dump_all(manifests.documents)
    # db-provisioning은 database 소유자 자격이 필요해 postgres bootstrap Secret을 함께 읽는 유일한
    # 두 번째 consumer다. 나머지 조합은 여기서 계속 막는다.
    for kind, name, assigned in (
        ("Deployment", "postgres", "eatbid-postgres-bootstrap"),
        ("Deployment", "server", "eatbid-database-api"),
        ("Job", "eatbid-migration", "eatbid-database-migrator"),
        ("Job", "eatbid-db-provisioning", "eatbid-postgres-bootstrap"),
    ):
        document = manifests.named(kind, name)
        text = yaml.safe_dump(document)
        assert assigned in text
        assert all(secret == assigned or secret not in text for secret in (
            "eatbid-postgres-bootstrap",
            "eatbid-database-api",
            "eatbid-database-migrator",
            "eatbid-database-dataplane",
        ))
    assert "kind: Secret" not in rendered


def test_product가_정확히_image_넷을_소비하고_승격한다고_선언한다(
    manifests: ManifestSet,
) -> None:
    kustomization = yaml.safe_load(PRODUCT_KUSTOMIZATION.read_text(encoding="utf-8"))
    declarations = _sequence(kustomization["images"])
    assert {item["name"] for item in declarations if isinstance(item, Mapping)} == PRODUCT_IMAGES
    for item in declarations:
        image = _mapping(item)
        assert image["newName"] == f"ghcr.io/lamyzm/{image['name']}"
        assert re.fullmatch(r"sha256:[0-9a-f]{64}", str(image["digest"]))
        assert "newTag" not in image

    consumed = {
        image.split("@", maxsplit=1)[0].removeprefix("ghcr.io/lamyzm/")
        for image in _images(manifests)
        if image.startswith("ghcr.io/lamyzm/eatbid-")
    }
    assert consumed == PRODUCT_IMAGES
    assert all(
        re.fullmatch(r"ghcr\.io/lamyzm/eatbid-[a-z]+@sha256:[0-9a-f]{64}", image)
        for image in _images(manifests)
        if image.startswith("ghcr.io/lamyzm/eatbid-")
    )

    workflow = yaml.safe_load(BUILD_WORKFLOW.read_text(encoding="utf-8"))
    matrix = workflow["jobs"]["build"]["strategy"]["matrix"]["include"]
    assert {f"eatbid-{item['app']}" for item in matrix} == PRODUCT_IMAGES
    promote = next(
        step
        for step in workflow["jobs"]["promote"]["steps"]
        if step.get("id") == "validate-and-pin"
    )["run"]
    for image in PRODUCT_IMAGES:
        app = image.removeprefix("eatbid-")
        assert f"infra/product/kustomization.yaml {image} \"$(cat digests/{app})\"" in promote


def test_platform_application은_최소_version으로_고정되고_live에_연결되지_않는다() -> None:
    application = yaml.safe_load(PLATFORM_APPLICATION.read_text(encoding="utf-8"))
    source = application["spec"]["source"]
    assert source["repoURL"] == "https://argoproj.github.io/argo-helm"
    assert source["chart"] == "argo-workflows"
    assert source["targetRevision"] == "1.0.23"
    values = source["helm"]["valuesObject"]
    assert application["spec"]["destination"]["namespace"] == "eatbid"
    assert values["singleNamespace"] is True
    assert values["createAggregateRoles"] is False
    assert "workflowNamespaces" not in values["controller"]
    assert values["controller"]["clusterWorkflowTemplates"]["enabled"] is False
    assert "persistence" not in values["controller"]
    assert values["workflow"] == {
        "serviceAccount": {"create": False, "name": "eatbid-dataplane"},
        "rbac": {"create": True},
    }
    assert values["server"]["enabled"] is False
    assert values["crds"] == {"install": True, "keep": True, "full": True}
    assert "minio" not in values
    assert "argo-events" not in values
    assert "automated" not in application["spec"].get("syncPolicy", {})
