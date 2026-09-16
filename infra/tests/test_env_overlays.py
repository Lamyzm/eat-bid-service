"""모듈 책임: 환경 overlay가 base에서 무엇만 바꾸는지, 그리고 prod 렌더가 전환 전과 같은지 고정한다."""

from __future__ import annotations

from conftest import MONOREPO_ROOT, ManifestSet


def test_product_별칭은_더_이상_없다() -> None:
    """전환이 끝났으므로 운영 렌더 경로는 `infra/envs/prod` 하나다.

    별칭이 되살아나면 두 경로가 갈라질 수 있고, 어느 쪽이 운영인지 다시 물어야 한다.
    """
    assert not (MONOREPO_ROOT / "infra" / "product" / "kustomization.yaml").exists()


def test_base만으로는_이미지를_당길_곳이_없다(base_manifests: ManifestSet) -> None:
    """base에 digest가 있으면 환경 없이 배포하는 길이 생긴다.

    base는 이름뿐인 이미지를 두고 overlay가 digest를 채운다. 그래야 "어느 환경인가"를 고르지 않고
    배포하는 일이 구조적으로 불가능하다.
    """
    images = [
        container["image"]
        for document in base_manifests.of_kind("Deployment")
        for container in document["spec"]["template"]["spec"]["containers"]  # type: ignore[index]
    ]

    assert images, "base에 Deployment가 없다 — 이 검사가 무엇도 지키지 못한다"
    assert all("@sha256:" not in image for image in images)


def test_dev는_소스를_부르지_않는다(dev_manifests: ManifestSet) -> None:
    """eaT에 붙는 클러스터는 하나뿐이어야 한다(ADR 0051 결정 4).

    백업과 감시까지 함께 멈추는 이유는 알림 방이 하나이기 때문이다. dev가 울리면 운영 알림과 섞여
    사람이 어느 환경의 사고인지 알 수 없다.
    """
    crons = dev_manifests.of_kind("CronWorkflow")

    assert crons, "dev에 CronWorkflow가 없다 — 이 검사가 무엇도 지키지 못한다"
    for cron in crons:
        assert cron["spec"]["suspend"] is True, cron["metadata"]["name"]  # type: ignore[index]


def test_prod는_예약_수집을_멈추지_않는다(prod_manifests: ManifestSet) -> None:
    수집 = {"eatbid-poll-open", "eatbid-daily-reconcile", "eatbid-backfill-advance"}
    켜진것 = {
        str(cron["metadata"]["name"])  # type: ignore[index]
        for cron in prod_manifests.of_kind("CronWorkflow")
        if cron["spec"]["suspend"] is False  # type: ignore[index]
    }

    assert 수집 <= 켜진것


def test_dev의_비밀값은_Infisical_dev_환경에서_온다(dev_manifests: ManifestSet) -> None:
    secrets = dev_manifests.of_kind("InfisicalSecret")

    assert secrets, "dev에 InfisicalSecret이 없다 — 이 검사가 무엇도 지키지 못한다"
    for secret in secrets:
        scope = secret["spec"]["authentication"]["universalAuth"]["secretsScope"]  # type: ignore[index]
        assert scope["envSlug"] == "dev", secret["metadata"]["name"]  # type: ignore[index]


def test_prod의_비밀값은_prod_환경에서_온다(prod_manifests: ManifestSet) -> None:
    for secret in prod_manifests.of_kind("InfisicalSecret"):
        scope = secret["spec"]["authentication"]["universalAuth"]["secretsScope"]  # type: ignore[index]
        assert scope["envSlug"] == "prod", secret["metadata"]["name"]  # type: ignore[index]


def test_환경마다_공개_주소가_다르다(
    prod_manifests: ManifestSet, dev_manifests: ManifestSet
) -> None:
    """같은 주소를 쓰면 dev 로그인이 운영 세션을 건드리고, 그 사고는 조용하다."""

    def 주소(manifest_set: ManifestSet) -> set[str]:
        server = manifest_set.named("Deployment", "server")
        container = server["spec"]["template"]["spec"]["containers"][0]  # type: ignore[index]
        return {
            str(item["value"])
            for item in container["env"]
            if item.get("name") in {"BETTER_AUTH_URL", "CORS_ORIGINS"}
        }

    assert 주소(prod_manifests) == {"https://eatbid.net"}
    assert 주소(dev_manifests) == {"https://dev.eatbid.net"}


def test_두_레인은_서로의_overlay_파일을_건드리지_않는다() -> None:
    """ADR 0051 결정 3이다. 한 레인이 다른 쪽 digest를 쓰면 dev 병합이 운영 이미지를 바꾼다."""
    release = (MONOREPO_ROOT / ".github" / "workflows" / "build.yml").read_text(
        encoding="utf-8"
    )
    dev = (MONOREPO_ROOT / ".github" / "workflows" / "dev-image.yml").read_text(
        encoding="utf-8"
    )

    assert "infra/envs/dev" not in release
    assert "infra/envs/prod" not in dev
    # 태그 레인만 서명한다. dev로 가는 이미지는 publication이 아니라 배포 후보다(결정 5).
    assert "cosign" not in dev
    assert "HEAD:refs/heads/deploy/dev" in dev
    assert "HEAD:refs/heads/deploy/prod" not in dev


def test_smoke는_dev의_파이프라인_조각만_남기고_소스_호스트를_묶는다(
    smoke_manifests: ManifestSet,
    dev_manifests: ManifestSet,
) -> None:
    """smoke가 통과하는 것과 dev가 뜨는 것이 같은 사실이어야 한다(EAT-226).

    smoke는 dev를 물려받아 GHCR·터널·CRD가 필요한 것만 지운다. WorkflowTemplate·CronWorkflow·RBAC이 dev와
    같지 않으면 로컬 초록이 운영의 증거가 아니다. eaT 호스트를 127.0.0.1로 묶는 것이 "소스를 부르지
    않는다"(ADR 0051 결정 4)의 실행 방식이고, 그것이 빠지면 CI가 운영 소스를 두드린다.
    """
    kinds = set(smoke_manifests.kinds)
    assert {"Ingress", "Middleware", "InfisicalSecret"}.isdisjoint(kinds)
    assert {
        document["metadata"]["name"]  # type: ignore[index]
        for document in smoke_manifests.of_kind("Deployment")
    } == {"postgres"}

    template = smoke_manifests.workflow_template("eatbid-dataplane")
    assert template["spec"]["hostAliases"] == [  # type: ignore[index]
        {"ip": "127.0.0.1", "hostnames": ["ns.eat.co.kr"]}
    ]

    dev_template = dev_manifests.workflow_template("eatbid-dataplane")
    assert _without_images(template) == _without_images(dev_template)

    crons = smoke_manifests.of_kind("CronWorkflow")
    assert crons and all(cron["spec"]["suspend"] is True for cron in crons)  # type: ignore[index]

    images = {
        container["image"]
        for document in smoke_manifests.of_kind("Job") + smoke_manifests.of_kind("WorkflowTemplate")
        for spec in _container_specs(document)
        for container in spec
    }
    assert not any(image.startswith("ghcr.io/") for image in images), images
    assert {"eatbid-dataplane:smoke", "eatbid-migration:smoke"} <= images


def _container_specs(document: dict[str, object]) -> list[list[dict[str, str]]]:
    if document["kind"] == "Job":
        return [document["spec"]["template"]["spec"]["containers"]]  # type: ignore[index]
    return [
        [template["container"]]
        for template in document["spec"]["templates"]  # type: ignore[index]
        if "container" in template
    ]


def _without_images(template: dict[str, object]) -> list[dict[str, object]]:
    """이미지 참조만 다르고 나머지 template 정의는 글자까지 같아야 한다."""
    stripped: list[dict[str, object]] = []
    for entry in template["spec"]["templates"]:  # type: ignore[index]
        copy = dict(entry)
        if "container" in copy:
            copy["container"] = {k: v for k, v in copy["container"].items() if k != "image"}  # type: ignore[union-attr]
        stripped.append(copy)
    return stripped
