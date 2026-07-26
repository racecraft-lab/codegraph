// cfg-case: baseline
export function baselineScore(input: number): number {
  let total = input;

  if (input > 10) {
    total += 5;
  } else {
    total -= 1;
  }

  return total;
}
