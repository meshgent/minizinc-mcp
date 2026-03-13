import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';

// Resolve the default MiniZinc binary location so integration tests work
// even when the shell PATH doesn't include it (e.g. non-interactive Vitest runs).
const defaultBin = path.join(os.homedir(), 'minizinc', 'bin', 'minizinc');

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 60000, // MiniZinc solves can be slow
    env: {
      MINIZINC_BIN: process.env.MINIZINC_BIN ?? defaultBin,
    },
  },
});
