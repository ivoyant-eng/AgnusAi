#!/usr/bin/env node

import { Command } from 'commander';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { GitHubAdapter } from './adapters/vcs/github';
import { AzureDevOpsAdapter } from './adapters/vcs/azure-devops';
import { createBackendFromEnv } from './llm/unified';
import { SkillLoader } from './skills/loader';
import { PRReviewAgent } from './index';
import { Config, LLMConfig } from './types';

const program = new Command();

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.pr-review', 'config.yaml');
const DEFAULT_SKILLS_PATH = path.join(os.homedir(), '.pr-review', 'skills');

program
  .name('pr-review')
  .description('AI-powered PR review agent with skills-based review system')
  .version('0.1.0');

program
  .command('review')
  .description('Review a pull request')
  .requiredOption('--pr <number>', 'Pull request number')
  .option('--repo <repo>', 'Repository in owner/repo format (standalone mode)')
  .option('--base-branch <branch>', 'Base branch the PR targets (default: main)', 'main')
  // ── Hosted service mode ──────────────────────────────────────────────────
  .option('--server <url>', 'AgnusAI server URL — delegates review to the server')
  .option('--api-key <key>', 'API key for the AgnusAI server (set API_KEY in server .env)')
  .option('--repo-id <id>', 'Repository ID from the dashboard (required with --server)')
  // ── Standalone mode ──────────────────────────────────────────────────────
  .option('--vcs <vcs>', 'VCS platform: github | azure (standalone only)', 'github')
  .option('--provider <provider>', 'LLM provider: ollama | openai | claude | azure (standalone only)', 'ollama')
  .option('--model <model>', 'Override LLM model name (standalone only)')
  .option('--dry-run', 'Print review without posting comments', false)
  .option('--output <format>', 'Output format: json | markdown', 'markdown')
  .option('--config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .option('--incremental', 'Only review new commits since last checkpoint (GitHub standalone only)', false)
  .option('--force-full', 'Force full review, ignoring checkpoint', false)
  .option('--skill <skill>', 'Review skill to use', 'default')
  .action(async (options) => {
    try {

      // ── Hosted service mode ─────────────────────────────────────────────
      if (options.server) {
        if (!options.repoId) {
          console.error('--repo-id is required when using --server mode.\nFind it in the dashboard URL: /app/ready/<repoId>');
          process.exit(1);
        }

        const serverUrl = options.server.replace(/\/$/, '');
        const url = `${serverUrl}/api/repos/${options.repoId}/review`;

        console.log(`\nTriggering review on ${serverUrl} for PR #${options.pr}...\n`);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (options.apiKey) headers['Authorization'] = `Bearer ${options.apiKey}`;

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            prNumber: Number(options.pr),
            baseBranch: options.baseBranch,
          }),
        });

        const body = await res.json() as Record<string, unknown>;

        if (!res.ok) {
          console.error(`Review failed (HTTP ${res.status}): ${body.error ?? JSON.stringify(body)}`);
          process.exit(1);
        }

        console.log(`Verdict:   ${body.verdict}`);
        console.log(`Comments:  ${body.commentCount}`);
        console.log(`\nReview posted to PR #${options.pr}.`);

        if (options.output === 'json') console.log(JSON.stringify(body, null, 2));
        return;
      }

      // ── Standalone mode ─────────────────────────────────────────────────
      if (!options.repo) {
        console.error('--repo is required in standalone mode (use --server for hosted service mode).');
        process.exit(1);
      }

      // Load config
      const config = loadConfig(options.config);
      if (options.provider) config.llm.provider = options.provider;
      if (options.model)    config.llm.model    = options.model;

      // Parse repo
      const [owner, repo] = options.repo.split('/');
      if (!owner || !repo) {
        console.error('Invalid --repo format. Use: owner/repo');
        process.exit(1);
      }

      // Initialize VCS adapter
      let vcs;
      if (options.vcs === 'github') {
        const token = process.env.GITHUB_TOKEN || config.vcs.github?.token;
        if (!token) {
          console.error('GitHub token required. Set GITHUB_TOKEN env var or config.');
          process.exit(1);
        }
        vcs = new GitHubAdapter({ token, owner, repo });
      } else if (options.vcs === 'azure') {
        const azureConfig = config.vcs.azure;
        const organization = process.env.AZURE_DEVOPS_ORG ?? azureConfig?.organization;
        const project      = process.env.AZURE_DEVOPS_PROJECT ?? azureConfig?.project;
        const token        = process.env.AZURE_DEVOPS_TOKEN ?? azureConfig?.token;
        if (!organization || !project || !token) {
          console.error(
            'Azure DevOps config required.\n' +
            'Set AZURE_DEVOPS_ORG, AZURE_DEVOPS_PROJECT, AZURE_DEVOPS_TOKEN env vars\n' +
            'or add vcs.azure to ~/.pr-review/config.yaml'
          );
          process.exit(1);
        }
        vcs = new AzureDevOpsAdapter({ organization, project, repository: repo, token });
      } else {
        console.error(`Unknown --vcs value: ${options.vcs}`);
        process.exit(1);
      }

      const llm   = createBackendFromEnv(process.env);
      const agent = new PRReviewAgent(config);
      agent.setVCS(vcs);
      agent.setLLM(llm);

      console.log(`\nReviewing PR #${options.pr} in ${owner}/${repo}...\n`);

      let result;
      if (options.incremental && options.vcs === 'github') {
        result = await agent.incrementalReview(Number(options.pr), {
          forceFull: options.forceFull,
          skipCheckpoint: options.dryRun,
        });
      } else {
        if (options.incremental) console.log('Incremental mode only supported for GitHub — running full review.');
        result = await agent.review(Number(options.pr));
      }

      if (options.output === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printMarkdownReview(result);
      }

      if (!options.dryRun) {
        console.log('\nPosting review...');
        await agent.postReview(Number(options.pr), result);
        console.log('Review posted successfully.');
      } else {
        console.log('\nDry run — review not posted.');
      }

    } catch (error) {
      console.error('Error:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

program
  .command('skills')
  .description('List available review skills')
  .option('--path <path>', 'Path to skills directory', DEFAULT_SKILLS_PATH)
  .action(async (options) => {
    const skillsPath = options.path;
    const loader = new SkillLoader(skillsPath);
    
    const skills = await loader.listSkills();
    
    console.log('\n📚 Available Skills:\n');
    if (skills.length === 0) {
      console.log('  No skills found. Create skills in: ' + skillsPath);
    } else {
      for (const skill of skills) {
        console.log(`  • ${skill.name} (${skill.priority}) - ${skill.description}`);
      }
    }
    console.log('');
  });

program
  .command('config')
  .description('Show current configuration')
  .option('--config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .action((options) => {
    const config = loadConfig(options.config);
    console.log('\n⚙️  Current Configuration:\n');
    console.log(yaml.dump(config, { indent: 2 }));
  });

function loadConfig(configPath: string): Config {
  const defaultConfig: Config = {
    vcs: {
      github: {
        token: ''
      }
    },
    tickets: [],
    llm: {
      provider: 'ollama',
      model: 'qwen3.5:cloud',
      providers: {
        ollama: {
          baseURL: 'http://localhost:11434/v1'
        }
      }
    },
    review: {
      maxDiffSize: 50000,
      focusAreas: [],
      ignorePaths: ['node_modules', 'dist', 'build', '.git'],
      enablePRDescription: true
    },
    skills: {
      path: DEFAULT_SKILLS_PATH,
      default: 'default'
    }
  };

  if (!fs.existsSync(configPath)) {
    console.log(`⚠️  Config not found at ${configPath}, using defaults.`);
    return defaultConfig;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = yaml.load(content) as Partial<Config>;
    return { ...defaultConfig, ...userConfig };
  } catch (error) {
    console.error(`Failed to load config: ${error}`);
    return defaultConfig;
  }
}


function printMarkdownReview(result: import('./types').ReviewResult): void {
  const verdictEmoji = {
    approve: '✅',
    request_changes: '🔄',
    comment: '💬'
  };

  console.log(`## ${verdictEmoji[result.verdict]} Review Summary\n`);
  console.log(result.summary);
  console.log('');

  if (result.comments.length > 0) {
    console.log('### Comments\n');
    for (const comment of result.comments) {
      const severityEmoji = {
        info: '💡',
        warning: '⚠️',
        error: '🚨'
      };
      console.log(`#### ${severityEmoji[comment.severity]} \`${comment.path}:${comment.line}\``);
      console.log(`${comment.body}\n`);
      if (comment.suggestion) {
        console.log(`**Suggestion:**\n\`\`\`\n${comment.suggestion}\n\`\`\`\n`);
      }
    }
  }

  console.log(`\n### Verdict: **${result.verdict}**`);
}

program.parse();
