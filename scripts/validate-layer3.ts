/**
 * Layer 3 — VCS write adapter validation
 * Tests createBranch, commitFiles, openPR against a real GitHub repo.
 * Cleans up after itself (deletes test branch).
 */
import { GitHubAdapter } from './packages/reviewer/src/adapters/vcs/github';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

const token = process.env.GITHUB_TOKEN;
if (!token) { console.error('❌ GITHUB_TOKEN not set'); process.exit(1); }

const adapter = new GitHubAdapter({ token, owner: 'theashishmaurya', repo: 'AgnusAi' });
const testBranch = `ryv/validate-write-${Date.now()}`;

async function run() {
  let passed = 0, failed = 0;

  // --- Test 1: createBranch ---
  try {
    await adapter.createBranch!(testBranch, 'master');
    console.log(`✅ createBranch("${testBranch}", "master") — OK`);
    passed++;
  } catch (e: any) {
    console.error(`❌ createBranch failed: ${e.message}`);
    failed++;
    process.exit(1); // can't continue without a branch
  }

  // --- Test 2: commitFiles ---
  try {
    const sha = await adapter.commitFiles!(testBranch, [
      {
        path: '.ryv-validate.txt',
        content: `Ryv write validation — ${new Date().toISOString()}\nThis file is safe to delete.`,
      },
    ], 'test: ryv write adapter validation');
    console.log(`✅ commitFiles — OK (sha: ${sha.slice(0, 7)})`);
    passed++;
  } catch (e: any) {
    console.error(`❌ commitFiles failed: ${e.message}`);
    failed++;
  }

  // --- Test 3: openPR ---
  let prNumber: number | null = null;
  try {
    const pr = await adapter.openPR!({
      title: 'test: ryv write adapter validation (safe to close)',
      body: '> This PR was opened automatically by the Ryv write adapter validation script.\n> Safe to close and delete the branch.',
      head: testBranch,
      base: 'master',
    });
    console.log(`✅ openPR — OK (${pr.url})`);
    prNumber = pr.number;
    passed++;
  } catch (e: any) {
    console.error(`❌ openPR failed: ${e.message}`);
    failed++;
  }

  // --- Cleanup: close PR + delete branch ---
  if (prNumber) {
    try {
      // Close the PR via octokit (access private octokit via cast)
      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: token });
      await octokit.pulls.update({ owner: 'theashishmaurya', repo: 'AgnusAi', pull_number: prNumber, state: 'closed' });
      console.log(`🧹 Closed PR #${prNumber}`);
    } catch { /* ignore */ }
  }

  try {
    const { Octokit } = await import('@octokit/rest');
    const octokit = new Octokit({ auth: token });
    await octokit.git.deleteRef({ owner: 'theashishmaurya', repo: 'AgnusAi', ref: `heads/${testBranch}` });
    console.log(`🧹 Deleted branch ${testBranch}`);
  } catch { /* ignore */ }

  console.log(`\nLayer 3: ${passed}/3 passed`);
  if (failed > 0) process.exit(1);
}

run();
