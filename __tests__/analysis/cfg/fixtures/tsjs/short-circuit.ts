// cfg-case: short-circuit
export function shortCircuit(user: { active?: boolean; role?: string } | null): boolean {
  return Boolean(user && user.active && (user.role === 'admin' || user.role === 'owner'));
}
