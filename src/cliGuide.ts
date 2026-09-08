export const description = 'Run browser tests from instructions, inspect evidence, and save certified workflows.';
export const guidance = [
  'schwifly run "<instruction> <expect>expected visible text</expect>" --url <url>',
  'schwifly run --instruction-file <instructions.md> --url <url> --screenshots',
  'schwifly show <id>',
  'schwifly save <id> --name <name>',
  'schwifly run workflows/<name>.spec.ts',
  'schwifly session start --url <url>',
  'schwifly session ask <session-id> "Click Go. <expect>Done</expect>" --element button',
  'schwifly session ask <session-id> "Try the button again"',
  'schwifly session baseline <session-id>',
  'schwifly session compare <session-id>',
  'schwifly session save <session-id> --name <name>',
];
export const rules = [
  'One-off runs keep evidence without saving a workflow. Add `--save <name>` to save after certification.',
  'Certification checks the outcome in a fresh browser with model healing disabled. A model claim is not proof.',
  'Instructions may be brief or detailed. State the expected visible text with `<expect>text</expect>` when possible.',
  'Screenshots mask form values, known secret text, and data-private regions. Inspect image files with an image tool.',
  'Instruction runs start in the background. Use the returned status/show commands and log path. --foreground waits.',
  'Use session start, then session ask for a persistent tester. session reset wipes its context. session stop closes it.',
  'session baseline marks the last check. session compare repeats it. session save certifies it in a fresh browser.',
  'Standalone runs start a fresh session. Configure app reset and login in schwifly.config.ts when the test needs them.',
  'Discovery and certification both act on the app. Run only within the user-authorized target and action scope.',
  'After a failed run, inspect `schwifly show <id>`, correct the instruction or app, then run again. Stop when the requested outcome passes.',
  'Setup reads keys through `--key-stdin` and stores them in the OS credential store. Use a secret manager pipe, not literal keys.',
  'Setup model IDs form the allowed set. `--model` selects one for a run. The OS store does not isolate same-user processes.',
  'Install session integration only when the user requests it.',
  'Default output is TOON. `--json` selects JSON. Exit codes are 0 for success, 1 for failed work, and 2 for usage errors.',
];

interface Command { description: string; args: string; values?: Record<string, string>; booleans?: Record<string, string>; examples: string[]; min?: number; max?: number }
export const commands: Record<string, Command> = {
  run: { description: 'Run an instruction or replay a saved workflow or story.', args: '[instruction | file]', max: 1,
    values: { url: 'Start URL for instructions', 'instruction-file': 'Read UTF-8 instructions, or - for stdin', save: 'Save as workflows/<name>.spec.ts on success', model: 'Configured model ID (default: setup model)', 'max-steps': 'Discovery action limit, 1-12 (default: 12)', workers: 'Browser workers (only 1)' },
    booleans: { foreground: 'Wait for completion (default: background)', screenshots: 'Capture discovery checkpoints', visible: 'Show the browser (default: headless)' }, examples: [guidance[0], guidance[1], guidance[4]] },
  status: { description: 'Check whether a background run finished.', args: '<id>', min: 1, max: 1, examples: ['schwifly status <id>', 'schwifly status <id> --json'] },
  session: { description: 'Keep a browser and tester context alive across checks.', args: '<start|list|status|ask|baseline|compare|save|reset|stop>', min: 1, max: 3, examples: ['schwifly session start --url <url>', 'schwifly session ask <id> "Try the button again"'] },
  runs: { description: 'List one-off runs in this workspace.', args: '', max: 0, values: { limit: 'Maximum rows (default: 100)', fields: 'Columns: id,status,instruction,created,url,model' }, examples: ['schwifly runs', 'schwifly runs --fields id,status,url --limit 200'] },
  show: { description: 'Inspect a one-off run and its evidence paths.', args: '<id>', min: 1, max: 1, examples: ['schwifly show <id>', 'schwifly show <id> --full'] },
  save: { description: 'Certify a previous run again and save its workflow.', args: '<id> --name <name>', min: 1, max: 1, values: { name: 'Required workflow name' }, booleans: { foreground: 'Wait for completion (default: background)' }, examples: ['schwifly save <id> --name <name>', 'schwifly save <id> --name <name> --root <directory>'] },
  list: { description: 'List saved workflows and authored stories.', args: '', max: 0, values: { limit: 'Maximum rows (default: 100)', fields: 'Columns: path,kind,name' }, examples: ['schwifly list', 'schwifly list --root <directory>'] },
  screenshot: { description: 'Capture a masked page screenshot without model calls.', args: '<url>', min: 1, max: 1, values: { out: 'PNG path inside workspace (default: .schwifly/evidence/<id>.png)' }, examples: ['schwifly screenshot <url>', 'schwifly screenshot <url> --out screenshots/page.png'] },
  setup: { description: 'Configure models, store a key, or install agent integration.', args: '', max: 0,
    values: { models: 'Comma-separated allowed model IDs', model: 'Default model (default: first configured model)', agent: 'Install project integration: claude, codex, opencode, or all' },
    booleans: { 'key-stdin': 'Read provider key from noninteractive stdin into OS store', skill: 'Install skill in project .agents/skills/schwifly' },
    examples: ['schwifly setup --models <provider/model,...> --key-stdin', 'schwifly setup --agent all', 'schwifly setup --skill'] },
  init: { description: 'Create the example app, story, and setup config.', args: '', max: 0, examples: ['schwifly init', 'schwifly init --root <directory>'] },
  'install-browser': { description: 'Install the Chromium browser.', args: '', max: 0, booleans: { 'with-deps': 'Install system dependencies too' }, examples: ['schwifly install-browser', 'schwifly install-browser --with-deps'] },
  suite: { description: 'Run authored stories with deterministic proofs and bounded recovery.', args: '[stories-directory]', max: 1, values: { id: 'Comma-separated story IDs' }, booleans: { foreground: 'Wait for completion (default: background)' }, examples: ['schwifly suite', 'schwifly suite stories --id <id>'] },
  attempt: { description: 'Discover and certify a workflow or authored story.', args: '<instruction | story.story.yaml>', min: 1, max: 1, values: { url: 'Start URL for instructions', out: 'New workflows/<name>.spec.ts', title: 'Workflow title' }, booleans: { visible: 'Show the browser' }, examples: ['schwifly attempt <story.story.yaml>', 'schwifly attempt "<instruction>" --url <url>'] },
  rebuild: { description: 'Replace a broken story route after fresh certification.', args: '<story.story.yaml>', min: 1, max: 1, booleans: { visible: 'Show the browser' }, examples: ['schwifly rebuild <story.story.yaml>', 'schwifly rebuild <story.story.yaml> --visible'] },
  gen: { description: 'Generate a workflow without certification. Prefer run --save.', args: '<instruction> --url <url>', min: 1, max: 1, values: { url: 'Required start URL', out: 'New workflows/<name>.spec.ts', title: 'Workflow title' }, examples: ['schwifly gen "<instruction>" --url <url>', 'schwifly gen "<instruction>" --url <url> --out workflows/<name>.spec.ts'] },
  record: { description: 'Import recorded browser actions or open the human recorder.', args: '<url>', min: 1, max: 1, values: { from: 'Import a recording without prompts', out: 'New workflows/<name>.spec.ts' }, examples: ['schwifly record <url> --from <recording.ts>', 'schwifly record <url> --out workflows/<name>.spec.ts'] },
  context: { description: 'Provide workspace state to an installed session integration.', args: '', max: 0, booleans: { end: 'Record the latest run IDs at session end' }, examples: ['schwifly context', 'schwifly context --end'] },
};

export const sessionCommands: Record<string, Command> = {
  start: { description: 'Start a persistent tester in the background.', args: 'start --url <url>', min: 1, max: 1, values: { url: 'Required app URL' }, booleans: { headless: 'Hide the browser window' }, examples: ['schwifly session start --url <url>', 'schwifly session start --url <url> --headless'] },
  list: { description: 'List workspace testers.', args: 'list', min: 1, max: 1, examples: ['schwifly session list'] },
  status: { description: 'Show tester state and the local browser debug endpoint.', args: 'status <id>', min: 2, max: 2, examples: ['schwifly session status <id>'] },
  ask: { description: 'Queue a check using the existing browser and context.', args: 'ask <id> <instruction>', min: 3, max: 3, values: { element: 'Optional unique screenshot selector', padding: 'Screenshot padding in pixels, 0-200 (default: 12)' }, examples: ['schwifly session ask <id> "Try the button again"', 'schwifly session ask <id> "Click Go. <expect>Done</expect>" --element button'] },
  baseline: { description: 'Mark the last check and its images as the baseline.', args: 'baseline <id>', min: 2, max: 2, examples: ['schwifly session baseline <id>'] },
  compare: { description: 'Replay baseline actions and compare the same screenshots and checks.', args: 'compare <id>', min: 2, max: 2, examples: ['schwifly session compare <id>'] },
  save: { description: 'Save the last passing check only after fresh replay.', args: 'save <id> --name <name>', min: 2, max: 2, values: { name: 'Required new workflow name' }, examples: ['schwifly session save <id> --name <name>'] },
  reset: { description: 'Replace the browser and clear tester memory and baselines.', args: 'reset <id>', min: 2, max: 2, examples: ['schwifly session reset <id>'] },
  stop: { description: 'Close the tester and retain its evidence.', args: 'stop <id>', min: 2, max: 2, examples: ['schwifly session stop <id>'] },
};

export const globals = { root: 'Workspace directory (default: current directory)', json: 'Use JSON instead of TOON', full: 'Do not truncate detail text', help: 'Show command help', version: 'Print version' };

export function help(command?: string, subcommand?: string) {
  const spec = command === 'session' && subcommand ? sessionCommands[subcommand] : command ? commands[command] : undefined;
  if (!spec) return { description, commands: Object.entries(commands).filter(([name]) => name !== 'context').map(([command, spec]) => ({ command, description: spec.description })), help: guidance.slice(0, 2) };
  return { description: spec.description, usage: `schwifly ${command} ${spec.args}`.trim(),
    flags: { ...globals, ...spec.values, ...spec.booleans }, examples: spec.examples };
}

export function skillSource(): string {
  const cli = (text: string) => text.replaceAll('schwifly ', 'pnpm dlx schwifly ');
  return `---\nname: schwifly\ndescription: Run browser tests from instructions, inspect screenshots, and save or replay certified Schwifly workflows.\n---\n\n# Schwifly\n\n${description}\n\n\`pnpm dlx schwifly\` shows workspace state. In an installed project, use \`pnpm exec schwifly\`.\nThe package must be available from the configured registry. For an unpublished checkout, build it and use its absolute bin/schwifly.js path.\n\n${rules.map(rule => `- ${rule}`).join('\n')}\n\n\`\`\`sh\n${guidance.map(cli).join('\n')}\n\`\`\`\n\nRun a command with \`--help\` for its complete flags and examples.\nUse \`pnpm dlx schwifly setup --agent all\` for live session context.\nThe generated skill also works alone and needs no session integration.\n`;
}
