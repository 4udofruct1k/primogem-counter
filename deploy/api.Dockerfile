# api (15.2): Node 22 + Fastify; при старте применяет миграции drizzle.
FROM node:22-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm@10.28.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/domain/package.json packages/domain/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @primo/api...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @primo/api build \
  && pnpm --filter @primo/api deploy --legacy --prod /prod/api \
  && cp -r apps/api/dist apps/api/drizzle /prod/api/

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /prod/api ./
COPY data ./data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/server.js"]
