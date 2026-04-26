// Frontend for Supplies. One file, vanilla JS, no build step.
//
// State model: we keep the latest list of products in `state.products` and
// re-render from it. After most writes we re-fetch — simple and avoids the
// classic "client and server state drifted apart" bug. The +/- buttons are
// the exception: they update the visible number optimistically so the tap
// feels instant, and roll back if the server rejects.

const state = {
  products: [],
  editingId: null,  // null = "Add" mode; otherwise = product id being edited
  search: "",       // current search query, lowercased
};

// Days until expiry triggers the "soon" warning.
const EXPIRY_SOON_DAYS = 14;

function expiryStatus(isoDate) {
  if (!isoDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(isoDate + "T00:00:00");
  const diffDays = Math.round((exp - today) / 86_400_000);
  if (diffDays < 0) return "expired";
  if (diffDays <= EXPIRY_SOON_DAYS) return "soon";
  return "ok";
}

function matchesSearch(product, q) {
  if (!q) return true;
  return (
    product.name.toLowerCase().includes(q) ||
    (product.category || "").toLowerCase().includes(q)
  );
}

// ---- API helpers ----------------------------------------------------------

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body && body.error) msg = body.error;
    } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

async function refresh() {
  state.products = await api("/api/products");
  render();
}

// ---- Rendering ------------------------------------------------------------

function groupByCategory(products) {
  const groups = new Map();
  for (const p of products) {
    const key = p.category || "Uncategorised";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function render() {
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  list.innerHTML = "";

  const visible = state.products.filter((p) => matchesSearch(p, state.search));

  if (visible.length === 0) {
    if (state.search) {
      empty.textContent = `No products match “${state.search}”.`;
    } else {
      empty.textContent = "No products yet — tap “+ Add” to start.";
    }
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }

  for (const [category, items] of groupByCategory(visible)) {
    const group = el("section", { class: "group" },
      el("h2", { class: "group-title" }, category),
    );
    for (const p of items) {
      group.append(renderRow(p));
    }
    list.append(group);
  }
  refreshCategorySuggestions();
}

function renderRow(p) {
  const status = expiryStatus(p.expiry_date);
  return el("article", { class: "row", "data-id": p.id },
    el("button", {
      class: "row-info",
      type: "button",
      "aria-label": `Edit ${p.name}`,
      onclick: () => openForm(p),
    },
      el("div", { class: "name" }, p.name),
      p.expiry_date
        ? el("div", { class: `expiry expiry-${status}` },
            status === "expired" ? `expired ${p.expiry_date}` : `exp. ${p.expiry_date}`)
        : null,
    ),
    el("div", { class: "qty-controls" },
      el("button", {
        class: "qty-btn",
        type: "button",
        "aria-label": "Decrease",
        onclick: () => adjust(p.id, -1),
      }, "−"),
      el("div", { class: "qty", "data-qty": p.id }, String(p.quantity)),
      el("button", {
        class: "qty-btn",
        type: "button",
        "aria-label": "Increase",
        onclick: () => adjust(p.id, +1),
      }, "+"),
    ),
  );
}

// ---- +/- adjust (optimistic) ---------------------------------------------

async function adjust(id, delta) {
  const product = state.products.find((p) => p.id === id);
  if (!product) return;
  const previous = product.quantity;
  const next = Math.max(0, previous + delta);
  if (next === previous) return;  // already at 0, nothing to do

  product.quantity = next;
  const cell = document.querySelector(`[data-qty="${id}"]`);
  if (cell) cell.textContent = String(next);

  try {
    const updated = await api(`/api/products/${id}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta }),
    });
    product.quantity = updated.quantity;
    if (cell) cell.textContent = String(updated.quantity);
  } catch (err) {
    product.quantity = previous;
    if (cell) cell.textContent = String(previous);
    alert(`Could not update: ${err.message}`);
  }
}

// ---- Add / edit dialog ----------------------------------------------------

function openForm(product = null) {
  const dialog = document.getElementById("form-dialog");
  const form = document.getElementById("product-form");
  const title = document.getElementById("form-title");
  const deleteBtn = document.getElementById("form-delete");
  document.getElementById("form-error").hidden = true;

  state.editingId = product ? product.id : null;
  title.textContent = product ? "Edit product" : "Add product";
  form.elements.name.value = product ? product.name : "";
  form.elements.quantity.value = product ? product.quantity : 1;
  form.elements.category.value = product ? (product.category || "") : "";
  form.elements.expiry_date.value = product ? (product.expiry_date || "") : "";
  deleteBtn.hidden = !product;

  dialog.showModal();
  form.elements.name.focus();
}

function closeForm() {
  document.getElementById("form-dialog").close();
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const data = {
    name: form.elements.name.value.trim(),
    quantity: Number(form.elements.quantity.value),
    category: form.elements.category.value.trim() || null,
    expiry_date: form.elements.expiry_date.value || null,
  };
  const errorEl = document.getElementById("form-error");
  errorEl.hidden = true;

  try {
    if (state.editingId == null) {
      await api("/api/products", { method: "POST", body: JSON.stringify(data) });
    } else {
      await api(`/api/products/${state.editingId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
    }
    closeForm();
    await refresh();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

async function handleDelete() {
  if (state.editingId == null) return;
  if (!confirm("Delete this product?")) return;
  try {
    await api(`/api/products/${state.editingId}`, { method: "DELETE" });
    closeForm();
    await refresh();
  } catch (err) {
    const errorEl = document.getElementById("form-error");
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
}

// ---- Category autocomplete ------------------------------------------------

function refreshCategorySuggestions() {
  const datalist = document.getElementById("category-suggestions");
  datalist.innerHTML = "";
  const seen = new Set();
  for (const p of state.products) {
    if (p.category && !seen.has(p.category)) {
      seen.add(p.category);
      datalist.append(el("option", { value: p.category }));
    }
  }
}

// ---- Bootstrap ------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("add-btn").addEventListener("click", () => openForm(null));
  document.getElementById("form-cancel").addEventListener("click", closeForm);
  document.getElementById("form-delete").addEventListener("click", handleDelete);
  document.getElementById("product-form").addEventListener("submit", handleFormSubmit);
  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    render();
  });
  refresh().catch((e) => console.error(e));
});
