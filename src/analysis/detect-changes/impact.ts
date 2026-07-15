import type { Node } from '../../types';
import type { AffectedFlowItem, CallerImpact, DetectChangesGraph, ImpactReport } from './index';
import { HUB_CALLER_THRESHOLD, MAX_FLOWS } from './report';

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

export function enrichImpact(cg: DetectChangesGraph, report: ImpactReport): void {
  const { callers, directCallerCounts } = collectCallers(cg, report);
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

  report.callers = callers.slice(0, report.limits.maxCallers);
  enrichAffectedFlows(cg, report);
}

function collectCallers(
  cg: DetectChangesGraph,
  report: ImpactReport,
): { callers: CallerImpact[]; directCallerCounts: Map<string, number> } {
  const rows = new Map<string, CallerImpact>();
  const directCallerCounts = new Map<string, number>();

  for (const changed of report.changedSymbols) {
    const direct = uniqueCallers(cg.getCallers(changed.nodeId, 1));
    directCallerCounts.set(changed.id, direct.length);

    let frontier = [{ nodeId: changed.nodeId }];
    const seen = new Set<string>([changed.nodeId]);
    for (let depth = 1; depth <= report.limits.callerDepth; depth++) {
      const next: Array<{ nodeId: string }> = [];
      for (const item of frontier) {
        for (const caller of uniqueCallers(cg.getCallers(item.nodeId, 1))) {
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

function enrichAffectedFlows(cg: DetectChangesGraph, report: ImpactReport): void {
  if (!cg.listFlows || !cg.getFlowById) {
    report.affectedFlows = { state: 'unavailable', items: [], sourceVersion: 0, truncated: false };
    report.risks.push({
      code: 'flow-unavailable',
      severity: 'info',
      targetId: 'flows',
      message: 'Execution-flow catalog is unavailable on this CodeGraph instance.',
    });
    return;
  }

  try {
    const flowList = cg.listFlows(MAX_FLOWS, 0);
    report.affectedFlows.sourceVersion = flowList.sourceVersion;
    report.affectedFlows.state = flowList.state;
    if (flowList.state === 'stale') {
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
    if (flowList.state === 'disabled' || flowList.state === 'unavailable' || flowList.state === 'not_indexed') {
      report.risks.push({
        code: 'flow-unavailable',
        severity: 'info',
        targetId: 'flows',
        message: `Execution-flow catalog state is ${flowList.state}.`,
      });
      return;
    }

    const matchedNodeIds = new Set([
      ...report.changedSymbols.map((symbol) => symbol.nodeId),
      ...report.callers.map((caller) => caller.callerNodeId),
    ]);
    const items: AffectedFlowItem[] = [];
    for (const summary of flowList.items) {
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
    items.sort((a, b) => a.name.localeCompare(b.name) || a.flowId.localeCompare(b.flowId));
    report.affectedFlows.items = items.slice(0, MAX_FLOWS);
    report.limits.truncatedFlows = items.length > MAX_FLOWS || flowList.total > flowList.limit;
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
