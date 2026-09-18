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
PRODUCT_KUSTOMIZATION = ROOT / "infra" / "envs" / "prod" / "kustomization.yaml"
PLATFORM_APPLICATION = ROOT / "infra" / "platform" / "argo-workflows.application.yaml"
LIVE_APPLICATION = ROOT / "infra" / "argocd" / "prod.application.yaml"
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
# eaT 코드목록 실행의 DAG task와 CLI 명령이다. reference와 같은 두 단계 모양이지만 소스 경계가 달라
# 별도 DAG·별도 semaphore 판정을 받는다(EAT-187).
CODE_VOCABULARY_COMMANDS = ("capture-code-vocabulary", "project-code-vocabulary")
CODE_VOCABULARY_TASKS = CODE_VOCABULARY_COMMANDS
# 운영자·스케줄이 직접 entrypoint로 부르는 명령이다. 어떤 DAG도 task로 갖지 않는다(EAT-122, EAT-170).
OPERATOR_COMMANDS = ("fail-release", "check-expectations", "scan-contract", "reap-marts")
# 전진 판단은 예약이 부르지만 운영자 명령과 달리 DAG의 첫 task이기도 하다. 창을 고르는 것과 그 창을
# 수집하는 것이 한 실행 안에 있어야 고른 창이 어디로 새지 않는다(EAT-209).
ADVANCE_COMMANDS = ("next-backfill-window", "next-replay-target")
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
    "EATBID_MART_CALC_VERSION": "mart-r6",
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
    # 수집 스케줄 셋 + 백필 전진 + DB 백업 + 감시. 백업과 감시는 소스를 부르지 않는 별개 계약이라
    # 각자의 테스트가 본다. 백필 전진은 2026-09-14에 더했다 — 창을 고르는 판단이 사람에게 있는 동안
    # 진도가 기록되지 않았고 실패한 백필의 남은 대기열이 열한 번 버려졌다(ADR 0052).
    # mart 회수는 2026-09-17에 더했다 — 물린 build 900개가 활성 셋의 여섯 배 디스크를 쥐고 있었다(EAT-254).
    # 재처리 전진은 2026-09-18에 더했다 — 막힌 창을 사람이 창마다 손으로 닫고 있었다(EAT-274).
    assert manifests.kinds.count("CronWorkflow") == 8
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
        "targetRevision": "deploy/prod",
        "path": "infra/envs/prod",
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
    assert template_parser_version == "eat-v5"
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
        *CODE_VOCABULARY_COMMANDS,
        *OPERATOR_COMMANDS,
        *ADVANCE_COMMANDS,
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

    def _source_semaphore_key(name: str) -> tuple[str, str]:
        synchronization = _mapping(templates[name]["synchronization"])
        semaphores = [_mapping(item) for item in _sequence(synchronization["semaphores"])]
        key_ref = _mapping(semaphores[0]["configMapKeyRef"])
        return (str(key_ref["name"]), str(key_ref["key"]))

    # 스케줄 수집은 eatbid-source-live를 잡는다(2026-09-11, EAT-164). backfill 전용 discover-backfill·
    # capture-backfill은 아래에서 eatbid-source-backfill을 잡는지, 그리고 template 필드만 다르고
    # 나머지 정의는 완전히 같은지 확인한다 — 한 실행이 두 key를 동시에 잡지 않는다는 보장은 이
    # 분리에서 나온다.
    assert [_source_semaphore_key(name) for name in ("discover", "capture")] == [
        ("eatbid-workflow-limits", "eatbid-source-live"),
        ("eatbid-workflow-limits", "eatbid-source-live"),
    ]
    assert [
        _source_semaphore_key(name) for name in ("discover-backfill", "capture-backfill")
    ] == [
        ("eatbid-workflow-limits", "eatbid-source-backfill"),
        ("eatbid-workflow-limits", "eatbid-source-backfill"),
    ]
    for live_name, backfill_name in (
        ("discover", "discover-backfill"),
        ("capture", "capture-backfill"),
    ):
        live_template = dict(templates[live_name])
        backfill_template = dict(templates[backfill_name])
        for mapping in (live_template, backfill_template):
            mapping.pop("name", None)
            mapping.pop("synchronization", None)
        assert live_template == backfill_template, (live_name, backfill_name)

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
    # 새로 시작하는 실행 기준 합은 2다(2026-09-11, EAT-164). key 하나만 올리면 backfill이 두 자리를
    # 다 가져가므로 나눴다 — 이유는 semaphore.yaml. eatbid-source-limit은 이 배포 시점에 이미 돌던
    # backfill이 쥐고 있는 과도기 key다 — 제거 조건은 같은 파일 주석과 아래
    # test_eatbid_source_limit는_과도기_key이고_도는_backfill이_끝나면_지운다를 본다.
    # backfill은 8이다(2026-09-14, EAT-180). semaphore가 chunk pod 단위라 이 값이 곧 소스 동시 호출
    # 수이며, 램프업과 되돌리기가 이 숫자 하나로 이뤄진다 — 중단 조건은 semaphore.yaml 주석이 소유한다.
    # live를 1로 고정하는 것은 신규 공고 노출 SLO가 그 lane에 걸려 있기 때문이다.
    assert limit["data"] == {
        "eatbid-source-live": "1",
        "eatbid-source-backfill": "8",
        "eatbid-source-limit": "1",
    }
    service_account = manifests.named("ServiceAccount", "eatbid-dataplane")
    assert service_account["imagePullSecrets"] == [{"name": "ghcr-pull"}]


def test_cron_workflow는_활성이고_pipeline만_schedule한다(
    manifests: ManifestSet,
) -> None:
    # 백업과 감시는 수집 pipeline이 아니다. 수집을 멈춘 동안에도 돌아야 하므로 이 단언 밖에 둔다.
    cron_workflows = [
        cron
        for cron in manifests.of_kind("CronWorkflow")
        if _metadata(cron)["name"]
        not in {
            "eatbid-db-backup",
            "eatbid-expectation-check",
            "eatbid-mart-reap",
            "eatbid-replay-advance",
        }
    ]
    assert {_metadata(cron)["name"] for cron in cron_workflows} == {
        "eatbid-poll-open",
        "eatbid-daily-reconcile",
        "eatbid-reference-refresh",
        "eatbid-backfill-advance",
    }

    expected_schedules = {
        # 10분은 신규 공고 노출 SLO 15분(주기 10 + 회차 실행 최대 5, runtime §2.5, EAT-151)의 항이다.
        # 주기를 바꾸는 커밋은 manifest·이 단언·SLO 문서를 함께 바꾼다.
        "eatbid-poll-open": "*/10 8-19 * * 1-5",
        "eatbid-daily-reconcile": "0 7 * * *",
        "eatbid-reference-refresh": "0 5 1 * *",
        # 창 하나가 실측 15분이라 시간당 한 번이면 넉넉하다. Forbid가 겹침을 막으므로 도는 중의
        # 회차는 아무것도 하지 않는다(EAT-209).
        "eatbid-backfill-advance": "0 * * * *",
    }
    expected_modes = {
        "eatbid-poll-open": "poll-open",
        "eatbid-daily-reconcile": "daily-reconcile",
        "eatbid-reference-refresh": "reference",
        "eatbid-backfill-advance": "backfill",
    }
    # 정부 코드 reference만 아직 멈춰 있다. 활성 release 하나가 화면 전체의 지역 모집단이 되므로
    # 아무도 확인하지 않은 파일이 스케줄로 먼저 들어오면 그것이 곧 기준이 된다(ADR 0035).
    expected_suspend = {
        "eatbid-poll-open": False,
        "eatbid-daily-reconcile": False,
        "eatbid-reference-refresh": True,
        "eatbid-backfill-advance": False,
    }
    expected_entrypoints = {
        "eatbid-reference-refresh": "reference-pipeline",
        "eatbid-backfill-advance": "advancing-backfill-pipeline",
    }
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

    # backfill이 CronWorkflow에 없어야 한다는 단언은 2026-09-14에 걷었다(ADR 0052). 사람이 창을 고르는
    # 설계가 진도를 기록하지 않는 결과를 낳았고, 실패한 백필의 남은 대기열이 열한 번 버려지는 동안
    # 아무도 몰랐다. 이제 전진은 예약이 하고 사람은 floor date를 선언한다.
    #
    # 대신 두 가지를 지킨다. 사람이 부르던 ad hoc 진입점(backfill-pipeline)은 그대로 남아 예약과 무관하게
    # 특정 창을 돌릴 수 있고, replay는 여전히 스케줄하지 않는다 — 재해석은 언제 무엇을 다시 읽을지를
    # 사람이 정해야 하는 판단이다.
    cron_rendered = yaml.safe_dump_all(cron_workflows)
    assert "entrypoint: replay" not in cron_rendered
    assert "entrypoint: backfill-pipeline" not in cron_rendered


def test_렌더된_어떤_이미지도_변환되지_않은_우리_이름으로_남지_않는다(
    manifests: ManifestSet,
) -> None:
    """왜: kustomize의 이미지 변환은 kind별 경로 목록을 따른다. 새 kind를 더하면서 그 경로를 빼먹으면
    이름이 그대로 남아 파드가 docker.io에서 `<이름>:latest`를 찾다 ImagePullBackOff로 멈춘다.
    렌더 결과 전체를 훑어야 다음에 CronWorkflow가 아닌 kind가 늘어도 같은 함정을 잡는다(EAT-170)."""
    unresolved: list[str] = []
    for document in manifests.documents:
        for mapping in _all_mappings(document):
            image = mapping.get("image")
            if isinstance(image, str) and image.startswith("eatbid-"):
                unresolved.append(image)

    assert unresolved == [], f"kustomize가 바꾸지 못한 이미지 이름: {sorted(set(unresolved))}"


def test_감시_CronWorkflow는_수집_템플릿에_매이지_않고_알림_비밀만_추가로_받는다(
    manifests: ManifestSet,
) -> None:
    """왜: 감시가 수집 WorkflowTemplate을 참조하면 수집을 멈춘 동안 감시도 함께 멈춘다. 정지해야 할
    때 눈이 먼저 감기면 안 된다. 소스 semaphore도 쓰지 않아야 수집 대기에 막히지 않는다(EAT-170)."""
    check = manifests.named("CronWorkflow", "eatbid-expectation-check")
    spec = _spec(check)
    assert spec["suspend"] is False
    assert spec["concurrencyPolicy"] == "Forbid"
    assert spec["timezone"] == "Asia/Seoul"

    workflow_spec = _mapping(spec["workflowSpec"])
    assert "workflowTemplateRef" not in workflow_spec
    assert workflow_spec["podGC"] == {"strategy": "OnPodSuccess"}
    rendered = yaml.safe_dump(check)
    assert "semaphore" not in rendered and "mutex" not in rendered

    template = next(
        _mapping(item) for item in _sequence(workflow_spec["templates"]) if _mapping(item)["name"] == "check"
    )
    container = _mapping(template["container"])
    # 렌더된 이미지는 digest로 고정돼 있어야 한다. 여기서 이름을 그대로 단언하면 kustomize가 그 이름을
    # 바꾸지 못한 사실을 통과시킨다. 2026-09-11 첫 회차가 docker.io에서 `eatbid-dataplane:latest`를
    # 찾다 ImagePullBackOff로 멈췄는데, 이 단언이 이름이었기 때문에 테스트는 초록이었다.
    assert str(container["image"]).startswith("ghcr.io/lamyzm/eatbid-dataplane@sha256:")
    command = "".join(str(item) for item in _sequence(container["args"]))
    assert "eatbid check-expectations" in command
    # release에 매이지 않는 명령이라 build-sha·source-release-id를 받지 않는다.
    assert "--build-sha" not in command and "--source-release-id" not in command

    assert _env(container, "EATBID_ENVIRONMENT")["value"] == "prod"
    assert _secret_ref(_env(container, "DATABASE_URL")) == (
        "eatbid-database-dataplane",
        "DATABASE_URL",
    )
    for key in ("TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"):
        assert _secret_ref(_env(container, key)) == ("eatbid-alerting", key)
    # 클러스터 밖 dead man's switch(EAT-171). 이 env가 빠지면 코드는 조용히 skipped로 끝나고 바깥
    # 감시가 켜져 있다고 믿는 채로 눈이 먼다. 그래서 manifest가 값을 주는지를 계약으로 박는다.
    assert _secret_ref(_env(container, "EATBID_HEARTBEAT_URL")) == (
        "eatbid-alerting",
        "HEARTBEAT_URL",
    )


def test_DB_백업_CronWorkflow는_매시간_소유자로_덤프해_R2에_두고_소스와_템플릿을_건드리지_않는다(
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
    # 전체 덤프는 레거시 `public`까지 읽어야 한다. 그 표들의 소유자는 database 소유자라 migrator로는
    # LOCK TABLE에서 거부된다(2026-09-10 실측). 그래서 provisioning Job과 같은 bootstrap 자격을 쓴다.
    assert "DATABASE_URL" not in dump_env
    for key in ("PGUSER", "PGPASSWORD", "PGDATABASE"):
        assert dump_env[key]["valueFrom"]["secretKeyRef"]["name"] == "eatbid-postgres-bootstrap"
    dump_script = "".join(str(item) for item in _sequence(containers["dump"]["args"]))
    assert "--format=custom" in dump_script
    # schema를 좁히면 레거시 표가 백업에서 조용히 빠진다. 재해 복구 대상은 database 전체다.
    assert "--schema" not in dump_script
    upload_env = {
        _mapping(item)["name"]: _mapping(item) for item in _sequence(containers["upload"]["env"])
    }
    for key in ("RCLONE_CONFIG_R2_ENDPOINT", "RCLONE_CONFIG_R2_ACCESS_KEY_ID", "RCLONE_CONFIG_R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        assert upload_env[key]["valueFrom"]["secretKeyRef"]["name"] == "eatbid-r2"
    upload_script = "".join(str(item) for item in _sequence(containers["upload"]["args"]))
    assert "backup/postgres/hourly" in upload_script and "backup/postgres/daily" in upload_script
    assert "--min-age 48h" in upload_script and "--min-age 720h" in upload_script


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
    """왜: 이 priority는 2026-09-07(EAT-93) 도입 당시엔 "대기 큐는 priority 내림차순 → 생성 시각
    순"(Argo v4.0.8 `workflow/sync/sync_manager.go`, `wf.Spec.Priority` 미지정은 0)이라는 가정으로
    backfill보다 스케줄 수집을 앞세우는 유일한 장치였다. 2026-09-10 18:53 poll-open 회차가 이 값을
    가진 채로도 상세 수집 대부분이 backfill 뒤에서 2시간 묶여 그 가정이 template 수준 semaphore에서는
    지켜지지 않음을 보였고, 원인 규명 없이 보장을 source semaphore key 분리로 옮겼다(EAT-164,
    `test_backfill_pipeline은_discover_capture만_backfill_key로_바꾸고_나머지는_scheduled_pipeline과_공유한다`).
    이 값 자체는 지우지 않는다 — 같은 key를 다투는 poll-open·daily-reconcile 사이 순서와 컨트롤러 큐
    일반의 의미는 여전히 priority가 쥔다."""
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


def test_backfill_pipeline은_discover_capture만_backfill_key로_바꾸고_나머지는_scheduled_pipeline과_공유한다(
    manifests: ManifestSet,
) -> None:
    """왜: 보장이 priority에서 source semaphore key 분리로 옮겨갔다(EAT-164, 위 우선순위 테스트).
    한 실행이 eatbid-source-live·eatbid-source-backfill 두 key를 동시에 잡지 않는지, discover-backfill·
    capture-backfill을 부르는 DAG가 backfill-pipeline뿐인지, normalize 이후 task는 scheduled-pipeline과
    정의가 갈라지지 않았는지를 고정한다."""
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)

    backfill_dag = _mapping(templates["backfill-pipeline"]["dag"])
    backfill_tasks = [_mapping(task) for task in _sequence(backfill_dag["tasks"])]
    assert [task["name"] for task in backfill_tasks] == list(SCHEDULED_TASKS)
    assert [task["template"] for task in backfill_tasks] == [
        "discover-backfill",
        "capture-backfill",
        "normalize",
        "validate",
        "project",
        "marts",
    ]

    # discover·capture는 template 필드만 다르고 나머지(dependencies·withParam·arguments)는 두 DAG가
    # 완전히 같은 task 정의를 anchor로 공유해야 한다. normalize·validate·project·marts는 필드까지
    # 전부 같아야 한다 — semaphore가 없는 단계라 backfill 변형을 따로 둘 이유가 없다.
    scheduled_tasks = {str(task["name"]): task for task in _dag_tasks(workflow_template)}
    for task in backfill_tasks:
        name = str(task["name"])
        scheduled_task = dict(scheduled_tasks[name])
        candidate = dict(task)
        if name in ("discover", "capture"):
            scheduled_task.pop("template", None)
            candidate.pop("template", None)
        assert candidate == scheduled_task, name

    # 백필 전용 template을 부르는 DAG와 live 전용을 부르는 DAG는 서로 배타적이다. 한 실행이 두
    # semaphore key를 동시에 잡지 않는다는 보장이 이 배타성에서 나온다. 백필 계열 DAG는 둘이다 —
    # 사람이 부르는 backfill-pipeline과 예약이 부르는 windowed-backfill-pipeline이며, 뒤의 것은 창을
    # 앞 단계에서 받는 것만 다르다(EAT-209).
    backfill_dags = {"backfill-pipeline", "windowed-backfill-pipeline"}
    live_only = {"discover", "capture"}
    backfill_only = {"discover-backfill", "capture-backfill", "discover-backfill-windowed"}
    for name, template in templates.items():
        dag = template.get("dag")
        if dag is None:
            continue
        task_templates = {
            str(_mapping(task)["template"]) for task in _sequence(_mapping(dag)["tasks"])
        }
        if name in backfill_dags:
            assert task_templates.isdisjoint(live_only), name
        elif name == "advancing-backfill-pipeline":
            # 창을 고르는 단계는 소스를 부르지 않으므로 어느 key도 잡지 않는다. 실제 수집은 중첩된
            # windowed-backfill-pipeline이 한다.
            assert task_templates.isdisjoint(live_only | backfill_only), name
        else:
            assert task_templates.isdisjoint(backfill_only), name


def test_eatbid_source_limit는_과도기_key이고_도는_backfill이_끝나면_지운다(
    manifests: ManifestSet,
) -> None:
    """왜: 2026-09-11 EAT-164 배포 시점에 이미 돌고 있던 backfill Workflow가 workflowTemplateRef
    스냅샷에 옛 key eatbid-source-limit을 들고 있었다 — Argo는 실행 중 Workflow의 template을 다시
    읽지 않지만 semaphore capacity는 chunk를 새로 잡을 때마다 ConfigMap을 live로 읽는다(2026-09-11
    운영에서 `status.synchronization.holding`으로 확인). 그 실행이 끝나기 전에 이 key를 ConfigMap에서
    지우면 다음 chunk를 잡으려는 순간의 동작이 검증되지 않고, 복구 수단인 fail-release CLI는 아직
    없다(EAT-122). 이 테스트가 사라지는 날이 제거 조건(그 backfill이 끝나고 클러스터에 이 key를 쓰는
    실행이 하나도 없는 날)이 충족된 날이라는 신호다 — 후속 정리는 별도 이슈로 추적한다."""
    limit = manifests.named("ConfigMap", "eatbid-workflow-limits")
    assert limit["data"]["eatbid-source-limit"] == "1"

    # 새 template 중 어느 것도 이 key를 쓰지 않는다 — 이 배포 이후 새로 만들어지는 실행은 전부
    # eatbid-source-live/eatbid-source-backfill로만 간다. 옛 key는 이 배포 이전에 이미 제출된, 아직
    # 끝나지 않은 그 backfill의 스냅샷 안에만 남아 있다.
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)
    for name in ("discover", "capture", "discover-backfill", "capture-backfill", "capture-reference"):
        synchronization = _mapping(templates[name]["synchronization"])
        semaphores = [_mapping(item) for item in _sequence(synchronization["semaphores"])]
        key_ref = _mapping(semaphores[0]["configMapKeyRef"])
        assert key_ref["key"] != "eatbid-source-limit", name


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

    # 수집은 eaT 스케줄 수집과 같은 eatbid-source-live를, 투영은 core 발행 mutex를 쓴다. 새 semaphore를
    # 만들지 않는다. backfill 전용 key(eatbid-source-backfill)에 두지 않는 이유는 월 1회·짧게 끝나는
    # 실행이 며칠 도는 backfill 뒤에서 밀리면 안 되기 때문이다(2026-09-11, EAT-164).
    capture_sync = _mapping(templates["capture-reference"]["synchronization"])
    capture_semaphore = _mapping(
        _mapping(_sequence(capture_sync["semaphores"])[0])["configMapKeyRef"]
    )
    assert (capture_semaphore["name"], capture_semaphore["key"]) == (
        "eatbid-workflow-limits",
        "eatbid-source-live",
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


SAMPLE_CODE_VOCABULARY_ENV = {
    "BUILD_SHA": "a" * 64,
    "EATBID_RUN_ID": "00000000-0000-0000-0000-000000000001",
    "EATBID_SOURCE_RELEASE_ID": "00000000-0000-0000-0000-000000000002",
    "EATBID_OBSERVATION_ID": "7",
    "EATBID_PARSER_VERSION": "eat-v1",
    "EATBID_RELEASE_NAME": "eat-code-vocabulary 2026-09-16",
    "EATBID_WORKFLOW_CREATED_AT": "2026-09-16T05:00:00Z",
    "EATBID_RESULT_DIR": "/tmp/eatbid",
}


def _execute_code_vocabulary_capture_script(
    manifests: ManifestSet, monkeypatch: object, environment: Mapping[str, str]
) -> list[str]:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    container = _mapping(
        _templates(workflow_template)["capture-code-vocabulary"]["container"]
    )
    script = str(_sequence(container["args"])[0])
    captured: list[str] = []

    def capture_execvp(executable: str, argv: list[str]) -> None:
        assert executable == "eatbid"
        captured.extend(argv)

    for key in list(SAMPLE_STAGE_ENV) + list(SAMPLE_CODE_VOCABULARY_ENV):
        monkeypatch.delenv(key, raising=False)  # type: ignore[attr-defined]
    for key, value in environment.items():
        monkeypatch.setenv(key, value)  # type: ignore[attr-defined]
    monkeypatch.setattr(os, "execvp", capture_execvp)  # type: ignore[attr-defined]
    exec(compile(script, "<capture-code-vocabulary-entrypoint>", "exec"), {})  # noqa: S102
    return captured


def test_코드목록_pipeline이_수집과_투영_둘로만_돌고_예약_DAG를_바꾸지_않는다(
    manifests: ManifestSet,
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    templates = _templates(workflow_template)

    # 예약 수집 DAG는 이 변경에서 그대로다. 어휘 적재가 공고 수집 순서를 건드리면 안 된다.
    assert [task["name"] for task in _dag_tasks(workflow_template)] == list(SCHEDULED_TASKS)
    assert _spec(workflow_template)["entrypoint"] == "scheduled-pipeline"

    dag = _mapping(templates["code-vocabulary-pipeline"]["dag"])
    tasks = [_mapping(task) for task in _sequence(dag["tasks"])]
    assert [task["name"] for task in tasks] == list(CODE_VOCABULARY_TASKS)
    assert [task["template"] for task in tasks] == list(CODE_VOCABULARY_TASKS)
    assert tasks[0].get("dependencies", []) == []
    assert tasks[1]["dependencies"] == ["capture-code-vocabulary"]
    # 투영은 수집이 만든 release와 관측을 그대로 받는다. 두 단계가 각자 정체성을 지으면 같은
    # 실행에서 다른 release를 가리킨다.
    project_arguments = _task_arguments(tasks[1])
    for name in ("source-release-id", "observation-id"):
        assert project_arguments[name] == (
            f"{{{{tasks.capture-code-vocabulary.outputs.parameters.{name}}}}}"
        )
    assert set(project_arguments) == _input_names(templates["project-code-vocabulary"])

    # 어느 그룹을 묻는지는 workflow 파라미터가 아니다. 그룹 목록이 여기 있으면 manifest가 검토된
    # 코드목록 표와 별개의 두 번째 원천이 된다.
    assert "inputs" not in templates["capture-code-vocabulary"]

    # 두 단계 모두 workflow의 parser-version을 그대로 쓴다. 그 기본값으로 코드목록 계약을 찾지 못하면
    # 어휘 적재는 제출하는 순간 멈추고, 그 사실은 실행해 봐야만 드러난다.
    template_parser_version = {
        item["name"]: item["value"]
        for item in _sequence(_mapping(_spec(workflow_template)["arguments"])["parameters"])
        if isinstance(item, Mapping)
    }["parser-version"]
    assert require("code-list", parser_version=str(template_parser_version)).record_type == (
        "code-vocabulary.v1"
    )
    for name in CODE_VOCABULARY_TASKS:
        container = _mapping(templates[name]["container"])
        assert _env(container, "EATBID_PARSER_VERSION")["value"] == (
            "{{workflow.parameters.parser-version}}"
        )

    capture_sync = _mapping(templates["capture-code-vocabulary"]["synchronization"])
    capture_semaphore = _mapping(
        _mapping(_sequence(capture_sync["semaphores"])[0])["configMapKeyRef"]
    )
    assert (capture_semaphore["name"], capture_semaphore["key"]) == (
        "eatbid-workflow-limits",
        "eatbid-source-live",
    )
    project_sync = _mapping(templates["project-code-vocabulary"]["synchronization"])
    assert [_mapping(item) for item in _sequence(project_sync["mutexes"])] == [
        {"name": "eatbid-core-publication"}
    ]


def test_코드목록_수집은_workflow_uid로_release_정체성을_결정적으로_만든다(
    manifests: ManifestSet, monkeypatch: object
) -> None:
    argv = _execute_code_vocabulary_capture_script(
        manifests, monkeypatch, SAMPLE_CODE_VOCABULARY_ENV
    )
    parsed = build_parser().parse_args(argv[1:])
    assert argv[0:2] == ["eatbid", "capture-code-vocabulary"]
    assert parsed.run_id == UUID(SAMPLE_CODE_VOCABULARY_ENV["EATBID_RUN_ID"])
    assert parsed.parser_version == "eat-v1"

    again = _execute_code_vocabulary_capture_script(
        manifests, monkeypatch, SAMPLE_CODE_VOCABULARY_ENV
    )
    assert _flag_value(again, "--source-release-id") == _flag_value(argv, "--source-release-id")
    # 정부 파일 실행과 같은 workflow uid라도 다른 release 정체성을 만든다. 같은 값을 만들면 두 소스의
    # release가 서로를 막는다.
    reference = _execute_reference_capture_script(
        manifests, monkeypatch, SAMPLE_REFERENCE_ENV
    )
    assert _flag_value(argv, "--source-release-id") != _flag_value(
        reference, "--source-release-id"
    )


def test_코드목록_수집은_workflow_uid_없이_CLI를_부르지_않는다(
    manifests: ManifestSet, monkeypatch: object
) -> None:
    for broken in ("", "not-a-uuid"):
        with pytest.raises(SystemExit) as error:
            _execute_code_vocabulary_capture_script(
                manifests,
                monkeypatch,
                {**SAMPLE_CODE_VOCABULARY_ENV, "EATBID_RUN_ID": broken},
            )
        assert error.value.code == 64


def test_코드목록_투영의_argv가_CLI_parser의_필수_인자를_모두_채운다(
    manifests: ManifestSet,
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    container = _mapping(
        _templates(workflow_template)["project-code-vocabulary"]["container"]
    )
    command = str(_sequence(container["args"])[0])

    argv = _render_shell_argv(command, SAMPLE_CODE_VOCABULARY_ENV)
    assert argv[0:2] == ["eatbid", "project-code-vocabulary"]
    parsed = build_parser().parse_args(argv[1:])
    assert parsed.observation_id == 7
    assert parsed.source_release_id == UUID(
        SAMPLE_CODE_VOCABULARY_ENV["EATBID_SOURCE_RELEASE_ID"]
    )

    declared = {
        str(item["name"])
        for item in _sequence(container["env"])
        if isinstance(item, Mapping)
    }
    assert set(SHELL_VARIABLE.findall(command)) - {"BUILD_SHA"} <= declared


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


def test_workflow_parameter는_mode_외에_backfill_창과_바닥만_추가로_받는다(
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
        "parser-version": "eat-v5",
        "calc-version": "mart-r10",
        "start-date": "",
        "end-date": "",
        "release-name": "",
        # 백필이 뒤로 갈 바닥이다. 이 값을 미는 커밋이 그 해의 수집을 시작시키며 그것이 운영자
        # 승인이다(ADR 0052 결정 5). 전진 CronWorkflow만 읽는다. 2026-09-16 1년치가 닫혀 3년으로 민다(EAT-253).
        "backfill-floor-date": "20210901",
    }
    discover = _templates(workflow_template)["discover"]
    discover_env = _mapping(discover["container"])
    assert _env(discover_env, "EATBID_WORKFLOW_MODE")["value"] == "{{workflow.parameters.mode}}"
    assert _env(discover_env, "EATBID_WORKFLOW_CREATED_AT")["value"] == (
        "{{workflow.creationTimestamp}}"
    )

    # 창은 입력을 거쳐 들어온다. 기본값이 workflow 파라미터라 부르는 쪽이 넘기지 않으면 예전과 같고,
    # 전진 pipeline만 앞 단계가 고른 창을 넘긴다(EAT-209). 이 간접이 없으면 창을 사람이 정해 주는
    # 모양에서 벗어날 수 없다.
    assert _env(discover_env, "EATBID_START_DATE")["value"] == "{{inputs.parameters.start-date}}"
    assert _env(discover_env, "EATBID_END_DATE")["value"] == "{{inputs.parameters.end-date}}"
    discover_inputs = {
        str(item["name"]): item.get("value")
        for item in _sequence(_mapping(discover["inputs"])["parameters"])
        if isinstance(item, Mapping)
    }
    assert discover_inputs == {
        "start-date": "{{workflow.parameters.start-date}}",
        "end-date": "{{workflow.parameters.end-date}}",
    }


def test_replay는_ID를_주지_않으면_release_전체를_재처리한다(
    manifests: ManifestSet, monkeypatch: object
) -> None:
    """왜: 창 하나가 1만 6천 건이면 목록을 parameter로 넘길 때 128KiB 상한을 넘어 파드도 뜨지 못한다.
    비워 두면 CLI가 저장소에서 직접 읽으므로 사람이 나눌 일이 없다(EAT-274)."""
    argv = _execute_replay_script(manifests, monkeypatch, "")

    assert argv[0:2] == ["eatbid", "replay"]
    assert "--observation-id" not in argv
    parsed = build_parser().parse_args(argv[1:])
    assert parsed.observation_id is None


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
    # db-provisioning(소유자 권한 회수)과 db-backup(레거시 public까지 읽는 전체 덤프)은 database 소유자
    # 자격이 필요해 postgres bootstrap Secret을 읽는다. 나머지 조합은 여기서 계속 막는다.
    for kind, name, assigned in (
        ("Deployment", "postgres", "eatbid-postgres-bootstrap"),
        ("Deployment", "server", "eatbid-database-api"),
        ("Job", "eatbid-migration", "eatbid-database-migrator"),
        ("Job", "eatbid-db-provisioning", "eatbid-postgres-bootstrap"),
        ("CronWorkflow", "eatbid-db-backup", "eatbid-postgres-bootstrap"),
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
        assert f"infra/envs/prod/kustomization.yaml {image} \"$(cat digests/{app})\"" in promote


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


def test_전진_DAG의_조건은_CLI가_적는_소문자_불리언과_같은_글자다(
    manifests: ManifestSet,
) -> None:
    """`when`이 비교하는 글자와 CLI가 파일에 적는 글자는 같은 계약의 양쪽이다.

    2026-09-14~15에 전진 cron이 28시간 동안 매시 `Succeeded`로 끝나면서 본 단계를 통째로 건너뛰었다.
    CLI가 `str(True)`로 `True`를 적었고 `when`은 `true`와 비교해 언제나 거짓이었다. 실패가 아니라
    성공으로 보였기 때문에 어떤 감시도 그것을 잡지 못했다. 반대쪽 절반은 dataplane 단위 테스트가
    `has_window` 파일의 내용이 정확히 `true`/`false`인지로 고정한다.
    """
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    conditions = [
        str(_mapping(task)["when"])
        for template in _templates(workflow_template).values()
        for task in _sequence(_mapping(template.get("dag") or {}).get("tasks", []))
        if "when" in _mapping(task)
    ]

    assert conditions, "조건부 task가 하나도 없다 — 이 검사가 무엇도 지키지 못한다"
    for condition in conditions:
        assert "== true" in condition
        assert "True" not in condition


def test_dataplane_container_template은_프로세스_설정_다섯을_모두_선언한다(
    manifests: ManifestSet,
) -> None:
    """`ApplicationSettings`는 명령별이 아니라 프로세스 단위 설정이라 다섯이 모두 있어야 기동한다.

    2026-09-14 첫 전진 회차가 exit 64로 죽었다. `next-backfill-window`는 view 하나만 읽어 R2를 쓰지
    않는데, 설정 검증이 조립보다 먼저 돌아 R2 넷이 없다는 이유로 프로세스가 시작조차 못 했다. 기준은
    그 명령이 값을 쓰느냐가 아니라 프로세스가 그 값 없이 뜨느냐이므로 template마다 예외를 두지 않는다.
    """
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    required = {
        "DATABASE_URL": "eatbid-database-dataplane",
        "R2_ENDPOINT_URL": "eatbid-r2",
        "R2_BUCKET": "eatbid-r2",
        "R2_ACCESS_KEY_ID": "eatbid-r2",
        "R2_SECRET_ACCESS_KEY": "eatbid-r2",
    }
    checked = 0
    for name, template in _templates(workflow_template).items():
        container = template.get("container")
        if container is None:
            continue
        checked += 1
        for key, secret in required.items():
            assert _secret_ref(_env(_mapping(container), key)) == (secret, key), (
                f"{name} template이 {key}를 선언하지 않았다"
            )
    assert checked > 0


def test_discover는_workflow_이름을_env로_받아_run_행에_남긴다(manifests: ManifestSet) -> None:
    """알림의 run_id, R2 로그의 workflow 이름, 릴리스의 uid를 잇는 유일한 물건이 Workflow 객체였고 그것은
    TTL로 사라진다. discover가 이름을 run 행에 적어야 사후에 세 식별자가 만난다(ADR 0046 결정 1, EAT-231)."""
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    template = _templates(workflow_template)["discover"]
    container = template["container"]
    assert _env(container, "EATBID_WORKFLOW_NAME")["value"] == "{{workflow.name}}"
    # 없을 때는 인자를 아예 빼야 한다 — 빈 문자열을 넘기면 "이름이 빈 워크플로"라는 거짓 사실이 남는다.
    source = "\n".join(str(argument) for argument in container["args"])  # type: ignore[index]
    assert '"--workflow-name", workflow_name] if (workflow_name := os.environ.get("EATBID_WORKFLOW_NAME")) else []' in source

def test_mart_회수_cron은_수집이_없는_새벽에_하루_한_번_템플릿의_reap_marts를_부른다(
    manifests: ManifestSet,
) -> None:
    """왜: 1일 보존인 mart가 하루 66번 물리면서 900 build·20GB가 쌓였고 활성은 셋뿐이었다(EAT-254).
    회수는 ADR 0034가 허용한 유일한 공개 mart 행 삭제라 어떤 수집 DAG에도 들지 않고 스케줄 하나가 부른다.
    """
    cron = next(
        cron
        for cron in manifests.of_kind("CronWorkflow")
        if _metadata(cron)["name"] == "eatbid-mart-reap"
    )
    spec = _spec(cron)
    assert spec["schedules"] == ["30 4 * * *"]
    assert spec["timezone"] == "Asia/Seoul"
    assert spec["suspend"] is False
    assert spec["concurrencyPolicy"] == "Forbid"
    workflow_spec = _mapping(spec["workflowSpec"])
    assert _mapping(workflow_spec["workflowTemplateRef"])["name"] == "eatbid-dataplane"
    assert workflow_spec["entrypoint"] == "reap-marts"

    templates = _templates(manifests.workflow_template("eatbid-dataplane"))
    reap = templates["reap-marts"]
    # 활성화와 mutex를 다투지 않는다 — 잡으면 첫 회수가 그동안 화면의 build 전환을 막는다.
    assert "synchronization" not in reap
    args = " ".join(str(item) for item in _sequence(_mapping(reap["container"])["args"]))
    assert "eatbid reap-marts" in args


def test_DAG_task는_부르는_template의_input을_하나도_빠뜨리지_않는다(
    manifests: ManifestSet,
) -> None:
    """왜: Argo는 DAG task가 template의 기본값을 상속하지 않는다고 판정한다. 하나라도 빠지면 workflow가
    노드를 만들기 전에 `inputs.parameters.X was not supplied`로 통째로 거부되고, 그러면 smoke는 "decide가
    없다"만 보여 준다(2026-09-18 실측, EAT-274). 렌더 단계에서 잡는다."""
    templates = _templates(manifests.workflow_template("eatbid-dataplane"))

    for name, template in templates.items():
        dag = template.get("dag")
        if dag is None:
            continue
        for task in _sequence(_mapping(dag)["tasks"]):
            task_map = _mapping(task)
            called = templates.get(str(task_map.get("template", "")))
            if called is None:
                continue
            required = {
                str(_mapping(item)["name"])
                for item in _sequence(_mapping(called.get("inputs", {})).get("parameters", []))
                if "value" not in _mapping(item) and "valueFrom" not in _mapping(item)
            }
            supplied = {
                str(_mapping(item)["name"])
                for item in _sequence(
                    _mapping(task_map.get("arguments", {})).get("parameters", [])
                )
            }
            missing = required - supplied
            assert not missing, f"{name}.{task_map.get('name')} -> {task_map.get('template')}: {missing}"
