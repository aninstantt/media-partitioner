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

## 响度标准化

默认将音频标准化到 **-14 LUFS**（流媒体平台标准）。使用 FFmpeg 的 `loudnorm` 滤镜进行两遍处理，精度较高。

配置项（可在 `defaults`、`job`、`segment` 层级定义）：

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `loudnorm.I` | number | `-14` | **综合响度**目标，单位 LUFS。指整段音频的平均感知响度。-14 是 Spotify、YouTube、Apple Music 等平台的标准值。 |
| `loudnorm.TP` | number | `-1` | **真峰值**上限，单位 dBTP。防止编码为有损格式时出现削波失真。-1 dB 对所有平台都安全。 |

示例：

```jsonc
// 使用默认值（-14 LUFS，-1 dBTP）
"loudnorm": true

// 自定义值
"loudnorm": { "I": -16, "TP": -0.5 }

// 关闭
"loudnorm": false
```

各平台参考值：

| 平台 | 目标 LUFS |
|---|---|
| Spotify | -14 |
| Apple Music | -16 |
| YouTube | -14 |
| Amazon Music | -14 |
| Tidal | -14 |
| Deezer | -15 |

## 运行

```bash
node partitioner.js # 或者 `pnpm start`
```

脚本默认读取 `segments.config.json`。
