# Cartograph

**A cartographer for your codebase.** Cartograph reads a project's source and draws
its classes and how they relate — inheritance, realization, composition, aggregation,
association, and dependency — onto an infinite canvas you arrange by hand. It is a
tool for *understanding* code, not a report generator.

Every box and every connector is yours to move: drag a class, bend a relationship
line to route it cleanly, collapse a class to a single line, and click a method to
read its docstring and source in place. Pin sticky notes, drop in screenshots, and
frame related types with dashed groups — then save the whole board as a document you
can reopen and keep as study notes.

## Highlights

- **Multi-language, by design.** Language frontends are registered by file extension,
  so support grows without touching the core. Python ships today; TypeScript and Go
  are next.
- **Six UML relationships, resolved from real code.** Composition is distinguished
  from aggregation and association by how a type is actually used (owned vs. held vs.
  referenced); transient constructions become dependency edges.
- **Direct manipulation.** Draggable classes, editable connector curvature, collapse /
  expand, pan and zoom — all persisted per project.
- **Annotations from the source.** Each class's docstring is drawn as a linked note;
  each method's docstring and source open in a detail popup.
- **A study surface.** Sticky notes, embedded images, dashed groups (a group carries
  its contents when moved), and JSON save / load.
- **No cycle warnings.** Draw the dependencies and a cycle is plain to the eye — the
  tool shows structure and leaves judgement to you.

## Architecture

Two decoupled layers communicate over a JSON contract:

| Layer        | Stack                       | Responsibility                                    |
| ------------ | --------------------------- | ------------------------------------------------- |
| `extractor/` | Python (`ast`, tree-sitter) | Parse source into a deterministic `seed.json`.    |
| `app/`       | Vite + TypeScript + SVG     | Render an interactive canvas; `seed` plus a manual overlay make a saved document. |

Re-scanning a project merges fresh facts into an existing board without disturbing the
layout you arranged by hand.

## Getting started

Requirements: Python 3.11+ with [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
# 1. Install the app's dependencies
cd app && npm install

# 2. Draw a project — starts the dev server and opens the board pointed at a folder
bin/cartograph /path/to/a/python/project
```

Or drive the two layers directly:

```bash
# Extract a project to a seed file
cd extractor && uv run cartograph-extract /path/to/project -o ../app/public/seed.json

# Run the canvas
cd ../app && npm run dev
```

Inside the app you can also pick a folder with the **browse…** button, or paste a path
and hit **scan**.

## Roadmap

- [x] Python frontend, six UML relationships, interactive canvas, study-notes layer
- [x] TypeScript frontend
- [x] Cross-language contracts (a concept shared between, e.g., a Python and a TypeScript type)
- [ ] Go frontend

## License

MIT © Alina Chuang
