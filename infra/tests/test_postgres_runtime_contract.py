"""운영 postgres 컨테이너가 병렬 작업에 필요한 공유 메모리를 갖는지 렌더된 매니페스트에서 확인한다(EAT-304)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from conftest import ManifestSet


def _mapping(value: object) -> Mapping[str, object]:
    assert isinstance(value, Mapping)
    return value


def _sequence(value: object) -> Sequence[object]:
    assert isinstance(value, Sequence) and not isinstance(value, str)
    return value


def test_postgres는_dev_shm을_메모리_매체로_1Gi까지_쓴다(manifests: ManifestSet) -> None:
    """왜: 컨테이너 기본 /dev/shm 64MB에서는 병렬 VACUUM과 병렬 조회의 동적 공유 메모리가 모자라
    2026-10-07 VACUUM이 `could not resize shared memory segment`로 실패했다."""
    pod = _mapping(_mapping(manifests.named("Deployment", "postgres")["spec"])["template"])
    spec = _mapping(pod["spec"])
    volumes = {
        str(_mapping(volume)["name"]): _mapping(volume) for volume in _sequence(spec["volumes"])
    }
    assert _mapping(volumes["dshm"]["emptyDir"]) == {"medium": "Memory", "sizeLimit": "1Gi"}
    (container,) = (
        _mapping(item)
        for item in _sequence(spec["containers"])
        if _mapping(item)["name"] == "postgres"
    )
    mounts = {
        str(_mapping(mount)["mountPath"]): str(_mapping(mount)["name"])
        for mount in _sequence(container["volumeMounts"])
    }
    assert mounts["/dev/shm"] == "dshm"
    assert mounts["/var/lib/postgresql/data"] == "pgdata"
