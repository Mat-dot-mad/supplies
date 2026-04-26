from datetime import date

from flask import Flask, jsonify, render_template, request

import db

# No auth here on purpose: access is gated by Tailscale on the Pi.
# If we ever want a shared password, the `before_request` pattern
# from /Users/mateusz/Projects/portfolio/app.py drops in cleanly.
app = Flask(__name__)
db.init_db()


# ---- helpers --------------------------------------------------------------

def _parse_int(value, field_name):
    """Return value as int, or raise ValueError with a friendly message."""
    if isinstance(value, bool):  # bool is a subclass of int — reject explicitly
        raise ValueError(f"{field_name} must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field_name} must be an integer")


def _parse_expiry(value):
    """Accept None / empty string / 'YYYY-MM-DD'. Anything else raises."""
    if value in (None, ""):
        return None
    try:
        date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError("expiry_date must be in YYYY-MM-DD format")
    return value


def _bad_request(message):
    return jsonify({"error": message}), 400


# ---- pages ----------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


# ---- API ------------------------------------------------------------------

@app.route("/api/products", methods=["GET"])
def api_list():
    return jsonify(db.list_products())


@app.route("/api/products", methods=["POST"])
def api_create():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    if not name:
        return _bad_request("name is required")
    try:
        quantity = _parse_int(payload.get("quantity", 0), "quantity")
        expiry_date = _parse_expiry(payload.get("expiry_date"))
    except ValueError as e:
        return _bad_request(str(e))
    if quantity < 0:
        return _bad_request("quantity cannot be negative")
    category = (payload.get("category") or "").strip() or None
    product = db.create_product(name, quantity=quantity, category=category, expiry_date=expiry_date)
    return jsonify(product), 201


@app.route("/api/products/<int:product_id>", methods=["PATCH"])
def api_update(product_id):
    payload = request.get_json(silent=True) or {}
    fields = {}
    if "name" in payload:
        name = (payload.get("name") or "").strip()
        if not name:
            return _bad_request("name cannot be empty")
        fields["name"] = name
    if "quantity" in payload:
        try:
            quantity = _parse_int(payload["quantity"], "quantity")
        except ValueError as e:
            return _bad_request(str(e))
        if quantity < 0:
            return _bad_request("quantity cannot be negative")
        fields["quantity"] = quantity
    if "category" in payload:
        category = (payload.get("category") or "").strip()
        fields["category"] = category or None
    if "expiry_date" in payload:
        try:
            fields["expiry_date"] = _parse_expiry(payload["expiry_date"])
        except ValueError as e:
            return _bad_request(str(e))
    updated = db.update_product(product_id, fields)
    if updated is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(updated)


@app.route("/api/products/<int:product_id>/adjust", methods=["POST"])
def api_adjust(product_id):
    payload = request.get_json(silent=True) or {}
    try:
        delta = _parse_int(payload.get("delta"), "delta")
    except ValueError as e:
        return _bad_request(str(e))
    updated = db.adjust_quantity(product_id, delta)
    if updated is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(updated)


@app.route("/api/products/<int:product_id>", methods=["DELETE"])
def api_delete(product_id):
    if not db.delete_product(product_id):
        return jsonify({"error": "not found"}), 404
    return "", 204


if __name__ == "__main__":
    app.run(debug=True, port=8002)
