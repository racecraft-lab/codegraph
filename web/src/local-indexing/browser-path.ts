function segments(path: string) {
  return path.replaceAll("\\", "/").split("/")
}

export function basename(path: string) {
  return segments(path).filter(Boolean).at(-1) ?? ""
}

export function extname(path: string) {
  const name = basename(path)
  const dot = name.lastIndexOf(".")
  return dot <= 0 ? "" : name.slice(dot)
}

export const posix = {
  normalize(path: string) {
    const absolute = path.startsWith("/")
    const output: string[] = []
    for (const segment of segments(path)) {
      if (!segment || segment === ".") continue
      if (segment === "..") output.pop()
      else output.push(segment)
    }
    return `${absolute ? "/" : ""}${output.join("/")}` || (absolute ? "/" : ".")
  },
}
