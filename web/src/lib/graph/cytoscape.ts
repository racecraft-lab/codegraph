import cytoscape, { type Core, type ElementDefinition } from "cytoscape"

export function createGraphRenderer(container: HTMLElement, elements: ElementDefinition[]): Core {
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
          "background-color": "oklch(0.205 0 0)",
          color: "oklch(0.145 0 0)",
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
          "line-color": "oklch(0.708 0 0)",
          "target-arrow-color": "oklch(0.708 0 0)",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
        },
      },
      {
        selector: ":selected",
        style: {
          "background-color": "oklch(0.577 0.245 27.325)",
          "line-color": "oklch(0.577 0.245 27.325)",
          "target-arrow-color": "oklch(0.577 0.245 27.325)",
        },
      },
    ],
  })
}
