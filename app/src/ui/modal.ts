// The method detail popup: name, docstring, and source pulled from the code.
// Plain DOM (not SVG) so text selection and scrolling are the browser's job.

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
          ? `<p class="cb-doc">${esc(method.doc)}</p>`
          : `<p class="cb-doc cb-empty">No docstring in the source.</p>`
      }
      <pre class="cb-src"><code>${esc(method.source || "# source unavailable")}</code></pre>
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
