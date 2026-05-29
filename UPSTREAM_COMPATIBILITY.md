# Upstream Compatibility Strategy

The export feature should be maintained as an isolated extension, not as code woven through spark-viewer internals.

## Principles

1. Keep the generator independent from spark-viewer classes.

   `SummaryGenerator` should depend on `ExportModel.ts`, a small structural model owned by this feature. It should not import `SamplerData`, `NodeMap`, React components, or viewer stores.

2. Keep one adapter per upstream data shape.

   `SparkViewerAdapter.ts` is the only layer that knows about current spark-viewer fields such as `data.threads`, `data.timeWindows`, `data.timeWindowStatistics`, and `data.sources`.

3. Keep UI integration shallow.

   The only React touchpoint should be the export control/menu. If upstream changes `Controls.tsx`, the fallback is to add the export menu near the existing `ExportButton` again, without touching the generator.

4. Prefer additive files over edits.

   Add files under `src/viewer/sampler/export/` and make the smallest possible edit to `Controls.tsx` or the export button component.

5. Treat upstream schema changes as adapter work.

   If spark updates protobuf field names, time-window representation, or source mapping behavior, update `SparkViewerAdapter.ts` and keep `SummaryGenerator.ts` stable.

## Suggested Layout In A Fork

```text
src/viewer/sampler/export/
  ExportModel.ts
  SparkViewerAdapter.ts
  SummaryTypes.ts
  SummaryGenerator.ts
  ExportAnalysisWorker.ts
  RemoteExportAnalysisWorker.ts

src/viewer/sampler/components/controls/
  AnalysisExportButton.tsx
```

## Update Workflow

When pulling official spark-viewer updates:

1. Rebase/merge upstream.
2. Resolve conflicts only in the shallow UI insertion point if needed.
3. Run a small adapter smoke test against a known `.sparkprofile`.
4. If TypeScript errors appear in export code, fix `SparkViewerAdapter.ts` first.
5. Only touch `SummaryGenerator.ts` if the neutral `ExportModel` itself needs to grow.

This keeps the feature close to a plugin-style extension even though spark-viewer does not currently expose a formal plugin API.

