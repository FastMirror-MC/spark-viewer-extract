import type { StackTraceNodeWithId, ThreadNodeWithId } from '../../proto/nodes';
import type { WindowStatistics } from '../../proto/spark_pb';
import type SamplerData from '../SamplerData';
import { MappingsResolver } from '../mappings/resolver';
import type {
    ExportSamplerData,
    ExportStackNode,
    ExportThreadNode,
    ExportWindowStatistics,
} from './ExportModel';

export function adaptSparkViewerSamplerData(
    data: SamplerData,
    mappingsResolver?: MappingsResolver,
): ExportSamplerData {
    // Pre-compute source map into a plain Record so Comlink can transfer it by value.
    const sourceById: Record<number, string> = {};
    if (data.sources.hasSources()) {
        for (const node of data.nodes.allNodes) {
            const src = data.sources.getSource(node.id);
            if (src) {
                sourceById[node.id] = src;
            }
        }
    }

    const resolveNames = mappingsResolver
        ? (className: string, methodName: string, methodDesc?: string) => {
              const result = mappingsResolver.resolve({
                  type: 'stackTrace',
                  className,
                  methodName,
                  methodDesc: methodDesc ?? '',
                  lineNumber: 0,
                  parentLineNumber: 0,
              });
              if (result.type === 'native') return {};
              // Only use resolved names when the mapping actually remapped something.
              const out: { className?: string; methodName?: string } = {};
              if (result.remappedClass) out.className = result.className;
              if (result.remappedMethod) out.methodName = result.methodName;
              return out;
          }
        : undefined;

    // Deep-clone protobuf objects to plain JSON so Comlink can transfer them without errors.
    const deepClone = <T>(obj: T): T =>
        obj !== undefined && obj !== null ? JSON.parse(JSON.stringify(obj)) : obj;

    const result: ExportSamplerData = {
        metadata: {
            startTime: data.metadata?.startTime,
            endTime: data.metadata?.endTime,
            interval: data.metadata?.interval,
            numberOfTicks: data.metadata?.numberOfTicks,
            comment: data.metadata?.comment,
            platform: {
                name: data.metadata?.platform?.name,
                minecraftVersion: data.metadata?.platform?.minecraftVersion,
                brand: data.metadata?.platform?.brand,
                sparkVersion: data.metadata?.platform?.sparkVersion,
            },
            platformStatistics: deepClone(data.metadata?.platformStatistics),
            systemStatistics: deepClone(data.metadata?.systemStatistics),
        },
        threads: data.threads.map(t => adaptThread(t, resolveNames)),
        timeWindows: data.timeWindows,
        timeWindowStatistics: Object.fromEntries(
            Object.entries(data.timeWindowStatistics).map(([key, value]) => [
                Number(key),
                adaptWindowStatistics(value),
            ])
        ),
        sources: {
            hasSources: data.sources.hasSources(),
            byId: sourceById,
        },
    };
    // Deep clone the entire result to strip any protobuf methods non-transferable via Comlink.
    return deepClone(result);
}

function adaptThread(
    node: ThreadNodeWithId,
    resolve?: (c: string, m: string) => { className?: string; methodName?: string },
): ExportThreadNode {
    return {
        id: node.id,
        name: node.name,
        times: node.times,
        children: node.children.map(child => adaptStackNode(child, resolve)),
    };
}

function adaptStackNode(
    node: StackTraceNodeWithId,
    resolve?: (c: string, m: string, d?: string) => { className?: string; methodName?: string },
): ExportStackNode {
    const resolved = resolve?.(node.className, node.methodName, node.methodDesc);
    return {
        id: node.id,
        className: node.className,
        methodName: node.methodName,
        resolvedClassName: resolved?.className,
        resolvedMethodName: resolved?.methodName,
        methodDesc: node.methodDesc,
        lineNumber: node.lineNumber,
        parentLineNumber: node.parentLineNumber,
        times: node.times,
        children: node.children.map(child => adaptStackNode(child, resolve)),
    };
}

function adaptWindowStatistics(stats: WindowStatistics): ExportWindowStatistics {
    return {
        ticks: stats.ticks,
        cpuProcess: stats.cpuProcess,
        cpuSystem: stats.cpuSystem,
        tps: stats.tps,
        msptMedian: stats.msptMedian,
        msptMax: stats.msptMax,
        players: stats.players,
        entities: stats.entities,
        tileEntities: stats.tileEntities,
        chunks: stats.chunks,
        startTime: stats.startTime,
        endTime: stats.endTime,
        duration: stats.duration,
    };
}

