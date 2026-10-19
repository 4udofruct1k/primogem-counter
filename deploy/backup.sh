#!/bin/sh
# Ежедневный дамп БД (15.5): pg_dump -Fc → /backups/primo-YYYY-MM-DD.dump, старше 14 дней удаляются.
# Запускается cron'ом сервиса backup в 04:30 по UTC+5; вручную:
#   docker compose -f compose.prod.yml exec backup backup.sh
set -eu
# в дампе хэши паролей: читать может только владелец — тот же, что у папки deploy/backups на хосте
umask 077
DIR=/backups
FILE="$DIR/primo-$(date +%F).dump"
mkdir -p "$DIR"
pg_dump -Fc -f "$FILE.tmp"
chown "$(stat -c '%u:%g' "$DIR")" "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
find "$DIR" -name 'primo-*.dump' -mtime +13 -delete
echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"
