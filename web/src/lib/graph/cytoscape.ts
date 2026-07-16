import cytoscape, { type Core, type ElementDefinition } from "cytoscape"

interface GraphRendererColors {
  node: string
  label: string
  edge: string
  selected: string
}

function cssColor(container: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(container).getPropertyValue(name).trim() || fallback
}

export function resolveGraphRendererColors(container: HTMLElement): GraphRendererColors {
  return {
    node: cssColor(container, "--primary", "oklch(0.205 0 0)"),
    label: cssColor(container, "--foreground", "oklch(0.145 0 0)"),
    edge: cssColor(container, "--ring", "oklch(0.708 0 0)"),
    selected: cssColor(container, "--destructive", "oklch(0.577 0.245 27.325)"),
  }
}

export function createGraphRenderer(container: HTMLElement, elements: ElementDefinition[]): Core {
  const colors = resolveGraphRendererColors(container)

  return cytoscape({
    container,
    elements,
    layout: { name: "breadthfirst", directed: true, padding: 24 },
    minZoom: 0.25,
    maxZoom: 2.5,
    style: [
      {
        selector: "node",
        style: {
          "background-color": colors.node,
          color: colors.label,
          label: "data(label)",
          "font-size": 10,
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 6,
          width: 24,
          height: 24,
        },
      },
      {
        selector: "edge",
        style: {
          width: 1,
          "line-color": colors.edge,
          "target-arrow-color": colors.edge,
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        },
      },
      {
        selector: ":selected",
        style: {
          "background-color": colors.selected,
          "line-color": colors.selected,
          "target-arrow-color": colors.selected,
        },
      },
    ],
  })
}
