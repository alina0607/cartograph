"""Metaclass fixture: a registry metaclass, a metaclass derived from it, and their classes."""

from abc import ABCMeta, abstractmethod


class PluginMeta(ABCMeta):
    """Registers every plugin class by name."""

    registry: dict[str, type] = {}

    def __new__(mcls, name, bases, namespace):
        cls = super().__new__(mcls, name, bases, namespace)
        mcls.registry[name] = cls
        return cls


class StrictMeta(PluginMeta):
    """A metaclass of a metaclass in this scan: a metaclass too, found only after resolving."""


class Plugin(metaclass=PluginMeta):
    @abstractmethod
    def run(self) -> None: ...


class Echo(Plugin):
    def run(self) -> None: ...


class Strict(metaclass=StrictMeta):
    pass


class Counter(type):
    """A metaclass straight from ``type``."""


class Shape(metaclass=ABCMeta):  # noqa: B024 (abstract only through its metaclass)
    """Abstract through ``metaclass=ABCMeta`` (a stdlib metaclass, so no edge is drawn)."""
