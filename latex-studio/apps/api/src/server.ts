import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(
      `api listening on http://${config.host}:${config.port} (texlive mode: ${config.texliveMode})`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
