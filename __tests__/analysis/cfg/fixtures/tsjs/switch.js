// cfg-case: switch
export function switchRoute(state) {
  switch (state) {
    case 'start':
      return 'queued';
    case 'run':
      return 'active';
    case 'stop':
      return 'done';
    default:
      return 'unknown';
  }
}
