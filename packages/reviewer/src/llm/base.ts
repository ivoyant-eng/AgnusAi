// LLM Backend — abstract base class
// Each provider implements only `generate()`. Prompt building and response
// parsing are handled here using the shared prompt/parser modules so all
// providers behave identically.

import { PRDescriptionResult, ReviewContext, ReviewResult } from '../types';
import { buildPRDescriptionPrompt, buildReviewPrompt } from './prompt';
import { parsePRDescriptionResponse, parseReviewResponse } from './parser';

export abstract class BaseLLMBackend {
  abstract readonly name: string;

  /** Send a raw prompt to the provider and return the raw text response.
   * @param temperature Override the backend's default temperature for this call only.
   *   Pass 0 for deterministic selection tasks (judge, self-reflection). */
  abstract generate(prompt: string, context: ReviewContext, temperature?: number): Promise<string>;

  /** Build the structured prompt, call generate(), then parse the response.
   * @param temperature Override the backend's default temperature for this call only. */
  async generateReview(context: ReviewContext, temperature?: number): Promise<ReviewResult> {
    const prompt = buildReviewPrompt(context);
    const response = await this.generate(prompt, context, temperature);
    return parseReviewResponse(response);
  }

  async generatePRDescription(context: ReviewContext, review: ReviewResult): Promise<PRDescriptionResult> {
    const prompt = buildPRDescriptionPrompt(context, review);
    const response = await this.generate(prompt, context);
    return parsePRDescriptionResponse(response);
  }
}

// Keep the interface alias so existing imports of LLMBackend still compile
export type LLMBackend = BaseLLMBackend;
