import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Start Edge with about:blank so we can hook CDP before navigating
const tmpDir = 'C:\\Windows\\Temp\\edge-dbg-' + Date.now();
const edge = spawn(EDGE, [
  '--headless=new', '--no-sandbox', '--remote-debugging-port=9235',
  '--window-size=1280,800', '--user-data-dir=' + tmpDir,
  '--no-first-run', '--disable-sync', '--disable-extensions',
  'about:blank',
], { stdio: 'ignore' });

await sleep(3000);

const allTabs = await new Promise((res, rej) => {
  http.get('http://localhost:9235/json', r => {
    let b = ''; r.on('data', d => b += d);
    r.on('end', () => res(JSON.parse(b)));
  }).on('error', rej);
});

const tab = allTabs.find(t => t.type === 'page') || allTabs[0];
const ws = new WebSocket(tab.webSocketDebuggerUrl);

let msgId = 1;
const pending = new Map();
const errors = [];

ws.on('message', raw => {
  const m = JSON.parse(raw);
  if (m.id && pending.has(m.id)) { const { res } = pending.get(m.id); pending.delete(m.id); res(m.result); }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (m.params?.exceptionDetails?.exception?.description || JSON.stringify(m.params?.exceptionDetails)).substring(0, 300));
  }
  if (m.method === 'Log.entryAdded' && m.params?.entry?.level === 'error') {
    errors.push('LOG: ' + m.params.entry.text?.substring(0, 200));
  }
});

await new Promise(r => ws.on('open', r));
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = msgId++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params }));
});

// Enable error listeners BEFORE navigating
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');

// Now navigate to the app
await send('Page.navigate', { url: 'http://localhost:1420' });

// Wait for load
await new Promise(res => {
  const orig = ws.listeners('message')[0];
  ws.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.method === 'Page.loadEventFired') res();
  });
  setTimeout(res, 8000); // fallback
});

await sleep(3000); // extra time for React to render

const { result } = await send('Runtime.evaluate', { expression: `JSON.stringify({
  tauri: typeof window.__TAURI_INTERNALS__,
  rootLen: (document.getElementById('root')?.innerHTML || '').length,
  rootSnip: (document.getElementById('root')?.innerHTML || '').substring(0, 200),
  imgs: Array.from(document.querySelectorAll('img')).length
})` });

const state = JSON.parse(result.value);
state.errors = errors.slice(0, 10);
console.log(JSON.stringify(state, null, 2));

ws.close();
edge.kill();
