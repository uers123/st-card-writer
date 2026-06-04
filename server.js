import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApiRouter } from './src/routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 8787);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', createApiRouter());

app.listen(port, () => {
  console.log(`SillyTavern card writer running at http://localhost:${port}`);
});
