"""Outside classes: which standard-library and third-party classes get drawn, and how."""

from abc import ABCMeta
from collections import Counter
from enum import Enum

import torch.nn as tnn
from py_ext.config import Missing
from torch import nn

from .helpers import Local


class Meta(ABCMeta):
    """Inherits a standard-library metaclass."""


class Net(nn.Module):
    """Inherits a third-party class and owns two more."""

    def __init__(self) -> None:
        super().__init__()
        self.emb = nn.Embedding(10, 4)
        self.out = tnn.Linear(4, 10)  # same module, imported another way: one box


class Pop:
    def __init__(self) -> None:
        self.counts = Counter()  # standard-library composition
        self.net = Net()  # a class in this scan
        self.helper = Local()  # relative import: this project's code, never "library"
        self.missing = Missing()  # this project's own top package: a scan gap, not a library


class Color(Enum):
    RED = 1


class BadInput(ValueError):
    """A builtin base, never imported."""


class Plain(metaclass=Meta):
    pass
