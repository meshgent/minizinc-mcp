import { Model, ErrorMessage } from 'minizinc';
import { z } from 'zod';

// --- Error helpers ---
export function formatError(err: unknown): string {
  if (Array.isArray(err)) {
    return (err as ErrorMessage[]).map(e => `[${e.what}] ${e.message}`).join('\n');
  }
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}

export function formatSolveResult(result: { status: string; solution: { output: { default?: string; json?: Record<string, unknown> } } | null; statistics: Record<string, unknown> }): string {
  const out: Record<string, unknown> = { status: result.status };
  if (result.solution) {
    out.output    = result.solution.output.default ?? null;
    out.variables = result.solution.output.json    ?? null;
  }
  if (Object.keys(result.statistics).length > 0) out.statistics = result.statistics;
  return JSON.stringify(out, null, 2);
}

// Some MCP clients pass complex parameters as JSON strings rather than objects.
// These helpers accept both and parse the string form automatically.
export function jsonString<T>(schema: z.ZodType<T>) {
  return z.preprocess(val => (typeof val === 'string' ? JSON.parse(val) : val), schema);
}

// Shared input schema for model content — used by check, interface, and solve tools.
export const modelInputSchema = {
  files: jsonString(z.record(z.string(), z.string())).optional().describe(
    'Named virtual files passed as { "filename": "content" }. ' +
    'Required when the model uses `include "other.mzn"` — supply every included file here so MiniZinc can resolve them. ' +
    'The entry whose filename ends in ".mzn" is the main model; ".dzn"/".json" entries are data files. ' +
    'Example: { "model.mzn": "include \\"data.dzn\\"; var 1..n: x; solve satisfy;", "data.dzn": "n = 3;" }'
  ),
  strings: jsonString(z.array(z.string())).optional().describe(
    'One or more anonymous MiniZinc model snippets. Each string is treated as a complete model fragment. ' +
    'Use for self-contained models that do not reference other files. ' +
    'Example: ["var 1..3: x; var 1..3: y; constraint x < y; solve satisfy;"]'
  ),
  dzn_strings: jsonString(z.array(z.string())).optional().describe(
    'One or more DZN (DataZinc) data strings to supply parameter values. ' +
    'Use together with `files` or `strings` when the model declares unassigned parameters. ' +
    'Example: ["n = 5;", "weights = [1, 2, 3, 4, 5];"]'
  ),
  json_data: jsonString(z.record(z.string(), z.unknown())).optional().describe(
    'Parameter values as a JSON object. Alternative to `dzn_strings` — use whichever is more convenient. ' +
    'Keys must match the parameter names declared in the model. ' +
    'Example: { "n": 5, "weights": [1, 2, 3, 4, 5] }'
  ),
};

export function buildModel(files?: Record<string, string>, strings?: string[], dzn_strings?: string[], json_data?: Record<string, unknown>): Model {
  const m = new Model();
  if (files)       for (const [name, content] of Object.entries(files)) m.addFile(name, content);
  if (strings)     for (const s of strings)     m.addString(s);
  if (dzn_strings) for (const d of dzn_strings) m.addDznString(d);
  if (json_data)   m.addJson(json_data as object);
  return m;
}
