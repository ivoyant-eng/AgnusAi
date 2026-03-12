import pkg from './packages/reviewer/dist/index.js';
const { dispatch } = pkg;

const mockLlm = {
  generate: async () => JSON.stringify({ command: 'fix', query: 'fix the null check', confidence: 0.95 }),
};

const tests = [
  { input: 'fix the null check on line 45', expected: 'fix' },
  { input: 'generate unit tests for the changed files', expected: 'test' },
  { input: 'what does this function do?', expected: 'ask' },
  { input: 'help', expected: 'help' },
  { input: '/fix apply the fix', expected: 'fix' },  // slash fast-path
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = await dispatch(t.input, mockLlm);
  const ok = result.command === t.expected;
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '✅' : '❌'} "${t.input}" → ${result.command} (expected: ${t.expected}, confidence: ${result.confidence})`);
}

console.log(`\nLayer 2: ${passed}/${tests.length} passed`);
