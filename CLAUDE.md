# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

`minizinc-mcp` is a TypeScript MCP (Model Context Protocol) server that exposes MiniZinc constraint solving capabilities to LLM-based agents. It is part of the meshgent ecosystem.

## Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled server (node dist/index.js)
npm run dev          # Run directly with tsx (no compile step)
npm run lint         # Lint with ESLint
npm test             # Run tests (no framework configured yet)
```

## Architecture

- **Language:** TypeScript (compiled to CommonJS via `tsc`)
- **Module system:** CommonJS (`"type": "commonjs"`)
- **Main entry:** `src/index.ts` → compiled to `dist/index.js`
- **Key dependencies:**
  - [`minizinc`](https://www.npmjs.com/package/minizinc) (v4.4.5) — JS/Node.js API for the MiniZinc constraint solver
  - [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — official TypeScript MCP SDK
  - [`zod`](https://www.npmjs.com/package/zod) — schema validation for tool inputs

### MiniZinc binary

The MiniZinc binary is expected on `$PATH` (installed at `~/minizinc/bin/minizinc` via `~/.zshrc`).
Override with `MINIZINC_BIN` env var if needed.

### MCP Tools exposed

| Tool | Description |
|------|-------------|
| `minizinc_get_version` | Returns MiniZinc binary version string |
| `minizinc_list_solvers` | Lists available solver configurations |
| `minizinc_check_model` | Validates model syntax/types without solving |
| `minizinc_get_model_interface` | Returns model inputs, outputs, and solve method |
| `minizinc_solve_model` | Solves a MiniZinc model — all content provided inline |

All model tools accept content via four input fields (any combination):
- `files` — named files as `{ "model.mzn": "<code>" }` (for `include` dependencies)
- `strings` — anonymous model code snippets
- `dzn_strings` — DZN data strings
- `json_data` — data as a JSON object

### MiniZinc library usage

```typescript
import { Model, init, version, solvers, shutdown } from 'minizinc';

await init(); // finds binary on PATH
const m = new Model();
m.addString('var 1..3: x; solve satisfy;');
const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
console.log(result.status, result.solution?.output.json);
```

Note: `z.record()` in zod v4 requires two arguments: `z.record(z.string(), z.unknown())`.

### Logging

Uses [`pino`](https://getpino.io) for structured logging, always written to **stderr** so stdout stays clean for the stdio MCP transport.

- Development (`NODE_ENV` ≠ `production`): pretty-printed via `pino-pretty`
- Production / Docker (`NODE_ENV=production`): newline-delimited JSON
- Log level controlled via `LOG_LEVEL` env var (default: `info`)

## Status

Implementation complete — `src/index.ts` contains all 6 MCP tools.
