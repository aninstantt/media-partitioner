#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(__filename);
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "segments.config.json");
const DURATION_TOLERANCE_SECONDS = 1;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Unable to read JSON from ${filePath}: ${error.message}`);
  }
}

function parseTimeToSeconds(value, label) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    fail(`${label} must be a number or a time string.`);
  }

  if (/^\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }

  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) {
    fail(`${label} has an invalid time format: ${value}`);
  }

  while (parts.length < 3) {
    parts.unshift(0);
  }

  if (parts.length > 3) {
    fail(`${label} has an invalid time format: ${value}`);
  }

  const [hours, minutes, seconds] = parts;
  return hours * 3600 + minutes * 60 + seconds;
}

function normalizeJobs(config) {
  if (Array.isArray(config.jobs) && config.jobs.length > 0) {
    return config.jobs;
  }

  if (config.input && Array.isArray(config.segments)) {
    return [config];
  }

  fail('Config must contain either a "jobs" array or top-level "input" + "segments".');
}

function sanitizeFileName(value) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOutputFileName(segment, index) {
  if (typeof segment.fileName === "string" && segment.fileName.trim()) {
    return `${sanitizeFileName(segment.fileName.replace(/\.mp3$/i, ""))}.mp3`;
  }

  return `${String(index + 1).padStart(2, "0")} - ${sanitizeFileName(segment.title)}.mp3`;
}

function getValue(key, segment, job, defaults) {
  if (segment && typeof segment[key] === "string" && segment[key].trim()) {
    return segment[key].trim();
  }

  if (job && typeof job[key] === "string" && job[key].trim()) {
    return job[key].trim();
  }

  if (defaults && typeof defaults[key] === "string" && defaults[key].trim()) {
    return defaults[key].trim();
  }

  return "";
}

function getExpectedDuration(segment, label) {
  const start = parseTimeToSeconds(segment.start ?? 0, `${label}.start`);

  if (segment.end != null) {
    return parseTimeToSeconds(segment.end, `${label}.end`) - start;
  }

  if (segment.duration != null) {
    return parseTimeToSeconds(segment.duration, `${label}.duration`);
  }

  fail(`${label} must contain either "end" or "duration".`);
}

function runFfprobe(args, filePath) {
  const result = spawnSync("ffprobe", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    fail(`Failed to start ffprobe for ${filePath}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`ffprobe failed for ${filePath}: ${(result.stderr || result.stdout || "").trim()}`);
  }

  return result.stdout.trim();
}

function readTag(filePath, tagName) {
  return runFfprobe(
    [
      "-v",
      "error",
      "-show_entries",
      `format_tags=${tagName}`,
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    filePath
  );
}

function readDuration(filePath) {
  const value = runFfprobe(
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ],
    filePath
  );

  return Number(value || 0);
}

function compare(label, expected, actual, errors) {
  if ((expected || "") !== (actual || "")) {
    errors.push(`${label} mismatch: expected "${expected || ""}", got "${actual || ""}"`);
  }
}

function main() {
  const configPath = path.resolve(process.argv[2] || DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    fail(`Config file not found: ${configPath}`);
  }

  const config = readJson(configPath);
  const defaults = config.defaults && typeof config.defaults === "object" ? config.defaults : {};
  const jobs = normalizeJobs(config);
  let hasError = false;

  for (let jobIndex = 0; jobIndex < jobs.length; jobIndex += 1) {
    const job = jobs[jobIndex];

    for (let segmentIndex = 0; segmentIndex < job.segments.length; segmentIndex += 1) {
      const segment = job.segments[segmentIndex];
      const label = `jobs[${jobIndex}].segments[${segmentIndex}]`;
      const expectedFileName = buildOutputFileName(segment, segmentIndex);
      const outputPath = path.join(OUTPUT_DIR, expectedFileName);
      const errors = [];

      if (!fs.existsSync(outputPath)) {
        console.log(`FAIL ${expectedFileName}`);
        console.log("  - file does not exist");
        hasError = true;
        continue;
      }

      const expectedTitle = segment.title;
      const expectedArtist = getValue("artist", segment, job, defaults);
      const expectedAlbum = getValue("album", segment, job, defaults);
      const expectedDuration = getExpectedDuration(segment, label);

      const actualTitle = readTag(outputPath, "title");
      const actualArtist = readTag(outputPath, "artist");
      const actualAlbum = readTag(outputPath, "album");
      const actualDuration = readDuration(outputPath);

      compare("title", expectedTitle, actualTitle, errors);
      compare("artist", expectedArtist, actualArtist, errors);
      compare("album", expectedAlbum, actualAlbum, errors);

      if (Math.abs(expectedDuration - actualDuration) > DURATION_TOLERANCE_SECONDS) {
        errors.push(
          `duration mismatch: expected about ${expectedDuration.toFixed(3)}s, got ${actualDuration.toFixed(3)}s`
        );
      }

      if (errors.length === 0) {
        console.log(`OK ${expectedFileName}`);
        continue;
      }

      console.log(`FAIL ${expectedFileName}`);
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
      hasError = true;
    }
  }

  if (hasError) {
    process.exit(1);
  }

  console.log("All files are valid.");
}

main();
