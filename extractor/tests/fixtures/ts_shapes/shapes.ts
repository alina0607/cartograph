// A small TypeScript domain mirroring the Python fixture, exercising every relation kind.

interface Drawable {
  draw(): void;
}

abstract class Shape {
  name: string = "";
  abstract area(): number;
}

class Circle extends Shape implements Drawable {
  radius: number;

  constructor(r: number) {
    super();
    this.radius = r;
  }

  area(): number {
    return 3.14 * this.radius * this.radius;
  }

  draw(): void {}
}

class Color {
  r: number = 0;
  g: number = 0;
  b: number = 0;
}

class Canvas {
  shapes: Shape[] = [];
  background: Color;

  constructor() {
    this.background = new Color();
  }

  add(s: Shape): void {
    this.shapes.push(s);
  }
}

class Renderer {
  preview(): void {
    const temp = new Circle(1);
    temp.draw();
  }
}
