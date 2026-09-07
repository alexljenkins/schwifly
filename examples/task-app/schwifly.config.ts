import { defineConfig, defineProof } from 'schwifly';

export default defineConfig({
  proofs: {
    'tasks.created': defineProof<{ title: string }>({
      parse(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
            Object.keys(input).length !== 1 || typeof (input as { title?: unknown }).title !== 'string') {
          throw new Error('with needs exactly one string title');
        }
        return input as { title: string };
      },
      describe: ({ title }) => `the task list contains a new task named ${title}`,
      async arm({ page }, { title }) {
        const read = async (): Promise<string[]> => (await page.request.get(new URL('/api/items', page.url()).href)).json();
        const before = (await read()).filter(item => item === title).length;
        return { async check() {
          const matched = (await read()).filter(item => item === title).length === before + 1;
          return { matched, message: matched ? 'one new task exists' : 'no new task exists' };
        } };
      },
    }),
  },
});
