// GitHub Webhook Handler for Comment Reply Threads

import { LLMBackend } from '../llm/base';
import { createHmac } from 'crypto';
import {
  CommentThread,
  ReviewCommentWebhookPayload,
  GitHubComment,
  isAgnusaiComment,
  isReplyToComment,
  buildCommentThread,
  AGNUSAI_MARKER,
} from '../review/thread';
import {
  generateReply,
  generateAcknowledgment,
  isDismissal,
  generateDismissalResponse,
  ReplyContext,
} from '../review/reply';

/**
 * Configuration for the webhook handler
 */
export interface WebhookHandlerConfig {
  /** GitHub webhook secret for signature verification */
  webhookSecret: string;
  /** LLM backend for generating replies */
  llm: LLMBackend;
  /** GitHub API token for fetching comments and posting replies */
  githubToken: string;
  /** Optional: GitHub App ID (if using GitHub App auth) */
  githubAppId?: string;
  /** Optional: GitHub App private key (if using GitHub App auth) */
  githubAppPrivateKey?: string;
  /** Maximum time to wait for reply generation (ms) */
  replyTimeout?: number;
  /** Enable/disable automatic replies (default: true) */
  enableAutoReplies?: boolean;
}

/**
 * Result of handling a webhook event
 */
export interface WebhookHandlerResult {
  /** Whether the event was handled */
  handled: boolean;
  /** The action taken (if any) */
  action?: 'replied' | 'skipped' | 'ignored';
  /** Details about what happened */
  message?: string;
  /** The generated reply (if applicable) */
  reply?: string;
  /** Error details (if any) */
  error?: string;
}

/**
 * Response returned to GitHub webhook
 */
export interface WebhookResponse {
  statusCode: number;
  body: string;
}

/**
 * GitHub API client for webhook operations
 */
interface GitHubClient {
  getComment(owner: string, repo: string, commentId: number): Promise<GitHubComment>;
  createReply(owner: string, repo: string, prNumber: number, commentId: number, body: string): Promise<void>;
  getPR(owner: string, repo: string, prNumber: number): Promise<{ title: string; body: string | null; user: { login: string } }>;
}

/**
 * Simple GitHub API client for webhook operations
 */
class SimpleGitHubClient implements GitHubClient {
  private token: string;
  private baseUrl = 'https://api.github.com';

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'AgnusAI-Webhook/1.0',
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async getComment(owner: string, repo: string, commentId: number): Promise<GitHubComment> {
    return this.request<GitHubComment>('GET', `/repos/${owner}/${repo}/pulls/comments/${commentId}`);
  }

  async createReply(owner: string, repo: string, prNumber: number, commentId: number, body: string): Promise<void> {
    await this.request('POST', `/repos/${owner}/${repo}/pulls/${prNumber}/comments/${commentId}/replies`, {
      body,
    });
  }

  async getPR(owner: string, repo: string, prNumber: number): Promise<{ title: string; body: string | null; user: { login: string } }> {
    return this.request('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`);
  }
}

/**
 * Handler for GitHub webhook events related to comment replies
 */
export class WebhookHandler {
  private config: WebhookHandlerConfig;
  private github: GitHubClient;

  constructor(config: WebhookHandlerConfig) {
    this.config = {
      replyTimeout: 30000,
      enableAutoReplies: true,
      ...config,
    };
    this.github = new SimpleGitHubClient(config.githubToken);
  }

  /**
   * Verify the GitHub webhook signature
   * @param payload - The raw request body as string
   * @param signature - The X-Hub-Signature-256 header value
   * @returns true if signature is valid
   */
  verifySignature(payload: string, signature: string): boolean {
    if (!this.config.webhookSecret) {
      console.warn('No webhook secret configured - skipping signature verification');
      return true;
    }

    const expectedSignature = 'sha256=' + createHmac('sha256', this.config.webhookSecret)
      .update(payload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    if (signature.length !== expectedSignature.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < signature.length; i++) {
      result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Main entry point for handling webhook events
   * @param event - The X-GitHub-Event header value
   * @param payload - The parsed webhook payload
   * @returns Result of handling the event
   */
  async handleEvent(event: string, payload: unknown): Promise<WebhookHandlerResult> {
    // Only handle pull_request_review_comment events
    if (event !== 'pull_request_review_comment') {
      return { handled: false, action: 'ignored', message: `Ignoring event type: ${event}` };
    }

    if (!this.config.enableAutoReplies) {
      return { handled: true, action: 'skipped', message: 'Auto-replies disabled' };
    }

    const commentPayload = payload as ReviewCommentWebhookPayload;

    // Check if this is a reply to a comment
    if (!isReplyToComment(commentPayload)) {
      return { handled: true, action: 'skipped', message: 'Not a reply to a comment' };
    }

    try {
      return await this.handleReply(commentPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error handling reply:', message);
      return { handled: true, action: 'skipped', error: message };
    }
  }

  /**
   * Handle a reply to an AgnusAI comment
   */
  private async handleReply(payload: ReviewCommentWebhookPayload): Promise<WebhookHandlerResult> {
    const { repository, pull_request, comment } = payload;
    const owner = repository.owner.login;
    const repo = repository.name;

    // Fetch the parent comment
    const parentCommentId = comment.in_reply_to_id!;
    const parentComment = await this.github.getComment(owner, repo, parentCommentId);

    // Check if the parent comment is from AgnusAI
    if (!isAgnusaiComment(parentComment)) {
      return { 
        handled: true, 
        action: 'skipped', 
        message: 'Parent comment is not from AgnusAI' 
      };
    }

    // Build the thread context
    const thread = buildCommentThread(payload, parentComment);

    // Get PR context for reply generation
    const pr = await this.github.getPR(owner, repo, thread.pullRequestNumber);
    const replyContext: ReplyContext = {
      prTitle: pr.title,
      prDescription: pr.body || undefined,
      prAuthor: pr.user.login,
    };

    // Generate the reply
    let reply: string;

    // Check for dismissal scenarios first
    if (isDismissal(thread)) {
      reply = generateDismissalResponse(thread);
    } else {
      // Check for quick acknowledgments
      const quickReply = generateAcknowledgment(thread);
      
      if (quickReply) {
        reply = quickReply;
      } else {
        // Generate a full reply using LLM
        reply = await this.generateReplyWithTimeout(thread, replyContext);
      }
    }

    // Add the AgnusAI marker to identify our replies
    const markedReply = reply.trim() + '\n\n' + AGNUSAI_MARKER;

    // Post the reply
    await this.github.createReply(
      owner,
      repo,
      thread.pullRequestNumber,
      thread.rootCommentId,
      markedReply
    );

    return {
      handled: true,
      action: 'replied',
      message: `Replied to ${thread.repliedBy}'s comment on PR #${thread.pullRequestNumber}`,
      reply,
    };
  }

  /**
   * Generate reply with timeout protection
   */
  private async generateReplyWithTimeout(
    thread: CommentThread,
    context: ReplyContext
  ): Promise<string> {
    const timeout = this.config.replyTimeout!;

    const replyPromise = generateReply(thread, context, this.config.llm);
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('Reply generation timed out')), timeout);
    });

    try {
      return await Promise.race([replyPromise, timeoutPromise]);
    } catch (error) {
      // Fallback response on timeout or error
      return "Thanks for your reply! I'm processing this and will follow up shortly. In the meantime, if you have specific questions, feel free to ask. 👍";
    }
  }
}

/**
 * Create a webhook handler instance
 */
export function createWebhookHandler(config: WebhookHandlerConfig): WebhookHandler {
  return new WebhookHandler(config);
}

/**
 * Express/Connect middleware adapter for webhook handling
 * Usage with Express:
 * ```
 * const handler = createWebhookHandler({ ... });
 * app.post('/webhook', (req, res) => {
 *   const signature = req.headers['x-hub-signature-256'] as string;
 *   if (!handler.verifySignature(req.rawBody, signature)) {
 *     return res.status(401).send('Invalid signature');
 *   }
 *   const result = handler.handleEvent(req.headers['x-github-event'] as string, req.body);
 *   res.status(200).json(result);
 * });
 * ```
 */
export function createWebhookMiddleware(handler: WebhookHandler) {
  return async (req: { headers: Record<string, string | undefined>; body: unknown; rawBody?: string }, res: { status: (code: number) => { send: (body: string) => void }; json: (body: unknown) => void }) => {
    const event = req.headers['x-github-event'];
    const signature = req.headers['x-hub-signature-256'] || '';
    
    // Get raw body for signature verification
    const rawBody = req.rawBody || JSON.stringify(req.body);
    
    // Verify signature
    if (!handler.verifySignature(rawBody, signature)) {
      return res.status(401).send('Invalid signature');
    }

    // Handle the event
    const result = await handler.handleEvent(event || '', req.body);
    
    // Return appropriate response
    if (result.handled) {
      res.json(result);
    } else {
      res.status(200).send('Event acknowledged');
    }
  };
}