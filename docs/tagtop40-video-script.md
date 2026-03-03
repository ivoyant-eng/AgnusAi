# AgnusAI — TagTop 40 Demo Video Script
> **Target duration:** 2 minutes (120 seconds)
> **Format:** Narrated motion-graphic demo (no talking head)
> **Tone:** Confident, business-first, problem → solution → proof → CTA
> **Tool:** [Remotion](https://www.remotion.dev) — React-based programmatic video

---

## How This Works With Remotion

Remotion lets you build videos as **React components**. Each scene is a `<Sequence>` with a start frame and duration. At 30fps, 120 seconds = **3,600 frames** total.

```
npx create-video@latest agnus-demo
# pick "Blank" template, TypeScript
```

Key Remotion APIs used in this script:
- `useCurrentFrame()` — current frame number for animations
- `interpolate(frame, [from, to], [fromVal, toVal])` — smooth value curves
- `spring({ frame, fps, config })` — spring-physics entrance animations
- `<Sequence from={N} durationInFrames={M}>` — time-slice a scene
- `<AbsoluteFill>` — full-canvas positioning
- `<Img>`, `<Video>`, `<Audio>` — media embeds
- `staticFile('asset.mp4')` — reference files from `/public`

Structure your `Root.tsx`:
```tsx
export const AgnusDemoVideo = () => (
  <>
    <Scene01Hook         start={0}    duration={300}  />  {/* 0:00–0:10 */}
    <Scene02Problem      start={300}  duration={450}  />  {/* 0:10–0:25 */}
    <Scene03Solution     start={750}  duration={750}  />  {/* 0:25–0:50 */}
    <Scene04SelfHosted   start={1500} duration={750}  />  {/* 0:50–1:15 */}
    <Scene05Interactive  start={2250} duration={750}  />  {/* 1:15–1:40 */}
    <Scene06CTA          start={3000} duration={600}  />  {/* 1:40–2:00 */}
  </>
);
```

---

## Full Script with Timestamps

---

### [0:00–0:10] SCENE 1 — THE HOOK

**Visual:**
Black screen. Large white counter animates up to `$2,400,000,000,000` — then fades to a single line.

**Narration:**
> "Software bugs cost U.S. businesses two-point-four trillion dollars a year."

**Text on screen:**
```
$2.4 TRILLION
lost to software bugs annually
```

**Remotion note:**
```tsx
// Animate counter 0 → 2,400,000,000,000 using interpolate()
// spring() entrance on the subtitle line
```

---

### [0:10–0:25] SCENE 2 — THE BLIND SPOT

**Visual:**
A code diff appears — only the changed lines are highlighted (green/red).
A dashed circle pulses around the changed function.
Three downstream files fade in GREY and UNLINKED — invisible to the reviewer.
Label: `"Seen by AI"` (green box) vs `"Invisible to AI"` (grey, strikethrough).

**Narration:**
> "AI code review was supposed to fix this. It hasn't. Today's tools are advanced spell-checkers — they read only the lines that changed. Change a payment validation function... and three downstream features break. Every AI tool misses it. Every time."

**Text on screen (sequential reveals):**
```
CodeRabbit  ✗  sees only the diff
Copilot     ✗  sees only the diff
Qodo        ✗  sees only the diff
```

**Remotion note:**
```tsx
// Stagger the competitor rows using interpolate(frame - offset, [0, 15], [0, 1])
// Pulse animation on the "invisible" files using Math.sin(frame / 10)
```

---

### [0:25–0:50] SCENE 3 — THE AGNUS APPROACH

**Visual:**
Dark canvas. Nodes appear one by one — a live dependency graph (circles + labelled arrows).
`auth.ts` → `payment.ts` → `checkout.ts` → `notification.ts`
When `payment.ts` lights up orange, a blast-radius ring expands outward catching all dependents.
Six agent badges slide in from the right in parallel:
`🔒 Security` · `⚙️ Correctness` · `⚡ Performance` · `📋 Compliance` · `🧾 Ticket` · `💥 Blast Radius`

**Narration:**
> "AgnusAI builds a living map of every relationship in your codebase. When code is submitted, six specialist AI agents run in parallel — each one knowing not just what changed, but exactly what else it could break. This is graph-aware review."

**Text on screen:**
```
AgnusAI
Graph-aware code review
```

**Remotion note:**
```tsx
// Draw graph edges using SVG <line> with strokeDashoffset animation
// spring() each agent badge sequentially: from={750 + i * 60}
```

---

### [0:50–1:15] SCENE 4 — SELF-HOSTED / AIR-GAPPED

**Visual:**
Split screen. Left: competitor logos with a cloud icon and a red "↑ code sent" arrow pointing out.
Right: AgnusAI inside a secure box — padlock icon. Green "✓ code never leaves" label.
Then zoom into: Docker Compose command typing itself terminal-style.
Logos of regulated industries fade in: 🏦 Fintech · 🏥 Healthcare · 🛡️ Defense

**Narration:**
> "Critically — AgnusAI runs entirely inside your own network. Your own cloud. Your own data center. Even a fully offline model via Ollama — zero data egress. For the fifty-thousand-plus U.S. organizations in fintech, healthcare, and defense legally prohibited from sending source code to third-party AI: AgnusAI is the only solution built for you."

**Text on screen:**
```
Self-hosted. Air-gapped. Open-source.
Your code never leaves the building.
```

**Remotion note:**
```tsx
// Red vs green split-screen using two <AbsoluteFill> with clip-path animation
// Terminal typewriter: build string char-by-char using .slice(0, charCount)
```

---

### [1:15–1:40] SCENE 5 — BEYOND ONE-SHOT: INTERACTIVE + RULES

**Visual:**
PR comment thread appears. User types `/ask Why is this change safe with concurrent requests?`
After 2 seconds, AgnusAI reply pops in with a detailed answer referencing file names.

Then: Rules dashboard UI screenshot — a table of team rules with green "Enforced" badges and a violation trend graph.

Then: Jira/Linear ticket with a compliance table: `✅ Fully Compliant · 🔶 Partial · ❌ Not Compliant`.

**Narration:**
> "AgnusAI isn't one-shot. Ask it questions directly on any PR — it answers with full codebase context. Enforce team coding rules automatically, with violation analytics baked in. Get structured compliance verdicts against your Jira and Linear tickets. And when a PR is too large to review safely, it tells you exactly how to split it."

**Text on screen (sequential):**
```
/ask  →  answers in <30s
Rules  →  enforced on every PR
Tickets  →  compliance verdict per commit
```

**Remotion note:**
```tsx
// Typing cursor animation on the /ask line
// Slide-up transition into Rules dashboard using translateY interpolation
// Fade-sequence for the three feature labels
```

---

### [1:40–2:00] SCENE 6 — CTA + ROADMAP TEASE

**Visual:**
Clean white background. AgnusAI logo centres.
Three roadmap bullets slide in:
- `GitLab support — coming v3`
- `Test generation — coming v3`
- `Agentic fix PRs — coming v4`
Then full screen: logo + URL + GitHub star CTA.

**Narration:**
> "Open-source. Self-hostable. Graph-aware. We're building the only AI code reviewer that makes your entire codebase smarter with every PR — and the only one your compliance team will actually approve. AgnusAI."

**Text on screen:**
```
AgnusAI
The code reviewer that sees the whole picture.

github.com/theashishmaurya/AgnusAi
⭐ Star us on GitHub
```

**Remotion note:**
```tsx
// Logo scale spring entrance: spring({ frame, fps: 30, config: { damping: 12 } })
// Roadmap bullets stagger: from={3000 + i * 90}
// Final CTA: opacity interpolate [3300, 3400] → [0, 1]
```

---

## Word Count & Pacing Check

| Scene | Duration | Words | WPM |
|-------|----------|-------|-----|
| 1 — Hook | 10s | 18 | ~108 |
| 2 — Blind Spot | 15s | 47 | ~188 |
| 3 — Agnus Approach | 25s | 58 | ~139 |
| 4 — Self-Hosted | 25s | 65 | ~156 |
| 5 — Interactive | 25s | 66 | ~158 |
| 6 — CTA | 20s | 40 | ~120 |
| **Total** | **120s** | **294** | ~147 avg |

147 WPM is a comfortable, clear narration pace.

---

## Remotion Project Setup (Quick Start)

```bash
# 1. Scaffold
npx create-video@latest agnus-demo --template blank

# 2. Install extras
cd agnus-demo
npm install @remotion/media-utils

# 3. File structure
src/
  Root.tsx          ← register <AgnusDemoVideo> composition
  scenes/
    Scene01Hook.tsx
    Scene02Problem.tsx
    Scene03Solution.tsx
    Scene04SelfHosted.tsx
    Scene05Interactive.tsx
    Scene06CTA.tsx
  components/
    GraphNode.tsx   ← animated dependency graph node
    AgentBadge.tsx  ← specialist agent badge
    Terminal.tsx    ← typewriter terminal component
  assets/
    logo.svg
    dashboard-screenshot.png

# 4. Preview in browser (hot reload)
npm start          # opens http://localhost:3000

# 5. Render to MP4
npx remotion render AgnusDemoVideo out/agnus-demo.mp4 \
  --codec=h264 \
  --fps=30 \
  --width=1920 \
  --height=1080

# Or render a short preview (first 10 seconds)
npx remotion render AgnusDemoVideo out/preview.mp4 \
  --frames=0-300
```

---

## Voice-over Recording Tips

- Record narration with [ElevenLabs](https://elevenlabs.io) (AI voice) or Descript for a polished result
- Export as WAV, drop in `/public/narration.wav`
- Sync to frames using `<Audio src={staticFile('narration.wav')} />`
- Use `getAudioDurationInSeconds` from `@remotion/media-utils` to lock composition duration to audio

---

## Assets Needed

| Asset | Source |
|-------|--------|
| AgnusAI logo (SVG) | Export from dashboard |
| Dashboard screenshot (rules page) | `localhost:3000` screenshot |
| Dependency graph demo | Build as animated SVG in React |
| PR comment screenshot | Mock in Figma or use real screenshot |
| Competitor logos | Publicly available brand assets |
| Background music | [Pixabay](https://pixabay.com/music/) free license |
