package funcs

func helper(x int) int { return x + 1 }

func run() int { return helper(helper(2)) }
