import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createMaeRouter } from './src/mae/routes.js';
import { createDefaultMaeRuntime } from './src/mae/runtime.js';
import { createApiRouter } from './src/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8787);
const maeRuntime = createDefaultMaeRuntime({ dataDir: path.join(__dirname, 'data', 'mae') });

app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', createApiRouter());
app.use('/api/mae', createMaeRouter({ runtime: maeRuntime }));

const server = app.listen(port, () => {
  console.log(`Memory & Autonomy Engine running at http://localhost:${port}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; closing MAE storage.`);
  maeRuntime.close();
  server.close(() => process.exit(0));
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
