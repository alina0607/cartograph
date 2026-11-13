// The method detail popup: name, docstring, and the source coloured like PyCharm.
// Plain DOM (not SVG) so text selection and scrolling are the browser's job.

import { renderDocstring } from "../docfmt";
import { highlightCode } from "../highlight";
import type { SeedMethod, SeedNode } from "../model";

export function openMethodModal(node: SeedNode, method: SeedMethod): void {
  closeAny();
  const backdrop = document.createElement("div");
  backdrop.className = "cb-backdrop";
  backdrop.innerHTML = `
    <div class="cb-modal" role="dialog" aria-modal="true">
      <header class="cb-head">
        <div class="cb-title"><span class="cb-owner">${esc(node.name)}</span>.<b>${esc(
          method.name,
        )}</b>()</div>
        <button class="cb-close" aria-label="Close">✕</button>
      </header>
      <div class="cb-sub">${esc(node.module)}</div>
      ${
        method.doc
          ? `<div class="cb-doc ds">${renderDocstring(method.doc)}</div>`
          : `<p class="cb-doc cb-empty">No docstring in the source.</p>`
      }
      <pre class="cb-src"><code>${
        method.source
          ? highlightCode(method.source, node.lang, method.name)
          : `<span class="hl-com">${esc("# source unavailable")}</span>`
      }</code></pre>
    </div>`;
  document.body.appendChild(backdrop);

  const remove = () => {
    backdrop.remove();
    window.removeEventListener("keydown", onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") remove();
  };
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) remove(); // click outside the card closes it
  });
  backdrop.querySelector(".cb-close")!.addEventListener("click", remove);
  window.addEventListener("keydown", onKey);
}

function closeAny(): void {
  document.querySelectorAll(".cb-backdrop").forEach((n) => n.remove());
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
