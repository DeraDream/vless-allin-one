import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta


class PanelStore:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._init_db()

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _init_db(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS protocols (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    core TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    service TEXT NOT NULL,
                    status TEXT NOT NULL,
                    config_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS core_versions (
                    name TEXT PRIMARY KEY,
                    current_version TEXT NOT NULL,
                    latest_version TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    needs_update INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    protocol TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    used_gb REAL NOT NULL,
                    quota_gb REAL NOT NULL,
                    expire_at TEXT NOT NULL,
                    status TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS subscriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    sub_uuid TEXT NOT NULL UNIQUE,
                    default_format TEXT NOT NULL,
                    base_url TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS routing_rules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    rule_type TEXT NOT NULL,
                    target TEXT NOT NULL,
                    outbound TEXT NOT NULL,
                    ip_strategy TEXT NOT NULL,
                    priority INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS activity_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )
            self._seed_if_empty(conn)

    def _seed_if_empty(self, conn: sqlite3.Connection) -> None:
        count = conn.execute("SELECT COUNT(*) FROM protocols").fetchone()[0]
        if count:
            return

        now = datetime.utcnow().isoformat(timespec="seconds")
        protocols = [
            ("vless", "Xray", 443, "vless-reality", "running", {"sni": "gateway.example.com", "transport": "reality"}, now),
            ("trojan", "Xray", 8443, "vless-reality", "running", {"sni": "edge.example.com", "transport": "tls"}, now),
            ("hy2", "Sing-box", 9443, "vless-singbox", "running", {"sni": "hy2.example.com", "transport": "quic"}, now),
        ]
        conn.executemany(
            """
            INSERT INTO protocols (name, core, port, service, status, config_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [(p[0], p[1], p[2], p[3], p[4], json.dumps(p[5], ensure_ascii=True), p[6]) for p in protocols],
        )

        conn.executemany(
            """
            INSERT INTO core_versions (name, current_version, latest_version, channel, needs_update)
            VALUES (?, ?, ?, ?, ?)
            """,
            [
                ("Xray", "v1.8.24", "v1.8.25", "stable", 1),
                ("Sing-box", "v1.11.8", "v1.11.8", "stable", 0),
                ("Snell v5", "v5.0.0", "v5.0.1", "manual", 1),
            ],
        )

        users = [
            ("alice", "vless", 443, 38.2, 100.0, (datetime.utcnow() + timedelta(days=6)).date().isoformat(), "enabled"),
            ("bob", "hy2", 9443, 96.4, 100.0, (datetime.utcnow() + timedelta(days=1)).date().isoformat(), "warning"),
            ("carol", "trojan", 8443, 110.0, 100.0, (datetime.utcnow() - timedelta(days=2)).date().isoformat(), "disabled"),
        ]
        conn.executemany(
            """
            INSERT INTO users (username, protocol, port, used_gb, quota_gb, expire_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            users,
        )

        sub_uuid = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO subscriptions (name, sub_uuid, default_format, base_url, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("Main Server Bundle", sub_uuid, "v2ray", "https://panel.example.com/sub", now),
        )

        rules = [
            ("domain", "openai.com", "warp", "prefer_ipv4", 10),
            ("ip_cidr", "8.8.8.8/32", "direct", "as_is", 20),
            ("geosite", "netflix", "chain:us-west", "prefer_ipv6", 30),
        ]
        conn.executemany(
            """
            INSERT INTO routing_rules (rule_type, target, outbound, ip_strategy, priority)
            VALUES (?, ?, ?, ?, ?)
            """,
            rules,
        )

        self.log(conn, "seed", "Initialized local mock panel data")

    def log(self, conn: sqlite3.Connection, action: str, detail: str) -> None:
        conn.execute(
            "INSERT INTO activity_logs (action, detail, created_at) VALUES (?, ?, ?)",
            (action, detail, datetime.utcnow().isoformat(timespec="seconds")),
        )

