# 后端契约

共享类型位于 `src/shared/types.ts`，几何函数位于 `src/shared/geometry`。所有几何坐标都是未旋转原图的像素坐标；后端不接触 React、Konva 或 DOM。

## IPC

预加载脚本只暴露 `window.mapper`：选择世界观目录、枚举/加载地图、准备切片、读写三类功能文件、恢复备份、等待保存及关闭。参数在主进程二次校验，地图只用枚举得到的 64 位十六进制标识访问。渲染进程不能调用任意文件或任意 IPC 通道。

调用结果统一为 `{ ok: true, value }` 或 `{ ok: false, error: { code, message } }`。保存冲突、图像变化、损坏文件和路径安全错误分别使用稳定错误码，界面应让用户决定重试、恢复或确认重标定。

## 文件格式

地图 `map.png` 的数据目录为 `map.png_data/`，文件固定为 `Config.json`、`LineMeasurements.json`、`AreaMeasurements.json`。每个文档含 `version: 1` 和 `{ sha256, width, height }` 图像身份；长度、面积等派生值不持久化。保存使用同目录临时文件、同步写入、原子替换和 `.bak` 合法备份，单文件上限 32 MiB。

损坏文件不会被覆盖。显式恢复会先将当前文件归档为带时间和随机标识的 `.corrupt-*` 文件，再恢复合法 `.bak`。地图内容或尺寸变化时，旧文档只能在传入 `acceptImageChange: true` 且文档身份更新后保存。

## 大图资源

地图列表只收录文件名包含“地图”或 `map`（不区分大小写）的 PNG/JPEG/WebP 图片，例如 `世界地图.png`、`WorldMap.jpg`。仅目录名包含关键字的普通图片不会进入地图列表；首次选择目录及刷新列表使用同一筛选规则。

支持静态 PNG、JPEG、WebP，单边上限 16384。切片缓存位于应用缓存目录，以图像 SHA-256 隔离，使用 512 像素 WebP 金字塔。缓存可删除重建；`mapper-resource://` 只允许已准备地图的预览和合法层级、列、行，资源响应不提供任意文件读取。
