import type {
    ExportMetadata,
    ExportSamplerData,
    ExportSources,
    ExportStackNode,
    ExportThreadNode,
    ExportWindowStatistics,
} from './ExportModel';
import {
    DEFAULT_EXPORT_SUMMARY_OPTIONS,
    ExportSummaryOptions,
    EvidenceStack,
    SignalHint,
    SparkSummary,
    SummaryTreeNode,
} from './SummaryTypes';

interface MethodAgg {
    method: string;
    selfMs: number;
    totalMs: number;
    occurrences: number;
    windows: number[];
    selfWindows: number[];
    threads: Map<string, { selfMs: number; totalMs: number }>;
    tags: Set<SignalHint['kind'] | 'minecraft' | 'jvm'>;
    source?: string;
    bestPath: string[];
    bestPathSelfMs: number;
    bestPathTotalMs: number;
}

interface TreeNode {
    method: string;
    selfMs: number;
    totalMs: number;
    windows: number[];
    children: TreeNode[];
}

const SIGNAL_TERMS: Array<[SignalHint['kind'], string[]]> = [
    ['selector', ['selector', 'select', 'poll']],
    ['io', ['socketread', 'read0', 'write0', 'fileinputstream', 'fileoutputstream', 'inflatebytes']],
    ['lock', ['lock', 'synchronized', 'monitor', 'reentrant']],
    ['sleep', ['sleep']],
    ['park', ['park', 'unsafe.park']],
    ['wait', ['wait']],
];

export function generateSparkSummary(
    data: ExportSamplerData,
    options: Partial<ExportSummaryOptions> = {}
): SparkSummary {
    const opts = { ...DEFAULT_EXPORT_SUMMARY_OPTIONS, ...options };
    const state = new SummaryState(data, opts);
    return state.generate();
}

class SummaryState {
    private readonly methods = new Map<string, MethodAgg>();
    private readonly threadRoots: TreeNode[] = [];
    private readonly evidence: EvidenceStack[] = [];
    private stackNodes = 0;
    private maxDepth = 0;

    constructor(
        private readonly data: ExportSamplerData,
        private readonly options: ExportSummaryOptions
    ) {}

    generate(): SparkSummary {
        for (const thread of this.data.threads) {
            const children = thread.children.map(child =>
                this.visit(child, thread, [], 1)
            );
            const totalMs = sum(thread.times);
            this.threadRoots.push({
                method: thread.name,
                selfMs: Math.max(0, totalMs - children.reduce((acc, child) => acc + child.totalMs, 0)),
                totalMs,
                windows: [...thread.times],
                children,
            });
        }

        const totalProfileMs = this.threadRoots.reduce((acc, thread) => acc + thread.totalMs, 0);
        const summary: SparkSummary = {
            schema: 'spark_summary.v1',
            units: { time: 'ms', window: 'spark_window_1m' },
            profile: profileMetadata(this.data.metadata),
            health: healthMetadata(this.data.metadata),
            coverage: {
                threads: this.data.threads.length,
                stackNodes: this.stackNodes,
                maxDepth: this.maxDepth,
                windows: this.data.timeWindows.length,
                sourceMappings: this.data.sources.hasSources,
                exactThreadStates: false,
                exactLockEvents: false,
                exactGcEvents: false,
                notes: [
                    'Thread states are not stored in spark sampler profiles.',
                    'Lock, IO, and blocking signals are inferred from method names only.',
                    ...(this.data.sources.hasSources ? [] : ['No class/method/line source mappings were present.']),
                ],
            },
            topMethods: this.topMethods(totalProfileMs),
            hotThreads: this.hotThreads(totalProfileMs),
            windows: this.windows(),
            evidenceStacks: this.evidenceStacks(),
            inferredSignals: this.signals(),
        };
        return fitToBudget(summary, this.options.maxBytes);
    }

    fullJsonl(): string {
        const lines: string[] = [];
        lines.push(JSON.stringify({
            type: 'meta',
            schema: 'spark_full.v1',
            profile: profileMetadata(this.data.metadata),
        }));
        for (const thread of this.data.threads) {
            lines.push(JSON.stringify({
                type: 'thread',
                name: thread.name,
                totalMs: round(sum(thread.times)),
                times: thread.times.map(round),
            }));
        }
        for (const method of [...this.methods.values()].sort((a, b) => b.selfMs - a.selfMs)) {
            lines.push(JSON.stringify({
                type: 'methodAgg',
                method: method.method,
                source: method.source,
                selfMs: round(method.selfMs),
                totalMs: round(method.totalMs),
                occurrences: method.occurrences,
                times: method.windows.map(round),
                selfTimes: method.selfWindows.map(round),
                tags: [...method.tags],
                bestPath: method.bestPath,
            }));
        }
        return lines.join('\n') + '\n';
    }

    private visit(
        node: ExportStackNode,
        thread: ExportThreadNode,
        path: string[],
        depth: number
    ): TreeNode {
        this.stackNodes++;
        this.maxDepth = Math.max(this.maxDepth, depth);

        const method = methodLabel(node);
        const nextPath = [...path, method];
        const children = node.children.map(child => this.visit(child, thread, nextPath, depth + 1));
        const totalMs = sum(node.times);
        const childMs = children.reduce((acc, child) => acc + child.totalMs, 0);
        const selfMs = Math.max(0, totalMs - childMs);
        const key = methodKey(node);
        const agg = this.getMethodAgg(key, method, node);

        agg.selfMs += selfMs;
        agg.totalMs += totalMs;
        agg.occurrences++;
        for (let i = 0; i < node.times.length; i++) {
            agg.windows[i] += node.times[i];
            if (totalMs > 0 && selfMs > 0) {
                agg.selfWindows[i] += node.times[i] * (selfMs / totalMs);
            }
        }
        const threadAgg = agg.threads.get(thread.name) ?? { selfMs: 0, totalMs: 0 };
        threadAgg.selfMs += selfMs;
        threadAgg.totalMs += totalMs;
        agg.threads.set(thread.name, threadAgg);
        tagMethod(agg);

        if (selfMs > agg.bestPathSelfMs || totalMs > agg.bestPathTotalMs) {
            agg.bestPath = nextPath;
            agg.bestPathSelfMs = Math.max(agg.bestPathSelfMs, selfMs);
            agg.bestPathTotalMs = Math.max(agg.bestPathTotalMs, totalMs);
        }
        if (selfMs > 0) {
            this.evidence.push({ reason: 'hot_self', thread: thread.name, selfMs, totalMs, stack: nextPath });
        }

        return { method, selfMs, totalMs, windows: [...node.times], children };
    }

    private getMethodAgg(key: string, method: string, node: ExportStackNode): MethodAgg {
        let agg = this.methods.get(key);
        if (!agg) {
            agg = {
                method,
                selfMs: 0,
                totalMs: 0,
                occurrences: 0,
                windows: new Array(this.data.timeWindows.length).fill(0),
                selfWindows: new Array(this.data.timeWindows.length).fill(0),
                threads: new Map(),
                tags: new Set(),
                source: sourceForNode(this.data.sources, node),
                bestPath: [],
                bestPathSelfMs: 0,
                bestPathTotalMs: 0,
            };
            this.methods.set(key, agg);
        }
        return agg;
    }

    private topMethods(totalProfileMs: number) {
        return [...this.methods.values()]
            .sort((a, b) => b.selfMs - a.selfMs || b.totalMs - a.totalMs)
            .slice(0, this.options.topMethods)
            .map((method, index) => ({
                rank: index + 1,
                method: method.method,
                source: method.source,
                selfMs: round(method.selfMs),
                totalMs: round(method.totalMs),
                selfPct: pct(method.selfMs, totalProfileMs),
                totalPct: pct(method.totalMs, totalProfileMs),
                occurrences: method.occurrences,
                threads: [...method.threads.entries()]
                    .sort((a, b) => b[1].selfMs - a[1].selfMs)
                    .slice(0, 5)
                    .map(([name, values]) => ({ name, selfMs: round(values.selfMs), totalMs: round(values.totalMs) })),
                windows: topWindowIds(method.selfWindows, this.data.timeWindows, 3),
                tags: method.tags.size ? [...method.tags].sort() : undefined,
            }));
    }

    private hotThreads(totalProfileMs: number) {
        return [...this.threadRoots]
            .sort((a, b) => b.totalMs - a.totalMs)
            .slice(0, this.options.hotThreads)
            .map(thread => ({
                name: thread.method,
                totalMs: round(thread.totalMs),
                totalPct: pct(thread.totalMs, totalProfileMs),
                topSelf: topSelf(thread, 8),
                tree: thread.children
                    .sort((a, b) => b.totalMs - a.totalMs)
                    .map(child => pruneTree(child, Math.max(1, thread.totalMs), this.options))
                    .filter((child): child is SummaryTreeNode => !!child)
                    .slice(0, this.options.treeChildren),
            }));
    }

    private windows() {
        const activeMs = new Array(this.data.timeWindows.length).fill(0);
        for (const root of this.threadRoots) {
            root.windows.forEach((value, index) => (activeMs[index] += value));
        }
        const topByWindow = topMethodsByWindow([...this.methods.values()], this.options.windowTopMethods);
        const worstIndexes = [...this.data.timeWindows.keys()]
            .sort((a, b) => windowStat(this.data.timeWindowStatistics, this.data.timeWindows[b], 'msptMax') - windowStat(this.data.timeWindowStatistics, this.data.timeWindows[a], 'msptMax') || activeMs[b] - activeMs[a])
            .slice(0, this.options.worstWindows);

        return {
            count: this.data.timeWindows.length,
            worst: worstIndexes.map(index => {
                const window = this.data.timeWindows[index];
                const stats = this.data.timeWindowStatistics[window];
                return {
                    window,
                    activeMs: round(activeMs[index]),
                    tps: stats ? round(stats.tps) : undefined,
                    msptMedian: stats ? round(stats.msptMedian) : undefined,
                    msptMax: stats ? round(stats.msptMax) : undefined,
                    cpuProcess: stats ? round(stats.cpuProcess) : undefined,
                    ticks: stats?.ticks || undefined,
                    topMethods: topByWindow.get(index) ?? [],
                };
            }),
            trend: {
                activeMs: downsample(activeMs, this.options.trendPoints),
                tps: downsample(this.data.timeWindows.map(w => this.data.timeWindowStatistics[w]?.tps ?? 0), this.options.trendPoints),
                msptMax: downsample(this.data.timeWindows.map(w => this.data.timeWindowStatistics[w]?.msptMax ?? 0), this.options.trendPoints),
            },
        };
    }

    private evidenceStacks(): EvidenceStack[] {
        const seen = new Set<string>();
        const out: EvidenceStack[] = [];
        for (const item of [...this.evidence].sort((a, b) => b.selfMs - a.selfMs || b.totalMs - a.totalMs)) {
            const key = `${item.thread}:${item.stack[item.stack.length - 1]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({
                ...item,
                selfMs: round(item.selfMs),
                totalMs: round(item.totalMs),
                stack: trimStack(item.stack, this.options.stackFrames),
            });
            if (out.length >= this.options.evidenceStacks) break;
        }
        return out;
    }

    private signals() {
        const blockingOrIoHints: SignalHint[] = [];
        for (const method of [...this.methods.values()].sort((a, b) => b.selfMs - a.selfMs)) {
            const tag = [...method.tags].find(t => ['lock', 'io', 'sleep', 'park', 'wait', 'selector'].includes(t)) as SignalHint['kind'] | undefined;
            if (!tag) continue;
            blockingOrIoHints.push({
                kind: tag,
                method: method.method,
                selfMs: round(method.selfMs),
                confidence: method.selfMs >= 1000 ? 'medium' : 'low',
            });
            if (blockingOrIoHints.length >= 8) break;
        }
        const topText = [...this.methods.values()]
            .sort((a, b) => b.selfMs - a.selfMs)
            .slice(0, 10)
            .map(m => m.method.toLowerCase())
            .join(' ');
        const likelyIssues = [
            topText.includes('pathfinder') ? 'Pathfinding appears in top hotspots.' : undefined,
            topText.includes('world.func_147439_a') ? 'World block lookup dominates self time.' : undefined,
            topText.includes('blockfire') ? 'Fire/block update logic appears in top hotspots.' : undefined,
        ].filter((item): item is string => !!item);
        return { blockingOrIoHints, likelyIssues };
    }
}

export function generateSparkFullJsonl(data: ExportSamplerData): string {
    const state = new SummaryState(data, DEFAULT_EXPORT_SUMMARY_OPTIONS);
    state.generate();
    return state.fullJsonl();
}

function profileMetadata(metadata?: ExportMetadata): Record<string, unknown> {
    if (!metadata) return {};
    return compact({
        platform: metadata.platform?.name,
        minecraft: metadata.platform?.minecraftVersion,
        brand: metadata.platform?.brand,
        sparkVersion: metadata.platform?.sparkVersion,
        intervalUs: metadata.interval,
        durationMs: metadata.endTime && metadata.startTime ? metadata.endTime - metadata.startTime : undefined,
        ticks: metadata.numberOfTicks,
        comment: metadata.comment,
    });
}

function healthMetadata(metadata?: ExportMetadata): Record<string, unknown> {
    if (!metadata) return {};
    const platform = metadata.platformStatistics as any;
    const system = metadata.systemStatistics as any;
    return compact({
        tps: platform?.tps ? compact({
            last1m: round(platform.tps.last1m),
            last5m: round(platform.tps.last5m),
            last15m: round(platform.tps.last15m),
            target: platform.tps.gameTargetTps,
        }) : undefined,
        mspt: platform?.mspt?.last1m ? compact({
            mean: round(platform.mspt.last1m.mean),
            median: round(platform.mspt.last1m.median),
            p95: round(platform.mspt.last1m.percentile95),
            max: round(platform.mspt.last1m.max),
            idealMax: platform.mspt.gameMaxIdealMspt,
        }) : undefined,
        cpu: system?.cpu ? compact({
            process1m: round(system.cpu.processUsage?.last1m),
            system1m: round(system.cpu.systemUsage?.last1m),
            threads: system.cpu.threads,
            model: system.cpu.modelName,
        }) : undefined,
        gc: (system as any)?.gc
            ? Object.entries((system as any).gc).map(([name, gc]: [string, any]) => ({
                  name,
                  count: gc.total,
                  avgMs: round(gc.avgTime),
                  avgFreq: round(gc.avgFrequency),
              }))
            : undefined,
    });
}

function methodKey(node: ExportStackNode): string {
    // Use raw names for dedup, as multiple obfuscated methods may map to same deobfuscated name.
    return `${node.className};${node.methodName};${node.methodDesc}`;
}

function methodLabel(node: ExportStackNode): string {
    // Use deobfuscated names when available (MCP/Yarn/Mojang mappings).
    const cls = node.resolvedClassName ?? node.className;
    const method = node.resolvedMethodName ?? node.methodName;
    const desc = node.methodDesc ?? '';
    return `${cls}.${method}${desc}`;
}

function sourceForNode(sources: ExportSources, node: ExportStackNode): string | undefined {
    const source = sources.byId[node.id];
    return source && !['minecraft', 'java'].includes(source) ? source : undefined;
}

function tagMethod(method: MethodAgg) {
    const lower = method.method.toLowerCase();
    for (const [tag, terms] of SIGNAL_TERMS) {
        if (terms.some(term => lower.includes(term))) method.tags.add(tag);
    }
    if (lower.includes('net.minecraft')) method.tags.add('minecraft');
    if (lower.startsWith('java.') || lower.startsWith('sun.') || lower.startsWith('jdk.')) method.tags.add('jvm');
}

function pruneTree(
    node: TreeNode,
    rootTotal: number,
    options: ExportSummaryOptions,
    depth = 1
): SummaryTreeNode | undefined {
    const totalPct = node.totalMs / rootTotal;
    const selfPct = node.selfMs / rootTotal;
    const children =
        depth >= options.treeDepth
            ? []
            : node.children
                  .sort((a, b) => b.totalMs - a.totalMs)
                  .map(child => pruneTree(child, rootTotal, options, depth + 1))
                  .filter((child): child is SummaryTreeNode => !!child)
                  .slice(0, options.treeChildren);
    if (depth > 1 && totalPct < 0.01 && selfPct < 0.005 && children.length === 0) {
        return undefined;
    }
    return compact({
        method: node.method,
        selfMs: round(node.selfMs),
        totalMs: round(node.totalMs),
        pct: pct(node.totalMs, rootTotal),
        children,
    }) as SummaryTreeNode;
}

function topSelf(root: TreeNode, limit: number) {
    const nodes: TreeNode[] = [];
    const visit = (node: TreeNode) => {
        nodes.push(node);
        node.children.forEach(visit);
    };
    visit(root);
    return nodes
        .sort((a, b) => b.selfMs - a.selfMs)
        .filter(node => node.selfMs > 0)
        .slice(0, limit)
        .map(node => ({ method: node.method, selfMs: round(node.selfMs), totalMs: round(node.totalMs) }));
}

function topMethodsByWindow(methods: MethodAgg[], limit: number) {
    const out = new Map<number, Array<{ method: string; selfMs: number; totalMs: number }>>();
    for (let i = 0; i < (methods[0]?.windows.length ?? 0); i++) {
        out.set(
            i,
            methods
                .filter(method => method.selfWindows[i] > 0)
                .sort((a, b) => b.selfWindows[i] - a.selfWindows[i])
                .slice(0, limit)
                .map(method => ({
                    method: method.method,
                    selfMs: round(method.selfWindows[i]),
                    totalMs: round(method.windows[i]),
                }))
        );
    }
    return out;
}

function topWindowIds(values: number[], windows: number[], limit: number): number[] {
    return values
        .map((value, index) => ({ value, window: windows[index] }))
        .sort((a, b) => b.value - a.value)
        .filter(item => item.value > 0)
        .slice(0, limit)
        .map(item => item.window);
}

function windowStat(
    stats: Record<number, ExportWindowStatistics>,
    window: number,
    key: keyof ExportWindowStatistics
): number {
    const value = stats[window]?.[key];
    return typeof value === 'number' ? value : 0;
}

function fitToBudget(summary: SparkSummary, maxBytes: number): SparkSummary {
    const size = () => new Blob([JSON.stringify(summary)]).size;
    if (size() <= maxBytes) return summary;
    summary.evidenceStacks = summary.evidenceStacks.slice(0, 3);
    summary.topMethods = summary.topMethods.slice(0, 15);
    summary.hotThreads = summary.hotThreads.slice(0, 1);
    if (size() <= maxBytes) return summary;
    summary.hotThreads.forEach(thread => {
        thread.tree = thread.tree.slice(0, 2);
        thread.topSelf = thread.topSelf.slice(0, 5);
    });
    return summary;
}

function sum(values: readonly number[]): number {
    return values.reduce((acc, value) => acc + value, 0);
}

function pct(value: number, total: number): number {
    return total > 0 ? round((value / total) * 100) : 0;
}

function round(value?: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return Math.round(value * 1000) / 1000;
}

function downsample(values: number[], maxPoints: number): number[] {
    if (values.length <= maxPoints) return values.map(round);
    const bucketSize = values.length / maxPoints;
    return new Array(maxPoints).fill(0).map((_, index) => {
        const start = Math.floor(index * bucketSize);
        const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
        const bucket = values.slice(start, end);
        return round(sum(bucket) / bucket.length);
    });
}

function trimStack(stack: string[], maxFrames: number): string[] {
    if (stack.length <= maxFrames) return stack;
    const head = Math.floor(maxFrames / 2);
    return [...stack.slice(0, head), '...', ...stack.slice(-(maxFrames - head))];
}

function compact<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(
        Object.entries(value).filter(([, entry]) => {
            if (entry === undefined || entry === null || entry === '') return false;
            if (Array.isArray(entry) && entry.length === 0) return false;
            return true;
        })
    ) as T;
}
