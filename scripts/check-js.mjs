import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const ignoredDirs = new Set(['.git', 'node_modules', 'output', 'test-results']);
const files = collectJavaScriptFiles(root);
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Checked ${files.length} JavaScript file(s).`);

function collectJavaScriptFiles(directory) {
  const entries = readdirSync(directory).sort();
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      if (!ignoredDirs.has(entry)) {
        files.push(...collectJavaScriptFiles(fullPath));
      }
      continue;
    }

    if (/\.(?:js|mjs|cjs)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}
