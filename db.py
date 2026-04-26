import os
import sqlite3
from datetime import datetime

# DB lives next to the code locally; on the Pi the systemd unit will set
# DATABASE_PATH=/var/lib/supplies/supplies.db so the data survives redeploys.
DB_PATH = os.environ.get(
    "DATABASE_PATH",
    os.path.join(os.path.dirname(__file__), "supplies.db"),
)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS products (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT    NOT NULL,
                quantity    INTEGER NOT NULL DEFAULT 0,
                category    TEXT,
                expiry_date TEXT,
                created_at  TEXT    NOT NULL,
                updated_at  TEXT    NOT NULL
            );
        """)


def _row_to_dict(row):
    return dict(row) if row is not None else None


def list_products():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT id, name, quantity, category, expiry_date, created_at, updated_at
            FROM products
            ORDER BY COALESCE(category, '') COLLATE NOCASE, name COLLATE NOCASE
        """).fetchall()
        return [dict(r) for r in rows]


def get_product(product_id):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        return _row_to_dict(row)


def create_product(name, quantity=0, category=None, expiry_date=None):
    now = datetime.now().isoformat(timespec="seconds")
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO products (name, quantity, category, expiry_date, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (name, quantity, category, expiry_date, now, now),
        )
        new_id = cur.lastrowid
    return get_product(new_id)


# Allowed fields for PATCH /api/products/<id>. Anything else is ignored
# so a malicious payload can't, e.g., overwrite created_at or id.
UPDATABLE_FIELDS = ("name", "quantity", "category", "expiry_date")


def update_product(product_id, fields):
    clean = {k: v for k, v in fields.items() if k in UPDATABLE_FIELDS}
    if not clean:
        return get_product(product_id)
    set_clause = ", ".join(f"{k} = ?" for k in clean)
    values = list(clean.values()) + [datetime.now().isoformat(timespec="seconds"), product_id]
    with get_db() as conn:
        cur = conn.execute(
            f"UPDATE products SET {set_clause}, updated_at = ? WHERE id = ?",
            values,
        )
        if cur.rowcount == 0:
            return None
    return get_product(product_id)


def adjust_quantity(product_id, delta):
    with get_db() as conn:
        row = conn.execute(
            "SELECT quantity FROM products WHERE id = ?", (product_id,)
        ).fetchone()
        if row is None:
            return None
        new_qty = max(0, row["quantity"] + delta)
        conn.execute(
            "UPDATE products SET quantity = ?, updated_at = ? WHERE id = ?",
            (new_qty, datetime.now().isoformat(timespec="seconds"), product_id),
        )
    return get_product(product_id)


def delete_product(product_id):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM products WHERE id = ?", (product_id,))
        return cur.rowcount > 0
