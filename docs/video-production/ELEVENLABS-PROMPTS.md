# Ryv AI — ElevenLabs Prompts
# Everything you need to generate narration, music, and SFX

---

## VOICE SETTINGS (apply to ALL narration scenes)

Go to: elevenlabs.io → Voices → Select voice → Voice Settings

```
Voice:            Adam  (or Daniel for a British feel)
Model:            Eleven Turbo v2.5
Stability:        32
Similarity Boost: 75
Style:            42
Speaker Boost:    ON
Speed:            0.95
```

Why these settings:
- Low stability (32) = more tonal variation = sounds like a real person
- Style (42) = natural emphasis on important words
- Speed 0.95 = slightly slower = gravitas, easier to follow

Save each scene as a separate MP3. Name them exactly as shown.

---

## NARRATION SCRIPTS

### FILE: s1-problem.mp3  (target: ~9 seconds)

```
Software bugs cost businesses TWO POINT FOUR TRILLION dollars every year.

AI was supposed to fix this.

It made it worse.
```

**Delivery note:** Pause after "every year." — let the number land.
"It made it worse." should feel like a gut punch. Short. Final.

---

### FILE: s2-blindspot.mp3  (target: ~14 seconds)

```
Every AI coding tool generates code ten times faster than humans —
but with no idea what that code connects to.

Change a payment function.
Three downstream features break.
And every existing tool... misses it.

Every. Single. Time.
```

**Delivery note:** "Change a payment function." — punchy, fast.
"Every. Single. Time." — slow, deliberate. The periods mean real pauses.

---

### FILE: s3-graph.mp3  (target: ~28 seconds)

```
Ryv builds a living map of your entire codebase.

Not just what changed — what that change could break.
Every function. Every caller. Every dependency.

When a pull request opens, six specialist agents run in parallel.
Security. Correctness. Performance. Style. Blast radius. Ticket compliance.

Each one sees the full structural picture.

A judge consolidates their findings, cuts the noise,
and posts a precise, high-signal review — automatically.
```

**Delivery note:**
- "Not just what changed —" pause — "what that change could break." = slow, let it sink in
- List the six agents at a steady rhythm, one beat each
- "automatically." = confident, final word

---

### FILE: s4-autonomous.mp3  (target: ~24 seconds)

```
Three AM. A Sentry error fires.

Ryv finds the affected symbol in the graph,
generates a tested fix, opens a pull request,
and self-reviews it —

before your engineer wakes up.

A ticket from a PM? Ryv analyzes the blast radius,
drafts the implementation, delivers the PR.

Human engineers approve or reject.
Everything else... is automated.
```

**Delivery note:**
- "Three AM." = slow, cinematic. Short sentence. Pause.
- "before your engineer wakes up." = land this hard. It's the key line.
- "Everything else... is automated." = pause on the ellipsis

---

### FILE: s5-commands.mp3  (target: ~13 seconds)

```
Just mention @ryv in any pull request comment.

Generate tests. Create a ticket. Update the changelog.
Search for similar code across the entire codebase.

Natural language. No commands to memorize.
```

**Delivery note:** The feature list should feel effortless, like it's obvious.
"Natural language. No commands to memorize." = clean close.

---

### FILE: s6-rules.mp3  (target: ~13 seconds)

```
Define your organization's standards once, as rules.

No hardcoded secrets. No SQL injection. Require tests.

Every pull request checks every rule, automatically.
Violations tracked. Compliance audited.
Built for teams that can't afford to get it wrong.
```

**Delivery note:**
- The example rules should sound like real policies being read aloud
- "Built for teams that can't afford to get it wrong." = weight and gravitas

---

### FILE: s7-moat.mp3  (target: ~10 seconds)

```
Your code never leaves the building.

Fifty thousand organizations in fintech, healthcare, and defense
cannot use cloud AI tools by law.

Ryv is the only solution they can deploy.

Self-hosted. Air-gapped. Open source.
Built in Atlanta.
```

**Delivery note:**
- "Your code never leaves the building." = the most important line. Slow. Confident.
- "Built in Atlanta." = proud. Final. No music.

---
---

## MUSIC PROMPT

Go to: elevenlabs.io → Products → Eleven Music → Create

### FILE: background-score.mp3  (generate 2 minutes / 120 seconds)

```
Cinematic tech startup background score, 120 seconds, no lyrics, instrumental only.

Structure:
- 0:00 to 0:25: Sparse and minimal. Low synth bass pulse, slow ambient pad.
  Tension building. Like something important is about to be revealed.

- 0:25 to 0:55: Energy builds. Electronic percussion enters.
  Synth arpeggios layer in. Orchestral strings swell.
  Feels like a system coming online, intelligent, powerful.

- 0:55 to 1:20: Full momentum. Driving beat, punchy bass,
  soaring synth lead. Peak energy. Feels unstoppable.

- 1:20 to 1:50: Pulls back to mid-energy.
  Clean melodic theme over light percussion.
  Confident, not aggressive.

- 1:50 to 2:00: Resolution. Strings fade to a single clean piano note.
  Silence. Finished.

Style references: Hans Zimmer meets Daft Punk.
Netflix tech documentary opening. YC Demo Day background music.
Production quality: commercial grade.
```

**If ElevenLabs Music isn't working well, use this same prompt on:**
- suno.com (free, excellent cinematic output)
- udio.com (free, great for ambient tech scores)

---

## SOUND EFFECTS PROMPTS

Go to: elevenlabs.io → Products → Sound Effects → Generate

### FILE: sfx-transition.mp3
```
Quick digital whoosh, cinematic scene transition, 0.4 seconds,
clean and modern, slight reverb tail
```

### FILE: sfx-keyclick.mp3
```
Single mechanical keyboard key click, clean, tactile,
no background noise, 0.1 seconds
```

### FILE: sfx-sentry-alert.mp3
```
Urgent digital notification ping, two-tone descending,
like a production error alert, 0.5 seconds
```

### FILE: sfx-success.mp3
```
Soft success chime, two-note ascending,
clean UI completion sound, warm not harsh, 0.6 seconds
```

### FILE: sfx-deploy.mp3
```
Terminal boot sequence with a satisfying digital completion tone,
computer processing sounds, 1.2 seconds
```

---

## WHAT TO SEND ME

Once you've generated everything, drop the files here:
```
/Users/ashishmaurya/my_projects/remotion/public/ryv/audio/narration/
  s1-problem.mp3
  s2-blindspot.mp3
  s3-graph.mp3
  s4-autonomous.mp3
  s5-commands.mp3
  s6-rules.mp3
  s7-moat.mp3

/Users/ashishmaurya/my_projects/remotion/public/ryv/audio/music/
  background-score.mp3

/Users/ashishmaurya/my_projects/remotion/public/ryv/audio/sfx/
  sfx-transition.mp3
  sfx-keyclick.mp3
  sfx-sentry-alert.mp3
  sfx-success.mp3
  sfx-deploy.mp3
```

Then tell me "audio is ready" and I'll build the full video
with everything timed to your narration durations.

---

## QUICK CHECKLIST

- [ ] Generate s1-problem.mp3  (~9s)
- [ ] Generate s2-blindspot.mp3  (~14s)
- [ ] Generate s3-graph.mp3  (~28s)
- [ ] Generate s4-autonomous.mp3  (~24s)
- [ ] Generate s5-commands.mp3  (~13s)
- [ ] Generate s6-rules.mp3  (~13s)
- [ ] Generate s7-moat.mp3  (~10s)
- [ ] Generate background-score.mp3  (120s)
- [ ] Generate 5x SFX files
- [ ] Drop all files into the paths above
- [ ] Tell me "audio is ready" → I build the video
