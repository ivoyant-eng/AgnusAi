import { InMemorySymbolGraph } from '../src/graph/InMemorySymbolGraph'
import type { ParsedSymbol } from '@agnus-ai/shared'

function makeSymbol(id: string, filePath: string): ParsedSymbol {
  return {
    id,
    filePath,
    name: id.split(':')[1] ?? id,
    qualifiedName: id.split(':')[1] ?? id,
    kind: 'function',
    signature: `function ${id.split(':')[1] ?? id}()`,
    bodyRange: [1, 10],
    repoId: 'test-repo',
  }
}

describe('InMemorySymbolGraph', () => {
  describe('addSymbol / getSymbol', () => {
    it('stores and retrieves a symbol', () => {
      const g = new InMemorySymbolGraph()
      const s = makeSymbol('src/a.ts:foo', 'src/a.ts')
      g.addSymbol(s)
      expect(g.getSymbol('src/a.ts:foo')).toEqual(s)
    })
  })

  describe('getCallers / getCallees', () => {
    it('returns direct callers (1 hop)', () => {
      const g = new InMemorySymbolGraph()
      const foo = makeSymbol('src/a.ts:foo', 'src/a.ts')
      const bar = makeSymbol('src/b.ts:bar', 'src/b.ts')
      g.addSymbol(foo)
      g.addSymbol(bar)
      g.addEdge({ from: 'src/b.ts:bar', to: 'src/a.ts:foo', kind: 'calls' })

      const callers = g.getCallers('src/a.ts:foo', 1)
      expect(callers).toHaveLength(1)
      expect(callers[0].id).toBe('src/b.ts:bar')
    })

    it('returns transitive callers (2 hops)', () => {
      const g = new InMemorySymbolGraph()
      const foo = makeSymbol('src/a.ts:foo', 'src/a.ts')
      const bar = makeSymbol('src/b.ts:bar', 'src/b.ts')
      const baz = makeSymbol('src/c.ts:baz', 'src/c.ts')
      g.addSymbol(foo)
      g.addSymbol(bar)
      g.addSymbol(baz)
      g.addEdge({ from: 'src/b.ts:bar', to: 'src/a.ts:foo', kind: 'calls' })
      g.addEdge({ from: 'src/c.ts:baz', to: 'src/b.ts:bar', kind: 'calls' })

      const callers = g.getCallers('src/a.ts:foo', 2)
      expect(callers.map(s => s.id)).toContain('src/b.ts:bar')
      expect(callers.map(s => s.id)).toContain('src/c.ts:baz')
    })
  })

  describe('getBlastRadius', () => {
    it('computes risk score and affected files', () => {
      const g = new InMemorySymbolGraph()
      const target = makeSymbol('src/core.ts:process', 'src/core.ts')
      const caller1 = makeSymbol('src/api.ts:handler', 'src/api.ts')
      const caller2 = makeSymbol('src/worker.ts:run', 'src/worker.ts')
      g.addSymbol(target)
      g.addSymbol(caller1)
      g.addSymbol(caller2)
      g.addEdge({ from: 'src/api.ts:handler', to: 'src/core.ts:process', kind: 'calls' })
      g.addEdge({ from: 'src/worker.ts:run', to: 'src/core.ts:process', kind: 'calls' })

      const br = g.getBlastRadius(['src/core.ts:process'])
      expect(br.directCallers).toHaveLength(2)
      expect(br.riskScore).toBeGreaterThan(0)
      expect(br.affectedFiles).toContain('src/api.ts')
      expect(br.affectedFiles).toContain('src/worker.ts')
    })
  })

  describe('removeFile', () => {
    it('removes all symbols and edges for a file', () => {
      const g = new InMemorySymbolGraph()
      g.addSymbol(makeSymbol('src/a.ts:foo', 'src/a.ts'))
      g.addSymbol(makeSymbol('src/b.ts:bar', 'src/b.ts'))
      g.addEdge({ from: 'src/b.ts:bar', to: 'src/a.ts:foo', kind: 'calls' })

      g.removeFile('src/a.ts')
      expect(g.getSymbol('src/a.ts:foo')).toBeUndefined()
      expect(g.getCallers('src/a.ts:foo', 1)).toHaveLength(0)
    })
  })

  describe('serialize / deserialize', () => {
    it('round-trips correctly', () => {
      const g = new InMemorySymbolGraph()
      const s = makeSymbol('src/a.ts:foo', 'src/a.ts')
      g.addSymbol(s)
      g.addEdge({ from: 'src/a.ts:foo', to: 'bar', kind: 'calls' })

      const json = g.serialize()
      const g2 = InMemorySymbolGraph.deserialize(json)
      expect(g2.getSymbol('src/a.ts:foo')).toEqual(s)
      expect(g2.getAllEdges()).toHaveLength(1)
    })
  })
})
