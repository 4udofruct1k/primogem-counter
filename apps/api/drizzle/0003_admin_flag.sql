-- Флаг админа данных (D-316): ставит и снимает только оператор — `node dist/cli.js admin grant|revoke <логин>`.
-- По умолчанию false у всех: прежний ADMIN_USERNAMES не переносится, права выдаются той же командой.
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;
