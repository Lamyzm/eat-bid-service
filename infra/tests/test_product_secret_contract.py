from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from conftest import ManifestSet

# 클러스터에서 사람이 직접 만들어 둔 Secret. Infisical operator가 자기 자신을 인증하는
# `eatbid-infisical-operator`는 닭과 달걀 문제라 영원히 수기이고, 나머지 셋은 아직 Infisical로
# 옮기지 않은 잔여 부채다. 목록을 넓혀서 "아무도 만들지 않는 Secret 참조"를 통과시키지 마라.
HAND_INJECTED_SECRETS = frozenset(
    {
        "cloudflared-creds",
        "eatbid-auth",
        "eatbid-share",
        "ghcr-pull",
    }
)

INFISICAL_PROJECT_SLUG = "eatbid-az9z"
INFISICAL_ENV_SLUG = "prod"
OPERATOR_CREDENTIALS_SECRET = "eatbid-infisical-operator"

EXPECTED_SECRET_PATHS = {
    "eatbid-postgres-bootstrap": "/runtime/postgres",
    "eatbid-database-migrator": "/runtime/migrator",
    "eatbid-database-api": "/runtime/server",
    "eatbid-database-dataplane": "/runtime/dataplane",
    "eatbid-r2": "/runtime/dataplane/r2",
}


def _referenced_secret_names(value: Any) -> Iterator[str]:
    if isinstance(value, dict):
        reference = value.get("secretKeyRef")
        if isinstance(reference, dict) and reference.get("name"):
            yield str(reference["name"])
        if value.get("secretName"):
            yield str(value["secretName"])
        for pull_secret in value.get("imagePullSecrets") or []:
            if isinstance(pull_secret, dict) and pull_secret.get("name"):
                yield str(pull_secret["name"])
        for child in value.values():
            yield from _referenced_secret_names(child)
    elif isinstance(value, list):
        for child in value:
            yield from _referenced_secret_names(child)


def _infisical_secrets(manifests: ManifestSet) -> tuple[dict[str, Any], ...]:
    return manifests.of_kind("InfisicalSecret")


def test_product_render가_선언한_InfisicalSecret_다섯을_그대로_갖는다(
    manifests: ManifestSet,
) -> None:
    declared = {
        str(document["metadata"]["name"]): document
        for document in _infisical_secrets(manifests)
    }

    assert set(declared) == set(EXPECTED_SECRET_PATHS)

    for name, document in declared.items():
        scope = document["spec"]["authentication"]["universalAuth"]["secretsScope"]
        credentials = document["spec"]["authentication"]["universalAuth"][
            "credentialsRef"
        ]
        managed = document["spec"]["managedSecretReference"]

        assert document["metadata"]["namespace"] == "eatbid", name
        assert scope["projectSlug"] == INFISICAL_PROJECT_SLUG, name
        assert scope["envSlug"] == INFISICAL_ENV_SLUG, name
        assert scope["secretsPath"] == EXPECTED_SECRET_PATHS[name], name
        assert credentials["secretName"] == OPERATOR_CREDENTIALS_SECRET, name
        assert credentials["secretNamespace"] == "eatbid", name
        assert managed["secretName"] == name, name
        assert managed["secretNamespace"] == "eatbid", name
        # Orphan이어야 InfisicalSecret을 지우거나 이름을 바꿔도 실행 중 워크로드의 Secret이
        # 함께 사라지지 않는다. 배포 실수가 곧바로 장애가 되는 것을 막는 경계다.
        assert managed["creationPolicy"] == "Orphan", name


def test_render가_참조하는_Secret은_전부_생성_주체가_있다(
    manifests: ManifestSet,
) -> None:
    managed = {
        str(document["spec"]["managedSecretReference"]["secretName"])
        for document in _infisical_secrets(manifests)
    }
    referenced = {
        name
        for document in manifests.documents
        if document.get("kind") != "InfisicalSecret"
        for name in _referenced_secret_names(document)
    }

    assert referenced
    assert not referenced - managed - HAND_INJECTED_SECRETS


def test_render에_평문_Secret_값이_들어있지_않다(manifests: ManifestSet) -> None:
    for document in manifests.of_kind("Secret"):
        assert not document.get("data"), document["metadata"]["name"]
        assert not document.get("stringData"), document["metadata"]["name"]
