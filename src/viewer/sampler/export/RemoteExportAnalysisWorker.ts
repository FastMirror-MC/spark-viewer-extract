import { releaseProxy, Remote, wrap } from 'comlink';
import type { ExportSamplerData } from './ExportModel';
import type { ExportAnalysisWorker } from './ExportAnalysisWorker';
import type { ExportSummaryOptions, SparkSummary } from './SummaryTypes';

export default class RemoteExportAnalysisWorker {
    static async create(data: ExportSamplerData): Promise<RemoteExportAnalysisWorker> {
        const worker = new Worker(
            new URL('./ExportAnalysisWorker.ts', import.meta.url)
        );
        const WorkerClass = wrap<ExportAnalysisWorker>(worker) as any;
        const proxy = (await new WorkerClass(data)) as Remote<ExportAnalysisWorker>;
        return new RemoteExportAnalysisWorker(proxy);
    }

    constructor(private readonly proxy: Remote<ExportAnalysisWorker>) {}

    generateSummary(options?: Partial<ExportSummaryOptions>): Promise<SparkSummary> {
        return this.proxy.generateSummary(options);
    }

    generateFullJsonl(): Promise<string> {
        return this.proxy.generateFullJsonl();
    }

    close() {
        this.proxy[releaseProxy]();
    }
}
