// One-shot screenshot via Edge headless + CDP
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import http from 'http';
import { WebSocket } from 'ws';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL  = 'http://localhost:1420';
const OUT  = process.argv[2] || 'screenshot.png';
const W    = parseInt(process.argv[3] || '1280');
const H    = parseInt(process.argv[4] || '800');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getCdpWsUrl() {
  return new Promise((res, rej) => {
    const req = http.get('http://localhost:9234/json', resp => {
      let body = '';
      resp.on('data', d => body += d);
      resp.on('end', () => {
        try {
          const tabs = JSON.parse(body);
          // Find the tab that is actually localhost:1420, not an extension page
          const tab = tabs.find(t => t.type === 'page' && t.url && t.url.startsWith('http://localhost:1420'))
                   || tabs.find(t => t.type === 'page')
                   || tabs[0];
          res(tab.webSocketDebuggerUrl);
        } catch(e) { rej(e); }
      });
    });
    req.on('error', rej);
  });
}

async function main() {
  const tmpDir = `C:\\Windows\\Temp\\edge-cdp-${Date.now()}`;
  const edge = spawn(EDGE, [
    '--headless=new', '--no-sandbox',
    '--remote-debugging-port=9234',
    `--window-size=${W},${H}`,
    `--user-data-dir=${tmpDir}`,
    '--hide-scrollbars',
    '--disable-gpu',
    '--no-first-run',
    '--disable-sync',
    '--disable-extensions',
    '--no-default-browser-check',
    '--disable-background-networking',
    URL,
  ], { stdio: 'ignore' });

  await sleep(3000); // let Edge start and page load + Unsplash images

  let wsUrl;
  for (let i = 0; i < 10; i++) {
    try { wsUrl = await getCdpWsUrl(); break; }
    catch { await sleep(500); }
  }
  if (!wsUrl) throw new Error('CDP not available');

  const ws = new WebSocket(wsUrl);
  let msgId = 1;
  const pending = new Map();

  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    }
  });

  await new Promise(r => ws.on('open', r));

  function send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = msgId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('Emulation.setDeviceMetricsOverride', {
    width: W, height: H, deviceScaleFactor: 2, mobile: false,
  });

  await sleep(2000); // wait for images after setting viewport

  // Capture multiple frames if OUT contains {n} placeholder
  const isMulti = OUT.includes('{n}');
  const count = isMulti ? 8 : 1;

  for (let i = 0; i < count; i++) {
    const outPath = isMulti ? OUT.replace('{n}', String(i + 1).padStart(2, '0')) : OUT;
    const { data } = await send('Page.captureScreenshot', { format: 'png', quality: 100, captureBeyondViewport: false });
    writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log('Saved:', outPath);
    if (i < count - 1) await sleep(4500); // wait for carousel to advance (interval = 4s)
  }

  ws.close();
  edge.kill();
}

main().catch(e => { console.error(e); process.exit(1); });
