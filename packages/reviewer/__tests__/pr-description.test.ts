import { parsePRDescriptionResponse } from '../src/llm/parser';

describe('parsePRDescriptionResponse', () => {
  it('parses structured output correctly', () => {
    const response = `TITLE: Add validation for webhook signatures
CHANGE_TYPE: feature
LABELS: security, webhook, backend
BODY:
## What Changed
- Added HMAC validation for incoming webhook payloads.

## Why It Changed
Prevents spoofed webhook requests.

## Walkthrough
- \`src/webhook/handler.ts\`: verifies \`x-hub-signature-256\` before processing events.`;

    const parsed = parsePRDescriptionResponse(response);

    expect(parsed.title).toBe('Add validation for webhook signatures');
    expect(parsed.changeType).toBe('feature');
    expect(parsed.labels).toEqual(['security', 'webhook', 'backend']);
    expect(parsed.body).toContain('## What Changed');
    expect(parsed.body).toContain('## Walkthrough');
  });

  it('falls back safely on malformed output', () => {
    const parsed = parsePRDescriptionResponse('unexpected raw text without structured markers');
    expect(parsed.title).toBe('Update pull request details');
    expect(parsed.changeType).toBe('chore');
    expect(parsed.labels).toEqual([]);
    expect(parsed.body).toContain('unexpected raw text');
  });
});
