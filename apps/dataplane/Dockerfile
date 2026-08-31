FROM ghcr.io/astral-sh/uv:python3.12-alpine@sha256:e2156509b8592cb4a74d73ba068fd45c95ec571333effc819f3ac25101147fb1 AS build

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable

FROM python:3.12-alpine3.23@sha256:31a768b01976652c222e318fe5bd6e7c252f056cbf489c88fa256f1bf0af58e3 AS runtime

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA
ENV BUILD_SHA=$GIT_SHA \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

RUN apk upgrade --no-cache \
    && addgroup -S -g 1001 eatbid \
    && adduser -S -D -H -u 1001 -G eatbid eatbid
COPY --from=build --chown=eatbid:eatbid /app/.venv ./.venv

USER eatbid
ENTRYPOINT ["eatbid"]
