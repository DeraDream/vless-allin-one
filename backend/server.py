import json
import os
import shutil
import threading
import time
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from backend.adapters import LiveAdapter, MockAdapter
from backend.store import PanelStore


ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME_DIR = os.path.join(ROOT_DIR, "runtime")
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "application/javascript; charset=utf-8"),
}


def build_adapter():
    mode = os.environ.get("PANEL_MODE", "mock").lower()
    if mode == "live":
        cfg_dir = os.environ.get("PANEL_CFG", "/etc/vless-reality")
        return LiveAdapter(ROOT_DIR, cfg_dir)
    db_path = os.path.join(RUNTIME_DIR, "panel.db")
    return MockAdapter(PanelStore(db_path))


ADAPTER = build_adapter()


class InstallTaskManager:
    def __init__(self, adapter) -> None:
        self.adapter = adapter
        self._lock = threading.Lock()
        self._cancel_event = threading.Event()
        self._process = None
        self._thread = None
        self._status = self._idle_status()

    def _idle_status(self):
        return {
            "running": False,
            "state": "idle",
            "protocol": "",
            "progress": 0,
            "message": "",
            "error": "",
            "started_at": "",
            "updated_at": "",
            "events": [],
            "can_cancel": False,
        }

    def _now(self) -> str:
        return datetime.utcnow().isoformat(timespec="seconds")

    def _snapshot(self):
        return json.loads(json.dumps(self._status))

    def _append_event(self, text: str, level: str = "info") -> None:
        self._status["events"] = (
            self._status.get("events", [])
            + [{"time": self._now(), "level": level, "text": text}]
        )[-12:]
        self._status["updated_at"] = self._now()

    def _set_progress(self, progress: int, message: str, level: str = "info") -> None:
        self._status["progress"] = max(0, min(100, int(progress)))
        self._status["message"] = message
        self._append_event(message, level=level)

    def status(self):
        with self._lock:
            return self._snapshot()

    def start(self, payload):
        with self._lock:
            if self._status["running"]:
                return {"ok": False, "message": "已有安装任务正在进行，请先取消或等待完成"}

            self._cancel_event = threading.Event()
            self._process = None
            self._status = self._idle_status()
            self._status.update(
                {
                    "running": True,
                    "state": "running",
                    "protocol": payload.get("protocol", ""),
                    "progress": 1,
                    "message": "安装任务已创建",
                    "started_at": self._now(),
                    "updated_at": self._now(),
                    "can_cancel": True,
                }
            )
            self._append_event("安装任务已创建")

            self._thread = threading.Thread(
                target=self._run_install,
                args=(payload,),
                daemon=True,
            )
            self._thread.start()
            snapshot = self._snapshot()

        return {"ok": True, "message": "开始安装", "data": snapshot}

    def cancel(self):
        with self._lock:
            if not self._status["running"]:
                return {"ok": False, "message": "当前没有正在进行的安装任务"}
            self._cancel_event.set()
            self._set_progress(self._status["progress"], "正在取消安装并清理当前文件与缓存", level="warning")
            process = self._process

        if process and process.poll() is None:
            try:
                process.terminate()
            except Exception:
                pass

        return {"ok": True, "message": "已发送取消请求"}

    def _prepare_live_backup(self):
        if not isinstance(self.adapter, LiveAdapter):
            return None

        os.makedirs(RUNTIME_DIR, exist_ok=True)
        backup_dir = os.path.join(RUNTIME_DIR, f"install-backup-{int(time.time() * 1000)}")
        cfg_dir = self.adapter.cfg_dir
        cfg_backup = os.path.join(backup_dir, "cfg")
        os.makedirs(backup_dir, exist_ok=True)
        if os.path.isdir(cfg_dir):
            shutil.copytree(cfg_dir, cfg_backup)
        else:
            with open(os.path.join(backup_dir, "cfg-missing.marker"), "w", encoding="utf-8") as handle:
                handle.write("missing")
        return backup_dir

    def _clear_live_cache(self) -> None:
        shutil.rmtree("/tmp/vless-version-cache", ignore_errors=True)

    def _restore_live_backup(self, backup_dir):
        if not isinstance(self.adapter, LiveAdapter) or not backup_dir or not os.path.isdir(backup_dir):
            return

        cfg_dir = self.adapter.cfg_dir
        cfg_backup = os.path.join(backup_dir, "cfg")
        cfg_missing_marker = os.path.join(backup_dir, "cfg-missing.marker")

        if os.path.isdir(cfg_dir):
            shutil.rmtree(cfg_dir, ignore_errors=True)

        if os.path.isdir(cfg_backup):
            shutil.copytree(cfg_backup, cfg_dir)
        elif os.path.exists(cfg_missing_marker):
            shutil.rmtree(cfg_dir, ignore_errors=True)

        self._clear_live_cache()

        try:
            self.adapter.reload_services()
        except Exception:
            pass

    def _clear_backup(self, backup_dir) -> None:
        if backup_dir and os.path.isdir(backup_dir):
            shutil.rmtree(backup_dir, ignore_errors=True)

    def _finish(self, state: str, message: str, error: str = "", level: str = "info") -> None:
        with self._lock:
            self._status["running"] = False
            self._status["state"] = state
            self._status["message"] = message
            self._status["error"] = error
            self._status["progress"] = 100 if state == "success" else 0
            self._status["can_cancel"] = False
            self._append_event(message, level=level)
            self._process = None

    def _run_mock_install(self, payload) -> None:
        steps = [
            (8, "检查安装参数"),
            (18, "准备本地安装环境"),
            (35, "生成协议配置"),
            (52, "写入本地面板数据"),
            (72, "整理运行信息"),
            (90, "等待安装结果确认"),
        ]
        for progress, message in steps:
            if self._cancel_event.is_set():
                raise RuntimeError("__cancelled__")
            with self._lock:
                self._set_progress(progress, message)
            time.sleep(0.35)

        if self._cancel_event.is_set():
            raise RuntimeError("__cancelled__")

        result = self.adapter.install_protocol(payload)
        if not result.get("ok"):
            raise RuntimeError(result.get("message") or "安装失败")

    def _run_live_install(self, payload, backup_dir) -> None:
        with self._lock:
            self._set_progress(8, "已创建安装前备份")

        process = self.adapter.start_install_process(payload)
        with self._lock:
            self._process = process
            self._set_progress(12, "安装进程已启动")

        last_progress = 12
        while True:
            if self._cancel_event.is_set():
                raise RuntimeError("__cancelled__")

            line = process.stderr.readline() if process.stderr else ""
            if line:
                line = line.strip()
                if line.startswith("__PROGRESS__:"):
                    progress_text = line.split(":", 1)[1].strip()
                    last_progress = min(last_progress + 16, 92)
                    with self._lock:
                        self._set_progress(last_progress, progress_text)
                continue

            if process.poll() is not None:
                break

            time.sleep(0.2)

        stdout = process.stdout.read().strip() if process.stdout else ""
        stderr_rest = process.stderr.read().strip() if process.stderr else ""

        if self._cancel_event.is_set():
            raise RuntimeError("__cancelled__")

        if process.returncode != 0:
            if stdout:
                try:
                    response = json.loads(stdout)
                    raise RuntimeError(response.get("message") or "安装失败")
                except json.JSONDecodeError:
                    pass
            raise RuntimeError(stderr_rest or stdout or "安装失败")

        response = json.loads(stdout or "{}")
        if response.get("ok") is False:
            raise RuntimeError(response.get("message") or "安装失败")

    def _run_install(self, payload) -> None:
        backup_dir = None
        try:
            if isinstance(self.adapter, LiveAdapter):
                backup_dir = self._prepare_live_backup()
                self._run_live_install(payload, backup_dir)
                self._clear_live_cache()
            else:
                self._run_mock_install(payload)

            self._clear_backup(backup_dir)
            self._finish("success", "安装完成")
        except Exception as exc:
            cancelled = str(exc) == "__cancelled__"
            if isinstance(self.adapter, LiveAdapter):
                self._restore_live_backup(backup_dir)
                self._clear_backup(backup_dir)

            if cancelled:
                self._finish("cancelled", "安装已取消，已清理当前安装产生的文件和缓存", level="warning")
            else:
                self._finish(
                    "error",
                    "安装失败，已回滚当前安装并清理缓存与文件",
                    error=str(exc),
                    level="error",
                )


INSTALL_MANAGER = InstallTaskManager(ADAPTER)


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "VlessPanel/0.1"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed.path, parse_qs(parsed.query))
            return
        if parsed.path in STATIC_FILES:
            self.serve_static(parsed.path)
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self):
        self.handle_api_write("POST")

    def do_DELETE(self):
        self.handle_api_write("DELETE")

    def serve_static(self, path: str) -> None:
        rel_path, content_type = STATIC_FILES[path]
        full_path = os.path.join(ROOT_DIR, rel_path)
        try:
            with open(full_path, "rb") as handle:
                payload = handle.read()
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND, "Static file missing")
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_api_get(self, path: str, query) -> None:
        try:
            if path == "/api/meta":
                data = ADAPTER.meta()
            elif path == "/api/dashboard":
                data = ADAPTER.dashboard()
            elif path == "/api/protocols":
                data = ADAPTER.list_protocols()
            elif path == "/api/cores":
                data = ADAPTER.list_core_versions()
            elif path == "/api/users":
                data = ADAPTER.list_users()
            elif path == "/api/subscriptions":
                data = ADAPTER.list_subscriptions()
            elif path == "/api/routing":
                data = ADAPTER.list_routing()
            elif path == "/api/install/status":
                data = INSTALL_MANAGER.status()
            elif path == "/api/logs":
                limit = int((query.get("limit") or ["120"])[0])
                install_status = INSTALL_MANAGER.status()
                install_lines = [
                    {
                        "time": item.get("time", ""),
                        "source": "install-task",
                        "level": item.get("level", "info"),
                        "message": item.get("text", ""),
                    }
                    for item in install_status.get("events", [])
                ]
                data = {
                    "lines": (ADAPTER.read_logs(limit) + install_lines)[-limit:],
                    "install": install_status,
                }
            else:
                self.send_error(HTTPStatus.NOT_FOUND, "API not found")
                return
        except Exception as exc:
            self.respond_json({"ok": False, "message": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self.respond_json({"ok": True, "data": data})

    def handle_api_write(self, method: str) -> None:
        parsed = urlparse(self.path)
        try:
            payload = self.read_json()
            if parsed.path == "/api/install" and method == "POST":
                result = INSTALL_MANAGER.start(payload)
            elif parsed.path == "/api/install/cancel" and method == "POST":
                result = INSTALL_MANAGER.cancel()
            elif parsed.path == "/api/uninstall" and method == "POST":
                result = ADAPTER.uninstall_protocol(payload["id"])
            elif parsed.path == "/api/core/update" and method == "POST":
                result = ADAPTER.update_core(
                    payload["name"],
                    payload["target_version"],
                    payload.get("channel", "stable"),
                )
            elif parsed.path == "/api/core/uninstall" and method == "POST":
                result = ADAPTER.uninstall_core(payload["name"])
            elif parsed.path == "/api/users" and method == "POST":
                result = ADAPTER.create_user(payload)
            elif parsed.path == "/api/users" and method == "DELETE":
                result = ADAPTER.delete_user(payload["id"])
            elif parsed.path == "/api/subscriptions/reset" and method == "POST":
                result = ADAPTER.reset_subscription_uuid(int(payload["id"]))
            elif parsed.path == "/api/subscriptions/update" and method == "POST":
                result = ADAPTER.update_subscription(payload)
            elif parsed.path == "/api/routing" and method == "POST":
                result = ADAPTER.add_routing(payload)
            elif parsed.path == "/api/routing" and method == "DELETE":
                result = ADAPTER.delete_routing(payload["id"])
            else:
                self.send_error(HTTPStatus.NOT_FOUND, "API write endpoint not found")
                return
        except Exception as exc:
            self.respond_json({"ok": False, "message": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        status = HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST
        self.respond_json(result, status=status)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(body.decode("utf-8") or "{}")

    def respond_json(self, payload, status=HTTPStatus.OK) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, format, *args):
        return


def main():
    host = os.environ.get("PANEL_HOST", "127.0.0.1")
    port = int(os.environ.get("PANEL_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), RequestHandler)
    print(f"VLESS panel running on http://{host}:{port} (mode={os.environ.get('PANEL_MODE', 'mock')})")
    server.serve_forever()


if __name__ == "__main__":
    main()
