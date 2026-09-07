import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
let items = [];
const server = createServer(async (request, response) => {
  const auth = process.env.SCHWIFLY_DEMO_AUTH === '1';
  const loggedIn = request.headers.cookie?.split('; ').includes('demo_session=example-session-cookie');
  if (request.url === '/login' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += chunk;
    if (!process.env.APP_PASSWORD || JSON.parse(body).password !== process.env.APP_PASSWORD) {
      response.writeHead(401).end('login failed');
      return;
    }
    response.setHeader('set-cookie', 'demo_session=example-session-cookie; HttpOnly; SameSite=Lax; Path=/');
    response.end('logged in');
    return;
  }
  if (request.url === '/api/session') {
    response.writeHead(!auth || loggedIn ? 200 : 401).end('session check');
    return;
  }
  if (auth && !loggedIn) {
    response.writeHead(401).end('Login required');
    return;
  }
  const state = process.env.SCHWIFLY_DEMO_STATE;
  const version = state && existsSync(state) ? readFileSync(state, 'utf8').trim() : 'A';
  if (request.url === '/reset' && request.method === 'POST') {
    items = [];
    response.end('reset');
    return;
  }
  if (request.url === '/api/items') {
    if (request.method === 'POST') {
      let body = '';
      for await (const chunk of request) body += chunk;
      if (version !== 'regression') items.push(JSON.parse(body).title);
    }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(items));
    return;
  }
  const quick = version === 'B' || version === 'regression';
  const repair = version === 'repair';
  response.setHeader('content-type', 'text/html');
  response.end(`<!doctype html><html><body><h1>Tasks</h1>
    ${quick ? '<label>Quick add <input id="quick-add"></label><button id="add">Add</button>' :
      `<button id="${repair ? 'create' : 'new'}">New item</button><section hidden id="form"><label>Title <input id="title"></label><button id="save">Save</button></section>`}
    <ul id="items"></ul><script>
    const render = values => { document.querySelector('#items').replaceChildren(...values.map(value => {
      const li = document.createElement('li'); li.textContent = value; return li;
    })); };
    document.querySelector('#new, #create')?.addEventListener('click', () => document.querySelector('#form').hidden = false);
    document.querySelector('#save, #add').addEventListener('click', async () => {
      const title = document.querySelector('input').value;
      const response = await fetch('/api/items', {method: 'POST', headers: {'content-type':'application/json'}, body:JSON.stringify({title})});
      render(await response.json());
    });
    fetch('/api/items').then(r=>r.json()).then(render);
    </script></body></html>`);
});
server.listen(Number(process.env.PORT ?? 4173), '127.0.0.1', () => console.log(server.address().port));
