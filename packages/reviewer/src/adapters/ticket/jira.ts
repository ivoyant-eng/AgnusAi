import { TicketAdapter } from './base';
import { Ticket, TicketContext } from '../../types';

interface JiraConfig {
  url: string;
  token: string;
  email: string;
  /** Custom field key for acceptance criteria — varies per Jira instance. */
  acceptanceCriteriaField?: string;
}

export class JiraAdapter implements TicketAdapter {
  readonly name = 'jira';
  private config: JiraConfig;

  constructor(config: JiraConfig) {
    this.config = config;
  }

  matches(ticketId: string): boolean {
    return /^[A-Z][A-Z0-9]+-\d+$/.test(ticketId);
  }

  private getAuthHeaders(): Record<string, string> {
    const encoded = Buffer.from(`${this.config.email}:${this.config.token}`).toString('base64');
    return {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  /** Minimal ADF (Atlassian Document Format) → plain text walker. */
  private adfToText(node: any): string {
    if (!node) return '';
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (Array.isArray(node.content)) {
      const text = node.content.map((child: any) => this.adfToText(child)).join('');
      const blockTypes = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock']);
      return blockTypes.has(node.type) ? text + '\n' : text;
    }
    return '';
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    const base = this.config.url.replace(/\/$/, '');
    const url = `${base}/rest/api/3/issue/${encodeURIComponent(ticketId)}`;
    const response = await fetch(url, { headers: this.getAuthHeaders() });

    if (!response.ok) {
      throw new Error(`Jira: failed to fetch ${ticketId} — ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      id: string;
      key: string;
      fields: {
        summary: string;
        description?: any;
        status: { name: string };
        issuetype: { name: string };
        labels?: string[];
        [key: string]: any;
      };
    };

    const { fields } = data;
    const description = fields.description ? this.adfToText(fields.description).trim() : '';

    // Acceptance criteria — try configured field, fallback to common default
    let acceptanceCriteria: string[] | undefined;
    const acFieldKey = this.config.acceptanceCriteriaField ?? 'customfield_10016';
    const acValue = fields[acFieldKey];
    if (acValue) {
      const raw = typeof acValue === 'string' ? acValue : this.adfToText(acValue);
      const lines = raw
        .split('\n')
        .map((s: string) => s.replace(/^[-*\d.)]+\s*/, '').trim())
        .filter(Boolean);
      if (lines.length > 0) acceptanceCriteria = lines;
    }

    return {
      id: data.id,
      key: data.key,
      title: fields.summary,
      description,
      status: fields.status?.name ?? 'Unknown',
      type: fields.issuetype?.name ?? 'Unknown',
      labels: fields.labels ?? [],
      acceptanceCriteria,
    };
  }

  async getTicketContext(ticketId: string): Promise<TicketContext> {
    const ticket = await this.getTicket(ticketId);
    return { ticket, relatedPRs: [] };
  }
}
