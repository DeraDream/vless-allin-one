# VLESS Server Panel

本仓库现在包含两部分：

- 原始服务端脚本 [`vless-server.sh`](/Users/dfw/Desktop/vless-seriver/vless-server.sh)
- 一个可本地测试的无登录 GUI 面板

## 本地运行

```bash
chmod +x run_local.sh
./run_local.sh
```

然后访问 [http://127.0.0.1:8765](http://127.0.0.1:8765)。

默认是 `mock` 模式：

- 页面按钮会调用本地 Python API
- 数据存放在 `runtime/panel.db`
- 适合先联调前端和管理流程

## Live 模式

部署到 VPS 后可以切换：

```bash
PANEL_MODE=live PANEL_CFG=/etc/vless-reality ./run_local.sh
```

当前 `live` 模式已经接入这些读取能力：

- 仪表盘概览
- 协议列表
- 用户列表
- 订阅信息
- 分流规则

当前 `live` 模式也已接入这些写入能力：

- 安装协议
- 卸载协议
- 核心更新
- 用户增删
- 订阅 UUID 重置
- 分流规则增删

注意：

- `live` 模式依赖 Linux VPS 上的 Bash 4+，不适合直接在 macOS 自带 Bash 3.2 上运行
- 本地联调建议继续使用 `mock` 模式
- `TUIC` 多用户仍受原脚本能力限制，面板里会给出提示

## 部署到 VPS

```bash
chmod +x deploy_vps.sh
./deploy_vps.sh root@your-vps /opt/vless-server-panel
```
