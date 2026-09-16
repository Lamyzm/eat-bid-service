from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path

from conftest import ManifestSet

ROOT = Path(__file__).parents[2]
PROVISIONING_SQL = ROOT / "infra" / "base" / "db-provisioning.sql"

JOB_NAME = "eatbid-db-provisioning"
CONFIG_MAP_PREFIX = "eatbid-db-provisioning-"
SQL_FILE_NAME = "db-provisioning.sql"

# readiness 계약(apps/server/src/platform/database/database-readiness.ts)이 참으로 만들려면
# SQL이 반드시 담아야 하는 문장들이다. 문구가 아니라 "이 권한 결정이 파일에 남아 있는가"를 본다.
REQUIRED_SQL_FRAGMENTS = (
    "eatbid_migrator",
    "eatbid_api",
    "eatbid_dataplane",
    "raise exception",
    "alter default privileges for role",
    "revoke temporary",
    "revoke all on all tables in schema ingest from eatbid_api",
    "grant select on table drizzle.__drizzle_migrations to eatbid_api",
    # mart 빌드는 dataplane이 실행하므로 mart DML이 필요하고, 런타임 DDL은 계속 금지다(ADR 0034).
    "grant select, insert, update, delete on all tables in schema ingest, core, mart ",
    "revoke create on schema ingest, core, mart, drizzle from eatbid_dataplane",
    # Grafana는 회차 지표와 파생 표만 읽는다. 원본·업무 사실·사용자 상태에는 닿지 않는다(EAT-174).
    "eatbid_grafana",
    "grant select on all tables in schema monitoring, mart to eatbid_grafana",
    "revoke all on schema ingest, core, app, drizzle from eatbid_grafana",
    # 크롤러 진척 대시보드는 ingest의 자리 다섯만 읽는다. 전체 ingest도, default privilege도 아니다(EAT-245).
    "grant select on ingest.backfill_coverage, ingest.run, ingest.publication, ingest.normalization_attempt to eatbid_grafana",
)


def _mapping(value: object) -> Mapping[str, object]:
    assert isinstance(value, Mapping)
    return value


def _sequence(value: object) -> list[object]:
    assert isinstance(value, list)
    return value


def _job(manifests: ManifestSet) -> Mapping[str, object]:
    return manifests.named("Job", JOB_NAME)


def _container(job: Mapping[str, object]) -> Mapping[str, object]:
    pod = _mapping(_mapping(_mapping(job["spec"])["template"])["spec"])
    containers = _sequence(pod["containers"])
    assert len(containers) == 1
    return _mapping(containers[0])


def _env(container: Mapping[str, object], name: str) -> Mapping[str, object]:
    matches = [
        _mapping(item)
        for item in _sequence(container.get("env", []))
        if isinstance(item, Mapping) and item.get("name") == name
    ]
    assert len(matches) == 1, (name, len(matches))
    return matches[0]


def _provisioning_config_map(manifests: ManifestSet) -> Mapping[str, object]:
    matches = tuple(
        document
        for document in manifests.of_kind("ConfigMap")
        if str(_mapping(document["metadata"])["name"]).startswith(CONFIG_MAP_PREFIX)
    )
    assert len(matches) == 1, [d["metadata"] for d in manifests.of_kind("ConfigMap")]
    return _mapping(matches[0])


def test_provisioning_Job은_migration_뒤_앱_앞_sync_wave에서_한_번_돈다(
    manifests: ManifestSet,
) -> None:
    job = _job(manifests)
    annotations = _mapping(_mapping(job["metadata"])["annotations"])

    assert annotations["argocd.argoproj.io/hook"] == "Sync"
    # 순서는 wave 0(postgres·Secret·ConfigMap) → 1(migration) → 2(provisioning) → 3(server·web)이다.
    # migration이 만든 표에 권한을 주고, 그 권한이 선 뒤에야 server가 readiness를 통과할 수 있다.
    assert annotations["argocd.argoproj.io/sync-wave"] == "2"
    assert (
        annotations["argocd.argoproj.io/hook-delete-policy"]
        == "BeforeHookCreation,HookSucceeded"
    )

    migration_annotations = _mapping(
        _mapping(manifests.named("Job", "eatbid-migration")["metadata"])["annotations"]
    )
    assert int(str(migration_annotations["argocd.argoproj.io/sync-wave"])) < int(
        str(annotations["argocd.argoproj.io/sync-wave"])
    )
    for name in ("server", "web"):
        app_annotations = _mapping(
            _mapping(manifests.named("Deployment", name)["metadata"]).get(
                "annotations", {}
            )
        )
        assert int(str(app_annotations["argocd.argoproj.io/sync-wave"])) > int(
            str(annotations["argocd.argoproj.io/sync-wave"])
        ), name

    spec = _mapping(job["spec"])
    assert spec["backoffLimit"] == 1
    assert isinstance(spec["activeDeadlineSeconds"], int)
    assert _mapping(_mapping(spec["template"])["spec"])["restartPolicy"] == "Never"


def test_provisioning_Job은_superuser_Secret만_읽고_평문_자격증명이_없다(
    manifests: ManifestSet,
) -> None:
    container = _container(_job(manifests))

    for key in ("PGUSER", "PGPASSWORD", "PGDATABASE"):
        reference = _mapping(_mapping(_env(container, key)["valueFrom"])["secretKeyRef"])
        # database 소유자만 TEMP 회수와 ALTER DEFAULT PRIVILEGES FOR ROLE을 실행할 수 있다.
        assert reference["name"] == "eatbid-postgres-bootstrap", key
        assert "value" not in _env(container, key), key
    assert _mapping(
        _mapping(_env(container, "PGUSER")["valueFrom"])["secretKeyRef"]
    )["key"] == "POSTGRES_USER"
    assert _mapping(
        _mapping(_env(container, "PGPASSWORD")["valueFrom"])["secretKeyRef"]
    )["key"] == "POSTGRES_PASSWORD"
    assert _mapping(
        _mapping(_env(container, "PGDATABASE")["valueFrom"])["secretKeyRef"]
    )["key"] == "POSTGRES_DB"
    assert _env(container, "PGHOST")["value"] == "postgres"

    rendered = str(_job(manifests))
    for other in (
        "eatbid-database-api",
        "eatbid-database-migrator",
        "eatbid-database-dataplane",
    ):
        assert other not in rendered


def test_provisioning_SQL은_저장소_파일_하나에서만_온다(
    manifests: ManifestSet,
) -> None:
    config_map = _provisioning_config_map(manifests)
    data = _mapping(config_map["data"])
    assert set(data) == {SQL_FILE_NAME}
    # ConfigMap을 손으로 쓰면 저장소 SQL과 클러스터 SQL이 갈라진다. render가 파일과 byte로 같아야
    # 통합 테스트가 검증한 그 권한 집합이 그대로 배포된다.
    assert data[SQL_FILE_NAME] == PROVISIONING_SQL.read_text(encoding="utf-8")

    container = _container(_job(manifests))
    mounts = _sequence(container["volumeMounts"])
    assert len(mounts) == 1
    mount = _mapping(mounts[0])
    volumes = _sequence(
        _mapping(_mapping(_mapping(_job(manifests)["spec"])["template"])["spec"])[
            "volumes"
        ]
    )
    assert len(volumes) == 1
    volume = _mapping(volumes[0])
    assert volume["name"] == mount["name"]
    assert _mapping(volume["configMap"])["name"] == config_map["metadata"]["name"]

    command = [str(item) for item in _sequence(container["command"])]
    assert "ON_ERROR_STOP=1" in command
    assert f"{mount['mountPath']}/{SQL_FILE_NAME}" in command


def test_provisioning_SQL은_역할을_만들지_않고_없으면_실패한다() -> None:
    text = PROVISIONING_SQL.read_text(encoding="utf-8").lower()

    # 역할 생성은 비밀번호를 요구하므로 저장소 파일의 책임이 아니다. 조용히 통과하는 대신 멈춘다.
    assert "create role" not in text
    assert "alter role" not in text
    assert "password" not in text
    for fragment in REQUIRED_SQL_FRAGMENTS:
        assert fragment in text, fragment
