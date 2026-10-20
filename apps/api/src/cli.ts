// CLI оператора (D-316): права админа данных. В проде — в контейнере api, DATABASE_URL уже в окружении:
//   docker compose -f compose.prod.yml exec api node dist/cli.js admin grant <логин>
// В разработке: pnpm --filter @primo/api exec tsx src/cli.ts admin list
import { runCli } from './admins';

const io = { out: (line: string) => console.log(line), err: (line: string) => console.error(line) };

void runCli(process.argv.slice(2), process.env, io).then((code) => {
  process.exitCode = code;
});
