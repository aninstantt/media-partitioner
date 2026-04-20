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

## Run

```bash
node partitioner.js # or `pnpm start`
```

The script reads `segments.config.json` by default.
