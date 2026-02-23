import { defineConfig } from 'tsup'

export default defineConfig([
  // CLI entry — needs executable shebang
  {
    entry: { cli: 'src/cli.ts' },
    format: ['cjs'],
    platform: 'node',
    target: 'node18',
    bundle: true,
    noExternal: ['@agnus-ai/shared'],
    clean: true,
    outDir: 'dist',
  },
  // Library entry — importable by @agnus-ai/api (workspace)
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs'],
    platform: 'node',
    target: 'node18',
    bundle: true,
    noExternal: ['@agnus-ai/shared'],
    dts: false,
    outDir: 'dist',
  },
])
