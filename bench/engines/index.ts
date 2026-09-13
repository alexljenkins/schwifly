import type { BenchEngine } from '../types.js';
import { stagehand37 } from './stagehand37.js';
import { stagehand4 } from './stagehand4.js';

export const ENGINES: BenchEngine[] = [stagehand37, stagehand4];

export function selectEngine(id: string): BenchEngine {
  const engine = ENGINES.find((candidate) => candidate.id === id);
  if (!engine) throw new Error(`unknown engine ${id}; available: ${ENGINES.map((e) => e.id).join(', ')}`);
  return engine;
}
