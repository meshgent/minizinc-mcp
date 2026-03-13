import { Model, init, version, solvers, shutdown, ErrorMessage } from 'minizinc';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import cors from 'cors';
import pino from 'pino';
import { z } from 'zod';

// --- Logger ---
// Always write to stderr so stdout stays clean for the stdio MCP transport.
const isDev = process.env.NODE_ENV !== 'production';
const logger = pino(
  { level: process.env.LOG_LEVEL ?? 'info' },
  isDev
    ? pino.transport({ target: 'pino-pretty', options: { colorize: true, destination: 2 } })
    : pino.destination(2)
);

// --- Error helpers ---
function formatError(err: unknown): string {
  if (Array.isArray(err)) {
    return (err as ErrorMessage[]).map(e => `[${e.what}] ${e.message}`).join('\n');
  }
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') return JSON.stringify(err);
  return String(err);
}

function toolError(tool: string, err: unknown) {
  logger.error({ tool, err }, 'tool error');
  return { content: [{ type: 'text' as const, text: `Error: ${formatError(err)}` }], isError: true };
}

// --- CLI argument parsing ---
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
  };
  return {
    transport: get('--transport', process.env.MCP_TRANSPORT ?? 'stdio') as 'stdio' | 'http',
    port:      parseInt(get('--port', process.env.PORT ?? '3000'), 10),
    host:      get('--host', process.env.HOST ?? '0.0.0.0'),
  };
}

const MINIZINC_BIN = process.env.MINIZINC_BIN ?? '';

const server = new McpServer({ name: 'minizinc-mcp', version: '1.0.0' });

// Tool 1: Get version
server.tool(
  'minizinc_get_version',
  'Returns the version string of the installed MiniZinc binary. Use to confirm MiniZinc is available before solving.',
  {},
  async () => {
    try {
      const v = await version();
      return { content: [{ type: 'text', text: v.trim() }] };
    } catch (err) {
      return toolError('minizinc_get_version', err);
    }
  }
);

// Tool 2: List solvers
server.tool(
  'minizinc_list_solvers',
  'Returns available MiniZinc solver configurations (names, IDs, capabilities). Use before solving to discover valid solver identifiers like "gecode" or "coinbc".',
  {},
  async () => {
    try {
      const all = await solvers() as Array<Record<string, unknown>>;
      const projected = all.map(s => ({
        id: s['id'],
        name: s['name'],
        version: s['version'],
        isDefault: s['isDefault'] ?? false,
      }));
      return { content: [{ type: 'text', text: JSON.stringify(projected, null, 2) }] };
    } catch (err) {
      return toolError('minizinc_list_solvers', err);
    }
  }
);

// Some MCP clients pass complex parameters as JSON strings rather than objects.
// These helpers accept both and parse the string form automatically.
function jsonString<T>(schema: z.ZodType<T>) {
  return z.preprocess(val => (typeof val === 'string' ? JSON.parse(val) : val), schema);
}

// Shared input schema for model content — used by check, interface, and solve tools.
const modelInputSchema = {
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

function buildModel(files?: Record<string, string>, strings?: string[], dzn_strings?: string[], json_data?: Record<string, unknown>): Model {
  const m = new Model();
  if (files)       for (const [name, content] of Object.entries(files)) m.addFile(name, content);
  if (strings)     for (const s of strings)     m.addString(s);
  if (dzn_strings) for (const d of dzn_strings) m.addDznString(d);
  if (json_data)   m.addJson(json_data as object);
  return m;
}

function formatSolveResult(result: { status: string; solution: { output: { default?: string; json?: Record<string, unknown> } } | null; statistics: Record<string, unknown> }): string {
  const out: Record<string, unknown> = { status: result.status };
  if (result.solution) {
    out.output    = result.solution.output.default ?? null;
    out.variables = result.solution.output.json    ?? null;
  }
  if (Object.keys(result.statistics).length > 0) out.statistics = result.statistics;
  return JSON.stringify(out, null, 2);
}

// Tool 3: Check model
server.tool(
  'minizinc_check_model',
  'Syntax and type-check a MiniZinc model without solving. ' +
  'All content is passed inline — no filesystem access required. ' +
  'Returns "Model is valid" or a list of type/syntax errors. ' +
  'Call this before minizinc_solve_model to catch mistakes early. ' +
  'Example: { strings: ["var 1..3: x; int: n; solve satisfy;"], dzn_strings: ["n = 2;"] }',
  {
    ...modelInputSchema,
    solver: z.string().default('gecode').describe('Solver to use for type-checking.'),
  },
  async ({ files, strings, dzn_strings, json_data, solver }) => {
    try {
      const m = buildModel(files, strings, dzn_strings, json_data);
      const errors = await m.check({ options: { solver } });
      if (errors.length === 0) return { content: [{ type: 'text', text: 'Model is valid' }] };
      return { content: [{ type: 'text', text: errors.map(e => `[${e.what}] ${e.message}`).join('\n') }], isError: true };
    } catch (err) {
      return toolError('minizinc_check_model', err);
    }
  }
);

// Tool 4: Get model interface
server.tool(
  'minizinc_get_model_interface',
  'Returns the interface of a MiniZinc model: required input parameters (names + types), output variables, and solve method (sat/min/max). ' +
  'Pass all model content inline — no filesystem access required. ' +
  'Use this before minizinc_solve_model when you are unsure what parameters the model expects. ' +
  'Example: { strings: ["int: n; array[1..n] of var 0..1: x; solve maximize sum(x);"] } ' +
  '→ returns { input: { n: { type: "int" } }, output: { x: { type: "int", dim: 1 } }, method: "max" }',
  {
    ...modelInputSchema,
    solver: z.string().default('gecode').describe('Solver to use.'),
  },
  async ({ files, strings, dzn_strings, json_data, solver }) => {
    try {
      const m = buildModel(files, strings, dzn_strings, json_data);
      const iface = await m.interface({ options: { solver } });
      return { content: [{ type: 'text', text: JSON.stringify(iface, null, 2) }] };
    } catch (err) {
      return toolError('minizinc_get_model_interface', err);
    }
  }
);

// Tool 5: Solve model
server.tool(
  'minizinc_solve_model',
  'Solve a MiniZinc constraint model. All content is passed inline — no filesystem access required. ' +
  'Returns solution status (SATISFIED/OPTIMAL_SOLUTION/UNSATISFIABLE/UNKNOWN), variable values, and formatted output. ' +
  'HOW TO PASS MODEL CONTENT — choose the inputs that fit your case: ' +
  '(1) Simple self-contained model: { strings: ["var 1..3: x; solve satisfy;"] } ' +
  '(2) Model with parameters via DZN: { strings: ["int: n; var 1..n: x; solve satisfy;"], dzn_strings: ["n = 3;"] } ' +
  '(3) Model with parameters via JSON: { strings: ["int: n; var 1..n: x; solve satisfy;"], json_data: { "n": 3 } } ' +
  '(4) Multi-file model using include: { files: { "main.mzn": "include \\"lib.mzn\\"; ...", "lib.mzn": "predicate ..." } } ' +
  '(5) Named model + separate data file: { files: { "model.mzn": "...", "data.dzn": "n = 3;" } } ' +
  'Use minizinc_list_solvers to find available solver IDs. Use minizinc_get_model_interface first if unsure what parameters the model requires.',
  {
    ...modelInputSchema,
    solver:        z.string().default('gecode').describe('Solver to use.'),
    time_limit_ms: z.number().int().positive().default(30000).describe('Time limit in milliseconds.'),
    all_solutions: z.boolean().default(false).describe('Return all solutions instead of just the first.'),
  },
  async ({ files, strings, dzn_strings, json_data, solver, time_limit_ms, all_solutions }) => {
    try {
      const m = buildModel(files, strings, dzn_strings, json_data);
      const options: Record<string, unknown> = { solver, 'time-limit': time_limit_ms };
      if (all_solutions) options['all-solutions'] = true;
      const run = m.solve({ jsonOutput: true, options });
      const stderrLines: string[] = [];
      (run as unknown as { on(e: string, cb: (line: string) => void): void }).on('stderr', (line: string) => {
        stderrLines.push(line);
        logger.debug({ line }, 'minizinc stderr');
      });
      try {
        const result = await run;
        return { content: [{ type: 'text', text: formatSolveResult(result) }] };
      } catch (err) {
        const detail = stderrLines.length ? `\nstderr:\n${stderrLines.join('\n')}` : '';
        return { content: [{ type: 'text', text: `Error: ${formatError(err)}${detail}` }], isError: true };
      }
    } catch (err) {
      return toolError('minizinc_solve_model', err);
    }
  }
);

async function startStdio() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp(host: string, port: number) {
  const app = createMcpExpressApp({ host });
  app.use(cors());

  app.post('/mcp', async (req, res) => {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => { transport.close(); });
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  });

  await new Promise<void>((resolve, reject) => {
    app.listen(port, host, (err?: Error) => { err ? reject(err) : resolve(); }).on('error', reject);
  });

  logger.info({ url: `http://${host}:${port}/mcp` }, 'MCP HTTP server listening');
}

async function main() {
  const { transport, port, host } = parseArgs();

  await init(MINIZINC_BIN ? { minizinc: MINIZINC_BIN } : {});

  try {
    const v = await version();
    logger.info({ version: v.trim() }, 'MiniZinc ready');
  } catch {
    logger.warn(
      { bin: MINIZINC_BIN || '(PATH)' },
      'MiniZinc binary not found — set MINIZINC_BIN env var to the correct path'
    );
  }

  if (transport === 'http') {
    await startHttp(host, port);
  } else {
    logger.info('Starting stdio transport');
    await startStdio();
  }
}

process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
process.on('exit', () => { shutdown(); });

main().catch(err => { console.error(err); process.exit(1); });
