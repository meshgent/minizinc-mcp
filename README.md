# MiniZinc MCP

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that exposes [MiniZinc](https://www.minizinc.org/) constraint solving to AI agents. Give Claude (or any MCP-capable agent) the ability to formulate and solve combinatorial optimisation problems — scheduling, resource allocation, graph colouring, packing, planning — using declarative constraint models.

## Requirements

- Node.js v20 or newer
- MiniZinc binary on `$PATH` — [download from minizinc.org](https://www.minizinc.org/software.html) or `snap install minizinc`
- npm

## Setup

### Claude Code

**stdio (local):**
```bash
claude mcp add minizinc-mcp -- node /path/to/minizinc-mcp/dist/index.js
```

**HTTP (Docker):**
```bash
claude mcp add --transport http minizinc-mcp http://localhost:3000/mcp
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "minizinc": {
      "command": "node",
      "args": ["/path/to/minizinc-mcp/dist/index.js"]
    }
  }
}
```

If the MiniZinc binary is not on `$PATH`, add `MINIZINC_BIN`:

```json
{
  "mcpServers": {
    "minizinc": {
      "command": "node",
      "args": ["/path/to/minizinc-mcp/dist/index.js"],
      "env": {
        "MINIZINC_BIN": "/opt/minizinc/bin/minizinc"
      }
    }
  }
}
```

### VS Code / Cursor / Windsurf

Add to your MCP settings file:

```json
{
  "servers": {
    "minizinc": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/minizinc-mcp/dist/index.js"]
    }
  }
}
```

### Docker (HTTP transport)

```bash
# Build
docker build -t minizinc-mcp .

# Run (exposes MCP on http://localhost:3000/mcp)
docker run --rm -p 3000:3000 minizinc-mcp
```

Then configure your client with:

```json
{
  "mcpServers": {
    "minizinc": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

> **Using nerdctl or podman?** Set `DOCKER=nerdctl npm run docker:build` or export `DOCKER=nerdctl` in your shell.

---

## Tools

| Tool | Description |
|------|-------------|
| `minizinc_get_version` | Returns the installed MiniZinc version. Use to confirm the binary is available. |
| `minizinc_list_solvers` | Lists available solver configurations (name, ID, version, default flag). |
| `minizinc_check_model` | Validates a model for syntax and type errors without solving. |
| `minizinc_get_model_interface` | Returns a model's required input parameters, output variables, and solve method (`sat`/`min`/`max`). |
| `minizinc_solve_model` | Solves a MiniZinc model. All content is passed inline — no filesystem access required. |

All model tools (`check`, `interface`, `solve`) accept content via four fields — use any combination:

| Field | Type | Maps to |
|-------|------|---------|
| `files` | `{ "name.mzn": "<code>" }` | `model.addFile(name, content)` — use when the model references other files via `include` |
| `strings` | `["var 1..3: x;", ...]` | `model.addString(code)` — anonymous model snippets |
| `dzn_strings` | `["n = 5;", ...]` | `model.addDznString(dzn)` — DZN data |
| `json_data` | `{ "n": 5 }` | `model.addJson(obj)` — JSON data |

### Typical agent workflow

```
1. minizinc_get_version          → confirm MiniZinc is available
2. minizinc_list_solvers         → discover solver IDs (e.g. "gecode")
3. minizinc_get_model_interface  → inspect required inputs for a model
4. minizinc_check_model          → validate the model before solving
5. minizinc_solve_model          → solve and retrieve results
```

---

## Examples

### Satisfy — inline model

```json
{
  "tool": "minizinc_solve_model",
  "strings": ["var 1..3: x; var 1..3: y; constraint x < y; solve satisfy;"]
}
```

### Map colouring (Australia)

Colour regions with 3 colours so no adjacent regions share a colour.

```json
{
  "tool": "minizinc_solve_model",
  "files": {
    "aust.mzn": "int: nc = 3;\nvar 1..nc: wa; var 1..nc: nt; var 1..nc: sa;\nvar 1..nc: q; var 1..nc: nsw; var 1..nc: v; var 1..nc: t;\nconstraint wa != nt; constraint wa != sa; constraint nt != sa;\nconstraint nt != q; constraint sa != q; constraint sa != nsw;\nconstraint sa != v; constraint q != nsw; constraint nsw != v;\nsolve satisfy;"
  }
}
```

### Cake baking optimisation

Maximise profit from baking banana and chocolate cakes given pantry constraints.

```json
{
  "tool": "minizinc_solve_model",
  "strings": ["var 0..100: b; var 0..100: c;\nconstraint 250*b + 200*c <= 4000;\nconstraint 2*b <= 6;\nconstraint 75*b + 150*c <= 2000;\nconstraint 100*b + 150*c <= 500;\nconstraint 75*c <= 500;\nsolve maximize 400*b + 450*c;"]
}
```

### Model with separate data (DZN)

```json
{
  "tool": "minizinc_solve_model",
  "files": { "loan.mzn": "<model code>" },
  "dzn_strings": ["principal = 1000.0; interest_rate = 0.04; num_periods = 10;"]
}
```

### Model with JSON data

```json
{
  "tool": "minizinc_solve_model",
  "files": { "square_pack.mzn": "<model code>" },
  "json_data": { "n": 3 },
  "time_limit_ms": 15000
}
```

---

## Development

```bash
npm install          # install dependencies
npm run build        # compile TypeScript → dist/
npm run dev          # run directly with tsx (stdio, no compile step)
npm run dev:http     # run in HTTP mode on port 3000
npm run inspect      # open MCP Inspector (stdio)
npm run inspect:dev  # open MCP Inspector against tsx source (stdio)
npm run inspect:http # open MCP Inspector against HTTP server
npm run lint         # lint with ESLint
```

### Transport options

The transport is selected by CLI flag or environment variable:

| Flag | Env var | Default |
|------|---------|---------|
| `--transport stdio\|http` | `MCP_TRANSPORT` | `stdio` |
| `--port 3000` | `PORT` | `3000` |
| `--host 0.0.0.0` | `HOST` | `0.0.0.0` |

```bash
# HTTP mode with custom port
node dist/index.js --transport http --port 8080

# Override MiniZinc binary path
MINIZINC_BIN=/opt/minizinc/bin/minizinc node dist/index.js
```

### Docker scripts

```bash
npm run docker:build    # build image (tag: minizinc-mcp)
npm run docker:run      # run container, expose port 3000
npm run docker:inspect  # open MCP Inspector against running container
```

Override the container runtime via the `DOCKER` env var:

```bash
DOCKER=nerdctl npm run docker:build
DOCKER=podman npm run docker:run
```

---

## Architecture

- **Language:** TypeScript compiled to ESM (`dist/`)
- **MCP SDK:** [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) v1.x (stdio + streamable HTTP transports)
- **Solver API:** [`minizinc`](https://www.npmjs.com/package/minizinc) npm package wrapping the native MiniZinc binary
- **HTTP framework:** Express with CORS enabled
- **Transports:** `stdio` (local/Claude Desktop) and streamable HTTP (Docker/remote)

## License

ISC
