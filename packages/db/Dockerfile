FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter @eatbid/db...

COPY tsconfig.json ./
COPY packages/db packages/db
RUN pnpm --filter @eatbid/db build \
    && pnpm --filter @eatbid/db deploy --prod --legacy /runtime

FROM node:24-alpine@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS runtime

ARG GIT_SHA=unknown
LABEL org.opencontainers.image.revision=$GIT_SHA
ENV BUILD_SHA=$GIT_SHA \
    NODE_ENV=production
WORKDIR /app

COPY --from=build /runtime ./
COPY --from=build /workspace/packages/db/drizzle ./drizzle

RUN addgroup -S migration && adduser -S -G migration migration
USER migration

CMD ["node", "dist/migrate.js"]
