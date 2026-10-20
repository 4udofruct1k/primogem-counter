// Права админа данных (D-316): флаг users.is_admin ставит и снимает только оператор сервера — командой в контейнере
// api (`node dist/cli.js admin …`), у API такого пути нет. Флаг живёт в строке аккаунта: удаление аккаунта уносит
// его, а новый владелец того же логина прав не получает.
import { UsernameSchema } from '@primo/shared';
import { asc, eq } from 'drizzle-orm';
import { ConfigError, databaseUrlFrom } from './config';
import { openDatabase, type Database, type Db } from './db';
import { users } from './db/schema';
import { pgCode } from './errors';

export const USAGE = [
  'Использование: node dist/cli.js admin <команда>',
  '  admin grant <логин>   выдать права админа данных (аккаунт уже зарегистрирован на сайте)',
  '  admin revoke <логин>  снять права',
  '  admin list            список админов данных',
].join('\n');

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

type Command = { action: 'grant' | 'revoke'; username: string } | { action: 'list' };

export interface AdminAccount {
  id: string;
  username: string;
  createdAt: Date;
}

/** Итог `setAdmin`: аккаунт и поменялся ли флаг (false — уже был таким). */
export interface AdminChange extends AdminAccount {
  changed: boolean;
}

/** Ставит или снимает флаг по логину (без учёта регистра); нет аккаунта — null. */
export async function setAdmin(db: Db, username: string, isAdmin: boolean): Promise<AdminChange | null> {
  const [user] = await db
    .select({ id: users.id, username: users.username, createdAt: users.createdAt, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (!user) return null;
  const { isAdmin: was, ...account } = user;
  if (was === isAdmin) return { ...account, changed: false };
  // по id, а не по логину: аккаунт, удалённый и занятый заново между запросами, флаг не получит
  await db.update(users).set({ isAdmin, updatedAt: new Date() }).where(eq(users.id, user.id));
  return { ...account, changed: true };
}

export async function listAdmins(db: Db): Promise<AdminAccount[]> {
  return db
    .select({ id: users.id, username: users.username, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.isAdmin, true))
    .orderBy(asc(users.username));
}

/** Разбор аргументов: команда, 'help' или текст ошибки для stderr (код 2). */
function parseArgs(argv: readonly string[]): Command | 'help' | string {
  const [group, action, name, ...rest] = argv;
  if (group === 'help' || group === '--help' || group === '-h') return 'help';
  if (group === undefined) return USAGE;
  if (group !== 'admin') return `Неизвестная команда «${group}»\n${USAGE}`;
  if (action === 'list' && name === undefined) return { action };
  if ((action === 'grant' || action === 'revoke') && name !== undefined && rest.length === 0) {
    const parsed = UsernameSchema.safeParse(name);
    if (!parsed.success) return `Неверный логин «${name}»: ${parsed.error.issues[0]?.message ?? ''}`;
    return { action, username: parsed.data };
  }
  const what = action === undefined ? 'Не указана команда' : `Неверная команда «${argv.slice(1).join(' ')}»`;
  return `${what}\n${USAGE}`;
}

const describeAccount = (u: AdminAccount) => `id ${u.id}, зарегистрирован ${u.createdAt.toISOString()}`;

async function execute(db: Db, cmd: Command, io: CliIo): Promise<number> {
  if (cmd.action === 'list') {
    const admins = await listAdmins(db);
    if (admins.length === 0) io.out('Админов данных нет');
    for (const u of admins) io.out(`${u.username}\t${describeAccount(u)}`);
    return 0;
  }
  const grant = cmd.action === 'grant';
  const user = await setAdmin(db, cmd.username, grant);
  if (!user) {
    io.err(`Аккаунт «${cmd.username}» не найден: сначала зарегистрируйтесь на сайте под этим логином`);
    return 1;
  }
  if (grant) {
    io.out(
      user.changed
        ? `Права админа данных выданы: ${user.username} (${describeAccount(user)})`
        : `${user.username} уже админ данных (${describeAccount(user)})`,
    );
  } else {
    io.out(
      user.changed ? `Права админа данных сняты: ${user.username}` : `${user.username} и так не админ данных`,
    );
  }
  return 0;
}

function describeError(err: unknown): string {
  if (err instanceof ConfigError) return `Ошибка настройки: ${err.message}`;
  // 42703 — нет колонки, 42P01 — нет таблицы: база старше этой версии api
  const code = pgCode(err);
  if (code === '42703' || code === '42P01')
    return 'В базе нет users.is_admin: запустите api этой версии — миграции применяются при его старте';
  const cause = err instanceof Error && err.cause instanceof Error ? ` (${err.cause.message})` : '';
  return `Ошибка: ${err instanceof Error ? err.message : String(err)}${cause}`;
}

/** Команда целиком: аргументы → подключение по DATABASE_URL → код выхода (0 — успех, 1 — ошибка, 2 — вызов). */
export async function runCli(argv: readonly string[], env: NodeJS.ProcessEnv, io: CliIo): Promise<number> {
  const cmd = parseArgs(argv);
  if (cmd === 'help') {
    io.out(USAGE);
    return 0;
  }
  if (typeof cmd === 'string') {
    io.err(cmd);
    return 2;
  }
  let database: Database | undefined;
  try {
    database = await openDatabase(databaseUrlFrom(env), { onError: (err) => io.err(describeError(err)) });
    return await execute(database.db, cmd, io);
  } catch (err) {
    io.err(describeError(err));
    return 1;
  } finally {
    await database?.close();
  }
}
