import json
import os
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
            if path == "/api/dashboard":
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
                result = ADAPTER.install_protocol(payload)
            elif parsed.path == "/api/uninstall" and method == "POST":
                result = ADAPTER.uninstall_protocol(int(payload["id"]))
            elif parsed.path == "/api/core/update" and method == "POST":
                result = ADAPTER.update_core(payload["name"], payload["target_version"])
            elif parsed.path == "/api/users" and method == "POST":
                result = ADAPTER.create_user(payload)
            elif parsed.path == "/api/users" and method == "DELETE":
                result = ADAPTER.delete_user(int(payload["id"]))
            elif parsed.path == "/api/subscriptions/reset" and method == "POST":
                result = ADAPTER.reset_subscription_uuid(int(payload["id"]))
            elif parsed.path == "/api/routing" and method == "POST":
                result = ADAPTER.add_routing(payload)
            elif parsed.path == "/api/routing" and method == "DELETE":
                result = ADAPTER.delete_routing(int(payload["id"]))
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
