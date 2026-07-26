// cfg-case: optional-chaining
type OptionalUser = {
  profile?: {
    name?: string;
  };
};

export function optionalChain(user?: OptionalUser): string {
  return user?.profile?.name ?? 'anonymous';
}
