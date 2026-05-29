export interface ExportSamplerData {
    metadata?: ExportMetadata;
    threads: ExportThreadNode[];
    timeWindows: number[];
    timeWindowStatistics: Record<number, ExportWindowStatistics>;
    sources: ExportSources;
}

/** Pre-computed source lookup. Passed by value through Comlink. */
export interface ExportSources {
    /** True if any source mappings exist. */
    hasSources: boolean;
    /** Pre-computed mapping from node id to source name. */
    byId: Record<number, string>;
}

export interface ExportThreadNode {
    id: number;
    name: string;
    times: number[];
    children: ExportStackNode[];
}

export interface ExportStackNode {
    id: number;
    className: string;
    methodName: string;
    /** Deobfuscated class name (MCP/Yarn/Mojang mappings), if available. */
    resolvedClassName?: string;
    /** Deobfuscated method name, if available. */
    resolvedMethodName?: string;
    methodDesc?: string;
    lineNumber?: number;
    parentLineNumber?: number;
    times: number[];
    children: ExportStackNode[];
}

export interface ExportMetadata {
    startTime?: number;
    endTime?: number;
    interval?: number;
    numberOfTicks?: number;
    comment?: string;
    platform?: {
        name?: string;
        minecraftVersion?: string;
        brand?: string;
        sparkVersion?: number;
    };
    platformStatistics?: unknown;
    systemStatistics?: unknown;
}

export interface ExportWindowStatistics {
    ticks?: number;
    cpuProcess?: number;
    cpuSystem?: number;
    tps?: number;
    msptMedian?: number;
    msptMax?: number;
    players?: number;
    entities?: number;
    tileEntities?: number;
    chunks?: number;
    startTime?: number;
    endTime?: number;
    duration?: number;
}

