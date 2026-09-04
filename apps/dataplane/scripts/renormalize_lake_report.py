"""모듈 책임: 레이크 전수 재정규화를 실행 단위로 묶는다 — 대상 선택, 프로세스 풀 분배, 중간 결과
저장과 이어 돌기, 그리고 Markdown/JSON 증거 쓰기.

관측은 `lake_report.observe`, 집계는 `lake_report.aggregate`, 표는 `lake_report.render`가 소유한다.
여기는 그 셋을 한 번의 실행으로 잇고 실행 자체의 사실(코호트·표본 수·레이크 스냅샷)을 붙인다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from collections.abc import Iterator, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict, fields
from datetime import UTC, datetime
from pathlib import Path

from lake_report.aggregate import LakeReport, aggregate
from lake_report.observe import (
    CONTRACT_SCHEMA,
    PARSER_VERSION,
    FileObservation,
    RoundSummary,
    lake_files,
    locate,
    observe_file,
)
from lake_report.render import existing_conclusion, render_markdown
from lake_report.rounds import RoundsReport, compare_rounds, summarize_rounds

_PROGRESS_STEP = 10_000
_CHUNK_SIZE = 64
# 조사 파일이 담은 회차의 구매기관이다. 기본값을 두는 이유는 이 값이 조사 파일의 성질이지 실행
# 옵션의 성질이 아니기 때문이며, 다른 기관의 조사 파일을 쓸 때만 바꾼다.
_ROUNDS_ORGANIZATION_CODE = "153045"

__all__ = [
    "LakeReport",
    "RoundSummary",
    "RoundsReport",
    "build_report",
    "main",
    "summarize_rounds",
]


def build_report(
    lake: Path,
    *,
    calc_version: str,
    external_bid_ids: Sequence[str] | None = None,
    limit: int | None = None,
    organization_code: str | None = None,
    workers: int = 1,
    state: Path | None = None,
    rounds_source: Path | None = None,
    rounds_organization_code: str = _ROUNDS_ORGANIZATION_CODE,
) -> LakeReport:
    """대상을 고르고 관측한 뒤 집계한다. 원본은 읽기만 한다.

    `state`를 주면 관측 하나마다 JSONL 한 줄을 덧붙이고 다시 부를 때 그 줄들을 그대로 재사용한다.
    23만 파일 실행이 중간에 끊겨도 처음부터 다시 파싱하지 않게 하려는 것이다.
    """
    paths, cohort = _targets(lake, external_bid_ids=external_bid_ids, limit=limit)
    # 레이크 전체를 훑은 실행에서만 파일 수와 최신 mtime을 낸다. 좁힌 실행에서 이 둘을 위해 23만
    # 번을 다시 stat하면 12건짜리 대조가 분 단위로 늘어난다.
    scanned_every_file = external_bid_ids is None and limit is None
    observations = _collect(paths, workers=workers, state=state)
    excluded_unknown_organization = 0
    if organization_code is not None:
        # 파싱 단계에서 격리된 관측은 기관 코드를 갖지 못한다. 그것을 조용히 버리면 좁힌 실행이
        # 언제나 격리 0건을 보고하게 되므로 뺀 수를 세어 리포트에 남긴다.
        excluded_unknown_organization = sum(
            1 for item in observations if item.organization_code is None
        )
        observations = [
            item
            for item in observations
            if item.organization_code == organization_code
        ]
        cohort = f"{cohort} 중 구매기관 {organization_code}"
    return aggregate(
        observations,
        calc_version=calc_version,
        lake_path=str(lake),
        lake_file_count=len(paths) if scanned_every_file else None,
        lake_latest_mtime=_latest_mtime(paths) if scanned_every_file else None,
        cohort=cohort,
        excluded_unknown_organization=excluded_unknown_organization,
        rounds=(
            compare_rounds(
                lake,
                source=rounds_source,
                organization_code=rounds_organization_code,
                observations=observations,
            )
            if rounds_source is not None
            else None
        ),
    )


def _latest_mtime(paths: Sequence[Path]) -> str | None:
    latest = max((path.stat().st_mtime for path in paths), default=None)
    if latest is None:
        return None
    return datetime.fromtimestamp(latest, UTC).isoformat(timespec="seconds")


def _targets(
    lake: Path, *, external_bid_ids: Sequence[str] | None, limit: int | None
) -> tuple[list[Path], str]:
    if external_bid_ids is not None:
        found = [
            path
            for path in (locate(lake, item) for item in external_bid_ids)
            if path is not None
        ]
        return found, f"지정한 공고 {len(external_bid_ids)}건"
    paths = lake_files(lake)
    if limit is not None:
        return paths[:limit], f"레이크 앞에서 {limit}건 표본"
    return paths, "레이크 전수"


def state_header() -> dict[str, object]:
    """이어 돌기 상태가 어떤 실행에서 나왔는지를 적는 표식.

    파서와 계약을 고친 직후가 정확히 위험 구간이다. 표식이 없으면 옛 상한으로 격리된 줄이 새
    계산 버전 라벨을 달고 문서에 실린다. 필드 목록까지 담는 이유는 `FileObservation`이 바뀌면
    옛 줄이 `TypeError`로 죽는 대신 여기서 먼저 걸리게 하려는 것이다.
    """
    return {
        "parser_version": PARSER_VERSION,
        "schema_sha256": hashlib.sha256(CONTRACT_SCHEMA.read_bytes()).hexdigest(),
        "observation_fields": [field.name for field in fields(FileObservation)],
    }


def _collect(
    paths: Sequence[Path], *, workers: int, state: Path | None
) -> list[FileObservation]:
    done = _load_state(state)
    observations: list[FileObservation] = []
    handle = None
    if state is not None:
        fresh = not state.is_file() or state.stat().st_size == 0
        handle = state.open("a", encoding="utf-8")
        if fresh:
            handle.write(
                json.dumps({"header": state_header()}, ensure_ascii=False) + "\n"
            )
    try:
        for observation in _iter_observations(paths, workers=workers, done=done):
            observations.append(observation)
            if handle is not None and observation.external_bid_id not in done:
                handle.write(json.dumps(asdict(observation), ensure_ascii=False) + "\n")
                if len(observations) % _PROGRESS_STEP == 0:
                    handle.flush()
    finally:
        if handle is not None:
            handle.close()
    return observations


def _iter_observations(
    paths: Sequence[Path], *, workers: int, done: Mapping[str, FileObservation]
) -> Iterator[FileObservation]:
    pending = [path for path in paths if path.name.split(".", 1)[0] not in done]
    yield from done.values()
    if workers <= 1:
        for index, path in enumerate(pending, start=1):
            _progress(index, len(pending))
            yield observe_file(str(path))
        return
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = pool.map(
            observe_file, [str(path) for path in pending], chunksize=_CHUNK_SIZE
        )
        for index, observation in enumerate(results, start=1):
            _progress(index, len(pending))
            yield observation


def _progress(index: int, total: int) -> None:
    if index % _PROGRESS_STEP == 0 or index == total:
        print(f"[renormalize] {index}/{total}", file=sys.stderr, flush=True)


def _load_state(state: Path | None) -> dict[str, FileObservation]:
    if state is None or not state.is_file():
        return {}
    lines = [line for line in state.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not lines:
        return {}
    _require_state_header(state, lines[0])
    done: dict[str, FileObservation] = {}
    for line in lines[1:]:
        payload = json.loads(line)
        payload["bid_status_counts"] = tuple(
            (code, count) for code, count in payload["bid_status_counts"]
        )
        observation = FileObservation(**payload)
        done[observation.external_bid_id] = observation
    return done


def _require_state_header(state: Path, first_line: str) -> None:
    """표식이 다르면 조용히 무시하거나 지우지 않고 멈춘다. 무엇이 달랐는지는 사람이 판단한다."""
    try:
        header = json.loads(first_line).get("header")
    except json.JSONDecodeError:
        header = None
    if not isinstance(header, dict):
        raise SystemExit(
            f"[renormalize] 이어 돌기 상태에 표식이 없다: {state} — 새 상태 파일로 다시 돌려라"
        )
    expected = state_header()
    differences = [
        f"{key}: 상태={header.get(key)!r} 지금={value!r}"
        for key, value in expected.items()
        if header.get(key) != value
    ]
    if differences:
        raise SystemExit(
            f"[renormalize] 이어 돌기 상태가 지금 실행과 다르다: {state}\n"
            + "\n".join(differences)
        )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="eat-v2 전수 재정규화 리포트")
    parser.add_argument("--lake", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--json", type=Path, default=None)
    parser.add_argument("--calc-version", required=True)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--organization-code", default=None)
    parser.add_argument(
        "--rounds",
        type=Path,
        default=None,
        dest="rounds_source",
        help="회차 조사 JSON 경로. 주면 조사값과 관측을 대조한 절을 리포트에 더한다",
    )
    parser.add_argument(
        "--rounds-organization-code",
        default=_ROUNDS_ORGANIZATION_CODE,
        help="조사 파일이 담은 회차의 구매기관 코드",
    )
    parser.add_argument(
        "--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1)
    )
    parser.add_argument("--resume", type=Path, default=None, dest="state")
    arguments = parser.parse_args(argv)
    report = build_report(
        arguments.lake,
        calc_version=arguments.calc_version,
        limit=arguments.limit,
        organization_code=arguments.organization_code,
        workers=arguments.workers,
        state=arguments.state,
        rounds_source=arguments.rounds_source,
        rounds_organization_code=arguments.rounds_organization_code,
    )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        render_markdown(report) + existing_conclusion(arguments.output),
        encoding="utf-8",
    )
    if arguments.json is not None:
        arguments.json.parent.mkdir(parents=True, exist_ok=True)
        arguments.json.write_text(
            json.dumps(asdict(report), ensure_ascii=False, indent=1), encoding="utf-8"
        )
    print(
        f"[renormalize] normalized={report.normalized} quarantined={report.quarantined}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
