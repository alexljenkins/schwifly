import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify, type JsonMap } from '@iarna/toml';
import { skillSource } from './cliGuide.js';
import { workspacePath } from './oneOff.js';

const marker = 'Schwifly context';
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function executableCommand(): string[] {
  const bin = fileURLToPath(new URL('../bin/schwifly.js', import.meta.url));
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, process.platform === 'win32' ? 'schwifly.cmd' : 'schwifly');
    try {
      accessSync(candidate, constants.X_OK);
      if (!statSync(candidate).isFile()) continue;
      if (realpathSync(candidate) === realpathSync(bin)) return ['schwifly'];
      break; // A different executable shadows this installation on PATH.
    } catch { /* Continue looking for this executable. */ }
  }
  return [process.execPath, bin];
}

interface Hook { type?: string; command?: string; statusMessage?: string; [key: string]: unknown }
interface Group { hooks: Hook[]; [key: string]: unknown }

export function installIntegration(agent?: string, skill = false) {
  const targets = agent === 'all' ? ['claude', 'codex', 'opencode'] : agent ? [agent] : [];
  const writes: Array<{ file: string; content: string }> = [];
  const executable = executableCommand();
  const args = [...executable, 'context', '--root', process.cwd()];
  const start = args.map(quote).join(' ');
  const end = start + ' --end';
  const stage = (path: string, content: string) => writes.push({ file: workspacePath(path), content });
  for (const target of targets) {
    if (target === 'opencode') {
      const path = workspacePath('.opencode/plugins/schwifly.js');
      if (existsSync(path) && !readFileSync(path, 'utf8').startsWith('// Schwifly context')) throw new Error('existing OpenCode plugin is not managed by Schwifly');
      stage(path, `// Schwifly context. Managed by schwifly setup.\nimport { execFileSync } from 'node:child_process';\nexport const Schwifly = async () => ({\n  'experimental.chat.system.transform': async (_input, output) => {\n    try { output.system.push(execFileSync(${JSON.stringify(executable[0])}, ${JSON.stringify(args.slice(1))}, { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch {}\n  },\n  event: async ({ event }) => {\n    if (event.type === 'session.idle') {\n      try { execFileSync(${JSON.stringify(executable[0])}, ${JSON.stringify([...args.slice(1), '--end'])}, { timeout: 3000, stdio: 'ignore' }); } catch {}\n    }\n  },\n});\n`);
    } else {
      const path = workspacePath(target === 'claude' ? '.claude/settings.json' : '.codex/hooks.json');
      const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error(`invalid ${target} hook configuration`);
      config.hooks ??= {};
      for (const [event, command] of [['SessionStart', start], ['SessionEnd', end]]) {
        const groups: Group[] = config.hooks[event] ?? [];
        if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group.hooks))) throw new Error(`invalid ${target} ${event} hooks`);
        config.hooks[event] = groups.map(group => ({ ...group, hooks: group.hooks.filter(hook => hook.statusMessage !== marker) })).filter(group => group.hooks.length);
        config.hooks[event].push({ hooks: [{ type: 'command', command, timeout: 3, statusMessage: marker }] });
      }
      stage(path, JSON.stringify(config, null, 2) + '\n');
      if (target === 'codex') {
        const path = workspacePath('.codex/config.toml');
        const source = existsSync(path) ? readFileSync(path, 'utf8') : '';
        const config = parse(source);
        const features = (config.features ?? {}) as JsonMap;
        if (features.hooks !== true) {
          features.hooks = true;
          config.features = features;
          stage(path, stringify(config));
        }
      }
    }
  }
  if (skill) stage('.agents/skills/schwifly/SKILL.md', skillSource());
  const changed: string[] = [];
  for (const { file, content } of writes) {
    if (existsSync(file) && readFileSync(file, 'utf8') === content) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    changed.push(relative(process.cwd(), file));
  }
  return { status: changed.length ? 'installed' : 'unchanged', files: changed,
    ...(targets.includes('codex') ? { next: 'Review and trust the installed hooks in Codex /hooks.' } : {}) };
}
