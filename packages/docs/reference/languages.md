# Supported Languages

All parsing uses [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) WASM grammars — no language server, no daemon, deterministic output.

## Language Support Matrix

| Language | Extensions | Symbols | Call Edges | Import Edges | Inheritance Edges |
|----------|-----------|---------|-----------|--------------|------------------|
| TypeScript | `.ts`, `.tsx` | ✅ | ✅ | ✅ | ✅ |
| JavaScript | `.js`, `.jsx` | ✅ | ✅ | ✅ | ✅ |
| Python | `.py` | ✅ | ✅ | ✅ | ✅ |
| Java | `.java` | ✅ | ✅ | ✅ | ✅ |
| C# | `.cs` | ✅ | ✅ | ✅ | ✅ |
| Go | `.go` | ✅ | ✅ | ✅ | ❌ (structs, not inheritance) |

## What Is Extracted

### TypeScript / JavaScript

- `function_declaration`, `arrow_function`, `method_definition` → function/method symbols
- `class_declaration`, `abstract_class_declaration` → class symbols
- `interface_declaration` → interface symbols
- `type_alias_declaration` → type symbols
- `lexical_declaration` with arrow function value → const fn symbols
- `import_statement` → import edges
- `call_expression` → call edges
- `extends`/`implements` in class heritage → inheritance edges

### Python

- `function_definition`, `async_function_definition` → function symbols
- `class_definition` → class symbols
- `import_statement`, `import_from_statement` → import edges
- `call` → call edges
- Base class list in `class_definition` → inheritance edges

### Java

- `method_declaration`, `constructor_declaration` → method symbols
- `class_declaration`, `interface_declaration` → class/interface symbols
- `import_declaration` → import edges
- `method_invocation` → call edges
- `superclass`, `super_interfaces` → inheritance/implements edges

### Go

- `function_declaration` → function symbols
- `method_declaration` (with receiver) → method symbols, qualified as `ReceiverType.MethodName`
- `type_declaration` with `struct_type` → class-like symbols
- `type_declaration` with `interface_type` → interface symbols
- `import_declaration` → import edges
- `call_expression` with `selector_expression` → call edges

### C#

- `method_declaration`, `constructor_declaration` → method symbols
- `class_declaration`, `record_declaration` → class symbols
- `interface_declaration` → interface symbols
- `using_directive` → import edges
- `invocation_expression` with `member_access_expression` → call edges
- `base_list` in class declaration → inheritance edges

## WASM ABI Compatibility

Tree-sitter grammars are compiled for a specific ABI version. The web-tree-sitter runtime currently supports ABI versions 13–14.

| Grammar | ABI | Status |
|---------|-----|--------|
| `tree-sitter-typescript` | 14 | ✅ Loaded |
| `tree-sitter-python` | 14 | ✅ Loaded |
| `tree-sitter-java` | 14 | ✅ Loaded |
| `tree-sitter-c-sharp` | 14 | ✅ Loaded |
| `tree-sitter-go` | 15 | ⚠️ Skipped (ABI 15 vs runtime 13–14) |

Go parsing is currently skipped at runtime due to this mismatch. A fix requires either upgrading `web-tree-sitter` to support ABI 15 or pinning `tree-sitter-go` to an ABI-14 compatible version.

## Adding a New Language

1. Install the Tree-sitter grammar: `pnpm --filter @agnus-ai/core add tree-sitter-<lang>`
2. Create `packages/core/src/parser/<Lang>Parser.ts` — implement `LanguageParser` using `TreeSitterParser` as base
3. Register in `createDefaultRegistry()` in `ParserRegistry.ts`
4. Add the extension to `INDEXED_EXTENSIONS` in `Indexer.ts`
