#!/usr/bin/env node
/**
 * Parse Vitest JUnit XML and write a GitHub Actions Job Summary.
 * When GITHUB_STEP_SUMMARY is unset (local smoke-test), prints Markdown to stdout.
 */
import { appendFileSync, readFileSync } from "node:fs";

const junitPath = process.env.JUNIT_PATH ?? "test-results/junit.xml";

function parseAttrs(tag) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const match of tag.matchAll(/(\w+)="([^"]*)"/g)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function decodeXml(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function formatSeconds(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}s`;
}

function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, markdown, "utf8");
  } else {
    process.stdout.write(markdown);
  }
}

function noResults(reason) {
  writeSummary(`## Test results\n\n_${reason}_\n`);
  process.exit(0);
}

let xml;
try {
  xml = readFileSync(junitPath, "utf8");
} catch {
  noResults(`No JUnit report found at \`${junitPath}\`.`);
}

const rootMatch = xml.match(/<testsuites\b([^>]*)>/);
if (!rootMatch) {
  noResults(`JUnit report at \`${junitPath}\` could not be parsed.`);
}

const root = parseAttrs(rootMatch[1]);
const totalTests = Number(root.tests ?? 0);
const totalFailures = Number(root.failures ?? 0);
const totalErrors = Number(root.errors ?? 0);
const totalTime = root.time;

/** @type {{ name: string, tests: number, failures: number, skipped: number, time: string }[]} */
const suites = [];
for (const match of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
  const attrs = parseAttrs(match[1]);
  suites.push({
    name: attrs.name ?? "unknown",
    tests: Number(attrs.tests ?? 0),
    failures: Number(attrs.failures ?? 0),
    skipped: Number(attrs.skipped ?? 0),
    time: attrs.time ?? "0",
  });
}

const totalSkipped = suites.reduce((sum, suite) => sum + suite.skipped, 0);
const totalPassed = Math.max(0, totalTests - totalFailures - totalErrors - totalSkipped);

/** @type {{ suite: string, name: string, message: string }[]} */
const failures = [];
for (const match of xml.matchAll(
  /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g,
)) {
  const attrs = parseAttrs(match[1]);
  const body = match[2];
  const failureMatch = body.match(/<failure\b([^>]*)>([\s\S]*?)<\/failure>/);
  const errorMatch = !failureMatch
    ? body.match(/<error\b([^>]*)>([\s\S]*?)<\/error>/)
    : null;
  const problem = failureMatch ?? errorMatch;
  if (!problem) continue;

  const problemAttrs = parseAttrs(problem[1]);
  const message =
    decodeXml(problem[2].trim()) ||
    decodeXml(problemAttrs.message ?? "") ||
    "Test failed";
  failures.push({
    suite: attrs.classname ?? "unknown",
    name: decodeXml(attrs.name ?? "unknown"),
    message,
  });
}

const lines = [
  "## Test results",
  "",
  "| | Count |",
  "| --- | ---: |",
  `| Passed | ${totalPassed} |`,
  `| Failed | ${totalFailures} |`,
  `| Errors | ${totalErrors} |`,
  `| Skipped | ${totalSkipped} |`,
  `| Duration | ${formatSeconds(totalTime)} |`,
  "",
];

if (suites.length > 0) {
  lines.push(
    "### Suites",
    "",
    "| Suite | Tests | Failed | Skipped | Duration |",
    "| --- | ---: | ---: | ---: | ---: |",
  );
  for (const suite of suites) {
    lines.push(
      `| \`${suite.name}\` | ${suite.tests} | ${suite.failures} | ${suite.skipped} | ${formatSeconds(suite.time)} |`,
    );
  }
  lines.push("");
}

if (failures.length > 0) {
  lines.push("### Failures", "");
  for (const failure of failures) {
    lines.push(`- **\`${failure.suite}\`** › ${failure.name}`, "");
    lines.push("```", failure.message, "```", "");
  }
}

writeSummary(`${lines.join("\n")}\n`);
