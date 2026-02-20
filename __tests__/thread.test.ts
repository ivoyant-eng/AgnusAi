// Tests for Comment Thread Handling

import {
  AGNUSAI_MARKER,
  isAgnusaiComment,
  extractOriginalIssue,
  addAgnusaiMarker,
  isReplyToComment,
  buildCommentThread,
  GitHubComment,
  ReviewCommentWebhookPayload
} from '../src/review/thread';

describe('AGNUSAI_MARKER', () => {
  it('should be a valid HTML comment', () => {
    expect(AGNUSAI_MARKER).toBe('<!-- AGNUSAI: v1 -->');
  });

  it('should be detectable in comment body', () => {
    const body = 'This is a review comment.\n\n<!-- AGNUSAI: v1 -->';
    expect(body.endsWith(AGNUSAI_MARKER)).toBe(true);
  });
});

describe('isAgnusaiComment', () => {
  it('should return true for comments with the AgnusAI marker', () => {
    const comment: GitHubComment = {
      id: 123,
      body: 'Consider using a more descriptive variable name.\n\n<!-- AGNUSAI: v1 -->',
      user: { login: 'agnusai-bot', id: 12345, type: 'Bot' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r123'
    };

    expect(isAgnusaiComment(comment)).toBe(true);
  });

  it('should return false for comments without the marker', () => {
    const comment: GitHubComment = {
      id: 124,
      body: 'I think this looks good!',
      user: { login: 'human-user', id: 54321, type: 'User' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r124'
    };

    expect(isAgnusaiComment(comment)).toBe(false);
  });

  it('should return false for empty body', () => {
    const comment: GitHubComment = {
      id: 125,
      body: '',
      user: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r125'
    };

    expect(isAgnusaiComment(comment)).toBe(false);
  });

  it('should return false for null body', () => {
    const comment: GitHubComment = {
      id: 126,
      body: null as any,
      user: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r126'
    };

    expect(isAgnusaiComment(comment)).toBe(false);
  });

  it('should handle marker not at end', () => {
    const comment: GitHubComment = {
      id: 127,
      body: '<!-- AGNUSAI: v1 -->\nSome text',
      user: { login: 'test', id: 1, type: 'User' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r127'
    };

    expect(isAgnusaiComment(comment)).toBe(false);
  });
});

describe('extractOriginalIssue', () => {
  it('should extract the issue text without the marker', () => {
    const comment: GitHubComment = {
      id: 123,
      body: 'Consider using a more descriptive variable name.\n\n<!-- AGNUSAI: v1 -->',
      user: { login: 'agnusai-bot', id: 12345, type: 'Bot' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r123'
    };

    expect(extractOriginalIssue(comment)).toBe('Consider using a more descriptive variable name.');
  });

  it('should return body unchanged if no marker', () => {
    const comment: GitHubComment = {
      id: 124,
      body: 'Regular comment without marker',
      user: { login: 'user', id: 1, type: 'User' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r124'
    };

    expect(extractOriginalIssue(comment)).toBe('Regular comment without marker');
  });

  it('should handle empty body', () => {
    const comment: GitHubComment = {
      id: 125,
      body: '',
      user: null,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r125'
    };

    expect(extractOriginalIssue(comment)).toBe('');
  });
});

describe('addAgnusaiMarker', () => {
  it('should add the marker to a comment body', () => {
    const body = 'This is a review comment.';
    const result = addAgnusaiMarker(body);

    expect(result).toBe(`This is a review comment.\n\n${AGNUSAI_MARKER}`);
  });

  it('should not duplicate the marker if already present', () => {
    const body = `Already has a marker.\n\n${AGNUSAI_MARKER}`;
    const result = addAgnusaiMarker(body);

    expect(result).toBe(body);
    expect(result.split(AGNUSAI_MARKER).length).toBe(2); // Only one marker
  });

  it('should trim whitespace before adding marker', () => {
    const body = '  Comment with whitespace  \n\n';
    const result = addAgnusaiMarker(body);

    expect(result.trim().endsWith(AGNUSAI_MARKER)).toBe(true);
  });
});

describe('isReplyToComment', () => {
  it('should return true for created action with in_reply_to_id', () => {
    const payload: ReviewCommentWebhookPayload = {
      action: 'created',
      comment: {
        id: 456,
        body: 'Thanks for the feedback!',
        user: { login: 'developer', id: 111, type: 'User' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1#discussion_r456',
        in_reply_to_id: 123
      },
      pull_request: {
        number: 1,
        html_url: 'https://github.com/owner/repo/pull/1',
        base: {
          repo: {
            name: 'repo',
            owner: { login: 'owner' }
          }
        }
      },
      repository: {
        name: 'repo',
        owner: { login: 'owner' }
      }
    };

    expect(isReplyToComment(payload)).toBe(true);
  });

  it('should return false for edited action', () => {
    const payload: ReviewCommentWebhookPayload = {
      action: 'edited',
      comment: {
        id: 456,
        body: 'Updated reply',
        user: { login: 'developer', id: 111, type: 'User' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T01:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1#discussion_r456',
        in_reply_to_id: 123
      },
      pull_request: {
        number: 1,
        html_url: 'https://github.com/owner/repo/pull/1',
        base: {
          repo: {
            name: 'repo',
            owner: { login: 'owner' }
          }
        }
      },
      repository: {
        name: 'repo',
        owner: { login: 'owner' }
      }
    };

    expect(isReplyToComment(payload)).toBe(false);
  });

  it('should return false for new comments (no in_reply_to_id)', () => {
    const payload: ReviewCommentWebhookPayload = {
      action: 'created',
      comment: {
        id: 789,
        body: 'New comment',
        user: { login: 'developer', id: 111, type: 'User' },
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1#discussion_r789'
      },
      pull_request: {
        number: 1,
        html_url: 'https://github.com/owner/repo/pull/1',
        base: {
          repo: {
            name: 'repo',
            owner: { login: 'owner' }
          }
        }
      },
      repository: {
        name: 'repo',
        owner: { login: 'owner' }
      }
    };

    expect(isReplyToComment(payload)).toBe(false);
  });
});

describe('buildCommentThread', () => {
  it('should build a CommentThread from webhook payload', () => {
    const parentComment: GitHubComment = {
      id: 123,
      body: 'Original issue text\n\n<!-- AGNUSAI: v1 -->',
      user: { login: 'agnusai-bot', id: 12345, type: 'Bot' },
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      html_url: 'https://github.com/owner/repo/pull/1#discussion_r123',
      path: 'src/index.ts',
      line: 42
    };

    const payload: ReviewCommentWebhookPayload = {
      action: 'created',
      comment: {
        id: 456,
        body: 'I fixed this in my last commit',
        user: { login: 'developer', id: 111, type: 'User' },
        created_at: '2024-01-01T01:00:00Z',
        updated_at: '2024-01-01T01:00:00Z',
        html_url: 'https://github.com/owner/repo/pull/1#discussion_r456',
        in_reply_to_id: 123
      },
      pull_request: {
        number: 1,
        html_url: 'https://github.com/owner/repo/pull/1',
        base: {
          repo: {
            name: 'repo',
            owner: { login: 'owner' }
          }
        }
      },
      repository: {
        name: 'repo',
        owner: { login: 'owner' }
      }
    };

    const thread = buildCommentThread(payload, parentComment);

    expect(thread.rootCommentId).toBe(123);
    expect(thread.pullRequestNumber).toBe(1);
    expect(thread.owner).toBe('owner');
    expect(thread.repo).toBe('repo');
    expect(thread.originalIssue).toBe('Original issue text');
    expect(thread.userReply).toBe('I fixed this in my last commit');
    expect(thread.repliedBy).toBe('developer');
  });
});