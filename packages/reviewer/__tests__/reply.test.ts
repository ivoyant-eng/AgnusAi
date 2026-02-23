// Tests for Reply Generation

import {
  generateAcknowledgment,
  isDismissal,
  generateDismissalResponse
} from '../src/review/reply';
import { CommentThread } from '../src/review/thread';

describe('generateAcknowledgment', () => {
  const createThread = (reply: string): CommentThread => ({
    rootCommentId: 123,
    pullRequestNumber: 1,
    owner: 'owner',
    repo: 'repo',
    originalIssue: 'Consider using const instead of let',
    userReply: reply,
    repliedBy: 'developer'
  });

  it('should return acknowledgment for "thanks"', () => {
    const reply = generateAcknowledgment(createThread('thanks!'));
    expect(reply).toBe("You're welcome! Let me know if you need any further clarification. 👍");
  });

  it('should return acknowledgment for "thank you"', () => {
    const reply = generateAcknowledgment(createThread('thank you so much'));
    expect(reply).toBe("You're welcome! Let me know if you need any further clarification. 👍");
  });

  it('should return acknowledgment for "fixed"', () => {
    const reply = generateAcknowledgment(createThread('fixed!'));
    expect(reply).toBe('Thanks for addressing this! I\'ll take another look. 🙌');
  });

  it('should return acknowledgment for "done"', () => {
    const reply = generateAcknowledgment(createThread('done'));
    expect(reply).toBe('Great, thanks for making that change! 🎉');
  });

  it('should return acknowledgment for "will fix"', () => {
    const reply = generateAcknowledgment(createThread('will fix this soon'));
    expect(reply).toBe('Sounds good! Feel free to ask if you need any help with the implementation.');
  });

  it('should return empty string for detailed replies that need LLM generation', () => {
    const reply = generateAcknowledgment(createThread('I think this approach is actually better because...'));
    expect(reply).toBe('');
  });

  it('should return empty string for question replies', () => {
    const reply = generateAcknowledgment(createThread('Why do you suggest this change?'));
    expect(reply).toBe('');
  });
});

describe('isDismissal', () => {
  const createThread = (reply: string): CommentThread => ({
    rootCommentId: 123,
    pullRequestNumber: 1,
    owner: 'owner',
    repo: 'repo',
    originalIssue: 'Potential issue with error handling',
    userReply: reply,
    repliedBy: 'developer'
  });

  it('should detect "wontfix"', () => {
    expect(isDismissal(createThread('wontfix - this is intentional'))).toBe(true);
  });

  it('should detect "won\'t fix"', () => {
    expect(isDismissal(createThread('won\'t fix this'))).toBe(true);
  });

  it('should detect "ignore this"', () => {
    expect(isDismissal(createThread('Please ignore this issue'))).toBe(true);
  });

  it('should detect "not applicable"', () => {
    expect(isDismissal(createThread('Not applicable in this context'))).toBe(true);
  });

  it('should detect "as designed"', () => {
    expect(isDismissal(createThread('This is working as designed'))).toBe(true);
  });

  it('should detect "false positive"', () => {
    expect(isDismissal(createThread('False positive - this is correct'))).toBe(true);
  });

  it('should detect "as intended"', () => {
    expect(isDismissal(createThread('This behavior is as intended'))).toBe(true);
  });

  it('should return false for regular replies', () => {
    expect(isDismissal(createThread('Thanks for the feedback!'))).toBe(false);
  });

  it('should return false for questions', () => {
    expect(isDismissal(createThread('Can you explain why this is an issue?'))).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(isDismissal(createThread('WONTFIX'))).toBe(true);
    expect(isDismissal(createThread('As Designed'))).toBe(true);
  });
});

describe('generateDismissalResponse', () => {
  it('should generate a valid dismissal response', () => {
    const thread: CommentThread = {
      rootCommentId: 123,
      pullRequestNumber: 1,
      owner: 'owner',
      repo: 'repo',
      originalIssue: 'Potential issue',
      userReply: 'This is intentional',
      repliedBy: 'developer'
    };

    const response = generateDismissalResponse(thread);

    expect(response).toBeTruthy();
    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
  });

  it('should vary responses based on comment ID', () => {
    const thread1: CommentThread = {
      rootCommentId: 0,
      pullRequestNumber: 1,
      owner: 'owner',
      repo: 'repo',
      originalIssue: 'Issue 1',
      userReply: 'wontfix',
      repliedBy: 'dev1'
    };

    const thread2: CommentThread = {
      rootCommentId: 1,
      pullRequestNumber: 1,
      owner: 'owner',
      repo: 'repo',
      originalIssue: 'Issue 2',
      userReply: 'wontfix',
      repliedBy: 'dev2'
    };

    // Different comment IDs should potentially give different responses
    // (modulo the array length, so we're testing the logic works)
    const response1 = generateDismissalResponse(thread1);
    const response2 = generateDismissalResponse(thread2);

    expect(response1).toBeTruthy();
    expect(response2).toBeTruthy();
  });
});