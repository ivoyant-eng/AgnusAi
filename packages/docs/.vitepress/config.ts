import { defineConfig } from 'vitepress'

export default defineConfig({
  // Custom theme: packages/docs/.vitepress/theme/custom.css
  // Edit CSS vars in that file to change colors, fonts, border radius, etc.
  title: 'AgnusAI',
  description: 'Open-source, self-hostable AI code reviewer with graph-aware blast radius analysis',
  base: '/docs/',

  head: [
    ['link', { rel: 'icon', href: '/docs/favicon.ico' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'AgnusAI',

    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Architecture', link: '/architecture/overview' },
      { text: 'API', link: '/api/rest' },
      { text: 'GitHub', link: 'https://github.com/ivoyant-eng/AgnusAi' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'What is AgnusAI?', link: '/guide/what-is-agnusai' },
          { text: 'Quick Start (CLI)', link: '/guide/getting-started' },
          { text: 'Hosted Service Setup', link: '/guide/hosted-setup' },
          { text: 'Docker Compose', link: '/guide/docker' },
          { text: 'Environment Variables', link: '/guide/env-vars' },
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
          { text: 'Incremental Reviews', link: '/reference/incremental' },
          { text: 'Smart Deduplication', link: '/reference/deduplication' },
          { text: 'Skills System', link: '/reference/skills' },
          { text: 'Comment Threads', link: '/reference/comment-threads' },
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
      copyright: 'Copyright © 2025-present AgnusAI contributors',
    },

    editLink: {
      pattern: 'https://github.com/ivoyant-eng/AgnusAi/edit/master/packages/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
