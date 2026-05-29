import { faDownload } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import styles from '../../../../style/controls.module.scss';
import type SamplerData from '../../SamplerData';
import { MappingsResolver } from '../../mappings/resolver';
import { adaptSparkViewerSamplerData } from '../../export/SparkViewerAdapter';
import RemoteExportAnalysisWorker from '../../export/RemoteExportAnalysisWorker';

export interface AnalysisExportButtonProps {
    data: SamplerData;
    code?: string;
    exportOriginal?: () => void;
    mappingsResolver?: MappingsResolver;
}

export default function AnalysisExportButton({
    data,
    code = 'spark-profile',
    exportOriginal,
    mappingsResolver,
}: AnalysisExportButtonProps) {
    const [busy, setBusy] = useState(false);

    async function exportSummary() {
        await runExport(async worker => {
            const summary = await worker.generateSummary();
            download(
                `${code}.spark-summary.json`,
                'application/json',
                JSON.stringify(summary)
            );
        });
    }

    async function exportFull() {
        await runExport(async worker => {
            const jsonl = await worker.generateFullJsonl();
            download(`${code}.spark-full.jsonl`, 'application/x-ndjson', jsonl);
        });
    }

    async function runExport(
        task: (worker: RemoteExportAnalysisWorker) => Promise<void>
    ) {
        setBusy(true);
        const worker = await RemoteExportAnalysisWorker.create(
            adaptSparkViewerSamplerData(data, mappingsResolver)
        );
        try {
            await task(worker);
        } finally {
            worker.close();
            setBusy(false);
        }
    }

    return (
        <div className={styles.exportGroup}>
            <button
                type="button"
                className={styles.exportButton}
                disabled={busy}
                onClick={exportSummary}
                title="Export summary JSON (LLM-friendly diagnostic report)"
            >
                <FontAwesomeIcon icon={faDownload} />
                <span>Summary</span>
            </button>
            <button
                type="button"
                className={styles.exportButton}
                disabled={busy}
                onClick={exportFull}
                title="Export full JSONL (complete aggregate data)"
            >
                <FontAwesomeIcon icon={faDownload} />
                <span>Full</span>
            </button>
            {exportOriginal && (
                <button
                    type="button"
                    className={styles.exportButton}
                    disabled={busy}
                    onClick={exportOriginal}
                    title="Export original sparkprofile"
                >
                    <FontAwesomeIcon icon={faDownload} />
                    <span>Original</span>
                </button>
            )}
        </div>
    );
}

function download(filename: string, contentType: string, content: string) {
    const url = URL.createObjectURL(new Blob([content], { type: contentType }));
    const el = document.createElement('a');
    el.setAttribute('href', url);
    el.setAttribute('download', filename);
    el.click();
    URL.revokeObjectURL(url);
}
