export interface ExportSummaryOptions {
    maxBytes: number;
    topMethods: number;
    hotThreads: number;
    treeDepth: number;
    treeChildren: number;
    evidenceStacks: number;
    stackFrames: number;
    trendPoints: number;
    worstWindows: number;
    windowTopMethods: number;
}

export const DEFAULT_EXPORT_SUMMARY_OPTIONS: ExportSummaryOptions = {
    maxBytes: 50_000,
    topMethods: 30,
    hotThreads: 3,
    treeDepth: 8,
    treeChildren: 4,
    evidenceStacks: 5,
    stackFrames: 24,
    trendPoints: 60,
    worstWindows: 5,
    windowTopMethods: 5,
};

export interface SparkSummary {
    schema: 'spark_summary.v1';
    units: {
        time: 'ms';
        window: 'spark_window_1m';
    };
    profile: Record<string, unknown>;
    health: Record<string, unknown>;
    coverage: {
        threads: number;
        stackNodes: number;
        maxDepth: number;
        windows: number;
        sourceMappings: boolean;
        exactThreadStates: false;
        exactLockEvents: false;
        exactGcEvents: false;
        notes: string[];
    };
    topMethods: SummaryMethod[];
    hotThreads: SummaryThread[];
    windows: {
        count: number;
        worst: SummaryWindow[];
        trend: Record<string, number[]>;
    };
    evidenceStacks: EvidenceStack[];
    inferredSignals: {
        blockingOrIoHints: SignalHint[];
        likelyIssues: string[];
    };
}

export interface SummaryMethod {
    rank: number;
    method: string;
    source?: string;
    selfMs: number;
    totalMs: number;
    selfPct: number;
    totalPct: number;
    occurrences: number;
    threads: Array<{ name: string; selfMs: number; totalMs: number }>;
    windows: number[];
    tags?: string[];
}

export interface SummaryThread {
    name: string;
    totalMs: number;
    totalPct: number;
    topSelf: Array<{ method: string; selfMs: number; totalMs: number }>;
    tree: SummaryTreeNode[];
}

export interface SummaryTreeNode {
    method: string;
    selfMs: number;
    totalMs: number;
    pct: number;
    children?: SummaryTreeNode[];
}

export interface SummaryWindow {
    window: number;
    activeMs: number;
    tps?: number;
    msptMedian?: number;
    msptMax?: number;
    cpuProcess?: number;
    ticks?: number;
    topMethods: Array<{ method: string; selfMs: number; totalMs: number }>;
}

export interface EvidenceStack {
    reason: string;
    thread: string;
    totalMs: number;
    selfMs: number;
    stack: string[];
}

export interface SignalHint {
    kind: 'lock' | 'io' | 'sleep' | 'park' | 'wait' | 'selector';
    method: string;
    selfMs: number;
    confidence: 'low' | 'medium';
}

