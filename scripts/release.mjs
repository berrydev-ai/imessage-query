import { readFileSync, writeFileSync } from "node:fs";

const [, , version, rawSummary = ""] = process.argv;

if (!version) {
  console.error("Usage: node scripts/release.mjs <version> [summary]");
  process.exit(1);
}

const changelogPath = new URL("../CHANGELOG.md", import.meta.url);
const changelog = readFileSync(changelogPath, "utf8");

const today = new Date().toISOString().slice(0, 10);
const trimmedSummary = rawSummary.trim();
const summaryLines =
  trimmedSummary.length > 0
    ? trimmedSummary
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `- ${line}`)
    : ["- Release notes: see the GitHub release for full details."];

const section = `## ${version} - ${today}\n\n${summaryLines.join("\n")}\n\n`;

if (changelog.includes(`## ${version} - ${today}`)) {
  console.error(`CHANGELOG.md already contains an entry for ${version} on ${today}`);
  process.exit(1);
}

const marker = "All notable changes to this project will be documented in this file.\n\n";

if (!changelog.includes(marker)) {
  console.error("CHANGELOG.md is missing the expected header marker.");
  process.exit(1);
}

const nextChangelog = changelog.replace(marker, `${marker}${section}`);
writeFileSync(changelogPath, nextChangelog);
