"""모듈 책임: 감시가 R2에 대고 하는 두 가지 접근 — 회차 상태 문서 읽고 쓰기와 백업 객체 목록 읽기를 소유한다.

왜 한 모듈인가: 둘 다 같은 endpoint·자격·버킷 설정을 쓰고 그 모양이 바뀌면 함께 바뀐다. 나누면 같은
자격을 두 곳에서 조립하게 된다.

왜 raw store를 쓰지 않는가: R2의 raw 객체는 불변 증거다(AGENTS.md 1항). 감시 상태는 매 회차 덮어쓰는
가변 값이라 성질이 다르다. 같은 버킷을 쓰되 `monitoring/` 접두사로 나누고 경로도 코드도 섞지 않는다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import boto3
from botocore.exceptions import ClientError

from .backup import BackupObject


class R2StateStore:
    """감시 상태 JSON 하나를 담는 자리. 없으면 없는 대로 시작한다."""

    def __init__(
        self,
        *,
        endpoint_url: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        key: str,
    ) -> None:
        self._bucket = bucket
        self._key = key
        self._client: Any = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

    def read(self) -> Mapping[str, Any] | None:
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=self._key)
        except ClientError as error:
            # 첫 실행에는 객체가 없다. 그것은 오류가 아니라 열린 위반이 없다는 뜻이다.
            if error.response.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
                return None
            raise
        document = json.loads(response["Body"].read().decode("utf-8"))
        return document if isinstance(document, Mapping) else None

    def write(self, document: Mapping[str, Any]) -> None:
        self._client.put_object(
            Bucket=self._bucket,
            Key=self._key,
            Body=json.dumps(document, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json; charset=utf-8",
        )


class R2BackupLister:
    """백업 접두사 아래의 객체를 나열한다.

    본문을 받지 않는 이유는 판정에 필요한 것이 가장 최근 하나의 시각과 크기뿐이기 때문이다. 덤프는
    GiB 단위라 본문을 받으면 감시가 백업만큼 무거워진다.
    """

    def __init__(
        self,
        *,
        endpoint_url: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
    ) -> None:
        self._bucket = bucket
        self._client: Any = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

    def list(self, prefix: str) -> list[BackupObject]:
        objects: list[BackupObject] = []
        token: str | None = None
        while True:
            arguments: dict[str, Any] = {"Bucket": self._bucket, "Prefix": prefix}
            if token is not None:
                arguments["ContinuationToken"] = token
            response = self._client.list_objects_v2(**arguments)
            for item in response.get("Contents", ()):
                modified = item.get("LastModified")
                if not isinstance(modified, datetime):
                    continue
                objects.append(
                    BackupObject(
                        key=str(item.get("Key") or ""),
                        last_modified=(
                            modified
                            if modified.tzinfo is not None
                            else modified.replace(tzinfo=UTC)
                        ),
                        size_bytes=int(item.get("Size") or 0),
                    )
                )
            if not response.get("IsTruncated"):
                return objects
            token = response.get("NextContinuationToken")
            if token is None:
                return objects
