"""Module-level functions and their calls, for the function/call-graph test."""


def helper(x: int) -> int:
    return x + 1


def main() -> int:
    return helper(helper(2))
