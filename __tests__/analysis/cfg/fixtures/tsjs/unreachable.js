// cfg-case: unreachable
export function unreachableBranch(flag) {
  if (flag) {
    return 'early';
    return 'unreachable';
  }

  return 'late';
}
