"""모듈 책임: 감시가 회차 사이에 기억해야 할 작은 상태 하나를 R2의 가변 객체로 읽고 쓴다.

왜 raw store를 쓰지 않는가: R2의 raw 객체는 불변 증거다(AGENTS.md 1항). 감시 상태는 매 회차 덮어쓰는
가변 값이라 성질이 다르다. 같은 버킷을 쓰되 `monitoring/` 접두사로 나누고 경로도 코드도 섞지 않는다.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

import boto3
from botocore.exceptions import ClientError


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
