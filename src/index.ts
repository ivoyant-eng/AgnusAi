// PR Review Agent - Main Entry Point

export { GitHubAdapter, createGitHubAdapter } from './adapters/vcs/github';
export { AzureDevOpsAdapter, createAzureDevOpsAdapter } from './adapters/vcs/azure-devops';
export { VCSAdapter } from './adapters/vcs/base';

export { JiraAdapter } from './adapters/ticket/jira';
export { LinearAdapter } from './adapters/ticket/linear';
export { TicketAdapter } from './adapters/ticket/base';

export { OllamaBackend, createOllamaBackend } from './llm/ollama';
export { ClaudeBackend, createClaudeBackend } from './llm/claude';
export { OpenAIBackend, createOpenAIBackend } from './llm/openai';
export { LLMBackend } from './llm/base';

export { SkillLoader } from './skills/loader';

export * from './types';

import { VCSAdapter } from './adapters/vcs/base';
import { TicketAdapter } from './adapters/ticket/base';
import { LLMBackend } from './llm/base';
import { SkillLoader } from './skills/loader';
import { ReviewContext, ReviewResult, ReviewComment, Diff, Config } from './types';


export class PRReviewAgent {
  private vcs: VCSAdapter;
  private tickets: TicketAdapter[];
  private llm: LLMBackend;
  private skills: SkillLoader;
  private config: Config;
  private lastDiff: Diff | null = null;

  constructor(config: Config) {
    this.config = config;
    // These will be initialized by factory methods
    this.vcs = null as any;
    this.tickets = [];
    this.llm = null as any;
    this.skills = new SkillLoader(config.skills.path);
  }

  setVCS(adapter: VCSAdapter): void {
    this.vcs = adapter;
  }

  setLLM(backend: LLMBackend): void {
    this.llm = backend;
  }

  addTicketAdapter(adapter: TicketAdapter): void {
    this.tickets.push(adapter);
  }

  async review(prId: string | number): Promise<ReviewResult> {
    // 1. Fetch PR data
    const pr = await this.vcs.getPR(prId);
    const diff = await this.vcs.getDiff(prId);
    const files = await this.vcs.getFiles(prId);

    // 2. Get linked tickets
    const linkedTicketIds = await this.vcs.getLinkedTickets(prId);
    const tickets = [];
    for (const adapter of this.tickets) {
      for (const id of linkedTicketIds) {
        try {
          const ticket = await adapter.getTicket(id.key);
          tickets.push(ticket);
        } catch {
          // Ticket not found in this adapter
        }
      }
    }

    // 3. Load applicable skills
    const applicableSkills = await this.skills.matchSkills(
      files.map(f => f.path)
    );

    // 4. Build context
    const context: ReviewContext = {
      pr,
      diff,
      files,
      tickets,
      skills: applicableSkills,
      config: this.config.review
    };

    // 5. Run review
    const result = await this.llm.generateReview(context);

    // Cache diff for use in postReview path validation
    this.lastDiff = diff;

    return result;
  }

  async postReview(prId: string | number, result: ReviewResult): Promise<void> {
    const { summary, verdict } = result;

    // Build a set of canonical diff paths (normalised: no leading slash) for matching
    const diff = this.lastDiff ?? await this.vcs.getDiff(prId);
    const diffPathMap = new Map<string, string>(); // normalised → original
    for (const f of diff.files) {
      diffPathMap.set(f.path.replace(/^\//, ''), f.path);
    }

    // Resolve each comment's path against actual diff paths
    const validComments: ReviewComment[] = [];
    for (const comment of result.comments) {
      const normalised = comment.path.replace(/^\//, '');
      const resolvedPath = diffPathMap.get(normalised);
      if (!resolvedPath) {
        console.warn(`⚠️  Skipping comment — path not in diff: ${comment.path}`);
        continue;
      }
      validComments.push({ ...comment, path: resolvedPath });
    }

    // Submit overall review — body is the model-generated markdown, used as-is
    await this.vcs.submitReview(prId, {
      summary,
      comments: validComments,
      verdict
    });
  }
}