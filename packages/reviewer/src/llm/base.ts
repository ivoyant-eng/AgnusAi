// LLM Backend — abstract base class
// Each provider implements only `generate()`. Prompt building and response
// parsing are handled here using the shared prompt/parser modules so all
// providers behave identically.

import { PRDescriptionResult, ReviewContext, ReviewResult } from '../types';
import { buildPRDescriptionPrompt, buildReviewPrompt } from './prompt';
import { parsePRDescriptionResponse, parseReviewResponse } from './parser';
import { parseToolCalls, stripToolCalls, computeMaxToolRounds } from '../tools/SymbolExplorer';

export abstract class BaseLLMBackend {
  abstract readonly name: string;

  /** Send a raw prompt to the provider and return the raw text response.
   * @param temperature Override the backend's default temperature for this call only.
   *   Pass 0 for deterministic selection tasks (judge, self-reflection). */
  abstract generate(prompt: string, context: ReviewContext, temperature?: number): Promise<string>;

  /**
   * Build the structured prompt, call generate(), then parse the response.
   * When context.symbolExplorer is present, runs a tool loop (ReAct pattern):
   *   LLM responds → parse <tool_call> blocks → execute → inject results → repeat
   * until no tool calls or maxRounds reached.
   */
  async generateReview(context: ReviewContext, temperature?: number): Promise<ReviewResult> {
    const explorer = context.symbolExplorer;

    if (!explorer) {
      const prompt = buildReviewPrompt(context);
      const response = await this.generate(prompt, context, temperature);
      return parseReviewResponse(response);
    }

    const maxRounds = computeMaxToolRounds(context.diff.files.length);
    let conversation = buildReviewPrompt(context);
    let round = 0;

    while (round < maxRounds) {
      const response = await this.generate(conversation, context, temperature);
      if (process.env.TOOL_DEBUG === 'true') {
        const hasTag = response.includes('<tool_call>');
        console.log(`[tool-loop] agent=${context.agentRole ?? 'single'} round=${round + 1} response_len=${response.length} has_tool_call=${hasTag}`);
        if (!hasTag) console.log(`[tool-loop] first 300 chars: ${response.slice(0, 300).replace(/\n/g, ' ↵ ')}`);
      }
      const toolCalls = parseToolCalls(response);

      if (toolCalls.length === 0) {
        // No tool calls — final answer
        return parseReviewResponse(stripToolCalls(response));
      }

      explorer.incrementRound();
      round++;

      // Execute all tool calls in this response
      const resultBlocks: string[] = [];
      for (const tc of toolCalls) {
        const result = await explorer.executeTool(tc.tool, tc.args);
        resultBlocks.push(`<tool_result tool="${tc.tool}">\n${result}\n</tool_result>`);
      }

      // Append assistant turn + tool results to conversation for next round
      conversation +=
        `\n\n[Assistant used tools]\n${response}\n\n` +
        `[Tool Results]\n${resultBlocks.join('\n\n')}\n\n` +
        `[Continue] Use the tool results above to inform your analysis. ` +
        `If you need more information use another tool_call. ` +
        `When ready, output your complete review in the standard format (SUMMARY:, [File:, Line:], VERDICT:).`;
    }

    // Max rounds hit — force finalize
    conversation +=
      '\n\nYou have reached the tool call limit. Output your final review findings now in the standard format. No more tool_call blocks.';
    const finalResponse = await this.generate(conversation, context, temperature);
    return parseReviewResponse(stripToolCalls(finalResponse));
  }

  async generatePRDescription(context: ReviewContext, review: ReviewResult): Promise<PRDescriptionResult> {
    const prompt = buildPRDescriptionPrompt(context, review);
    const response = await this.generate(prompt, context);
    return parsePRDescriptionResponse(response);
  }
}

// Keep the interface alias so existing imports of LLMBackend still compile
export type LLMBackend = BaseLLMBackend;
