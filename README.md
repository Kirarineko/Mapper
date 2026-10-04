# mapper

用于原创世界观地图管理的桌面应用。

## 技术栈

- TypeScript
- React 19
- Tailwind CSS 4（通过 Vite 插件集成）
- Electron + electron-vite
- pnpm 10

## 当前状态

已实现 React 工作区、地图选择、线与面测量、比例尺标定、撤销重做、本地自动保存，以及 Electron 主进程/preload、安全 IPC 和大图切片。当前版本为 `0.1.0`。

## 环境与命令

需要 Node.js 22.12 或更新版本，以及 package.json 指定的 pnpm 版本。

```sh
pnpm install
```

开发、检查和构建命令：

```sh
pnpm dev
pnpm typecheck
pnpm build
pnpm preview
pnpm test
```

首次安装会生成并更新 `pnpm-lock.yaml`，应将其纳入版本控制。
pnpm 已配置允许 Electron、esbuild 和 sharp 执行安装脚本。

## 安装包

在对应操作系统安装依赖后执行：

```sh
pnpm release:win
pnpm release:linux
```

Windows 生成 x64 NSIS 安装程序；Linux 生成 x64 AppImage 和 RPM。输出位于 `release/`，不纳入版本控制。打包流程禁止自动发布，当前构建不包含代码签名。

Windows 与 Linux 使用各自的原生依赖；不要共用两个平台的 `node_modules/`。

GitHub Actions 工作流位于 `.github/workflows/build.yml`。推送到 `main`/`master`、创建对应 Pull Request、推送 `v*` 标签，或在 Actions 页面选择 **Build desktop installers → Run workflow** 均可构建。Windows、Linux 各使用独立 runner，执行锁文件安装、测试、类型检查、构建及打包后的 Electron 验证。

首版标签为 `v0.1.0`；标签必须与 `package.json` 的版本一致。安装程序、AppImage、RPM、SHA-256 校验值和许可证保存在本次运行的 **Artifacts** 中，保留 30 天。工作流只上传构建产物，不创建 GitHub Release。

## 目录约定

- src/main/：Electron 主进程，入口为 index.ts。
- src/preload/：预加载脚本，入口为 index.ts。
- src/renderer/：React 工作区与画布交互。
- resources/：桌面应用资源。
- out/：electron-vite 构建输出，不纳入版本控制。

Tailwind CSS 4 使用 CSS 中的 `@import "tailwindcss";`。

后端接口说明见 [BACKEND_CONTRACT.md](BACKEND_CONTRACT.md)，第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
