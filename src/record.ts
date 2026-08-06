import { normalizeActions, type CapturedAction } from './capture';
import type { EmitStep } from './emit';
import type { StepSpec } from './workflow';

// PURE, KEY-FREE recorder transform: Playwright's public codegen output -> the same
// StepSpec-shaped data consumed by emit(). It deliberately understands only operations the
// workflow Action union can replay faithfully. Unsupported actions fail instead of vanishing.

const FALLBACK_LABEL = 'recorded element';

interface ParsedLocator {
  selector: string;
  label?: string;
  noun?: string;
  rest: string;
}

interface StringToken {
  value: string;
  end: number;
}

export function needsIntentLabel(step: StepSpec): boolean {
  return step.intent.endsWith(`the ${FALLBACK_LABEL}`);
}

/** Replace opaque fallback intents in order. Human labels derived from codegen always win. */
export function applyIntentLabels(steps: EmitStep[], labels: string[]): EmitStep[] {
  let next = 0;
  return steps.map((step) => {
    if (!needsIntentLabel(step)) return step;
    let label = labels[next++]?.trim().replace(/\s+/g, ' ');
    if (!label) return step;
    if (!/^(click|press|tap|open|select|choose|go to|navigate to|toggle|fill|enter|type|see|view|check)\b/i.test(label)) {
      const verb = step.action === 'fill'
        ? 'fill'
        : step.action === 'expectVisible' || step.action === 'expectText'
          ? 'see'
          : 'click';
      label = `${verb} the ${label}`;
    }
    return { ...step, intent: label.slice(0, 160) };
  });
}

/** Playwright codegen source text -> plain-string, deterministic workflow steps. */
export function parseCodegen(source: string): EmitStep[] {
  const steps: EmitStep[] = [];
  for (const statement of awaitStatements(source)) {
    const step = parseStatement(statement);
    if (step) steps.push(step);
  }
  if (!steps.length) throw new Error('recording contains no supported actions');
  return steps;
}

function parseStatement(statement: string): EmitStep | null {
  const expression = statement.replace(/^await\s+/, '').replace(/;\s*$/, '').trim();
  if (/^page\.(goto|pause)\s*\(/.test(expression)) return null;

  if (expression.startsWith('expect(')) return parseAssertion(expression);
  if (!expression.startsWith('page.')) return null;

  const locator = parseLocator(expression);
  const actionCall = parseCallSuffix(locator.rest);
  if (!actionCall) throw new Error('unsupported codegen statement');

  const args = splitTopLevel(actionCall.args);
  let method = actionCall.name;
  if (method === 'check' || method === 'uncheck') method = 'click';
  if (method !== 'click' && method !== 'fill') {
    throw new Error(`unsupported codegen action: ${actionCall.name}`);
  }
  if (method === 'click' && args.some(Boolean)) {
    throw new Error('click options are not supported by the workflow action contract');
  }

  const value = method === 'fill' ? requiredLiteral(args[0], 'fill value') : undefined;
  const noun = locator.noun ?? (method === 'fill' && locator.label ? 'field' : undefined);
  const description = locator.label
    ? [locator.label, noun].filter(Boolean).join(' ')
    : FALLBACK_LABEL;
  const captured: CapturedAction = {
    method,
    selector: locator.selector,
    description,
    args: value === undefined ? [] : [value],
    ok: true,
  };
  const normalized = normalizeActions([captured])[0];
  // capture.ts drops empty fills because an agent's empty argument usually means missing
  // evidence. Codegen's explicit fill('') is different: it records a real field-clear action.
  if (!normalized && method === 'fill' && value === '') {
    return { intent: `fill the ${description}`, locator: locator.selector, action: 'fill', value };
  }
  return normalized ?? null;
}

function parseAssertion(expression: string): EmitStep {
  const call = consumeCall(expression, 'expect');
  if (!call || call.rest === expression) {
    throw new Error('unsupported codegen assertion');
  }
  const locator = parseLocator(call.args.trim());
  if (locator.rest.trim()) {
    throw new Error('unsupported chained codegen locator');
  }
  const assertion = parseCallSuffix(call.rest);
  if (!assertion) throw new Error('unsupported codegen assertion');

  const description = locator.label
    ? [locator.label, locator.noun ?? 'text'].filter(Boolean).join(' ')
    : FALLBACK_LABEL;
  if (assertion.name === 'toBeVisible') {
    return { intent: `see the ${description}`, locator: locator.selector, action: 'expectVisible' };
  }
  if (assertion.name === 'toHaveText' || assertion.name === 'toContainText') {
    const value = requiredLiteral(splitTopLevel(assertion.args)[0], 'asserted text');
    return {
      intent: `see the ${description}`,
      locator: locator.selector,
      action: 'expectText',
      value,
    };
  }
  throw new Error(`unsupported codegen assertion: ${assertion.name}`);
}

function parseLocator(expression: string): ParsedLocator {
  const match = /^page\.(locator|getByRole|getByText|getByLabel|getByPlaceholder|getByAltText|getByTitle|getByTestId)\s*\(/.exec(expression);
  if (!match) throw new Error('unsupported codegen locator');
  const method = match[1];
  const call = consumeCall(expression, `page.${method}`);
  if (!call) throw new Error('malformed codegen locator');
  const args = splitTopLevel(call.args);
  let selector: string;
  let label: string | undefined;
  let noun: string | undefined;

  if (method === 'locator') {
    selector = requiredLiteral(args[0], 'locator');
    const described = describeSelector(selector);
    label = described.label;
    noun = described.noun;
  } else if (method === 'getByRole') {
    const role = requiredLiteral(args[0], 'role');
    noun = role;
    label = propertyLiteral(args[1], 'name');
    if (args[1] && !label) throw new Error('getByRole needs a literal accessible name');
    selector = label
      ? `role=${role}[name=${JSON.stringify(label)}i]`
      : `role=${role}`;
  } else {
    label = requiredLiteral(args[0], `${method} label`);
    if (method === 'getByText') {
      // Unquoted text= preserves getByText's default case-insensitive substring semantics.
      selector = `text=${label}`;
      noun = 'text';
    } else if (method === 'getByLabel') {
      // Playwright has no public label= string engine. Its stable internal label engine preserves
      // getByLabel semantics for both wrapping <label> and for= associations while remaining a
      // serializable string that heal write-back can replace.
      selector = `internal:label=${JSON.stringify(label)}i`;
    } else if (method === 'getByPlaceholder') {
      selector = `[placeholder=${JSON.stringify(label)} i]`;
      noun = 'field';
    } else if (method === 'getByAltText') {
      selector = `[alt=${JSON.stringify(label)} i]`;
      noun = 'image';
    } else if (method === 'getByTitle') {
      selector = `[title=${JSON.stringify(label)} i]`;
    } else {
      selector = `[data-testid=${JSON.stringify(label)}]`;
      label = undefined; // a test id is not a usable human label for healing
    }
  }

  let rest = call.rest;
  for (;;) {
    const modifier = /^\.(first|last)\(\)|^\.nth\(\s*(-?\d+)\s*\)/.exec(rest);
    if (!modifier) break;
    const index = modifier[1] === 'first' ? 0 : modifier[1] === 'last' ? -1 : Number(modifier[2]);
    selector += ` >> nth=${index}`;
    rest = rest.slice(modifier[0].length);
  }
  if (/^\.(getBy|locator|filter|and|or)/.test(rest)) {
    throw new Error('unsupported chained codegen locator');
  }
  return { selector, label, noun, rest };
}

function describeSelector(selector: string): { label?: string; noun?: string } {
  const role = /^role=([^\[\s]+)\[name=("(?:\\.|[^"])*")i?\]$/.exec(selector);
  if (role) return { label: JSON.parse(role[2]) as string, noun: role[1] };

  const attribute = /^\[(aria-label|placeholder|alt|title|data-testid)=("(?:\\.|[^"])*")\s*i?\]$/.exec(selector);
  if (attribute) {
    if (attribute[1] === 'data-testid') return {};
    return {
      label: JSON.parse(attribute[2]) as string,
      noun: attribute[1] === 'placeholder' ? 'field' : attribute[1] === 'alt' ? 'image' : undefined,
    };
  }
  const text = /^text=(.*)$/.exec(selector);
  if (text) {
    const raw = text[1];
    const parsed = parseStringToken(raw.trim(), 0);
    return { label: parsed?.end === raw.trim().length ? parsed.value : raw.trim(), noun: 'text' };
  }
  return {};
}

function propertyLiteral(object: string | undefined, property: string): string | undefined {
  if (!object) return undefined;
  const match = new RegExp(`(?:^|[,{])\\s*${property}\\s*:`).exec(object);
  if (!match) return undefined;
  const token = parseStringToken(object, match.index + match[0].length);
  return token?.value;
}

function requiredLiteral(value: string | undefined, what: string): string {
  if (!value) throw new Error(`${what} needs a string literal`);
  const trimmed = value.trim();
  const token = parseStringToken(trimmed, 0);
  if (!token || token.end !== trimmed.length) throw new Error(`${what} needs a string literal`);
  return token.value;
}

function parseStringToken(source: string, start: number): StringToken | null {
  let i = start;
  while (/\s/.test(source[i] ?? '')) i++;
  const quote = source[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let value = '';
  for (i++; i < source.length; i++) {
    const ch = source[i];
    if (ch === quote) return { value, end: i + 1 };
    if (quote === '`' && ch === '$' && source[i + 1] === '{') return null;
    if (ch !== '\\') {
      value += ch;
      continue;
    }
    const escaped = source[++i];
    if (escaped === undefined) return null;
    const simple: Record<string, string> = {
      n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0',
    };
    if (simple[escaped] !== undefined) value += simple[escaped];
    else if (escaped === '\n') continue;
    else if (escaped === 'x' && /^[0-9a-f]{2}$/i.test(source.slice(i + 1, i + 3))) {
      value += String.fromCodePoint(Number.parseInt(source.slice(i + 1, i + 3), 16));
      i += 2;
    } else if (escaped === 'u') {
      const braced = /^\{([0-9a-f]+)\}/i.exec(source.slice(i + 1));
      const plain = /^[0-9a-f]{4}/i.exec(source.slice(i + 1));
      if (braced) {
        value += String.fromCodePoint(Number.parseInt(braced[1], 16));
        i += braced[0].length;
      } else if (plain) {
        value += String.fromCodePoint(Number.parseInt(plain[0], 16));
        i += 4;
      } else return null;
    } else value += escaped;
  }
  return null;
}

function consumeCall(source: string, name: string): { args: string; rest: string } | null {
  const prefix = `${name}(`;
  if (!source.startsWith(prefix)) return null;
  const close = matchingParen(source, prefix.length - 1);
  if (close < 0) return null;
  return { args: source.slice(prefix.length, close), rest: source.slice(close + 1) };
}

function parseCallSuffix(source: string): { name: string; args: string } | null {
  const match = /^\.([A-Za-z_$][\w$]*)\s*\(/.exec(source);
  if (!match) return null;
  const call = consumeCall(source.slice(1), match[1]);
  if (!call || call.rest.trim()) return null;
  return { name: match[1], args: call.args };
}

function matchingParen(source: string, open: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i;
  }
  return -1;
}

function splitTopLevel(source: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(source.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function awaitStatements(source: string): string[] {
  const statements: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('await ', cursor);
    if (start < 0) break;
    let quote = '';
    let escaped = false;
    let end = start;
    for (; end < source.length; end++) {
      const ch = source[end];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = '';
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === ';') {
        end++;
        break;
      }
    }
    statements.push(source.slice(start, end).trim());
    cursor = end;
  }
  return statements;
}
