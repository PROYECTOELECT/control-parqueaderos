const state = { token: localStorage.getItem("token") || "", user: null, scanner: null, scanning: false, actual: null };

const $ = (id) => document.getElementById(id);

async function api(ruta, opts = {}) {
  const res = await fetch("/api/app?ruta=" + encodeURIComponent(ruta), {
    method: opts.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: "Bearer " + state.token } : {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Error de servidor");
  return data;
}

function msg(texto, error) {
  const el = $("app-msg");
  el.className = "msg" + (error ? " err" : "");
  el.textContent = texto;
  el.classList.remove("hidden");
}

function badge(vig) {
  const cls = vig?.estado === "vigente" ? "badge" : vig?.estado === "pendiente" ? "badge warn" : "badge bad";
  return `<span class="${cls}">${vig?.texto || ""}</span>`;
}

function tabsFor(rol) {
  if (rol === "administrador") return [["porteria", "Portería"], ["carga", "Cargar permiso"], ["permisos", "Permisos"], ["usuarios", "Usuarios"], ["historial", "Historial"], ["perfil", "Perfil"]];
  if (rol === "master") return [["carga", "Cargar permiso"], ["permisos", "Permisos"], ["usuarios", "Usuarios generales"], ["historial", "Historial"], ["perfil", "Perfil"]];
  return [["porteria", "Portería"], ["permisos", "Permisos"], ["historial", "Mis registros"], ["perfil", "Perfil"]];
}

function renderTabs() {
  const tabs = tabsFor(state.user.rol);
  $("tabs").innerHTML = tabs.map(([id, label], i) =>
    `<button type="button" data-tab="${id}" class="${i === 0 ? "on" : ""}">${label}</button>`).join("");
  $("tabs").onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    [...$("tabs").children].forEach(x => x.classList.remove("on"));
    b.classList.add("on");
    show(b.dataset.tab);
  };
  show(tabs[0][0]);
}

async function show(tab) {
  stopScan();
  stopPlaca();
  const panel = $("panel");
  if (tab === "porteria") panel.innerHTML = porteriaHtml();
  if (tab === "carga") panel.innerHTML = cargaHtml() + await listaPermisosHtml();
  if (tab === "permisos") panel.innerHTML = await listaPermisosHtml();
  if (tab === "usuarios") panel.innerHTML = await usuariosHtml();
  if (tab === "historial") panel.innerHTML = await historialHtml();
  if (tab === "perfil") panel.innerHTML = perfilHtml();
  bind(tab);
}

function porteriaHtml() {
  return `
    <div class="card">
      <h2>Buscar placa</h2>
      <p class="muted">La lectura precisa es el QR del permiso. La cámara de placa toma una foto, la lee y la compara con el listado. Confirma la placa antes de registrar.</p>
      <label>Placa <input id="placa" placeholder="EMP107" autocapitalize="characters"></label>
      <div class="row">
        <button class="ok" id="buscar" type="button">Buscar</button>
        <button class="sec" id="camara-qr" type="button">QR</button>
        <button class="sec" id="camara-placa" type="button">Placa</button>
      </div>
      <div id="reader" class="hidden"></div>
      <video id="video-placa" class="hidden" playsinline autoplay muted></video>
      <canvas id="canvas-placa" class="hidden"></canvas>
      <button class="ok hidden" id="capturar" type="button">Capturar placa</button>
      <p id="ocr-estado" class="muted"></p>
      <div id="ficha"></div>
    </div>`;
}

function cargaHtml() {
  return `
    <div class="card">
      <h2>Cargar permiso</h2>
      <p class="muted">Pega el texto del correo o de la solicitud. En el celular usa Pegar texto y luego Leer texto.</p>
      <label>Texto del permiso</label>
      <textarea id="texto" rows="8" placeholder="Nombre: ...&#10;Cédula: ...&#10;Placa: ...&#10;jueves 8 de octubre, de 7:00 a. m. a 1:00 p. m." enterkeyhint="done" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
      <div class="row">
        <button class="sec" id="pegar-texto" type="button">Pegar texto</button>
        <button id="previsualizar" type="button">Leer texto</button>
      </div>
      <div id="preview"></div>
    </div>`;
}

async function usuariosHtml() {
  const data = await api("/usuarios");
  const rolNuevo = state.user.rol === "administrador"
    ? `<label>Rol <select id="rol"><option value="master">Master</option><option value="general">General</option></select></label>`
    : `<input id="rol" type="hidden" value="general">`;
  const titulo = state.user.rol === "administrador" ? "Crear master o general" : "Crear usuario general";
  const filas = data.usuarios.filter(u => u.rol !== "administrador").map(u => `
    <div class="item user-line">
      ${u.foto ? `<img class="avatar" src="${u.foto}" alt="">` : `<span class="avatar">${(u.nombre || "?").slice(0, 1)}</span>`}
      <div>
        <strong>${u.nombre}</strong>
        <span class="muted">${u.usuario} · ${u.rol} · ${u.estado === "pendiente" ? "pendiente de autorización" : "autorizado"}</span>
        ${state.user.rol === "administrador" || state.user.rol === "master" ? `<button class="ok" data-toggle="${u.id}" data-activo="${u.activo ? "0" : "1"}" type="button">${u.activo ? "Quitar autorización" : "Autorizar"}</button>` : ""}
      </div>
    </div>`).join("") || "<p class='muted'>Sin usuarios todavía.</p>";
  return `
    <div class="card">
      <h2>${titulo}</h2>
      <label>Nombre <input id="n-nombre" placeholder="Nombre completo"></label>
      <label>Usuario <input id="n-usuario" placeholder="usuario"></label>
      <label>Clave
        <span class="pass-wrap">
          <input id="n-clave" type="password" placeholder="mínimo 6 caracteres">
          <button class="ojo" type="button" data-ojo="n-clave">👁</button>
        </span>
      </label>
      <label>Foto <input id="n-foto" type="file" accept="image/*"></label>
      ${rolNuevo}
      <button class="ok" id="crear-user" type="button">Guardar usuario</button>
    </div>
    <div class="card"><h2>Listado</h2>${filas}</div>
    <div class="card">
      <h2>Cambiar mi clave</h2>
      <label>Clave actual
        <span class="pass-wrap">
          <input id="clave-actual" type="password">
          <button class="ojo" type="button" data-ojo="clave-actual">👁</button>
        </span>
      </label>
      <label>Clave nueva
        <span class="pass-wrap">
          <input id="clave-nueva" type="password">
          <button class="ojo" type="button" data-ojo="clave-nueva">👁</button>
        </span>
      </label>
      <button class="sec" id="cambiar-clave" type="button">Actualizar clave</button>
    </div>`;
}

async function historialHtml() {
  const data = await api("/registros");
  let lista = data.registros;
  if (state.user.rol === "general") lista = lista.filter(r => r.usuarioId === state.user.id);
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const filas = lista.map(r => `
    <div class="item">
      <strong>${r.placa} · ${r.tipo}</strong>
      <span class="muted">${r.nombre} · ${r.cedula || ""}</span><br>
      <span class="muted">${r.fechaHoraBogota || r.fechaHoraLocal} · America/Bogota · ${r.solicitud} · ${r.registradoPor}</span>
      <span class="${r.vigencia === "vigente" ? "badge" : "badge warn"}">${r.vigencia}</span>
    </div>`).join("") || "<p class='muted'>Sin registros.</p>";
  return `
    <div class="card">
      <h2>Reporte de ingresos</h2>
      <p class="muted">Elige el rango en hora de Bogotá. El Excel y el PDF incluyen solo registros de ingreso.</p>
      <div class="row">
        <label>Fecha inicial <input id="f-ini" type="date" value="${hoy}"></label>
        <label>Fecha final <input id="f-fin" type="date" value="${hoy}"></label>
      </div>
      <div class="row">
        <button class="ok" id="exp-excel" type="button">Exportar Excel</button>
        <button class="sec" id="exp-pdf" type="button">Exportar PDF</button>
      </div>
    </div>
    <div class="card"><h2>Registros</h2>${filas}</div>`;
}

async function listaPermisosHtml() {
  const data = await api("/autorizaciones");
  const puedeBorrar = state.user.rol === "administrador" || state.user.rol === "master";
  const filas = data.autorizaciones.slice().reverse().map(a => `
    <div class="item">
      <strong class="placa">${a.placa}</strong>
      ${a.nombre}<br>
      <span class="muted">${a.cedula || "—"} · ${a.solicitud} · ${a.fecha || "sin fecha"} ${a.horaInicio}-${a.horaFin}</span><br>
      <span class="muted">Cargado: ${a.creadoEnBogota || a.creadoEn || "sin hora"} · ${a.creadoPorNombre || a.origen || ""}</span><br>
      ${badge(a.vigencia)}
      ${puedeBorrar ? `<button class="out" data-borrar="${a.id}" type="button">Borrar</button>` : ""}
    </div>`).join("") || "<p class='muted'>Todavía no hay permisos cargados.</p>";
  return `<div class="card"><h2>Permisos cargados</h2><p class="muted">Este listado lo pueden ver todos los usuarios.</p>${filas}</div>`;
}

async function listaHtml() {
  const data = await api("/autorizaciones");
  const filas = data.autorizaciones.map(a => `
    <div class="item">
      <strong class="placa">${a.placa}</strong>
      ${a.nombre}<br>
      <span class="muted">${a.cedula} · ${a.solicitud} · ${a.fecha} ${a.horaInicio}-${a.horaFin}</span><br>
      ${badge(a.vigencia)}
    </div>`).join("") || "<p class='muted'>Sin permisos.</p>";
  return `<div class="card"><h2>Permisos cargados</h2>${filas}</div>`;
}

function perfilHtml() {
  const u = state.user;
  return `
    <div class="card">
      <h2>Mi foto</h2>
      <div class="user-line">
        ${u.foto ? `<img id="mi-foto" class="avatar-lg" src="${u.foto}" alt="">` : `<span id="mi-foto" class="avatar-lg">${(u.nombre || "?").slice(0, 1)}</span>`}
        <div><strong>${u.nombre}</strong><br><span class="muted">${u.usuario} · ${u.rol}</span></div>
      </div>
      <label>Cambiar foto <input id="foto-propia" type="file" accept="image/*"></label>
      <button class="ok" id="guardar-foto" type="button">Guardar foto</button>
    </div>`;
}

function bind(tab) {
  if (tab === "porteria") {
    $("buscar").onclick = buscar;
    $("camara-qr").onclick = toggleQr;
    $("camara-placa").onclick = togglePlaca;
    $("placa").addEventListener("keydown", (e) => { if (e.key === "Enter") buscar(); });
  }
  if (tab === "carga") {
    $("previsualizar").onclick = previsualizar;
    $("pegar-texto").onclick = pegarTexto;
    $("texto").addEventListener("paste", () => setTimeout(previsualizar, 50));
  }
  if (tab === "carga" || tab === "permisos") {
    document.querySelectorAll("[data-borrar]").forEach(b => b.onclick = () => borrarPermiso(b.dataset.borrar, tab));
  }
  if (tab === "usuarios") {
    $("crear-user").onclick = crearUsuario;
    $("cambiar-clave").onclick = cambiarClave;
    document.querySelectorAll("[data-toggle]").forEach(b => b.onclick = () => toggleUser(b.dataset.toggle, b.dataset.activo === "1"));
  }
  if (tab === "historial") {
    $("exp-excel").onclick = exportarExcel;
    $("exp-pdf").onclick = exportarPdf;
  }
  if (tab === "perfil") $("guardar-foto").onclick = guardarFotoPropia;
  document.querySelectorAll("[data-ojo]").forEach(b => b.onclick = () => alternarClave(b.dataset.ojo));
}

function fechaDe(r) {
  return String(r.fechaHoraBogota || r.fechaHoraLocal || r.fechaHora || "").slice(0, 10);
}

async function ingresosDelRango() {
  const data = await api("/registros");
  const ini = $("f-ini").value;
  const fin = $("f-fin").value;
  if (!ini || !fin) throw new Error("Elige fecha inicial y fecha final.");
  if (ini > fin) throw new Error("La fecha inicial no puede ser mayor que la final.");
  let lista = data.registros.filter(r => r.tipo === "Ingreso" && fechaDe(r) >= ini && fechaDe(r) <= fin);
  if (state.user.rol === "general") lista = lista.filter(r => r.usuarioId === state.user.id);
  return lista.sort((a, b) => String(a.fechaHoraBogota || "").localeCompare(String(b.fechaHoraBogota || "")));
}

function filasReporte(lista) {
  return lista.map(r => ({
    fechaHora: r.fechaHoraBogota || r.fechaHoraLocal || "",
    placa: r.placa || "",
    nombre: r.nombre || "",
    cedula: r.cedula || "",
    solicitud: r.solicitud || "",
    vigencia: r.vigencia || "",
    registradoPor: r.registradoPor || "",
    nota: r.nota || ""
  }));
}

function descargar(nombre, contenido, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  a.download = nombre;
  a.click();
}

async function exportarExcel() {
  try {
    const ini = $("f-ini").value;
    const fin = $("f-fin").value;
    const filas = filasReporte(await ingresosDelRango());
    const encabezado = ["Fecha y hora Bogotá", "Placa", "Nombre", "Cédula", "Solicitud", "Vigencia", "Registrado por", "Nota"];
    const tabla = [encabezado, ...filas.map(r => [r.fechaHora, r.placa, r.nombre, r.cedula, r.solicitud, r.vigencia, r.registradoPor, r.nota])]
      .map(cols => "<tr>" + cols.map(c => `<td>${String(c).replace(/&/g, "&").replace(/</g, "<")}</td>`).join("") + "</tr>")
      .join("");
    const html = `<html><head><meta charset="utf-8"></head><body><table>${tabla}</table></body></html>`;
    descargar(`ingresos-${ini}-a-${fin}.xls`, "\uFEFF" + html, "application/vnd.ms-excel");
    msg(`Excel listo: ${filas.length} ingreso(s) del ${ini} al ${fin}.`);
  } catch (err) { msg(err.message, true); }
}

async function exportarPdf() {
  try {
    const ini = $("f-ini").value;
    const fin = $("f-fin").value;
    const filas = filasReporte(await ingresosDelRango());
    const cuerpo = filas.map(r => `<tr>
      <td>${r.fechaHora}</td><td>${r.placa}</td><td>${r.nombre}</td><td>${r.cedula}</td>
      <td>${r.solicitud}</td><td>${r.vigencia}</td><td>${r.registradoPor}</td><td>${r.nota}</td>
    </tr>`).join("") || `<tr><td colspan="8">Sin ingresos en este rango</td></tr>`;
    const win = window.open("", "_blank");
    if (!win) throw new Error("El navegador bloqueó la ventana. Permite ventanas emergentes para el PDF.");
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ingresos ${ini} a ${fin}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        p { color: #444; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
        th { background: #14532d; color: white; }
      </style></head><body>
      <h1>Reporte de ingreso de vehículos</h1>
      <p>Rango: ${ini} a ${fin}. Zona: America/Bogota. Total: ${filas.length}.</p>
      <table><thead><tr>
        <th>Fecha y hora</th><th>Placa</th><th>Nombre</th><th>Cédula</th><th>Solicitud</th><th>Vigencia</th><th>Registrado por</th><th>Nota</th>
      </tr></thead><tbody>${cuerpo}</tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
    msg(`PDF listo para guardar: ${filas.length} ingreso(s) del ${ini} al ${fin}.`);
  } catch (err) { msg(err.message, true); }
}

function fichaHtml(a) {
  return `
    <div class="card">
      <div class="placa">${a.placa}</div>
      ${badge(a.vigencia)}
      <p><strong>${a.nombre}</strong><br>Cédula ${a.cedula || "—"}</p>
      <p class="muted">Solicitud ${a.solicitud}<br>${a.fecha || "sin fecha"} · ${a.horaInicio} a ${a.horaFin}<br>${a.asunto || ""}<br>${a.solicitante || ""} ${a.programa || ""}</p>
      <label>Nota <input id="nota" placeholder="Opcional"></label>
      <div class="row">
        <button class="ok" id="ingreso" type="button">Registrar ingreso</button>
        <button class="out" id="salida" type="button">Registrar salida</button>
      </div>
    </div>`;
}

async function buscar() {
  const placa = ($("placa").value || "").trim();
  if (!placa) return msg("Escribe o lee una placa.", true);
  try {
    const data = await api("/autorizaciones?placa=" + encodeURIComponent(placa));
    const a = data.autorizaciones[0];
    state.actual = a || null;
    $("ficha").innerHTML = a ? fichaHtml(a) : `<div class="card">La placa ${placa.toUpperCase()} no está en el listado.</div>`;
    if (a) {
      $("ingreso").onclick = () => registrar("Ingreso");
      $("salida").onclick = () => registrar("Salida");
    }
    $("app-msg").classList.add("hidden");
  } catch (err) { msg(err.message, true); }
}

async function registrar(tipo) {
  if (!state.actual) return;
  try {
    const data = await api("/registros", { method: "POST", body: { placa: state.actual.placa, tipo, nota: $("nota")?.value || "" } });
    msg(tipo + " guardado para " + data.registro.placa + ".\n" + data.registro.fechaHoraBogota + " (America/Bogota).");
  } catch (err) { msg(err.message, true); }
}

async function toggleQr() {
  const box = $("reader");
  if (state.scanning) return stopScan();
  await stopPlaca();
  box.classList.remove("hidden");
  state.scanner = new Html5Qrcode("reader");
  try {
    await state.scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (text) => {
        const placa = extraerPlaca(text) || String(text).toUpperCase().replace(/[^A-Z0-9]/g, "");
        $("placa").value = placa;
        stopScan();
        buscar();
      },
      () => {}
    );
    state.scanning = true;
    $("camara-qr").textContent = "Cerrar QR";
  } catch (err) {
    msg("No se abrió la cámara. En Vercel (HTTPS) o en http://localhost permite el permiso.\n" + err, true);
  }
}

async function togglePlaca() {
  if (state.stream) return stopPlaca();
  await stopScan();
  const video = $("video-placa");
  try {
    const camaras = await navigator.mediaDevices.enumerateDevices();
    const trasera = camaras.find(d => d.kind === "videoinput" && /back|rear|trasera|environment/i.test(d.label));
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: trasera ? { deviceId: { exact: trasera.deviceId } } : { facingMode: { ideal: "environment" } }
    });
    video.srcObject = state.stream;
    video.classList.remove("hidden");
    await video.play();
    $("capturar").classList.remove("hidden");
    $("capturar").onclick = leerPlacaFoto;
    $("camara-placa").textContent = "Cerrar placa";
    $("ocr-estado").textContent = "Pon la placa dentro del recuadro amarillo, de frente y sin reflejo. Luego pulsa Capturar placa.";
  } catch (err) {
    msg("No se abrió la cámara. Entra por http://localhost o HTTPS y permite la cámara.\n" + err, true);
  }
}

async function motorOcr() {
  if (state.ocrWorker) return state.ocrWorker;
  const base = new URL("ocr/", location.href).href;
  state.ocrWorker = await Tesseract.createWorker("eng", 1, {
    workerPath: base + "worker.min.js",
    corePath: base + "tesseract-core.wasm.js",
    langPath: base,
    gzip: true
  });
  await state.ocrWorker.setParameters({
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    tessedit_pageseg_mode: "7"
  });
  return state.ocrWorker;
}

function prepararPlaca(video) {
  const canvas = $("canvas-placa");
  const w = video.videoWidth;
  const h = video.videoHeight;
  const cw = Math.floor(w * 0.92);
  const ch = Math.floor(h * 0.42);
  canvas.width = cw * 2;
  canvas.height = ch * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    let g = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11;
    g = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function corregirConListado(texto, placas) {
  const compact = String(texto || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const directa = extraerPlaca(compact);
  if (directa && placas.some(p => p === directa)) return directa;
  const cercana = placas.find(p => parecida(p, directa || compact.slice(0, 6)));
  if (cercana) return cercana;
  return placas.find(p => compact.includes(p)) || directa || "";
}

async function leerPlacaFoto() {
  const video = $("video-placa");
  if (!video.videoWidth) return msg("La cámara aún no está lista. Espera un segundo y vuelve a capturar.", true);
  $("ocr-estado").textContent = "Leyendo placa...";
  $("capturar").disabled = true;
  try {
    const canvas = prepararPlaca(video);
    const worker = await motorOcr();
    const result = await worker.recognize(canvas);
    const lista = await api("/autorizaciones");
    const placas = lista.autorizaciones.map(a => a.placa);
    const placa = corregirConListado(result.data.text, placas);
    if (!placa) {
      $("ocr-estado").textContent = "No se leyó una placa. Acerca más, evita el reflejo y captura otra vez. Texto visto: " + (result.data.text || "").replace(/\s+/g, " ");
      return;
    }
    $("placa").value = placa;
    $("ocr-estado").textContent = "Placa leída: " + placa + ". Revísala; si está bien, ya se buscó.";
    await stopPlaca();
    buscar();
  } catch (err) {
    msg("No se pudo leer la placa. Recarga la página e inténtalo de nuevo.\n" + err, true);
  } finally {
    if ($("capturar")) $("capturar").disabled = false;
  }
}

async function stopPlaca() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  const video = $("video-placa");
  if (video) video.classList.add("hidden");
  const cap = $("capturar");
  if (cap) cap.classList.add("hidden");
  const btn = $("camara-placa");
  if (btn) btn.textContent = "Placa";
}

function extraerPlaca(text) {
  const compact = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hits = compact.match(/[A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z]/g);
  return hits ? hits[0] : "";
}

function parecida(a, b) {
  const map = { O: "0", Q: "0", I: "1", L: "1", Z: "2", S: "5", B: "8", G: "6" };
  const n = (s) => String(s || "").split("").map(c => map[c] || c).join("");
  if (!a || !b) return false;
  if (n(a) === n(b)) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let dif = 0;
  const x = n(a);
  const y = n(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) dif++;
  return dif <= 1;
}

async function stopScan() {
  if (state.scanner && state.scanning) {
    try { await state.scanner.stop(); } catch (e) {}
  }
  state.scanning = false;
  const cam = $("camara-qr");
  if (cam) cam.textContent = "QR";
  const box = $("reader");
  if (box) box.classList.add("hidden");
}

function limpiarTexto(t) {
  return String(t || "")
    .replace(/\u00a0|\u202f|\u200b|\u200c|\u200d|\ufeff/g, " ")
    .replace(/[：﹕]/g, ":")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n");
}

async function pegarTexto() {
  const box = $("texto");
  box.focus();
  try {
    const texto = await navigator.clipboard.readText();
    if (!texto) throw new Error("El portapapeles está vacío.");
    box.value = limpiarTexto(texto);
    previsualizar();
  } catch (err) {
    msg("El celular no permitió pegar solo. Mantén pulsado el recuadro, elige Pegar y luego pulsa Leer texto.\n" + (err.message || ""), true);
  }
}

async function previsualizar() {
  const texto = limpiarTexto($("texto").value);
  $("texto").value = texto;
  if (!texto.trim()) return msg("No hay texto para leer. Pulsa Pegar texto o mantén pulsado el recuadro y pega el correo.", true);
  const leido = leerLocal(texto);
  $("preview").innerHTML = `
    <label>Placa <input id="p-placa" value="${leido.placa}"></label>
    <label>Nombre <input id="p-nombre" value="${leido.nombre}"></label>
    <label>Cédula <input id="p-cedula" value="${leido.cedula}"></label>
    <label>Solicitud <input id="p-sol" value="${leido.solicitud}"></label>
    <label>Fecha <input id="p-fecha" type="date" value="${leido.fecha}"></label>
    <div class="row">
      <label>Desde <input id="p-ini" type="time" value="${leido.horaInicio}"></label>
      <label>Hasta <input id="p-fin" type="time" value="${leido.horaFin}"></label>
    </div>
    <button class="ok" id="guardar-aut" type="button">Guardar en el listado</button>`;
  $("guardar-aut").onclick = guardarAut;
  if (!leido.placa || !leido.nombre) msg("Se leyó el texto, pero falta placa o nombre. Complétalos abajo y guarda.", true);
  else msg("Texto leído. Revisa los datos y pulsa Guardar en el listado.");
}

function leerLocal(t) {
  t = limpiarTexto(t);
  const pick = (re) => (t.match(re) || [,""])[1].trim();
  const placa = (pick(/placa\s*[:\-]?\s*([A-Za-z0-9\-]{4,8})/i) || (t.match(/\b[A-Z]{3}\d{3}\b|\b[A-Z]{3}\d{2}[A-Z]\b/i) || [""])[0]).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const meses = { enero:"01", febrero:"02", marzo:"03", abril:"04", mayo:"05", junio:"06", julio:"07", agosto:"08", septiembre:"09", octubre:"10", noviembre:"11", diciembre:"12" };
  const mf = t.match(/(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)/);
  let fecha = "";
  if (mf) {
    const mes = meses[mf[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
    if (mes) fecha = `${(t.match(/20\d{2}/) || ["2026"])[0]}-${mes}-${mf[1].padStart(2,"0")}`;
  }
  const rango = t.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.\s*m\.|p\.\s*m\.|am|pm)?\s*a\s*(\d{1,2})(?::(\d{2}))?\s*(a\.\s*m\.|p\.\s*m\.|am|pm)?/i);
  const to24 = (h, min, mer) => {
    let hour = Number(h);
    const m = (mer || "").replace(/\s/g, "").toLowerCase();
    if (m.startsWith("p") && hour < 12) hour += 12;
    if (m.startsWith("a") && hour === 12) hour = 0;
    return String(hour).padStart(2, "0") + ":" + String(min || "00").padStart(2, "0");
  };
  return {
    placa,
    nombre: pick(/nombre\s*[:\-]?\s*(.+)/i),
    cedula: pick(/c[eé]dula\s*[:\-]?\s*([0-9.\s]+)/i),
    solicitud: (t.match(/SOL-\d+/i) || [""])[0].toUpperCase(),
    fecha,
    horaInicio: rango ? to24(rango[1], rango[2], rango[3]) : "07:00",
    horaFin: rango ? to24(rango[4], rango[5], rango[6]) : "13:00"
  };
}

async function guardarAut() {
  try {
    await api("/autorizaciones", {
      method: "POST",
      body: {
        texto: $("texto").value,
        placa: $("p-placa").value,
        nombre: $("p-nombre").value,
        cedula: $("p-cedula").value,
        solicitud: $("p-sol").value,
        fecha: $("p-fecha").value,
        horaInicio: $("p-ini").value,
        horaFin: $("p-fin").value
      }
    });
    msg("Permiso guardado. Ya aparece en el listado.");
    show("carga");
  } catch (err) { msg(err.message, true); }
}

async function borrarPermiso(id, tab) {
  if (!confirm("¿Borrar este permiso cargado?")) return;
  try {
    await api("/autorizaciones/borrar", { method: "POST", body: { id } });
    msg("Permiso borrado.");
    show(tab || "permisos");
  } catch (err) { msg(err.message, true); }
}

async function crearUsuario() {
  try {
    const archivo = $("n-foto").files[0];
    const foto = archivo ? await reducirFoto(archivo) : "";
    await api("/usuarios", {
      method: "POST",
      body: {
        nombre: $("n-nombre").value,
        usuario: $("n-usuario").value,
        password: $("n-clave").value,
        rol: $("rol").value,
        foto
      }
    });
    msg("Usuario creado.");
    show("usuarios");
  } catch (err) { msg(err.message, true); }
}

function reducirFoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.onload = () => { img.src = reader.result; };
    img.onerror = () => reject(new Error("La foto no es válida"));
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const size = 240;
      canvas.width = size;
      canvas.height = size;
      const lado = Math.min(img.width, img.height);
      canvas.getContext("2d").drawImage(img, (img.width - lado) / 2, (img.height - lado) / 2, lado, lado, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", 0.72));
    };
    reader.readAsDataURL(file);
  });
}

async function guardarFotoPropia() {
  try {
    const archivo = $("foto-propia").files[0];
    if (!archivo) throw new Error("Elige una foto.");
    const foto = await reducirFoto(archivo);
    const data = await api("/foto", { method: "POST", body: { foto } });
    state.user = data.user;
    pintarAvatar();
    msg("Foto guardada.");
    show("perfil");
  } catch (err) { msg(err.message, true); }
}

function alternarClave(id) {
  const input = $(id);
  input.type = input.type === "password" ? "text" : "password";
}

function pintarAvatar() {
  const box = $("avatar");
  if (!state.user) return;
  box.classList.remove("hidden");
  if (state.user.foto) box.innerHTML = "";
  box.style.backgroundImage = state.user.foto ? `url(${state.user.foto})` : "";
  box.style.backgroundSize = "cover";
  box.textContent = state.user.foto ? "" : (state.user.nombre || "?").slice(0, 1);
}

async function toggleUser(id, activo) {
  try {
    await api("/usuarios/" + id, { method: "POST", body: { activo } });
    show("usuarios");
  } catch (err) { msg(err.message, true); }
}

async function cambiarClave() {
  try {
    await api("/password", { method: "POST", body: { actual: $("clave-actual").value, nueva: $("clave-nueva").value } });
    msg("Clave actualizada.");
  } catch (err) { msg(err.message, true); }
}

async function entrar() {
  try {
    const data = await api("/login", { method: "POST", body: { usuario: $("user").value, password: $("pass").value } });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem("token", data.token);
    abrirApp();
  } catch (err) {
    $("login-msg").textContent = err.message;
    $("login-msg").classList.remove("hidden");
  }
}

function abrirApp() {
  $("login").classList.add("hidden");
  document.body.classList.remove("login-on");
  $("app").classList.remove("hidden");
  $("salir").classList.remove("hidden");
  $("who").textContent = state.user.nombre + " · " + state.user.rol;
  pintarAvatar();
  renderTabs();
}

function salir() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("token");
  location.reload();
}

$("ver-clave").onclick = () => alternarClave("pass");
$("ver-clave-reg").onclick = () => alternarClave("r-clave");
$("btn-registro").onclick = () => {
  $("login").classList.add("hidden");
  $("registro").classList.remove("hidden");
};
$("volver-login").onclick = () => {
  $("registro").classList.add("hidden");
  $("login").classList.remove("hidden");
};
$("enviar-registro").onclick = async () => {
  try {
    const data = await api("/registro", {
      method: "POST",
      body: { nombre: $("r-nombre").value, usuario: $("r-usuario").value, password: $("r-clave").value }
    });
    $("reg-msg").className = "msg";
    $("reg-msg").textContent = data.mensaje;
  } catch (err) {
    $("reg-msg").className = "msg err";
    $("reg-msg").textContent = err.message;
  }
};
$("btn-login").onclick = entrar;
$("salir").onclick = salir;
$("pass").addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });

if (state.token) {
  api("/me").then(data => { state.user = data.user; abrirApp(); }).catch(() => localStorage.removeItem("token"));
}
