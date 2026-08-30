import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const stateFile = process.argv[2];
if (!stateFile) throw new Error('taskAppServer needs a state file');

function page(version: 'A' | 'B'): string {
  const controls = version === 'A'
    ? `<button id="new">New item</button>
       <section id="editor" hidden><input id="title"><button id="save">Save</button></section>`
    : `<input id="quick-add" aria-label="Quick add"><button id="add">Add</button>`;
  const script = version === 'A'
    ? `document.querySelector('#new').onclick = () => document.querySelector('#editor').hidden = false;
       document.querySelector('#save').onclick = () => add(document.querySelector('#title').value);`
    : `document.querySelector('#add').onclick = () => add(document.querySelector('#quick-add').value);`;
  return `<!doctype html><html><body>${controls}<ul id="items"></ul><script>
    window.__taskState = { items: [] };
    function add(title) {
      window.__taskState.items.push(title);
      const item = document.createElement('li');
      item.textContent = title;
      document.querySelector('#items').appendChild(item);
    }
    ${script}
  </script></body></html>`;
}

const server = createServer((_request, response) => {
  const version = readFileSync(stateFile, 'utf8').trim() === 'B' ? 'B' : 'A';
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(page(version));
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server has no port');
  process.stdout.write(`${address.port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
