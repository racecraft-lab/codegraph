import type { Node } from '../../types';
import type { AffectedFlowItem, CallerImpact, DetectChangesGraph, ImpactReport } from './index';
import { applyFailOnPolicies, HUB_CALLER_THRESHOLD, MAX_FLOWS } from './report';

interface FlowDetailShape {
  found?: boolean;
  flow?: {
    id: string;
    name: string;
    entryKind: string;
    steps: Array<{ nodeId: string }>;
    stepCount?: number;
    truncated: boolean;
  };
}

export function enrichImpact(
  cg: DetectChangesGraph,
  report: ImpactReport,
  failOn: string | null = null,
  baseGraph: DetectChangesGraph | null = null,
): void {
  if (report.changedSymbols.length === 0) {
    report.callers = [];
    report.limits.truncatedCallers = false;
    report.affectedFlows = { state: 'empty', items: [], sourceVersion: 0, truncated: false };
    report.limits.truncatedFlows = false;
    return;
  }

  const { callers, directCallerCounts } = collectCallers(cg, report, baseGraph);
  report.callers = callers;
  report.limits.truncatedCallers = callers.length > report.limits.maxCallers;
  if (report.limits.truncatedCallers) {
    report.risks.push({
      code: 'truncated-callers',
      severity: 'info',
      targetId: 'report',
      message: `Caller rows were truncated to maxCallers=${report.limits.maxCallers}.`,
    });
  }

  for (const symbol of report.changedSymbols) {
    const directCount = directCallerCounts.get(symbol.id) ?? 0;
    if (directCount > report.limits.maxCallers) {
      report.risks.push({
        code: 'high-callers',
        severity: 'warning',
        targetId: symbol.id,
        message: `Changed symbol has ${directCount} direct upstream callers, above display cap ${report.limits.maxCallers}.`,
      });
    }
    if (directCount > HUB_CALLER_THRESHOLD) {
      report.risks.push({
        code: 'hub',
        severity: 'warning',
        targetId: symbol.id,
        message: `Changed symbol has ${directCount} direct upstream callers, above hub threshold ${HUB_CALLER_THRESHOLD}.`,
        policy: 'hub',
      });
    }
  }

  applyFailOnPolicies(report, failOn);
  report.callers = callers.slice(0, report.limits.maxCallers);
  enrichAffectedFlows(cg, report, baseGraph);
}

function collectCallers(
  cg: DetectChangesGraph,
  report: ImpactReport,
  baseGraph: DetectChangesGraph | null,
): { callers: CallerImpact[]; directCallerCounts: Map<string, number> } {
  const rows = new Map<string, CallerImpact>();
  const directCallerCounts = new Map<string, number>();

  for (const changed of report.changedSymbols) {
    const graph = changed.changeType === 'deleted' && baseGraph ? baseGraph : cg;
    const direct = uniqueCallers(graph.getCallers(changed.nodeId, 1));
    directCallerCounts.set(changed.id, direct.length);

    let frontier = [{ nodeId: changed.nodeId }];
    const seen = new Set<string>([changed.nodeId]);
    for (let depth = 1; depth <= report.limits.callerDepth; depth++) {
      const next: Array<{ nodeId: string }> = [];
      for (const item of frontier) {
        for (const caller of uniqueCallers(graph.getCallers(item.nodeId, 1))) {
          if (seen.has(caller.node.id)) continue;
          seen.add(caller.node.id);
          next.push({ nodeId: caller.node.id });
          const row = toCallerImpact(changed.id, caller.node, caller.edge.kind, depth);
          rows.set(`${changed.id}:${caller.node.id}:${depth}:${caller.edge.kind}`, row);
        }
      }
      frontier = next;
    }
  }

  return {
    callers: [...rows.values()].sort(sortCallers),
    directCallerCounts,
  };
}

function uniqueCallers(callers: ReturnType<DetectChangesGraph['getCallers']>): ReturnType<DetectChangesGraph['getCallers']> {
  const seen = new Set<string>();
  const result: ReturnType<DetectChangesGraph['getCallers']> = [];
  for (const caller of callers) {
    if (seen.has(caller.node.id)) continue;
    seen.add(caller.node.id);
    result.push(caller);
  }
  return result;
}

function toCallerImpact(
  changedSymbolId: string,
  node: Node,
  edgeKind: CallerImpact['edgeKind'],
  depth: number,
): CallerImpact {
  return {
    changedSymbolId,
    callerNodeId: node.id,
    name: node.name,
    qualifiedName: node.qualifiedName || node.name,
    kind: node.kind,
    filePath: node.filePath,
    startLine: node.startLine,
    depth,
    edgeKind,
  };
}

function sortCallers(a: CallerImpact, b: CallerImpact): number {
  return a.changedSymbolId.localeCompare(b.changedSymbolId)
    || a.depth - b.depth
    || a.filePath.localeCompare(b.filePath)
    || (a.startLine ?? 0) - (b.startLine ?? 0)
    || a.qualifiedName.localeCompare(b.qualifiedName);
}

function enrichAffectedFlows(
  cg: DetectChangesGraph,
  report: ImpactReport,
  baseGraph: DetectChangesGraph | null,
): void {
  const deletedSymbolIds = new Set(report.changedSymbols
    .filter((symbol) => symbol.changeType === 'deleted')
    .map((symbol) => symbol.id));
  const headMatchedNodeIds = new Set<string>();
  const baseMatchedNodeIds = new Set<string>();
  for (const symbol of report.changedSymbols) {
    (symbol.changeType === 'deleted' ? baseMatchedNodeIds : headMatchedNodeIds).add(symbol.nodeId);
  }
  for (const caller of report.callers) {
    (deletedSymbolIds.has(caller.changedSymbolId) ? baseMatchedNodeIds : headMatchedNodeIds).add(caller.callerNodeId);
  }

  const groups = [
    { graph: cg, matchedNodeIds: headMatchedNodeIds },
    ...(baseGraph && baseMatchedNodeIds.size > 0 ? [{ graph: baseGraph, matchedNodeIds: baseMatchedNodeIds }] : []),
  ].filter((group) => group.matchedNodeIds.size > 0);

  if (groups.length === 0) {
    report.affectedFlows = { state: 'empty', items: [], sourceVersion: 0, truncated: false };
    report.limits.truncatedFlows = false;
    return;
  }

  try {
    const itemsByFlow = new Map<string, AffectedFlowItem>();
    let sourceVersion = 0;
    let state: ImpactReport['affectedFlows']['state'] = 'empty';
    let hasCatalog = false;
    let truncated = false;

    for (const group of groups) {
      const result = collectAffectedFlowMatches(group.graph, group.matchedNodeIds, report);
      if (!result) continue;
      if (!hasCatalog) {
        sourceVersion = result.sourceVersion;
        state = result.state;
        hasCatalog = true;
      }
      truncated = truncated || result.truncated;
      for (const item of result.items) {
        const existing = itemsByFlow.get(item.flowId);
        if (!existing) {
          itemsByFlow.set(item.flowId, item);
          continue;
        }
        existing.matchedNodeIds = [...new Set([...existing.matchedNodeIds, ...item.matchedNodeIds])].sort();
        existing.stepCount = Math.max(existing.stepCount, item.stepCount);
        existing.truncated = existing.truncated || item.truncated;
      }
    }

    if (!hasCatalog) return;

    const items = [...itemsByFlow.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.flowId.localeCompare(b.flowId));
    report.affectedFlows.sourceVersion = sourceVersion;
    report.affectedFlows.state = state;
    report.affectedFlows.items = items.slice(0, MAX_FLOWS);
    report.limits.truncatedFlows = truncated || items.length > MAX_FLOWS;
    report.affectedFlows.truncated = report.limits.truncatedFlows;
    if (report.limits.truncatedFlows) {
      report.risks.push({
        code: 'flow-unavailable',
        severity: 'info',
        targetId: 'flows',
        message: `Affected flow rows were truncated to maxFlows=${MAX_FLOWS}.`,
      });
    }
  } catch {
    report.affectedFlows = { state: 'unavailable', items: [], sourceVersion: 0, truncated: false };
    report.risks.push({
      code: 'flow-unavailable',
      severity: 'info',
      targetId: 'flows',
      message: 'Execution-flow lookup failed; continuing without flow matches.',
    });
  }
}

function collectAffectedFlowMatches(
  cg: DetectChangesGraph,
  matchedNodeIds: Set<string>,
  report: ImpactReport,
): {
  items: AffectedFlowItem[];
  sourceVersion: number;
  state: ImpactReport['affectedFlows']['state'];
  truncated: boolean;
} | null {
  if (!cg.listFlows || !cg.getFlowById) {
    report.risks.push({
      code: 'flow-unavailable',
      severity: 'info',
      targetId: 'flows',
      message: 'Execution-flow catalog is unavailable on this CodeGraph instance.',
    });
    return null;
  }

  const flowSummaries: Array<{ id: string; name: string; entryKind: string; stepCount: number; truncated: boolean }> = [];
  let totalFlows = 0;
  let scannedFlows = 0;
  let firstState: ImpactReport['affectedFlows']['state'] | null = null;
  let sourceVersion = 0;
  for (let offset = 0; ; offset += MAX_FLOWS) {
    const flowList = cg.listFlows(MAX_FLOWS, offset);
    if (firstState === null) {
      firstState = flowList.state;
      sourceVersion = flowList.sourceVersion;
      totalFlows = flowList.total;
    }
    flowSummaries.push(...flowList.items);
    scannedFlows += flowList.items.length;
    if (
      flowList.state === 'disabled' ||
      flowList.state === 'unavailable' ||
      flowList.state === 'not_indexed' ||
      flowList.items.length === 0 ||
      offset + flowList.items.length >= flowList.total
    ) {
      break;
    }
  }

  if (firstState === 'stale') {
    report.warnings.push({
      code: 'stale-flows',
      message: 'Execution-flow catalog is stale; affected flow matches are retained best-effort rows.',
    });
    report.risks.push({
      code: 'stale-index',
      severity: 'warning',
      targetId: 'flows',
      message: 'Execution-flow catalog is stale.',
    });
  }
  if (firstState === 'disabled' || firstState === 'unavailable' || firstState === 'not_indexed') {
    report.risks.push({
      code: 'flow-unavailable',
      severity: 'info',
      targetId: 'flows',
      message: `Execution-flow catalog state is ${firstState}.`,
    });
    return null;
  }

  const items: AffectedFlowItem[] = [];
  for (const summary of flowSummaries) {
    const detail = cg.getFlowById(summary.id) as FlowDetailShape;
    if (!detail?.found || !detail.flow) continue;
    const matches = detail.flow.steps
      .map((step) => step.nodeId)
      .filter((nodeId) => matchedNodeIds.has(nodeId));
    if (matches.length === 0) continue;
    items.push({
      flowId: detail.flow.id,
      name: detail.flow.name,
      entryKind: detail.flow.entryKind,
      matchedNodeIds: [...new Set(matches)].sort(),
      stepCount: detail.flow.stepCount ?? detail.flow.steps.length,
      truncated: detail.flow.truncated,
    });
  }

  return {
    items,
    sourceVersion,
    state: firstState ?? 'empty',
    truncated: scannedFlows < totalFlows,
  };
}
