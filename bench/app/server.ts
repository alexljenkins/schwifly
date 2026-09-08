import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

// The benchmark app. One server, one URL, and a variant file the harness rewrites between
// scenarios, so a route saved against `baseline` replays against a seeded defect without its
// baked-in URL changing.
//
// Every variant keeps the same happy path: click "New item", type a title, click "Save".
// Only the seeded defect differs, so a failure names the defect and not a redesign.

const VARIANTS = ['baseline', 'moved-control', 'broken-persistence', 'duplicate-submit', 'slow-update'] as const;
type Variant = (typeof VARIANTS)[number];

const stateFile = process.argv[2];
if (!stateFile) throw new Error('the benchmark app needs a variant file');

let items: string[] = [];

function variant(): Variant {
  const value = readFileSync(stateFile, 'utf8').trim();
  if (!VARIANTS.includes(value as Variant)) throw new Error(`unknown variant ${value}`);
  return value as Variant;
}

function page(current: Variant): string {
  // 'moved-control' renames the opener and its label, and changes nothing else. An id-based
  // and a role-and-name-based locator both break, so a repair must find the control again.
  const opener = current === 'moved-control' ? 'create' : 'new';
  const openerLabel = current === 'moved-control' ? 'Add task' : 'New item';
  // 'slow-update' delays the render, never the write, so only a premature check fails.
  const delay = current === 'slow-update' ? 1200 : 0;
  return `<!doctype html><html><body><h1>Tasks</h1>
<button id="${opener}">${openerLabel}</button>
<section id="form" hidden><label>Title <input id="title"></label><button id="save">Save</button></section>
<p id="status"></p>
<ul id="items"></ul>
<script>
const render = values => document.querySelector('#items').replaceChildren(...values.map(value => {
  const item = document.createElement('li'); item.textContent = value; return item;
}));
document.querySelector('#${opener}').addEventListener('click', () => document.querySelector('#form').hidden = false);
document.querySelector('#save').addEventListener('click', async () => {
  const title = document.querySelector('#title').value;
  const response = await fetch('/api/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  const values = await response.json();
  document.querySelector('#status').textContent = 'Saved';
  setTimeout(() => render(values), ${delay});
});
fetch('/api/items').then(response => response.json()).then(render);
</script></body></html>`;
}

const server = createServer(async (request, response) => {
  const current = variant();
  if (request.url === '/reset' && request.method === 'POST') {
    items = [];
    response.end('reset');
    return;
  }
  if (request.url === '/api/items') {
    if (request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const { title } = JSON.parse(body) as { title: string };
      // 'broken-persistence' still answers 200 and still shows "Saved". Only the stored data
      // is missing, which is exactly the failure a success-message check would miss.
      if (current === 'duplicate-submit') items.push(title, title);
      else if (current !== 'broken-persistence') items.push(title);
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(items));
    return;
  }
  response.setHeader('content-type', 'text/html');
  response.end(page(current));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('the benchmark app has no port');
  process.stdout.write(`${address.port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
