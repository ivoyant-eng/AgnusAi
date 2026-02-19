// Reply Generation for Comment Threads

import { LLMBackend } from '../llm/base';
import { CommentThread } from './thread';

/**
 * Context passed to reply generation
 */
export interface ReplyContext {
  /** PR title */
  prTitle: string;
  /** PR description */
  prDescription?: string;
  /** PR author */
  prAuthor: string;
  /** Additional context from previous discussion */
  previousReplies?: string[];
}

/**
 * Generate a contextual reply to a user's comment
 * @param thread - The comment thread context
 * @param context - Additional PR context
 * @param llm - The LLM backend to use for generation
 * @returns The generated reply body
 */
export async function generateReply(
  thread: CommentThread,
  context: ReplyContext,
  llm: LLMBackend
): Promise<string> {
  const prompt = buildReplyPrompt(thread, context);
  
  // Use the LLM to generate a response
  // Pass minimal context since we're doing single-turn generation
  const reply = await llm.generate(prompt, {
    pr: {
      id: String(thread.rootCommentId),
      number: thread.pullRequestNumber,
      title: context.prTitle,
      description: context.prDescription || '',
      author: {
        id: '',
        username: context.prAuthor
      },
      sourceBranch: '',
      targetBranch: '',
      url: '',
      createdAt: new Date(),
      updatedAt: new Date()
    },
    diff: {
      files: [],
      additions: 0,
      deletions: 0,
      changedFiles: 0
    },
    files: [],
    tickets: [],
    skills: [],
    config: {
      maxDiffSize: 0,
      focusAreas: [],
      ignorePaths: []
    }
  });

  return reply;
}

/**
 * Build the prompt for reply generation
 */
function buildReplyPrompt(thread: CommentThread, context: ReplyContext): string {
  let prompt = `You are AgnusAI, a helpful code review assistant. A user has replied to your review comment.

## Context
- PR Title: ${context.prTitle}
- PR Author: ${context.prAuthor}
${context.prDescription ? `- PR Description: ${context.prDescription}` : ''}

## Your Original Comment
${thread.originalIssue}

${thread.originalCode ? `## Original Code Snippet\n\`\`\`\n${thread.originalCode}\n\`\`\`\n` : ''}

## User's Reply
The user "${thread.repliedBy}" replied:
> ${thread.userReply}

${context.previousReplies && context.previousReplies.length > 0 
  ? `## Previous Replies in Thread\n${context.previousReplies.map(r => `> ${r}`).join('\n')}\n` 
  : ''}

## Instructions
Generate a helpful, concise response that:
1. Addresses the user's question or concern directly
2. Provides actionable guidance if they need to do something
3. Clarifies your original comment if there was confusion
4. Acknowledges valid points if the user disagrees
5. Remains professional and supportive

Keep your response focused and avoid repeating information unless necessary.
Do not include any markdown code blocks for marker comments - just provide your response.

Your response:`;

  return prompt;
}

/**
 * Generate a quick acknowledgment for simple replies
 * Use when the user's reply is a simple acknowledgment (e.g., "thanks", "will do")
 */
export function generateAcknowledgment(thread: CommentThread): string {
  const quickReplies: Record<string, string> = {
    thanks: "You're welcome! Let me know if you need any further clarification. 👍",
    thank: "You're welcome! Let me know if you need any further clarification. 👍",
    fixed: "Thanks for addressing this! I'll take another look. 🙌",
    done: "Great, thanks for making that change! 🎉",
    will: "Sounds good! Feel free to ask if you need any help with the implementation.",
    ok: "Understood. Let me know if you have any questions! 👍",
    okay: "Understood. Let me know if you have any questions! 👍",
    good: "Glad that was helpful! 🙌",
    understood: "Great! Let me know if you need any further guidance. 👍",
  };

  // Check for quick acknowledgment patterns
  const lowerReply = thread.userReply.toLowerCase().trim();
  
  for (const [key, response] of Object.entries(quickReplies)) {
    if (lowerReply.includes(key) && lowerReply.length < 50) {
      return response;
    }
  }

  // If no quick acknowledgment matches, return empty to signal full generation needed
  return '';
}

/**
 * Check if the user's reply indicates they want to dismiss the issue
 */
export function isDismissal(thread: CommentThread): boolean {
  const dismissalPatterns = [
    /\b(wontfix|won't fix)\b/i,
    /\b(ignore|ignoring)\s+(this|the\s+issue)\b/i,
    /\b(not\s+applicable|n\/a)\b/i,
    /\b(as\s+(designed|intended))\b/i,
    /\b(false\s+positive)\b/i,
  ];

  return dismissalPatterns.some(pattern => pattern.test(thread.userReply));
}

/**
 * Generate a response for dismissal scenarios
 */
export function generateDismissalResponse(thread: CommentThread): string {
  const responses = [
    "Understood, thanks for the clarification! I'll note that this was intentional. 👍",
    "Got it, thanks for explaining the context. This makes sense for this use case. 🙌",
    "Thanks for the feedback! I understand now why this design choice was made. 👍",
  ];

  // Pick a response based on the comment ID for variety
  return responses[thread.rootCommentId % responses.length];
}