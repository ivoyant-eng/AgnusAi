import { TicketAdapter } from './base';
import { Ticket, TicketContext } from '../../types';

interface LinearConfig {
  apiKey: string;
}

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

const GET_ISSUE_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      state { name }
      labels { nodes { name } }
      parent { identifier title }
    }
  }
`;

export class LinearAdapter implements TicketAdapter {
  readonly name = 'linear';
  private config: LinearConfig;

  constructor(config: LinearConfig) {
    this.config = config;
  }

  matches(ticketId: string): boolean {
    // Linear format: TEAM-123 (2-5 uppercase letters, then digits)
    return /^[A-Z]{2,5}-\d+$/.test(ticketId);
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      'Authorization': this.config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    const response = await fetch(LINEAR_ENDPOINT, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({ query: GET_ISSUE_QUERY, variables: { id: ticketId } }),
    });

    if (!response.ok) {
      throw new Error(`Linear: HTTP error ${response.status} ${response.statusText}`);
    }

    const json = await response.json() as {
      data?: {
        issue?: {
          id: string;
          identifier: string;
          title: string;
          description?: string;
          state?: { name: string };
          labels?: { nodes: Array<{ name: string }> };
          parent?: { identifier: string; title: string };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (json.errors?.length) {
      throw new Error(`Linear GraphQL error: ${json.errors.map(e => e.message).join(', ')}`);
    }

    const issue = json.data?.issue;
    if (!issue) throw new Error(`Linear: issue ${ticketId} not found`);

    const labels = issue.labels?.nodes.map(l => l.name) ?? [];
    if (issue.parent) labels.push(`parent:${issue.parent.identifier}`);

    return {
      id: issue.id,
      key: issue.identifier,
      title: issue.title,
      description: issue.description ?? '',
      status: issue.state?.name ?? 'Unknown',
      type: 'issue',
      labels,
    };
  }

  async getTicketContext(ticketId: string): Promise<TicketContext> {
    const ticket = await this.getTicket(ticketId);
    return { ticket, relatedPRs: [] };
  }
}
