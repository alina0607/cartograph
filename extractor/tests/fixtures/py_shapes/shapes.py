"""A small domain that exercises every P0 relation kind, used as a golden fixture."""

from abc import ABC, abstractmethod
from typing import Protocol


class Drawable(Protocol):
    def draw(self) -> None: ...


class Shape(ABC):
    name: str

    def __init__(self) -> None:
        self.name = ""

    @abstractmethod
    def area(self) -> float: ...


class Circle(Shape, Drawable):
    def __init__(self, r: float) -> None:
        self.radius = r

    def area(self) -> float:
        return 3.14 * self.radius * self.radius

    def draw(self) -> None: ...


class Color:
    r: int
    g: int
    b: int


class Canvas:
    """A surface that owns shapes and paints them on a background."""

    def __init__(self) -> None:
        self.shapes: list[Shape] = []
        self.background: Color = Color()

    def add(self, s: Shape) -> None:
        """Add a shape to the canvas so it will be drawn."""
        self.shapes.append(s)


class Renderer:
    """Paints a canvas; constructs throwaway shapes while doing so."""

    def preview(self) -> None:
        temp = Circle(1.0)  # built and used transiently -> dependency, not a field
        temp.draw()
