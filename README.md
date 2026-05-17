# Media Partitioner

Split audio or video files into multiple MP3 tracks with FFmpeg.

For Chinese documentation, see [README.zh-CN.md](README.zh-CN.md).

## Directory Roles

- `input/`: put your source audio/video files and optional cover images here.
- `output/`: generated MP3 files will be written here.

## Setup

Create your local config by copying the template:

```bash
cp segments.template.json segments.config.json
```

Then edit `segments.config.json` with your own:

- input file names
- segment titles
- start and end times
- artist / album / cover / bitrate

Notes:

- `cover` is optional.
- You can omit `cover`, or set `"cover": null`, if you do not want embedded cover art.

## Loudness Normalization

Audio is normalized to **-14 LUFS** by default (the streaming platform standard). This uses a two-pass FFmpeg `loudnorm` filter for precise results.

Config options (in `defaults`, `job`, or `segment`):

| Key | Type | Default | Description |
|---|---|---|---|
| `loudnorm.I` | number | `-14` | **Integrated loudness** target in LUFS. The average perceived loudness of the entire track. -14 is the standard for Spotify, YouTube, Apple Music, etc. |
| `loudnorm.TP` | number | `-1` | **True Peak** ceiling in dBTP. Prevents clipping when encoded to lossy formats. -1 dB is safe for all platforms. |

Examples:

```jsonc
// Use defaults (-14 LUFS, -1 dBTP)
"loudnorm": true

// Custom values
"loudnorm": { "I": -16, "TP": -0.5 }

// Disable
"loudnorm": false
```

Platform reference levels:

| Platform | Target LUFS |
|---|---|
| Spotify | -14 |
| Apple Music | -16 |
| YouTube | -14 |
| Amazon Music | -14 |
| Tidal | -14 |
| Deezer | -15 |

## Run

```bash
node partitioner.js # or `pnpm start`
```

The script reads `segments.config.json` by default.
