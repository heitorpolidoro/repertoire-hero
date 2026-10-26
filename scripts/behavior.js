#!/usr/bin/env node
// Reader for docs/behavior.md, the registry of current behavior.
//   node scripts/behavior.js area           -> area names, one per line
//   node scripts/behavior.js area <name>    -> that area's heading and bullets
// Built-ins only. Exit codes: 0 ok, 1 unknown area or missing file, 2 bad usage.
// CommonJS on purpose: package.json has no "type", so a plain .js runs as CJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain .js script run by node without flags
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports -- plain .js script run by node without flags
const path = require("node:path");

const REGISTRY = path.join(__dirname, "..", "docs", "behavior.md");
const USAGE = "usage: node scripts/behavior.js area [name]";

function parse(text) {
  const sections = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      current = { name: heading[1].trim(), bullets: [] };
      sections.push(current);
    } else if (current && line.trim() !== "") {
      current.bullets.push(line);
    }
  }
  return sections;
}

function main(args) {
  if (args[0] !== "area" || args.length > 2) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let text;
  try {
    text = fs.readFileSync(REGISTRY, "utf8");
  } catch {
    process.stderr.write(`cannot read ${REGISTRY}\n`);
    return 1;
  }
  const sections = parse(text);
  if (args.length === 1) {
    process.stdout.write(sections.map((s) => `${s.name}\n`).join(""));
    return 0;
  }
  const wanted = args[1].trim().toLowerCase();
  const hit = sections.find((s) => s.name.toLowerCase() === wanted);
  if (!hit) {
    const names = sections.map((s) => s.name).join(", ");
    process.stderr.write(`unknown area: ${args[1]}\navailable: ${names}\n`);
    return 1;
  }
  process.stdout.write([`## ${hit.name}`, ...hit.bullets].join("\n") + "\n");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
