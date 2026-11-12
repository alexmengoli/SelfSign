import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(
  process.argv.includes('--dev') ? { ...process.env, PORT: process.env['PORT'] || '9000' } : process.env,
);
const app = await buildApp({ dataDir: config.dataDir, webRoot: config.webRoot, logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: '0.0.0.0', port: config.port });
  app.log.info(`Data directory: ${config.dataDir}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
