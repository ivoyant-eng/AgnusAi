/**
 * Unit tests for AzureDevOpsAdapter
 *
 * Every HTTP call is intercepted by a mock of node-fetch so tests run offline
 * and deterministically. The test surface covers:
 *  - methods that were buggy (updateReviewComment, getReviewComments, getPRComments)
 *  - methods that were missing (createReply, getReviewComment, deleteCheckpointComment)
 *  - the previously-working paths that touch the same code (submitReview, addInlineComment,
 *    findCheckpointComment, createCheckpointComment, updateCheckpointComment)
 *
 * Nothing here hits the real Azure DevOps REST API.
 */

import { AzureDevOpsAdapter } from '../src/adapters/vcs/azure-devops';

// ── Mock node-fetch ──────────────────────────────────────────────────────────
jest.mock('node-fetch', () => jest.fn());
import fetch from 'node-fetch';
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

// Helper: build a minimal fetch response
function mockResponse(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : String(status),
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

// ── Adapter under test ───────────────────────────────────────────────────────
function makeAdapter() {
  return new AzureDevOpsAdapter({
    organization: 'myorg',
    project: 'myproject',
    repository: 'myrepo',
    token: 'test-pat',
    baseUrl: 'https://dev.azure.com',
  });
}

const PR_ID = 42;
const BASE_URL = 'https://dev.azure.com/myorg/myproject/_apis/git/repositories/myrepo';

// ── Test data ────────────────────────────────────────────────────────────────
const inlineThread = {
  id: 100,
  threadContext: { filePath: '/src/index.ts', rightFileStart: { line: 10, offset: 1 } },
  comments: [
    {
      id: 1,
      content: 'Found a bug here. Was this helpful? [👍](x)',
      author: { displayName: 'AgnusAI', uniqueName: 'agnus@bot' },
      publishedDate: '2024-01-01T00:00:00Z',
      lastUpdatedDate: '2024-01-01T00:00:00Z',
      parentCommentId: 0,
    },
  ],
  isDeleted: false,
  status: 'active',
};

const prLevelThread = {
  id: 200,
  threadContext: null,
  comments: [
    {
      id: 1,
      content: '<!-- AGNUSAI_CHECKPOINT: {"sha":"abc123","timestamp":1708365600,"filesReviewed":["src/index.ts"],"commentCount":3,"verdict":"approve"} -->\n## 🔍 AgnusAI Review Checkpoint',
      author: { displayName: 'AgnusAI', uniqueName: 'agnus@bot' },
      publishedDate: '2024-01-01T00:00:00Z',
      lastUpdatedDate: '2024-01-01T00:00:00Z',
    },
  ],
  isDeleted: false,
  status: 'active',
};

// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset();
});

// ── getReviewComments ────────────────────────────────────────────────────────
describe('getReviewComments', () => {
  it('returns thread.id as the comment id (not NaN from composite encoding)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ value: [inlineThread] }));
    const adapter = makeAdapter();
    const comments = await adapter.getReviewComments(PR_ID);

    expect(comments).toHaveLength(1);
    // Before the fix this was Number("100-1") = NaN
    expect(comments[0].id).toBe(100);
    expect(Number.isNaN(comments[0].id)).toBe(false);
  });

  it('strips the leading slash from file paths', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ value: [inlineThread] }));
    const adapter = makeAdapter();
    const comments = await adapter.getReviewComments(PR_ID);

    expect(comments[0].path).toBe('src/index.ts');
  });

  it('skips deleted threads', async () => {
    const deleted = { ...inlineThread, isDeleted: true };
    mockFetch.mockResolvedValueOnce(mockResponse({ value: [deleted, inlineThread] }));
    const adapter = makeAdapter();
    const comments = await adapter.getReviewComments(PR_ID);

    expect(comments).toHaveLength(1);
  });

  it('paginates until results dry up', async () => {
    // First page: full 100 results (use a tiny fake array of length 100 via Array.from)
    const page1 = { value: Array.from({ length: 100 }, (_, i) => ({ ...inlineThread, id: i + 1 })) };
    const page2 = { value: [{ ...inlineThread, id: 101 }] };
    mockFetch
      .mockResolvedValueOnce(mockResponse(page1))
      .mockResolvedValueOnce(mockResponse(page2));

    const adapter = makeAdapter();
    const comments = await adapter.getReviewComments(PR_ID);

    expect(comments).toHaveLength(101);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── getPRComments ────────────────────────────────────────────────────────────
describe('getPRComments', () => {
  it('returns only threads with no file context, using thread.id', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ value: [inlineThread, prLevelThread] })
    );
    const adapter = makeAdapter();
    const comments = await adapter.getPRComments(PR_ID);

    expect(comments).toHaveLength(1);
    expect(comments[0].id).toBe(200);           // thread id, not NaN
    expect(Number.isNaN(comments[0].id)).toBe(false);
  });

  it('skips deleted threads', async () => {
    const deletedPrThread = { ...prLevelThread, isDeleted: true };
    mockFetch.mockResolvedValueOnce(
      mockResponse({ value: [deletedPrThread] })
    );
    const adapter = makeAdapter();
    const comments = await adapter.getPRComments(PR_ID);
    expect(comments).toHaveLength(0);
  });
});

// ── updateReviewComment ──────────────────────────────────────────────────────
describe('updateReviewComment', () => {
  it('PATCHes the correct URL including comment sequence id 1', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}));
    const adapter = makeAdapter();
    await adapter.updateReviewComment(PR_ID, 100, 'updated body');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    // Must include both the thread id AND the comment sequence id (1)
    expect(url).toContain('/threads/100/comments/1');
    expect(opts?.method).toBe('PATCH');
    expect(JSON.parse(opts?.body as string)).toEqual({ content: 'updated body' });
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, 404));
    const adapter = makeAdapter();
    await expect(adapter.updateReviewComment(PR_ID, 100, 'x')).rejects.toThrow('404');
  });
});

// ── deleteReviewComment ──────────────────────────────────────────────────────
describe('deleteReviewComment', () => {
  it('DELETEs comment 1 of the thread', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, 204));
    const adapter = makeAdapter();
    await adapter.deleteReviewComment(PR_ID, 100);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/threads/100/comments/1');
    expect(opts?.method).toBe('DELETE');
  });

  it('falls back to closing the thread when DELETE returns 403', async () => {
    // First call: DELETE → 403
    mockFetch.mockResolvedValueOnce(mockResponse({}, 403));
    // Second call: PATCH thread to close
    mockFetch.mockResolvedValueOnce(mockResponse({}));

    const adapter = makeAdapter();
    await adapter.deleteReviewComment(PR_ID, 100);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [closeUrl, closeOpts] = mockFetch.mock.calls[1];
    expect(closeUrl).toContain('/threads/100');
    expect(JSON.parse(closeOpts?.body as string)).toEqual({ status: 'closed' });
  });
});

// ── createReply ──────────────────────────────────────────────────────────────
describe('createReply', () => {
  it('POSTs a reply with parentCommentId: 1 to the thread', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 2 }));
    const adapter = makeAdapter();
    await adapter.createReply(PR_ID, 100, 'LGTM!');

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain(`/pullrequests/${PR_ID}/threads/100/comments`);
    expect(opts?.method).toBe('POST');
    const body = JSON.parse(opts?.body as string);
    expect(body.parentCommentId).toBe(1);
    expect(body.content).toBe('LGTM!');
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({}, 500));
    const adapter = makeAdapter();
    await expect(adapter.createReply(PR_ID, 100, 'reply')).rejects.toThrow('500');
  });
});

// ── getReviewComment ─────────────────────────────────────────────────────────
describe('getReviewComment', () => {
  it('returns the root comment of the thread', async () => {
    // Seed _activePrId by calling getReviewComments first
    mockFetch.mockResolvedValueOnce(mockResponse({ value: [inlineThread] }));
    const adapter = makeAdapter();
    await adapter.getReviewComments(PR_ID); // sets _activePrId

    mockFetch.mockResolvedValueOnce(mockResponse(inlineThread));
    const comment = await adapter.getReviewComment(100);

    expect(comment.id).toBe(100);
    expect(comment.path).toBe('src/index.ts');
    expect(comment.line).toBe(10);
    expect(comment.body).toContain('Found a bug');
  });

  it('throws if _activePrId is not set', async () => {
    const adapter = makeAdapter();
    await expect(adapter.getReviewComment(100)).rejects.toThrow('_activePrId');
  });
});

// ── findCheckpointComment ────────────────────────────────────────────────────
describe('findCheckpointComment', () => {
  it('finds a checkpoint thread and returns thread.id', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ value: [inlineThread, prLevelThread] })
    );
    const adapter = makeAdapter();
    const result = await adapter.findCheckpointComment(PR_ID);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(200);
    expect(result!.body).toContain('AGNUSAI_CHECKPOINT');
  });

  it('returns null when no checkpoint thread exists', async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ value: [inlineThread] })
    );
    const adapter = makeAdapter();
    const result = await adapter.findCheckpointComment(PR_ID);
    expect(result).toBeNull();
  });
});

// ── createCheckpointComment ──────────────────────────────────────────────────
describe('createCheckpointComment', () => {
  it('POSTs a PR-level thread and returns the thread id as string', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 999 }));
    const adapter = makeAdapter();
    const checkpoint = {
      sha: 'abc123', timestamp: 1708365600,
      filesReviewed: ['src/a.ts'], commentCount: 2, verdict: 'approve' as const,
    };
    const id = await adapter.createCheckpointComment(PR_ID, checkpoint);

    expect(id).toBe('999');
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain(`/pullrequests/${PR_ID}/threads`);
    expect(opts?.method).toBe('POST');
    const body = JSON.parse(opts?.body as string);
    expect(body.comments[0].content).toContain('AGNUSAI_CHECKPOINT');
  });
});

// ── updateCheckpointComment ──────────────────────────────────────────────────
describe('updateCheckpointComment', () => {
  it('PATCHes /threads/{id}/comments/1 using the stored prId', async () => {
    // Create the checkpoint first — this sets _activePrId
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 200 }));
    const adapter = makeAdapter();
    const checkpoint = {
      sha: 'abc123', timestamp: 1708365600,
      filesReviewed: [], commentCount: 0, verdict: 'comment' as const,
    };
    await adapter.createCheckpointComment(PR_ID, checkpoint);

    mockFetch.mockResolvedValueOnce(mockResponse({}));
    await adapter.updateCheckpointComment(200, checkpoint);

    const [url, opts] = mockFetch.mock.calls[1];
    // No wildcard — must use the actual PR id
    expect(url).not.toContain('*');
    expect(url).toContain(`/pullrequests/${PR_ID}/threads/200/comments/1`);
    expect(opts?.method).toBe('PATCH');
  });

  it('throws when _activePrId is not set', async () => {
    const adapter = makeAdapter();
    const cp = { sha: 'x', timestamp: 0, filesReviewed: [], commentCount: 0, verdict: 'comment' as const };
    await expect(adapter.updateCheckpointComment(200, cp)).rejects.toThrow('active prId');
  });
});

// ── deleteCheckpointComment ──────────────────────────────────────────────────
describe('deleteCheckpointComment', () => {
  it('DELETEs comment 1 of the checkpoint thread', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 200 })); // createCheckpointComment
    mockFetch.mockResolvedValueOnce(mockResponse({}, 204));      // delete

    const adapter = makeAdapter();
    const cp = { sha: 'x', timestamp: 0, filesReviewed: [], commentCount: 0, verdict: 'comment' as const };
    await adapter.createCheckpointComment(PR_ID, cp);
    await adapter.deleteCheckpointComment(200);

    const [url, opts] = mockFetch.mock.calls[1];
    expect(url).toContain(`/pullrequests/${PR_ID}/threads/200/comments/1`);
    expect(opts?.method).toBe('DELETE');
  });

  it('falls back to closing the thread when DELETE is not allowed', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 200 })); // createCheckpointComment
    mockFetch.mockResolvedValueOnce(mockResponse({}, 403));     // delete fails
    mockFetch.mockResolvedValueOnce(mockResponse({}));          // closeThread PATCH

    const adapter = makeAdapter();
    const cp = { sha: 'x', timestamp: 0, filesReviewed: [], commentCount: 0, verdict: 'comment' as const };
    await adapter.createCheckpointComment(PR_ID, cp);
    await adapter.deleteCheckpointComment(200);

    const [closeUrl, closeOpts] = mockFetch.mock.calls[2];
    expect(closeUrl).toContain(`/threads/200`);
    expect(JSON.parse(closeOpts?.body as string)).toEqual({ status: 'closed' });
  });

  it('throws when _activePrId is not set', async () => {
    const adapter = makeAdapter();
    await expect(adapter.deleteCheckpointComment(200)).rejects.toThrow('active prId');
  });
});

// ── Regression: submitReview dedup path (getAgnusThreadMap) ─────────────────
describe('submitReview dedup (getAgnusThreadMap)', () => {
  it('updates an existing AgnusAI thread instead of creating a duplicate', async () => {
    // getAgnusThreadMap call
    mockFetch.mockResolvedValueOnce(
      mockResponse({ value: [inlineThread] })
    );
    // iterations call inside addInlineComment (skipped — existing thread is found)
    // updateThreadComment PATCH
    mockFetch.mockResolvedValueOnce(mockResponse({}));
    // summary thread POST
    mockFetch.mockResolvedValueOnce(mockResponse({ id: 999 }));

    const adapter = makeAdapter();
    await adapter.submitReview(PR_ID, {
      summary: 'All good',
      verdict: 'comment',
      comments: [{ path: 'src/index.ts', line: 10, body: 'updated finding', severity: 'info' }],
    });

    // The PATCH to update the existing thread comment should have been called
    const patchCall = mockFetch.mock.calls.find(([url, opts]) =>
      (opts as any)?.method === 'PATCH' && String(url).includes('/threads/100/comments/1')
    );
    expect(patchCall).toBeDefined();
  });
});
