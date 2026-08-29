FROM node:24-alpine AS build

WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --filter @eatbid/db...

COPY tsconfig.json ./
COPY packages/db packages/db
RUN pnpm --filter @eatbid/db build \
    && pnpm --filter @eatbid/db deploy --prod --legacy /runtime

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /runtime ./
COPY --from=build /workspace/packages/db/drizzle ./drizzle

RUN addgroup -S migration && adduser -S -G migration migration
USER migration

CMD ["node", "dist/migrate.js"]
