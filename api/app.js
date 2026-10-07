const crypto = require("crypto");
const { hashPassword, readDb, writeDb, publicUser } = require("./store");

function id(prefix) {
  return prefix + "-" + crypto.randomBytes(4).toString("hex");
}

function normPlaca(v) {
  return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

async function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch (e) { return {}; }
}

function pathOf(req) {
  const raw = req.url || "/";
  const q = raw.split("?")[1] || "";
  const ruta = new URLSearchParams(q).get("ruta");
  if (ruta) return (ruta.split("?")[0] || "/");
  const path = raw.split("?")[0].replace(/\/+$/, "") || "/";
  return path.replace(/^\/api\/app/, "").replace(/^\/api/, "") || "/";
}

async function userFrom(db, req) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const ses = db.sesiones.find(s => s.token === token && s.expira > Date.now());
  if (!ses) return null;
  return db.users.find(u => u.id === ses.userId && u.activo) || null;
}

function parseAutorizacion(texto) {
  const t = String(texto || "");
  const pick = (re) => {
    const m = t.match(re);
    return m ? m[1].trim() : "";
  };
  const placa = normPlaca(pick(/placa\s*:\s*([A-Za-z0-9\-]{4,8})/i));
  const nombre = pick(/nombre\s*:\s*(.+)/i);
  const cedula = pick(/c[eé]dula\s*:\s*([0-9.\s]+)/i).replace(/\s+/g, "");
  const solicitud = (t.match(/SOL-\d+/i) || [""])[0].toUpperCase();
  const meses = { enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12" };
  let fecha = "";
  const mf = t.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)/i);
  if (mf && meses[mf[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")]) {
    const year = (t.match(/20\d{2}/) || ["2026"])[0];
    fecha = `${year}-${meses[mf[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")]}-${String(mf[1]).padStart(2, "0")}`;
  }
  const horas = [...t.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(a\.\s*m\.|p\.\s*m\.|am|pm)?/gi)];
  function to24(h, min, mer) {
    let hour = Number(h);
    const m = mer ? mer.replace(/\s/g, "").toLowerCase() : "";
    if (m.startsWith("p") && hour < 12) hour += 12;
    if (m.startsWith("a") && hour === 12) hour = 0;
    return String(hour).padStart(2, "0") + ":" + String(min || "00").padStart(2, "0");
  }
  let horaInicio = "";
  let horaFin = "";
  const rango = t.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.\s*m\.|p\.\s*m\.|am|pm)?\s*a\s*(\d{1,2})(?::(\d{2}))?\s*(a\.\s*m\.|p\.\s*m\.|am|pm)?/i);
  if (rango) {
    horaInicio = to24(rango[1], rango[2], rango[3]);
    horaFin = to24(rango[4], rango[5], rango[6]);
  }
  return {
    solicitud: solicitud || "SIN-NUMERO",
    placa,
    nombre,
    cedula,
    fecha,
    horaInicio: horaInicio || "07:00",
    horaFin: horaFin || "13:00",
    asunto: pick(/asunto\s*:\s*(.+)/i),
    solicitante: pick(/cordialmente,\s*([^\n]+)/i) || pick(/atentamente,?\s*([^\n]+)/i),
    detalle: t.slice(0, 1200)
  };
}

function bogotaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const g = (t) => parts.find(p => p.type === t).value;
  return { fecha: `${g("year")}-${g("month")}-${g("day")}`, hora: `${g("hour")}:${g("minute")}:${g("second")}` };
}

function bogotaStamp(date = new Date()) {
  const p = bogotaParts(date);
  return `${p.fecha} ${p.hora}`;
}

function vigencia(aut, ahora = new Date()) {
  if (!aut.fecha) return { estado: "sin-fecha", texto: "Sin fecha definida" };
  const p = bogotaParts(ahora);
  const inicio = `${aut.fecha} ${aut.horaInicio || "00:00"}:00`;
  const fin = `${aut.fecha} ${aut.horaFin || "23:59"}:59`;
  const marca = `${p.fecha} ${p.hora}`;
  if (marca < inicio) return { estado: "pendiente", texto: "Aún no inicia el horario" };
  if (marca > fin) return { estado: "vencida", texto: "Fuera del horario autorizado" };
  return { estado: "vigente", texto: "Dentro del horario autorizado" };
}

async function handler(req, res) {
  const method = req.method || "GET";
  const path = pathOf(req);
  if (method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  try {
    const db = await readDb();
    const me = await userFrom(db, req);
    const body = method === "GET" ? {} : await bodyOf(req);

    if (path === "/login" && method === "POST") {
      const usuario = String(body.usuario || "").trim().toLowerCase();
      const user = db.users.find(u => u.usuario === usuario);
      if (user && !user.activo && user.password === hashPassword(body.password || "")) {
        return send(res, 403, { error: "Tu registro está pendiente. Un master o el administrador debe autorizarlo." });
      }
      if (!user || !user.activo || user.password !== hashPassword(body.password || "")) {
        return send(res, 401, { error: "Usuario o clave incorrectos" });
      }
      const token = crypto.randomBytes(24).toString("hex");
      db.sesiones = db.sesiones.filter(s => s.expira > Date.now());
      db.sesiones.push({ token, userId: user.id, expira: Date.now() + 12 * 60 * 60 * 1000 });
      await writeDb(db);
      return send(res, 200, { token, user: publicUser(user) });
    }

    if (path === "/registro" && method === "POST") {
      const usuario = String(body.usuario || "").trim().toLowerCase();
      const nombre = String(body.nombre || "").trim();
      if (!usuario || !nombre || !body.password) return send(res, 400, { error: "Faltan nombre, usuario o clave" });
      if (String(body.password).length < 6) return send(res, 400, { error: "La clave debe tener al menos 6 caracteres" });
      if (db.users.some(u => u.usuario === usuario)) return send(res, 400, { error: "Ese usuario ya existe" });
      db.users.push({
        id: id("u"),
        usuario,
        nombre,
        password: hashPassword(body.password),
        rol: "general",
        activo: false,
        creadoPor: null,
        origen: "autoregistro",
        foto: "",
        creadoEn: new Date().toISOString()
      });
      await writeDb(db);
      return send(res, 200, { ok: true, mensaje: "Registro recibido. Queda pendiente de autorización del master o administrador." });
    }

    if (path === "/me" && method === "GET") {
      if (!me) return send(res, 401, { error: "Sesión vencida" });
      return send(res, 200, { user: publicUser(me) });
    }

    if (!me) return send(res, 401, { error: "Inicia sesión" });

    if (path === "/password" && method === "POST") {
      if (hashPassword(body.actual || "") !== me.password) return send(res, 400, { error: "Clave actual incorrecta" });
      if (!body.nueva || String(body.nueva).length < 6) return send(res, 400, { error: "La nueva clave debe tener al menos 6 caracteres" });
      me.password = hashPassword(body.nueva);
      await writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (path === "/usuarios" && method === "GET") {
      let lista = db.users.map(publicUser);
      if (me.rol === "master") lista = lista.filter(u => u.rol === "general" && (u.creadoPor === me.id || u.estado === "pendiente"));
      if (me.rol === "general") return send(res, 403, { error: "Sin permiso" });
      return send(res, 200, { usuarios: lista });
    }

    if (path === "/usuarios" && method === "POST") {
      const rol = body.rol;
      if (me.rol === "general") return send(res, 403, { error: "Sin permiso" });
      if (me.rol === "master" && rol !== "general") return send(res, 403, { error: "Un master solo crea usuarios generales" });
      if (me.rol === "administrador" && !["master", "general"].includes(rol)) return send(res, 400, { error: "Rol no válido" });
      const usuario = String(body.usuario || "").trim().toLowerCase();
      if (!usuario || !body.nombre || !body.password) return send(res, 400, { error: "Faltan usuario, nombre o clave" });
      if (db.users.some(u => u.usuario === usuario)) return send(res, 400, { error: "Ese usuario ya existe" });
      const nuevo = {
        id: id("u"),
        usuario,
        nombre: String(body.nombre).trim(),
        password: hashPassword(body.password),
        rol,
        activo: true,
        creadoPor: me.id,
        foto: String(body.foto || "").startsWith("data:image/") ? String(body.foto).slice(0, 180000) : "",
        creadoEn: new Date().toISOString()
      };
      db.users.push(nuevo);
      await writeDb(db);
      return send(res, 200, { usuario: publicUser(nuevo) });
    }

    if (path === "/foto" && method === "POST") {
      if (!String(body.foto || "").startsWith("data:image/")) return send(res, 400, { error: "La foto no es válida" });
      me.foto = String(body.foto).slice(0, 180000);
      await writeDb(db);
      return send(res, 200, { user: publicUser(me) });
    }

    if (path.startsWith("/usuarios/") && method === "POST") {
      if (!["administrador", "master"].includes(me.rol)) return send(res, 403, { error: "Sin permiso para autorizar" });
      const uid = path.split("/")[2];
      const user = db.users.find(u => u.id === uid);
      if (!user || user.rol === "administrador") return send(res, 404, { error: "Usuario no encontrado" });
      if (me.rol === "master" && user.rol !== "general") return send(res, 403, { error: "El master solo autoriza usuarios generales" });
      user.activo = body.activo !== false;
      user.autorizadoPor = me.id;
      user.autorizadoEn = new Date().toISOString();
      await writeDb(db);
      return send(res, 200, { usuario: publicUser(user) });
    }

    if (path === "/autorizaciones/borrar" && method === "POST") {
      if (!["administrador", "master"].includes(me.rol)) return send(res, 403, { error: "Solo administrador o master pueden borrar permisos" });
      const antes = db.autorizaciones.length;
      db.autorizaciones = db.autorizaciones.filter(a => a.id !== body.id);
      if (db.autorizaciones.length === antes) return send(res, 404, { error: "Permiso no encontrado" });
      await writeDb(db);
      return send(res, 200, { ok: true });
    }

    if (path.startsWith("/autorizaciones") && method === "GET") {
      const ruta = new URLSearchParams((req.url || "").split("?")[1] || "").get("ruta") || "";
      const q = normPlaca((ruta.split("placa=")[1] || "").split("&")[0]);
      let lista = db.autorizaciones;
      if (q) lista = lista.filter(a => normPlaca(a.placa) === q);
      return send(res, 200, {
        autorizaciones: lista.map(a => ({ ...a, vigencia: vigencia(a) }))
      });
    }

    if (path === "/autorizaciones" && method === "POST") {
      if (!["administrador", "master"].includes(me.rol)) return send(res, 403, { error: "Solo administrador o master cargan permisos" });
      const parsed = body.texto ? parseAutorizacion(body.texto) : {};
      const placa = normPlaca(body.placa || parsed.placa);
      const nombre = (body.nombre || parsed.nombre || "").trim();
      if (!placa || !nombre) return send(res, 400, { error: "Se necesita placa y nombre. Revisa el texto o completa los campos." });
      const ahora = new Date();
      const item = {
        id: id("aut"),
        solicitud: (body.solicitud || parsed.solicitud || "SIN-NUMERO").toUpperCase(),
        placa,
        nombre,
        cedula: body.cedula || parsed.cedula || "",
        fecha: body.fecha || parsed.fecha || "",
        horaInicio: body.horaInicio || parsed.horaInicio || "07:00",
        horaFin: body.horaFin || parsed.horaFin || "13:00",
        asunto: body.asunto || parsed.asunto || "Apoyo logístico de Eventos",
        solicitante: body.solicitante || parsed.solicitante || "",
        usuarioSolicitud: body.usuarioSolicitud || "",
        servicio: body.servicio || "Servicios Administrativos",
        categoria: body.categoria || "Logística de eventos",
        subcategoria: body.subcategoria || "Parqueaderos",
        programa: body.programa || "",
        cargo: body.cargo || "",
        detalle: body.detalle || parsed.detalle || "",
        origen: me.rol === "master" ? "Carga del usuario master" : "Carga del administrador",
        creadoPor: me.id,
        creadoPorNombre: me.nombre,
        creadoEn: ahora.toISOString(),
        creadoEnBogota: bogotaStamp(ahora)
      };
      db.autorizaciones = db.autorizaciones.filter(a => !(normPlaca(a.placa) === placa && a.fecha === item.fecha && a.solicitud === item.solicitud));
      db.autorizaciones.push(item);
      await writeDb(db);
      return send(res, 200, { autorizacion: { ...item, vigencia: vigencia(item) }, leido: parsed });
    }

    if (path === "/registros" && method === "GET") {
      return send(res, 200, { registros: db.registros.slice().reverse() });
    }

    if (path === "/registros" && method === "POST") {
      if (me.rol === "master") return send(res, 403, { error: "El master no registra ingreso ni salida" });
      const tipo = body.tipo === "Salida" ? "Salida" : "Ingreso";
      const placa = normPlaca(body.placa);
      const aut = db.autorizaciones.find(a => normPlaca(a.placa) === placa);
      if (!aut) return send(res, 404, { error: "La placa no está en el listado autorizado" });
      const vig = vigencia(aut);
      const ahora = new Date();
      const bogota = bogotaStamp(ahora);
      const reg = {
        id: id("reg"),
        placa: aut.placa,
        nombre: aut.nombre,
        cedula: aut.cedula,
        solicitud: aut.solicitud,
        tipo,
        fechaHora: ahora.toISOString(),
        fechaHoraBogota: bogota,
        zona: "America/Bogota",
        fechaHoraLocal: bogota,
        vigencia: vig.estado,
        registradoPor: me.nombre,
        usuarioId: me.id,
        nota: String(body.nota || "").slice(0, 300)
      };
      db.registros.push(reg);
      await writeDb(db);
      return send(res, 200, { registro: reg, autorizacion: { ...aut, vigencia: vig } });
    }

    return send(res, 404, { error: "Ruta no encontrada" });
  } catch (err) {
    return send(res, 500, { error: err.message || "Error interno" });
  }
}

module.exports = handler;
module.exports.handler = handler;
