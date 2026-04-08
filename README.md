# VLESS Server Panel

这个仓库现在包含两部分：

- 原始服务端脚本：`vless-server.sh`
- 一个可本地联调的无登录 GUI 面板

## 1. Windows 本地测试

本地联调建议先使用 `mock` 模式，这样不用依赖 Linux、Bash 4+ 或真实服务器环境。

### 前置条件

- 安装 Python 3.8+
- 安装时勾选 `Add python to PATH`

### 启动方式

PowerShell:

```powershell
.\run_local.ps1
```

CMD:

```bat
run_local.bat
```

Shell:

```bash
chmod +x run_local.sh
./run_local.sh
```

启动后访问 [http://127.0.0.1:8765](http://127.0.0.1:8765)。

### Mock 模式说明

- 页面按钮会调用本地 Python API
- 数据存放在 `runtime/panel.db`
- 适合先联调前端和管理流程
- 安装、卸载、用户、订阅、分流都会直接写入本地 mock 数据

## 2. Linux 服务器部署

正式部署时切换到 `live` 模式，让面板连接 `vless-server.sh`。

### 本地脚本方式

```bash
PANEL_MODE=live PANEL_CFG=/etc/vless-reality ./run_local.sh
```

说明：

- `live` 模式依赖 Linux VPS 上的 Bash 4+
- Windows 本机不适合直接跑 `live`
- 建议先在 Windows 跑通 Mock，再把同一套 GUI 部署到 Linux

## 3. 一键部署到 Linux VPS

```bash
chmod +x deploy_vps.sh
./deploy_vps.sh root@your-vps /opt/vless-server-panel
```

如果仓库已经推到 GitHub，也可以直接在 VPS 执行：

```bash
wget -O install.sh https://raw.githubusercontent.com/DeraDream/vless-allin-one/main/install.sh && chmod +x install.sh && ./install.sh
```

或：

```bash
curl -fsSL https://raw.githubusercontent.com/DeraDream/vless-allin-one/main/install.sh -o install.sh && chmod +x install.sh && ./install.sh
```

默认安装行为：

- 拉取仓库到 `/opt/vless-allin-one`
- 使用 `systemd` 注册服务 `vless-allin-one`
- 以 `live` 模式启动面板
- 默认监听 `0.0.0.0:8765`

可选环境变量：

```bash
INSTALL_DIR=/opt/vless-allin-one \
SERVICE_NAME=vless-allin-one \
PANEL_PORT=8765 \
PANEL_HOST=0.0.0.0 \
PANEL_MODE=live \
PANEL_CFG=/etc/vless-reality \
REPO_BRANCH=main \
REQUIRE_NODE=true \
bash install.sh
```

## 4. 当前已接通的 GUI 操作

- 安装协议
- 卸载协议
- 核心更新
- 新增 / 删除用户
- 保存订阅设置
- 重置订阅 UUID
- 新增 / 删除分流规则

## 5. 推荐测试顺序

1. 在 Windows 运行 `.\run_local.ps1`
2. 打开面板确认首页能加载统计数据
3. 测试安装协议、创建用户、保存订阅、添加分流
4. 确认 `runtime/panel.db` 数据变化正常
5. 再部署到 Linux，切换 `PANEL_MODE=live`
