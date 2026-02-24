import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'

export async function feedbackRoutes(app: FastifyInstance): Promise<void> {
  const pool: Pool = app.db

  /**
   * GET /api/feedback?id=<commentId>&signal=<accepted|rejected>&token=<hmac>
   *
   * Validates the HMAC token, then upserts a feedback signal for the comment.
   * Returns a minimal HTML "thank you" page so clicking the link feels complete.
   */
  app.get('/api/feedback', async (req, reply) => {
    const { id, signal, token } = req.query as Record<string, string | undefined>

    if (!id || !signal || !token) {
      return reply.status(400).send('Missing required parameters.')
    }

    if (signal !== 'accepted' && signal !== 'rejected') {
      return reply.status(400).send('Invalid signal value.')
    }

    const secret =
      process.env.FEEDBACK_SECRET ||
      process.env.WEBHOOK_SECRET ||
      process.env.SESSION_SECRET ||
      ''

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${id}:${signal}`)
      .digest('hex')

    let valid = false
    try {
      valid = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'))
    } catch {
      valid = false
    }

    if (!valid) {
      return reply.status(400).send('Invalid token.')
    }

    await pool.query(
      `INSERT INTO review_feedback (comment_id, signal)
       VALUES ($1, $2)
       ON CONFLICT (comment_id) DO UPDATE SET signal = EXCLUDED.signal, created_at = NOW()`,
      [id, signal],
    )

    const isAccepted = signal === 'accepted'
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AgnusAI — Feedback received</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #131312;
      color: #E8E6E2;
      font-family: 'JetBrains Mono', monospace;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .window {
      width: 100%;
      max-width: 560px;
      border: 1px solid #2A2A27;
    }
    .titlebar {
      background: #1C1C1A;
      border-bottom: 1px solid #2A2A27;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .dots { display: flex; gap: 6px; }
    .dot {
      width: 11px; height: 11px; border-radius: 50%;
    }
    .dot-r { background: #FF5F57; }
    .dot-y { background: #FFBD2E; }
    .dot-g { background: #28C840; }
    .fname {
      font-size: 11px;
      color: #6A6866;
      letter-spacing: 0.08em;
      flex: 1;
      text-align: center;
    }
    .body {
      background: #0D0D0C;
      padding: 28px 24px;
    }
    .prompt-line {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 20px;
    }
    .prompt { color: #E85A1A; font-weight: 600; font-size: 13px; }
    .cmd { color: #E8E6E2; font-size: 13px; }
    .output-line {
      padding-left: 20px;
      font-size: 13px;
      margin-bottom: 6px;
      display: flex;
      gap: 8px;
    }
    .ok { color: #28C840; font-weight: 600; }
    .info { color: #9AA8A0; }
    .accent { color: #E85A1A; font-weight: 600; }
    .cursor {
      display: inline-block;
      width: 8px; height: 14px;
      background: #E85A1A;
      vertical-align: middle;
      margin-left: 2px;
      animation: blink 1.1s step-end infinite;
    }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
    .divider {
      border: none;
      border-top: 1px solid #2A2A27;
      margin: 20px 0;
    }
    .footer-line {
      padding-left: 20px;
      font-size: 11px;
      color: #4A4A47;
      letter-spacing: 0.06em;
    }
  </style>
</head>
<body>
  <div class="window">
    <div class="titlebar">
      <div class="dots">
        <span class="dot dot-r"></span>
        <span class="dot dot-y"></span>
        <span class="dot dot-g"></span>
      </div>
      <span class="fname">agnus-ai · feedback</span>
    </div>
    <div class="body">
      <div class="prompt-line">
        <span class="prompt">&gt;_</span>
        <span class="cmd">agnus feedback record --signal ${isAccepted ? 'accepted' : 'rejected'}</span>
      </div>
      <div class="output-line">
        <span class="ok">${isAccepted ? '✓' : '✗'}</span>
        <span class="info">signal recorded &nbsp;<span class="accent">${isAccepted ? 'accepted' : 'rejected'}</span></span>
      </div>
      <div class="output-line">
        <span class="ok">✓</span>
        <span class="info">model will improve on next review</span>
      </div>
      <hr class="divider" />
      <div class="output-line" style="margin-bottom:0">
        <span class="info" style="color:#E8E6E2;font-weight:500">Thanks for your feedback!</span>
        <span class="cursor"></span>
      </div>
    </div>
    <div class="titlebar" style="border-top:1px solid #2A2A27;border-bottom:none">
      <span class="footer-line">AgnusAI — graph-aware code review &nbsp;·&nbsp; you can close this tab</span>
    </div>
  </div>
</body>
</html>`

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .status(200)
      .send(html)
  })
}
