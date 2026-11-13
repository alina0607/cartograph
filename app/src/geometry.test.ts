import { describe, expect, it } from "vitest";
import {
  borderPoint,
  dims,
  edgeGeom,
  FONT,
  midpoint,
  polylineGeom,
  setTextMeasurer,
  type Box,
} from "./geometry";
import type { SeedNode } from "./model";

describe("borderPoint", () => {
  const box: Box = { cx: 0, cy: 0, w: 100, h: 60 };
  it("exits the vertical edge when aimed sideways", () => {
    expect(borderPoint(box, { x: 1000, y: 0 })).toEqual({ x: 50, y: 0 });
  });
  it("exits the horizontal edge when aimed up/down", () => {
    expect(borderPoint(box, { x: 0, y: 1000 })).toEqual({ x: 0, y: 30 });
  });
});

describe("edgeGeom", () => {
  const src: Box = { cx: 0, cy: 0, w: 100, h: 60 };
  const dst: Box = { cx: 400, cy: 0, w: 100, h: 60 };

  it("handle sits at the straight midpoint when unbent", () => {
    const g = edgeGeom(src, dst, [0, 0]);
    expect(g.handle).toEqual(midpoint({ x: 0, y: 0 }, { x: 400, y: 0 }));
  });

  it("the curve passes through the dragged handle", () => {
    const bend: [number, number] = [30, -80];
    const g = edgeGeom(src, dst, bend);
    // B(0.5) of M p0 Q ctrl p1 must equal the handle M — the bend is grabbable on-curve.
    const m = /M ([\d.-]+) ([\d.-]+) Q ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/.exec(g.path)!;
    const [p0x, p0y, cx, cy, p1x, p1y] = m.slice(1).map(Number) as [
      number, number, number, number, number, number,
    ];
    const bx = 0.25 * p0x + 0.5 * cx + 0.25 * p1x;
    const by = 0.25 * p0y + 0.5 * cy + 0.25 * p1y;
    expect(bx).toBeCloseTo(g.handle.x, 1);
    expect(by).toBeCloseTo(g.handle.y, 1);
    expect(g.handle).toEqual({ x: 200 + 30, y: 0 - 80 });
  });
});

describe("polylineGeom", () => {
  const pts = [
    { x: 100, y: 100 },
    { x: 100, y: 160 },
    { x: 300, y: 160 },
    { x: 300, y: 220 },
  ];

  it("keeps the router's endpoints, so the markers land on the box borders", () => {
    const g = polylineGeom(pts, { x: 200, y: 160 });
    expect(g.p0).toEqual(pts[0]);
    expect(g.p1).toEqual(pts[3]);
  });

  it("points the end markers along the first and last runs", () => {
    const g = polylineGeom(pts, { x: 200, y: 160 });
    expect(g.dirStart).toEqual({ x: 0, y: 1 }); // leaves downward
    expect(g.dirEnd).toEqual({ x: 0, y: 1 }); // arrives downward
  });

  it("rounds every interior corner, so the path is one continuous stroke", () => {
    const d = polylineGeom(pts, { x: 200, y: 160 }).path;
    expect((d.match(/Q /g) ?? []).length).toBe(pts.length - 2);
    expect(d.startsWith("M 100 100")).toBe(true);
  });
});

describe("box width follows the measured text", () => {
  const cls = (attr: string): SeedNode =>
    ({
      key: "m.py#C",
      name: "C",
      module: "m.py",
      kind: "class",
      attributes: [[attr, "int"]],
      methods: [],
      doc: "",
      lang: "python",
    }) as unknown as SeedNode;

  it("grows a box when the browser's font is wider than the estimate", () => {
    const n = cls("a_rather_long_attribute_name");
    const estimated = dims(n).w;
    setTextMeasurer((text, px) => text.length * px * 0.75); // a wider font
    try {
      const measured = dims(n).w;
      expect(measured).toBeGreaterThan(estimated);
      // the longest line, drawn at the body size, fits between the paddings
      const line = `+ a_rather_long_attribute_name: int`;
      expect(measured).toBeGreaterThanOrEqual(Math.ceil(line.length * FONT.body * 0.75));
    } finally {
      setTextMeasurer((text, px) => text.length * px * 0.6);
    }
  });
});
