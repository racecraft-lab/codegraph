export const prImpactHelperVersion = '0.1.0-spec-020';

export const prImpactGitHubEvent = {
  repository: {
    full_name: 'racecraft-lab/codegraph',
  },
  pull_request: {
    number: 20,
    base: {
      ref: 'main',
      sha: '0000000000000000000000000000000000000001',
      repo: {
        full_name: 'racecraft-lab/codegraph',
      },
    },
    head: {
      ref: '020-pr-blast-radius-review-action',
      sha: '0000000000000000000000000000000000000002',
      repo: {
        full_name: 'racecraft-lab/codegraph',
      },
    },
  },
} as const;

export const prImpactForkEvent = {
  ...prImpactGitHubEvent,
  pull_request: {
    ...prImpactGitHubEvent.pull_request,
    head: {
      ...prImpactGitHubEvent.pull_request.head,
      repo: {
        full_name: 'external-fork/codegraph',
      },
    },
  },
} as const;

export const prImpactDetectorResults = {
  clean: {
    schemaVersion: 1,
    summary: {
      status: 'clean',
      baseRef: 'main',
      changedSymbolCount: 0,
      unmappedHunkCount: 0,
      callerCount: 0,
      affectedFlowCount: 0,
      riskCount: 0,
      warningCount: 0,
    },
    exitCode: 0,
    changedSymbols: [],
    unmappedHunks: [],
    callers: [],
    affectedFlows: {
      state: 'empty',
      items: [],
      truncated: false,
    },
    risks: [],
    warnings: [],
    limits: {
      callerDepth: 1,
      maxCallers: 20,
      hubCallerThreshold: 10,
      maxFlows: 20,
      truncatedCallers: false,
      truncatedFlows: false,
    },
  },
  impact: {
    schemaVersion: 1,
    summary: {
      status: 'impact',
      baseRef: 'main',
      changedSymbolCount: 1,
      unmappedHunkCount: 0,
      callerCount: 1,
      affectedFlowCount: 1,
      riskCount: 0,
      warningCount: 0,
    },
    exitCode: 1,
    changedSymbols: [
      {
        id: 'symbol:runAction',
        qualifiedName: 'runAction',
        kind: 'function',
        filePath: 'actions/pr-impact/run.ts',
        changeType: 'modified',
      },
    ],
    unmappedHunks: [],
    callers: [
      {
        changedSymbolId: 'symbol:runAction',
        qualifiedName: 'main',
        kind: 'function',
        filePath: 'actions/pr-impact/run.ts',
        depth: 1,
      },
    ],
    affectedFlows: {
      state: 'available',
      items: [
        {
          flowId: 'flow:pr-impact',
          name: 'PR impact action',
          entryKind: 'action',
          stepCount: 3,
          truncated: false,
        },
      ],
      truncated: false,
    },
    risks: [],
    warnings: [],
    limits: {
      callerDepth: 1,
      maxCallers: 20,
      hubCallerThreshold: 10,
      maxFlows: 20,
      truncatedCallers: false,
      truncatedFlows: false,
    },
  },
  thresholdBreach: {
    schemaVersion: 1,
    summary: {
      status: 'threshold_breach',
      baseRef: 'main',
      changedSymbolCount: 1,
      unmappedHunkCount: 0,
      callerCount: 1,
      affectedFlowCount: 1,
      riskCount: 1,
      warningCount: 0,
    },
    exitCode: 2,
    changedSymbols: [
      {
        id: 'symbol:wide-change',
        qualifiedName: 'wideChange',
        kind: 'function',
        filePath: 'src/wide-change.ts',
        changeType: 'modified',
      },
    ],
    unmappedHunks: [],
    callers: [
      {
        changedSymbolId: 'symbol:wide-change',
        qualifiedName: 'impactedCaller',
        kind: 'function',
        filePath: 'src/impacted-caller.ts',
        depth: 1,
      },
    ],
    affectedFlows: {
      state: 'available',
      items: [
        {
          flowId: 'flow:threshold',
          name: 'Threshold breach flow',
          entryKind: 'function',
          stepCount: 2,
          truncated: false,
        },
      ],
      truncated: false,
    },
    risks: [
      {
        code: 'threshold-breach',
        severity: 'error',
        targetId: 'symbol:wide-change',
        policy: 'callers>20',
      },
    ],
    warnings: [],
    limits: {
      callerDepth: 1,
      maxCallers: 20,
      hubCallerThreshold: 10,
      maxFlows: 20,
      truncatedCallers: true,
      truncatedFlows: false,
    },
  },
  unavailable: {
    schemaVersion: 1,
    summary: {
      status: 'unavailable',
      baseRef: 'main',
      changedSymbolCount: 0,
      unmappedHunkCount: 0,
      callerCount: 0,
      affectedFlowCount: 0,
      riskCount: 1,
      warningCount: 1,
    },
    exitCode: 3,
    changedSymbols: [],
    unmappedHunks: [],
    callers: [],
    affectedFlows: {
      state: 'unavailable',
      items: [],
      truncated: false,
    },
    risks: [
      {
        code: 'flow-unavailable',
        severity: 'error',
        targetId: 'report',
      },
    ],
    warnings: [
      {
        code: 'unavailable',
        message: 'Index unavailable',
      },
    ],
    limits: {
      callerDepth: 1,
      maxCallers: 20,
      hubCallerThreshold: 10,
      maxFlows: 20,
      truncatedCallers: false,
      truncatedFlows: false,
    },
  },
} as const;

export const prImpactDeliveryResults = {
  comment: {
    status: 'comment',
    comment: 'updated',
    summary: 'written',
    artifact: 'pending',
    currentCommentId: '100',
    duplicateCommentIds: [],
    failedDuplicateCommentIds: [],
    reportPath: 'pr-impact-report.md',
  },
  fallback: {
    status: 'fallback',
    comment: 'permission-denied',
    summary: 'written',
    artifact: 'pending',
    currentCommentId: null,
    duplicateCommentIds: [],
    failedDuplicateCommentIds: [],
    reportPath: 'pr-impact-report.md',
  },
  failed: {
    status: 'failed',
    comment: 'failed',
    summary: 'failed',
    artifact: 'failed',
    currentCommentId: null,
    duplicateCommentIds: [],
    failedDuplicateCommentIds: [],
    reportPath: 'pr-impact-report.md',
  },
} as const;
