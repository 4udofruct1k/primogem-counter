# backup (15.5): postgres:16-alpine + cron; backup.sh внутри образа, чтобы его правки применялись
# той же командой обновления (D-1004). Вручную: docker compose -f compose.prod.yml exec backup backup.sh
FROM postgres:16-alpine
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod 755 /usr/local/bin/backup.sh \
  && echo "30 4 * * * /usr/local/bin/backup.sh" > /etc/crontabs/root
ENTRYPOINT ["crond", "-f", "-l", "8"]
