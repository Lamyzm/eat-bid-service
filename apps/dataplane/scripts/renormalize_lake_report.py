"""모듈 책임: 레이크 전수 재정규화를 실행 단위로 묶는다 — 대상 선택, 프로세스 풀 분배, 중간 결과
저장과 이어 돌기, 그리고 Markdown/JSON 증거 쓰기.

관측은 `lake_report.observe`, 집계는 `lake_report.aggregate`, 표는 `lake_report.render`가 소유한다.
여기는 그 셋을 한 번의 실행으로 잇고 실행 자체의 사실(코호트·표본 수·레이크 스냅샷)을 붙인다.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterator, Mapping, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

from lake_report.aggregate import LakeReport, aggregate
from lake_report.observe import (
    FileObservation,
    RoundSummary,
    lake_files,
    locate,
    observe_file,
    summarize_rounds,
)
from lake_report.render import existing_conclusion, render_markdown

_PROGRESS_STEP = 10_000
_CHUNK_SIZE = 64

__all__ = ["build_report", "summarize_rounds", "LakeReport", "RoundSummary", "main"]


def build_report(
    lake: Path,
    *,
    calc_version: str,
    external_bid_ids: Sequence[str] | None = None,
    limit: int | None = None,
    organization_code: str | None = None,
    workers: int = 1,
    state: Path | None = None,
) -> LakeReport:
    """대상을 고르고 관측한 뒤 집계한다. 원본은 읽기만 한다.

    `state`를 주면 관측 하나마다 JSONL 한 줄을 덧붙이고 다시 부를 때 그 줄들을 그대로 재사용한다.
    23만 파일 실행이 중간에 끊겨도 처음부터 다시 파싱하지 않게 하려는 것이다.
    """
    paths, cohort = _targets(lake, external_bid_ids=external_bid_ids, limit=limit)
    every = (
        lake_files(lake) if external_bid_ids is not None or limit is not None else paths
    )
    latest = max((path.stat().st_mtime for path in every), default=None)
    observations = _collect(paths, workers=workers, state=state)
    if organization_code is not None:
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
        lake_file_count=len(every),
        lake_latest_mtime=(
            datetime.fromtimestamp(latest, UTC).isoformat(timespec="seconds")
            if latest is not None
            else None
        ),
        cohort=cohort,
    )


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


def _collect(
    paths: Sequence[Path], *, workers: int, state: Path | None
) -> list[FileObservation]:
    done = _load_state(state)
    observations: list[FileObservation] = []
    handle = state.open("a", encoding="utf-8") if state is not None else None
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
    done: dict[str, FileObservation] = {}
    for line in state.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        payload["bid_status_counts"] = tuple(
            (code, count) for code, count in payload["bid_status_counts"]
        )
        observation = FileObservation(**payload)
        done[observation.external_bid_id] = observation
    return done


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="eat-v2 전수 재정규화 리포트")
    parser.add_argument("--lake", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--json", type=Path, default=None)
    parser.add_argument("--calc-version", required=True)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--organization-code", default=None)
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
