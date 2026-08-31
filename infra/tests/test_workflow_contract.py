from __future__ import annotations

import ast
import os
import re
from collections.abc import Iterable, Mapping
from itertools import pairwise
from pathlib import Path

import pytest
import yaml
from conftest import ManifestSet
from eatbid.source.eat.schema_contract import REVIEWED_EAT_SCHEMA_CONTRACTS

ROOT = Path(__file__).parents[2]
PRODUCT_KUSTOMIZATION = ROOT / "infra" / "product" / "kustomization.yaml"
PLATFORM_APPLICATION = ROOT / "infra" / "platform" / "argo-workflows.application.yaml"
LIVE_APPLICATION = ROOT / "infra" / "argocd" / "application.yaml"
CLI = ROOT / "apps" / "dataplane" / "src" / "eatbid" / "cli.py"
BUILD_WORKFLOW = ROOT / ".github" / "workflows" / "build.yml"

SCHEDULED_COMMANDS = ("discover", "capture", "normalize", "validate", "project")
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
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "COMMANDS" for target in node.targets)
    )
    commands = ast.literal_eval(assignment.value)
    assert isinstance(commands, tuple)
    return commands


def test_product와_base_render가_cutover를_비활성으로_유지한다(
    manifests: ManifestSet, base_manifests: ManifestSet
) -> None:
    assert manifests.kinds.count("WorkflowTemplate") == 1
    assert manifests.kinds.count("CronWorkflow") == 2
    assert manifests.kinds.count("Job") == 1
    assert manifests.kinds.count("CronJob") == 0
    assert manifests.kinds.count("Application") == 0
    assert manifests.kinds.count("Secret") == 0

    assert base_manifests.kinds.count("CronJob") == 4
    assert {
        _metadata(cron_job)["name"] for cron_job in base_manifests.of_kind("CronJob")
    } == {"daily-refresh", "poll-open-day", "poll-open-off", "poll-open-weekend"}

    live_application = yaml.safe_load(LIVE_APPLICATION.read_text(encoding="utf-8"))
    assert live_application["spec"]["source"]["path"] == "infra/k8s/base"


def test_workflow_template가_현재_CLI와_지속_가능한_boundary를_사용한다(
    manifests: ManifestSet,
) -> None:
    workflow_template = manifests.workflow_template("eatbid-dataplane")
    spec = _spec(workflow_template)
    assert spec["entrypoint"] == "scheduled-pipeline"
    assert spec["serviceAccountName"] == "eatbid-dataplane"
    reviewed_parser_versions = {key[2] for key in REVIEWED_EAT_SCHEMA_CONTRACTS}
    assert len(reviewed_parser_versions) == 1
    reviewed_parser_version = next(iter(reviewed_parser_versions))
    workflow_parameters = {
        item["name"]: item["value"]
        for item in _sequence(_mapping(spec["arguments"])["parameters"])
        if isinstance(item, Mapping)
    }
    assert workflow_parameters["parser-version"] == reviewed_parser_version

    templates = _templates(workflow_template)
    dag = _mapping(templates["scheduled-pipeline"]["dag"])
    tasks = [_mapping(task) for task in _sequence(dag["tasks"])]
    assert [task["name"] for task in tasks] == list(SCHEDULED_COMMANDS)
    assert [task["template"] for task in tasks] == list(SCHEDULED_COMMANDS)
    assert tasks[0].get("dependencies", []) == []
    for previous, current in pairwise(SCHEDULED_COMMANDS):
        task = next(task for task in tasks if task["name"] == current)
        assert task["dependencies"] == [previous]

    assert _cli_commands() == (*SCHEDULED_COMMANDS, "replay")
    assert "replay" in templates
    assert "build-marts" not in templates
    assert "verify" not in templates
    assert "74" not in yaml.safe_dump(workflow_template)
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

    containers = [_mapping(templates[name]["container"]) for name in (*SCHEDULED_COMMANDS, "replay")]
    dataplane_images = {str(container["image"]) for container in containers}
    assert len(dataplane_images) == 1
    assert re.fullmatch(
        r"ghcr\.io/lamyzm/eatbid-dataplane@sha256:[0-9a-f]{64}",
        next(iter(dataplane_images)),
    )
    for container in containers:
        template_name = next(
            name
            for name in (*SCHEDULED_COMMANDS, "replay")
            if templates[name]["container"] is container
        )
        command = str(_sequence(container["args"])[0])
        if template_name == "replay":
            assert container["command"] == ["python", "-c"]
            assert '"--build-sha", os.environ["BUILD_SHA"]' in command
        else:
            assert container["command"] == ["/bin/sh", "-ec"]
            assert command.startswith(f"exec eatbid {template_name} ")
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


def test_cron_workflow는_suspend되고_pipeline만_schedule한다(
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
        assert spec["suspend"] is True
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
        "BUILD_SHA": "a" * 40,
        "EATBID_RUN_ID": "00000000-0000-0000-0000-000000000001",
        "EATBID_PARSER_VERSION": "eat-v1",
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


def test_migration은_presync가_유한하고_secret_DATABASE_URL만_사용한다(
    manifests: ManifestSet,
) -> None:
    job = manifests.named("Job", "eatbid-migration")
    annotations = _mapping(_metadata(job)["annotations"])
    assert annotations["argocd.argoproj.io/hook"] == "PreSync"
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
            if mapping.get("name") in {"DATABASE_URL", "POSTGRES_PASSWORD"}:
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
    for consumer, assigned in {
        "postgres": "eatbid-postgres-bootstrap",
        "server": "eatbid-database-api",
        "migration": "eatbid-database-migrator",
    }.items():
        document = manifests.named("Job" if consumer == "migration" else "Deployment", f"eatbid-{consumer}" if consumer == "migration" else consumer)
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
