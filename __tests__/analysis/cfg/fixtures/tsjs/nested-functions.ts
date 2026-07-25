// cfg-case: nested-functions
export function outerWorkflow(items: string[]): string[] {
  function innerStep(item: string): string {
    return item.trim().toUpperCase();
  }

  const finish = (item: string): string => `${innerStep(item)}!`;

  return items.map(finish);
}
