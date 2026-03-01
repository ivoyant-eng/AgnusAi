import { TicketAdapter } from './base';
import { Ticket, TicketContext } from '../../types';

interface GitHubIssuesConfig {
  owner: string;
  repo: string;
  token: string;
}

export class GitHubIssuesAdapter implements TicketAdapter {
  readonly name = 'github-issues';
  private config: GitHubIssuesConfig;

  constructor(config: GitHubIssuesConfig) {
    this.config = config;
  }

  matches(ticketId: string): boolean {
    // GitHub issues: #123 or bare integers
    return /^#?\d+$/.test(ticketId);
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    const issueNumber = ticketId.replace(/^#/, '');
    const url = `https://api.github.com/repos/${this.config.owner}/${this.config.repo}/issues/${issueNumber}`;
    const response = await fetch(url, { headers: this.getAuthHeaders() });

    if (!response.ok) {
      throw new Error(`GitHubIssues: failed to fetch issue ${ticketId} — ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      id: number;
      number: number;
      title: string;
      body?: string | null;
      state: string;
      labels: Array<{ name: string }>;
      milestone?: { title: string } | null;
    };

    const labels = data.labels.map(l => l.name);
    if (data.milestone?.title) labels.push(`milestone:${data.milestone.title}`);

    return {
      id: String(data.id),
      key: `#${data.number}`,
      title: data.title,
      description: data.body ?? '',
      status: data.state,
      type: 'issue',
      labels,
    };
  }

  async getTicketContext(ticketId: string): Promise<TicketContext> {
    const ticket = await this.getTicket(ticketId);
    return { ticket, relatedPRs: [] };
  }
}
