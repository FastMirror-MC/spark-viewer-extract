![](https://spark.lucko.me/assets/banner.png)

# spark-viewer

[spark](https://github.com/lucko/spark) is a performance profiling plugin/mod for Minecraft clients, servers, and proxies.

This repository contains the website & viewer for spark, written using [Next.js](https://nextjs.org/)/[React](https://reactjs.org)/[Typescript](https://www.typescriptlang.org/).

The website contains:

-   a brief **homepage**
-   **downloads** page which serves direct links to the latest release
-   **documentation**, although this is managed in a [separate repository](https://github.com/lucko/spark-docs)
-   a **viewer** web-app for spark data, which has modes for:
    -   viewing the output from the spark **profiler**
    -   viewing the output from spark **heap dump** summaries

### Viewer

The viewer component of the website reads data from [bytebin](https://github.com/lucko/bytebin) (content storage service) and [bytesocks](https://github.com/lucko/bytesocks) (WebSocket server). It then renders this data as an interactive viewer in which the user can interpret and analyse their results.

The profile viewer renders the data as an expandable call stack tree, with support for applying deobfuscation mappings, searching, bookmarks and viewing as a flame graph.

The heap dump summary viewer renders a histogram of the classes occupying the most memory at the time when the data was collected.

### Selfhosting

#### Configuring URLs

To configure the URLs used by the application, you have to pass them as environment variables when building the application.
In the special case of using Docker, you have to pass them as build arguments.

For more information, see [`env.ts`](src/env.ts) and the [`Dockerfile`](Dockerfile).

### Contributions

Yes please! - but please open an issue or ping me on [Discord](https://discord.gg/PAGT2fu) (so we can discuss your idea) before working on a big change!

### License

spark is free & open source. It is released under the terms of the GNU GPLv3 license. Please see [`LICENSE.txt`](LICENSE.txt) for more information.

spark is a fork of [WarmRoast](https://github.com/sk89q/WarmRoast), which was also [licensed using the GPLv3](https://github.com/sk89q/WarmRoast/blob/3fe5e5517b1c529d95cf9f43fd8420c66db0092a/src/main/java/com/sk89q/warmroast/WarmRoast.java#L1-L17).

---

## Fork Additions: Export Analysis (Summary JSON + Full JSONL)

This fork adds an **Export Analysis** feature to the sampler viewer, allowing users to export structured diagnostic data alongside the original sparkprofile.

### New Export Options

When viewing a sampler profile, the control bar now shows three export buttons:

| Button | File | Description |
|---|---|---|
| **Summary** | `<code>.spark-summary.json` | Compact diagnostic report (~21KB). LLM-friendly, contains top methods, hot thread call trees, worst time windows, TPS/MSPT/GC stats, evidence stacks, and inferred signals. |
| **Full** | `<code>.spark-full.jsonl` | Complete aggregate data (JSONL). Per-thread, per-method, per-window aggregations for programmatic analysis. |
| **Original** | `<code>.sparkprofile` | The original binary sparkfile (existing behavior). |

### Architecture

- **`src/viewer/sampler/export/`** — Core export modules
  - `ExportModel.ts` — Neutral data model, independent of viewer internals
  - `SummaryTypes.ts` — TypeScript types for the summary schema (`spark_summary.v1`)
  - `SummaryGenerator.ts` — DFS-based aggregation + pruned call tree generation
  - `SparkViewerAdapter.ts` — Single adapter layer mapping viewer's `SamplerData` to export model
  - `ExportAnalysisWorker.ts` — Comlink worker for off-main-thread generation
  - `RemoteExportAnalysisWorker.ts` — Worker proxy using Comlink
- **`src/viewer/sampler/components/controls/AnalysisExportButton.tsx`** — React component with three export buttons

### Upstream Compatibility

The export feature is designed as an isolated extension. When pulling upstream spark-viewer updates:

1. **No changes needed** in `SummaryGenerator.ts` or `ExportModel.ts` unless the neutral model needs updating
2. **Update only** `SparkViewerAdapter.ts` if the viewer's `SamplerData` shape changes
3. **Re-add** `AnalysisExportButton` in `Controls.tsx` if the controls layout changes

See `UPSTREAM_COMPATIBILITY.md` for the detailed maintenance workflow.
