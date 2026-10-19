# web (15.2): сборка PWA → статические файлы в томе webdist (одноразовый сервис).
FROM node:22-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm@10.28.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @primo/web...
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/web apps/web
COPY data data
RUN pnpm --filter @primo/web build

FROM alpine:3.22
COPY --from=build /repo/apps/web/dist /dist
# при запуске — заменить содержимое тома свежей сборкой и выйти
CMD ["sh", "-c", "rm -rf /out/* && cp -r /dist/. /out/ && echo \"web: $(ls /out | wc -l) файлов\""]
