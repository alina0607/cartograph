"""Language frontends, dispatched by file extension.

Adding a language is a self-contained addition: write a module exposing
``EXTENSIONS`` and ``extract(source, module) -> (nodes, references)``, then
register it in :mod:`cartograph.frontends.registry`. Nothing else changes.
"""
