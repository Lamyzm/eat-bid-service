FROM node:24.20.0-alpine3.23@sha256:0388af2af070cd4736a1567cfed02469ba117848845b4165d87a333edb53d2ca AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter @eatbid/db...

COPY tsconfig.json ./
COPY packages/domain packages/domain
COPY packages/db packages/db
RUN pnpm --filter @eatbid/db build \
    && pnpm --filter @eatbid/db deploy --prod --legacy /runtime

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:774b7d020b24214835769e24c3544835526cd0288f0b094eae48e8b2c2429a79 AS runtime

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA
ENV BUILD_SHA=$GIT_SHA \
    NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=65532:65532 /runtime ./
COPY --from=build --chown=65532:65532 /workspace/packages/db/drizzle ./drizzle

USER 65532:65532

ENTRYPOINT ["/nodejs/bin/node"]
CMD ["dist/migrate.js"]
