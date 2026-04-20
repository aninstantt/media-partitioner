# Media Partitioner

使用 FFmpeg 将音频或视频按时间区间切割成多个 MP3 文件。

英文说明见 [README.md](README.md)。

## 目录说明

- `input/`：放源音频、视频文件，以及可选的封面图片。
- `output/`：输出生成后的 MP3 文件。

## 使用方式

先从模板复制出本地配置文件：

```bash
cp segments.template.json segments.config.json
```

然后根据自己的素材修改 `segments.config.json`，例如：

- 输入文件名
- 每段标题
- 开始和结束时间
- `artist` / `album` / `cover` / `bitrate`

补充说明：

- `cover` 不是必填项。
- 如果不需要写入封面，可以不填 `cover`，或者显式写成 `"cover": null`。

## 运行

```bash
node partitioner.js # 或者 `pnpm start`
```

脚本默认读取 `segments.config.json`。
