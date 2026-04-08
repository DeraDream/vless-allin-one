import json
import os
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


class MockAdapter(BaseAdapter):
    def __init__(self, store: PanelStore) -> None:
        self.store = store

    def meta(self) -> Dict[str, Any]:
        return {
            "mode": "mock",
            "platform": os.name,
            "cfg_dir": "",
            "live_capable": False,
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

    def uninstall_protocol(self, protocol_id: int) -> Dict[str, Any]:
        with self.store.connect() as conn:
            row = conn.execute("SELECT name, port FROM protocols WHERE id = ?", (protocol_id,)).fetchone()
            if not row:
                return {"ok": False, "message": "协议不存在"}
            conn.execute("DELETE FROM protocols WHERE id = ?", (protocol_id,))
            self.store.log(conn, "uninstall", f"Removed {row['name']}:{row['port']} in mock mode")
        return {"ok": True, "message": "协议已卸载"}

    def list_core_versions(self) -> List[Dict[str, Any]]:
        with self.store.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM core_versions ORDER BY name").fetchall()]

    def update_core(self, name: str, target_version: str) -> Dict[str, Any]:
        with self.store.connect() as conn:
            conn.execute(
                "UPDATE core_versions SET current_version = ?, latest_version = ?, needs_update = 0 WHERE name = ?",
                (target_version, target_version, name),
            )
            self.store.log(conn, "core-update", f"Updated {name} to {target_version} in mock mode")
        return {"ok": True, "message": f"{name} 已更新到 {target_version}"}

    def list_users(self) -> List[Dict[str, Any]]:
        with self.store.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM users ORDER BY id DESC").fetchall()]

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

    def delete_user(self, user_id: int) -> Dict[str, Any]:
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

    def reset_subscription_uuid(self, sub_id: int) -> Dict[str, Any]:
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

    def delete_routing(self, rule_id: int) -> Dict[str, Any]:
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
        args = [self.bridge, command]
        if payload is not None:
            args.append(json.dumps(payload, ensure_ascii=True))
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
        args = [self.bridge, "install", json.dumps(payload, ensure_ascii=True)]
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

    def meta(self) -> Dict[str, Any]:
        return {
            "mode": "live",
            "platform": os.name,
            "cfg_dir": self.cfg_dir,
            "live_capable": True,
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

    def uninstall_protocol(self, protocol_id: int) -> Dict[str, Any]:
        return self._run("uninstall", {"id": protocol_id})

    def update_core(self, name: str, target_version: str) -> Dict[str, Any]:
        return self._run("core-update", {"name": name, "target_version": target_version})

    def create_user(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._run("user-create", payload)

    def delete_user(self, user_id: int) -> Dict[str, Any]:
        return self._run("user-delete", {"id": user_id})

    def reset_subscription_uuid(self, sub_id: int) -> Dict[str, Any]:
        return self._run("subscription-reset", {"id": sub_id})

    def add_routing(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._run("routing-add", payload)

    def delete_routing(self, rule_id: int) -> Dict[str, Any]:
        return self._run("routing-delete", {"id": rule_id})
