# 第三方声明

发布安装包时，本文件应与安装包一起分发，并保留各依赖包随附的版权和许可证文本。

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| Electron、Chromium | 桌面运行时与渲染 | Electron MIT；Chromium 及其组件见 `LICENSES.chromium.html` |
| sharp | 图片检查、预览及切片 | Apache-2.0，见 `node_modules/sharp/LICENSE` |
| libvips 及 sharp 原生绑定 | sharp 的原生图片处理 | 许可证和版权声明随对应平台的 `@img` 包提供；发布前必须将其文本复制到安装包声明目录 |
| bezier-js | 贝塞尔弧长与切线 | MIT |
| clipper-lib | 多边形合并、擦除、裁剪 | Boost Software License（包元数据许可证标识为 `BSL`） |
| React、React DOM | 前端运行时 | MIT |

`pnpm-lock.yaml` 锁定完整依赖树。构建 Windows 与 Fedora/Linux 安装包时，还需审查平台对应的 Electron、Chromium、libvips、原生绑定及其传递依赖；不能仅依据 `sharp` 的 Apache-2.0 声明。包含 LGPL 组件的发布物必须按其许可证提供源码、修改及必要的构建资料，并保持动态库可替换性。
