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
from eatbid.config import ApplicationSettings
from eatbid.core.record_types import is_projectable_record_type
from eatbid.source.eat.payload import MAX_PAGE_SIZE_ROWS
from eatbid.source.eat.registry import require
from eatbid.source.eat.schema_contract import REVIEWED_EAT_SCHEMA_CONTRACTS

ROOT = Path(__file__).parents[2]
PRODUCT_KUSTOMIZATION = ROOT / "infra" / "product" / "kustomization.yaml"
PLATFORM_APPLICATION = ROOT / "infra" / "platform" / "argo-workflows.application.yaml"
LIVE_APPLICATION = ROOT / "infra" / "argocd" / "application.yaml"
CLI = ROOT / "apps" / "dataplane" / "src" / "eatbid" / "cli" / "main.py"
BUILD_WORKFLOW = ROOT / ".github" / "workflows" / "build.yml"

SCHEDULED_COMMANDS = ("discover", "capture", "normalize", "validate", "project")
# DAG task 이름과 CLI 명령 이름이 하나 어긋난다. `marts` 단계는 `build-marts`를 부른다 — 단계는
# 무엇을 다시 만드는지를, 명령은 무엇을 실행하는지를 이름으로 말한다.
SCHEDULED_TASKS = (*SCHEDULED_COMMANDS, "marts")
TASK_COMMANDS = {**{name: name for name in SCHEDULED_COMMANDS}, "marts": "build-marts"}
SHELL_STAGES = ("capture", "normalize", "validate", "project", "marts")
# 정부 코드 reference 실행의 DAG task와 CLI 명령이다. 여기서는 단계 이름과 명령 이름이 같다.
REFERENCE_COMMANDS = ("capture-reference", "project-reference")
REFERENCE_TASKS = REFERENCE_COMMANDS
# 운영자가 직접 entrypoint로 부르는 명령이다. 어떤 DAG도 task로 갖지 않는다(EAT-122).
OPERATOR_COMMANDS = ("fail-release",)
PYTHON_ENTRYPOINT_TEMPLATES = ("discover", "replay")
# 피크 월 창의 `TOT_CNT` 실측 약 17,000에 여유를 둔 상한이다. discover는 `total_count`가
# page size × page budget을 넘으면 창을 거부하므로 그 곱이 이 값 아래로 내려가면 월 백필이 막힌다.
MONTHLY_WINDOW_TOTAL_COUNT_CEILING = 20_000
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
    # chunk 단계는 JSON 배열 하나를 argv 한 칸으로 받는다. 표본도 배열이어야 shell이 그 문자열을
    # 다시 쪼개지 않는다는 것을 확인할 수 있다.
    "EATBID_EXTERNAL_BID_IDS_JSON": '["5610615","5610616"]',
    "EATBID_OBSERVATION_IDS_JSON": "[7,11]",
    "EATBID_OBSERVATION_ID": "7",
    "EATBID_MART_CALC_VERSION": "mart-r3",
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
    # 수집 스케줄 셋 + DB 백업 하나. 백업은 소스를 부르지 않는 별개 계약이라 아래 백업 테스트가 따로 본다.
    assert manifests.kinds.count("CronWorkflow") == 4
    # migration(schema)과 db-provisioning(권한) 둘뿐이다. 여기를 늘리기 전에 새 Job이 왜 hook이어야
    # 하는지 먼저 답해야 한다.
    assert manifests.kinds.count("Job") == 2
    assert {
        _metadata(job)["name"] for job in manifests.of_kind("Job")
    } == {"eatbid-migration", "eatbid-db-provisioning"}
    assert manifests.kinds.count("CronJob") == 0
    assert manifests.kinds.count("Application") == 0
    assert manifests.kinds.count("Secret") == 0

    # 크롤링 schedule은 Argo CronWorkflow 하나뿐이다(AGENTS 9). 레거시 CronJob은 base에서도 걷어냈으므로
    # 삭제 patch 없이 base 자체가 0이어야 한다. 여기가 다시 늘면 스케줄러가 둘로 갈라진 것이다.
    assert base_manifests.kinds.count("CronJob") == 0


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
    # 명단 블록(`ds_bidList`)을 아는 상세 계약을 가진 version이다. 이 블록이 없는 version으로 발행하면
    # 투찰·낙찰·업체가 정규화 record에 아예 담기지 않아 core 테이블이 비어 있는 채로 남는다.
    roster_parser_versions = {
        parser_version
        for (_, endpoint, parser_version), contract in REVIEWED_EAT_SCHEMA_CONTRACTS.items()
        if endpoint == "bid-detail" and "ds_bidList" in contract.datasets
    }
    workflow_parameters = {
        item["name"]: item["value"]
        for item in _sequence(_mapping(spec["arguments"])["parameters"])
        if isinstance(item, Mapping)
    }
    template_parser_version = workflow_parameters["parser-version"]
    # 검토된 version은 eat-v1·eat-v2 둘이고 기본값은 발행 경로가 열린 쪽이어야 한다. EAT-43이
    # `auction.v2`를 발행 가능 record type에 넣은 뒤로 그 조건을 만족하는 것은 명단을 가진 eat-v2뿐이다.
    # 2026-09-06 운영 실측에서 기본값 eat-v1로 발행된 385 revision은 전부 floor_rate가 없고
    # bid_submission·award_decision·supplier_party가 비어 있었다(EAT-69).
    assert template_parser_version in reviewed_parser_versions
    # eat-v3(EAT-75, 참가제한지역 라벨)는 명단에 라벨까지 더한다. 기본값 전환은 그 version을 아는
    # 이미지(v0.1.21)가 배포된 뒤의 별도 커밋으로 했다(EAT-95: 템플릿이 이미지보다 먼저 동기화되면
    # 옛 이미지가 모르는 version 이름을 받는다).
    assert template_parser_version == "eat-v3"
    assert template_parser_version in roster_parser_versions
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

    assert _cli_commands() == (
        *SCHEDULED_COMMANDS,
        "replay",
        "build-marts",
        *REFERENCE_COMMANDS,
        *OPERATOR_COMMANDS,
    )
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
    # workflow retry는 source semaphore 밖에서 pod를 늘려 소스를 압박한다. 일시 실패 재시도는
    # semaphore 안에서 도는 CLI가 상한을 들고 직접 하며(EAT-72), 여기서는 그 자리를 비워 둔다.
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
    cron_workflows = [
        cron
        for cron in manifests.of_kind("CronWorkflow")
        if _metadata(cron)["name"] != "eatbid-db-backup"
    ]
    assert {_metadata(cron)["name"] for cron in cron_workflows} == {
        "eatbid-poll-open",
        "eatbid-daily-reconcile",
        "eatbid-reference-refresh",
    }

    expected_schedules = {
        # 10분은 신규 공고 노출 SLO 15분(주기 10 + 회차 실행 최대 5, runtime §2.5, EAT-151)의 항이다.
        # 주기를 바꾸는 커밋은 manifest·이 단언·SLO 문서를 함께 바꾼다.
        "eatbid-poll-open": "*/10 8-19 * * 1-5",
        "eatbid-daily-reconcile": "0 7 * * *",
        "eatbid-reference-refresh": "0 5 1 * *",
    }
    expected_modes = {
        "eatbid-poll-open": "poll-open",
        "eatbid-daily-reconcile": "daily-reconcile",
        "eatbid-reference-refresh": "reference",
    }
    # 정부 코드 reference만 아직 멈춰 있다. 활성 release 하나가 화면 전체의 지역 모집단이 되므로
    # 아무도 확인하지 않은 파일이 스케줄로 먼저 들어오면 그것이 곧 기준이 된다(ADR 0035).
    expected_suspend = {
        "eatbid-poll-open": False,
        "eatbid-daily-reconcile": False,
        "eatbid-reference-refresh": True,
    }
    expected_entrypoints = {"eatbid-reference-refresh": "reference-pipeline"}
    for cron in cron_workflows:
        name = str(_metadata(cron)["name"])
        spec = _spec(cron)
        assert "schedule" not in spec
        assert spec["schedules"] == [expected_schedules[name]]
        assert spec["timezone"] == "Asia/Seoul"
        # 2026-09-05 수집 cutover(EAT-51): 항상 켜진 VM 클러스터에서 스케줄을 켠다. 다시 멈추는 결정은
        # manifest와 이 단언을 같은 커밋에서 바꾼다.
        assert spec["suspend"] is expected_suspend[name]
        workflow_spec = _mapping(spec["workflowSpec"])
        template_ref = _mapping(workflow_spec["workflowTemplateRef"])
        assert template_ref == {"name": "eatbid-dataplane"}
        assert workflow_spec.get("entrypoint") == expected_entrypoints.get(name)
        parameters = {
            item["name"]: item["value"]
            for item in _sequence(_mapping(workflow_spec["arguments"])["parameters"])
            if isinstance(item, Mapping)
        }
        assert parameters == {"mode": expected_modes[name]}

    rendered = yaml.safe_dump_all(manifests.documents)
    assert "backfill" not in rendered
    assert "entrypoint: replay" not in rendered


def test_DB_백업_CronWorkflow는_매시간_migrator로_덤프해_R2에_두고_소스와_템플릿을_건드리지_않는다(
    manifests: ManifestSet,
) -> None:
    """왜: 백업은 수집 파이프라인이 아니다. source semaphore·publication mutex·eatbid-dataplane 템플릿을
    쓰지 않아야 수집 정지·재개 판단과 얽히지 않고, 실패해도 발행에 영향이 없다(EAT-127)."""
    backup = manifests.named("CronWorkflow", "eatbid-db-backup")
    spec = _spec(backup)
    assert spec["schedules"] == ["5 * * * *"]
    assert spec["timezone"] == "Asia/Seoul"
    assert spec["suspend"] is False
    assert spec["concurrencyPolicy"] == "Forbid"
    workflow_spec = _mapping(spec["workflowSpec"])
    assert "workflowTemplateRef" not in workflow_spec
    assert workflow_spec["entrypoint"] == "backup"
    assert workflow_spec["podGC"] == {"strategy": "OnPodSuccess"}
    assert workflow_spec["ttlStrategy"] == {"secondsAfterSuccess": 3600, "secondsAfterFailure": 86400}
    rendered = yaml.safe_dump(backup)
    assert "semaphore" not in rendered and "mutex" not in rendered
    template = next(
        _mapping(item) for item in _sequence(workflow_spec["templates"]) if _mapping(item)["name"] == "backup"
    )
    containers = {
        _mapping(item)["name"]: _mapping(item)
        for item in _sequence(_mapping(template["containerSet"])["containers"])
    }
    assert set(containers) == {"dump", "upload"}
    assert containers["dump"]["image"] == "postgres:16-alpine"
    assert containers["upload"]["dependencies"] == ["dump"]
    dump_env = {
        _mapping(item)["name"]: _mapping(item) for item in _sequence(containers["dump"]["env"])
    }
    # 전체 덤프는 모든 schema를 읽어야 하므로 소유자인 migrator 역할을 쓴다. api·dataplane 역할은 app·mart를 못 읽는다.
    assert dump_env["DATABASE_URL"]["valueFrom"]["secretKeyRef"] == {
        "name": "eatbid-database-migrator",
        "key": "DATABASE_URL",
    }
    upload_env = {
        _mapping(item)["name"]: _mapping(item) for item in _sequence(containers["upload"]["env"])
    }
    for key in ("RCLONE_CONFIG_R2_ENDPOINT", "RCLONE_CONFIG_R2_ACCESS_KEY_ID", "RCLONE_CONFIG_R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        assert upload_env[key]["valueFrom"]["secretKeyRef"]["name"] == "eatbid-r2"
    upload_script = "".join(str(item) for item in _sequence(containers["upload"]["args"]))
    assert "backup/postgres/hourly" in upload_script and "backup/postgres/daily" in upload_script
    assert "--min-age 168h" in upload_script and "--min-age 720h" in upload_script


def test_WorkflowTemplate은_성공_파드를_즉시_지우고_끝난_Workflow를_TTL로_거둔다(
    manifests: ManifestSet,
) -> None:
    """왜: 2026-09-09 실측에서 Workflow 38개가 완료 파드 6,561개를 남겨 단일 노드를 눌렀다(EAT-127).
    파드는 증거가 아니다(단계 결과는 DB·R2에 있다). 실패 파드는 원인 확인을 위해 Workflow TTL까지 둔다."""
    spec = _spec(manifests.workflow_template("eatbid-dataplane"))
    assert spec["podGC"] == {"strategy": "OnPodSuccess"}
    assert spec["ttlStrategy"] == {"secondsAfterSuccess": 3600, "secondsAfterFailure": 86400}
    # skill 규율: CLI가 transient/terminal 종료 범주를 제공하기 전에는 Argo retryStrategy를 두지 않는다.
    assert "retryStrategy" not in yaml.safe_dump(spec)


def test_스케줄_CronWorkflow는_backfill_기본_우선순위보다_높다(
    manifests: ManifestSet,
) -> None:
    """왜: source semaphore 대기 큐는 priority 내림차순 → 생성 시각 순이다(Argo v4.0.8
    `workflow/sync/sync_manager.go`, `wf.Spec.Priority` 미지정은 0). `argo submit`으로 내는 backfill은
    priority가 없으므로 스케줄 수집이 그보다 높지 않으면 backfill chunk 수백 개 뒤에 줄을 선다
    (2026-09-07 08:00 poll-open discover 95분 대기, EAT-93)."""
    backfill_default_priority = 0
    scheduled = {
        str(_metadata(cron)["name"]): _mapping(_spec(cron)["workflowSpec"]).get("priority")
        for cron in manifests.of_kind("CronWorkflow")
    }
    collection_priorities = {scheduled["eatbid-poll-open"], scheduled["eatbid-daily-reconcile"]}
    # 두 수집 스케줄은 서로 경쟁하지 않고 backfill보다만 앞서면 되므로 값 하나를 같이 쓴다.
    assert len(collection_priorities) == 1
    priority = collection_priorities.pop()
    assert isinstance(priority, int) and priority > backfill_default_priority
    # 월 1회 reference는 기본값이다. 여기에도 값을 주면 "누가 backfill보다 앞서는가"가 두 곳에 산다.
    assert scheduled["eatbid-reference-refresh"] is None
    # WorkflowTemplate 자체에 priority를 두면 그 template으로 내는 backfill도 같은 값을 받아 구분이 사라진다.
    assert "priority" not in _spec(manifests.workflow_template("eatbid-dataplane"))


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


SAMPLE_REFERENCE_ENV = {
    "BUILD_SHA": "a" * 64,
    "EATBID_RUN_ID": "00000000-0000-0000-0000-000000000001",
    "EATBID_SOURCE_RELEASE_ID": "00000000-0000-0000-0000-000000000002",
    "EATBID_OBSERVATION_ID": "7",
    "EATBID_REFERENCE_SOURCE": "mois-standard-code",
    "EATBID_REFERENCE_DATASET": "legal-dong",
    "EATBID_REFERENCE_PARSER_VERSION": "mois-v1",
    "EATBID_RELEASE_NAME": "legal-dong 2026-09-06",
    "EATBID_WORKFLOW_CREATED_AT": "2026-09-06T03:00:00Z",
    "EATBID_RESULT_DIR": "/tmp/eatbid",
}


def test_reference_pipeline이_수집과_투영_둘로만_돌고_예약_DAG를_바꾸지_않는다(
    manifests: ManifestSet,
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)

    # 예약 수집 DAG는 이 변경에서 그대로다. 지역 적재가 공고 수집 순서를 건드리면 안 된다.
    assert [task["name"] for task in _dag_tasks(workflow_template)] == list(SCHEDULED_TASKS)
    assert _spec(workflow_template)["entrypoint"] == "scheduled-pipeline"

    dag = _mapping(templates["reference-pipeline"]["dag"])
    tasks = [_mapping(task) for task in _sequence(dag["tasks"])]
    assert [task["name"] for task in tasks] == list(REFERENCE_TASKS)
    assert [task["template"] for task in tasks] == list(REFERENCE_TASKS)
    assert tasks[0].get("dependencies", []) == []
    assert tasks[1]["dependencies"] == ["capture-reference"]
    # 투영은 수집이 만든 release·관측·이름을 그대로 받는다. 두 단계가 각자 정체성을 지으면 같은
    # 실행에서 다른 release를 가리킨다.
    project_arguments = _task_arguments(tasks[1])
    for name in ("source-release-id", "observation-id", "release-name"):
        assert project_arguments[name] == (
            f"{{{{tasks.capture-reference.outputs.parameters.{name}}}}}"
        )
    assert set(project_arguments) == _input_names(templates["project-reference"])

    # 수집은 eaT와 같은 source semaphore를, 투영은 core 발행 mutex를 쓴다. 새 semaphore를 만들지 않는다.
    capture_sync = _mapping(templates["capture-reference"]["synchronization"])
    capture_semaphore = _mapping(
        _mapping(_sequence(capture_sync["semaphores"])[0])["configMapKeyRef"]
    )
    assert (capture_semaphore["name"], capture_semaphore["key"]) == (
        "eatbid-workflow-limits",
        "eatbid-source-limit",
    )
    project_sync = _mapping(templates["project-reference"]["synchronization"])
    assert [_mapping(item) for item in _sequence(project_sync["mutexes"])] == [
        {"name": "eatbid-core-publication"}
    ]


def test_reference_수집은_workflow_uid로_release_정체성을_결정적으로_만든다(
    manifests: ManifestSet, monkeypatch: object
) -> None:
    argv = _execute_reference_capture_script(manifests, monkeypatch, SAMPLE_REFERENCE_ENV)
    parsed = build_parser().parse_args(argv[1:])
    assert argv[0:2] == ["eatbid", "capture-reference"]
    assert parsed.run_id == UUID(SAMPLE_REFERENCE_ENV["EATBID_RUN_ID"])
    assert parsed.source == "mois-standard-code"
    assert parsed.dataset == "legal-dong"
    assert parsed.parser_version == "mois-v1"

    again = _execute_reference_capture_script(manifests, monkeypatch, SAMPLE_REFERENCE_ENV)
    assert _flag_value(again, "--source-release-id") == _flag_value(argv, "--source-release-id")


def test_reference_수집은_workflow_uid_없이_CLI를_부르지_않는다(
    manifests: ManifestSet, monkeypatch: object
) -> None:
    for broken in ("", "not-a-uuid"):
        with pytest.raises(SystemExit) as error:
            _execute_reference_capture_script(
                manifests, monkeypatch, {**SAMPLE_REFERENCE_ENV, "EATBID_RUN_ID": broken}
            )
        assert error.value.code == 64


def test_reference_투영의_argv가_CLI_parser의_필수_인자를_모두_채운다(
    manifests: ManifestSet,
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    template = _templates(workflow_template)["project-reference"]
    container = _mapping(template["container"])
    command = str(_sequence(container["args"])[0])

    argv = _render_shell_argv(command, SAMPLE_REFERENCE_ENV)
    assert argv[0:2] == ["eatbid", "project-reference"]
    parsed = build_parser().parse_args(argv[1:])
    assert parsed.observation_id == 7
    assert parsed.release_name == SAMPLE_REFERENCE_ENV["EATBID_RELEASE_NAME"]
    assert parsed.source_release_id == UUID(SAMPLE_REFERENCE_ENV["EATBID_SOURCE_RELEASE_ID"])

    declared = {
        str(item["name"])
        for item in _sequence(container["env"])
        if isinstance(item, Mapping)
    }
    assert set(SHELL_VARIABLE.findall(command)) - {"BUILD_SHA"} <= declared


def _execute_reference_capture_script(
    manifests: ManifestSet, monkeypatch: object, environment: Mapping[str, str]
) -> list[str]:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    container = _mapping(_templates(workflow_template)["capture-reference"]["container"])
    script = str(_sequence(container["args"])[0])
    captured: list[str] = []

    def capture_execvp(executable: str, argv: list[str]) -> None:
        assert executable == "eatbid"
        captured.extend(argv)

    for key in list(SAMPLE_STAGE_ENV) + list(SAMPLE_REFERENCE_ENV):
        monkeypatch.delenv(key, raising=False)  # type: ignore[attr-defined]
    for key, value in environment.items():
        monkeypatch.setenv(key, value)  # type: ignore[attr-defined]
    monkeypatch.setattr(os, "execvp", capture_execvp)  # type: ignore[attr-defined]
    exec(compile(script, "<capture-reference-entrypoint>", "exec"), {})  # noqa: S102
    return captured


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
    """`sh -ec` 문자열을 표본 env로 펼친다. 시계 치환과 `$NAME` 확장 외의 shell 기능은 없어야 한다.

    왜 값을 바로 끼워 넣지 않나. `sh`는 큰따옴표 안에서 확장한 값을 다시 토큰으로 쪼개거나 그 안의
    따옴표를 문법으로 읽지 않는다. 치환 뒤에 `shlex.split`을 돌리면 그 규칙이 깨져 JSON 배열 인자가
    실제 pod에서와 다르게 잘린다. 그래서 shell 문법이 없는 표식으로 먼저 바꿔 토큰을 나눈 뒤 값을
    되돌린다.
    """
    rendered = command.replace(SHELL_CLOCK, "2026-09-04T03:05:00Z")
    assert "$(" not in rendered, command
    assert "`" not in rendered, command
    values: dict[str, str] = {}

    def mark(match: re.Match[str]) -> str:
        name = match.group(1)
        token = f"ENVTOKEN{name}ENVTOKEN"
        values[token] = environment[name]
        return token

    rendered = SHELL_VARIABLE.sub(mark, rendered)
    argv = [_restore(word, values) for word in shlex.split(rendered)]
    assert argv[0] == "exec"
    return argv[1:]


def _restore(word: str, values: Mapping[str, str]) -> str:
    for token, value in values.items():
        word = word.replace(token, value)
    return word


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
    # page size는 workflow 파라미터가 아니라 template이 고정한 env라 pod가 받는 값 그대로 넣는다.
    monkeypatch.setenv(  # type: ignore[attr-defined]
        "EATBID_DISCOVER_PAGE_SIZE", str(_env(container, "EATBID_DISCOVER_PAGE_SIZE")["value"])
    )
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


def test_discover_단계의_page_size와_page_budget_곱이_월_창_상한을_덮는다(
    manifests: ManifestSet, monkeypatch: object, tmp_path: Path
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    container = _mapping(_templates(workflow_template)["discover"]["container"])
    page_size = int(str(_env(container, "EATBID_DISCOVER_PAGE_SIZE")["value"]))
    # 예산은 template이 덮어쓰지 않으므로 설정 기본값이 pod에서 유효한 값이다.
    env_names = {str(_mapping(item)["name"]) for item in _sequence(container["env"])}
    assert "SOURCE_PAGE_BUDGET" not in env_names
    page_budget = ApplicationSettings.model_fields["source_page_budget"].default

    assert 1 <= page_size <= MAX_PAGE_SIZE_ROWS
    assert page_size * page_budget >= MONTHLY_WINDOW_TOTAL_COUNT_CEILING

    argv = _execute_discover_script(
        manifests,
        monkeypatch,
        {**SAMPLE_STAGE_ENV, "EATBID_RESULT_DIR": str(tmp_path / "result")},
    )
    assert build_parser().parse_args(argv[1:]).page_size == page_size


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


def _stage_argv(
    manifests: ManifestSet, template_name: str, environment: Mapping[str, str]
) -> list[str]:
    template = _templates(manifests.workflow_template("eatbid-dataplane"))[template_name]
    command = str(_sequence(_mapping(template["container"])["args"])[0])
    return _render_shell_argv(command, environment)


def test_chunk_단계의_argv가_JSON_배열을_잘리지_않고_CLI_목록으로_넘긴다(
    manifests: ManifestSet,
) -> None:
    """왜: chunk는 argv 한 칸에 담긴 JSON 배열이다. shell이 그 값을 다시 토큰으로 쪼개면 CLI는
    배열이 아니라 조각을 받고 pod는 인자 단계에서 죽는다."""
    capture = _stage_argv(manifests, "capture", SAMPLE_STAGE_ENV)
    normalize = _stage_argv(manifests, "normalize", SAMPLE_STAGE_ENV)

    assert capture.count("--external-bid-ids-json") == 1
    assert normalize.count("--observation-ids-json") == 1
    assert build_parser().parse_args(capture[1:]).external_bid_ids == (
        "5610615",
        "5610616",
    )
    assert build_parser().parse_args(normalize[1:]).observation_ids == (7, 11)


@pytest.mark.parametrize(
    ("variable", "value"),
    [
        ("EATBID_EXTERNAL_BID_IDS_JSON", "[]"),
        ("EATBID_EXTERNAL_BID_IDS_JSON", "not-json"),
        ("EATBID_EXTERNAL_BID_IDS_JSON", '["5610615","5610615"]'),
        ("EATBID_EXTERNAL_BID_IDS_JSON", '["5610615; touch /tmp/eatbid-injection"]'),
        ("EATBID_EXTERNAL_BID_IDS_JSON", '["$(touch /tmp/eatbid-substitution)"]'),
        ("EATBID_OBSERVATION_IDS_JSON", "[]"),
        ("EATBID_OBSERVATION_IDS_JSON", '["7"]'),
        ("EATBID_OBSERVATION_IDS_JSON", "[7,7]"),
        ("EATBID_OBSERVATION_IDS_JSON", "[0]"),
    ],
)
def test_망가진_chunk_값은_shell_확장_없이_인자_단계에서_닫힌다(
    manifests: ManifestSet, variable: str, value: str
) -> None:
    template_name = (
        "capture" if variable == "EATBID_EXTERNAL_BID_IDS_JSON" else "normalize"
    )
    argv = _stage_argv(
        manifests, template_name, {**SAMPLE_STAGE_ENV, variable: value}
    )

    with pytest.raises(SystemExit):
        build_parser().parse_args(argv[1:])


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
    # 평평한 `external_bid_ids`는 pod 안에 파일로 남지만 output parameter가 아니다. 피크 월
    # 17,000건이면 아무도 읽지 않는 그 목록만으로 workflow status가 수백 KB 늘어난다.
    assert discover_outputs == {
        "source-release-id": f"{result_dir}/source_release_id",
        "detail-run-id": f"{result_dir}/detail_run_id",
        "publication-id": f"{result_dir}/publication_id",
        "external-bid-id-chunks": f"{result_dir}/external_bid_id_chunks",
        "discovered-count": f"{result_dir}/discovered_count",
        # poll-open이 상세를 몇 건 왜 다시 불렀는지는 workflow status에서 읽는다(ADR 0037).
        "detail-count": f"{result_dir}/detail_count",
        "refetch-reasons": f"{result_dir}/refetch_reasons",
    }
    assert _output_paths(templates["capture"]) == {
        "observation-ids": f"{result_dir}/observation_ids"
    }
    # poll-open이 상세 0건으로 좁힌 회차는 capture가 "Skipped, empty params"로 건너뛰어지고, Argo
    # v4.0.8은 건너뛴 task의 output에 valueFrom.default만 채운다. 이 값이 없으면 normalize의
    # withParam이 해석되지 않아 목록 관측만 있는 빈 회차가 발행되지 못한다(ADR 0037).
    (capture_output,) = _sequence(_mapping(templates["capture"]["outputs"])["parameters"])
    assert _mapping(_mapping(capture_output)["valueFrom"])["default"] == "[]"

    # fan-out 단위는 발견 건이 아니라 chunk다. 건당 pod를 띄우면 건당 약 17초 중 10초가 pod
    # 생성·종료 비용이라 한 달 백필이 80시간이 된다(EAT-51 증거 §6, EAT-79).
    assert tasks["capture"]["withParam"] == (
        "{{tasks.discover.outputs.parameters.external-bid-id-chunks}}"
    )
    assert tasks["normalize"]["withParam"] == (
        "{{tasks.capture.outputs.parameters.observation-ids}}"
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
    assert _task_arguments(tasks["capture"])["external-bid-ids-json"] == "{{item}}"
    assert _task_arguments(tasks["normalize"])["observation-ids-json"] == "{{item}}"
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


def test_발행과_mart_활성화_단계만_web_캐시_무효화_설정을_받는다(
    manifests: ManifestSet,
) -> None:
    """왜: 무효화를 부를 수 있는 것은 새 사실을 방금 공개한 단계뿐이다. 관측 단계까지 토큰을 들면
    필요 없는 곳에 비밀이 퍼지고, 무효화 시점이 발행 시점과 어긋난다(ADR 0036-2)."""
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)

    for name in ("project", "marts"):
        container = _mapping(templates[name]["container"])
        # Service ClusterIP다. 터널·Ingress를 지나지 않으므로 `/internal` ipAllowList의 대상이 아니다.
        assert _env(container, "EATBID_WEB_INTERNAL_URL")["value"] == "http://web"
        assert _secret_ref(_env(container, "EATBID_CACHE_REVALIDATE_TOKEN")) == (
            "eatbid-database-dataplane",
            "EATBID_CACHE_REVALIDATE_TOKEN",
        )

    for name in ("discover", "capture", "normalize", "validate", "replay"):
        container = _mapping(templates[name]["container"])
        declared = {
            str(_mapping(item)["name"]) for item in _sequence(container.get("env", []))
        }
        assert "EATBID_CACHE_REVALIDATE_TOKEN" not in declared, name
        assert "EATBID_WEB_INTERNAL_URL" not in declared, name


def _memory_gib(quantity: object) -> float:
    """Kubernetes 메모리 quantity를 GiB로 읽는다. 여기서 쓰는 단위는 Gi·Mi뿐이다."""
    text = str(quantity)
    if text.endswith("Gi"):
        return float(text[:-2])
    if text.endswith("Mi"):
        return float(text[:-2]) / 1024
    raise AssertionError(f"memory quantity must be Gi or Mi: {text}")


def test_project와_marts_container는_노드_아래의_메모리_requests와_limits를_명시한다(
    manifests: ManifestSet,
) -> None:
    """왜: 2026-09-07 16,410건 창의 project pod가 한도 없이 노드(allocatable 약 12 GiB)를 통째로 잡아먹고
    SystemOOM으로 죽었다(EAT-94). namespace LimitRange도 없으므로 한도는 이 template이 가져야 하며,
    발행 뒤 mart 빌드도 같은 노드에서 돌아 같은 이유로 한도를 둔다."""
    node_allocatable_gib = 12
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)

    for name in ("project", "marts"):
        container = _mapping(templates[name]["container"])
        resources = _mapping(container["resources"])
        request_gib = _memory_gib(_mapping(resources["requests"])["memory"])
        limit_gib = _memory_gib(_mapping(resources["limits"])["memory"])
        assert 0 < request_gib <= limit_gib, name
        # 한도가 노드의 4분의 1을 넘으면 발행·mart·web·server가 한 노드에 함께 들어가지 못한다.
        assert limit_gib <= node_allocatable_gib / 4, name


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
        "parser-version": "eat-v3",
        "calc-version": "mart-r3",
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


def test_fail_release_template은_DAG_밖의_운영자_entrypoint다(manifests: ManifestSet) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)
    template = templates["fail-release"]
    assert _input_names(template) == {"source-release-id", "failure-category"}
    # 어떤 DAG도 이 template을 task로 부르지 않는다. 자동으로 닫으면 planned의 재개가 막힌다(EAT-122).
    for candidate in templates.values():
        dag = candidate.get("dag")
        if dag is None:
            continue
        task_templates = [_mapping(task)["template"] for task in _sequence(_mapping(dag)["tasks"])]
        assert "fail-release" not in task_templates
    assert "synchronization" not in template
    container = _mapping(template["container"])
    command = str(_sequence(container["args"])[0])
    assert container["command"] == ["/bin/sh", "-ec"]
    assert command.startswith("exec eatbid fail-release ")
    assert '--build-sha "$BUILD_SHA"' in command
    assert '--failure-category "$EATBID_FAILURE_CATEGORY"' in command
    assert _env(container, "EATBID_FAILURE_CATEGORY")["value"] == (
        "{{inputs.parameters.failure-category}}"
    )
    assert _env(container, "EATBID_SOURCE_RELEASE_ID")["value"] == (
        "{{inputs.parameters.source-release-id}}"
    )
    assert _secret_ref(_env(container, "DATABASE_URL")) == (
        "eatbid-database-dataplane",
        "DATABASE_URL",
    )
