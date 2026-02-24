// Review barrel export

export { ReviewEngine, ReviewEngineOptions } from './engine';
export { OutputFormatter, MarkdownFormatter, JsonFormatter, GhActionsFormatter, getFormatter } from './output';

// Precision filter for confidence-based comment filtering
export { filterByConfidence, DEFAULT_PRECISION_CONFIG, getFilteredReason } from './precision-filter';
export type { PrecisionFilterConfig, FilteredByConfidence } from './precision-filter';

// Checkpoint exports for incremental reviews
export {
  parseCheckpoint,
  serializeCheckpoint,
  createCheckpoint,
  findCheckpointComment,
  generateCheckpointComment,
  isCheckpointStale,
  validateCheckpointSha,
  CHECKPOINT_MARKER,
  CHECKPOINT_SUFFIX,
  CHECKPOINT_USER_AGENT
} from './checkpoint';
export type { default as CheckpointModule } from './checkpoint';

// Thread handling for comment replies
export {
  AGNUSAI_MARKER,
  isAgnusaiComment,
  extractOriginalIssue,
  addAgnusaiMarker,
  isReplyToComment,
  buildCommentThread,
} from './thread';
export type {
  CommentThread,
  GitHubComment,
  ReviewCommentWebhookPayload,
} from './thread';

// Reply generation
export {
  generateReply,
  generateAcknowledgment,
  isDismissal,
  generateDismissalResponse,
} from './reply';
export type { ReplyContext } from './reply';