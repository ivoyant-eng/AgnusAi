// LLM Backend — abstract base class
// Each provider implements only `generate()`. Prompt building and response
// parsing are handled here using the shared prompt/parser modules so all
// providers behave identically.

import { ReviewContext, ReviewResult } from '../types';
import { buildReviewPrompt } from './prompt';
import { parseReviewResponse } from './parser';

export abstract class BaseLLMBackend {
  abstract readonly name: string;

  /** Send a raw prompt to the provider and return the raw text response. */
  abstract generate(prompt: string, context: ReviewContext): Promise<string>;

  /** Build the structured prompt, call generate(), then parse the response. */
  async generateReview(context: ReviewContext): Promise<ReviewResult> {
    const prompt = buildReviewPrompt(context);
    const response = await this.generate(prompt, context);
    return parseReviewResponse(response);
  }
}

// Keep the interface alias so existing imports of LLMBackend still compile
export type LLMBackend = BaseLLMBackend;
