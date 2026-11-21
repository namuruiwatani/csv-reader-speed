// The harness runs `node /bot/main.ts` (node22). It answers every case from /input/cases.json and writes
// /output/answers.json: a JSON array of the answers, one per case and in the cases' order.
//
// The fast path works on the case document's bytes: fast2.js parses the CSV over the escaped JSON text and
// copies fields straight into the answer, so nothing is unescaped, escaped, parsed or stringified. It answers
// null when the document is outside what it takes, and this driver then answers the whole run with run()
// from solve.js, the character-level reader, which is exact for every input.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const { answersFromCases } = await import(new URL('./fast2.js', import.meta.url).href);

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = readFileSync(join(INPUT_DIR, 'cases.json'));
const fast = answersFromCases(raw);
if (fast) {
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), fast);
} else {
  const { run } = await import(new URL('./solve.js', import.meta.url).href);
  const cases = JSON.parse(raw.toString('utf8'));
  const answers = [];
  for (const c of cases) answers.push(run(c.input));
  writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
}
