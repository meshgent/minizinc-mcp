import { describe, it, expect } from 'vitest';
import { formatError, formatSolveResult, jsonString, modelInputSchema } from '../lib.js';
import { z } from 'zod';

// --- formatError ---
describe('formatError', () => {
  it('formats ErrorMessage array', () => {
    const errors = [
      { what: 'type error', message: 'cannot unify int and bool' },
      { what: 'syntax error', message: 'unexpected token' },
    ];
    const result = formatError(errors);
    expect(result).toBe('[type error] cannot unify int and bool\n[syntax error] unexpected token');
  });

  it('returns message for Error instances', () => {
    expect(formatError(new Error('something went wrong'))).toBe('something went wrong');
  });

  it('JSON-stringifies plain objects', () => {
    const obj = { code: 42, reason: 'oops' };
    expect(formatError(obj)).toBe(JSON.stringify(obj));
  });

  it('converts other values with String()', () => {
    expect(formatError('raw string')).toBe('raw string');
    expect(formatError(123)).toBe('123');
  });
});

// --- formatSolveResult ---
describe('formatSolveResult', () => {
  it('includes status, output, and variables when solution present', () => {
    const result = {
      status: 'SATISFIED',
      solution: { output: { default: 'x = 2\n', json: { x: 2 } } },
      statistics: {},
    };
    const parsed = JSON.parse(formatSolveResult(result));
    expect(parsed.status).toBe('SATISFIED');
    expect(parsed.output).toBe('x = 2\n');
    expect(parsed.variables).toEqual({ x: 2 });
    expect(parsed.statistics).toBeUndefined();
  });

  it('omits output/variables when no solution', () => {
    const result = { status: 'UNSATISFIABLE', solution: null, statistics: {} };
    const parsed = JSON.parse(formatSolveResult(result));
    expect(parsed.status).toBe('UNSATISFIABLE');
    expect(parsed.output).toBeUndefined();
    expect(parsed.variables).toBeUndefined();
  });

  it('includes statistics when non-empty', () => {
    const result = {
      status: 'OPTIMAL_SOLUTION',
      solution: { output: { json: { x: 3 } } },
      statistics: { solveTime: 0.012 },
    };
    const parsed = JSON.parse(formatSolveResult(result));
    expect(parsed.statistics).toEqual({ solveTime: 0.012 });
  });
});

// --- jsonString ---
describe('jsonString', () => {
  it('passes through an object unchanged', () => {
    const schema = jsonString(z.object({ n: z.number() }));
    expect(schema.parse({ n: 5 })).toEqual({ n: 5 });
  });

  it('parses a JSON string into an object', () => {
    const schema = jsonString(z.object({ n: z.number() }));
    expect(schema.parse('{"n":5}')).toEqual({ n: 5 });
  });

  it('parses a JSON string into an array', () => {
    const schema = jsonString(z.array(z.string()));
    expect(schema.parse('["a","b"]')).toEqual(['a', 'b']);
  });
});

// --- modelInputSchema ---
describe('modelInputSchema', () => {
  it('strings — validates an array', () => {
    const schema = z.object({ strings: modelInputSchema.strings });
    const result = schema.parse({ strings: ['var 1..3: x; solve satisfy;'] });
    expect(result.strings).toEqual(['var 1..3: x; solve satisfy;']);
  });

  it('strings — auto-parses a JSON string (MCP client coercion fix)', () => {
    const schema = z.object({ strings: modelInputSchema.strings });
    const result = schema.parse({ strings: '["var 1..3: x; solve satisfy;"]' });
    expect(result.strings).toEqual(['var 1..3: x; solve satisfy;']);
  });

  it('files — auto-parses a JSON string', () => {
    const schema = z.object({ files: modelInputSchema.files });
    const result = schema.parse({ files: '{"model.mzn":"var 1..3: x; solve satisfy;"}' });
    expect(result.files).toEqual({ 'model.mzn': 'var 1..3: x; solve satisfy;' });
  });

  it('dzn_strings — auto-parses a JSON string', () => {
    const schema = z.object({ dzn_strings: modelInputSchema.dzn_strings });
    const result = schema.parse({ dzn_strings: '["n = 5;"]' });
    expect(result.dzn_strings).toEqual(['n = 5;']);
  });
});
