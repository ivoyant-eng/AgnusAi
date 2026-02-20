#!/usr/bin/env node

import { Command } from 'commander';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { GitHubAdapter } from './adapters/vcs/github';
import { AzureDevOpsAdapter } from './adapters/vcs/azure-devops';
import { UnifiedLLMBackend, UnifiedLLMConfig, ProviderName } from './llm/unified';
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
  .requiredOption('--repo <repo>', 'Repository (owner/repo format)')
  .option('--vcs <vcs>', 'VCS platform (github|azure)', 'github')
  .option('--skill <skill>', 'Review skill to use', 'default')
  .option('--provider <provider>', 'LLM provider (ollama|openai|azure|custom)', 'ollama')
  .option('--model <model>', 'LLM model to use')
  .option('--dry-run', 'Show review without posting', false)
  .option('--output <format>', 'Output format (json|markdown)', 'markdown')
  .option('--config <path>', 'Path to config file', DEFAULT_CONFIG_PATH)
  .option('--incremental', 'Only review changes since last checkpoint (GitHub only)', false)
  .option('--force-full', 'Force full review, ignoring checkpoint', false)
  .action(async (options) => {
    try {
      // Load config
      const config = loadConfig(options.config);
      
      // Override with CLI options
      if (options.provider) {
        config.llm.provider = options.provider as ProviderName;
      }
      if (options.model) {
        config.llm.model = options.model;
      }

      // Parse repo
      const [owner, repo] = options.repo.split('/');
      if (!owner || !repo) {
        console.error('Invalid repo format. Use: owner/repo');
        process.exit(1);
      }

      // Initialize VCS adapter
      let vcs;
      if (options.vcs === 'github') {
        const token = process.env.GITHUB_TOKEN || config.vcs.github?.token;
        if (!token) {
          console.error('GitHub token required. Set GITHUB_TOKEN env or config.');
          process.exit(1);
        }
        vcs = new GitHubAdapter({ token, owner, repo });
      } else if (options.vcs === 'azure') {
        const azureConfig = config.vcs.azure;
        if (!azureConfig) {
          console.error('Azure DevOps config required in config file.');
          process.exit(1);
        }
        vcs = new AzureDevOpsAdapter({
          organization: azureConfig.organization,
          project: azureConfig.project,
          repository: repo,
          token: azureConfig.token
        });
      } else {
        console.error(`Unknown VCS: ${options.vcs}`);
        process.exit(1);
      }

      // Initialize LLM backend using unified connector
      const llmConfig = getLLMConfig(config.llm);
      const llm = new UnifiedLLMBackend(llmConfig);

      // Initialize skills
      const skillsPath = config.skills?.path || DEFAULT_SKILLS_PATH;
      const skillLoader = new SkillLoader(skillsPath);

      // Create agent
      const agent = new PRReviewAgent(config);
      agent.setVCS(vcs);
      agent.setLLM(llm);

      console.log(`\n🔍 Reviewing PR #${options.pr} in ${owner}/${repo}...\n`);

      // Run review - use incremental mode if requested
      let result;
      if (options.incremental && options.vcs === 'github') {
        result = await agent.incrementalReview(Number(options.pr), {
          forceFull: options.forceFull,
          skipCheckpoint: options.dryRun
        });
      } else {
        if (options.incremental) {
          console.log('⚠️  Incremental review only supported for GitHub. Running full review.');
        }
        result = await agent.review(Number(options.pr));
      }

      // Output result
      if (options.output === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printMarkdownReview(result);
      }

      // Post review if not dry-run
      if (!options.dryRun) {
        console.log('\n📤 Posting review...');
        await agent.postReview(Number(options.pr), result);
        console.log('✅ Review posted successfully!');
      } else {
        console.log('\n💨 Dry run - review not posted.');
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
      ignorePaths: ['node_modules', 'dist', 'build', '.git']
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

/**
 * Build UnifiedLLMConfig from the new config format with env var support
 */
function getLLMConfig(config: LLMConfig): UnifiedLLMConfig {
  const provider = config.provider as ProviderName;
  const model = config.model;

  // Get provider-specific settings from config
  const providerConfig = config.providers?.[provider] as {
    baseURL?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  } | undefined;

  const result: UnifiedLLMConfig = {
    provider,
    model,
    baseURL: providerConfig?.baseURL,
    apiKey: providerConfig?.apiKey,
  };

  // Environment variable overrides (highest priority)
  switch (provider) {
    case 'ollama':
      result.baseURL = process.env.OLLAMA_BASE_URL || result.baseURL || 'http://localhost:11434/v1';
      break;
    case 'openai':
      result.apiKey = process.env.OPENAI_API_KEY || result.apiKey;
      result.baseURL = process.env.OPENAI_BASE_URL || result.baseURL || 'https://api.openai.com/v1';
      break;
    case 'azure':
      result.apiKey = process.env.AZURE_OPENAI_KEY || result.apiKey;
      result.baseURL = process.env.AZURE_OPENAI_ENDPOINT || result.baseURL;
      break;
    case 'custom':
      result.apiKey = process.env.CUSTOM_API_KEY || result.apiKey;
      result.baseURL = process.env.CUSTOM_ENDPOINT || result.baseURL;
      break;
  }

  // Validate that cloud providers have API keys
  if ((provider === 'openai' || provider === 'azure' || provider === 'custom') && !result.apiKey) {
    console.error(`API key required for provider '${provider}'. Set the appropriate environment variable.`);
    process.exit(1);
  }

  // Validate that custom/azure have baseURL
  if ((provider === 'custom' || provider === 'azure') && !result.baseURL) {
    console.error(`baseURL is required for provider '${provider}'. Set it in config or environment variable.`);
    process.exit(1);
  }

  return result;
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