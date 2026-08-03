/**
 * Servidor de red local para Sistema de Inventario
 * --------------------------------------------------
 * Expone la base de datos (db.json) a todas las computadoras
 * de la red local a través del puerto 3000.
 *
 * Endpoints:
 *   GET  /api/db  → devuelve toda la base de datos
 *   PUT  /api/db  → reemplaza toda la base de datos
 *   GET  /        → sirve la aplicación web (index.html)
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = 3000;
const DB_PATH = path.join(__dirname, "db.json");
// La carpeta raíz del proyecto está un nivel arriba de /backend
const STATIC_ROOT = path.join(__dirname, "..");

// ── Utilidades ────────────────────────────────────────────────
function leerDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function escribirDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function obtenerIPLocal() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

// ── Express ───────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Archivos estáticos del proyecto (index.html, script.js, styles.css, assets/)
app.use(express.static(STATIC_ROOT));

// GET /api/db → devuelve toda la base de datos
app.get("/api/db", (req, res) => {
  const data = leerDB();
  if (!data) {
    return res.status(500).json({ error: "No se pudo leer la base de datos" });
  }
  res.json(data);
});

// PUT /api/db → reemplaza toda la base de datos
app.put("/api/db", (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== "object") {
      return res.status(400).json({ error: "Datos inválidos" });
    }
    escribirDB(data);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error guardando DB:", err);
    res.status(500).json({ error: "No se pudo guardar la base de datos" });
  }
});

// Cualquier otra ruta → sirve index.html (SPA fallback)
app.get("*", (req, res) => {
  res.sendFile(path.join(STATIC_ROOT, "index.html"));
});

// ── Inicio ────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  const ip = obtenerIPLocal();
  console.log("═══════════════════════════════════════════════════");
  console.log("  SISTEMA DE INVENTARIO — Servidor de Red Local");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Esta PC:      http://localhost:${PORT}`);
  console.log(`  Otras PCs:    http://${ip}:${PORT}`);
  console.log("───────────────────────────────────────────────────");
  console.log("  Base de datos: backend/db.json");
  console.log("  Para detener:  Ctrl + C");
  console.log("═══════════════════════════════════════════════════");
});
