---
layout: home

hero:
  name: "AgnusAI"
  text: "Graph-aware AI code reviewer"
  tagline: Self-hostable. Runs parallel specialist agents. Enforces your team's rules. Understands blast radius.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/hosted-setup
    - theme: alt
      text: What is AgnusAI?
      link: /guide/what-is-agnusai
    - theme: alt
      text: GitHub
      link: https://github.com/ivoyant-eng/AgnusAi

features:
  - icon: 🕸️
    title: Graph-aware Blast Radius
    details: Builds a symbol dependency graph with Tree-sitter. Knows which callers are affected by every changed function before the LLM sees a single line.
  - icon: 🤖
    title: Multi-Agent Review
    details: Parallel specialist agents — Security, Correctness, Performance, Style, Blast Radius — each with a focused directive. A judge pass consolidates findings and removes duplicates.
  - icon: 📋
    title: Rules System
    details: Define standards in plain language. Rules are scoped to org, repo, or path. Every review enforces them, records evaluations, and tracks violations through to production merge.
  - icon: 🎯
    title: Precision Filter
    details: The LLM self-scores every comment with [Confidence X.X]. Anything below the threshold (default 0.7) is silently dropped — only high-signal findings reach your PR.
  - icon: 🧠
    title: Feedback Learning Loop
    details: Developers rate comments with 👍/👎. Accepted findings are embedded and retrieved as team-specific examples on the next review — the model gets better with every rating.
  - icon: 📊
    title: Token Usage Tracking
    details: Per-agent, per-repo, and per-org token consumption tracked and surfaced in Settings with custom date ranges and daily breakdowns.
  - icon: 🔌
    title: Any LLM, Any Platform
    details: Ollama, OpenAI, Azure OpenAI, Claude, or any OpenAI-compatible endpoint. GitHub and Azure DevOps webhooks. Org-scoped secrets managed without redeployment.
  - icon: 🔒
    title: Privacy by Design
    details: No raw source code stored — only signatures, edges, and embedding vectors. Air-gap compatible with local Ollama. Your code never leaves your infrastructure.
---
