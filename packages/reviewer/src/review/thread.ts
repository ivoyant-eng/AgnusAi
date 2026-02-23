// Comment Reply Thread Types and Utilities

import { ReviewComment, DetailedReviewComment, CommentMetadata, CommentDismissal } from '../types';

/**
 * Marker appended to all AgnusAI comments for identification
 * This allows us to detect when a user replies to our comments
 */
export const AGNUSAI_MARKER = '<!-- AGNUSAI: v1 -->';

/**
 * Metadata marker for storing comment context
 * Format: <!-- AGNUSAI_META: {...} -->
 */
export const AGNUSAI_META_MARKER_START = '<!-- AGNUSAI_META:';
export const AGNUSAI_META_MARKER_END = '-->';

/**
 * Represents a comment thread for reply handling
 */
export interface CommentThread {
  /** The root comment ID (the original AgnusAI comment) */
  rootCommentId: number;
  /** Pull request number */
  pullRequestNumber: number;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Original code snippet (if available) */
  originalCode?: string;
  /** The original issue/comment from AgnusAI */
  originalIssue: string;
  /** The user's reply text */
  userReply: string;
  /** The user who replied */
  repliedBy: string;
}

/**
 * GitHub comment structure from API
 */
export interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
    id: number;
    type: string;
  } | null;
  path?: string;
  position?: number | null;
  line?: number | null;
  commit_id?: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  pull_request_url?: string;
  in_reply_to_id?: number;
}

/**
 * Webhook payload for pull_request_review_comment event
 */
export interface ReviewCommentWebhookPayload {
  action: 'created' | 'edited' | 'deleted';
  comment: GitHubComment;
  pull_request: {
    number: number;
    html_url: string;
    base: {
      repo: {
        name: string;
        owner: {
          login: string;
        };
      };
    };
  };
  repository: {
    name: string;
    owner: {
      login: string;
    };
  };
}

/**
 * Check if a comment was created by AgnusAI
 * @param comment - The GitHub comment to check
 * @returns true if the comment contains the AgnusAI marker
 */
export function isAgnusaiComment(comment: GitHubComment): boolean {
  if (!comment.body) return false;
  return comment.body.trim().endsWith(AGNUSAI_MARKER);
}

/**
 * Extract the original issue text from an AgnusAI comment
 * Strips the marker and returns the content
 * @param comment - The AgnusAI comment
 * @returns The original issue text without the marker
 */
export function extractOriginalIssue(comment: GitHubComment): string {
  if (!comment.body) return '';
  
  let body = comment.body.trim();
  
  // Remove the marker if present
  if (body.endsWith(AGNUSAI_MARKER)) {
    body = body.slice(0, -AGNUSAI_MARKER.length).trim();
  }
  
  return body;
}

/**
 * Add the AgnusAI marker to a comment body
 * @param body - The comment body
 * @returns The body with the marker appended
 */
export function addAgnusaiMarker(body: string): string {
  // Don't add marker if already present
  if (body.trim().endsWith(AGNUSAI_MARKER)) {
    return body;
  }
  
  return `${body.trim()}\n\n${AGNUSAI_MARKER}`;
}

/**
 * Build a CommentThread from webhook payload
 * @param payload - The webhook payload
 * @param parentComment - The parent AgnusAI comment
 * @returns A CommentThread object
 */
export function buildCommentThread(
  payload: ReviewCommentWebhookPayload,
  parentComment: GitHubComment
): CommentThread {
  return {
    rootCommentId: parentComment.id,
    pullRequestNumber: payload.pull_request.number,
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    originalIssue: extractOriginalIssue(parentComment),
    userReply: payload.comment.body || '',
    repliedBy: payload.comment.user?.login || 'unknown'
  };
}

/**
 * Check if a webhook payload is a reply to an AgnusAI comment
 * @param payload - The webhook payload
 * @returns true if this is a reply (has in_reply_to_id and action is created)
 */
export function isReplyToComment(payload: ReviewCommentWebhookPayload): boolean {
  return (
    payload.action === 'created' &&
    typeof payload.comment.in_reply_to_id === 'number' &&
    payload.comment.in_reply_to_id > 0
  );
}