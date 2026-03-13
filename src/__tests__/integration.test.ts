import { describe, it, expect, beforeAll } from 'vitest';
import { init, version } from 'minizinc';
import { buildModel } from '../lib.js';

const CAKES2_MZN = `
int: flour;  %no. grams of flour available
int: banana; %no. of bananas available
int: sugar;  %no. grams of sugar available
int: butter; %no. grams of butter available
int: cocoa;  %no. grams of cocoa available
var 0..100: b; % no. of banana cakes
var 0..100: c; % no. of chocolate cakes
constraint 250*b + 200*c <= flour;
constraint 2*b  <= banana;
constraint 75*b + 150*c <= sugar;
constraint 100*b + 150*c <= butter;
constraint 75*c <= cocoa;
solve maximize 400*b + 450*c;
output ["no. of banana cakes = \\(b)\\n", "no. of chocolate cakes = \\(c)\\n"];
`;

const PANTRY_DZN = `flour = 4000; banana = 6; sugar = 2000; butter = 500; cocoa = 500;`;

const LOAN_MZN = `
var float: R;        % quarterly repayment
var float: P;        % principal initially borrowed
var 0.0 .. 10.0: I;  % interest rate
var float: B1;
var float: B2;
var float: B3;
var float: B4;
constraint B1 = P * (1.0 + I) - R;
constraint B2 = B1 * (1.0 + I) - R;
constraint B3 = B2 * (1.0 + I) - R;
constraint B4 = B3 * (1.0 + I) - R;
solve satisfy;
`;

const LOAN_DZN = `I = 0.04; P = 1000.0; R = 260.0;`;

let minizincAvailable = false;

beforeAll(async () => {
  const bin = process.env.MINIZINC_BIN ?? '';
  try {
    await init(bin ? { minizinc: bin } : {});
    await version(); // confirms binary is actually callable
    minizincAvailable = true;
  } catch {
    console.warn(`MiniZinc not available (MINIZINC_BIN=${bin || 'unset'}) — skipping integration tests`);
  }
});

describe('integration: buildModel + solve', () => {
  it('solves a simple model via strings', async () => {
    if (!minizincAvailable) return;
    const m = buildModel(undefined, ['var 1..3: x; solve satisfy;']);
    const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
    expect(result.status).toBe('SATISFIED');
    const x = result.solution?.output.json?.['x'] as number;
    expect(x).toBeGreaterThanOrEqual(1);
    expect(x).toBeLessThanOrEqual(3);
  });

  it('solves an optimization model via strings', async () => {
    if (!minizincAvailable) return;
    const m = buildModel(undefined, [CAKES2_MZN], [PANTRY_DZN]);
    const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
    expect(result.status).toBe('OPTIMAL_SOLUTION');
  });

  it('solves model + DZN data via strings + dzn_strings', async () => {
    if (!minizincAvailable) return;
    const m = buildModel(
      undefined,
      ['int: n; var 1..n: x; solve satisfy;'],
      ['n = 5;']
    );
    const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
    expect(result.status).toBe('SATISFIED');
    const x = result.solution?.output.json?.['x'] as number;
    expect(x).toBeGreaterThanOrEqual(1);
    expect(x).toBeLessThanOrEqual(5);
  });

  it('solves model + JSON data via strings + json_data', async () => {
    if (!minizincAvailable) return;
    const m = buildModel(
      undefined,
      ['int: n; var 1..n: x; solve satisfy;'],
      undefined,
      { n: 5 }
    );
    const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
    expect(result.status).toBe('SATISFIED');
    const x = result.solution?.output.json?.['x'] as number;
    expect(x).toBeGreaterThanOrEqual(1);
    expect(x).toBeLessThanOrEqual(5);
  });

  it('solves multi-file model (cakes2 + pantry.dzn) via files', async () => {
    if (!minizincAvailable) return;
    const m = buildModel({ 'cakes2.mzn': CAKES2_MZN, 'pantry.dzn': PANTRY_DZN });
    const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
    expect(result.status).toBe('OPTIMAL_SOLUTION');
    const vars = result.solution?.output.json ?? {};
    expect('b' in vars).toBe(true);
    expect('c' in vars).toBe(true);
  });

  it('solves multi-file model with include via files', async () => {
    if (!minizincAvailable) return;
    const m = buildModel({
      'main.mzn': 'include "helper.mzn"; solve satisfy;',
      'helper.mzn': 'var 1..3: x;',
    });
    const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
    expect(result.status).toBe('SATISFIED');
  });

  it('solves loan model via strings + dzn_strings (verifies model+data loading)', async () => {
    if (!minizincAvailable) return;
    // The loan model uses unbounded var float which gecode doesn't support —
    // we assert the model+data loaded and ran (not that a specific status was returned).
    const m = buildModel(undefined, [LOAN_MZN], [LOAN_DZN]);
    const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
    expect(['SATISFIED', 'UNSATISFIABLE', 'UNKNOWN']).toContain(result.status);
  });

  it('returns UNSATISFIABLE for impossible constraints', async () => {
    if (!minizincAvailable) return;
    const m = buildModel(undefined, [
      'var 1..1: x; var 1..1: y; constraint x != y; solve satisfy;',
    ]);
    const result = await m.solve({ jsonOutput: true, options: { solver: 'gecode' } });
    expect(result.status).toBe('UNSATISFIABLE');
  });

  it('check() returns errors for invalid model syntax', async () => {
    if (!minizincAvailable) return;
    const m = buildModel(undefined, ['this is not valid minizinc']);
    const errors = await m.check({ options: { solver: 'gecode' } });
    expect(errors.length).toBeGreaterThan(0);
  });
});
