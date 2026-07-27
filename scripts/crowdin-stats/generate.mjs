#!/usr/bin/env node

import { rename, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const STATS_URL = "https://badges.awesome-crowdin.com/stats-17791545-912891.json";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const SOURCE_LANGUAGE_ID = "en";

const WIDTH = 680;
const RENDERED_WIDTH = 580;
const PADDING_X = 24;
const DIVIDER_Y = 48;
const BAR_RADIUS = 4;
const FLAG_WIDTH = 26;
const LABEL_CHAR_WIDTH = 7.1;
const AXIS_CHAR_WIDTH = 6.1;

const MAX_HORIZONTAL_ROWS = 8;
const ROW_BASELINE = 78;
const ROW_HEIGHT = 42;
const ROW_BOTTOM_PADDING = 36;
const ROW_BAR_HEIGHT = 16;
const ROW_LABEL_WIDTH = 190;
const ROW_LABEL_GAP = 12;
const ROW_PERCENT_WIDTH = 38;
const ROW_PERCENT_GAP = 12;

const AXIS_WIDTH = 30;
const PLOT_TOP = 74;
const PLOT_HEIGHT = 150;
const AXIS_TICKS = [0, 25, 50, 75, 100];
const COLUMN_MAX_WIDTH = 34;
const COLUMN_MIN_WIDTH = 6;
const COLUMN_WIDTH_RATIO = 0.62;
const COLUMN_LABEL_GAP = 16;
const COLUMN_LABEL_MAX_WIDTH = 118;
const COLUMN_LABEL_LEFT_BOUND = 10;
const COLUMN_PERCENT_MIN_SLOT = 32;
const COLUMN_BOTTOM_PADDING = 16;
const ROTATED_LABEL_SCALE = Math.SQRT1_2;

export class CrowdinStatsError extends Error {
  constructor(message, { status, url } = {}) {
    super(message);
    this.name = "CrowdinStatsError";
    this.status = status;
    this.url = url;
  }
}

export function parseArguments(argv) {
  const options = {
    outputPath: "translation-progress.svg",
    statsUrl: STATS_URL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];

    if (!["--out", "--url"].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === "--out") options.outputPath = value;
    if (flag === "--url") options.statsUrl = value;
    index += 1;
  }

  return options;
}

async function readJsonResponse(response, url) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new CrowdinStatsError(`Crowdin response exceeds ${MAX_RESPONSE_BYTES} bytes`, { url });
  }
  if (!response.body) {
    throw new CrowdinStatsError("Crowdin response has no body", { url });
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new CrowdinStatsError(`Crowdin response exceeds ${MAX_RESPONSE_BYTES} bytes`, { url });
    }
    chunks.push(Buffer.from(value));
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CrowdinStatsError("Crowdin response is not valid JSON", { url });
  }
}

export async function fetchCrowdinStats(url = STATS_URL, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "bookorbit-crowdin-stats" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new CrowdinStatsError(`Failed to fetch Crowdin stats: HTTP ${response.status}`, {
      status: response.status,
      url,
    });
  }

  const json = await readJsonResponse(response, url);
  if (!json || !Array.isArray(json.progress)) {
    throw new CrowdinStatsError("Invalid Crowdin stats response format", { url });
  }

  return json;
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function flagFromLocale(locale) {
  const region = /[-_]([A-Za-z]{2})$/.exec(locale || "")?.[1];
  if (!region) return "";

  return String.fromCodePoint(...[...region.toUpperCase()].map((letter) => letter.codePointAt(0) + 0x1f1a5));
}

function displayFor(languageId, apiLanguage) {
  const flag = flagFromLocale(apiLanguage?.locale);
  const name = apiLanguage?.name || languageId;

  return {
    name: flag ? name.split(",")[0].trim() : name,
    flag,
  };
}

function toPercent(value) {
  const parsed = Number.parseInt(String(value).replace("%", ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

export function extractLanguages(statsData) {
  const targets = [];
  let source;

  for (const entry of statsData?.progress ?? []) {
    const data = entry?.data;
    const languageId = data?.languageId;
    if (!languageId) continue;

    const display = displayFor(languageId, data.language);

    if (languageId === SOURCE_LANGUAGE_ID) {
      source = { id: languageId, ...display, percent: 100, isSource: true, translatedWords: 0, totalWords: 0 };
      continue;
    }

    targets.push({
      id: languageId,
      ...display,
      percent: toPercent(data.translationProgress),
      isSource: false,
      translatedWords: data.words?.translated || 0,
      totalWords: data.words?.total || 0,
    });
  }

  targets.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name, "en"));

  return source ? [source, ...targets] : targets;
}

function averagePercent(languages) {
  const targets = languages.filter((language) => !language.isSource);
  if (targets.length === 0) return 0;

  const totalWords = targets.reduce((sum, language) => sum + language.totalWords, 0);
  if (totalWords > 0) {
    const translatedWords = targets.reduce((sum, language) => sum + language.translatedWords, 0);
    return Math.round((translatedWords / totalWords) * 100);
  }

  return Math.round(targets.reduce((sum, language) => sum + language.percent, 0) / targets.length);
}

function truncateToWidth(name, availableWidth, charWidth) {
  const maxCharacters = Math.floor(availableWidth / charWidth);
  if (maxCharacters <= 1 || name.length <= maxCharacters) return name;
  return `${name.slice(0, maxCharacters - 1).trimEnd()}…`;
}

function labelFor(language, availableWidth, charWidth) {
  const textWidth = availableWidth - (language.flag ? FLAG_WIDTH : 0);
  const name = truncateToWidth(language.name, textWidth, charWidth);

  return {
    text: language.flag ? `${language.flag}  ${name}` : name,
    width: (language.flag ? FLAG_WIDTH : 0) + name.length * charWidth,
  };
}

export function computeLayout(languages) {
  const count = languages.length;

  if (count <= MAX_HORIZONTAL_ROWS) {
    return {
      mode: "rows",
      count,
      barWidth: WIDTH - PADDING_X * 2 - ROW_LABEL_WIDTH - ROW_PERCENT_GAP - ROW_PERCENT_WIDTH,
      height: ROW_BASELINE + Math.max(0, count - 1) * ROW_HEIGHT + ROW_BOTTOM_PADDING,
    };
  }

  const plotLeft = PADDING_X + AXIS_WIDTH;
  const slotWidth = (WIDTH - PADDING_X - plotLeft) / count;
  const columnWidth = Math.max(COLUMN_MIN_WIDTH, Math.min(COLUMN_MAX_WIDTH, Math.round(slotWidth * COLUMN_WIDTH_RATIO)));

  const columns = languages.map((language, index) => {
    const centerX = Math.round(plotLeft + slotWidth * (index + 0.5));
    const spaceToLeftEdge = (centerX - COLUMN_LABEL_LEFT_BOUND) / ROTATED_LABEL_SCALE;
    const label = labelFor(language, Math.min(COLUMN_LABEL_MAX_WIDTH, spaceToLeftEdge), AXIS_CHAR_WIDTH);
    return { centerX, label };
  });

  const labelWidth = Math.max(0, ...columns.map((column) => column.label.width));

  return {
    mode: "columns",
    count,
    plotLeft,
    slotWidth,
    columnWidth,
    columns,
    baseline: PLOT_TOP + PLOT_HEIGHT,
    showPercentages: slotWidth >= COLUMN_PERCENT_MIN_SLOT,
    height: PLOT_TOP + PLOT_HEIGHT + COLUMN_LABEL_GAP + Math.round(labelWidth * ROTATED_LABEL_SCALE) + COLUMN_BOTTOM_PADDING,
  };
}

function barClass(language) {
  if (language.isSource) return "bar-source";
  if (language.percent >= 90) return "bar-high";
  if (language.percent >= 60) return "bar-medium";
  return "bar-low";
}

function renderRow(language, index, layout) {
  const baseline = ROW_BASELINE + index * ROW_HEIGHT;
  const barX = PADDING_X + ROW_LABEL_WIDTH;
  const fillWidth = Math.round((language.percent / 100) * layout.barWidth);
  const label = labelFor(language, ROW_LABEL_WIDTH - ROW_LABEL_GAP, LABEL_CHAR_WIDTH);

  return `
  <text x="${PADDING_X}" y="${baseline}" class="lang-label">${escapeXml(label.text)}</text>
  <rect x="${barX}" y="${baseline - 12}" width="${layout.barWidth}" height="${ROW_BAR_HEIGHT}" rx="${BAR_RADIUS}" class="bar-bg" />
  <rect x="${barX}" y="${baseline - 12}" width="${fillWidth}" height="${ROW_BAR_HEIGHT}" rx="${BAR_RADIUS}" class="${barClass(language)}" />
  <text x="${barX + layout.barWidth + ROW_PERCENT_GAP}" y="${baseline}" class="pct-label">${language.percent}%</text>`;
}

function renderColumn(language, index, layout) {
  const { centerX, label } = layout.columns[index];
  const x = Math.round(centerX - layout.columnWidth / 2);
  const fillHeight = Math.round((language.percent / 100) * PLOT_HEIGHT);
  const labelY = layout.baseline + COLUMN_LABEL_GAP;
  const percentLabel = layout.showPercentages
    ? `
  <text x="${centerX}" y="${layout.baseline - fillHeight - 7}" text-anchor="middle" class="pct-label-small">${language.percent}%</text>`
    : "";

  return `
  <rect x="${x}" y="${PLOT_TOP}" width="${layout.columnWidth}" height="${PLOT_HEIGHT}" rx="${BAR_RADIUS}" class="bar-bg" />
  <rect x="${x}" y="${layout.baseline - fillHeight}" width="${layout.columnWidth}" height="${fillHeight}" rx="${BAR_RADIUS}" class="${barClass(language)}" />${percentLabel}
  <text x="${centerX}" y="${labelY}" text-anchor="end" transform="rotate(-45 ${centerX} ${labelY})" class="lang-label-small">${escapeXml(label.text)}</text>`;
}

function renderAxis(layout) {
  return AXIS_TICKS.map((tick) => {
    const y = layout.baseline - Math.round((tick / 100) * PLOT_HEIGHT);
    return `
  <line x1="${layout.plotLeft - 6}" y1="${y}" x2="${WIDTH - PADDING_X}" y2="${y}" class="grid" />
  <text x="${layout.plotLeft - 12}" y="${y + 3.5}" text-anchor="end" class="axis-label">${tick}</text>`;
  }).join("");
}

function renderBody(languages, layout) {
  if (layout.mode === "rows") {
    return languages.map((language, index) => renderRow(language, index, layout)).join("");
  }

  return renderAxis(layout) + languages.map((language, index) => renderColumn(language, index, layout)).join("");
}

export function generateSvg(statsData) {
  const languages = extractLanguages(statsData);
  const layout = computeLayout(languages);
  const targetCount = languages.filter((language) => !language.isSource).length;
  const summary =
    targetCount > 0
      ? `Crowdin · ${targetCount} target ${targetCount === 1 ? "language" : "languages"} · ${averagePercent(languages)}% average`
      : "Crowdin · no translation data";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDERED_WIDTH}" height="${Math.round((layout.height * RENDERED_WIDTH) / WIDTH)}" viewBox="0 0 ${WIDTH} ${layout.height}" fill="none" role="img" aria-label="BookOrbit translation progress">
  <title>BookOrbit translation progress</title>
  <style>
    .card { fill: #0d1117; stroke: #30363d; stroke-width: 1px; rx: 12px; }
    .title { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 15px; font-weight: 600; fill: #f0f6fc; }
    .subtitle { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12px; font-weight: 400; fill: #8b949e; }
    .lang-label { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 13.5px; font-weight: 500; fill: #c9d1d9; }
    .lang-label-small { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 11.5px; font-weight: 500; fill: #c9d1d9; }
    .pct-label { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 12.5px; font-weight: 600; fill: #58a6ff; }
    .pct-label-small { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 10.5px; font-weight: 600; fill: #8b949e; }
    .axis-label { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 10px; font-weight: 400; fill: #6e7681; }
    .grid { stroke: #21262d; stroke-width: 1; }
    .bar-bg { fill: #21262d; }
    .bar-source { fill: #58a6ff; }
    .bar-high { fill: #2ea44f; }
    .bar-medium { fill: #d29922; }
    .bar-low { fill: #db6d28; }
  </style>
  <rect width="${WIDTH - 2}" height="${layout.height - 2}" x="1" y="1" class="card" />

  <text x="${PADDING_X}" y="36" class="title">Translation Progress</text>
  <text x="${WIDTH - PADDING_X}" y="36" text-anchor="end" class="subtitle">${escapeXml(summary)}</text>

  <line x1="${PADDING_X}" y1="${DIVIDER_Y}" x2="${WIDTH - PADDING_X}" y2="${DIVIDER_Y}" class="grid" />
${renderBody(languages, layout)}
</svg>
`;
}

async function writeFileAtomically(path, contents) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, contents, "utf8");
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const stats = await fetchCrowdinStats(options.statsUrl);
  const svg = generateSvg(stats);
  const resolvedPath = resolve(process.cwd(), options.outputPath);
  await writeFileAtomically(resolvedPath, svg);

  console.log(`Wrote ${resolvedPath} with ${extractLanguages(stats).length} languages`);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entryPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
