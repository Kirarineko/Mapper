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
| Konva、react-konva、zustand | 画布、React 绑定、前端状态 | MIT |
| Tailwind CSS | 生成前端样式 | MIT |

`node scripts/collect-notices.mjs` 从实际安装的生产依赖及其传递依赖中采集原始声明，输出 `resources/notices/README.md`、`inventory.json`、`npm/` 和 `electron/`，打包时复制到应用资源目录的 `notices/`。`pnpm release:linux` 与 `pnpm release:win` 会自动运行该脚本。采集过程无网络请求；Windows 与 Linux 使用各自实际安装的 `@img` 平台包。Electron 的 MIT 原文及 `LICENSES.chromium.html` 从同版本 `electron/dist` 复制，不能只保留包元数据。

以下 npm 包没有随附完整许可证文件，补充原文在 `resources/notices/upstream/` 版本化，并记录来源和 SHA-256；采集时校验内容。Windows Git 自动转换的 CRLF 会还原为上游 LF 后校验和写入。

- `bezier-js@6.1.4`：发布提交 `a41f3e08e9724c9973eca0eb5c1304120e72fc70` 的 README 与包元数据明确声明 MIT，但未包含 LICENSE。保留该版本原始 README，另附同一上游后续提供的 MIT 全文；来源记录明确区分这两者。
- `clipper-lib@6.4.2`：保留原始 `clipper.js` 版权头、其引用的 Boost Software License 1.0 全文，以及内嵌 Tom Wu JSBN 的许可全文。JSBN 原文取自其上游镜像，来源与原 Stanford 链接的检索限制已记录在 manifest 中。

`@img/sharp-libvips-*` 的 README 仅提供许可摘要，`versions.json` 提供该平台实际链接的库版本。这两个文件会原样保留，但不能替代完整许可证文本或 LGPL 对应源码；采集脚本成功不代表对应源码分发已经完成。

`pnpm-lock.yaml` 锁定完整依赖树。构建 Windows 与 Fedora/Linux 安装包时，还需审查平台对应的 Electron、Chromium、libvips、原生绑定及其传递依赖；不能仅依据 `sharp` 的 Apache-2.0 声明。包含 LGPL 组件的发布物必须按其许可证提供源码、修改及必要的构建资料，并保持动态库可替换性。
