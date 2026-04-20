#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(__filename);
const INPUT_DIR = path.join(ROOT_DIR, "input");
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "segments.config.json");

function printHelp() {
  console.log(`
Usage:
  node partitioner.js [config-path]

Defaults:
  config file: ${path.basename(DEFAULT_CONFIG_PATH)}
  input dir:   ${path.basename(INPUT_DIR)}/
  output dir:  ${path.basename(OUTPUT_DIR)}/

Value priority:
  segment > job > defaults

Notes:
  artist / album / cover can be defined in defaults, job, or segment.
  Set cover to null on a job or segment to disable an inherited cover.

Config shape:
  {
    "defaults": {
      "artist": "Artist Name",
      "album": "Album Name",
      "cover": "cover.jpg",
      "bitrate": "320k"
    },
    "jobs": [
      {
        "input": "source.mp4",
        "segments": [
          {
            "title": "Track 01",
            "start": "00:00:00",
            "end": "00:01:30"
          }
        ]
      }
    ]
  }
`.trim());
}

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

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveWithin(baseDir, relativePath, label) {
  if (!relativePath || typeof relativePath !== "string") {
    fail(`${label} must be a non-empty string.`);
  }

  const fullPath = path.resolve(baseDir, relativePath);
  const relative = path.relative(baseDir, fullPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`${label} must stay inside ${baseDir}. Received: ${relativePath}`);
  }

  return fullPath;
}

function sanitizeFileName(value) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function parseTimeToSeconds(value, label) {
  if (isFiniteNumber(value)) {
    return value;
  }

  if (typeof value !== "string") {
    fail(`${label} must be a number of seconds or a time string like 00:01:23.456.`);
  }

  const normalized = value.trim();
  if (!normalized) {
    fail(`${label} cannot be empty.`);
  }

  if (/^\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }

  const parts = normalized.split(":");
  if (parts.length > 3) {
    fail(`${label} has an invalid time format: ${value}`);
  }

  const parsed = parts.map((part) => Number(part));
  if (parsed.some((part) => !Number.isFinite(part))) {
    fail(`${label} has an invalid time format: ${value}`);
  }

  while (parsed.length < 3) {
    parsed.unshift(0);
  }

  const [hours, minutes, seconds] = parsed;
  return hours * 3600 + minutes * 60 + seconds;
}

function formatSeconds(value) {
  if (!Number.isFinite(value) || value < 0) {
    fail(`Invalid time value: ${value}`);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
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

function buildSegmentDuration(segment, label) {
  const startSeconds = parseTimeToSeconds(segment.start ?? 0, `${label}.start`);

  if (segment.end == null && segment.duration == null) {
    fail(`${label} must contain either "end" or "duration".`);
  }

  if (segment.end != null && segment.duration != null) {
    fail(`${label} cannot contain both "end" and "duration". Choose one.`);
  }

  if (segment.end != null) {
    const endSeconds = parseTimeToSeconds(segment.end, `${label}.end`);
    if (endSeconds <= startSeconds) {
      fail(`${label}.end must be greater than ${label}.start.`);
    }

    return {
      start: formatSeconds(startSeconds),
      duration: formatSeconds(endSeconds - startSeconds),
    };
  }

  const durationSeconds = parseTimeToSeconds(segment.duration, `${label}.duration`);
  if (durationSeconds <= 0) {
    fail(`${label}.duration must be greater than 0.`);
  }

  return {
    start: formatSeconds(startSeconds),
    duration: formatSeconds(durationSeconds),
  };
}

function getBitrate(...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(source, "bitrate")) {
      if (typeof source.bitrate === "string" && source.bitrate.trim()) {
        return source.bitrate.trim();
      }

      if (source.bitrate == null) {
        break;
      }
    }
  }

  return "320k";
}

function getRequiredStringValue(key, ...sources) {
  for (const source of sources) {
    if (source && typeof source[key] === "string" && source[key].trim()) {
      return source[key].trim();
    }
  }

  return "";
}

function getOptionalStringValue(key, ...sources) {
  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }

    const value = source[key];
    if (value == null) {
      return null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || null;
    }
  }

  return null;
}

function runFfmpeg(args, segmentLabel) {
  const result = spawnSync("ffmpeg", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    fail(`Failed to start ffmpeg for ${segmentLabel}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout || "").trim();
    fail(`ffmpeg failed for ${segmentLabel}.\n${details}`);
  }
}

function buildOutputFileName(segment, index) {
  if (segment.fileName && typeof segment.fileName === "string") {
    const cleaned = sanitizeFileName(segment.fileName.replace(/\.mp3$/i, ""));
    if (!cleaned) {
      fail(`segments[${index}].fileName is invalid.`);
    }

    return `${cleaned}.mp3`;
  }

  const title = sanitizeFileName(segment.title || `track-${index + 1}`);
  const prefix = String(index + 1).padStart(2, "0");
  return `${prefix} - ${title}.mp3`;
}

function assertFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    fail(`${label} does not exist: ${filePath}`);
  }
}

function processJob(job, jobIndex, defaults) {
  const jobLabel = `jobs[${jobIndex}]`;
  if (!job || typeof job !== "object") {
    fail(`${jobLabel} must be an object.`);
  }

  if (!Array.isArray(job.segments) || job.segments.length === 0) {
    fail(`${jobLabel}.segments must be a non-empty array.`);
  }

  const inputRelative = getRequiredStringValue("input", job);
  if (!inputRelative) {
    fail(`${jobLabel}.input is required.`);
  }

  const inputPath = resolveWithin(INPUT_DIR, inputRelative, `${jobLabel}.input`);
  assertFileExists(inputPath, `${jobLabel}.input`);

  ensureDir(OUTPUT_DIR);

  job.segments.forEach((segment, segmentIndex) => {
    const segmentLabel = `${jobLabel}.segments[${segmentIndex}]`;
    if (!segment || typeof segment !== "object") {
      fail(`${segmentLabel} must be an object.`);
    }

    const title = getRequiredStringValue("title", segment);
    if (!title) {
      fail(`${segmentLabel}.title is required.`);
    }

    const { start, duration } = buildSegmentDuration(segment, segmentLabel);
    const outputFileName = buildOutputFileName(segment, segmentIndex);
    const outputPath = path.join(OUTPUT_DIR, outputFileName);

    const artist = getOptionalStringValue("artist", segment, job, defaults);
    const album = getOptionalStringValue("album", segment, job, defaults);
    const bitrate = getBitrate(segment, job, defaults);
    const coverRelative = getOptionalStringValue("cover", segment, job, defaults);

    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      start,
      "-t",
      duration,
      "-i",
      inputPath,
    ];

    let hasCover = false;
    if (coverRelative) {
      const coverPath = resolveWithin(INPUT_DIR, coverRelative, `${segmentLabel}.cover`);
      assertFileExists(coverPath, `${segmentLabel}.cover`);
      hasCover = true;
      args.push("-i", coverPath);
    }

    args.push(
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-map",
      "0:a:0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      bitrate,
      "-id3v2_version",
      "3",
      "-metadata",
      `title=${title}`
    );

    if (artist) {
      args.push("-metadata", `artist=${artist}`, "-metadata", `album_artist=${artist}`);
    }

    if (album) {
      args.push("-metadata", `album=${album}`);
    }

    if (hasCover) {
      args.push(
        "-map",
        "1:v:0",
        "-c:v",
        "mjpeg",
        "-pix_fmt",
        "yuvj420p",
        "-strict",
        "unofficial",
        "-disposition:v:0",
        "attached_pic",
        "-metadata:s:v",
        "title=Album cover",
        "-metadata:s:v",
        "comment=Cover (front)"
      );
    }

    args.push(outputPath);

    console.log(`Creating ${path.relative(ROOT_DIR, outputPath)} from ${inputRelative} (${start} -> +${duration}s)`);
    runFfmpeg(args, segmentLabel);
  });
}

function main() {
  const maybeHelp = process.argv[2];
  if (maybeHelp === "--help" || maybeHelp === "-h") {
    printHelp();
    return;
  }

  ensureDir(INPUT_DIR);
  ensureDir(OUTPUT_DIR);

  const configPath = path.resolve(process.argv[2] || DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    fail(`Config file not found: ${configPath}`);
  }

  const config = readJson(configPath);
  const defaults = config.defaults && typeof config.defaults === "object" ? config.defaults : {};
  const jobs = normalizeJobs(config);

  jobs.forEach((job, index) => processJob(job, index, defaults));
  console.log(`Finished ${jobs.length} job(s).`);
}

main();
