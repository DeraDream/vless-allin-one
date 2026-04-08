import base64
import json
import os
import glob
import subprocess
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from .store import PanelStore


class BaseAdapter:
    def meta(self) -> Dict[str, Any]:
        raise NotImplementedError

    def dashboard(self) -> Dict[str, Any]:
        raise NotImplementedError

    def start_install_process(self, payload: Dict[str, Any]):
        raise NotImplementedError

    def reload_services(self) -> None:
        return None

    def read_logs(self, limit: int = 120) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def uninstall_core(self, name: str) -> Dict[str, Any]:
        raise NotImplementedError


class MockAdapter(BaseAdapter):
    def __init__(self, store: PanelStore) -> None:
        self.store = store

    def meta(self) -> Dict[str, Any]:
        return {
            "mode": "mock",
            "platform": os.name,
            "cfg_dir": "",
            "live_capable": False,
            "user_routing_options": [
                {"value": "", "label": "全局规则"},
                {"value": "direct", "label": "直连"},
            ],
        }

    def dashboard(self) -> Dict[str, Any]:
        with self.store.connect() as conn:
            installed = conn.execute("SELECT COUNT(*) FROM protocols").fetchone()[0]
            users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            expiring = conn.execute(
                "SELECT COUNT(*) FROM users WHERE status IN ('warning', 'disabled')"
            ).fetchone()[0]
            routes = conn.execute("SELECT COUNT(*) FROM routing_rules").fetchone()[0]
            recent_logs = [
                dict(row)
                for row in conn.execute(
                    "SELECT action, detail, created_at FROM activity_logs ORDER BY id DESC LIMIT 6"
                ).fetchall()
            ]
            return {
                "stats": {
                    "installed": installed,
                    "users": users,
                    "expiring": expiring,
                    "routes": routes,
                },
                "logs": recent_logs,
            }

    def read_logs(self, limit: int = 120) -> List[Dict[str, Any]]:
        with self.store.connect() as conn:
            rows = conn.execute(
                "SELECT action, detail, created_at FROM activity_logs ORDER BY id DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        return [
            {
                "time": row["created_at"],
                "source": "mock",
                "level": "info",
                "message": f"{row['action']}: {row['detail']}",
            }
            for row in reversed(rows)
        ]

    def start_install_process(self, payload: Dict[str, Any]):
        raise RuntimeError("mock mode does not use subprocess install")

    def list_protocols(self) -> List[Dict[str, Any]]:
        with self.store.connect() as conn:
            rows = conn.execute(
                "SELECT id, name, core, port, service, status, config_json, created_at FROM protocols ORDER BY id DESC"
            ).fetchall()
            return [{**dict(row), "config": json.loads(row["config_json"])} for row in rows]

    def install_protocol(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        now = datetime.utcnow().isoformat(timespec="seconds")
        protocol = payload["protocol"]
        core = payload["core"]
        port = int(payload["port"])
        service = "vless-reality" if core == "Xray" else "vless-singbox"
        config = {
            "domain": payload.get("domain", ""),
            "cert_mode": payload.get("cert_mode", "acme"),
            "transport": payload.get("transport", ""),
            "short_id": payload.get("short_id", ""),
            "server_name": payload.get("server_name", ""),
            "notes": payload.get("notes", ""),
        }
        with self.store.connect() as conn:
            conn.execute(
                """
                INSERT INTO protocols (name, core, port, service, status, config_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (protocol, core, port, service, "running", json.dumps(config, ensure_ascii=True), now),
            )
            self.store.log(conn, "install", f"Installed {protocol} on port {port} in mock mode")
        return {"ok": True, "message": f"{protocol} 已加入本地面板数据"}

    def uninstall_protocol(self, protocol_id: Any) -> Dict[str, Any]:
        protocol_id = int(protocol_id)
        with self.store.connect() as conn:
            row = conn.execute("SELECT name, port FROM protocols WHERE id = ?", (protocol_id,)).fetchone()
            if not row:
                return {"ok": False, "message": "协议不存在"}
            conn.execute("DELETE FROM protocols WHERE id = ?", (protocol_id,))
            self.store.log(conn, "uninstall", f"Removed {row['name']}:{row['port']} in mock mode")
        return {"ok": True, "message": "协议已卸载"}

    def list_core_versions(self) -> List[Dict[str, Any]]:
        with self.store.connect() as conn:
            rows = [dict(row) for row in conn.execute("SELECT * FROM core_versions ORDER BY name").fetchall()]
        for row in rows:
            current = str(row.get("current_version", "unknown")).lstrip("v")
            stable = str(row.get("latest_version", "unknown")).lstrip("v")
            beta = stable if row["name"] == "Snell v5" else f"{stable}-beta.1" if stable not in ("unknown", "获取中...") else stable
            row["stable_version"] = stable
            row["beta_version"] = beta
            row["latest_version"] = stable
            row["channel"] = row.get("channel") or "stable"
            row["needs_update"] = int(current != stable and stable not in ("unknown", "获取中..."))
        return rows

    def update_core(self, name: str, target_version: str, channel: str = "stable") -> Dict[str, Any]:
        with self.store.connect() as conn:
            conn.execute(
                "UPDATE core_versions SET current_version = ?, latest_version = ?, channel = ?, needs_update = 0 WHERE name = ?",
                (target_version, target_version, channel, name),
            )
            self.store.log(conn, "core-update", f"Updated {name} to {target_version} ({channel}) in mock mode")
        return {"ok": True, "message": f"{name} 已更新到 {target_version}"}

    def uninstall_core(self, name: str) -> Dict[str, Any]:
        with self.store.connect() as conn:
            core_name = "Sing-box" if name == "Sing-box" else name
            protocol_count = conn.execute("SELECT COUNT(*) FROM protocols WHERE core = ?", (core_name,)).fetchone()[0]
            if protocol_count:
                return {"ok": False, "message": f"{name} 仍有已安装协议，请先卸载协议"}
            conn.execute(
                "UPDATE core_versions SET current_version = '未安装', needs_update = 0 WHERE name = ?",
                (name,),
            )
            self.store.log(conn, "core-uninstall", f"Uninstalled {name} in mock mode")
        return {"ok": True, "message": f"{name} 已卸载"}

    def list_users(self) -> List[Dict[str, Any]]:
        with self.store.connect() as conn:
            rows = [dict(row) for row in conn.execute("SELECT * FROM users ORDER BY id DESC").fetchall()]
        for row in rows:
            row.setdefault("routing", "")
            row.setdefault("routing_label", "全局规则")
        return rows

    def create_user(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.store.connect() as conn:
            conn.execute(
                """
                INSERT INTO users (username, protocol, port, used_gb, quota_gb, expire_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload["username"],
                    payload["protocol"],
                    int(payload["port"]),
                    float(payload.get("used_gb", 0)),
                    float(payload.get("quota_gb", 100)),
                    payload["expire_at"],
                    payload.get("status", "enabled"),
                ),
            )
            self.store.log(conn, "user-create", f"Created user {payload['username']} in mock mode")
        return {"ok": True, "message": "用户已创建"}

    def delete_user(self, user_id: Any) -> Dict[str, Any]:
        user_id = int(user_id)
        with self.store.connect() as conn:
            row = conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return {"ok": False, "message": "用户不存在"}
            conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
            self.store.log(conn, "user-delete", f"Deleted user {row['username']} in mock mode")
        return {"ok": True, "message": "用户已删除"}

    def list_subscriptions(self) -> List[Dict[str, Any]]:
        with self.store.connect() as conn:
            rows = [dict(row) for row in conn.execute("SELECT * FROM subscriptions ORDER BY id DESC").fetchall()]
        for row in rows:
            base = row["base_url"].rstrip("/")
            token = row["sub_uuid"]
            row["links"] = {
                "v2ray": f"{base}/{token}/v2ray",
                "clash": f"{base}/{token}/clash",
                "surge": f"{base}/{token}/surge",
            }
        return rows

    def update_subscription(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.store.connect() as conn:
            conn.execute(
                """
                UPDATE subscriptions
                SET name = ?, default_format = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    payload["name"],
                    payload["default_format"],
                    datetime.utcnow().isoformat(timespec="seconds"),
                    int(payload["id"]),
                ),
            )
            self.store.log(conn, "subscription-update", f"Updated subscription {payload['id']} in mock mode")
        return {"ok": True, "message": "订阅设置已保存"}

    def reset_subscription_uuid(self, sub_id: Any) -> Dict[str, Any]:
        sub_id = int(sub_id)
        new_uuid = str(uuid.uuid4())
        with self.store.connect() as conn:
            conn.execute(
                "UPDATE subscriptions SET sub_uuid = ?, updated_at = ? WHERE id = ?",
                (new_uuid, datetime.utcnow().isoformat(timespec="seconds"), sub_id),
            )
            self.store.log(conn, "subscription-reset", f"Reset subscription {sub_id} uuid in mock mode")
        return {"ok": True, "message": "订阅 UUID 已重置"}

    def list_routing(self) -> List[Dict[str, Any]]:
        with self.store.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM routing_rules ORDER BY priority ASC").fetchall()]

    def add_routing(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.store.connect() as conn:
            conn.execute(
                """
                INSERT INTO routing_rules (rule_type, target, outbound, ip_strategy, priority)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    payload["rule_type"],
                    payload["target"],
                    payload["outbound"],
                    payload["ip_strategy"],
                    int(payload["priority"]),
                ),
            )
            self.store.log(conn, "routing-add", f"Added route {payload['rule_type']}:{payload['target']} in mock mode")
        return {"ok": True, "message": "分流规则已添加"}

    def delete_routing(self, rule_id: Any) -> Dict[str, Any]:
        rule_id = int(rule_id)
        with self.store.connect() as conn:
            conn.execute("DELETE FROM routing_rules WHERE id = ?", (rule_id,))
            self.store.log(conn, "routing-delete", f"Deleted route {rule_id} in mock mode")
        return {"ok": True, "message": "分流规则已删除"}


class LiveAdapter(BaseAdapter):
    def __init__(self, root_dir: str, cfg_dir: str) -> None:
        self.root_dir = root_dir
        self.cfg_dir = cfg_dir
        self.bridge = os.path.join(root_dir, "backend", "shell", "vless_panel_bridge.sh")

    def _run(self, command: str, payload: Optional[Dict[str, Any]] = None) -> Any:
        env = os.environ.copy()
        env["VLESS_CFG"] = self.cfg_dir
        env.pop("PANEL_PAYLOAD", None)
        env.pop("PANEL_PAYLOAD_B64", None)
        args = [self.bridge, command]
        if payload is not None:
            raw = json.dumps(payload, ensure_ascii=True).encode("utf-8")
            env["PANEL_PAYLOAD_B64"] = base64.b64encode(raw).decode("ascii")
        proc = subprocess.run(
            args,
            cwd=self.root_dir,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            stdout = (proc.stdout or "").strip()
            if stdout:
                try:
                    error_payload = json.loads(stdout)
                    raise RuntimeError(error_payload.get("message") or f"{command} failed")
                except json.JSONDecodeError:
                    pass
            raise RuntimeError(proc.stderr.strip() or stdout or f"{command} failed")
        return json.loads(proc.stdout or "{}")

    def start_install_process(self, payload: Dict[str, Any]):
        env = os.environ.copy()
        env["VLESS_CFG"] = self.cfg_dir
        env.pop("PANEL_PAYLOAD", None)
        raw = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        env["PANEL_PAYLOAD_B64"] = base64.b64encode(raw).decode("ascii")
        args = [self.bridge, "install"]
        return subprocess.Popen(
            args,
            cwd=self.root_dir,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def reload_services(self) -> None:
        self._run("reload-services")

    def read_logs(self, limit: int = 120) -> List[Dict[str, Any]]:
        service_name = os.environ.get("PANEL_SERVICE", "vless-allin-one")
        services = [service_name, "vless-reality", "vless-singbox", "vless-snell-v5"]
        args = ["journalctl", "--no-pager", "-n", str(int(limit)), "-o", "short-iso"]
        for service in services:
            args.extend(["-u", service])
        proc = subprocess.run(
            args,
            cwd=self.root_dir,
            env=os.environ.copy(),
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            journal_lines = [
                {
                    "time": "",
                    "source": "system",
                    "level": "error",
                    "message": proc.stderr.strip() or "journalctl 日志读取失败",
                }
            ]
        else:
            journal_lines = []
            for raw in (proc.stdout or "").splitlines():
                line = raw.strip()
                if not line:
                    continue
                parts = line.split()
                timestamp = " ".join(parts[:2]) if len(parts) >= 2 else ""
                source = parts[2] if len(parts) >= 3 else "server"
                message = " ".join(parts[4:]) if len(parts) >= 5 else line
                level = "error" if "error" in line.lower() or "failed" in line.lower() else "info"
                journal_lines.append({"time": timestamp, "source": source, "level": level, "message": message})

        file_lines: List[Dict[str, Any]] = []
        for path in glob.glob("/var/log/vless/*.log"):
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as handle:
                    tail = handle.readlines()[-40:]
            except OSError:
                continue
            source = os.path.basename(path)
            for raw in tail:
                line = raw.strip()
                if not line:
                    continue
                level = "error" if "error" in line.lower() or "failed" in line.lower() else "info"
                file_lines.append({"time": "", "source": source, "level": level, "message": line})
        lines = []
        for item in journal_lines + file_lines:
            source = str(item.get("source", "")).lower()
            message = str(item.get("message", "")).lower()
            if source == "install-task" or source.startswith("install-progress"):
                continue
            if "__progress__" in message:
                continue
            lines.append(item)

        return lines[-int(limit):]

    def meta(self) -> Dict[str, Any]:
        routing_options = [
            {"value": "", "label": "全局规则"},
            {"value": "direct", "label": "直连"},
        ]
        try:
            result = self._run("user-routing-options")
            if isinstance(result, list) and result:
                routing_options = result
        except Exception:
            pass
        return {
            "mode": "live",
            "platform": os.name,
            "cfg_dir": self.cfg_dir,
            "live_capable": True,
            "user_routing_options": routing_options,
        }

    def dashboard(self) -> Dict[str, Any]:
        return self._run("dashboard")

    def list_protocols(self) -> List[Dict[str, Any]]:
        return self._run("protocols")

    def list_core_versions(self) -> List[Dict[str, Any]]:
        return self._run("cores")

    def list_users(self) -> List[Dict[str, Any]]:
        return self._run("users")

    def list_subscriptions(self) -> List[Dict[str, Any]]:
        return self._run("subscriptions")

    def update_subscription(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._run("subscription-update", payload)

    def list_routing(self) -> List[Dict[str, Any]]:
        return self._run("routing")

    def install_protocol(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._run("install", payload)

    def uninstall_protocol(self, protocol_id: Any) -> Dict[str, Any]:
        return self._run("uninstall", {"id": protocol_id})

    def update_core(self, name: str, target_version: str, channel: str = "stable") -> Dict[str, Any]:
        return self._run("core-update", {"name": name, "target_version": target_version, "channel": channel})

    def uninstall_core(self, name: str) -> Dict[str, Any]:
        return self._run("core-uninstall", {"name": name})

    def create_user(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._run("user-create", payload)

    def delete_user(self, user_id: Any) -> Dict[str, Any]:
        return self._run("user-delete", {"id": user_id})

    def reset_subscription_uuid(self, sub_id: Any) -> Dict[str, Any]:
        return self._run("subscription-reset", {"id": sub_id})

    def add_routing(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._run("routing-add", payload)

    def delete_routing(self, rule_id: Any) -> Dict[str, Any]:
        return self._run("routing-delete", {"id": rule_id})
