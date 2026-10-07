const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = path.join(__dirname, "..", "data", "db.json");

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function seed() {
  const now = new Date().toISOString();
  return {
    users: [
      {
        id: "u-admin",
        usuario: "admin",
        nombre: "Administrador",
        password: hashPassword("Admin2026!"),
        rol: "administrador",
        activo: true,
        creadoPor: null,
        creadoEn: now
      }
    ],
    autorizaciones: [
      {
        id: "aut-sol-88881",
        solicitud: "SOL-88881",
        placa: "EMP107",
        nombre: "José Luis Vargas Gallego",
        cedula: "80.727.409",
        fecha: "2026-10-08",
        horaInicio: "07:00",
        horaFin: "13:00",
        asunto: "Apoyo logístico de Eventos",
        solicitante: "Andrea Ballesteros",
        usuarioSolicitud: "Georgina Ballesteros Hernandez",
        servicio: "Servicios Administrativos",
        categoria: "Logística de eventos",
        subcategoria: "Parqueaderos",
        programa: "Programa de Optometría",
        cargo: "Auxiliar Administrativa",
        detalle: "Autorización de ingreso del vehículo el jueves 8 de octubre de 2026, de 7:00 a. m. a 1:00 p. m.",
        origen: "SOL-88881 Mesa Única de Servicio",
        creadoEn: now
      }
    ],
    registros: [],
    sesiones: []
  };
}

async function kv(command) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  if (!res.ok) throw new Error("No se pudo usar la base Upstash");
  const data = await res.json();
  return data.result;
}

async function readDb() {
  const remote = await kv(["GET", "control-parqueaderos"]);
  if (remote) {
    try { return JSON.parse(remote); } catch (e) { /* sigue */ }
  }
  if (fs.existsSync(FILE)) {
    try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { /* sigue */ }
  }
  const fresh = seed();
  await writeDb(fresh);
  return fresh;
}

async function writeDb(db) {
  const saved = await kv(["SET", "control-parqueaderos", JSON.stringify(db)]);
  if (saved !== null && (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)) return db;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    // En Vercel el disco no persiste. Sin Upstash los datos viven solo en esta instancia.
  }
  return db;
}

function publicUser(u) {
  return {
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.rol,
    activo: u.activo,
    estado: u.activo ? "autorizado" : "pendiente",
    creadoPor: u.creadoPor || null,
    foto: u.foto || ""
  };
}

module.exports = { hashPassword, seed, readDb, writeDb, publicUser };
