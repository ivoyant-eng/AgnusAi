/**
 * Tests for Checkpoint Management Module
 */

import {
  parseCheckpoint,
  serializeCheckpoint,
  createCheckpoint,
  findCheckpointComment,
  generateCheckpointComment,
  isCheckpointStale,
  validateCheckpointSha,
  CHECKPOINT_MARKER,
  CHECKPOINT_SUFFIX
} from '../src/review/checkpoint';
import { ReviewCheckpoint, PRComment } from '../src/types';

describe('Checkpoint Module', () => {
  describe('serializeCheckpoint', () => {
    it('should serialize a checkpoint to HTML comment format', () => {
      const checkpoint: ReviewCheckpoint = {
        sha: 'abc123def456',
        timestamp: 1708365600,
        filesReviewed: ['src/index.ts', 'src/types.ts'],
        commentCount: 5,
        verdict: 'approve'
      };

      const serialized = serializeCheckpoint(checkpoint);

      expect(serialized).toContain(CHECKPOINT_MARKER);
      expect(serialized).toContain(CHECKPOINT_SUFFIX);
      expect(serialized).toContain('abc123def456');
      expect(serialized).toContain('1708365600');
    });

    it('should handle empty filesReviewed array', () => {
      const checkpoint: ReviewCheckpoint = {
        sha: 'xyz789',
        timestamp: 1708365600,
        filesReviewed: [],
        commentCount: 0,
        verdict: 'comment'
      };

      const serialized = serializeCheckpoint(checkpoint);
      const parsed = parseCheckpoint(serialized);

      expect(parsed).not.toBeNull();
      expect(parsed?.filesReviewed).toEqual([]);
    });
  });

  describe('parseCheckpoint', () => {
    it('should parse a valid checkpoint from a comment body', () => {
      const commentBody = `Some text before
<!-- AGNUSAI_CHECKPOINT: {"sha":"abc123","timestamp":1708365600,"filesReviewed":["src/index.ts"],"commentCount":3,"verdict":"approve"} -->
Some text after`;

      const checkpoint = parseCheckpoint(commentBody);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.sha).toBe('abc123');
      expect(checkpoint?.timestamp).toBe(1708365600);
      expect(checkpoint?.filesReviewed).toEqual(['src/index.ts']);
      expect(checkpoint?.commentCount).toBe(3);
      expect(checkpoint?.verdict).toBe('approve');
    });

    it('should return null for comment without checkpoint', () => {
      const commentBody = 'This is a regular comment without any checkpoint data.';
      const checkpoint = parseCheckpoint(commentBody);
      expect(checkpoint).toBeNull();
    });

    it('should return null for malformed JSON in checkpoint', () => {
      const commentBody = `<!-- AGNUSAI_CHECKPOINT: {invalid json} -->`;
      const checkpoint = parseCheckpoint(commentBody);
      expect(checkpoint).toBeNull();
    });

    it('should return null for checkpoint missing required fields', () => {
      const commentBody = `<!-- AGNUSAI_CHECKPOINT: {"timestamp":1708365600} -->`;
      const checkpoint = parseCheckpoint(commentBody);
      expect(checkpoint).toBeNull();
    });

    it('should handle checkpoint at end of comment', () => {
      const commentBody = `Some text
<!-- AGNUSAI_CHECKPOINT: {"sha":"def456","timestamp":1708365600,"filesReviewed":[],"commentCount":0,"verdict":"comment"} -->`;
      
      const checkpoint = parseCheckpoint(commentBody);
      expect(checkpoint?.sha).toBe('def456');
    });

    it('should use defaults for missing optional fields', () => {
      const commentBody = `<!-- AGNUSAI_CHECKPOINT: {"sha":"abc123","timestamp":1708365600} -->`;
      const checkpoint = parseCheckpoint(commentBody);

      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.filesReviewed).toEqual([]);
      expect(checkpoint?.commentCount).toBe(0);
      expect(checkpoint?.verdict).toBe('comment');
    });
  });

  describe('createCheckpoint', () => {
    it('should create a checkpoint with current timestamp', () => {
      const before = Math.floor(Date.now() / 1000);
      const checkpoint = createCheckpoint('sha123', ['file1.ts'], 5, 'approve');
      const after = Math.floor(Date.now() / 1000);

      expect(checkpoint.sha).toBe('sha123');
      expect(checkpoint.filesReviewed).toEqual(['file1.ts']);
      expect(checkpoint.commentCount).toBe(5);
      expect(checkpoint.verdict).toBe('approve');
      expect(checkpoint.timestamp).toBeGreaterThanOrEqual(before);
      expect(checkpoint.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('findCheckpointComment', () => {
    it('should find checkpoint comment from bot user', () => {
      const comments: PRComment[] = [
        {
          id: 1,
          body: 'Regular user comment',
          user: { login: 'human-user', type: 'User' },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          body: `<!-- AGNUSAI_CHECKPOINT: {"sha":"abc123","timestamp":1708365600,"filesReviewed":[],"commentCount":0,"verdict":"comment"} -->`,
          user: { login: 'agnus-ai[bot]', type: 'Bot' },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ];

      const result = findCheckpointComment(comments);

      expect(result).not.toBeNull();
      expect(result?.comment.id).toBe(2);
      expect(result?.checkpoint.sha).toBe('abc123');
    });

    it('should return null when no checkpoint comment exists', () => {
      const comments: PRComment[] = [
        {
          id: 1,
          body: 'Regular comment 1',
          user: { login: 'user1', type: 'User' },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          body: 'Regular comment 2',
          user: { login: 'user2', type: 'User' },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ];

      const result = findCheckpointComment(comments);
      expect(result).toBeNull();
    });

    it('should find checkpoint by custom bot name', () => {
      const comments: PRComment[] = [
        {
          id: 1,
          body: `<!-- AGNUSAI_CHECKPOINT: {"sha":"custom","timestamp":1708365600,"filesReviewed":[],"commentCount":0,"verdict":"approve"} -->`,
          user: { login: 'custom-bot', type: 'User' },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        }
      ];

      const result = findCheckpointComment(comments, 'custom-bot');

      expect(result).not.toBeNull();
      expect(result?.checkpoint.sha).toBe('custom');
    });

    it('should return newest checkpoint when multiple exist', () => {
      const comments: PRComment[] = [
        {
          id: 1,
          body: `<!-- AGNUSAI_CHECKPOINT: {"sha":"first","timestamp":1708365600,"filesReviewed":[],"commentCount":0,"verdict":"comment"} -->`,
          user: { login: 'bot1', type: 'Bot' },
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z'
        },
        {
          id: 2,
          body: `<!-- AGNUSAI_CHECKPOINT: {"sha":"second","timestamp":1708365601,"filesReviewed":[],"commentCount":0,"verdict":"comment"} -->`,
          user: { login: 'bot2', type: 'Bot' },
          createdAt: '2024-01-01T00:01:00Z',
          updatedAt: '2024-01-01T00:01:00Z'
        }
      ];

      const result = findCheckpointComment(comments);
      // Should return the newest checkpoint (highest timestamp)
      expect(result?.checkpoint.sha).toBe('second');
    });
  });

  describe('generateCheckpointComment', () => {
    it('should generate a full comment body with checkpoint', () => {
      const checkpoint: ReviewCheckpoint = {
        sha: 'abc123def456789',
        timestamp: 1708365600,
        filesReviewed: ['src/index.ts', 'src/types.ts', 'src/utils.ts'],
        commentCount: 10,
        verdict: 'approve'
      };

      const body = generateCheckpointComment(checkpoint);

      expect(body).toContain(CHECKPOINT_MARKER);
      expect(body).toContain('AgnusAI Review Checkpoint');
      expect(body).toContain('abc123d'); // First 7 chars of SHA
      expect(body).toContain('Files reviewed:** 3');
    });

    it('should use custom summary when provided', () => {
      const checkpoint: ReviewCheckpoint = {
        sha: 'abc123',
        timestamp: 1708365600,
        filesReviewed: [],
        commentCount: 0,
        verdict: 'comment'
      };

      const body = generateCheckpointComment(checkpoint, 'Custom summary text');

      expect(body).toContain('Custom summary text');
      expect(body).toContain(CHECKPOINT_MARKER);
    });

    it('should show correct emoji for each verdict', () => {
      const verdicts: Array<'approve' | 'request_changes' | 'comment'> = ['approve', 'request_changes', 'comment'];
      const emojis = ['✅', '🔄', '💬'];

      verdicts.forEach((verdict, index) => {
        const checkpoint: ReviewCheckpoint = {
          sha: 'test',
          timestamp: 1708365600,
          filesReviewed: [],
          commentCount: 0,
          verdict
        };

        const body = generateCheckpointComment(checkpoint);
        expect(body).toContain(emojis[index]);
      });
    });
  });

  describe('isCheckpointStale', () => {
    it('should return false for recent checkpoint', () => {
      const checkpoint: ReviewCheckpoint = {
        sha: 'test',
        timestamp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        filesReviewed: [],
        commentCount: 0,
        verdict: 'comment'
      };

      expect(isCheckpointStale(checkpoint, 30)).toBe(false);
    });

    it('should return true for old checkpoint', () => {
      const checkpoint: ReviewCheckpoint = {
        sha: 'test',
        timestamp: Math.floor(Date.now() / 1000) - (31 * 24 * 3600), // 31 days ago
        filesReviewed: [],
        commentCount: 0,
        verdict: 'comment'
      };

      expect(isCheckpointStale(checkpoint, 30)).toBe(true);
    });

    it('should use default max age of 30 days', () => {
      const checkpoint: ReviewCheckpoint = {
        sha: 'test',
        timestamp: Math.floor(Date.now() / 1000) - (31 * 24 * 3600),
        filesReviewed: [],
        commentCount: 0,
        verdict: 'comment'
      };

      expect(isCheckpointStale(checkpoint)).toBe(true);
    });
  });

  describe('validateCheckpointSha', () => {
    it('should return true when checkpoint SHA equals HEAD', () => {
      const result = validateCheckpointSha('abc123', 'abc123', 0);
      expect(result).toBe(true);
    });

    it('should return true when commitsAhead > 0', () => {
      const result = validateCheckpointSha('old-sha', 'new-sha', 5);
      expect(result).toBe(true);
    });

    it('should return false when commitsAhead is 0 and SHAs differ', () => {
      const result = validateCheckpointSha('old-sha', 'new-sha', 0);
      expect(result).toBe(false);
    });
  });

  describe('round-trip serialization', () => {
    it('should preserve all data through serialize/parse cycle', () => {
      const original: ReviewCheckpoint = {
        sha: 'abc123def456',
        timestamp: 1708365600,
        filesReviewed: ['file1.ts', 'file2.ts', 'file3.ts'],
        commentCount: 42,
        verdict: 'request_changes'
      };

      const serialized = serializeCheckpoint(original);
      const parsed = parseCheckpoint(serialized);

      expect(parsed).toEqual(original);
    });

    it('should handle special characters in file paths', () => {
      const checkpoint: ReviewCheckpoint = {
        sha: 'test',
        timestamp: 1708365600,
        filesReviewed: ['path/with spaces/file.ts', 'path/with-quotes"file.ts'],
        commentCount: 0,
        verdict: 'comment'
      };

      const serialized = serializeCheckpoint(checkpoint);
      const parsed = parseCheckpoint(serialized);

      expect(parsed?.filesReviewed).toEqual(checkpoint.filesReviewed);
    });
  });
});