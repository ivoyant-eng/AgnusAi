---
layout: home

hero:
  name: "AgnusAI"
  text: "Graph-aware AI code reviewer"
  tagline: Open-source, self-hostable. Understands blast radius before it reviews your PR.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Architecture
      link: /architecture/overview
    - theme: alt
      text: GitHub
      link: https://github.com/ivoyant-eng/AgnusAi

features:
  - icon: 🔍
    title: Diff-aware Reviews
    details: Reviews only what changed. Checkpoints prevent re-reviewing unchanged files on every push.
  - icon: 🕸️
    title: Graph-aware Blast Radius
    details: Builds a dependency graph of your repo using Tree-sitter. Knows which callers are affected before the LLM sees a single line.
  - icon: 🧠
    title: Semantic Neighbors (Deep Mode)
    details: Embeds all symbols via pgvector. In deep mode, semantically similar code is surfaced even if it has no direct graph edge.
  - icon: 🔌
    title: Any LLM, Any Embedding
    details: Ollama, OpenAI, Claude, Azure OpenAI for generation. Ollama, OpenAI, Google, or any OpenAI-compatible URL for embeddings.
  - icon: 🌐
    title: Multi-language Parsers
    details: TypeScript, JavaScript, Python, Java, Go, C# — all parsed with Tree-sitter WASM. No language server required.
  - icon: 🐳
    title: Self-hostable
    details: One docker compose up. Postgres + pgvector + Ollama included. No cloud dependency.
---
