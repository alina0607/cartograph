// What the legend says about arrows. Kept free of the DOM so the wording and the "every kind,
// present or not" rule can be unit-tested.

export interface ArrowStyle {
  glyph: string;
  color: string;
  label: string;
}

// The relationship words a reader knows from OOP come first (is-a, has-a, uses-a), the UML
// name after, so the legend can be read without knowing UML.
export const ARROWS: Record<string, ArrowStyle> = {
  inherits: { glyph: "▷", color: "#a86bff", label: "is-a: inheritance" },
  implements: { glyph: "▷", color: "#a86bff", label: "implements (dashed)" },
  instanceof: { glyph: "⇢", color: "#c2410c", label: "instance of — metaclass" },
  composition: { glyph: "◆", color: "#f4c26f", label: "has-a: composition (owns)" },
  aggregation: { glyph: "◇", color: "#f4c26f", label: "has-a: aggregation (shared)" },
  association: { glyph: "→", color: "#5ec8a0", label: "uses-a: association" },
  dependency: { glyph: "⇢", color: "#8894c4", label: "dependency — transient" },
  import: { glyph: "⇢", color: "#8894c4", label: "import" },
  contract: { glyph: "⇠⇢", color: "#db2777", label: "cross-language" },
  calls: { glyph: "→", color: "#2e78c9", label: "calls (function)" },
};

export interface ArrowRow extends ArrowStyle {
  kind: string;
  present: boolean;
}

// Every arrow kind, in a fixed order, each marked present when the board has one. Listing the
// absent kinds too tells the reader what a missing arrow means: "no composition" is a fact
// about the code, not a gap in the legend.
export function arrowRows(present: ReadonlySet<string>): ArrowRow[] {
  return Object.entries(ARROWS).map(([kind, style]) => ({
    kind,
    ...style,
    present: present.has(kind),
  }));
}
