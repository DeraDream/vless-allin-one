# VLESS All-in-One Panel

这个项目现在以 Linux 线上部署为主，提供：

- 原始服务端脚本：`vless-server.sh`
- Web 管理面板：`python3 -m backend.server`
- 一键安装脚本：`install.sh`

## 一键安装

直接在 Linux 服务器执行：

```bash
wget -O install.sh https://raw.githubusercontent.com/DeraDream/vless-allin-one/main/install.sh && chmod +x install.sh && bash install.sh
```

或者：

```bash
curl -fsSL https://raw.githubusercontent.com/DeraDream/vless-allin-one/main/install.sh -o install.sh && chmod +x install.sh && bash install.sh
```

安装脚本默认行为：

- 安装目录：`/opt/vless-allin-one`
- 运行模式：`live`
- 监听地址：`0.0.0.0`
- Web 面板端口：如果未指定，会自动随机分配一个 `20000-40000` 之间的端口
- systemd 服务名：`vless-allin-one`

安装完成后，脚本会直接打印访问地址，例如：

```text
面板地址: http://your-server-ip:27843
```

同时会写入命令：

```bash
vless
```

安装完成后可直接用它打开命令行菜单，执行：

- 打开原脚本主菜单
- 查看面板状态
- 重启 / 停止 / 启动面板
- 查看实时日志
- 更新项目
- 卸载面板

## 可选安装参数

如果你想手动指定参数，可以这样：

```bash
INSTALL_DIR=/opt/vless-allin-one \
SERVICE_NAME=vless-allin-one \
PANEL_PORT=27843 \
PANEL_HOST=0.0.0.0 \
PANEL_MODE=live \
PANEL_CFG=/etc/vless-reality \
REPO_BRANCH=main \
REQUIRE_NODE=false \
bash install.sh
```

说明：

- `PANEL_PORT` 不填时会自动随机生成
- `REQUIRE_NODE=false` 是默认值，当前项目运行不依赖 Node
- `PANEL_CFG` 应指向 `vless-server.sh` 的实际配置目录

## 常用命令

查看服务状态：

```bash
systemctl status vless-allin-one
```

重启服务：

```bash
systemctl restart vless-allin-one
```

查看运行日志：

```bash
journalctl -u vless-allin-one -f
```

## 当前已接通的面板操作

- 安装协议
- 卸载协议
- 更新核心
- 新增用户
- 删除用户
- 保存订阅设置
- 重置订阅 UUID
- 新增分流规则
- 删除分流规则

## 部署说明

- 当前项目已按 Linux `live` 模式调整
- 协议卸载、用户删除、分流删除已兼容脚本数据库里的复合 ID
- 安装脚本已去掉默认的 Node 强依赖，避免阻塞部署

如果面板无法访问，请检查：

1. 服务器安全组或防火墙是否放行安装完成时打印的面板端口
2. `systemctl status vless-allin-one` 是否正常
3. `journalctl -u vless-allin-one -f` 是否有报错
4. `PANEL_CFG` 是否指向正确的配置目录
