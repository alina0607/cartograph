function helper(x: number): number {
  return x + 1;
}

function run(): number {
  return helper(helper(2));
}
