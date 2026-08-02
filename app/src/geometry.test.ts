import { describe, expect, it } from "vitest";
import { borderPoint, edgeGeom, midpoint, type Box } from "./geometry";

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
