import type { BenchEngine } from '../types.js';
import { stagehand37 } from './stagehand37.js';

// A Stagehand v4 branch adds its engine here and changes nothing else in bench/.
export const ENGINES: BenchEngine[] = [stagehand37];

export function selectEngine(id: string): BenchEngine {
  const engine = ENGINES.find((candidate) => candidate.id === id);
  if (!engine) throw new Error(`unknown engine ${id}; available: ${ENGINES.map((e) => e.id).join(', ')}`);
  return engine;
}
