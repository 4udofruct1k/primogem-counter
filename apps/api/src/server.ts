import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = await buildApp(config);
await app.listen({ port: config.port, host: config.host });
console.log(`api: http://localhost:${config.port}`);
