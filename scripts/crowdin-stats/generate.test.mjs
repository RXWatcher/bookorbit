import assert from "node:assert/strict";
import { test } from "node:test";
import { computeLayout, extractLanguages, generateSvg, parseArguments } from "./generate.mjs";

function language(id, name, locale, translationProgress, translated = 0, total = 0) {
  return { data: { languageId: id, language: { name, locale }, translationProgress, words: { translated, total } } };
}

const sampleStats = {
  progress: [
    language("de", "German", "de-DE", "96%", 18675, 19358),
    language("en", "English", "en-US", "95%", 18465, 19358),
    language("nl", "Dutch", "nl-NL", "95%", 18535, 19358),
    language("pt-BR", "Portuguese, Brazilian", "pt-BR", "97%", 18868, 19358),
    language("sl", "Slovenian", "sl-SI", "95%", 18554, 19358),
  ],
};

test("parseArguments parses flags", () => {
  const options = parseArguments(["--out", "custom.svg", "--url", "https://example.com/stats.json"]);
  assert.equal(options.outputPath, "custom.svg");
  assert.equal(options.statsUrl, "https://example.com/stats.json");
});

test("parseArguments rejects unknown flags and missing values", () => {
  assert.throws(() => parseArguments(["--nope", "x"]), /Unknown argument/);
  assert.throws(() => parseArguments(["--out"]), /Missing value for --out/);
});

test("extractLanguages pins the source language at 100% and sorts targets by progress", () => {
  const languages = extractLanguages(sampleStats);
  assert.deepEqual(
    languages.map((item) => item.id),
    ["en", "pt-BR", "de", "nl", "sl"],
  );
  assert.deepEqual(languages[0].percent, 100);
  assert.equal(languages[0].isSource, true);
  assert.equal(languages[1].isSource, false);
});

test("extractLanguages derives flags from the locale and defaults missing progress to zero", () => {
  const [german] = extractLanguages({ progress: [language("de", "German", "de-DE", "96%")] });
  assert.equal(german.flag, "🇩🇪");

  const [brazilian] = extractLanguages({ progress: [language("pt-BR", "Portuguese, Brazilian", "pt-BR", "97%")] });
  assert.equal(brazilian.name, "Portuguese");
  assert.equal(brazilian.flag, "🇧🇷");

  const [unflagged] = extractLanguages({ progress: [language("pt-BR", "Portuguese, Brazilian", "pt", "97%")] });
  assert.equal(unflagged.name, "Portuguese, Brazilian");

  const [unknown] = extractLanguages({ progress: [{ data: { languageId: "eo" } }] });
  assert.equal(unknown.name, "eo");
  assert.equal(unknown.flag, "");
  assert.equal(unknown.percent, 0);
});

test("generateSvg renders every target language with its percentage", () => {
  const svg = generateSvg(sampleStats);
  assert.match(svg, /^<svg /);
  assert.match(svg, /🇩🇪 {2}German/);
  assert.match(svg, /🇳🇱 {2}Dutch/);
  assert.match(svg, /🇧🇷 {2}Portuguese</);
  assert.match(svg, /🇸🇮 {2}Slovenian/);
  assert.match(svg, />97%</);
  assert.match(svg, /4 target languages · 96% average/);
  assert.match(svg, /English/);
  assert.match(svg, /class="bar-source"/);
  assert.doesNotMatch(svg, />100%<.*\n.*bar-source/);
});

test("generateSvg renders the source language as a full blue bar excluded from the average", () => {
  const svg = generateSvg(sampleStats);
  const sourceBar = /<rect x="(\d+)"[^>]*width="(\d+)"[^>]*class="bar-source"/.exec(svg);
  assert.ok(sourceBar, "source bar must be rendered");
  assert.equal(Number(sourceBar[2]), computeLayout(extractLanguages(sampleStats)).barWidth);
  assert.match(svg, /96% average/);
});

test("generateSvg grows the canvas instead of overflowing when languages are added", () => {
  const withExtra = generateSvg({ progress: [...sampleStats.progress, language("es", "Spanish", "es-ES", "40%", 4000, 19358)] });
  assert.match(withExtra, /viewBox="0 0 680 324"/);
  assert.match(withExtra, /🇪🇸 {2}Spanish/);
  assert.match(generateSvg(sampleStats), /viewBox="0 0 680 282"/);
});

test("computeLayout keeps horizontal rows up to eight languages", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({ name: `Language ${index}`, flag: "", percent: 50 }));
  assert.equal(computeLayout(rows).mode, "rows");
  assert.equal(computeLayout([...rows, { name: "One more", flag: "", percent: 50 }]).mode, "columns");
});

test("generateSvg switches to vertical columns beyond eight languages", () => {
  const many = {
    progress: [
      language("en", "English", "en-US", "95%", 1, 2),
      ...Array.from({ length: 12 }, (_, index) => language(`l${index}`, `Language ${index}`, "xx-XX", "50%", 1, 2)),
    ],
  };
  const languages = extractLanguages(many);
  const layout = computeLayout(languages);
  assert.equal(layout.mode, "columns");
  assert.equal(layout.count, 13);

  const svg = generateSvg(many);
  assert.match(svg, new RegExp(`viewBox="0 0 680 ${layout.height}"`));
  assert.equal(svg.match(/class="bar-bg"/g).length, 13);
  assert.equal(svg.match(/transform="rotate\(-45 /g).length, 13);
  assert.match(svg, /class="axis-label">100</);
  assert.ok(layout.columnWidth >= 6, "columns must stay visible");
});

test("generateSvg keeps horizontal bars inside the card", () => {
  const svg = generateSvg(sampleStats);
  for (const [, x, width] of svg.matchAll(/<rect x="(\d+)" y="\d+" width="(\d+)"[^>]*class="bar-bg"/g)) {
    assert.ok(Number(x) + Number(width) <= 680 - 24, "bar must not overflow the card padding");
  }
});

test("generateSvg keeps vertical columns inside the plot area", () => {
  const many = {
    progress: Array.from({ length: 20 }, (_, index) => language(`l${index}`, `Language ${index}`, "xx-XX", `${index * 5}%`, index, 100)),
  };
  const layout = computeLayout(extractLanguages(many));
  const svg = generateSvg(many);

  for (const [, x, y, width, height] of svg.matchAll(
    /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"[^>]*class="bar-(?:bg|high|medium|low|source)"/g,
  )) {
    assert.ok(Number(x) >= 24, "column must not overflow the left padding");
    assert.ok(Number(x) + Number(width) <= 680 - 24, "column must not overflow the right padding");
    assert.ok(Number(y) + Number(height) <= layout.baseline, "column must sit on the baseline");
  }
});

test("generateSvg colours bars by progress", () => {
  const svg = generateSvg({
    progress: [language("de", "German", "de-DE", "96%"), language("nl", "Dutch", "nl-NL", "70%"), language("sl", "Slovenian", "sl-SI", "12%")],
  });
  assert.match(svg, /class="bar-high"/);
  assert.match(svg, /class="bar-medium"/);
  assert.match(svg, /class="bar-low"/);
});

test("generateSvg escapes language names and handles empty data", () => {
  const svg = generateSvg({ progress: [language("xx", "A & B <Test>", "xx-XX", "10%")] });
  assert.match(svg, /A &amp; B &lt;Test&gt;/);

  const empty = generateSvg({ progress: [] });
  assert.match(empty, /no translation data/);
  assert.doesNotMatch(empty, /NaN|undefined/);
});

test("computeLayout keeps rotated labels inside the card", () => {
  const languages = extractLanguages({
    progress: Array.from({ length: 21 }, (_, index) => language(`l${index}`, "Portuguese, Brazilian", "pt-BR", "50%", 1, 2)),
  });
  const layout = computeLayout(languages);

  for (const column of layout.columns) {
    assert.ok(column.centerX - column.label.width * Math.SQRT1_2 >= 9, "rotated label must stay inside the card");
  }
});
