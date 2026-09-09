from __future__ import annotations

from argparse import Namespace
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from eatbid.cli import exit_code_for_error
from eatbid.composition import Application
from eatbid.failures.categories import DATA_QUARANTINED, SOURCE_CONTRACT
from eatbid.failures.errors import PublicationFailedError
from eatbid.ingest.publication_repository import PublicationValidation

VALIDATED_AT = datetime(2026, 9, 10, 1, 0, 0, tzinfo=UTC)


class _봉인저장소:
    def __init__(self) -> None:
        self.sealed: list[tuple[UUID, UUID, datetime]] = []

    def reconcile_and_seal(
        self, source_release_id: UUID, run_id: UUID, *, sealed_at: datetime
    ) -> object:
        self.sealed.append((source_release_id, run_id, sealed_at))
        return object()


class _발행저장소:
    def __init__(self, status: str, failure_category: str | None) -> None:
        self.status = status
        self.failure_category = failure_category

    def validate_run(self, **kwargs: object) -> PublicationValidation:
        return PublicationValidation(
            publication_id=kwargs["publication_id"],  # type: ignore[arg-type]
            run_id=kwargs["run_id"],  # type: ignore[arg-type]
            status=self.status,
            expected_count=3,
            normalized_count=2 if self.status == "failed" else 3,
            member_ids=() if self.status == "failed" else (1, 2, 3),
            failure_category=self.failure_category,
        )


def _인수() -> Namespace:
    return Namespace(
        source_release_id=uuid4(),
        run_id=uuid4(),
        publication_id=uuid4(),
        validated_at=VALIDATED_AT,
    )


def _애플리케이션(publication: _발행저장소) -> tuple[Application, _봉인저장소]:
    release = _봉인저장소()
    application = Application(
        connection=object(),
        http_client=object(),
        release_repository=release,
        publication_repository=publication,
    )
    return application, release


@pytest.mark.parametrize(
    ("category", "exit_code"), [(DATA_QUARANTINED, 65), (SOURCE_CONTRACT, 76)]
)
def test_실패로_기록된_publication은_release를_봉인한_뒤_그_category로_종료한다(
    category: str, exit_code: int
) -> None:
    application, release = _애플리케이션(_발행저장소("failed", category))
    args = _인수()

    with pytest.raises(PublicationFailedError) as caught:
        application.validate(args)

    assert release.sealed == [(args.source_release_id, args.run_id, VALIDATED_AT)]
    assert caught.value.failure_category == category
    assert caught.value.publication_id == args.publication_id
    assert exit_code_for_error(caught.value) == exit_code


def test_검증을_통과한_publication은_validation을_그대로_돌려준다() -> None:
    application, _ = _애플리케이션(_발행저장소("validated", None))

    validation = application.validate(_인수())

    assert validation.status == "validated"
    assert validation.member_ids == (1, 2, 3)


def test_category_없는_실패_기록은_설정_오류로_드러난다() -> None:
    application, _ = _애플리케이션(_발행저장소("failed", None))

    with pytest.raises(RuntimeError, match="no failure category") as caught:
        application.validate(_인수())

    assert exit_code_for_error(caught.value) == 64
