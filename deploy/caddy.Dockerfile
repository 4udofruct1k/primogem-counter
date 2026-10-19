# caddy (15.2–15.3): caddy:2-alpine с Caddyfile внутри образа — после `git pull` команда
# `docker compose -f compose.prod.yml up -d --build` пересоберёт образ и применит правки (D-1004).
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
