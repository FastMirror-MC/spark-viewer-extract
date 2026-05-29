import { expose } from 'comlink';
import type { ExportSamplerData } from './ExportModel';
import {
    DEFAULT_EXPORT_SUMMARY_OPTIONS,
    ExportSummaryOptions,
    SparkSummary,
} from './SummaryTypes';
import { generateSparkFullJsonl, generateSparkSummary } from './SummaryGenerator';

export class ExportAnalysisWorker {
    constructor(private readonly data: ExportSamplerData) {}

    generateSummary(options: Partial<ExportSummaryOptions> = {}): SparkSummary {
        return generateSparkSummary(this.data, {
            ...DEFAULT_EXPORT_SUMMARY_OPTIONS,
            ...options,
        });
    }

    generateFullJsonl(): string {
        return generateSparkFullJsonl(this.data);
    }
}

expose(ExportAnalysisWorker);
