import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// Test the compiled server without making Firebase or email requests.
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));

const child = spawn(process.execPath, ['server.js'], {
  cwd: new URL('../', import.meta.url),
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: ['ignore', 'ignore', 'pipe']
});
let stderr = '';
let launchError;
child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => { stderr += chunk; });
child.on('error', error => { launchError = error; });
const exited = new Promise(resolve => child.once('close', resolve));
const baseUrl = `http://127.0.0.1:${port}`;

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    if (child.exitCode !== null) throw new Error(`Server exited: ${stderr}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'ok');
      ready = true;
      break;
    } catch {
      await delay(100);
    }
  }
  assert.ok(ready, `Production server did not become ready: ${stderr}`);
  for (const route of ['/', '/check-in/smoke-test']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /<div id="root"><\/div>/);
  }
  console.log('Production smoke test passed: health endpoint and SPA routes.');
} finally {
  child.kill();
  await exited;
}
