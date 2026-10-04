# AGENTS.md

## 项目目标

mapper 是用于原创世界观地图管理的桌面应用。
当前阶段仅初始化项目；在用户明确要求实现功能前，不添加业务代码或示例界面。

## 技术与工具

- 使用 TypeScript、React、Tailwind CSS 4、Electron 和 electron-vite。
- 使用 pnpm 管理依赖和运行脚本，不混用 npm 或 yarn。
- 安装依赖后提交 pnpm-lock.yaml，不手工编辑锁文件。
- 优先沿用现有配置，不擅自更换框架或添加大型依赖。

## 目录与边界

- src/main/ 管理窗口、文件系统及系统能力。
- src/preload/ 通过 contextBridge 暴露最小、类型明确的接口。
- src/renderer/ 放置 React 界面及前端状态。
- resources/ 放置应用资源。
- 渲染进程不直接使用 Node.js 或 Electron 特权 API。
- 创建窗口时启用 contextIsolation，禁用 nodeIntegration。
- IPC 参数应校验；不要向界面暴露任意文件访问或任意通道调用能力。

## 实现约定

- 保持 TypeScript 严格模式，避免无理由使用 any。
- React 使用函数组件和 Hooks；样式优先使用 Tailwind CSS。
- 仅添加当前任务需要的抽象和依赖。
- 地图、世界观与存档格式的选择应基于实际需求，不提前假定。
- 涉及用户地图或存档的覆盖、删除及迁移时，应保护原始数据。
- 不提交依赖目录、构建产物、密钥或本地用户数据。
- 文档与沟通默认使用中文。

## 验证

- 实现入口后，修改代码需运行 pnpm typecheck 和 pnpm build。
- 对数据读写、IPC 和关键地图行为进行与风险相称的验证。
- 当前初始化阶段没有应用入口；不要为通过构建而擅自补写应用代码。
- 明确报告未执行的检查及原因，不声称尚未运行的命令已经通过。
