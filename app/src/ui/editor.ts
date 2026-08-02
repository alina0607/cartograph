// A tiny modal text editor for note bodies and group labels. Resolves to the new value,
// or null if cancelled. Kept out of the SVG so editing is native (selection, IME, undo).

interface EditorOpts {
  title: string;
  value: string;
  multiline: boolean;
}

export function openEditor(opts: EditorOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "cb-backdrop";
    const field = opts.multiline
      ? `<textarea class="cb-edit" rows="6">${escapeHtml(opts.value)}</textarea>`
      : `<input class="cb-edit" type="text" value="${escapeAttr(opts.value)}" />`;
    backdrop.innerHTML = `
      <div class="cb-modal" role="dialog" aria-modal="true">
        <header class="cb-head"><div class="cb-title">${escapeHtml(opts.title)}</div>
          <button class="cb-close" aria-label="Close">✕</button></header>
        <div class="cb-editwrap">${field}</div>
        <div class="cb-actions"><button class="cb-save">save</button></div>
      </div>`;
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector(".cb-edit") as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    input.select();

    const done = (val: string | null) => {
      backdrop.remove();
      window.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(null);
      // Enter saves a single-line label; a textarea keeps Enter for newlines.
      else if (e.key === "Enter" && !opts.multiline) done(input.value);
    };
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop) done(null);
    });
    backdrop.querySelector(".cb-close")!.addEventListener("click", () => done(null));
    backdrop.querySelector(".cb-save")!.addEventListener("click", () => done(input.value));
    window.addEventListener("keydown", onKey);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
