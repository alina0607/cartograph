# cartograph (extractor)

The extraction layer of [Cartograph](../README.md). It reads source code and emits
`seed.json` — the deterministic facts about a codebase's classes and how they relate —
for the canvas app to render.

```bash
uv run cartograph-extract path/to/project -o seed.json
```

Frontends live under `src/cartograph/frontends/` and are registered by file extension,
so adding a language is a self-contained change. Python (stdlib `ast`) ships first;
TypeScript and Go (tree-sitter) follow.
