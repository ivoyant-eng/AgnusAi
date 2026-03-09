import { TicketAdapter } from './base';
import { Ticket, TicketContext } from '../../types';

interface AzureBoardsConfig {
  organization: string;
  project: string;
  token: string;
  baseUrl?: string;
}

export class AzureBoardsAdapter implements TicketAdapter {
  readonly name = 'azure-boards';
  private config: AzureBoardsConfig;
  private baseUrl: string;

  constructor(config: AzureBoardsConfig) {
    this.config = config;
    this.baseUrl = (config.baseUrl ?? 'https://dev.azure.com').replace(/\/$/, '');
  }

  matches(ticketId: string): boolean {
    // Azure Boards work items are numeric, optionally prefixed with #
    return /^#?\d+$/.test(ticketId);
  }

  private getAuthHeaders(): Record<string, string> {
    const encoded = Buffer.from(`:${this.config.token}`).toString('base64');
    return {
      'Authorization': `Basic ${encoded}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    const numericId = ticketId.replace(/^#/, '');
    const url =
      `${this.baseUrl}/${this.config.organization}/${encodeURIComponent(this.config.project)}` +
      `/_apis/wit/workitems/${numericId}?api-version=7.0&$expand=fields`;

    const response = await fetch(url, { headers: this.getAuthHeaders() });

    if (!response.ok) {
      throw new Error(`AzureBoards: failed to fetch work item ${ticketId} — ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      id: number;
      fields: Record<string, any>;
    };

    const f = data.fields;

    const rawTags: string = f['System.Tags'] ?? '';
    const labels = rawTags.split(';').map((t: string) => t.trim()).filter(Boolean);

    const rawAC: string = f['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? '';
    let acceptanceCriteria: string[] | undefined;
    if (rawAC) {
      const lines = this.stripHtml(rawAC)
        .split('\n')
        .map((s: string) => s.replace(/^[-*\d.)]+\s*/, '').trim())
        .filter(Boolean);
      if (lines.length > 0) acceptanceCriteria = lines;
    }

    return {
      id: String(data.id),
      key: `#${data.id}`,
      title: String(f['System.Title'] ?? ''),
      description: this.stripHtml(String(f['System.Description'] ?? '')),
      status: String(f['System.State'] ?? 'Unknown'),
      type: String(f['System.WorkItemType'] ?? 'Unknown'),
      labels,
      acceptanceCriteria,
    };
  }

  async getTicketContext(ticketId: string): Promise<TicketContext> {
    const ticket = await this.getTicket(ticketId);
    return { ticket, relatedPRs: [] };
  }
}
