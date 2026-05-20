import {
  intro,
  outro,
  multiselect,
  confirm,
  spinner,
  cancel,
  isCancel,
  log,
} from "@clack/prompts";
import path from "node:path";
import { isInteractive } from "./lib/tty";
import { runAdapter } from "./lib/adapter";
import type { Adapter, WriteOutcome } from "./lib/adapter";

// Import all adapter singletons
import { claudeCodeAdapter } from "./clients/claude-code";
import { claudeDesktopAdapter } from "./clients/claude-desktop";
import { cursorAdapter } from "./clients/cursor";
import { windsurfAdapter } from "./clients/windsurf";
import { clineAdapter } from "./clients/cline";
import { continueAdapter } from "./clients/continue";
import { zedAdapter } from "./clients/zed";

const ALL_ADAPTERS: Adapter[] = [
  claudeCodeAdapter,
  claudeDesktopAdapter,
  cursorAdapter,
  windsurfAdapter,
  clineAdapter,
  continueAdapter,
  zedAdapter,
];

// Server path: the MCP server entry point
const SERVER_PATH = path.join(
  import.meta.dirname ?? __dirname,
  "..",
  "src",
  "server.ts"
);

interface AdapterResult {
  adapter: Adapter;
  outcome: WriteOutcome;
}

async function main() {
  intro("MCP Port Registry Installer");

  // Detect all adapters in parallel
  const detections = await Promise.all(
    ALL_ADAPTERS.map(async (a) => ({ adapter: a, result: await a.detect() }))
  );

  const detected = detections.filter((d) => d.result.installed);
  const undetected = detections.filter((d) => !d.result.installed);

  if (isInteractive()) {
    await runInteractive(detected.map((d) => d.adapter), undetected.map((d) => d.adapter));
  } else {
    await runNonInteractive(detected.map((d) => d.adapter));
  }
}

async function runInteractive(
  detectedAdapters: Adapter[],
  undetectedAdapters: Adapter[]
) {
  if (detectedAdapters.length === 0 && undetectedAdapters.length === 0) {
    cancel("No supported clients found on this system.");
    process.exit(0);
  }

  // Build options: detected pre-checked, undetected unchecked
  const options = [
    ...detectedAdapters.map((a) => ({
      value: a.id,
      label: `${a.label} (detected)`,
      hint: a.configPath(),
    })),
    ...undetectedAdapters.map((a) => ({
      value: a.id,
      label: a.label,
      hint: "not detected",
    })),
  ];

  const initialValues = detectedAdapters.map((a) => a.id);

  const selected = await multiselect({
    message: "Select clients to configure:",
    options,
    initialValues,
    required: false,
  });

  if (isCancel(selected)) {
    cancel("Installation cancelled.");
    process.exit(0);
  }

  const selectedIds = selected as string[];
  if (selectedIds.length === 0) {
    cancel("No clients selected. Nothing to do.");
    process.exit(0);
  }

  const confirmed = await confirm({
    message: `Configure ${selectedIds.length} client(s)?`,
  });

  if (isCancel(confirmed) || !confirmed) {
    cancel("Installation cancelled.");
    process.exit(0);
  }

  const allAdapters = [...detectedAdapters, ...undetectedAdapters];
  const toRun = allAdapters.filter((a) => selectedIds.includes(a.id));
  const results: AdapterResult[] = [];

  for (const adapter of toRun) {
    const s = spinner();
    s.start(`Configuring ${adapter.label}…`);
    const outcome = await runAdapter(adapter, SERVER_PATH);
    if (outcome.status === "configured") {
      s.stop(`${adapter.label} configured`);
    } else if (outcome.status === "already-configured") {
      s.stop(`${adapter.label} already configured`);
    } else {
      s.stop(`${adapter.label} failed: ${outcome.error}`);
    }
    results.push({ adapter, outcome });
  }

  printSummary(results);
}

async function runNonInteractive(detectedAdapters: Adapter[]) {
  if (detectedAdapters.length === 0) {
    log.info("No detected clients to configure.");
    process.exit(0);
  }

  log.info(`Non-interactive mode: configuring ${detectedAdapters.length} detected client(s)…`);
  const results: AdapterResult[] = [];

  for (const adapter of detectedAdapters) {
    const outcome = await runAdapter(adapter, SERVER_PATH);
    if (outcome.status === "configured") {
      log.success(`${adapter.label}: configured`);
    } else if (outcome.status === "already-configured") {
      log.info(`${adapter.label}: already configured`);
    } else {
      log.error(`${adapter.label}: failed — ${outcome.error}`);
    }
    results.push({ adapter, outcome });
  }

  printSummary(results);
}

function printSummary(results: AdapterResult[]) {
  const configured = results.filter((r) => r.outcome.status === "configured");
  const alreadyDone = results.filter((r) => r.outcome.status === "already-configured");
  const failed = results.filter((r) => r.outcome.status === "failed");

  const lines: string[] = [];
  lines.push("");
  lines.push("Summary:");
  for (const r of configured) {
    lines.push(`  ✓ ${r.adapter.label} — configured`);
  }
  for (const r of alreadyDone) {
    lines.push(`  = ${r.adapter.label} — already configured`);
  }
  for (const r of failed) {
    const err = r.outcome.status === "failed" ? r.outcome.error : "";
    lines.push(`  ✗ ${r.adapter.label} — failed: ${err}`);
  }

  const allFailed = failed.length === results.length && results.length > 0;

  if (allFailed) {
    outro(lines.join("\n"));
    process.exit(1);
  } else {
    outro(lines.join("\n"));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
