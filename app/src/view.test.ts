import { describe, expect, it } from "vitest";
import { fitView, MAX_ZOOM, MIN_ZOOM, wheelPixels, zoomAbout, type Bounds } from "./view";

// Where a world point lands on screen under a view.
const screen = (v: { panX: number; panY: number; zoom: number }, x: number, y: number) => ({
  x: v.panX + x * v.zoom,
  y: v.panY + y * v.zoom,
});

describe("opening fit", () => {
  it("shrinks a big board until every box is on screen, centred", () => {
    const b: Bounds = { minX: 60, minY: 60, maxX: 4060, maxY: 2560 };
    const v = fitView(b, 1280, 800)!;
    expect(v.zoom).toBeCloseTo(0.28, 6); // min(1180 / 4000, 700 / 2500)
    const tl = screen(v, b.minX, b.minY);
    const br = screen(v, b.maxX, b.maxY);
    expect(tl.x).toBeGreaterThanOrEqual(50 - 1e-9);
    expect(tl.y).toBeGreaterThanOrEqual(50 - 1e-9);
    expect(br.x).toBeLessThanOrEqual(1230 + 1e-9);
    expect(br.y).toBeLessThanOrEqual(750 + 1e-9);
    expect(tl.x + br.x).toBeCloseTo(1280, 6); // centred horizontally
  });

  it("keeps a small board at natural size instead of blowing it up", () => {
    const v = fitView({ minX: 60, minY: 60, maxX: 360, maxY: 260 }, 1280, 800)!;
    expect(v.zoom).toBe(1);
    expect(screen(v, 60, 60).x + screen(v, 360, 260).x).toBeCloseTo(1280, 6);
  });

  it("stops at the minimum zoom and starts a huge board at its top-left", () => {
    const v = fitView({ minX: 0, minY: 0, maxX: 100_000, maxY: 50_000 }, 1280, 800)!;
    expect(v.zoom).toBe(MIN_ZOOM);
    expect(screen(v, 0, 0)).toEqual({ x: 50, y: 50 });
  });

  it("keeps a strip on the left clear for the legend", () => {
    const b: Bounds = { minX: 0, minY: 0, maxX: 2000, maxY: 1000 };
    const v = fitView(b, 1280, 800, 300)!;
    expect(screen(v, 0, 0).x).toBeGreaterThanOrEqual(300 + 50 - 1e-9);
    expect(screen(v, 2000, 1000).x).toBeLessThanOrEqual(1230 + 1e-9);
    expect(v.zoom).toBeCloseTo(0.44, 6); // (1280 - 300 - 100) / 2000
  });

  it("does nothing before the window has a size", () => {
    expect(fitView({ minX: 0, minY: 0, maxX: 500, maxY: 500 }, 0, 0)).toBeNull();
  });
});

describe("wheel", () => {
  it("zooms about the cursor: the point under it stays put", () => {
    const v = { panX: 120, panY: -40, zoom: 0.5 };
    const before = { x: (300 - v.panX) / v.zoom, y: (200 - v.panY) / v.zoom };
    const z = zoomAbout(v, 300, 200, -100);
    expect(z.zoom).toBeGreaterThan(v.zoom); // scrolling up zooms in
    const after = screen(z, before.x, before.y);
    expect(after.x).toBeCloseTo(300, 6);
    expect(after.y).toBeCloseTo(200, 6);
  });

  it("clamps the zoom at both ends", () => {
    const v = { panX: 0, panY: 0, zoom: 1 };
    expect(zoomAbout(v, 0, 0, 100_000).zoom).toBe(MIN_ZOOM);
    expect(zoomAbout(v, 0, 0, -100_000).zoom).toBe(MAX_ZOOM);
  });

  it("converts line and page deltas to pixels", () => {
    expect(wheelPixels(3, 0)).toBe(3);
    expect(wheelPixels(3, 1)).toBe(48);
    expect(wheelPixels(1, 2)).toBe(600);
  });
});
