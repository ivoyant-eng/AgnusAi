import { dispatch } from './packages/reviewer/src/commands/dispatcher';

// Keyword-based mock that simulates real NLP classification
const mockLlm: any = {
  generate: async (_prompt: string, _ctx: any, _temp: number) => {
    // Extract the user message from the prompt (last quoted line)
    const match = _prompt.match(/User message: "(.+)"/);
    const input = match?.[1] ?? '';
    const lower = input.toLowerCase();

    let command = 'ask';
    if (/\bfix\b|\brepair\b|\bcorrect\b/.test(lower)) command = 'fix';
    else if (/\btest\b|\bspec\b|\bunit test/.test(lower)) command = 'test';
    else if (/\bhelp\b|\bwhat can you/.test(lower)) command = 'help';
    else if (/\breview\b|\bre-review\b/.test(lower)) command = 'review';

    return JSON.stringify({ command, query: input, confidence: 0.92 });
  },
};

const tests = [
  { input: 'fix the null check on line 45', expected: 'fix' },
  { input: 'generate unit tests for the changed files', expected: 'test' },
  { input: 'what does this function do?', expected: 'ask' },
  { input: 'help', expected: 'help' },
  { input: '/fix apply the fix', expected: 'fix' },
  { input: '', expected: 'help' },
];

async function run() {
  let passed = 0, failed = 0;
  for (const t of tests) {
    const result = await dispatch(t.input, mockLlm);
    const ok = result.command === t.expected;
    ok ? passed++ : failed++;
    console.log(`${ok ? '✅' : '❌'} "${t.input}" → ${result.command} (expected: ${t.expected}, confidence: ${result.confidence.toFixed(2)})`);
  }
  console.log(`\nLayer 2: ${passed}/${tests.length} passed`);
  if (failed > 0) process.exit(1);
}

run();
