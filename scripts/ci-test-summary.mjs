#!/usr/bin/env node
/**
 * Parse Vitest JUnit XML and write Markdown for a GitHub Actions Job Summary.
 * Writes to stdout only — the workflow appends that output to $GITHUB_STEP_SUMMARY.
 */
import { readFileSync } from "node:fs";

const JUNIT_PATH = "test-results/junit.xml";

/** Attribute names we read from Vitest JUnit XML. */
const ATTRS = Object.freeze({
  name: "name",
  tests: "tests",
  failures: "failures",
  errors: "errors",
  skipped: "skipped",
  time: "time",
  classname: "classname",
  message: "message",
});

/**
 * @param {string} tag
 * @returns {Record<string, string>}
 */
function parseAttrs(tag) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const match of tag.matchAll(/(\w+)="([^"]*)"/g)) {
    const key = match[1];
    if (key === ATTRS.name) attrs.name = match[2];
    else if (key === ATTRS.tests) attrs.tests = match[2];
    else if (key === ATTRS.failures) attrs.failures = match[2];
    else if (key === ATTRS.errors) attrs.errors = match[2];
    else if (key === ATTRS.skipped) attrs.skipped = match[2];
    else if (key === ATTRS.time) attrs.time = match[2];
    else if (key === ATTRS.classname) attrs.classname = match[2];
    else if (key === ATTRS.message) attrs.message = match[2];
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

function noResults(reason) {
  process.stdout.write(`## Test results\n\n_${reason}_\n`);
  process.exit(0);
}

let xml;
try {
  xml = readFileSync(JUNIT_PATH, "utf8");
} catch {
  noResults(`No JUnit report found at \`${JUNIT_PATH}\`.`);
}

const rootMatch = xml.match(/<testsuites\b([^>]*)>/);
if (!rootMatch) {
  noResults(`JUnit report at \`${JUNIT_PATH}\` could not be parsed.`);
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

process.stdout.write(`${lines.join("\n")}\n`);
