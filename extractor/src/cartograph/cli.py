"""``cartograph-extract <path> -o seed.json [--html board.html]`` — the extraction entry point."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cartograph.build import build_seed
from cartograph.export import export_html, load_layout


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="cartograph-extract",
        description="Extract classes and their relationships into cartograph's seed.json.",
    )
    parser.add_argument("path", type=Path, help="source file or project directory to scan")
    parser.add_argument(
        "-o", "--output", type=Path, default=None,
        help="write seed JSON here (default: stdout)",
    )
    parser.add_argument(
        "--indent", type=int, default=2, help="JSON indent (default: 2; use 0 for compact)"
    )
    parser.add_argument(
        "--exclude", action="append", default=[], metavar="PATTERN",
        help="skip matching paths (repeatable). Without '/' a pattern matches any path "
        "component (e.g. tests, *_test.py); with '/' it matches from the scanned root",
    )
    parser.add_argument(
        "--html", type=Path, default=None, metavar="FILE",
        help="also write a self-contained board (the app's viewer with this seed) to FILE",
    )
    parser.add_argument(
        "--layout", type=Path, default=None, metavar="BOARD",
        help="with --html: start the board from the layout in BOARD, a file saved with the "
        "app's save button (its seed is ignored; the fresh scan is used)",
    )
    args = parser.parse_args(argv)

    if not args.path.exists():
        parser.error(f"path does not exist: {args.path}")
    if args.layout is not None and args.html is None:
        parser.error("--layout needs --html")
    try:
        overlay = load_layout(args.layout) if args.layout is not None else None
    except (OSError, ValueError) as e:
        parser.error(str(e))

    seed = build_seed(args.path, exclude=args.exclude)
    payload = seed.to_json()
    text = json.dumps(payload, indent=args.indent or None, ensure_ascii=False)

    if args.output is None:
        sys.stdout.write(text + "\n")
    else:
        args.output.write_text(text + "\n", encoding="utf-8")
        n_nodes = len(payload["nodes"])  # type: ignore[arg-type]
        n_rel = len(payload["relations"])  # type: ignore[arg-type]
        sys.stderr.write(f"wrote {args.output}: {n_nodes} classes, {n_rel} relations\n")
    if args.html is not None:
        board = export_html(payload, args.path.resolve().name, overlay)
        args.html.write_text(board, encoding="utf-8")
        sys.stderr.write(f"wrote {args.html}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
