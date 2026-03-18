import { defineConfig } from 'vitepress'

export default defineConfig({
  // Custom theme: packages/docs/.vitepress/theme/custom.css
  // Edit CSS vars in that file to change colors, fonts, border radius, etc.
  title: 'Ryv AI',
  description: 'Ryv AI — open-source, self-hostable AI code reviewer with graph-aware blast radius analysis, multi-agent review, and rules enforcement. Self-hosted, MIT licensed.',
  base: '/docs/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/docs/favicon.svg' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Ryv AI',

    nav: [
      { text: 'Guide', link: '/guide/what-is-agnusai' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'API', link: '/api/rest' },
      { text: 'GitHub', link: 'https://github.com/ivoyant-eng/AgnusAi' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'What is Ryv?', link: '/guide/what-is-agnusai' },
          { text: 'Hosted Service Setup', link: '/guide/hosted-setup' },
          { text: 'Docker Compose', link: '/guide/docker' },
          { text: 'Environment Variables', link: '/guide/env-vars' },
        ],
      },
      {
        text: 'Connecting Repositories',
        items: [
          { text: 'Overview', link: '/guide/connect-overview' },
          { text: 'GitHub — App Installation', link: '/guide/github-app' },
          { text: 'Azure DevOps — Entra ID & PAT', link: '/guide/azure-devops' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'Overview', link: '/architecture/overview' },
          { text: 'Monorepo Layers', link: '/architecture/layers' },
          { text: 'Graph Engine', link: '/architecture/graph-engine' },
          { text: 'Indexing Pipeline', link: '/architecture/indexing' },
          { text: 'Retriever & RAG', link: '/architecture/retriever' },
        ],
      },
      {
        text: 'LLM Providers',
        items: [
          { text: 'Ollama (local)', link: '/providers/ollama' },
          { text: 'OpenAI', link: '/providers/openai' },
          { text: 'Claude (Anthropic)', link: '/providers/claude' },
          { text: 'Azure OpenAI', link: '/providers/azure' },
        ],
      },
      {
        text: 'Embedding Providers',
        items: [
          { text: 'Overview & Model Comparison', link: '/providers/embeddings' },
          { text: 'Ollama Embeddings', link: '/providers/embeddings-ollama' },
          { text: 'OpenAI Embeddings', link: '/providers/embeddings-openai' },
          { text: 'Google Embeddings', link: '/providers/embeddings-google' },
          { text: 'Generic HTTP (Cohere, Voyage…)', link: '/providers/embeddings-http' },
        ],
      },
      {
        text: 'Review Modes',
        items: [
          { text: 'Fast / Standard / Deep', link: '/guide/review-modes' },
        ],
      },
      {
        text: 'Language Support',
        items: [
          { text: 'Supported Languages', link: '/reference/languages' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: '@ryv Commands', link: '/reference/commands' },
          { text: 'Multi-Agent Review', link: '/reference/multi-agent' },
          { text: 'Rules System', link: '/reference/rules' },
          { text: 'Token Usage', link: '/reference/token-usage' },
          { text: 'Incremental Reviews', link: '/reference/incremental' },
          { text: 'Precision Filter', link: '/guide/review-modes#precision-filter' },
          { text: 'Smart Deduplication', link: '/reference/deduplication' },
          { text: 'Comment Threads', link: '/reference/comment-threads' },
          { text: 'Tool-Augmented Review', link: '/reference/tool-augmented' },
          { text: 'Self-Reflection Quality Gate', link: '/reference/self-reflection' },
          { text: 'Feedback & Learning Loop', link: '/guide/hosted-setup#feedback-learning-loop' },
          { text: 'Known Issues & Blindspots', link: '/reference/known-issues' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'REST Endpoints', link: '/api/rest' },
          { text: 'Webhooks', link: '/api/webhooks' },
          { text: 'SSE Indexing Progress', link: '/api/sse' },
        ],
      },
      {
        text: 'Development',
        items: [
          { text: 'Dev Setup', link: '/development/setup' },
          { text: 'Testing Guide', link: '/development/testing' },
          { text: 'Contributing', link: '/development/contributing' },
          { text: 'ADR-001: Architecture', link: '/architecture/adr' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ivoyant-eng/AgnusAi' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025-present Ryv AI contributors',
    },

    editLink: {
      pattern: 'https://github.com/ivoyant-eng/AgnusAi/edit/master/packages/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
