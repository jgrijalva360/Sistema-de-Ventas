const TIPOS_MOVIMIENTO = {
  INGRESO: "INGRESO",
  SALIDA: "SALIDA",
  AJUSTE_POSITIVO: "AJUSTE_POSITIVO",
  AJUSTE_NEGATIVO: "AJUSTE_NEGATIVO",
  AJUSTE: "AJUSTE",
};

const STORAGE_KEY = "inventario_local_v1";
const DEFAULT_CONFIG = {
  businessName: "Mi Negocio",
  businessPhone: "",
  fiscalLegend: "Venta al público en general",
};

const DEFAULT_SUCURSALES = [
  {
    id: "SUC-MAIN",
    nombre: "Matriz (Principal)",
    direccion: "",
    telefono: "",
    esMatriz: true,
  },
];

const localDB = {
  sucursales: [...DEFAULT_SUCURSALES],
  sucursalActivaId: "SUC-MAIN",
  productos: [],
  movimientos: [],
  ventas: [],
  gastos: [],
  cortes: [],
  corteActivo: null,
  carritosPendientes: [],
  pedidosPersonalizados: [],
  config: { ...DEFAULT_CONFIG },
  listas: {
    unidades: ["Unidades", "Pieza", "Caja", "Paquetes", "Docenas"],
    grupos: [
      "Materia Prima",
      "Producto",
      "Herramientas",
      "Consumibles",
      "Repuestos",
      "Equipos",
      "General",
    ],
  },
};

let currentTab = "dashboard";
let searchTimeout;
let autocompleteTimeout;
let autocompleteVentaTimeout;
let productoEnEdicionCodigo = "";
let carritoVenta = [];
let ultimaVentaId = "";
let resolverPrecioVariableVenta = null;
let productoPrecioVariableVenta = null;
let carritoPendienteActivoId = "";

// const sonidoAgregarCarrito = new Audio("assets/timer_beep.mp3");
const sonidoAgregarCarrito = new Audio("assets/ball-origin-beep.mp3");
const sonidoVentaExitosa = new Audio("assets/apple-pay-original.mp3");
const sonidoVentaFallida = new Audio("assets/apple-pay-failed.mp3");

// ── Persistencia y Sincronización (Firebase Cloud Firestore / Servidor Local / LocalStorage) ─────

const API_DB = "/api/db";
const FIREBASE_CONFIG_KEY = "firebase_config_v1";
let _saveDebounceTimer = null;
let _isPersisting = false;
let _syncPollInterval = null;
let _lastServerJsonString = "";
let _dbFirestore = null;
let _unsubscribeFirestore = null;

function obtenerDocIdFirestore() {
  if (typeof firebase !== "undefined" && firebase.auth && firebase.auth().currentUser) {
    const user = firebase.auth().currentUser;
    // Retornamos el UID (o sanitizamos el email para usarlo de ID)
    return user.uid || (user.email ? user.email.replace(/[^a-zA-Z0-9_-]/g, "_") : "main");
  }
  return "main";
}

function obtenerConfigFirebaseGuardada() {
  try {
    const raw = localStorage.getItem(FIREBASE_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { }

  // Si existe un archivo environment.js con datos válidos
  if (typeof firebaseEnvironment !== "undefined" && firebaseEnvironment.apiKey && !firebaseEnvironment.apiKey.includes("TU_API_KEY")) {
    return firebaseEnvironment;
  }

  return null;
}

function obtenerDocIdEmpresa() {
  return obtenerDocIdFirestore();
}

function obtenerRefColeccion(nombreColeccion) {
  if (!_dbFirestore) return null;
  const tenantId = obtenerDocIdEmpresa();
  return _dbFirestore.collection("sistema").doc(tenantId).collection(nombreColeccion);
}

function obtenerRefDocConfig(docName) {
  if (!_dbFirestore) return null;
  const tenantId = obtenerDocIdEmpresa();
  return _dbFirestore.collection("sistema").doc(tenantId).collection("config").doc(docName);
}

// ── Gestión Multi-Sucursal (Puntos de Venta) ────────────────────
function obtenerSucursales() {
  if (!Array.isArray(localDB.sucursales) || localDB.sucursales.length === 0) {
    localDB.sucursales = [...DEFAULT_SUCURSALES];
  }
  return localDB.sucursales;
}

function obtenerSucursalActivaId() {
  const guardada = localStorage.getItem("sucursal_activa_id");
  const sucursales = obtenerSucursales();
  if (guardada && sucursales.some((s) => s.id === guardada)) {
    localDB.sucursalActivaId = guardada;
    return guardada;
  }
  const matriz = sucursales.find((s) => s.esMatriz) || sucursales[0];
  localDB.sucursalActivaId = matriz ? matriz.id : "SUC-MAIN";
  return localDB.sucursalActivaId;
}

function obtenerSucursalActiva() {
  const idActiva = obtenerSucursalActivaId();
  const sucursales = obtenerSucursales();
  return (
    sucursales.find((s) => s.id === idActiva) ||
    sucursales[0] ||
    DEFAULT_SUCURSALES[0]
  );
}

function cambiarSucursalActiva(sucursalId) {
  const sucursales = obtenerSucursales();
  const encontrada = sucursales.find((s) => s.id === sucursalId);
  if (!encontrada) return;

  localDB.sucursalActivaId = sucursalId;
  localStorage.setItem("sucursal_activa_id", sucursalId);

  const selector = document.getElementById("selectorSucursal");
  if (selector) selector.value = sucursalId;

  refrescarVistaActual();
  cargarModuloCortes();
  renderizarTablaSucursales();
}

function renderSelectorSucursal() {
  const selector = document.getElementById("selectorSucursal");
  const sucursales = obtenerSucursales();
  const activaId = obtenerSucursalActivaId();

  if (selector) {
    selector.innerHTML = sucursales
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === activaId ? "selected" : ""}>🏢 ${s.nombre}${s.esMatriz ? " (Matriz)" : ""}</option>`
      )
      .join("");
  }

  ["filtroSucursalResumen", "filtroSucursalVentas", "filtroSucursalGastos", "filtroSucursalCortes", "filtroSucursalInventario"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      const valorActual = el.value || "TODAS";
      el.innerHTML =
        `<option value="TODAS">🏢 Todas las Sucursales (Consolidado)</option>` +
        sucursales
          .map(
            (s) =>
              `<option value="${s.id}" ${s.id === valorActual ? "selected" : ""}>🏢 ${s.nombre}${s.esMatriz ? " (Matriz)" : ""}</option>`
          )
          .join("");
      if (valorActual && (valorActual === "TODAS" || sucursales.some((s) => s.id === valorActual))) {
        el.value = valorActual;
      }
    }
  });

  const sucursalMovimientoEl = document.getElementById("sucursalMovimiento");
  if (sucursalMovimientoEl) {
    const valorActual = sucursalMovimientoEl.value || activaId;
    sucursalMovimientoEl.innerHTML = sucursales
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === valorActual ? "selected" : ""}>🏢 ${s.nombre}${s.esMatriz ? " (Matriz)" : ""}</option>`
      )
      .join("");
    if (sucursales.some((s) => s.id === valorActual)) {
      sucursalMovimientoEl.value = valorActual;
    }
  }
}

function renderizarTablaSucursales() {
  const tbody = document.getElementById("tablaSucursalesBody");
  if (!tbody) return;

  const sucursales = obtenerSucursales();
  const activaId = obtenerSucursalActivaId();

  if (sucursales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:15px; color:#64748b;">No hay sucursales registradas.</td></tr>`;
    return;
  }

  tbody.innerHTML = sucursales
    .map((s) => {
      const esActiva = s.id === activaId;
      return `
        <tr style="border-bottom: 1px solid #e2e8f0; ${esActiva ? "background: #f0fdf4;" : ""}">
          <td style="padding: 10px; font-weight: 600; color: #64748b;">${s.id}</td>
          <td style="padding: 10px; font-weight: 600; color: #0f172a;">
            ${s.nombre} ${esActiva ? '<span style="font-size:0.75rem; color:#16a34a; font-weight:bold; margin-left:4px;">(Activa en esta PC)</span>' : ""}
          </td>
          <td style="padding: 10px; color: #475569;">${s.direccion || '<span style="color:#94a3b8;">-</span>'}</td>
          <td style="padding: 10px; color: #475569;">${s.telefono || '<span style="color:#94a3b8;">-</span>'}</td>
          <td style="padding: 10px; text-align: center;">
            ${s.esMatriz ? '<span class="badge-matriz">Matriz</span>' : '<span class="badge-sucursal">Sucursal</span>'}
          </td>
          <td style="padding: 10px; text-align: center;">
            <button type="button" class="btn btn-secondary btn-sm" style="padding: 4px 8px; font-size: 0.8rem;" onclick="editarSucursal('${s.id}')">✏️ Editar</button>
            ${!s.esMatriz ? `<button type="button" class="btn btn-danger btn-sm" style="padding: 4px 8px; font-size: 0.8rem; margin-left:4px;" onclick="eliminarSucursal('${s.id}')">🗑️</button>` : ""}
          </td>
        </tr>
      `;
    })
    .join("");
}

function abrirModalNuevaSucursal() {
  const modal = document.getElementById("modalSucursal");
  if (!modal) return;
  document.getElementById("tituloModalSucursal").textContent = "🏢 Nueva Sucursal";
  document.getElementById("sucursalEditId").value = "";
  document.getElementById("nombreSucursalInput").value = "";
  document.getElementById("direccionSucursalInput").value = "";
  document.getElementById("telefonoSucursalInput").value = "";
  document.getElementById("esMatrizSucursalInput").checked = false;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("nombreSucursalInput").focus();
}

function editarSucursal(id) {
  const sucursales = obtenerSucursales();
  const s = sucursales.find((item) => item.id === id);
  if (!s) return;

  const modal = document.getElementById("modalSucursal");
  if (!modal) return;
  document.getElementById("tituloModalSucursal").textContent = "✏️ Editar Sucursal";
  document.getElementById("sucursalEditId").value = s.id;
  document.getElementById("nombreSucursalInput").value = s.nombre || "";
  document.getElementById("direccionSucursalInput").value = s.direccion || "";
  document.getElementById("telefonoSucursalInput").value = s.telefono || "";
  document.getElementById("esMatrizSucursalInput").checked = !!s.esMatriz;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("nombreSucursalInput").focus();
}

function cerrarModalSucursal() {
  const modal = document.getElementById("modalSucursal");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
}

function guardarSucursal(event) {
  event.preventDefault();
  const idEdit = document.getElementById("sucursalEditId").value.trim();
  const nombre = document.getElementById("nombreSucursalInput").value.trim();
  const direccion = document.getElementById("direccionSucursalInput").value.trim();
  const telefono = document.getElementById("telefonoSucursalInput").value.trim();
  const esMatriz = document.getElementById("esMatrizSucursalInput").checked;

  if (!nombre) {
    alert("El nombre de la sucursal es obligatorio.");
    return;
  }

  const sucursales = obtenerSucursales();

  if (esMatriz) {
    sucursales.forEach((s) => (s.esMatriz = false));
  }

  if (idEdit) {
    const index = sucursales.findIndex((s) => s.id === idEdit);
    if (index !== -1) {
      sucursales[index] = {
        ...sucursales[index],
        nombre,
        direccion,
        telefono,
        esMatriz: esMatriz || sucursales[index].esMatriz,
      };
    }
  } else {
    const nuevoId = `SUC-${Date.now().toString(36).toUpperCase()}`;
    sucursales.push({
      id: nuevoId,
      nombre,
      direccion,
      telefono,
      esMatriz: sucursales.length === 0 ? true : esMatriz,
    });
  }

  if (!sucursales.some((s) => s.esMatriz) && sucursales.length > 0) {
    sucursales[0].esMatriz = true;
  }

  localDB.sucursales = sucursales;
  guardarEstadoLocal();
  renderSelectorSucursal();
  renderizarTablaSucursales();
  cerrarModalSucursal();
}

function eliminarSucursal(id) {
  const sucursales = obtenerSucursales();
  const s = sucursales.find((item) => item.id === id);
  if (!s) return;
  if (s.esMatriz) {
    alert("No se puede eliminar la sucursal Matriz (Principal).");
    return;
  }
  if (!confirm(`¿Estás seguro de eliminar la sucursal "${s.nombre}"?`)) return;

  localDB.sucursales = sucursales.filter((item) => item.id !== id);
  if (obtenerSucursalActivaId() === id) {
    const matriz = localDB.sucursales.find((item) => item.esMatriz) || localDB.sucursales[0];
    if (matriz) cambiarSucursalActiva(matriz.id);
  }

  guardarEstadoLocal();
  renderSelectorSucursal();
  renderizarTablaSucursales();
}

function inicializarFirebaseSIEsPosible() {
  const config = obtenerConfigFirebaseGuardada();
  if (config && typeof firebase !== "undefined") {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }

      // Silenciar advertencias internas y no críticas del SDK de Firebase (BloomFilter y deprecaciones de persistencia)
      if (firebase.firestore && typeof firebase.firestore.setLogLevel === "function") {
        firebase.firestore.setLogLevel("error");
      }

      _dbFirestore = firebase.firestore();

      // Habilitar la persistencia offline de Firestore en IndexedDB
      try {
        _dbFirestore.enablePersistence({ synchronizeTabs: true }).catch((err) => {
          if (err.code === "failed-precondition") {
            // Múltiples pestañas abiertas
          } else if (err.code === "unimplemented") {
            // Navegador sin soporte offline
          }
        });
      } catch (e) { }

      console.info("🔥 Base de datos Firestore inicializada con soporte offline (IndexedDB).");
      return true;
    } catch (err) {
      console.error("Error al inicializar la base de datos:", err);
      _dbFirestore = null;
      return false;
    }
  }
  return false;
}

// ── Script de Migración Automática ──────────────────────────────
async function migrarMonolitoAColeccionesSiEsNecesario() {
  if (!_dbFirestore) return;
  const tenantId = obtenerDocIdEmpresa();
  try {
    const docAntiguoRef = _dbFirestore.collection("sistema").doc(tenantId);
    const docAntiguoSnap = await docAntiguoRef.get();

    if (docAntiguoSnap.exists) {
      const dataAntigua = docAntiguoSnap.data();
      if (dataAntigua && !dataAntigua.migradoAColecciones) {
        console.info("⚡ Migrando datos del documento monolítico a Colecciones Firestore...");

        if (Array.isArray(dataAntigua.productos)) {
          for (const p of dataAntigua.productos) {
            const id = (p.id || p.codigo || `P-${Date.now()}`).toString();
            await obtenerRefColeccion("productos").doc(id).set(p, { merge: true });
          }
        }
        if (Array.isArray(dataAntigua.ventas)) {
          for (const v of dataAntigua.ventas) {
            const id = (v.id || `V-${Date.now()}`).toString();
            await obtenerRefColeccion("ventas").doc(id).set(v, { merge: true });
          }
        }
        if (Array.isArray(dataAntigua.gastos)) {
          for (const g of dataAntigua.gastos) {
            const id = (g.id || `G-${Date.now()}`).toString();
            await obtenerRefColeccion("gastos").doc(id).set(g, { merge: true });
          }
        }
        if (Array.isArray(dataAntigua.movimientos)) {
          for (const m of dataAntigua.movimientos) {
            const id = (m.id || `M-${Date.now()}`).toString();
            await obtenerRefColeccion("movimientos").doc(id).set(m, { merge: true });
          }
        }
        if (Array.isArray(dataAntigua.cortes)) {
          for (const c of dataAntigua.cortes) {
            const id = (c.id || `CC-${Date.now()}`).toString();
            await obtenerRefColeccion("cortes").doc(id).set(c, { merge: true });
          }
        }

        await obtenerRefDocConfig("corteActivo").set(dataAntigua.corteActivo || {}, { merge: true });
        await obtenerRefDocConfig("general").set({
          config: dataAntigua.config || DEFAULT_CONFIG,
          listas: dataAntigua.listas || DEFAULT_LISTAS,
        }, { merge: true });
        await obtenerRefDocConfig("carritosPendientes").set({
          items: dataAntigua.carritosPendientes || [],
        }, { merge: true });
        await obtenerRefDocConfig("pedidosPersonalizados").set({
          items: dataAntigua.pedidosPersonalizados || [],
        }, { merge: true });

        await docAntiguoRef.set({ migradoAColecciones: true, fechaMigracion: new Date().toISOString() }, { merge: true });
        console.info("🎉 Migración a Colecciones Firestore finalizada con éxito.");
      }
    }
  } catch (err) {
    console.warn("Aviso en verificación de migración de Firestore:", err);
  }
}

// ── initializeApp ─────────────────────────────────────────────
async function initializeApp() {
  mostrarCargando(true);
  inicializarFirebaseSIEsPosible();
  setDefaultDates();
  loadListas();
  cargarConfiguracionSistema();

  let inicializado = false;

  const ejecutarCargaInicial = async (user) => {
    if (inicializado) return;
    inicializado = true;

    if (user) {
      const userEmailEl = document.getElementById("userLoggedEmail");
      if (userEmailEl) userEmailEl.textContent = user.email || "Usuario Activo";
      const cuentaEl = document.getElementById("lblCuentaUsuarioActual");
      if (cuentaEl) cuentaEl.textContent = user.email || "Usuario Activo";
      const modalCuentaEl = document.getElementById("lblModalUsuarioEmail");
      if (modalCuentaEl) modalCuentaEl.textContent = user.email || "Usuario Activo";
    }

    await cargarEstadoLocal();
    await registrarVersionAppEnFirestoreSiEsNecesario();
    mostrarCargando(false);
    loadDashboard();
    iniciarSincronizacionAuto(3000);
  };

  // 🔒 Validación estricta de seguridad (Auth Guard y Carga Multi-usuario)
  if (typeof firebase !== "undefined" && firebase.auth) {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        document.body.style.display = "none";
        window.location.href = "login.html";
      } else {
        document.body.style.display = "block";
        await ejecutarCargaInicial(user);
      }
    });
  } else {
    document.body.style.display = "block";
    await ejecutarCargaInicial(null);
  }
}

async function cerrarSesionFirebase() {
  if (!confirm("¿Deseas cerrar sesión en el sistema?")) return;
  if (typeof firebase !== "undefined" && firebase.auth) {
    await firebase.auth().signOut();
  }
  window.location.href = "login.html";
}

function mostrarCargando(visible) {
  let overlay = document.getElementById("_cargando-overlay");
  if (visible) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "_cargando-overlay";
      overlay.style.cssText = [
        "position:fixed", "inset:0", "z-index:99999",
        "background:rgba(10,10,20,0.82)",
        "display:flex", "flex-direction:column",
        "align-items:center", "justify-content:center",
        "gap:16px", "color:#fff", "font-family:sans-serif"
      ].join(";");
      overlay.innerHTML = `
        <div style="width:48px;height:48px;border:4px solid rgba(255,255,255,.2);
          border-top-color:#6c63ff;border-radius:50%;
          animation:_spin 0.8s linear infinite;"></div>
        <p style="margin:0;font-size:1rem;opacity:.85;">Cargando datos del sistema...</p>
        <style>@keyframes _spin{to{transform:rotate(360deg)}}</style>`;
      document.body.appendChild(overlay);
    }
    overlay.style.display = "flex";
  } else {
    if (overlay) overlay.style.display = "none";
  }
}

function actualizarBadgeSincronizacion(estado, texto) {
  const badge = document.getElementById("syncBadge");
  const dot = document.getElementById("syncBadgeDot");
  const txt = document.getElementById("syncBadgeText");
  if (!badge || !dot || !txt) return;

  if (estado === "online") {
    badge.style.color = "#a7f3d0";
    badge.style.background = "rgba(16, 185, 129, 0.15)";
    badge.style.borderColor = "rgba(16, 185, 129, 0.3)";
    dot.style.background = "#10b981";
  } else if (estado === "saving" || estado === "updated") {
    badge.style.color = "#fef08a";
    badge.style.background = "rgba(234, 179, 8, 0.15)";
    badge.style.borderColor = "rgba(234, 179, 8, 0.3)";
    dot.style.background = "#eab308";
  } else if (estado === "offline") {
    badge.style.color = "#fecaca";
    badge.style.background = "rgba(239, 68, 68, 0.15)";
    badge.style.borderColor = "rgba(239, 68, 68, 0.3)";
    dot.style.background = "#ef4444";
  }
  txt.textContent = texto;
}

// ── Control de Versiones y Nombres de Dispositivos Multi-Equipo ───────
const APP_VERSION = "v2.1.20260824.2152";
let _miRevisionLocal = 0;
let _bannerVersionMostrado = false;

function obtenerNombreDispositivoLocal() {
  let nombre = localStorage.getItem("pos_device_name");
  if (!nombre) {
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const tipo = isMobile ? "Celular/Móvil" : "Caja/PC";
    nombre = `${tipo} ${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    localStorage.setItem("pos_device_name", nombre);
  }
  return nombre;
}

function guardarNombreDispositivoLocal(nuevoNombre) {
  const nombreLimpio = (nuevoNombre || "").trim();
  if (nombreLimpio) {
    localStorage.setItem("pos_device_name", nombreLimpio);
    const input = document.getElementById("inputNombreDispositivo");
    if (input) input.value = nombreLimpio;
    const lblLast = document.getElementById("lblLastDeviceConfig");
    if (lblLast) lblLast.textContent = `${nombreLimpio} (Este equipo)`;
  }
}

function esVersionMasNueva(remota, local) {
  if (!remota || !local) return false;
  const limpiar = (v) => v.toString().replace(/[^0-9]/g, "");
  const numRemota = parseInt(limpiar(remota), 10) || 0;
  const numLocal = parseInt(limpiar(local), 10) || 0;
  return numRemota > numLocal;
}

function actualizarUIIndicadoresVersion(data) {
  if (!data) return;
  const revision = data.dataRevision || 1;
  const dispositivo = data.lastDevice || "Desconocido";
  const fechaIso = data.lastTimestamp || new Date().toISOString();
  const remoteAppVersion = data.appVersion || APP_VERSION;
  const miDispositivo = obtenerNombreDispositivoLocal();

  // 1. Sidebar Badge
  const lblAppSidebar = document.getElementById("lblAppVersionSidebar");
  const lblRevSidebar = document.getElementById("lblDataRevisionSidebar");
  if (lblAppSidebar) lblAppSidebar.textContent = APP_VERSION;
  if (lblRevSidebar) lblRevSidebar.textContent = `Rev #${revision}`;

  // 2. Settings View
  const lblAppConfig = document.getElementById("lblAppVersionConfig");
  const lblRevConfig = document.getElementById("lblDataRevisionConfig");
  const lblLastDeviceConfig = document.getElementById("lblLastDeviceConfig");
  const lblLastTimestampConfig = document.getElementById("lblLastTimestampConfig");
  const inputDispositivo = document.getElementById("inputNombreDispositivo");

  if (lblAppConfig) lblAppConfig.textContent = APP_VERSION;
  if (lblRevConfig) lblRevConfig.textContent = `Rev #${revision}`;
  if (lblLastDeviceConfig) {
    lblLastDeviceConfig.textContent = dispositivo === miDispositivo ? `${dispositivo} (Este equipo)` : dispositivo;
  }
  if (lblLastTimestampConfig) {
    lblLastTimestampConfig.textContent = obtenerFechaHoraLocalTexto(fechaIso);
  }
  if (inputDispositivo && !inputDispositivo.value) {
    inputDispositivo.value = miDispositivo;
  }

  // 3. Sincronizar versión actual hacia la nube si la local es más reciente o la nube tenía versión vieja
  if (esVersionMasNueva(APP_VERSION, remoteAppVersion) || remoteAppVersion === "2.1.0") {
    obtenerRefDocConfig("version").set({
      appVersion: APP_VERSION,
      lastDevice: miDispositivo,
      lastTimestamp: new Date().toISOString()
    }, { merge: true }).catch(() => { });
  }

  // 4. Notificación si otro equipo hizo una modificación reciente
  if (_miRevisionLocal > 0 && revision > _miRevisionLocal && dispositivo !== miDispositivo) {
    actualizarBadgeSincronizacion("updated", `¡Cambios de ${dispositivo}!`);
    setTimeout(() => actualizarBadgeSincronizacion("online", "En Línea"), 3000);
  }

  // 5. Solo mostrar banner si la versión en la nube es estrictamente MÁS NUEVA que la actual
  if (esVersionMasNueva(remoteAppVersion, APP_VERSION) && !_bannerVersionMostrado) {
    _bannerVersionMostrado = true;
    mostrarBannerNuevaVersion(remoteAppVersion);
  }

  _miRevisionLocal = revision;
}

async function registrarVersionAppEnFirestoreSiEsNecesario() {
  if (!_dbFirestore) return;
  try {
    const tenantId = obtenerDocIdEmpresa();
    const docRef = obtenerRefDocConfig("version");
    const miDispositivo = obtenerNombreDispositivoLocal();

    await Promise.all([
      docRef.set({
        appVersion: APP_VERSION,
        lastDevice: miDispositivo,
        lastTimestamp: new Date().toISOString()
      }, { merge: true }),
      _dbFirestore.collection("sistema").doc(tenantId).set({
        appVersion: APP_VERSION,
        actualizadoEn: new Date().toISOString()
      }, { merge: true })
    ]);
    console.info(`📌 Versión [${APP_VERSION}] registrada exitosamente en Firestore.`);
  } catch (err) {
    console.warn("Aviso al registrar versión en Firestore:", err);
  }
}

function mostrarBannerNuevaVersion(nuevaVer) {
  let banner = document.getElementById("bannerNuevaVersionApp");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "bannerNuevaVersionApp";
    banner.style.cssText = "position:fixed;bottom:20px;right:20px;z-index:99999;background:#0f172a;color:white;padding:12px 18px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.4);display:flex;align-items:center;gap:12px;border:1px solid #38bdf8;";
    banner.innerHTML = `
      <span>🚀 Hay una actualización disponible (<strong>${nuevaVer}</strong>).</span>
      <button class="btn btn-sm btn-primary" onclick="recargarAplicacionSinCache()" style="padding:4px 10px;font-size:0.8rem;">Recargar</button>
      <button type="button" onclick="document.getElementById('bannerNuevaVersionApp').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.1rem;cursor:pointer;padding:0 4px;" title="Cerrar">✕</button>
    `;
    document.body.appendChild(banner);
  }
}

function recargarAplicacionSinCache() {
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now());
  window.location.replace(url.toString());
}

async function forzarSincronizacionTotal(mostrarAlerta = false) {
  mostrarCargando(true);
  try {
    await cargarEstadoLocal();
    refrescarVistaActual();
    mostrarCargando(false);
    if (mostrarAlerta) {
      alert("✅ Sincronización completa con la nube realizada con éxito.");
    }
  } catch (err) {
    mostrarCargando(false);
    if (mostrarAlerta) {
      alert("⚠️ Error al sincronizar con la nube: " + err.message);
    }
  }
}

// ── Guardado y Carga por Lotes / Chunks (Agrupación de 150 registros por Documento) ──
const TAMANO_CHUNK_DEFAULT = 150;

async function guardarColeccionChunked(nombreColeccion, arrayItems, chunkSize = TAMANO_CHUNK_DEFAULT) {
  if (!_dbFirestore) return;
  const items = Array.isArray(arrayItems) ? arrayItems : [];
  const totalChunks = Math.ceil(items.length / chunkSize) || 1;
  const coleccionRef = obtenerRefColeccion("chunks_" + nombreColeccion);
  if (!coleccionRef) return;

  const batch = _dbFirestore.batch();

  // 1. Guardar cada chunk de datos
  for (let i = 0; i < totalChunks; i++) {
    const chunkItems = items.slice(i * chunkSize, (i + 1) * chunkSize);
    const chunkDocRef = coleccionRef.doc(`chunk_${i}`);
    batch.set(chunkDocRef, {
      chunkIndex: i,
      items: chunkItems,
      totalItems: chunkItems.length,
      updatedAt: new Date().toISOString()
    });
  }

  // 2. Guardar metadata del manifest
  const metaDocRef = coleccionRef.doc("_manifest");
  batch.set(metaDocRef, {
    totalChunks,
    totalCount: items.length,
    chunkSize,
    updatedAt: new Date().toISOString()
  });

  await batch.commit();

  // 3. Limpiar chunks sobrantes si el array disminuyó
  try {
    const snap = await coleccionRef.get();
    const batchCleanup = _dbFirestore.batch();
    let huboSobrantes = false;
    snap.docs.forEach((d) => {
      if (d.id.startsWith("chunk_")) {
        const idx = parseInt(d.id.replace("chunk_", ""), 10);
        if (idx >= totalChunks) {
          batchCleanup.delete(d.ref);
          huboSobrantes = true;
        }
      }
    });
    if (huboSobrantes) await batchCleanup.commit();
  } catch (_) { }
}

async function cargarColeccionChunked(nombreColeccion) {
  if (!_dbFirestore) return [];
  try {
    const coleccionRef = obtenerRefColeccion("chunks_" + nombreColeccion);
    if (!coleccionRef) return [];

    const snap = await coleccionRef.get();
    if (snap.empty) {
      // Fallback: si aún no existen chunks, intentar leer de la colección individual antigua
      const snapAntigua = await obtenerRefColeccion(nombreColeccion).get();
      if (!snapAntigua.empty) {
        const dataAntigua = snapAntigua.docs.map((d) => d.data());
        guardarColeccionChunked(nombreColeccion, dataAntigua).catch(() => { });
        return dataAntigua;
      }
      return [];
    }

    const chunkDocs = snap.docs
      .filter((d) => d.id.startsWith("chunk_"))
      .sort((a, b) => {
        const idxA = parseInt(a.id.replace("chunk_", ""), 10) || 0;
        const idxB = parseInt(b.id.replace("chunk_", ""), 10) || 0;
        return idxA - idxB;
      });

    const resultado = [];
    chunkDocs.forEach((d) => {
      const data = d.data();
      if (Array.isArray(data.items)) {
        resultado.push(...data.items);
      }
    });
    return resultado;
  } catch (err) {
    console.warn(`Aviso al cargar chunks de ${nombreColeccion}:`, err);
    return [];
  }
}

// ── guardarEstadoLocal (con debounce 800ms y respaldo inmediato) ───────
function guardarEstadoLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localDB));
  } catch (_) { }
  clearTimeout(_saveDebounceTimer);
  _saveDebounceTimer = setTimeout(_persistirEnServidor, 800);
}

async function _persistirEnServidor() {
  _isPersisting = true;
  actualizarBadgeSincronizacion("saving", "Guardando...");

  if (_dbFirestore) {
    try {
      await Promise.all([
        _dbFirestore.collection("sistema").doc(obtenerDocIdEmpresa()).set({
          nombreNegocio: (localDB.config && localDB.config.businessName) || "Mi Negocio",
          actualizadoEn: new Date().toISOString(),
          appVersion: APP_VERSION,
          estado: "activo"
        }, { merge: true }),
        obtenerRefDocConfig("corteActivo").set(localDB.corteActivo || {}),
        obtenerRefDocConfig("general").set({
          config: localDB.config || DEFAULT_CONFIG,
          listas: localDB.listas || DEFAULT_LISTAS,
        }),
        obtenerRefDocConfig("sucursales").set({ items: localDB.sucursales || DEFAULT_SUCURSALES }),
        obtenerRefDocConfig("carritosPendientes").set({ items: localDB.carritosPendientes || [] }),
        obtenerRefDocConfig("pedidosPersonalizados").set({ items: localDB.pedidosPersonalizados || [] }),
        guardarColeccionChunked("productos", localDB.productos),
        guardarColeccionChunked("ventas", localDB.ventas),
        guardarColeccionChunked("gastos", localDB.gastos),
        guardarColeccionChunked("movimientos", localDB.movimientos),
        guardarColeccionChunked("cortes", localDB.cortes),
        obtenerRefDocConfig("version").set({
          appVersion: APP_VERSION,
          dataRevision: firebase.firestore.FieldValue.increment(1),
          lastDevice: obtenerNombreDispositivoLocal(),
          lastTimestamp: new Date().toISOString()
        }, { merge: true })
      ]);

      localStorage.removeItem(STORAGE_KEY + "_backup");
      actualizarBadgeSincronizacion("online", "En Línea");
      return;
    } catch (err) {
      console.warn("🔥 Error al guardar estado en Firestore:", err);
      actualizarBadgeSincronizacion("offline", "Modo Sin Conexión");
      try {
        localStorage.setItem(STORAGE_KEY + "_backup", JSON.stringify(localDB));
      } catch (e) { }
      return;
    } finally {
      _isPersisting = false;
    }
  }

  // Fallback: Servidor Backend Local HTTP (/api/db)
  try {
    const rawBody = JSON.stringify(localDB);
    const res = await fetch(API_DB, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _lastServerJsonString = rawBody;
    localStorage.removeItem(STORAGE_KEY + "_backup");
    actualizarBadgeSincronizacion("online", "En Línea");
  } catch (err) {
    console.warn("Servidor local no disponible, guardando en localStorage como respaldo:", err.message);
    actualizarBadgeSincronizacion("offline", "Modo Sin Conexión");
    try {
      localStorage.setItem(STORAGE_KEY + "_backup", JSON.stringify(localDB));
    } catch (e) {
      console.error("No se pudo guardar respaldo en localStorage:", e);
    }
  } finally {
    _isPersisting = false;
  }
}

// ── Observable / Sincronización Automática Ultra-Eficiente en Tiempo Real ───────────
function iniciarSincronizacionAuto(intervalMs = 3000) {
  if (_unsubscribeFirestore) {
    if (Array.isArray(_unsubscribeFirestore)) {
      _unsubscribeFirestore.forEach((u) => u && u());
    } else {
      _unsubscribeFirestore();
    }
    _unsubscribeFirestore = null;
  }
  if (_syncPollInterval) {
    clearInterval(_syncPollInterval);
    _syncPollInterval = null;
  }

  // Si Firestore está habilitado, usamos escuchadores optimizados por documento único
  if (_dbFirestore) {
    actualizarBadgeSincronizacion("online", "En Línea");
    const unsubs = [];

    // 1. Escuchador en Tiempo Real para Chunks de Productos (Catálogo escalable)
    unsubs.push(
      obtenerRefColeccion("chunks_productos").onSnapshot(
        (snapshot) => {
          if (_isPersisting) return;
          if (!snapshot.empty) {
            const chunkDocs = snapshot.docs
              .filter((d) => d.id.startsWith("chunk_"))
              .sort((a, b) => {
                const idxA = parseInt(a.id.replace("chunk_", ""), 10) || 0;
                const idxB = parseInt(b.id.replace("chunk_", ""), 10) || 0;
                return idxA - idxB;
              });
            const productosActualizados = [];
            chunkDocs.forEach((d) => {
              const data = d.data();
              if (Array.isArray(data.items)) {
                productosActualizados.push(...data.items);
              }
            });
            if (productosActualizados.length > 0) {
              localDB.productos = productosActualizados;
              refrescarVistaActual();
            }
          }
        },
        (err) => console.warn("Suscripción a chunks de productos:", err)
      )
    );

    // 2. Escuchador en Tiempo Real para el Corte Activo (Apertura y Cierre de Turno en vivo)
    unsubs.push(
      obtenerRefDocConfig("corteActivo").onSnapshot(
        (doc) => {
          if (_isPersisting) return;
          localDB.corteActivo = doc.exists && doc.data().id ? doc.data() : null;
          renderEstadoCorteActual();
          actualizarResumenCorteActual();
          if (currentTab === "cortes") mostrarReporteCortes(true);
        },
        (err) => console.warn("Suscripción a corte activo:", err)
      )
    );

    // 3. Escuchador en Tiempo Real para Configuración General (nombre negocio, listas)
    unsubs.push(
      obtenerRefDocConfig("general").onSnapshot(
        (doc) => {
          if (_isPersisting) return;
          if (doc.exists) {
            const d = doc.data();
            if (d.config) localDB.config = { ...DEFAULT_CONFIG, ...d.config };
            if (d.listas) localDB.listas = d.listas;
            cargarConfiguracionSistema();
          }
        },
        (err) => console.warn("Suscripción a config general:", err)
      )
    );

    // 4. Escuchador en Tiempo Real para Sucursales
    unsubs.push(
      obtenerRefDocConfig("sucursales").onSnapshot(
        (doc) => {
          if (_isPersisting) return;
          if (doc.exists && Array.isArray(doc.data().items)) {
            localDB.sucursales = doc.data().items;
            renderSelectorSucursal();
            renderizarTablaSucursales();
          }
        },
        (err) => console.warn("Suscripción a sucursales:", err)
      )
    );

    // 5. Escuchador en Tiempo Real para Pedidos Personalizados
    unsubs.push(
      obtenerRefDocConfig("pedidosPersonalizados").onSnapshot(
        (doc) => {
          if (_isPersisting) return;
          if (doc.exists && Array.isArray(doc.data().items)) {
            localDB.pedidosPersonalizados = doc.data().items;
            if (currentTab === "pedidos") renderizarModuloPedidos();
          }
        },
        (err) => console.warn("Suscripción a pedidos:", err)
      )
    );

    // 6. Escuchador en Tiempo Real para Carritos Pendientes
    unsubs.push(
      obtenerRefDocConfig("carritosPendientes").onSnapshot(
        (doc) => {
          if (_isPersisting) return;
          if (doc.exists && Array.isArray(doc.data().items)) {
            localDB.carritosPendientes = doc.data().items;
            if (currentTab === "ventas") renderCarritosPendientes();
          }
        },
        (err) => console.warn("Suscripción a carritos pendientes:", err)
      )
    );

    // 7. Escuchador en Tiempo Real para Ventas del Turno Activo / Hoy
    let fechaInicioSyncVentas = localDB.corteActivo && localDB.corteActivo.fechaApertura
      ? localDB.corteActivo.fechaApertura
      : new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

    unsubs.push(
      obtenerRefColeccion("ventas")
        .where("fecha", ">=", fechaInicioSyncVentas)
        .onSnapshot(
          (snapshot) => {
            if (_isPersisting) return;
            let huboCambios = false;
            snapshot.docChanges().forEach((change) => {
              const data = change.doc.data();
              if (change.type === "added" || change.type === "modified") {
                const idx = localDB.ventas.findIndex((v) => v.id === data.id);
                if (idx >= 0) {
                  localDB.ventas[idx] = data;
                } else {
                  localDB.ventas.push(data);
                }
                huboCambios = true;
              } else if (change.type === "removed") {
                localDB.ventas = localDB.ventas.filter((v) => v.id !== change.doc.id);
                huboCambios = true;
              }
            });
            if (huboCambios) {
              refrescarVistaActual();
            }
          },
          (err) => console.warn("Suscripción a ventas en vivo:", err)
        )
    );

    // 8. Escuchador en Tiempo Real para Gastos del Turno Activo / Hoy
    unsubs.push(
      obtenerRefColeccion("gastos")
        .where("fecha", ">=", fechaInicioSyncVentas)
        .onSnapshot(
          (snapshot) => {
            if (_isPersisting) return;
            let huboCambios = false;
            snapshot.docChanges().forEach((change) => {
              const data = change.doc.data();
              if (change.type === "added" || change.type === "modified") {
                const idx = localDB.gastos.findIndex((g) => g.id === data.id);
                if (idx >= 0) {
                  localDB.gastos[idx] = data;
                } else {
                  localDB.gastos.push(data);
                }
                huboCambios = true;
              } else if (change.type === "removed") {
                localDB.gastos = localDB.gastos.filter((g) => g.id !== change.doc.id);
                huboCambios = true;
              }
            });
            if (huboCambios) {
              refrescarVistaActual();
            }
          },
          (err) => console.warn("Suscripción a gastos en vivo:", err)
        )
    );

    // 9. Escuchador en Tiempo Real para Control de Versiones y Revisiones Multi-Equipo
    unsubs.push(
      obtenerRefDocConfig("version").onSnapshot(
        (doc) => {
          if (doc.exists) {
            actualizarUIIndicadoresVersion(doc.data());
          }
        },
        (err) => console.warn("Suscripción a control de versiones:", err)
      )
    );

    // 10. Escuchador en Tiempo Real para Cortes Cerrados (Historial en vivo)
    unsubs.push(
      obtenerRefColeccion("cortes")
        .limit(100)
        .onSnapshot(
          (snapshot) => {
            if (_isPersisting) return;
            let huboCambios = false;
            snapshot.docChanges().forEach((change) => {
              const data = change.doc.data();
              if (change.type === "added" || change.type === "modified") {
                const idx = localDB.cortes.findIndex((c) => c.id === data.id);
                if (idx >= 0) {
                  localDB.cortes[idx] = data;
                } else {
                  localDB.cortes.push(data);
                }
                huboCambios = true;
              } else if (change.type === "removed") {
                localDB.cortes = localDB.cortes.filter((c) => c.id !== change.doc.id);
                huboCambios = true;
              }
            });
            if (huboCambios && currentTab === "cortes") {
              mostrarReporteCortes(true);
            }
          },
          (err) => console.warn("Suscripción a cortes en vivo:", err)
        )
    );

    _unsubscribeFirestore = unsubs;
    return;
  }

  // Fallback Polling para servidor HTTP local (solo si estamos en red local)
  if (window.location.protocol === "file:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    _syncPollInterval = setInterval(async () => {
      if (_saveDebounceTimer || _isPersisting) return;

      try {
        const res = await fetch(API_DB);
        if (!res.ok) {
          actualizarBadgeSincronizacion("offline", "Sin conexión");
          return;
        }
        const data = await res.json();
        if (!validarEstructuraEstado(data)) return;

        const serverJson = JSON.stringify(data);

        if (!_lastServerJsonString) {
          _lastServerJsonString = serverJson;
          actualizarBadgeSincronizacion("online", "En Línea");
          return;
        }

        if (serverJson !== _lastServerJsonString && serverJson !== JSON.stringify(localDB)) {
          console.info("⚡ Cambio detectado en el servidor local desde otra computadora. Actualizando...");
          _lastServerJsonString = serverJson;
          _aplicarDatosALocalDB(data);
          refrescarVistaActual();
          actualizarBadgeSincronizacion("updated", "¡Datos actualizados!");
          setTimeout(() => {
            actualizarBadgeSincronizacion("online", "En Línea");
          }, 2500);
        } else {
          actualizarBadgeSincronizacion("online", "En Línea");
        }
      } catch (err) {
        actualizarBadgeSincronizacion("offline", "Sin conexión");
      }
    }, intervalMs);
  }
}

function refrescarVistaActual() {
  loadDashboard();
  if (currentTab === "inventario") mostrarStock();
  if (currentTab === "ventas") {
    renderVentasRecientes();
    renderCarritosPendientes();
  }
  if (currentTab === "pedidos") renderizarModuloPedidos();
  if (currentTab === "gastos") renderGastosRecientes();
  if (currentTab === "cortes") {
    cargarModuloCortes();
    actualizarResumenCorteActual();
  }
  renderSelectorSucursal();
}

// ── cargarEstadoLocal ─────────────────────────────────────────
function _aplicarDatosALocalDB(data) {
  localDB.sucursales = Array.isArray(data.sucursales) && data.sucursales.length > 0 ? data.sucursales : [...DEFAULT_SUCURSALES];
  localDB.productos = Array.isArray(data.productos) ? data.productos : [];
  localDB.movimientos = Array.isArray(data.movimientos) ? data.movimientos : [];
  localDB.ventas = Array.isArray(data.ventas) ? data.ventas : [];
  localDB.gastos = Array.isArray(data.gastos) ? data.gastos : [];
  let migrado = false;
  localDB.cortes = (Array.isArray(data.cortes) ? data.cortes : []).map((corte, idx) => {
    if (!corte.id) {
      const timestamp = new Date(corte.fechaCierre || corte.fechaApertura || Date.now()).getTime() || Date.now();
      corte.id = `CC-MIG-${idx}-${timestamp}`;
      migrado = true;
    }
    return corte;
  });
  if (migrado) guardarEstadoLocal();
  localDB.corteActivo =
    data.corteActivo && typeof data.corteActivo === "object"
      ? data.corteActivo
      : null;
  localDB.carritosPendientes = Array.isArray(data.carritosPendientes)
    ? data.carritosPendientes
    : [];
  localDB.pedidosPersonalizados = Array.isArray(data.pedidosPersonalizados)
    ? data.pedidosPersonalizados
    : [];
  localDB.config = {
    ...DEFAULT_CONFIG,
    ...(data.config && typeof data.config === "object" ? data.config : {}),
  };
  if (
    data.listas &&
    Array.isArray(data.listas.unidades) &&
    Array.isArray(data.listas.grupos)
  ) {
    localDB.listas = data.listas;
  }
}

async function cargarEstadoLocal() {
  if (_dbFirestore) {
    try {
      await migrarMonolitoAColeccionesSiEsNecesario();

      // 1. Cargar Catálogo de Productos mediante Chunks
      const productosChunks = await cargarColeccionChunked("productos");
      if (productosChunks.length > 0) {
        localDB.productos = productosChunks;
      } else {
        // Fallback si aún estaban en documento antiguo
        const catalogoSnap = await obtenerRefDocConfig("catalogoProductos").get();
        if (catalogoSnap.exists && Array.isArray(catalogoSnap.data().items) && catalogoSnap.data().items.length > 0) {
          localDB.productos = catalogoSnap.data().items;
          await guardarColeccionChunked("productos", localDB.productos);
        }
      }
      obtenerRefDocConfig("catalogoProductos").delete().catch(() => { });

      // 2. Cargar configuraciones del sistema (5 documentos individuales rápidos)
      const [corteActivoSnap, genSnap, sucursalesSnap, carritosSnap, pedidosSnap] = await Promise.all([
        obtenerRefDocConfig("corteActivo").get(),
        obtenerRefDocConfig("general").get(),
        obtenerRefDocConfig("sucursales").get(),
        obtenerRefDocConfig("carritosPendientes").get(),
        obtenerRefDocConfig("pedidosPersonalizados").get()
      ]);

      localDB.corteActivo = corteActivoSnap.exists && corteActivoSnap.data().id ? corteActivoSnap.data() : null;

      if (genSnap.exists) {
        const d = genSnap.data();
        localDB.config = { ...DEFAULT_CONFIG, ...(d.config || {}) };
        if (d.listas) localDB.listas = d.listas;
      }

      if (sucursalesSnap.exists && Array.isArray(sucursalesSnap.data().items) && sucursalesSnap.data().items.length > 0) {
        localDB.sucursales = sucursalesSnap.data().items;
      } else {
        localDB.sucursales = [...DEFAULT_SUCURSALES];
      }

      localDB.carritosPendientes = carritosSnap.exists && Array.isArray(carritosSnap.data().items) ? carritosSnap.data().items : [];
      localDB.pedidosPersonalizados = pedidosSnap.exists && Array.isArray(pedidosSnap.data().items) ? pedidosSnap.data().items : [];

      // 3. Carga ultra-eficiente de operaciones mediante Chunks (bloques de 150 registros por documento)
      const [ventasChunks, gastosChunks, movChunks, cortesChunks] = await Promise.all([
        cargarColeccionChunked("ventas"),
        cargarColeccionChunked("gastos"),
        cargarColeccionChunked("movimientos"),
        cargarColeccionChunked("cortes")
      ]);

      if (ventasChunks.length > 0 || !localDB.ventas.length) localDB.ventas = ventasChunks;
      if (gastosChunks.length > 0 || !localDB.gastos.length) localDB.gastos = gastosChunks;
      if (movChunks.length > 0 || !localDB.movimientos.length) localDB.movimientos = movChunks;
      if (cortesChunks.length > 0 || !localDB.cortes.length) localDB.cortes = cortesChunks;

      renderSelectorSucursal();
      renderizarTablaSucursales();
      actualizarBadgeSincronizacion("online", "En Línea");
      return;
    } catch (err) {
      console.warn("🔥 Error al leer colecciones de Firestore, usando respaldo local:", err);
    }
  }

  // 2. Intentar cargar desde servidor local HTTP (/api/db) si estamos en red local
  if (window.location.protocol === "file:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    try {
      const res = await fetch(API_DB);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (validarEstructuraEstado(data)) {
        _aplicarDatosALocalDB(data);
        _lastServerJsonString = JSON.stringify(data);

        const rawLocal = localStorage.getItem(STORAGE_KEY);
        if (rawLocal) {
          try {
            const dataLocal = JSON.parse(rawLocal);
            if (
              validarEstructuraEstado(dataLocal) &&
              dataLocal.productos.length > 0 &&
              data.productos.length === 0
            ) {
              _aplicarDatosALocalDB(dataLocal);
              await _persistirEnServidor();
              localStorage.removeItem(STORAGE_KEY);
            }
          } catch (_) { }
        }
        renderSelectorSucursal();
        renderizarTablaSucursales();
        return;
      }
    } catch (err) {
      console.warn("No se pudo conectar al servidor local, usando respaldo localStorage:", err.message);
    }
  }

  // 3. Fallback: intentar localStorage
  const claves = [STORAGE_KEY + "_backup", STORAGE_KEY];
  for (const clave of claves) {
    try {
      const raw = localStorage.getItem(clave);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (validarEstructuraEstado(data)) {
        _aplicarDatosALocalDB(data);
        console.info(`Datos cargados desde localStorage (${clave}).`);
        renderSelectorSucursal();
        renderizarTablaSucursales();
        return;
      }
    } catch (_) { }
  }
  renderSelectorSucursal();
  renderizarTablaSucursales();
}

function validarEstructuraEstado(data) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.productos) || !Array.isArray(data.movimientos))
    return false;
  if (data.ventas && !Array.isArray(data.ventas)) return false;
  if (data.gastos && !Array.isArray(data.gastos)) return false;
  if (data.cortes && !Array.isArray(data.cortes)) return false;
  if (data.corteActivo && typeof data.corteActivo !== "object") return false;
  if (data.carritosPendientes && !Array.isArray(data.carritosPendientes))
    return false;
  if (data.pedidosPersonalizados && !Array.isArray(data.pedidosPersonalizados))
    return false;
  if (data.config && typeof data.config !== "object") return false;
  if (!data.listas || typeof data.listas !== "object") return false;
  if (
    !Array.isArray(data.listas.unidades) ||
    !Array.isArray(data.listas.grupos)
  )
    return false;
  return true;
}

function normalizeCode(value) {
  return (value || "").toString().trim().toUpperCase();
}

function parseNumber(value, fallback = 0) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function slugifyCode(value) {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function generarCodigoSugeridoProducto() {
  const existentes = new Set(
    localDB.productos.map((p) => normalizeCode(p.codigo)),
  );
  let codigo = "";
  do {
    codigo = Math.floor(10000000 + Math.random() * 90000000).toString();
  } while (existentes.has(normalizeCode(codigo)));

  const codigoField = document.getElementById("codigoProd");
  if (codigoField) codigoField.value = codigo;
  showMessage("msgProd", `Código sugerido generado: ${codigo}.`, "info");
  return codigo;
}

function sugerirCodigoProductoSiHaceFalta() {
  const codigoField = document.getElementById("codigoProd");
  if (!codigoField || normalizeCode(codigoField.value))
    return codigoField ? codigoField.value : "";
  return generarCodigoSugeridoProducto();
}

function sanitizarCodigoParaBarcode(codigo) {
  return normalizeCode(codigo).replace(/[^A-Z0-9\-\.\$\/\+% ]/g, "");
}

const CODE39_PATTERNS = {
  0: "nnnwwnwnn",
  1: "wnnwnnnnw",
  2: "nnwwnnnnw",
  3: "wnwwnnnnn",
  4: "nnnwwnnnw",
  5: "wnnwwnnnn",
  6: "nnwwwnnnn",
  7: "nnnwnnwnw",
  8: "wnnwnnwnn",
  9: "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function construirCode39Data(codigo) {
  const texto = sanitizarCodigoParaBarcode(codigo);
  const contenido = `*${texto}*`;
  const narrow = 2;
  const wide = 6;
  const gap = 2;
  const barHeight = 90;
  let x = 10;
  let body = "";

  for (const caracter of contenido) {
    const pattern = CODE39_PATTERNS[caracter];
    if (!pattern) continue;

    for (let i = 0; i < pattern.length; i += 1) {
      const width = pattern[i] === "w" ? wide : narrow;
      if (i % 2 === 0) {
        body += `<rect x="${x}" y="10" width="${width}" height="${barHeight}" fill="#111" />`;
      }
      x += width;
    }
    x += gap;
  }

  return {
    texto,
    body,
    widthTotal: Math.max(220, x + 10),
    barHeight,
  };
}

function imprimirCodigoProducto(codigo, nombre = "") {
  const codigoFinal = sanitizarCodigoParaBarcode(
    codigo || sugerirCodigoProductoSiHaceFalta(),
  );
  if (!codigoFinal) {
    showMessage(
      "msgProd",
      "Primero genere o escriba un código válido.",
      "warning",
    );
    return;
  }

  const { body, widthTotal } = construirCode39Data(codigoFinal);
  const paddingX = 28;
  const canvasWidth = widthTotal + paddingX * 2;
  const canvasHeight = 240;
  const canvasWidthCm = (canvasWidth / 96) * 2.54;
  const exportWidthCm = roundTo(Math.min(8, canvasWidthCm), 2);
  const exportHeightCm = roundTo(
    (canvasHeight / canvasWidth) * exportWidthCm,
    2,
  );
  const titulo = escapeXml(nombre || "Etiqueta de producto");
  const codigoTexto = escapeXml(codigoFinal);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${exportWidthCm}cm" height="${exportHeightCm}cm" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
      <rect width="100%" height="100%" rx="18" fill="#fff" />
      <text x="${canvasWidth / 2}" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#111">${titulo}</text>
      <text x="${canvasWidth / 2}" y="68" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#555">${codigoTexto}</text>
      <g transform="translate(${paddingX}, 78)">
        <rect width="${widthTotal}" height="140" fill="#fff" />
        ${body}
        <text x="${widthTotal / 2}" y="126" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" fill="#111">${codigoTexto}</text>
      </g>
    </svg>
  `;

  descargarArchivo(
    `codigo-${codigoFinal}.svg`,
    svg,
    "image/svg+xml;charset=utf-8",
  );
  showMessage(
    "msgProd",
    "Código de barras guardado como imagen SVG.",
    "success",
  );
}

function abrirModalPrecioVariableVenta(producto) {
  return new Promise((resolve) => {
    resolverPrecioVariableVenta = resolve;
    productoPrecioVariableVenta = producto;

    const modal = document.getElementById("modalPrecioVariableVenta");
    const titulo = document.getElementById("modalPrecioVariableVentaTitulo");
    const texto = document.getElementById("modalPrecioVariableVentaTexto");
    const input = document.getElementById("precioVariableVentaInput");

    if (titulo) titulo.textContent = "Precio variable de venta";
    if (texto)
      texto.textContent = `Ingrese el precio de venta para ${producto.nombre} (${producto.codigo}).`;
    if (input) {
      input.value = "";
      input.focus();
    }

    if (modal) {
      modal.classList.add("open");
      modal.setAttribute("aria-hidden", "false");
    }
  });
}

function cerrarModalPrecioVariableVenta(valor = null) {
  const modal = document.getElementById("modalPrecioVariableVenta");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }

  const resolver = resolverPrecioVariableVenta;
  resolverPrecioVariableVenta = null;
  productoPrecioVariableVenta = null;

  if (typeof resolver === "function") {
    resolver(valor);
  }
}

function confirmarModalPrecioVariableVenta() {
  const input = document.getElementById("precioVariableVentaInput");
  const precio = parseNumber(input ? input.value : 0, 0);

  if (!Number.isFinite(precio) || precio <= 0) {
    showMessage("msgVenta", "Ingrese un precio válido mayor a 0.", "warning");
    if (input) input.focus();
    return;
  }

  cerrarModalPrecioVariableVenta(roundTo(precio, 4));
}

function cancelarModalPrecioVariableVenta() {
  cerrarModalPrecioVariableVenta(null);
}

function actualizarPrecioVariableProducto() {
  const checkbox = document.getElementById("precioVariableProd");
  const priceField = document.getElementById("precioVentaProd");
  if (!checkbox || !priceField) return;

  priceField.required = !checkbox.checked;
  priceField.placeholder = checkbox.checked
    ? "Opcional. Se capturará manualmente al vender"
    : "Precio real que se usará en ventas";
}

function actualizarPrecioVariableProductoEdicion() {
  const checkbox = document.getElementById("editPrecioVariableProd");
  const priceField = document.getElementById("editPrecioVentaProd");
  if (!checkbox || !priceField) return;

  priceField.required = !checkbox.checked;
  priceField.placeholder = checkbox.checked
    ? "Opcional. Se capturará manualmente al vender"
    : "Precio real que se usará en ventas";
}

function roundTo(value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatMoney(value) {
  return `$${roundTo(parseNumber(value, 0), 2).toFixed(2)}`;
}

function formatDate(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  if (Number.isNaN(date.getTime())) {
    return "Fecha invalida";
  }
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const time = date.toLocaleTimeString();
  return `${day}/${month}/${year} ${time}`;
}

function formatDateOnly(date) {
  if (!(date instanceof Date)) {
    date = new Date(date);
  }
  if (Number.isNaN(date.getTime())) {
    return "Fecha invalida";
  }
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function setDefaultDates() {
  const now = new Date();

  // Construir la fecha local como string YYYY-MM-DD para evitar el desfase UTC
  function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const todayStr = toLocalDateString(now);
  const monthAgoDate = new Date(now);
  monthAgoDate.setMonth(monthAgoDate.getMonth() - 1);
  const monthAgoStr = toLocalDateString(monthAgoDate);

  document.getElementById("fechaMov").value = todayStr;
  const fechaGasto = document.getElementById("fechaGasto");
  if (fechaGasto) fechaGasto.value = todayStr;
  document.getElementById("fechaDesde").value = monthAgoStr;
  document.getElementById("fechaHasta").value = todayStr;

  const fechaDesdeVentas = document.getElementById("fechaDesdeVentas");
  const fechaHastaVentas = document.getElementById("fechaHastaVentas");
  if (fechaDesdeVentas) fechaDesdeVentas.value = monthAgoStr;
  if (fechaHastaVentas) fechaHastaVentas.value = todayStr;

  const fechaDesdeGastos = document.getElementById("fechaDesdeGastos");
  const fechaHastaGastos = document.getElementById("fechaHastaGastos");
  if (fechaDesdeGastos) fechaDesdeGastos.value = monthAgoStr;
  if (fechaHastaGastos) fechaHastaGastos.value = todayStr;

  const fechaDesdeCorte = document.getElementById("fechaDesdeCorte");
  const fechaHastaCorte = document.getElementById("fechaHastaCorte");
  if (fechaDesdeCorte) fechaDesdeCorte.value = monthAgoStr;
  if (fechaHastaCorte) fechaHastaCorte.value = todayStr;

  const fechaDesdeResumen = document.getElementById("fechaDesdeResumen");
  const fechaHastaResumen = document.getElementById("fechaHastaResumen");
  if (fechaDesdeResumen) fechaDesdeResumen.value = monthAgoStr;
  if (fechaHastaResumen) fechaHastaResumen.value = todayStr;
}

function showTab(tabName, clickedElement = null) {
  document
    .querySelectorAll(".tab-content")
    .forEach((tab) => tab.classList.remove("active"));
  document
    .querySelectorAll(".nav-link")
    .forEach((link) => link.classList.remove("active"));

  document.getElementById(tabName).classList.add("active");
  if (clickedElement) {
    clickedElement.classList.add("active");
  } else {
    const target = Array.from(document.querySelectorAll(".nav-link")).find(
      (link) =>
        link.getAttribute("onclick") &&
        link.getAttribute("onclick").includes(`'${tabName}'`),
    );
    if (target) target.classList.add("active");
  }

  currentTab = tabName;

  if (tabName === "dashboard") {
    loadDashboard();
  }
  if (tabName === "inventario") {
    mostrarStock();
  }
  if (tabName === "ventas") {
    renderVentaCarrito();
    renderVentasRecientes();
    renderCarritosPendientes();
    actualizarTotalesPagoVenta();
    const inputCodigo = document.getElementById("codigoVenta");
    if (inputCodigo) inputCodigo.focus();
  }
  if (tabName === "gastos") {
    renderGastosRecientes();
    const concepto = document.getElementById("conceptoGasto");
    if (concepto) concepto.focus();
  }
  if (tabName === "configuracion") {
    cargarConfiguracionSistema();
  }
  if (tabName === "cortes") {
    cargarModuloCortes();
  }
  if (tabName === "pedidos") {
    renderizarModuloPedidos();
  }
  if (tabName === "reportes") {
    generarResumenFinanciero();
  }
}

function showReporteTab(panelName, clickedBtn) {
  document.querySelectorAll(".reporte-panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".reportes-tab").forEach((t) => t.classList.remove("active"));
  const panel = document.getElementById(`reporte-${panelName}`);
  if (panel) panel.classList.add("active");
  if (clickedBtn) clickedBtn.classList.add("active");
}

function calcularStock(codigo, sucursalId = null) {
  const codigoNormalizado = normalizeCode(codigo);
  let cantidad = 0;

  let targetSucursal = sucursalId;
  if (targetSucursal === null) {
    targetSucursal = obtenerSucursalActivaId();
  }

  localDB.movimientos.forEach((mov) => {
    if (normalizeCode(mov.codigo) !== codigoNormalizado) return;

    if (targetSucursal && targetSucursal !== "TODAS") {
      const movSuc = mov.sucursalId || "SUC-MAIN";
      if (movSuc !== targetSucursal) return;
    }

    const valor = parseNumber(mov.cantidad, 0);

    switch (mov.tipo) {
      case TIPOS_MOVIMIENTO.INGRESO:
      case TIPOS_MOVIMIENTO.AJUSTE_POSITIVO:
        cantidad += valor;
        break;
      case TIPOS_MOVIMIENTO.SALIDA:
      case TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO:
        cantidad -= valor;
        break;
      case TIPOS_MOVIMIENTO.AJUSTE:
        cantidad += valor;
        break;
    }
  });

  return Math.max(0, Math.round(cantidad * 100) / 100);
}

function obtenerStock(sucursalId = null) {
  const sucursales = obtenerSucursales();
  const filtroSuc = sucursalId !== null
    ? sucursalId
    : (document.getElementById("filtroSucursalInventario") ? document.getElementById("filtroSucursalInventario").value : "TODAS");

  return localDB.productos
    .map((p) => {
      const stockPorSucursal = {};
      sucursales.forEach((s) => {
        stockPorSucursal[s.id] = calcularStock(p.codigo, s.id);
      });

      const cantidadTotal = Object.values(stockPorSucursal).reduce((a, b) => a + b, 0);
      const cantidad = filtroSuc === "TODAS" ? cantidadTotal : (stockPorSucursal[filtroSuc] || 0);
      const costoPromedioPieza = calcularCostoPromedioPorPieza(p.codigo);
      const precioVenta = Math.max(0, parseNumber(p.precioVenta, 0));

      return {
        codigo: p.codigo,
        nombre: p.nombre,
        stockMinimo: p.stockMinimo,
        cantidad: Math.round(cantidad * 100) / 100,
        cantidadTotal: Math.round(cantidadTotal * 100) / 100,
        stockPorSucursal,
        costoPromedioPieza,
        precioVenta,
        precioVariable: parseBoolean(p.precioVariable),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function calcularCostoPromedioPorPieza(codigo) {
  const codigoNormalizado = normalizeCode(codigo);
  let costoTotal = 0;
  let unidadesTotales = 0;

  localDB.movimientos.forEach((mov) => {
    if (normalizeCode(mov.codigo) !== codigoNormalizado) return;
    if (mov.tipo !== TIPOS_MOVIMIENTO.INGRESO) return;

    const costoCompra = parseNumber(mov.costoCompra, 0);
    const unidadesIngreso = parseNumber(mov.cantidad, 0);

    if (costoCompra > 0 && unidadesIngreso > 0) {
      costoTotal += costoCompra;
      unidadesTotales += unidadesIngreso;
    }
  });

  if (unidadesTotales <= 0) return 0;
  return roundTo(costoTotal / unidadesTotales, 4);
}

function calcularPagosNetosVenta(venta) {
  const totalVenta = Math.max(0, parseNumber(venta && venta.total, 0));

  if (!venta || !venta.pagos) {
    return {
      efectivo: roundTo(totalVenta, 2),
      tarjeta: 0,
      transferencia: 0,
      total: roundTo(totalVenta, 2),
    };
  }

  let efectivo = Math.max(0, parseNumber(venta.pagos.efectivo, 0));
  let tarjeta = Math.max(0, parseNumber(venta.pagos.tarjeta, 0));
  let transferencia = Math.max(0, parseNumber(venta.pagos.transferencia, 0));

  const totalPagos = efectivo + tarjeta + transferencia;
  let excedente = Math.max(0, roundTo(totalPagos - totalVenta, 2));

  // El cambio reduce primero efectivo; si no alcanza, descuenta el resto.
  const descuentoEfectivo = Math.min(efectivo, excedente);
  efectivo -= descuentoEfectivo;
  excedente -= descuentoEfectivo;

  if (excedente > 0) {
    const descuentoTarjeta = Math.min(tarjeta, excedente);
    tarjeta -= descuentoTarjeta;
    excedente -= descuentoTarjeta;
  }

  if (excedente > 0) {
    const descuentoTransferencia = Math.min(transferencia, excedente);
    transferencia -= descuentoTransferencia;
  }

  const totalNeto = efectivo + tarjeta + transferencia;
  return {
    efectivo: roundTo(efectivo, 2),
    tarjeta: roundTo(tarjeta, 2),
    transferencia: roundTo(transferencia, 2),
    total: roundTo(totalNeto, 2),
  };
}

function acumularPagosNetos(ventas) {
  return (Array.isArray(ventas) ? ventas : []).reduce(
    (acumulado, venta) => {
      const pagoNeto = calcularPagosNetosVenta(venta);
      acumulado.efectivo += pagoNeto.efectivo;
      acumulado.tarjeta += pagoNeto.tarjeta;
      acumulado.transferencia += pagoNeto.transferencia;
      return acumulado;
    },
    { efectivo: 0, tarjeta: 0, transferencia: 0 },
  );
}

function obtenerDetalleCajaDashboard() {
  const sucursalActivaId = obtenerSucursalActivaId();
  const corteActivo = obtenerCorteActivo();
  if (corteActivo && (!corteActivo.sucursalId || corteActivo.sucursalId === sucursalActivaId)) {
    const resumen = obtenerResumenFinancieroEnRango(corteActivo.fechaApertura, new Date().toISOString(), sucursalActivaId);
    const cajaEstimada = roundTo(parseNumber(corteActivo.cajaInicial, 0) + resumen.pagosEfectivo - resumen.gastosEfectivo, 2);
    return {
      valor: cajaEstimada,
      estado: "ABIERTO",
      label: `Caja inicial: ${formatMoney(corteActivo.cajaInicial)}`
    };
  } else {
    const cortesOrdenados = (localDB.cortes || [])
      .filter(c => c.estado === "CERRADO" && c.fechaCierre && (!c.sucursalId || c.sucursalId === sucursalActivaId))
      .sort((a, b) => new Date(b.fechaCierre) - new Date(a.fechaCierre));

    let baseCash = 0;
    let fechaInicioIso = new Date(0).toISOString();
    let label = "Sin cortes cerrados";

    if (cortesOrdenados.length > 0) {
      const ultimoCorte = cortesOrdenados[0];
      baseCash = parseNumber(ultimoCorte.cajaContada, 0);
      fechaInicioIso = ultimoCorte.fechaCierre;
      label = `Último cierre: ${formatMoney(baseCash)}`;
    }

    const resumen = obtenerResumenFinancieroEnRango(fechaInicioIso, new Date().toISOString(), sucursalActivaId);
    const cajaEstimada = roundTo(baseCash + resumen.pagosEfectivo - resumen.gastosEfectivo, 2);
    return {
      valor: cajaEstimada,
      estado: "CERRADO",
      label: label
    };
  }
}

function obtenerResumen() {
  const stock = obtenerStock();
  const now = new Date();
  const mesAtras = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    now.getDate(),
  );

  const sucursalActivaId = obtenerSucursalActivaId();
  const ventasSucursal = localDB.ventas.filter(v => !v.sucursalId || v.sucursalId === sucursalActivaId);
  const gastosSucursal = localDB.gastos.filter(g => !g.sucursalId || g.sucursalId === sucursalActivaId);
  const movimientosSucursal = localDB.movimientos.filter(m => !m.sucursalId || m.sucursalId === sucursalActivaId);
  const cortesSucursal = (localDB.cortes || []).filter(c => !c.sucursalId || c.sucursalId === sucursalActivaId);

  let sinStock = 0;
  let stockBajo = 0;
  let valorTotalInventario = 0;
  let movimientosUltimoMes = 0;

  stock.forEach((item) => {
    if (item.cantidad <= 0) {
      sinStock += 1;
    } else if (item.cantidad <= item.stockMinimo && item.stockMinimo > 0) {
      stockBajo += 1;
    }
    valorTotalInventario += item.cantidad;
  });

  movimientosSucursal.forEach((mov) => {
    const fecha = new Date(mov.fecha);
    if (!Number.isNaN(fecha.getTime()) && fecha >= mesAtras) {
      movimientosUltimoMes += 1;
    }
  });

  const ventasUltimoMes = ventasSucursal.filter((venta) => {
    const fechaVenta = new Date(venta.fecha);
    return !Number.isNaN(fechaVenta.getTime()) && fechaVenta >= mesAtras;
  }).length;

  const resumenPagos = acumularPagosNetos(ventasSucursal);
  const totalVentas =
    resumenPagos.efectivo + resumenPagos.tarjeta + resumenPagos.transferencia;
  let totalGastosEfectivo = 0;
  let totalGastosTarjeta = 0;
  let totalGastosTransferencia = 0;
  gastosSucursal.forEach((gasto) => {
    const m = (gasto.metodoPago || gasto.metodo || "EFECTIVO").toString().trim().toUpperCase();
    const monto = parseNumber(gasto.monto, 0);
    if (m === "TARJETA") totalGastosTarjeta += monto;
    else if (m === "TRANSFERENCIA") totalGastosTransferencia += monto;
    else totalGastosEfectivo += monto;
  });
  const totalGastos = totalGastosEfectivo + totalGastosTarjeta + totalGastosTransferencia;

  // Total retiros de caja acumulados de los cortes de esta sucursal
  const totalRetiros = cortesSucursal.reduce((acumulado, corte) => {
    return acumulado + parseNumber(corte.retiros, 0);
  }, 0);

  // Estadísticas de Pedidos Personalizados
  const pedidos = (localDB.pedidosPersonalizados || []).filter(p => !p.sucursalId || p.sucursalId === sucursalActivaId);
  const proximaFechaLimit = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

  let totalPedidos = pedidos.length;
  let pedidosPendientes = 0;
  let pedidosEnProceso = 0;
  let pedidosTerminados = 0;
  let pedidosEntregados = 0;
  let pedidosVencidos = 0;
  let pedidosPorVencer = 0;

  pedidos.forEach((p) => {
    if (p.estado === "ENTREGADO") {
      pedidosEntregados += 1;
    } else {
      if (p.estado === "PENDIENTE") pedidosPendientes += 1;
      else if (p.estado === "EN_PROCESO") pedidosEnProceso += 1;
      else if (p.estado === "TERMINADO") pedidosTerminados += 1;

      if (p.fechaEntregaEstimada) {
        const fechaEntrega = new Date(p.fechaEntregaEstimada);
        if (!Number.isNaN(fechaEntrega.getTime())) {
          if (fechaEntrega < now && p.estado !== "TERMINADO") {
            pedidosVencidos += 1;
          } else if (fechaEntrega <= proximaFechaLimit && p.estado !== "TERMINADO") {
            pedidosPorVencer += 1;
          }
        }
      }
    }
  });

  const dineroEnCaja = obtenerDetalleCajaDashboard().valor;
  const cajaEsperada = roundTo(resumenPagos.efectivo - totalGastosEfectivo - totalRetiros, 2);
  const diferenciaCaja = roundTo(dineroEnCaja - cajaEsperada, 2);

  return {
    totalProductos: localDB.productos.length,
    totalMovimientos: movimientosSucursal.length,
    totalVentas: roundTo(totalVentas, 2),
    cantidadVentas: ventasSucursal.length,
    totalGastos: roundTo(totalGastos, 2),
    totalGastosEfectivo: roundTo(totalGastosEfectivo, 2),
    totalGastosTarjeta: roundTo(totalGastosTarjeta, 2),
    totalGastosTransferencia: roundTo(totalGastosTransferencia, 2),
    totalRetiros: roundTo(totalRetiros, 2),
    sinStock,
    stockBajo,
    valorTotalInventario: Math.round(valorTotalInventario * 100) / 100,
    movimientosUltimoMes,
    ventasUltimoMes,
    pagosEfectivo: roundTo(resumenPagos.efectivo, 2),
    pagosTarjeta: roundTo(resumenPagos.tarjeta, 2),
    pagosTransferencia: roundTo(resumenPagos.transferencia, 2),
    dineroEnCaja,
    cajaEstadoLabel: `${obtenerDetalleCajaDashboard().estado} (${obtenerDetalleCajaDashboard().label})`,
    cajaEsperada,
    diferenciaCaja,
    totalPedidos,
    pedidosPendientes,
    pedidosEnProceso,
    pedidosTerminados,
    pedidosEntregados,
    pedidosVencidos,
    pedidosPorVencer,
  };
}

function obtenerHistorial(filtros) {
  const desde = new Date(`${filtros.fechaDesde}T00:00:00`);
  const hasta = new Date(`${filtros.fechaHasta}T23:59:59`);

  if (
    Number.isNaN(desde.getTime()) ||
    Number.isNaN(hasta.getTime()) ||
    desde > hasta
  ) {
    return [];
  }

  const productoMap = {};
  localDB.productos.forEach((p) => {
    productoMap[normalizeCode(p.codigo)] = p.nombre;
  });

  return localDB.movimientos
    .filter((mov) => {
      const fecha = new Date(mov.fecha);
      if (Number.isNaN(fecha.getTime())) return false;
      if (fecha < desde || fecha > hasta) return false;
      if (
        filtros.tipo &&
        normalizeCode(mov.tipo) !== normalizeCode(filtros.tipo)
      )
        return false;
      return true;
    })
    .map((mov) => ({
      codigo: mov.codigo,
      fecha: formatDate(new Date(mov.fecha)),
      tipo: mov.tipo,
      cantidad: parseNumber(mov.cantidad, 0),
      producto:
        productoMap[normalizeCode(mov.codigo)] || "Producto no encontrado",
      observaciones: mov.observaciones || "",
      usuario: mov.usuario || "Local",
    }))
    .sort((a, b) => {
      const [da, ma, ya] = a.fecha.split("/").map(Number);
      const [db, mb, yb] = b.fecha.split("/").map(Number);
      const fechaA = new Date(ya, ma - 1, da);
      const fechaB = new Date(yb, mb - 1, db);
      return fechaB - fechaA;
    });
}

function registrarProductoLocal(producto) {
  const codigo = normalizeCode(producto.codigo);
  const nombre = (producto.nombre || "").toString().trim();
  const margen = Math.max(0, parseNumber(producto.margen, 30));
  const precioVenta = Math.max(0, parseNumber(producto.precioVenta, 0));
  const precioVariable = parseBoolean(producto.precioVariable);
  const stockInicial = Math.max(0, parseFloat(producto.stockInicial) || 0);

  if (!codigo || !nombre) {
    return "Datos del producto incompletos. Codigo y nombre son obligatorios.";
  }

  if (margen > 1000) {
    return "El margen no puede ser mayor a 1000%.";
  }

  if (!precioVariable && precioVenta <= 0) {
    return "El precio real/de venta debe ser mayor a 0 o marcarlo como precio variable.";
  }

  const yaExiste = localDB.productos.some(
    (p) => normalizeCode(p.codigo) === codigo,
  );
  if (yaExiste) {
    return "Ya existe un producto con este codigo.";
  }

  localDB.productos.push({
    codigo,
    nombre,
    unidad: producto.unidad || "Unidades",
    grupo: producto.grupo || "General",
    stockMinimo: Math.max(0, parseInt(producto.stockMinimo, 10) || 0),
    margen: roundTo(margen, 2),
    precioVenta: roundTo(precioVenta, 2),
    precioVariable,
    fechaCreacion: new Date().toISOString(),
  });

  if (stockInicial > 0) {
    localDB.movimientos.push({
      codigo,
      fecha: new Date().toISOString(),
      tipo: TIPOS_MOVIMIENTO.INGRESO,
      cantidad: roundTo(stockInicial, 4),
      usuario: "Local",
      timestamp: new Date().toISOString(),
      observaciones: "Stock inicial al registrar producto",
    });
  }

  guardarEstadoLocal();

  return "Producto registrado correctamente.";
}

function editarProducto(codigo) {
  const codigoNormalizado = normalizeCode(codigo);
  const producto = localDB.productos.find(
    (p) => normalizeCode(p.codigo) === codigoNormalizado,
  );

  if (!producto) {
    showMessage("stockTable", "No se encontro el producto a editar.", "error");
    return;
  }

  const modal = document.getElementById("modalEditarProducto");
  const codigoField = document.getElementById("editCodigoProd");
  const nombreField = document.getElementById("editNombreProd");
  const stockMinField = document.getElementById("editStockMinProd");
  const precioVentaField = document.getElementById("editPrecioVentaProd");
  const precioVariableField = document.getElementById("editPrecioVariableProd");

  productoEnEdicionCodigo = codigoNormalizado;
  codigoField.value = producto.codigo;
  nombreField.value = (producto.nombre || "").toString();
  stockMinField.value = Math.max(0, parseInt(producto.stockMinimo, 10) || 0);
  precioVentaField.value = roundTo(parseNumber(producto.precioVenta, 0), 2);
  if (precioVariableField)
    precioVariableField.checked = parseBoolean(producto.precioVariable);
  actualizarPrecioVariableProductoEdicion();

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  nombreField.focus();
  nombreField.select();
}

function cerrarModalEditarProducto() {
  const modal = document.getElementById("modalEditarProducto");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  productoEnEdicionCodigo = "";
}

function guardarEdicionProducto(event) {
  event.preventDefault();

  if (!productoEnEdicionCodigo) {
    cerrarModalEditarProducto();
    return;
  }

  const producto = localDB.productos.find(
    (p) => normalizeCode(p.codigo) === productoEnEdicionCodigo,
  );
  if (!producto) {
    cerrarModalEditarProducto();
    showMessage("stockTable", "No se encontro el producto a editar.", "error");
    return;
  }

  const nombreNuevo = document.getElementById("editNombreProd").value.trim();
  const nuevoStockMin = Math.max(
    0,
    parseInt(document.getElementById("editStockMinProd").value, 10) || 0,
  );
  const nuevoPrecioVenta = parseFloat(
    document.getElementById("editPrecioVentaProd").value,
  );
  const precioVariable = document.getElementById("editPrecioVariableProd")
    ? document.getElementById("editPrecioVariableProd").checked
    : false;

  if (nombreNuevo.length < 2) {
    showMessage(
      "stockTable",
      "El nombre debe tener al menos 2 caracteres.",
      "error",
    );
    return;
  }

  if (!Number.isFinite(nuevoStockMin) || nuevoStockMin < 0) {
    showMessage(
      "stockTable",
      "El stock minimo debe ser un numero mayor o igual a 0.",
      "error",
    );
    return;
  }

  if (!Number.isFinite(nuevoPrecioVenta) || nuevoPrecioVenta <= 0) {
    if (!precioVariable) {
      showMessage(
        "stockTable",
        "El precio real/de venta debe ser mayor a 0 o marcarlo como precio variable.",
        "error",
      );
      return;
    }
  }

  producto.nombre = nombreNuevo;
  producto.stockMinimo = nuevoStockMin;
  producto.precioVenta = roundTo(nuevoPrecioVenta, 2);
  producto.precioVariable = precioVariable;

  guardarEstadoLocal();
  loadDashboard();
  mostrarStock();

  cerrarModalEditarProducto();
  showMessage("stockTable", "Producto actualizado correctamente.", "success");
}

function registrarMovimientoLocal(mov) {
  const codigo = normalizeCode(mov.codigo);
  const tipo = normalizeCode(mov.tipo);
  const cantidad = parseNumber(mov.cantidad, 0);

  if (!codigo || !mov.fecha || !tipo || cantidad <= 0) {
    return "Datos del movimiento incompletos.";
  }

  const producto = localDB.productos.find(
    (p) => normalizeCode(p.codigo) === codigo,
  );
  if (!producto) {
    return "El producto no existe. Registrelo primero.";
  }

  if (!Object.values(TIPOS_MOVIMIENTO).includes(tipo)) {
    return `Tipo de movimiento invalido: ${tipo}`;
  }

  const cantidadProcesada = cantidad;

  const sucursales = obtenerSucursales();
  const sucursalTargetId = mov.sucursalId || obtenerSucursalActivaId();
  const sucursalTarget = sucursales.find((s) => s.id === sucursalTargetId) || obtenerSucursalActiva();

  const stockActual = calcularStock(codigo, sucursalTarget.id);
  if (
    (tipo === TIPOS_MOVIMIENTO.SALIDA ||
      tipo === TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO) &&
    stockActual < cantidadProcesada
  ) {
    return `Stock insuficiente en ${sucursalTarget.nombre}. Disponible: ${stockActual}, Solicitado: ${cantidadProcesada}`;
  }

  const now = new Date();
  const hoyStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  let fechaMovimiento;
  if (!mov.fecha || mov.fecha === hoyStr) {
    fechaMovimiento = now;
  } else {
    const horaStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const parsedDate = new Date(`${mov.fecha}T${horaStr}`);
    fechaMovimiento = Number.isNaN(parsedDate.getTime())
      ? new Date(`${mov.fecha}T12:00:00`)
      : parsedDate;
  }

  const costoCompra = parseNumber(mov.costoCompra, 0);
  const unidadCompra = mov.unidadCompra || "PIEZA";
  const piezasPorPresentacion = parseNumber(mov.piezasPorPresentacion, 1) || 1;
  const costoPorPieza =
    costoCompra > 0 && cantidadProcesada > 0
      ? roundTo(costoCompra / (cantidadProcesada * piezasPorPresentacion), 4)
      : 0;

  const movId = `M-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const nuevoMov = {
    id: movId,
    codigo,
    fecha: fechaMovimiento.toISOString(),
    tipo,
    cantidad: roundTo(cantidadProcesada, 4),
    usuario: "Local",
    sucursalId: sucursalTarget.id,
    sucursalNombre: sucursalTarget.nombre,
    timestamp: new Date().toISOString(),
    observaciones: mov.observaciones || "",
    unidadCompra,
    piezasPorPresentacion,
    costoCompra,
    costoPorPieza,
  };

  if (validarMovimientoDuplicado(nuevoMov)) {
    return "Error: Ya existe un movimiento con la misma fecha y características para este producto.";
  }

  localDB.movimientos.push(nuevoMov);
  localDB.movimientos = validarYLimpiarMovimientosDuplicados(localDB.movimientos);

  if (_dbFirestore) {
    obtenerRefColeccion("movimientos").doc(movId).set({ ...nuevoMov, id: movId }).catch((e) => console.warn("Firestore mov error:", e));
  }

  guardarEstadoLocal();

  return "Movimiento registrado correctamente.";
}

/**
 * Valida si un movimiento ya existe en el historial local por fecha/código/ID.
 */
function validarMovimientoDuplicado(mov, lista = localDB.movimientos) {
  if (!mov || !Array.isArray(lista)) return false;
  const fecha = (mov.fecha || mov.timestamp || "").toString().trim();
  const codigo = typeof normalizeCode === "function" ? normalizeCode(mov.codigo || "") : (mov.codigo || "").toString().trim().toUpperCase();
  const id = (mov.id || "").toString().trim();

  return lista.some((m) => {
    if (id && m.id && m.id === id) return true;
    const mFecha = (m.fecha || m.timestamp || "").toString().trim();
    const mCodigo = typeof normalizeCode === "function" ? normalizeCode(m.codigo || "") : (m.codigo || "").toString().trim().toUpperCase();
    if (fecha && codigo && mFecha === fecha && mCodigo === codigo) return true;
    if (fecha && !codigo && mFecha === fecha) return true;
    return false;
  });
}

/**
 * Limpia y devuelve la lista de movimientos sin duplicados por ID, fecha exacta y firma.
 */
function validarYLimpiarMovimientosDuplicados(lista = localDB.movimientos) {
  if (!Array.isArray(lista)) return [];
  const idsVistos = new Set();
  const fechasCodigosVistos = new Set();
  const firmasVistas = new Set();
  const limpios = [];

  for (const mov of lista) {
    if (!mov) continue;
    const id = (mov.id || "").toString().trim();
    const fecha = (mov.fecha || mov.timestamp || "").toString().trim();
    const codigo = typeof normalizeCode === "function" ? normalizeCode(mov.codigo || "") : (mov.codigo || "").toString().trim().toUpperCase();
    const tipo = (mov.tipo || "").toString().trim().toUpperCase();
    const cantidad = parseFloat(mov.cantidad) || 0;
    const sucursalId = (mov.sucursalId || "").toString().trim();

    const fechaCodigoKey = fecha && codigo ? `${fecha}_${codigo}` : "";
    const firma = `${fecha}_${codigo}_${tipo}_${cantidad}_${sucursalId}`;

    if (id && idsVistos.has(id)) continue;
    if (fechaCodigoKey && fechasCodigosVistos.has(fechaCodigoKey)) continue;
    if (firma && firmasVistas.has(firma)) continue;

    if (id) idsVistos.add(id);
    if (fechaCodigoKey) fechasCodigosVistos.add(fechaCodigoKey);
    if (firma) firmasVistas.add(firma);

    limpios.push(mov);
  }

  return limpios;
}

/**
 * Depura los movimientos duplicados de la base de datos local y Firestore.
 */
async function depurarMovimientosDuplicados() {
  const original = Array.isArray(localDB.movimientos) ? localDB.movimientos.length : 0;
  const limpios = validarYLimpiarMovimientosDuplicados(localDB.movimientos);
  const eliminados = original - limpios.length;

  localDB.movimientos = limpios;
  guardarEstadoLocal();

  if (_dbFirestore) {
    try {
      if (typeof guardarColeccionChunked === "function") {
        await guardarColeccionChunked("movimientos", limpios);
      }
      if (typeof incrementarRevision === "function") {
        await incrementarRevision();
      }
    } catch (e) {
      console.error("Error al actualizar movimientos en Firestore:", e);
    }
  }

  return { totalOriginal: original, totalLimpios: limpios.length, duplicadosEliminados: eliminados };
}

/**
 * Función interactiva para el usuario con diálogo y confirmación.
 */
async function ejecutarDepuracionMovimientos() {
  const totalActual = Array.isArray(localDB.movimientos) ? localDB.movimientos.length : 0;
  if (!confirm(`Se analizarán los ${totalActual} movimientos registrados para detectar y eliminar duplicados por fecha exacta o ID.\n\n¿Deseas continuar?`)) {
    return;
  }

  try {
    const res = await depurarMovimientosDuplicados();
    if (res.duplicadosEliminados > 0) {
      alert(`✅ ¡Depuración completada exitosamente!\n\n• Movimientos duplicados eliminados: ${res.duplicadosEliminados}\n• Total de movimientos limpios: ${res.totalLimpios}`);
    } else {
      alert(`✨ No se encontraron movimientos duplicados.\nTotal actual de movimientos: ${res.totalOriginal}`);
    }

    if (typeof loadDashboard === "function") loadDashboard();
    if (typeof mostrarStock === "function") mostrarStock();
  } catch (err) {
    alert("❌ Error al depurar movimientos: " + (err.message || err));
  }
}

/**
 * Recalcula y actualiza el stock actual de cada producto en localDB.productos
 * basándose en la suma cronológica de los movimientos de inventario.
 */
async function recalcularStockProductosDesdeMovimientos() {
  if (!Array.isArray(localDB.productos) || !Array.isArray(localDB.movimientos)) {
    return { actualizados: 0, total: 0 };
  }

  let actualizados = 0;
  localDB.productos.forEach((prod) => {
    const cod = normalizeCode(prod.codigo);
    const stockCalculado = typeof calcularStock === 'function' ? calcularStock(cod, "TODAS") : 0;
    const stockActualNum = typeof prod.stockActual === 'number' ? prod.stockActual : (typeof prod.cantidad === 'number' ? prod.cantidad : 0);

    if (stockActualNum !== stockCalculado) {
      prod.stockActual = stockCalculado;
      prod.cantidad = stockCalculado;
      actualizados++;
    }
  });

  if (actualizados > 0) {
    guardarEstadoLocal();
    if (_dbFirestore && typeof guardarColeccionChunked === "function") {
      try {
        await guardarColeccionChunked("productos", localDB.productos);
        await incrementarRevision();
      } catch (e) {
        console.error("Error al actualizar catálogo en Firestore:", e);
      }
    }
  }

  return { actualizados, total: localDB.productos.length };
}

/**
 * Función interactiva para el usuario con diálogo para recalcular stock.
 */
async function ejecutarRecalculoStock() {
  if (!confirm("¿Deseas recalcular y sincronizar el Stock Actual de todos los productos en base al historial de movimientos?")) {
    return;
  }

  try {
    const res = await recalcularStockProductosDesdeMovimientos();
    if (res.actualizados > 0) {
      alert(`✅ ¡Stock recalculado exitosamente!\n\nSe corrigió el stock de ${res.actualizados} producto(s) en base al historial de movimientos.`);
    } else {
      alert(`✨ Todos los productos (${res.total}) ya tienen su stock perfectamente alineado con los movimientos.`);
    }

    if (typeof loadDashboard === "function") loadDashboard();
    if (typeof mostrarStock === "function") mostrarStock();
  } catch (err) {
    alert("❌ Error al recalcular stock: " + (err.message || err));
  }
}

// Exponer en el objeto global
window.validarMovimientoDuplicado = validarMovimientoDuplicado;
window.validarYLimpiarMovimientosDuplicados = validarYLimpiarMovimientosDuplicados;
window.depurarMovimientosDuplicados = depurarMovimientosDuplicados;
window.ejecutarDepuracionMovimientos = ejecutarDepuracionMovimientos;
window.recalcularStockProductosDesdeMovimientos = recalcularStockProductosDesdeMovimientos;
window.ejecutarRecalculoStock = ejecutarRecalculoStock;

function registrarGastoLocal(gasto) {
  const now = new Date();
  const fecha = gasto.fecha
    ? new Date(`${gasto.fecha}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`)
    : now;
  const concepto = (gasto.concepto || "").toString().trim();
  const categoria = (gasto.categoria || "General").toString().trim();
  const metodoInput = (gasto.metodoPago || gasto.metodo || "EFECTIVO").toString().trim().toUpperCase();
  const metodoPago = ["EFECTIVO", "TARJETA", "TRANSFERENCIA"].includes(metodoInput) ? metodoInput : "EFECTIVO";
  const monto = parseNumber(gasto.monto, 0);

  if (
    !concepto ||
    concepto.length < 2 ||
    Number.isNaN(fecha.getTime()) ||
    monto <= 0
  ) {
    return "Datos del gasto incompletos.";
  }

  const sucursalActual = obtenerSucursalActiva();
  const nuevoGasto = {
    id: `G-${Date.now()}`,
    fecha: fecha.toISOString(),
    concepto,
    categoria: categoria || "General",
    metodoPago,
    persona: (gasto.persona || gasto.responsable || "").toString().trim(),
    monto: roundTo(monto, 2),
    usuario: "Local",
    sucursalId: sucursalActual.id,
    sucursalNombre: sucursalActual.nombre,
    timestamp: new Date().toISOString(),
    observaciones: gasto.observaciones || "",
  };

  localDB.gastos.push(nuevoGasto);

  if (_dbFirestore) {
    obtenerRefColeccion("gastos").doc(nuevoGasto.id).set(nuevoGasto).catch((e) => console.warn("Firestore gasto error:", e));
  }

  guardarEstadoLocal();

  return "Gasto registrado correctamente.";
}

function obtenerProductoPorCodigo(codigo) {
  const codigoNormalizado = normalizeCode(codigo);
  return (
    localDB.productos.find(
      (p) => normalizeCode(p.codigo) === codigoNormalizado,
    ) || null
  );
}

function obtenerPrecioVentaProducto(producto) {
  if (!producto) return 0;
  if (parseBoolean(producto.precioVariable)) return 0;
  const precioManual = Math.max(0, parseNumber(producto.precioVenta, 0));
  return precioManual > 0 ? roundTo(precioManual, 4) : 0;
}

async function agregarProductoVenta(event) {
  event.preventDefault();

  const codigo = normalizeCode(document.getElementById("codigoVenta").value);
  const cantidad = Math.max(
    1,
    parseInt(document.getElementById("cantidadVenta").value, 10) || 1,
  );
  await agregarProductoVentaPorCodigo(codigo, cantidad);
}

async function agregarProductoVentaPorCodigo(codigo, cantidad = 1) {
  const codigoNormalizado = normalizeCode(codigo);
  if (!codigoNormalizado) {
    showMessage(
      "msgVenta",
      "Escanee o escriba un codigo de producto valido.",
      "warning",
    );
    return;
  }

  const producto = obtenerProductoPorCodigo(codigoNormalizado);
  if (!producto) {
    showMessage(
      "msgVenta",
      `No existe un producto con codigo ${codigoNormalizado}.`,
      "error",
    );
    return;
  }

  const cantidadSolicitada = Math.max(1, parseInt(cantidad, 10) || 1);
  const stockActual = calcularStock(codigoNormalizado);
  const itemExistente = carritoVenta.find(
    (item) => normalizeCode(item.codigo) === codigoNormalizado,
  );
  const cantidadActualEnCarrito = itemExistente ? itemExistente.cantidad : 0;

  if (stockActual < cantidadActualEnCarrito + cantidadSolicitada) {
    showMessage(
      "msgVenta",
      `Stock insuficiente para ${producto.nombre}. Disponible: ${stockActual}, en carrito: ${cantidadActualEnCarrito}, solicitado: ${cantidadSolicitada}.`,
      "error",
    );
    return;
  }

  const precioVariable = parseBoolean(producto.precioVariable);
  let precioUnitario = obtenerPrecioVentaProducto(producto);

  if (precioVariable && !itemExistente) {
    const precioManual = await abrirModalPrecioVariableVenta(producto);
    if (!Number.isFinite(precioManual) || precioManual <= 0) {
      showMessage(
        "msgVenta",
        `No se agregó ${producto.nombre} porque no se indicó un precio válido.`,
        "warning",
      );
      return;
    }
    precioUnitario = roundTo(precioManual, 4);
  }

  if (!precioVariable && precioUnitario <= 0) {
    showMessage(
      "msgVenta",
      `El producto ${producto.nombre} no tiene precio real/de venta configurado.`,
      "error",
    );
    return;
  }

  if (itemExistente) {
    itemExistente.cantidad += cantidadSolicitada;
    itemExistente.subtotal = roundTo(
      itemExistente.cantidad * itemExistente.precioUnitario,
      4,
    );
  } else {
    carritoVenta.push({
      codigo: producto.codigo,
      nombre: producto.nombre,
      cantidad: cantidadSolicitada,
      precioUnitario,
      precioVariable,
      subtotal: roundTo(cantidadSolicitada * precioUnitario, 4),
    });
  }

  renderVentaCarrito();
  actualizarTotalesPagoVenta();
  renderVentasRecientes();

  document.getElementById("codigoVenta").value = "";
  document.getElementById("cantidadVenta").value = "1";
  const dropdownVenta = document.getElementById("autocompleteDropdownVenta");
  if (dropdownVenta) dropdownVenta.style.display = "none";
  document.getElementById("codigoVenta").focus();
  showMessage(
    "msgVenta",
    `Producto ${producto.nombre} agregado al carrito.`,
    "success",
  );
  reproducirSonidoAgregarCarrito();
}

function reproducirSonidoAgregarCarrito() {
  sonidoAgregarCarrito.currentTime = 0;
  sonidoAgregarCarrito.play().catch(() => { });
}

function quitarItemVenta(codigo) {
  const codigoNormalizado = normalizeCode(codigo);
  carritoVenta = carritoVenta.filter(
    (item) => normalizeCode(item.codigo) !== codigoNormalizado,
  );
  renderVentaCarrito();
  actualizarTotalesPagoVenta();
}

function cambiarCantidadVenta(codigo, nuevaCantidad) {
  const codigoNormalizado = normalizeCode(codigo);
  const item = carritoVenta.find(
    (i) => normalizeCode(i.codigo) === codigoNormalizado,
  );
  if (!item) return;

  const cantidad = Math.max(1, parseInt(nuevaCantidad, 10) || 1);
  const stockActual = calcularStock(codigoNormalizado);
  if (cantidad > stockActual) {
    showMessage(
      "msgVenta",
      `Stock insuficiente para ${item.nombre}. Disponible: ${stockActual}.`,
      "error",
    );
    renderVentaCarrito();
    return;
  }

  item.cantidad = cantidad;
  item.subtotal = roundTo(item.cantidad * item.precioUnitario, 4);
  renderVentaCarrito();
  actualizarTotalesPagoVenta();
}

function calcularTotalVenta() {
  return roundTo(
    carritoVenta.reduce((acc, item) => acc + parseNumber(item.subtotal, 0), 0),
    4,
  );
}

function renderVentaCarrito() {
  const container = document.getElementById("ventaCarrito");
  if (!container) return;

  if (!carritoVenta.length) {
    container.innerHTML =
      '<div class="message warning">No hay productos en el carrito de venta.</div>';
    return;
  }

  let html = `
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Precio Unit.</th>
              <th>Subtotal</th>
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
      `;

  carritoVenta.slice().reverse().forEach((item) => {
    html += `
          <tr>
            <td>${item.codigo}</td>
            <td>${item.nombre}</td>
            <td>
              <input
                type="number"
                min="1"
                step="1"
                value="${item.cantidad}"
                class="input-cantidad-venta"
                onchange="cambiarCantidadVenta('${item.codigo}', this.value)">
            </td>
            <td>${formatMoney(item.precioUnitario)}</td>
            <td>${formatMoney(item.subtotal)}</td>
            <td>
              <button type="button" class="btn btn-danger" onclick="quitarItemVenta('${item.codigo}')">Quitar</button>
            </td>
          </tr>
        `;
  });

  html += `
          </tbody>
        </table>
      `;

  container.innerHTML = html;
}

function actualizarTotalesPagoVenta() {
  const totalVenta = calcularTotalVenta();
  const pagoEfectivo = Math.max(
    0,
    parseNumber(
      document.getElementById("pagoEfectivo")
        ? document.getElementById("pagoEfectivo").value
        : 0,
      0,
    ),
  );
  const pagoTarjeta = Math.max(
    0,
    parseNumber(
      document.getElementById("pagoTarjeta")
        ? document.getElementById("pagoTarjeta").value
        : 0,
      0,
    ),
  );
  const pagoTransferencia = Math.max(
    0,
    parseNumber(
      document.getElementById("pagoTransferencia")
        ? document.getElementById("pagoTransferencia").value
        : 0,
      0,
    ),
  );

  const totalPagado = roundTo(
    pagoEfectivo + pagoTarjeta + pagoTransferencia,
    2,
  );
  const diferencia = roundTo(totalPagado - totalVenta, 2);

  const totalVentaField = document.getElementById("totalVenta");
  const totalPagadoField = document.getElementById("totalPagadoVenta");
  const cambioField = document.getElementById("cambioVenta");

  if (totalVentaField) totalVentaField.value = formatMoney(totalVenta);
  if (totalPagadoField) totalPagadoField.value = formatMoney(totalPagado);

  if (cambioField) {
    if (diferencia >= 0) {
      cambioField.value = formatMoney(diferencia);
    } else {
      cambioField.value = `Falta ${formatMoney(Math.abs(diferencia))}`;
    }
  }
}

function limpiarVentaActual() {
  carritoVenta = [];
  carritoPendienteActivoId = "";

  const codigoVenta = document.getElementById("codigoVenta");
  const cantidadVenta = document.getElementById("cantidadVenta");
  const pagoEfectivo = document.getElementById("pagoEfectivo");
  const pagoTarjeta = document.getElementById("pagoTarjeta");
  const pagoTransferencia = document.getElementById("pagoTransferencia");
  const msgVenta = document.getElementById("msgVenta");
  const referenciaPendiente = document.getElementById(
    "pendienteReferenciaVenta",
  );
  const tipoPendiente = document.getElementById("pendienteTipoVenta");
  const adelantoPendiente = document.getElementById("pendienteAdelantoVenta");
  const notasPendiente = document.getElementById("pendienteNotasVenta");

  if (codigoVenta) codigoVenta.value = "";
  if (cantidadVenta) cantidadVenta.value = "1";
  if (pagoEfectivo) pagoEfectivo.value = "0";
  if (pagoTarjeta) pagoTarjeta.value = "0";
  if (pagoTransferencia) pagoTransferencia.value = "0";
  if (referenciaPendiente) referenciaPendiente.value = "";
  if (tipoPendiente) tipoPendiente.value = "COTIZACION";
  if (adelantoPendiente) adelantoPendiente.value = "0";
  if (notasPendiente) notasPendiente.value = "";
  if (msgVenta) msgVenta.innerHTML = "";

  renderVentaCarrito();
  actualizarTotalesPagoVenta();
  actualizarCampoAdelantoPendiente();
  if (codigoVenta) codigoVenta.focus();
}

function confirmarVenta() {
  if (!carritoVenta.length) {
    showMessage("msgVenta", "No hay productos en el carrito.", "warning");
    reproducirSonidoVentaFallida()
    return;
  }

  const totalVenta = calcularTotalVenta();
  const pagoEfectivo = Math.max(
    0,
    parseNumber(document.getElementById("pagoEfectivo").value, 0),
  );
  const pagoTarjeta = Math.max(
    0,
    parseNumber(document.getElementById("pagoTarjeta").value, 0),
  );
  const pagoTransferencia = Math.max(
    0,
    parseNumber(document.getElementById("pagoTransferencia").value, 0),
  );
  const totalPagado = roundTo(
    pagoEfectivo + pagoTarjeta + pagoTransferencia,
    2,
  );

  if (totalPagado < totalVenta) {
    showMessage(
      "msgVenta",
      `Pago insuficiente. Total: ${formatMoney(totalVenta)}. Recibido: ${formatMoney(totalPagado)}.`,
      "error",
    );
    actualizarTotalesPagoVenta();
    reproducirSonidoVentaFallida()
    return;
  }

  for (const item of carritoVenta) {
    const stockActual = calcularStock(item.codigo);
    if (stockActual < item.cantidad) {
      showMessage(
        "msgVenta",
        `Stock insuficiente para ${item.nombre}. Disponible: ${stockActual}, requerido: ${item.cantidad}.`,
        "error",
      );
      reproducirSonidoVentaFallida()
      return;
    }
  }

  const ventaId = `V-${Date.now()}`;
  const timestamp = new Date().toISOString();
  const sucursalActual = obtenerSucursalActiva();

  carritoVenta.forEach((item) => {
    const nuevoMov = {
      codigo: normalizeCode(item.codigo),
      fecha: timestamp,
      tipo: TIPOS_MOVIMIENTO.SALIDA,
      cantidad: roundTo(item.cantidad, 4),
      usuario: "Local",
      sucursalId: sucursalActual.id,
      sucursalNombre: sucursalActual.nombre,
      timestamp,
      observaciones: `Venta ${ventaId}`,
      cantidadCompra: 0,
      unidadCompra: "PIEZA",
      piezasPorPresentacion: 1,
      costoCompra: 0,
      costoPorPieza: 0,
    };
    localDB.movimientos.push(nuevoMov);
    if (_dbFirestore) {
      const movId = `M-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      obtenerRefColeccion("movimientos").doc(movId).set({ ...nuevoMov, id: movId }).catch((e) => console.warn("Firestore mov error:", e));
    }
  });

  const nuevaVenta = {
    id: ventaId,
    fecha: timestamp,
    sucursalId: sucursalActual.id,
    sucursalNombre: sucursalActual.nombre,
    items: carritoVenta.map((item) => ({
      codigo: item.codigo,
      nombre: item.nombre,
      cantidad: item.cantidad,
      precioUnitario: roundTo(item.precioUnitario, 4),
      subtotal: roundTo(item.subtotal, 4),
    })),
    total: roundTo(totalVenta, 2),
    pagos: {
      efectivo: roundTo(pagoEfectivo, 2),
      tarjeta: roundTo(pagoTarjeta, 2),
      transferencia: roundTo(pagoTransferencia, 2),
    },
    totalPagado: roundTo(totalPagado, 2),
    cambio: roundTo(totalPagado - totalVenta, 2),
  };

  localDB.ventas.push(nuevaVenta);

  if (_dbFirestore) {
    obtenerRefColeccion("ventas").doc(ventaId).set(nuevaVenta).catch((e) => console.warn("Firestore venta error:", e));
  }

  if (carritoPendienteActivoId) {
    localDB.carritosPendientes = localDB.carritosPendientes.filter(
      (pendiente) => (pendiente.id || "") !== carritoPendienteActivoId,
    );
  }

  ultimaVentaId = ventaId;

  guardarEstadoLocal();
  loadDashboard();
  if (currentTab === "inventario") {
    mostrarStock();
  }

  const cambio = roundTo(totalPagado - totalVenta, 2);
  limpiarVentaActual();
  renderVentasRecientes();
  showMessage(
    "msgVenta",
    `Venta registrada correctamente. Folio: ${ventaId}. Cambio: ${formatMoney(cambio)}.`,
    "success",
  );
  reproducirSonidoVentaExitosa();

  const autoImprimir = document.getElementById("autoImprimirVenta");
  if (autoImprimir && autoImprimir.checked) {
    imprimirVentaPorId(ventaId);
  }
}

function reproducirSonidoVentaExitosa() {
  sonidoVentaExitosa.currentTime = 0;
  sonidoVentaExitosa.play().catch((err) => {
    console.error("No se pudo reproducir el sonido de venta exitosa:", err);
  });
}

function reproducirSonidoVentaFallida() {
  sonidoVentaFallida.currentTime = 0;
  sonidoVentaFallida.play().catch((err) => {
    console.error("No se pudo reproducir el sonido de venta fallida:", err);
  });
}

function renderVentasRecientes() {
  const container = document.getElementById("ventasRecientes");
  if (!container) return;

  if (!localDB.ventas.length) {
    container.innerHTML =
      '<div class="message info">Aun no hay ventas registradas.</div>';
    return;
  }

  const ultimas = [...localDB.ventas]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, 10);

  let html = `
        <table style="width: 100%; min-width: 900px;">
          <thead>
            <tr>
              <th>Folio</th>
              <th>Fecha</th>
              <th>Productos</th>
              <th>Items</th>
              <th>Total</th>
              <th>Efectivo</th>
              <th>Tarjeta</th>
              <th>Transferencia</th>
              <th>Cambio</th>
              <th>Ticket</th>
            </tr>
          </thead>
          <tbody>
      `;

  ultimas.forEach((venta) => {
    const itemsCount = Array.isArray(venta.items)
      ? venta.items.reduce(
        (acc, item) => acc + parseNumber(item.cantidad, 0),
        0,
      )
      : 0;
    html += `
          <tr>
            <td>${venta.id}</td>
            <td>${formatDate(venta.fecha)}</td>
            <td>${venta.items.map((item) => item.nombre).join(", ")}</td>
            <td>${roundTo(itemsCount, 2)}</td>
            <td>${formatMoney(venta.total)}</td>
            <td>${formatMoney(venta.pagos ? venta.pagos.efectivo : 0)}</td>
            <td>${formatMoney(venta.pagos ? venta.pagos.tarjeta : 0)}</td>
            <td>${formatMoney(venta.pagos ? venta.pagos.transferencia : 0)}</td>
            <td>${formatMoney(venta.cambio || 0)}</td>
            <td>
              <button type="button" class="btn btn-info" onclick="imprimirVentaPorId('${venta.id}')">Ticket</button>
            </td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function renderGastosRecientes() {
  const container = document.getElementById("gastosRecientes");
  if (!container) return;

  if (!localDB.gastos.length) {
    container.innerHTML =
      '<div class="message info">Aun no hay gastos registrados.</div>';
    return;
  }

  const recientes = [...localDB.gastos]
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
    .slice(0, 10);

  let html = `
        <table>
          <thead>
            <tr>
              <th>Folio</th>
              <th>Fecha</th>
              <th>Categoría</th>
              <th>Concepto</th>
              <th>Realizado por</th>
              <th>Método</th>
              <th>Monto</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
      `;

  recientes.forEach((gasto) => {
    const metodo = (gasto.metodoPago || gasto.metodo || "EFECTIVO").toString().toUpperCase();
    const persona = gasto.persona || gasto.responsable || "-";
    html += `
          <tr>
            <td>${gasto.id}</td>
            <td>${formatDate(gasto.fecha)}</td>
            <td>${gasto.categoria || "General"}</td>
            <td>${gasto.concepto || "-"}</td>
            <td>${escapeXml(persona)}</td>
            <td><span class="badge" style="background:#f1f5f9; color:#475569;">${escapeXml(metodo)}</span></td>
            <td>${formatMoney(gasto.monto)}</td>
            <td>${gasto.observaciones || ""}</td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function obtenerTipoPendienteTexto(tipo) {
  return normalizeCode(tipo) === "APARTADO" ? "Apartado" : "Cotizacion";
}

function actualizarCampoAdelantoPendiente() {
  const tipoInput = document.getElementById("pendienteTipoVenta");
  const adelantoInput = document.getElementById("pendienteAdelantoVenta");
  if (!tipoInput || !adelantoInput) return;

  const esApartado = normalizeCode(tipoInput.value) === "APARTADO";
  adelantoInput.disabled = !esApartado;
  if (!esApartado) {
    adelantoInput.value = "0";
  }
}

function guardarCarritoPendiente() {
  if (!carritoVenta.length) {
    showMessage(
      "msgVenta",
      "No hay productos en el carrito para guardar como pendiente.",
      "warning",
    );
    return;
  }

  const referenciaInput = document.getElementById("pendienteReferenciaVenta");
  const tipoInput = document.getElementById("pendienteTipoVenta");
  const adelantoInput = document.getElementById("pendienteAdelantoVenta");
  const notasInput = document.getElementById("pendienteNotasVenta");
  const pagoEfectivoInput = document.getElementById("pagoEfectivo");
  const pagoTarjetaInput = document.getElementById("pagoTarjeta");
  const pagoTransferenciaInput = document.getElementById("pagoTransferencia");

  const referencia = referenciaInput
    ? referenciaInput.value.toString().trim()
    : "";
  const tipo = tipoInput ? normalizeCode(tipoInput.value) : "COTIZACION";
  const esApartado = tipo === "APARTADO";
  const adelanto = Math.max(
    0,
    roundTo(parseNumber(adelantoInput ? adelantoInput.value : 0, 0), 2),
  );
  const notas = notasInput ? notasInput.value.toString().trim() : "";

  if (!referencia) {
    showMessage(
      "msgVenta",
      "Escriba un cliente o referencia para guardar el pendiente.",
      "warning",
    );
    if (referenciaInput) referenciaInput.focus();
    return;
  }

  const pagoEfectivo = Math.max(
    0,
    parseNumber(pagoEfectivoInput ? pagoEfectivoInput.value : 0, 0),
  );
  const pagoTarjeta = Math.max(
    0,
    parseNumber(pagoTarjetaInput ? pagoTarjetaInput.value : 0, 0),
  );
  const pagoTransferencia = Math.max(
    0,
    parseNumber(pagoTransferenciaInput ? pagoTransferenciaInput.value : 0, 0),
  );

  let pagoEfectivoFinal = roundTo(pagoEfectivo, 2);
  let pagoTarjetaFinal = roundTo(pagoTarjeta, 2);
  let pagoTransferenciaFinal = roundTo(pagoTransferencia, 2);

  if (esApartado && adelanto > 0) {
    const totalPagosCapturados = roundTo(
      pagoEfectivoFinal + pagoTarjetaFinal + pagoTransferenciaFinal,
      2,
    );
    if (totalPagosCapturados <= 0) {
      pagoEfectivoFinal = adelanto;
    }
  }

  const total = calcularTotalVenta();
  const totalPagado = roundTo(
    pagoEfectivoFinal + pagoTarjetaFinal + pagoTransferenciaFinal,
    2,
  );

  const pendiente = {
    id: `CP-${Date.now()}`,
    fecha: new Date().toISOString(),
    referencia,
    tipo: tipo === "APARTADO" ? "APARTADO" : "COTIZACION",
    adelanto: esApartado ? adelanto : 0,
    notas,
    items: carritoVenta.map((item) => ({
      codigo: item.codigo,
      nombre: item.nombre,
      cantidad: roundTo(parseNumber(item.cantidad, 0), 4),
      precioUnitario: roundTo(parseNumber(item.precioUnitario, 0), 4),
      precioVariable: parseBoolean(item.precioVariable),
      subtotal: roundTo(parseNumber(item.subtotal, 0), 4),
    })),
    total: roundTo(total, 2),
    pagos: {
      efectivo: pagoEfectivoFinal,
      tarjeta: pagoTarjetaFinal,
      transferencia: pagoTransferenciaFinal,
    },
    totalPagado,
  };

  localDB.carritosPendientes.push(pendiente);
  guardarEstadoLocal();
  renderCarritosPendientes();

  if (notasInput) notasInput.value = "";
  showMessage(
    "msgVenta",
    `${obtenerTipoPendienteTexto(pendiente.tipo)} guardado: ${pendiente.id}.`,
    "success",
  );
}

function cargarCarritoPendiente(pendienteId) {
  const id = (pendienteId || "").toString();
  const pendiente = localDB.carritosPendientes.find((p) => (p.id || "") === id);
  if (!pendiente) {
    showMessage("msgVenta", "No se encontro el carrito pendiente.", "error");
    return;
  }

  const itemsPendientes = Array.isArray(pendiente.items) ? pendiente.items : [];
  if (!itemsPendientes.length) {
    showMessage("msgVenta", "El pendiente no tiene productos.", "warning");
    return;
  }

  for (const item of itemsPendientes) {
    const producto = obtenerProductoPorCodigo(item.codigo);
    if (!producto) {
      showMessage(
        "msgVenta",
        `No se puede cargar el pendiente: el producto ${item.codigo} ya no existe.`,
        "error",
      );
      return;
    }
    const stockActual = calcularStock(item.codigo);
    const cantidadItem = Math.max(1, parseInt(item.cantidad, 10) || 1);
    if (stockActual < cantidadItem) {
      showMessage(
        "msgVenta",
        `Stock insuficiente para cargar ${producto.nombre}. Disponible: ${stockActual}, requerido: ${cantidadItem}.`,
        "error",
      );
      return;
    }
  }

  carritoVenta = itemsPendientes.map((item) => ({
    codigo: item.codigo,
    nombre: item.nombre,
    cantidad: Math.max(1, parseInt(item.cantidad, 10) || 1),
    precioUnitario: roundTo(parseNumber(item.precioUnitario, 0), 4),
    precioVariable: parseBoolean(item.precioVariable),
    subtotal: roundTo(
      Math.max(1, parseInt(item.cantidad, 10) || 1) *
      roundTo(parseNumber(item.precioUnitario, 0), 4),
      4,
    ),
  }));

  carritoPendienteActivoId = pendiente.id;

  const pagoEfectivo = document.getElementById("pagoEfectivo");
  const pagoTarjeta = document.getElementById("pagoTarjeta");
  const pagoTransferencia = document.getElementById("pagoTransferencia");
  const referenciaInput = document.getElementById("pendienteReferenciaVenta");
  const tipoInput = document.getElementById("pendienteTipoVenta");
  const adelantoInput = document.getElementById("pendienteAdelantoVenta");
  const notasInput = document.getElementById("pendienteNotasVenta");

  if (pagoEfectivo)
    pagoEfectivo.value = String(
      roundTo(parseNumber(pendiente.pagos && pendiente.pagos.efectivo, 0), 2),
    );
  if (pagoTarjeta)
    pagoTarjeta.value = String(
      roundTo(parseNumber(pendiente.pagos && pendiente.pagos.tarjeta, 0), 2),
    );
  if (pagoTransferencia)
    pagoTransferencia.value = String(
      roundTo(
        parseNumber(pendiente.pagos && pendiente.pagos.transferencia, 0),
        2,
      ),
    );
  if (referenciaInput) referenciaInput.value = pendiente.referencia || "";
  if (tipoInput)
    tipoInput.value =
      normalizeCode(pendiente.tipo) === "APARTADO" ? "APARTADO" : "COTIZACION";
  if (adelantoInput) {
    adelantoInput.value = String(
      roundTo(parseNumber(pendiente.adelanto, 0), 2),
    );
  }
  if (notasInput) notasInput.value = pendiente.notas || "";
  actualizarCampoAdelantoPendiente();

  renderVentaCarrito();
  actualizarTotalesPagoVenta();
  showMessage(
    "msgVenta",
    `${obtenerTipoPendienteTexto(pendiente.tipo)} ${pendiente.id} cargado en el carrito.`,
    "info",
  );
}

function eliminarCarritoPendiente(pendienteId) {
  const id = (pendienteId || "").toString();
  const pendiente = localDB.carritosPendientes.find((p) => (p.id || "") === id);
  if (!pendiente) {
    showMessage("msgVenta", "No se encontro el carrito pendiente.", "error");
    return;
  }

  const ok = confirm(
    `Se eliminara el ${obtenerTipoPendienteTexto(pendiente.tipo).toLowerCase()} ${pendiente.id} (${pendiente.referencia}). ¿Desea continuar?`,
  );
  if (!ok) return;

  localDB.carritosPendientes = localDB.carritosPendientes.filter(
    (p) => (p.id || "") !== id,
  );
  if (carritoPendienteActivoId === id) {
    carritoPendienteActivoId = "";
  }
  guardarEstadoLocal();
  renderCarritosPendientes();
  showMessage("msgVenta", "Carrito pendiente eliminado.", "success");
}

function renderCarritosPendientes() {
  const container = document.getElementById("carritosPendientesVenta");
  if (!container) return;

  const pendientes = Array.isArray(localDB.carritosPendientes)
    ? [...localDB.carritosPendientes].sort(
      (a, b) => new Date(b.fecha) - new Date(a.fecha),
    )
    : [];

  if (!pendientes.length) {
    container.innerHTML =
      '<div class="message info">No hay carritos pendientes guardados.</div>';
    return;
  }

  let html = `
        <table>
          <thead>
            <tr>
              <th>Folio</th>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Cliente/Referencia</th>
              <th>Items</th>
              <th>Total</th>
              <th>Adelanto</th>
              <th>Restante</th>
              <th>Pagado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
      `;

  pendientes.forEach((pendiente) => {
    const itemsCount = Array.isArray(pendiente.items)
      ? pendiente.items.reduce(
        (acc, item) => acc + Math.max(1, parseInt(item.cantidad, 10) || 1),
        0,
      )
      : 0;
    const total = roundTo(parseNumber(pendiente.total, 0), 2);
    const adelanto = roundTo(parseNumber(pendiente.adelanto, 0), 2);
    const pagado = roundTo(
      parseNumber(
        pendiente.totalPagado,
        parseNumber(pendiente.pagos && pendiente.pagos.efectivo, 0) +
        parseNumber(pendiente.pagos && pendiente.pagos.tarjeta, 0) +
        parseNumber(pendiente.pagos && pendiente.pagos.transferencia, 0),
      ),
      2,
    );
    const restante = Math.max(0, roundTo(total - adelanto, 2));
    const tagClass =
      normalizeCode(pendiente.tipo) === "APARTADO"
        ? "badge-apartado"
        : "badge-cotizacion";

    html += `
          <tr>
            <td>${pendiente.id}</td>
            <td>${formatDate(pendiente.fecha)}</td>
            <td><span class="badge-pendiente ${tagClass}">${obtenerTipoPendienteTexto(pendiente.tipo)}</span></td>
            <td>${pendiente.referencia || "-"}</td>
            <td>${roundTo(itemsCount, 2)}</td>
            <td>${formatMoney(total)}</td>
            <td>${formatMoney(adelanto)}</td>
            <td>${formatMoney(restante)}</td>
            <td>${formatMoney(pagado)}</td>
            <td>
              <div class="actions actions-inline">
                <button type="button" class="btn btn-primary" onclick="cargarCarritoPendiente('${pendiente.id}')">Cargar</button>
                <button type="button" class="btn btn-danger" onclick="eliminarCarritoPendiente('${pendiente.id}')">Eliminar</button>
              </div>
            </td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function obtenerVentaPorId(ventaId) {
  const id = (ventaId || "").toString();
  return localDB.ventas.find((v) => (v.id || "") === id) || null;
}

function construirHtmlTicket(venta) {
  const config = localDB.config || DEFAULT_CONFIG;
  const fecha = formatDate(venta.fecha);
  const hora = new Date(venta.fecha).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const totalItems = Array.isArray(venta.items)
    ? venta.items.reduce((acc, item) => acc + parseNumber(item.cantidad, 0), 0)
    : 0;

  let rows = "";
  (venta.items || []).forEach((item) => {
    const pu = parseNumber(item.precioUnitario, 0);
    const sub = parseNumber(item.subtotal, item.cantidad * pu) || parseNumber(item.total, 0);
    rows += `
          <tr>
            <td class="c-cant">${roundTo(item.cantidad, 2)}</td>
            <td class="c-prod">
              ${escapeXml(item.nombre)}
              ${pu > 0 ? `<br><small style="color:#333;">@ ${formatMoney(pu)} c/u</small>` : ""}
            </td>
            <td class="c-sub">${formatMoney(sub)}</td>
          </tr>
        `;
  });

  return `
        <!DOCTYPE html>
        <html lang="es">
        <head>
          <meta charset="UTF-8">
          <title>Ticket ${venta.id}</title>
          <style>
            @page {
              size: 80mm auto;
              margin: 0;
            }
            html, body {
              width: 80mm;
              margin: 0;
              padding: 0;
              color: #000000;
              font-family: "Arial", sans-serif;
              font-size: 11px;
              line-height: 1.2;
            }
            h1, h2, h3, p { margin: 0; }
            .ticket {
              width: 72mm;
              margin: 0 auto;
              padding: 3mm 0;
            }
            .center { text-align: center; }
            .space { margin-top: 4px; }
            .muted { color: #000000; font-size: 10px; }
            .line {
              border-top: 1px dashed #000;
              margin: 4px 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 4px;
              table-layout: fixed;
            }
            th, td {
              padding: 2px 0;
              vertical-align: top;
              word-wrap: break-word;
            }
            th { text-align: left; font-weight: 700; }
            .c-cant { width: 10mm; text-align: left; }
            .c-prod { width: 42mm; }
            .c-sub { width: 20mm; text-align: right; }
            .totals { margin-top: 4px; font-size: 11px; }
            .totals-row { display: flex; justify-content: space-between; margin: 2px 0; }
            .total-final { font-size: 12px; font-weight: 700; }
            .strong { font-weight: 700; }

            @media print {
              html, body {
                width: 80mm;
              }
            }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="center">
              <h3>${config.businessName || DEFAULT_CONFIG.businessName}</h3>
              <p class="muted">TICKET DE VENTA</p>
              ${config.businessPhone ? `<p class="muted">TEL: ${config.businessPhone}</p>` : ""}
            </div>

            <div class="line"></div>

            <div class="space">
              <p><span class="strong">FOLIO:</span> ${venta.id}</p>
              <p><span class="strong">FECHA:</span> ${fecha}</p>
              <p><span class="strong">ARTICULOS:</span> ${roundTo(totalItems, 2)}</p>
            </div>

            <div class="line"></div>

            <table>
              <thead>
                <tr>
                  <th class="c-cant">CANT</th>
                  <th class="c-prod">PRODUCTO</th>
                  <th class="c-sub">IMPORTE</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>

            <div class="line"></div>

            <div class="totals">
              <div class="totals-row total-final"><span>TOTAL</span><span>${formatMoney(venta.total)}</span></div>
              <div class="totals-row"><span>EFECTIVO</span><span>${formatMoney(venta.pagos ? venta.pagos.efectivo : 0)}</span></div>
              <div class="totals-row"><span>TARJETA</span><span>${formatMoney(venta.pagos ? venta.pagos.tarjeta : 0)}</span></div>
              <div class="totals-row"><span>TRANSFERENCIA</span><span>${formatMoney(venta.pagos ? venta.pagos.transferencia : 0)}</span></div>
              <div class="totals-row"><span>CAMBIO</span><span>${formatMoney(venta.cambio || 0)}</span></div>
            </div>

            <div class="line"></div>
            <p class="center muted">GRACIAS POR SU COMPRA</p>
            ${config.fiscalLegend ? `<p class="center muted">${config.fiscalLegend}</p>` : ""}
            <p class="center muted space">------ FIN DEL TICKET ------</p>
          </div>
          <script>window.onload = function(){ window.print(); };</script>
        </body>
        </html>
      `;
}

function imprimirVentaPorId(ventaId) {
  const venta = obtenerVentaPorId(ventaId);
  if (!venta) {
    showMessage(
      "msgVenta",
      "No se encontro la venta para imprimir ticket.",
      "error",
    );
    return;
  }

  const popup = window.open("", "_blank", "width=420,height=640");
  if (!popup) {
    showMessage(
      "msgVenta",
      "El navegador bloqueo la ventana de impresion. Habilite popups para este sitio.",
      "error",
    );
    return;
  }

  popup.document.open();
  popup.document.write(construirHtmlTicket(venta));
  popup.document.close();
}

function imprimirUltimaVenta() {
  if (!ultimaVentaId) {
    showMessage(
      "msgVenta",
      "Aun no hay una venta reciente para imprimir.",
      "warning",
    );
    return;
  }
  imprimirVentaPorId(ultimaVentaId);
}

function buscarProductoPorCodigo(codigo) {
  const texto = normalizeCode(codigo);
  if (!texto) return [];

  return localDB.productos
    .filter((p) => {
      const codigoProducto = normalizeCode(p.codigo);
      const nombreProducto = normalizeCode(p.nombre);
      return codigoProducto.includes(texto) || nombreProducto.includes(texto);
    })
    .slice(0, 10)
    .map((p) => ({
      codigo: p.codigo,
      nombre: p.nombre,
    }));
}

function buscarProductoLocal(texto) {
  const query = (texto || "").toString().toLowerCase().trim();
  if (!query) return [];

  return localDB.productos
    .filter(
      (p) =>
        p.codigo.toLowerCase().includes(query) ||
        p.nombre.toLowerCase().includes(query),
    )
    .map((p) => {
      const costoPromedioPieza = calcularCostoPromedioPorPieza(p.codigo);
      const precioVenta = Math.max(0, parseNumber(p.precioVenta, 0));
      return {
        codigo: p.codigo,
        nombre: p.nombre,
        stockMinimo: p.stockMinimo,
        stockActual: calcularStock(p.codigo),
        costoPromedioPieza,
        precioVenta,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function validarIntegridadLocal() {
  const errores = [];
  const codigos = new Set();

  localDB.productos.forEach((p) => {
    const cod = normalizeCode(p.codigo);
    if (!cod) errores.push("Producto con codigo vacio.");
    if (codigos.has(cod))
      errores.push(`Codigo de producto duplicado: ${p.codigo}`);
    codigos.add(cod);
    if (!p.nombre || p.nombre.trim().length < 2) {
      errores.push(`Producto ${p.codigo} tiene nombre invalido.`);
    }
    if (
      Number.isNaN(parseInt(p.stockMinimo, 10)) ||
      parseInt(p.stockMinimo, 10) < 0
    ) {
      errores.push(`Producto ${p.codigo} tiene stock minimo invalido.`);
    }
    const margen = parseNumber(p.margen, 30);
    if (margen < 0 || margen > 1000) {
      errores.push(`Producto ${p.codigo} tiene margen invalido.`);
    }
    const precioVenta = parseNumber(p.precioVenta, 0);
    if (precioVenta < 0) {
      errores.push(`Producto ${p.codigo} tiene precio real/de venta invalido.`);
    }
    if (!parseBoolean(p.precioVariable) && precioVenta <= 0) {
      errores.push(
        `Producto ${p.codigo} debe tener precio real/de venta o marcarse como variable.`,
      );
    }
  });

  localDB.movimientos.forEach((m, i) => {
    if (!codigos.has(normalizeCode(m.codigo))) {
      errores.push(`Movimiento con producto inexistente en fila ${i + 1}.`);
    }
    if (!Object.values(TIPOS_MOVIMIENTO).includes(normalizeCode(m.tipo))) {
      errores.push(`Tipo de movimiento invalido en fila ${i + 1}.`);
    }
    if (parseNumber(m.cantidad, 0) <= 0) {
      errores.push(`Cantidad invalida en movimiento fila ${i + 1}.`);
    }
  });

  localDB.gastos.forEach((g, i) => {
    if (!g.concepto || g.concepto.trim().length < 2) {
      errores.push(`Gasto con concepto invalido en fila ${i + 1}.`);
    }
    if (parseNumber(g.monto, 0) <= 0) {
      errores.push(`Monto invalido en gasto fila ${i + 1}.`);
    }
  });

  return { errores };
}

function exportarStockCSVLocal(filtroSucursal = null) {
  const filtro = filtroSucursal || (document.getElementById("filtroSucursalInventario") ? document.getElementById("filtroSucursalInventario").value : "TODAS");
  const stock = obtenerStock(filtro);
  if (!stock.length) return null;

  const sucursales = obtenerSucursales();
  const esConsolidado = filtro === "TODAS";

  let csv = "";
  if (esConsolidado) {
    const nombresSuc = sucursales.map((s) => `Stock ${s.nombre}`).join(",");
    csv = `Codigo,Nombre,Stock Minimo,Stock Total,${nombresSuc},Precio Real/Venta,Estado\n`;
    stock.forEach((producto) => {
      let estado = producto.cantidad <= 0 ? "Sin Stock" : (producto.cantidad <= producto.stockMinimo && producto.stockMinimo > 0 ? "Stock Bajo" : "Normal");
      const colsSuc = sucursales.map((s) => (producto.stockPorSucursal ? (producto.stockPorSucursal[s.id] || 0) : 0)).join(",");
      csv += `"${producto.codigo}","${producto.nombre}",${producto.stockMinimo},${producto.cantidad},${colsSuc},${roundTo(producto.precioVenta || 0, 4)},"${estado}"\n`;
    });
  } else {
    const sucursalTarget = sucursales.find((s) => s.id === filtro);
    const nombreSuc = sucursalTarget ? sucursalTarget.nombre : "Sucursal";
    csv = `Codigo,Nombre,Sucursal,Stock Minimo,Stock Actual,Precio Real/Venta,Estado,Diferencia\n`;
    stock.forEach((producto) => {
      let estado = "Normal";
      let diferencia = 0;

      if (producto.cantidad <= 0) {
        estado = "Sin Stock";
        diferencia = -producto.stockMinimo;
      } else if (
        producto.cantidad <= producto.stockMinimo &&
        producto.stockMinimo > 0
      ) {
        estado = "Stock Bajo";
        diferencia = -(producto.stockMinimo - producto.cantidad);
      } else {
        diferencia = producto.cantidad - producto.stockMinimo;
      }

      csv += `"${producto.codigo}","${producto.nombre}","${nombreSuc}",${producto.stockMinimo},${producto.cantidad},${roundTo(producto.precioVenta || 0, 4)},"${estado}","${diferencia}"\n`;
    });
  }

  return csv;
}

let mostrarValoresVentasCaja = false;

function togglePrivacidadVentasCaja() {
  mostrarValoresVentasCaja = !mostrarValoresVentasCaja;
  loadDashboard();

  if (mostrarValoresVentasCaja) {
    setTimeout(() => {
      mostrarValoresVentasCaja = false;
      loadDashboard();
    }, 10000);
  }
}

function exportarEstadoLocal() {
  return JSON.stringify(localDB, null, 2);
}

function loadDashboard() {
  const data = obtenerResumen();
  const statsGrid = document.getElementById("statsGrid");


  const hideVal = (monto) => (mostrarValoresVentasCaja ? formatMoney(monto) : "••••••");

  statsGrid.innerHTML = `
        <section class="stats-section">
          <div class="stats-section-header" style="display: flex; justify-content: space-between; align-items: center;">
            <h3>Ventas y Caja</h3>
            <button class="btn btn-secondary btn-sm" onclick="togglePrivacidadVentasCaja()" style="display: flex; align-items: center; gap: 6px; padding: 5px 12px; font-size: 0.82rem;">
              <span>${mostrarValoresVentasCaja ? "👁️ Ocultar valores" : "🔒 Mostrar valores"}</span>
            </button>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--sales">
              <div class="stat-kicker">Ingresos</div>
              <div class="stat-value">${hideVal(data.totalVentas)}</div>
              <div class="stat-label">Total Ventas (${data.cantidadVentas})</div>
            </div>
            <div class="stat-card stat-card--expense">
              <div class="stat-kicker">Egresos</div>
              <div class="stat-value">${hideVal(data.totalGastos)}</div>
              <div class="stat-label">Total Gastos Operativos</div>
            </div>
            <div class="stat-card stat-card--withdrawal">
              <div class="stat-kicker">Retiros</div>
              <div class="stat-value">${hideVal(data.totalRetiros)}</div>
              <div class="stat-label">Retiros (Resguardo de Caja)</div>
            </div>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--cash">
              <div class="stat-kicker">Efectivo recibido</div>
              <div class="stat-value">${hideVal(data.pagosEfectivo)}</div>
              <div class="stat-label">Pagos en Efectivo</div>
            </div>
            <div class="stat-card stat-card--cash">
              <div class="stat-kicker">Caja actual</div>
              <div class="stat-value">${hideVal(data.dineroEnCaja)}</div>
              <div class="stat-label">${data.cajaEstadoLabel}</div>
            </div>
            <div class="stat-card stat-card--neutral">
              <div class="stat-kicker">Caja esperada</div>
              <div class="stat-value">${hideVal(data.cajaEsperada)}</div>
              <div class="stat-label">Efectivo − Gastos − Retiros</div>
            </div>
            <div class="stat-card ${data.diferenciaCaja >= 0 ? 'stat-card--cash' : 'stat-card--alert'}">
              <div class="stat-kicker">${data.diferenciaCaja >= 0 ? '✅ Sobrante' : '⚠️ Faltante'}</div>
              <div class="stat-value">${hideVal(Math.abs(data.diferenciaCaja))}</div>
              <div class="stat-label">Diferencia en Caja</div>
            </div>
          </div>
        </section>
        <section class="stats-section">
          <div class="stats-section-header">
            <h3>Inventario y Operación</h3>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--neutral">
              <div class="stat-kicker">Inventario</div>
              <div class="stat-value">${data.totalProductos}</div>
              <div class="stat-label">Total Productos</div>
            </div>
            <div class="stat-card stat-card--neutral">
              <div class="stat-kicker">Operación</div>
              <div class="stat-value">${data.totalMovimientos}</div>
              <div class="stat-label">Total Movimientos</div>
            </div>
            <div class="stat-card stat-card--neutral">
              <div class="stat-kicker">Existencias</div>
              <div class="stat-value">${roundTo(data.valorTotalInventario, 2)}</div>
              <div class="stat-label">Unidades en Inventario</div>
            </div>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--alert">
              <div class="stat-kicker">Atención</div>
              <div class="stat-value">${data.sinStock}</div>
              <div class="stat-label">Sin Stock</div>
            </div>
            <div class="stat-card stat-card--warning">
              <div class="stat-kicker">Atención</div>
              <div class="stat-value">${data.stockBajo}</div>
              <div class="stat-label">Stock Bajo</div>
            </div>
            <div class="stat-card stat-card--neutral">
              <div class="stat-kicker">Actividad</div>
              <div class="stat-value">${data.movimientosUltimoMes}</div>
              <div class="stat-label">Movimientos Ultimo Mes</div>
            </div>
          </div>
        </section>
        <section class="stats-section">
          <div class="stats-section-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <h3>Control de Pedidos Personalizados</h3>
            <button class="btn btn-secondary btn-sm" onclick="showTab('pedidos')">Ver Gestión de Pedidos ➔</button>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--neutral" onclick="showTab('pedidos')" style="cursor:pointer;" title="Ir al módulo de Pedidos">
              <div class="stat-kicker">Totales</div>
              <div class="stat-value">${data.totalPedidos}</div>
              <div class="stat-label">Total Pedidos</div>
            </div>
            <div class="stat-card stat-card--warning" onclick="showTab('pedidos')" style="cursor:pointer;" title="Ir al módulo de Pedidos">
              <div class="stat-kicker">Estado</div>
              <div class="stat-value" style="color:#d97706;">${data.pedidosPendientes}</div>
              <div class="stat-label">Pedidos Pendientes</div>
            </div>
            <div class="stat-card stat-card--sales" onclick="showTab('pedidos')" style="cursor:pointer;" title="Ir al módulo de Pedidos">
              <div class="stat-kicker">Avance</div>
              <div class="stat-value">${data.pedidosEnProceso + data.pedidosTerminados}</div>
              <div class="stat-label">${data.pedidosEnProceso} En Proceso | ${data.pedidosTerminados} Terminados</div>
            </div>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--warning" onclick="showTab('pedidos')" style="cursor:pointer;" title="Ir al módulo de Pedidos">
              <div class="stat-kicker">Próximos (3 días)</div>
              <div class="stat-value" style="color: #d97706;">${data.pedidosPorVencer}</div>
              <div class="stat-label">Por Vencer</div>
            </div>
            <div class="stat-card stat-card--alert" onclick="verPedidosVencidos()" style="cursor:pointer;" title="Ver Pedidos Vencidos">
              <div class="stat-kicker">Atrasados</div>
              <div class="stat-value" style="color: #dc2626;">${data.pedidosVencidos}</div>
              <div class="stat-label">Pedidos Vencidos</div>
            </div>
            <div class="stat-card stat-card--cash" onclick="showTab('pedidos')" style="cursor:pointer;" title="Ir al módulo de Pedidos">
              <div class="stat-kicker">Completados</div>
              <div class="stat-value">${data.pedidosEntregados}</div>
              <div class="stat-label">Pedidos Entregados</div>
            </div>
          </div>
        </section>
      `;
}

function loadListas() {
  return;
}

function cargarConfiguracionSistema() {
  const config = { ...DEFAULT_CONFIG, ...(localDB.config || {}) };
  localDB.config = config;

  const nameField = document.getElementById("businessNameConfig");
  const phoneField = document.getElementById("businessPhoneConfig");
  const legendField = document.getElementById("fiscalLegendConfig");

  if (nameField)
    nameField.value = config.businessName || DEFAULT_CONFIG.businessName;
  if (phoneField) phoneField.value = config.businessPhone || "";
  if (legendField) legendField.value = config.fiscalLegend || "";

  renderSelectorSucursal();
  renderizarTablaSucursales();
}

function guardarConfiguracionSistema(event) {
  if (event) event.preventDefault();

  const businessName = document
    .getElementById("businessNameConfig")
    .value.trim();
  const businessPhone = document
    .getElementById("businessPhoneConfig")
    .value.trim();
  const fiscalLegend = document
    .getElementById("fiscalLegendConfig")
    .value.trim();

  if (!businessName) {
    showMessage(
      "msgConfigNegocio",
      "El nombre del negocio es obligatorio.",
      "error",
    );
    return;
  }

  localDB.config = {
    businessName,
    businessPhone,
    fiscalLegend,
  };

  guardarEstadoLocal();
  showMessage(
    "msgConfigNegocio",
    "Configuración del negocio guardada correctamente.",
    "success",
  );
  loadDashboard();
}

function restaurarConfiguracionSistema() {
  localDB.config = { ...DEFAULT_CONFIG };
  guardarEstadoLocal();
  cargarConfiguracionSistema();
  showMessage(
    "msgConfigNegocio",
    "Configuración restaurada a valores por defecto.",
    "success",
  );
}

function buscarProductoAutocompletado() {
  clearTimeout(autocompleteTimeout);
  const input = document.getElementById("codigoMov");
  const dropdown = document.getElementById("autocompleteDropdown");
  const codigo = input.value.trim().toUpperCase();

  if (codigo.length === 0) {
    dropdown.style.display = "none";
    return;
  }

  autocompleteTimeout = setTimeout(() => {
    const productos = buscarProductoPorCodigo(codigo);
    mostrarAutocompletado(productos);
  }, 200);
}

function mostrarAutocompletado(productos = []) {
  const dropdown = document.getElementById("autocompleteDropdown");

  if (productos.length === 0) {
    dropdown.style.display = "none";
    return;
  }

  let html = "";
  productos.forEach((producto) => {
    html += `
          <div class="autocomplete-item" onmousedown="seleccionarProducto('${producto.codigo}', '${producto.nombre}')">
            <div class="autocomplete-code">${producto.codigo}</div>
            <div class="autocomplete-name">${producto.nombre}</div>
          </div>
        `;
  });

  dropdown.innerHTML = html;
  dropdown.style.display = "block";
}

function seleccionarProducto(codigo) {
  document.getElementById("codigoMov").value = codigo;
  document.getElementById("autocompleteDropdown").style.display = "none";
}

function ocultarAutocompletado() {
  setTimeout(() => {
    document.getElementById("autocompleteDropdown").style.display = "none";
  }, 150);
}

function buscarProductoAutocompletadoVenta() {
  clearTimeout(autocompleteVentaTimeout);
  const input = document.getElementById("codigoVenta");
  const dropdown = document.getElementById("autocompleteDropdownVenta");
  if (!input || !dropdown) return;

  const codigo = input.value.trim().toUpperCase();

  if (codigo.length === 0) {
    dropdown.style.display = "none";
    return;
  }

  autocompleteVentaTimeout = setTimeout(() => {
    const productos = buscarProductoPorCodigo(codigo);
    mostrarAutocompletadoVenta(productos);
  }, 200);
}

function mostrarAutocompletadoVenta(productos = []) {
  const dropdown = document.getElementById("autocompleteDropdownVenta");
  if (!dropdown) return;

  if (productos.length === 0) {
    dropdown.style.display = "none";
    return;
  }

  let html = "";
  productos.forEach((producto) => {
    html += `
          <div class="autocomplete-item" onmousedown="seleccionarProductoVenta('${producto.codigo}')">
            <div class="autocomplete-code">${producto.codigo}</div>
            <div class="autocomplete-name">${producto.nombre}</div>
          </div>
        `;
  });

  dropdown.innerHTML = html;
  dropdown.style.display = "block";
}

function seleccionarProductoVenta(codigo) {
  const input = document.getElementById("codigoVenta");
  const dropdown = document.getElementById("autocompleteDropdownVenta");
  if (input) input.value = codigo;
  if (dropdown) dropdown.style.display = "none";
  if (input) input.focus();
}

function ocultarAutocompletadoVenta() {
  setTimeout(() => {
    const dropdown = document.getElementById("autocompleteDropdownVenta");
    if (dropdown) dropdown.style.display = "none";
  }, 150);
}

function registrarProducto(event) {
  event.preventDefault();
  const precioVariable = document.getElementById("precioVariableProd")
    ? document.getElementById("precioVariableProd").checked
    : false;

  const stockInicialEl = document.getElementById("stockInicialProd");
  const stockInicial = stockInicialEl ? parseFloat(stockInicialEl.value) || 0 : 0;

  const producto = {
    codigo: document.getElementById("codigoProd").value.trim().toUpperCase(),
    nombre: document.getElementById("nombreProd").value.trim(),
    stockMinimo: parseInt(document.getElementById("stockMinProd").value, 10) || 0,
    precioVenta:
      parseFloat(document.getElementById("precioVentaProd").value) || 0,
    precioVariable,
    stockInicial,
  };

  const mensaje = registrarProductoLocal(producto);
  const ok = mensaje.includes("correctamente");
  showMessage("msgProd", mensaje, ok ? "success" : "error");

  if (ok) {
    document.getElementById("formProducto").reset();
    if (stockInicialEl) stockInicialEl.value = "0";
    document.getElementById("stockMinProd").value = "0";
    document.getElementById("precioVentaProd").value = "";
    actualizarPrecioVariableProducto();
    loadDashboard();
  }
}

function registrarMovimiento(event) {
  event.preventDefault();

  const sucursalMovEl = document.getElementById("sucursalMovimiento");
  const sucursalId = sucursalMovEl ? sucursalMovEl.value : obtenerSucursalActivaId();

  const movimiento = {
    codigo: document.getElementById("codigoMov").value.trim().toUpperCase(),
    fecha: document.getElementById("fechaMov").value,
    tipo: document.getElementById("tipoMov").value,
    cantidad: parseFloat(document.getElementById("cantMov").value) || 0,
    sucursalId,
    unidadCompra: document.getElementById("unidadCompraMov")
      ? document.getElementById("unidadCompraMov").value
      : "PIEZA",
    piezasPorPresentacion: document.getElementById("piezasPorPresentacionMov")
      ? parseInt(
        document.getElementById("piezasPorPresentacionMov").value,
        10,
      ) || 1
      : 1,
    costoCompra: document.getElementById("costoCompraMov")
      ? parseFloat(document.getElementById("costoCompraMov").value) || 0
      : 0,
    observaciones: document.getElementById("obsMov").value.trim(),
  };

  const mensaje = registrarMovimientoLocal(movimiento);
  const ok = mensaje.includes("correctamente");
  showMessage("msgMov", mensaje, ok ? "success" : "error");

  if (ok) {
    document.getElementById("formMovimiento").reset();
    document.getElementById("fechaMov").valueAsDate = new Date();
    if (sucursalMovEl) sucursalMovEl.value = obtenerSucursalActivaId();
    const preview = document.getElementById("costoPorPiezaPreviewMov");
    if (preview) preview.value = "";
    handleTipoChange();
    loadDashboard();
  }
}

function registrarGasto(event) {
  event.preventDefault();

  const gasto = {
    fecha: document.getElementById("fechaGasto").value,
    concepto: document.getElementById("conceptoGasto").value.trim(),
    categoria: document.getElementById("categoriaGasto").value,
    metodoPago: document.getElementById("metodoGasto") ? document.getElementById("metodoGasto").value : "EFECTIVO",
    persona: document.getElementById("personaGasto") ? document.getElementById("personaGasto").value.trim() : "",
    monto: parseFloat(document.getElementById("montoGasto").value) || 0,
    observaciones: document.getElementById("obsGasto").value.trim(),
  };

  const mensaje = registrarGastoLocal(gasto);
  const ok = mensaje.includes("correctamente");
  showMessage("msgGasto", mensaje, ok ? "success" : "error");

  if (ok) {
    document.getElementById("formGasto").reset();
    document.getElementById("fechaGasto").valueAsDate = new Date();
    if (document.getElementById("metodoGasto")) {
      document.getElementById("metodoGasto").value = "EFECTIVO";
    }
    if (document.getElementById("personaGasto")) {
      document.getElementById("personaGasto").value = "";
    }
    renderGastosRecientes();
    loadDashboard();
  }
}

function handleTipoChange() {
  const tipo = document.getElementById("tipoMov").value;
  const cantField = document.getElementById("cantMov");

  if (tipo === "INGRESO") cantField.placeholder = "Cantidad a ingresar";
  if (tipo === "SALIDA") cantField.placeholder = "Cantidad a retirar";
  if (tipo === "AJUSTE_POSITIVO") cantField.placeholder = "Cantidad a aumentar";
  if (tipo === "AJUSTE_NEGATIVO")
    cantField.placeholder = "Cantidad a disminuir";
}

function mostrarStock() {
  const loading = document.getElementById("loading");
  const container = document.getElementById("stockTable");
  const filtroInput = document.getElementById("buscarInventarioTexto");
  const query = filtroInput ? filtroInput.value.trim().toLowerCase() : "";
  const filtroSuc = document.getElementById("filtroSucursalInventario") ? document.getElementById("filtroSucursalInventario").value : "TODAS";

  if (loading) loading.style.display = "block";
  let data = obtenerStock(filtroSuc);
  if (query) {
    data = data.filter((p) => {
      const cod = (p.codigo || "").toLowerCase();
      const nom = (p.nombre || "").toLowerCase();
      return cod.includes(query) || nom.includes(query);
    });
  }
  if (loading) loading.style.display = "none";
  displayStockTable(data, container, filtroSuc);
}

function filtrarInventarioEnTiempoReal() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    mostrarStock();
  }, 300);
}

function limpiarBusquedaInventario() {
  const input = document.getElementById("buscarInventarioTexto");
  if (input) input.value = "";
  mostrarStock();
}

function displayStockTable(data, container, filtroSucursal = "TODAS") {
  if (data.length === 0) {
    container.innerHTML =
      '<div class="message warning">No hay productos registrados</div>';
    return;
  }

  const sucursales = obtenerSucursales();
  const sucursalElegida = sucursales.find((s) => s.id === filtroSucursal);
  const esConsolidado = filtroSucursal === "TODAS";

  let html = `
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Nombre</th>
              <th>Stock Min.</th>
              <th>${esConsolidado ? "Stock Total" : `Stock (${sucursalElegida ? escapeXml(sucursalElegida.nombre) : "Sucursal"})`}</th>
              ${esConsolidado ? "<th>Desglose por Sucursal</th>" : ""}
              <th>Precio Real/Venta</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
      `;

  data.forEach((producto) => {
    let statusClass = "status-normal";
    let estado = "Normal";

    if (producto.cantidad <= 0) {
      statusClass = "status-zero";
      estado = "Sin Stock";
    } else if (
      producto.cantidad <= producto.stockMinimo &&
      producto.stockMinimo > 0
    ) {
      statusClass = "status-low";
      estado = "Stock Bajo";
    }

    let desgloseHtml = "";
    if (esConsolidado) {
      desgloseHtml = `<td><div style="display:flex; flex-wrap:wrap; gap:4px;">` +
        sucursales
          .map((s) => {
            const qty = producto.stockPorSucursal ? (producto.stockPorSucursal[s.id] || 0) : 0;
            const bg = qty > 0 ? "#e0f2fe" : "#f1f5f9";
            const col = qty > 0 ? "#0369a1" : "#94a3b8";
            return `<span class="badge" style="background:${bg}; color:${col}; font-size:0.75rem; padding:2px 6px;">${escapeXml(s.nombre)}: <strong>${qty}</strong></span>`;
          })
          .join("") + `</div></td>`;
    }

    html += `
          <tr class="${statusClass}">
            <td><button type="button" class="barcode-code-btn" onclick="imprimirCodigoProducto('${producto.codigo}', '${(producto.nombre || "").replace(/'/g, "\\'")}')">${producto.codigo}</button></td>
            <td>${producto.nombre}</td>
            <td>${producto.stockMinimo}</td>
            <td><strong style="font-size:1.05rem;">${producto.cantidad}</strong></td>
            ${desgloseHtml}
            <td>${producto.precioVariable ? "Variable" : producto.precioVenta > 0 ? formatMoney(producto.precioVenta) : "N/D"}</td>
            <td>${estado}</td>
            <td>
              <button class="btn btn-info" onclick="editarProducto('${producto.codigo}')">Editar</button>
            </td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function mostrarAlertas() {
  const loading = document.getElementById("loading");
  const container = document.getElementById("stockTable");
  const filtroSuc = document.getElementById("filtroSucursalInventario") ? document.getElementById("filtroSucursalInventario").value : "TODAS";

  loading.style.display = "block";
  const data = obtenerStock(filtroSuc);
  loading.style.display = "none";

  const alertProducts = data.filter(
    (p) => p.cantidad <= 0 || (p.cantidad <= p.stockMinimo && p.stockMinimo > 0),
  );
  if (alertProducts.length === 0) {
    container.innerHTML =
      '<div class="message success">No hay productos con alertas de stock</div>';
    return;
  }
  displayStockTable(alertProducts, container, filtroSuc);
}

function showStockAlerts() {
  const data = obtenerStock();
  const alertProducts = data.filter(
    (p) => p.cantidad <= 0 || (p.cantidad <= p.stockMinimo && p.stockMinimo > 0),
  );
  const container = document.getElementById("alertsContainer");

  if (alertProducts.length === 0) {
    container.innerHTML =
      '<div class="message success">No hay productos con alertas de stock</div>';
    return;
  }

  let html = `
        <div class="message warning">
          <strong>${alertProducts.length} producto(s) requieren atencion</strong>
        </div>
        <table>
          <thead>
            <tr><th>Codigo</th><th>Nombre</th><th>Stock Actual</th><th>Stock Min.</th><th>Estado</th></tr>
          </thead>
          <tbody>
      `;

  alertProducts.forEach((p) => {
    const estado = p.cantidad <= 0 ? "Sin Stock" : "Stock Bajo";
    const statusClass = p.cantidad <= 0 ? "status-zero" : "status-low";

    html += `
          <tr class="${statusClass}">
            <td>${p.codigo}</td>
            <td>${p.nombre}</td>
            <td>${p.cantidad}</td>
            <td>${p.stockMinimo}</td>
            <td>${estado}</td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function mostrarHistorial() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesde").value,
    fechaHasta: document.getElementById("fechaHasta").value,
    tipo: document.getElementById("filtroTipo").value,
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "historialTable",
      "Seleccione las fechas de consulta",
      "warning",
    );
    return;
  }

  const data = obtenerHistorial(filtros);
  displayHistorialTable(data);
}

function displayHistorialTable(data) {
  const container = document.getElementById("historialTable");

  if (data.length === 0) {
    container.innerHTML =
      '<div class="message warning">No hay movimientos en el periodo seleccionado</div>';
    return;
  }

  let html = `
        <div class="message success">Se encontraron ${data.length} movimientos</div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Codigo</th>
              <th>Producto</th>
              <th>Tipo</th>
              <th>Cantidad</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
      `;

  data.forEach((mov) => {
    let tipoClass = "text-success";
    let tipoText = mov.tipo;

    if (mov.tipo === "INGRESO") {
      tipoClass = "text-success";
      tipoText = "Ingreso";
    }
    if (mov.tipo === "SALIDA") {
      tipoClass = "text-danger";
      tipoText = "Salida";
    }
    if (mov.tipo === "AJUSTE_POSITIVO") {
      tipoClass = "text-success";
      tipoText = "Ajuste +";
    }
    if (mov.tipo === "AJUSTE_NEGATIVO") {
      tipoClass = "text-danger";
      tipoText = "Ajuste -";
    }
    if (mov.tipo === "AJUSTE") {
      tipoClass = "text-warning";
      tipoText = "Ajuste";
    }

    html += `
          <tr>
            <td>${mov.fecha}</td>
            <td>${mov.codigo}</td>
            <td>${mov.producto}</td>
            <td class="${tipoClass}">${tipoText}</td>
            <td>${mov.cantidad}</td>
            <td>${mov.observaciones}</td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function obtenerReporteVentas(filtros) {
  const desde = new Date(`${filtros.fechaDesde}T00:00:00`);
  const hasta = new Date(`${filtros.fechaHasta}T23:59:59`);

  if (
    Number.isNaN(desde.getTime()) ||
    Number.isNaN(hasta.getTime()) ||
    desde > hasta
  ) {
    return [];
  }

  return localDB.ventas
    .filter((venta) => {
      const fecha = new Date(venta.fecha);
      if (Number.isNaN(fecha.getTime())) return false;
      if (fecha < desde || fecha > hasta) return false;
      if (filtros.sucursalId && filtros.sucursalId !== "TODAS") {
        const vSucursal = venta.sucursalId || "SUC-MAIN";
        if (vSucursal !== filtros.sucursalId) return false;
      }
      return true;
    })
    .flatMap((venta) => {
      const items = Array.isArray(venta.items) ? venta.items : [];
      const pagosNetos = calcularPagosNetosVenta(venta);
      const efectivo = pagosNetos.efectivo;
      const tarjeta = pagosNetos.tarjeta;
      const transferencia = pagosNetos.transferencia;
      const total = parseNumber(venta.total, 0);
      const cambio = parseNumber(venta.cambio, 0);

      if (!items.length) {
        return [
          {
            id: venta.id || "SIN-FOLIO",
            fecha: venta.fecha,
            fechaTexto: formatDate(venta.fecha),
            sucursalNombre: venta.sucursalNombre || "Matriz",
            codigoProducto: "-",
            nombreProducto: "Sin detalle",
            cantidad: 0,
            precioUnitario: 0,
            importeLinea: 0,
            importeVenta: roundTo(total, 2),
            efectivo: roundTo(efectivo, 2),
            tarjeta: roundTo(tarjeta, 2),
            transferencia: roundTo(transferencia, 2),
            cambio: roundTo(cambio, 2),
          },
        ];
      }

      return items.map((item) => ({
        id: venta.id || "SIN-FOLIO",
        fecha: venta.fecha,
        fechaTexto: formatDate(venta.fecha),
        sucursalNombre: venta.sucursalNombre || "Matriz",
        codigoProducto: item.codigo || "-",
        nombreProducto: item.nombre || "Producto",
        cantidad: roundTo(parseNumber(item.cantidad, 0), 2),
        precioUnitario: roundTo(parseNumber(item.precioUnitario, 0), 2),
        importeLinea: roundTo(parseNumber(item.subtotal, 0), 2),
        importeVenta: roundTo(total, 2),
        efectivo: roundTo(efectivo, 2),
        tarjeta: roundTo(tarjeta, 2),
        transferencia: roundTo(transferencia, 2),
        cambio: roundTo(cambio, 2),
      }));
    })
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

async function mostrarReporteVentas() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeVentas").value,
    fechaHasta: document.getElementById("fechaHastaVentas").value,
    sucursalId: document.getElementById("filtroSucursalVentas") ? document.getElementById("filtroSucursalVentas").value : "TODAS",
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "reporteVentasTable",
      "Seleccione las fechas para el reporte de ventas.",
      "warning",
    );
    return;
  }

  if (_dbFirestore) {
    try {
      const desdeIso = `${filtros.fechaDesde}T00:00:00`;
      const hastaIso = `${filtros.fechaHasta}T23:59:59`;
      const snap = await obtenerRefColeccion("ventas")
        .where("fecha", ">=", desdeIso)
        .where("fecha", "<=", hastaIso)
        .get();

      const ventasConsulta = snap.docs.map((d) => d.data());
      const idsExistentes = new Set(localDB.ventas.map((v) => v.id));
      ventasConsulta.forEach((v) => {
        if (!idsExistentes.has(v.id)) localDB.ventas.push(v);
      });
    } catch (e) {
      console.warn("Consulta Firestore ventas:", e);
    }
  }

  const data = obtenerReporteVentas(filtros);
  displayReporteVentasTable(data);
}

function displayReporteVentasTable(data) {
  const container = document.getElementById("reporteVentasTable");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML =
      '<div class="message warning">No hay ventas en el periodo seleccionado</div>';
    return;
  }

  const foliosUnicos = new Set(data.map((row) => row.id)).size;
  let totalCantidad = 0;
  let totalImporte = 0;
  const ventasMap = new Map();

  data.forEach((row) => {
    totalCantidad += parseNumber(row.cantidad, 0);
    totalImporte += parseNumber(row.importeLinea, 0);

    if (!ventasMap.has(row.id)) {
      ventasMap.set(row.id, {
        efectivo: parseNumber(row.efectivo, 0),
        tarjeta: parseNumber(row.tarjeta, 0),
        transferencia: parseNumber(row.transferencia, 0),
      });
    }
  });

  let totalEfectivo = 0;
  let totalTarjeta = 0;
  let totalTransferencia = 0;
  ventasMap.forEach((pago) => {
    totalEfectivo += pago.efectivo;
    totalTarjeta += pago.tarjeta;
    totalTransferencia += pago.transferencia;
  });

  totalCantidad = roundTo(totalCantidad, 2);
  totalImporte = roundTo(totalImporte, 2);
  totalEfectivo = roundTo(totalEfectivo, 2);
  totalTarjeta = roundTo(totalTarjeta, 2);
  totalTransferencia = roundTo(totalTransferencia, 2);

  let html = `
        <div class="message success">Se encontraron ${foliosUnicos} venta(s) y ${data.length} linea(s) de producto. Importe total: ${formatMoney(totalImporte)}</div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Folio</th>
              <th>Sucursal</th>
              <th>Codigo</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Precio Unitario</th>
              <th>Efectivo</th>
              <th>Tarjeta</th>
              <th>Transferencia</th>
              <th>Importe Total</th>
            </tr>
          </thead>
          <tbody>
      `;

  const foliosMostrados = new Set();

  data.forEach((row) => {
    const esPrimerItemDelFolio = !foliosMostrados.has(row.id);
    foliosMostrados.add(row.id);

    const efectivoTexto = esPrimerItemDelFolio
      ? formatMoney(row.efectivo)
      : '<span style="color:#94a3b8;">-</span>';
    const tarjetaTexto = esPrimerItemDelFolio
      ? formatMoney(row.tarjeta)
      : '<span style="color:#94a3b8;">-</span>';
    const transTexto = esPrimerItemDelFolio
      ? formatMoney(row.transferencia)
      : '<span style="color:#94a3b8;">-</span>';

    html += `
          <tr>
            <td>${row.fechaTexto}</td>
            <td>${row.id}</td>
            <td><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600;">${escapeXml(row.sucursalNombre || "Matriz")}</span></td>
            <td>${row.codigoProducto}</td>
            <td>${row.nombreProducto}</td>
            <td>${row.cantidad}</td>
            <td>${formatMoney(row.precioUnitario)}</td>
            <td>${efectivoTexto}</td>
            <td>${tarjetaTexto}</td>
            <td>${transTexto}</td>
            <td>${formatMoney(row.importeLinea)}</td>
          </tr>
        `;
  });

  html += `
          </tbody>
          <tfoot>
            <tr style="font-weight: bold; background: #e0f2fe; border-top: 2px solid #0284c7; color: #0369a1;">
              <td colspan="5" style="text-align: right; font-weight: bold;">TOTALES:</td>
              <td>${totalCantidad}</td>
              <td>-</td>
              <td>${formatMoney(totalEfectivo)}</td>
              <td>${formatMoney(totalTarjeta)}</td>
              <td>${formatMoney(totalTransferencia)}</td>
              <td>${formatMoney(totalImporte)}</td>
            </tr>
          </tfoot>
        </table>
      `;

  container.innerHTML = html;
}

function exportarReporteVentas() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeVentas").value,
    fechaHasta: document.getElementById("fechaHastaVentas").value,
    sucursalId: document.getElementById("filtroSucursalVentas") ? document.getElementById("filtroSucursalVentas").value : "TODAS",
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "reporteVentasTable",
      "Seleccione las fechas para exportar el reporte de ventas.",
      "warning",
    );
    return;
  }

  const data = obtenerReporteVentas(filtros);
  if (data.length === 0) {
    showMessage(
      "reporteVentasTable",
      "No hay ventas para exportar en el periodo seleccionado.",
      "warning",
    );
    return;
  }

  let totalCantidad = 0;
  let totalImporte = 0;
  const ventasMap = new Map();

  data.forEach((row) => {
    totalCantidad += parseNumber(row.cantidad, 0);
    totalImporte += parseNumber(row.importeLinea, 0);

    if (!ventasMap.has(row.id)) {
      ventasMap.set(row.id, {
        efectivo: parseNumber(row.efectivo, 0),
        tarjeta: parseNumber(row.tarjeta, 0),
        transferencia: parseNumber(row.transferencia, 0),
      });
    }
  });

  let totalEfectivo = 0;
  let totalTarjeta = 0;
  let totalTransferencia = 0;
  ventasMap.forEach((pago) => {
    totalEfectivo += pago.efectivo;
    totalTarjeta += pago.tarjeta;
    totalTransferencia += pago.transferencia;
  });

  totalCantidad = roundTo(totalCantidad, 2);
  totalImporte = roundTo(totalImporte, 2);
  totalEfectivo = roundTo(totalEfectivo, 2);
  totalTarjeta = roundTo(totalTarjeta, 2);
  totalTransferencia = roundTo(totalTransferencia, 2);

  let csv = "\uFEFF"; // UTF-8 BOM para compatibilidad con Excel
  csv +=
    "Fecha,Folio,Sucursal,Codigo,Producto,Cantidad,Precio Unitario,Efectivo,Tarjeta,Transferencia,Importe Total\n";

  const foliosMostrados = new Set();

  data.forEach((row) => {
    const esPrimerItemDelFolio = !foliosMostrados.has(row.id);
    foliosMostrados.add(row.id);

    const efectivoVal = esPrimerItemDelFolio ? row.efectivo : "-";
    const tarjetaVal = esPrimerItemDelFolio ? row.tarjeta : "-";
    const transVal = esPrimerItemDelFolio ? row.transferencia : "-";

    csv += `"${row.fechaTexto}","${row.id}","${row.sucursalNombre || "Matriz"}","${row.codigoProducto}","${row.nombreProducto}","${row.cantidad}","${row.precioUnitario}","${efectivoVal}","${tarjetaVal}","${transVal}","${row.importeLinea}"\n`;
  });

  // Fila de totales alineada a la interfaz del sistema
  csv += `"TOTALES","","","","${totalCantidad}","-","${totalImporte}","${totalEfectivo}","${totalTarjeta}","${totalTransferencia}"\n`;

  descargarArchivo(
    `Reporte_Ventas_${filtros.fechaDesde}_${filtros.fechaHasta}.csv`,
    csv,
    "text/csv;charset=utf-8;",
  );
  showMessage(
    "reporteVentasTable",
    "Reporte de ventas exportado exitosamente.",
    "success",
  );
}

function obtenerReporteGastos(filtros) {
  const desde = new Date(`${filtros.fechaDesde}T00:00:00`);
  const hasta = new Date(`${filtros.fechaHasta}T23:59:59`);

  if (
    Number.isNaN(desde.getTime()) ||
    Number.isNaN(hasta.getTime()) ||
    desde > hasta
  ) {
    return [];
  }

  return localDB.gastos
    .filter((gasto) => {
      const fecha = new Date(gasto.fecha);
      if (Number.isNaN(fecha.getTime())) return false;
      if (fecha < desde || fecha > hasta) return false;
      if (filtros.sucursalId && filtros.sucursalId !== "TODAS") {
        const gSucursal = gasto.sucursalId || "SUC-MAIN";
        if (gSucursal !== filtros.sucursalId) return false;
      }
      return true;
    })
    .map((gasto) => ({
      id: gasto.id || "SIN-FOLIO",
      fecha: gasto.fecha,
      fechaTexto: formatDate(gasto.fecha),
      sucursalNombre: gasto.sucursalNombre || "Matriz",
      categoria: gasto.categoria || "General",
      concepto: gasto.concepto || "Sin concepto",
      persona: gasto.persona || gasto.responsable || "-",
      metodoPago: (gasto.metodoPago || gasto.metodo || "EFECTIVO").toString().toUpperCase(),
      monto: roundTo(parseNumber(gasto.monto, 0), 2),
      observaciones: gasto.observaciones || "",
    }))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

async function mostrarReporteGastos() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeGastos").value,
    fechaHasta: document.getElementById("fechaHastaGastos").value,
    sucursalId: document.getElementById("filtroSucursalGastos") ? document.getElementById("filtroSucursalGastos").value : "TODAS",
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "reporteGastosTable",
      "Seleccione las fechas para el reporte de gastos.",
      "warning",
    );
    return;
  }

  if (_dbFirestore) {
    try {
      const desdeIso = `${filtros.fechaDesde}T00:00:00`;
      const hastaIso = `${filtros.fechaHasta}T23:59:59`;
      const snap = await obtenerRefColeccion("gastos")
        .where("fecha", ">=", desdeIso)
        .where("fecha", "<=", hastaIso)
        .get();

      const gastosConsulta = snap.docs.map((d) => d.data());
      const idsExistentes = new Set(localDB.gastos.map((g) => g.id));
      gastosConsulta.forEach((g) => {
        if (!idsExistentes.has(g.id)) localDB.gastos.push(g);
      });
    } catch (e) {
      console.warn("Consulta Firestore gastos:", e);
    }
  }

  const data = obtenerReporteGastos(filtros);
  displayReporteGastosTable(data);
}

function displayReporteGastosTable(data) {
  const container = document.getElementById("reporteGastosTable");
  if (!container) return;

  if (data.length === 0) {
    container.innerHTML =
      '<div class="message warning">No hay gastos en el periodo seleccionado</div>';
    return;
  }

  const totalGastos = roundTo(
    data.reduce((acc, row) => acc + parseNumber(row.monto, 0), 0),
    2,
  );

  let html = `
        <div class="message success">Se encontraron ${data.length} gasto(s). Importe total: ${formatMoney(totalGastos)}</div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Folio</th>
              <th>Sucursal</th>
              <th>Categoría</th>
              <th>Concepto</th>
              <th>Realizado por</th>
              <th>Método</th>
              <th>Monto</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
      `;

  data.forEach((row) => {
    html += `
          <tr>
            <td>${row.fechaTexto}</td>
            <td>${row.id}</td>
            <td><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600;">${escapeXml(row.sucursalNombre || "Matriz")}</span></td>
            <td>${row.categoria}</td>
            <td>${row.concepto}</td>
            <td>${escapeXml(row.persona)}</td>
            <td><span class="badge" style="background:#f1f5f9; color:#475569;">${escapeXml(row.metodoPago)}</span></td>
            <td>${formatMoney(row.monto)}</td>
            <td>${row.observaciones}</td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function exportarReporteGastos() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeGastos").value,
    fechaHasta: document.getElementById("fechaHastaGastos").value,
    sucursalId: document.getElementById("filtroSucursalGastos") ? document.getElementById("filtroSucursalGastos").value : "TODAS",
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "reporteGastosTable",
      "Seleccione las fechas para exportar el reporte de gastos.",
      "warning",
    );
    return;
  }

  const data = obtenerReporteGastos(filtros);
  if (data.length === 0) {
    showMessage(
      "reporteGastosTable",
      "No hay gastos para exportar en el periodo seleccionado.",
      "warning",
    );
    return;
  }

  let csv = "Fecha,Folio,Sucursal,Categoria,Concepto,RealizadoPor,Metodo,Monto,Observaciones\n";
  data.forEach((row) => {
    csv += `"${row.fechaTexto}","${row.id}","${row.sucursalNombre || "Matriz"}","${row.categoria}","${row.concepto}","${row.persona}","${row.metodoPago}","${row.monto}","${row.observaciones}"\n`;
  });

  descargarArchivo(
    `Reporte_Gastos_${filtros.fechaDesde}_${filtros.fechaHasta}.csv`,
    csv,
    "text/csv;charset=utf-8;",
  );
  showMessage(
    "reporteGastosTable",
    "Reporte de gastos exportado exitosamente.",
    "success",
  );
}

// ── Resumen Financiero General ────────────────────────────────────────────
function obtenerDatosResumenFinanciero(fechaDesde, fechaHasta, sucursalId = "TODAS") {
  const desde = new Date(`${fechaDesde}T00:00:00`);
  const hasta = new Date(`${fechaHasta}T23:59:59`);

  if (
    Number.isNaN(desde.getTime()) ||
    Number.isNaN(hasta.getTime()) ||
    desde > hasta
  ) {
    return null;
  }

  const desdeIso = desde.toISOString();
  const hastaIso = hasta.toISOString();
  const resumen = obtenerResumenFinancieroEnRango(desdeIso, hastaIso, sucursalId);

  // Retiros de cortes cerrados en el rango (filtrados por sucursal si aplica)
  const retirosPeriodo = (localDB.cortes || [])
    .filter((c) => {
      if (c.estado !== "CERRADO" || !c.fechaCierre) return false;
      const fc = new Date(c.fechaCierre);
      if (Number.isNaN(fc.getTime()) || fc < desde || fc > hasta) return false;
      if (sucursalId && sucursalId !== "TODAS") {
        const cSucursal = c.sucursalId || "SUC-MAIN";
        if (cSucursal !== sucursalId) return false;
      }
      return true;
    })
    .reduce((acc, c) => acc + parseNumber(c.retiros, 0), 0);

  const totalIngresos = resumen.totalVentasNetas;
  const totalGastos = resumen.totalGastos;
  const gastosEfectivo = resumen.gastosEfectivo;
  const gastosTarjeta = resumen.gastosTarjeta;
  const gastosTransferencia = resumen.gastosTransferencia;
  const gastosBancarios = resumen.gastosBancarios;
  const totalEgresos = totalGastos;
  const gananciasBrutas = roundTo(totalIngresos - totalGastos, 2);
  const efectivoEnCajaPeriodo = roundTo(resumen.pagosEfectivo - gastosEfectivo - retirosPeriodo, 2);
  const cobrosBancariosBrutos = roundTo(resumen.pagosTarjeta + resumen.pagosTransferencia, 2);
  const cobrosBancariosNetos = roundTo(cobrosBancariosBrutos - gastosBancarios, 2);

  return {
    fechaDesde,
    fechaHasta,
    ventasCount: resumen.ventasCount,
    gastosCount: resumen.gastosCount,
    pagosEfectivo: roundTo(resumen.pagosEfectivo, 2),
    pagosTarjeta: roundTo(resumen.pagosTarjeta, 2),
    pagosTransferencia: roundTo(resumen.pagosTransferencia, 2),
    totalVentas: roundTo(resumen.totalVentasNetas, 2),
    totalGastos: roundTo(totalGastos, 2),
    gastosEfectivo: roundTo(gastosEfectivo, 2),
    gastosTarjeta: roundTo(gastosTarjeta, 2),
    gastosTransferencia: roundTo(gastosTransferencia, 2),
    gastosBancarios: roundTo(gastosBancarios, 2),
    retiros: roundTo(retirosPeriodo, 2),
    totalIngresos: roundTo(totalIngresos, 2),
    totalEgresos: roundTo(totalEgresos, 2),
    gananciasBrutas,
    efectivoEnCajaPeriodo,
    cobrosBancariosBrutos,
    cobrosBancariosNetos,
  };
}

async function generarResumenFinanciero() {
  const fechaDesde = document.getElementById("fechaDesdeResumen").value;
  const fechaHasta = document.getElementById("fechaHastaResumen").value;
  const sucursalId = document.getElementById("filtroSucursalResumen") ? document.getElementById("filtroSucursalResumen").value : "TODAS";

  if (!fechaDesde || !fechaHasta) {
    showMessage("msgResumenFinanciero", "Seleccione las fechas para generar el resumen.", "warning");
    return;
  }

  if (_dbFirestore) {
    try {
      const desdeIso = `${fechaDesde}T00:00:00`;
      const hastaIso = `${fechaHasta}T23:59:59`;

      const [ventasSnap, gastosSnap] = await Promise.all([
        obtenerRefColeccion("ventas").where("fecha", ">=", desdeIso).where("fecha", "<=", hastaIso).get(),
        obtenerRefColeccion("gastos").where("fecha", ">=", desdeIso).where("fecha", "<=", hastaIso).get()
      ]);

      const idsVentas = new Set(localDB.ventas.map((v) => v.id));
      ventasSnap.docs.forEach((d) => {
        if (!idsVentas.has(d.id)) localDB.ventas.push(d.data());
      });

      const idsGastos = new Set(localDB.gastos.map((g) => g.id));
      gastosSnap.docs.forEach((d) => {
        if (!idsGastos.has(d.id)) localDB.gastos.push(d.data());
      });
    } catch (e) {
      console.warn("Consulta Firestore resumen:", e);
    }
  }

  const data = obtenerDatosResumenFinanciero(fechaDesde, fechaHasta, sucursalId);
  if (!data) {
    showMessage("msgResumenFinanciero", "Rango de fechas inválido.", "warning");
    return;
  }

  const container = document.getElementById("resumenFinancieroContainer");
  const esGanancia = data.gananciasBrutas >= 0;

  container.innerHTML = `
    <div class="resumen-financiero-layout">
      <!-- Columna Izquierda: Ingresos y Egresos -->
      <div class="resumen-col">
        <div class="resumen-financiero-card">
          <h4>📥 Ingresos Totales</h4>
          <div class="table-responsive">
            <table class="resumen-table">
              <tr><td>Total Ventas</td><td class="text-right text-success">${formatMoney(data.totalVentas)}</td></tr>
              <tr class="sub-row"><td>  └ Efectivo</td><td class="text-right">${formatMoney(data.pagosEfectivo)}</td></tr>
              <tr class="sub-row"><td>  └ Tarjeta</td><td class="text-right">${formatMoney(data.pagosTarjeta)}</td></tr>
              <tr class="sub-row"><td>  └ Transferencia</td><td class="text-right">${formatMoney(data.pagosTransferencia)}</td></tr>
              <tr><td>Cantidad de Ventas</td><td class="text-right">${data.ventasCount}</td></tr>
            </table>
          </div>
        </div>

        <div class="resumen-financiero-card">
          <h4>📤 Egresos (Gastos Operativos)</h4>
          <div class="table-responsive">
            <table class="resumen-table">
              <tr><td>Gastos Registrados</td><td class="text-right text-danger">${formatMoney(data.totalGastos)}</td></tr>
              <tr class="sub-row"><td>  └ Pagados en Efectivo</td><td class="text-right">${formatMoney(data.gastosEfectivo)}</td></tr>
              <tr class="sub-row"><td>  └ Pagados con Tarjeta</td><td class="text-right">${formatMoney(data.gastosTarjeta)}</td></tr>
              <tr class="sub-row"><td>  └ Pagados por Transferencia</td><td class="text-right">${formatMoney(data.gastosTransferencia)}</td></tr>
              <tr class="total-row"><td><strong>Total Egresos</strong></td><td class="text-right text-danger"><strong>${formatMoney(data.totalGastos)}</strong></td></tr>
              <tr><td>Cantidad de Gastos</td><td class="text-right">${data.gastosCount}</td></tr>
            </table>
          </div>
        </div>
      </div>

      <!-- Columna Derecha: Movimientos de Caja y Resultado -->
      <div class="resumen-col">
        <div class="resumen-financiero-card">
          <h4>🏦 Retiros y Movimientos de Caja</h4>
          <div class="table-responsive">
            <table class="resumen-table">
              <tr><td>Efectivo Ingresado por Ventas</td><td class="text-right">${formatMoney(data.pagosEfectivo)}</td></tr>
              <tr><td>(-) Gastos Pagados en Efectivo</td><td class="text-right text-danger">${formatMoney(data.gastosEfectivo)}</td></tr>
              <tr><td>(-) Retiros (Resguardo a Bóveda/Banco)</td><td class="text-right text-danger">${formatMoney(data.retiros)}</td></tr>
              <tr class="total-row"><td><strong>Efectivo Restante en Caja</strong></td><td class="text-right"><strong>${formatMoney(data.efectivoEnCajaPeriodo)}</strong></td></tr>
            </table>
          </div>
        </div>

        <div class="resumen-financiero-card" style="margin-top: 15px;">
          <h4>💳 Resumen de Pagos Bancarios</h4>
          <div class="table-responsive">
            <table class="resumen-table">
              <tr><td>Ventas con Tarjeta / Transferencia</td><td class="text-right text-success">${formatMoney(data.cobrosBancariosBrutos)}</td></tr>
              <tr><td>(-) Gastos con Tarjeta / Banco</td><td class="text-right text-danger">${formatMoney(data.gastosBancarios)}</td></tr>
              <tr class="total-row"><td><strong>Saldo Neto Bancario</strong></td><td class="text-right"><strong>${formatMoney(data.cobrosBancariosNetos)}</strong></td></tr>
            </table>
          </div>
        </div>

        <div class="resumen-financiero-card resumen-financiero-card--resultado ${esGanancia ? 'resumen-resultado--positivo' : 'resumen-resultado--negativo'}">
          <h4>${esGanancia ? '✅' : '⚠️'} Resultado Neto del Periodo</h4>
          <div class="table-responsive">
            <table class="resumen-table">
              <tr><td>Total Ingresos</td><td class="text-right">${formatMoney(data.totalIngresos)}</td></tr>
              <tr><td>(-) Gastos Operativos</td><td class="text-right">${formatMoney(data.totalGastos)}</td></tr>
              <tr class="total-row resultado-final"><td><strong>${esGanancia ? 'Ganancia Neta' : 'Pérdida Neta'}</strong></td><td class="text-right"><strong>${formatMoney(Math.abs(data.gananciasBrutas))}</strong></td></tr>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
  showMessage("msgResumenFinanciero", "Resumen financiero generado.", "success");
}

function exportarResumenFinanciero() {
  const fechaDesde = document.getElementById("fechaDesdeResumen").value;
  const fechaHasta = document.getElementById("fechaHastaResumen").value;
  const sucursalId = document.getElementById("filtroSucursalResumen") ? document.getElementById("filtroSucursalResumen").value : "TODAS";

  if (!fechaDesde || !fechaHasta) {
    showMessage("msgResumenFinanciero", "Seleccione las fechas para exportar el resumen.", "warning");
    return;
  }

  const data = obtenerDatosResumenFinanciero(fechaDesde, fechaHasta, sucursalId);
  if (!data) {
    showMessage("msgResumenFinanciero", "Rango de fechas inválido.", "warning");
    return;
  }

  let csv = "\uFEFF"; // UTF-8 BOM
  csv += `RESUMEN FINANCIERO GENERAL\n`;
  csv += `Periodo: ${fechaDesde} al ${fechaHasta} | Sucursal: ${sucursalId}\n`;
  csv += `Generado: ${new Date().toLocaleString("es-MX")}\n`;
  csv += `\n`;

  csv += `CONCEPTO,MONTO\n`;
  csv += `\n`;

  csv += `=== INGRESOS ===,\n`;
  csv += `Total Ventas,${data.totalVentas}\n`;
  csv += `  Pagos en Efectivo,${data.pagosEfectivo}\n`;
  csv += `  Pagos con Tarjeta,${data.pagosTarjeta}\n`;
  csv += `  Pagos por Transferencia,${data.pagosTransferencia}\n`;
  csv += `Cantidad de Ventas,${data.ventasCount}\n`;
  csv += `\n`;

  csv += `=== EGRESOS (GASTOS OPERATIVOS) ===,\n`;
  csv += `Total Gastos Operativos,${data.totalGastos}\n`;
  csv += `Cantidad de Gastos,${data.gastosCount}\n`;
  csv += `\n`;

  csv += `=== RETIROS Y MOVIMIENTOS DE CAJA ===,\n`;
  csv += `Efectivo Ingresado por Ventas,${data.pagosEfectivo}\n`;
  csv += `(-) Gastos Operativos,${data.totalGastos}\n`;
  csv += `(-) Retiros (Resguardo de Caja),${data.retiros}\n`;
  csv += `Efectivo Restante en Caja,${data.efectivoEnCajaPeriodo}\n`;
  csv += `\n`;

  csv += `=== RESULTADO NETO DEL PERIODO ===,\n`;
  csv += `Total Ingresos,${data.totalIngresos}\n`;
  csv += `(-) Total Gastos,${data.totalGastos}\n`;
  csv += `${data.gananciasBrutas >= 0 ? "GANANCIA NETA" : "PERDIDA NETA"},${Math.abs(data.gananciasBrutas)}\n`;

  descargarArchivo(
    `Resumen_Financiero_${fechaDesde}_${fechaHasta}.csv`,
    csv,
    "text/csv;charset=utf-8;",
  );
  showMessage("msgResumenFinanciero", "Resumen financiero exportado exitosamente.", "success");
}

function obtenerCorteActivo() {
  if (!localDB.corteActivo || typeof localDB.corteActivo !== "object") {
    return null;
  }
  if (normalizeCode(localDB.corteActivo.estado) !== "ABIERTO") {
    return null;
  }
  const sucursalActivaId = obtenerSucursalActivaId();
  if (localDB.corteActivo.sucursalId && localDB.corteActivo.sucursalId !== sucursalActivaId) {
    return null;
  }
  return localDB.corteActivo;
}

function obtenerResumenFinancieroEnRango(fechaInicioIso, fechaFinIso, sucursalId = "TODAS") {
  const inicio = new Date(fechaInicioIso);
  const fin = new Date(fechaFinIso);

  if (
    Number.isNaN(inicio.getTime()) ||
    Number.isNaN(fin.getTime()) ||
    inicio > fin
  ) {
    return {
      ventasCount: 0,
      gastosCount: 0,
      pagosEfectivo: 0,
      pagosTarjeta: 0,
      pagosTransferencia: 0,
      totalVentasNetas: 0,
      totalGastos: 0,
      gastosEfectivo: 0,
      gastosTarjeta: 0,
      gastosTransferencia: 0,
      gastosBancarios: 0,
    };
  }

  const ventasPeriodo = localDB.ventas.filter((venta) => {
    const fechaVenta = new Date(venta.fecha);
    if (Number.isNaN(fechaVenta.getTime()) || fechaVenta < inicio || fechaVenta > fin) return false;
    if (sucursalId && sucursalId !== "TODAS") {
      const vSucursal = venta.sucursalId || "SUC-MAIN";
      if (vSucursal !== sucursalId) return false;
    }
    return true;
  });

  const pagos = acumularPagosNetos(ventasPeriodo);
  const totalVentasNetas =
    pagos.efectivo + pagos.tarjeta + pagos.transferencia;

  const gastosPeriodo = localDB.gastos.filter((gasto) => {
    const fechaGasto = new Date(gasto.timestamp || gasto.fecha);
    if (Number.isNaN(fechaGasto.getTime()) || fechaGasto < inicio || fechaGasto > fin) return false;
    if (sucursalId && sucursalId !== "TODAS") {
      const gSucursal = gasto.sucursalId || "SUC-MAIN";
      if (gSucursal !== sucursalId) return false;
    }
    return true;
  });

  let gastosEfectivo = 0;
  let gastosTarjeta = 0;
  let gastosTransferencia = 0;

  gastosPeriodo.forEach((gasto) => {
    const m = (gasto.metodoPago || gasto.metodo || "EFECTIVO").toString().trim().toUpperCase();
    const monto = parseNumber(gasto.monto, 0);
    if (m === "TARJETA") gastosTarjeta += monto;
    else if (m === "TRANSFERENCIA") gastosTransferencia += monto;
    else gastosEfectivo += monto;
  });

  const totalGastos = gastosEfectivo + gastosTarjeta + gastosTransferencia;

  return {
    ventasCount: ventasPeriodo.length,
    gastosCount: gastosPeriodo.length,
    pagosEfectivo: roundTo(pagos.efectivo, 2),
    pagosTarjeta: roundTo(pagos.tarjeta, 2),
    pagosTransferencia: roundTo(pagos.transferencia, 2),
    totalVentasNetas: roundTo(totalVentasNetas, 2),
    totalGastos: roundTo(totalGastos, 2),
    gastosEfectivo: roundTo(gastosEfectivo, 2),
    gastosTarjeta: roundTo(gastosTarjeta, 2),
    gastosTransferencia: roundTo(gastosTransferencia, 2),
    gastosBancarios: roundTo(gastosTarjeta + gastosTransferencia, 2),
  };
}

function obtenerFechaHoraLocalTexto(isoDate) {
  const fecha = new Date(isoDate);
  if (Number.isNaN(fecha.getTime())) return "-";
  return fecha.toLocaleString("es-MX", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actualizarResumenCorteActual() {
  const container = document.getElementById("resumenCorteActual");
  if (!container) return;

  const corteActivo = obtenerCorteActivo();
  if (!corteActivo) {
    container.innerHTML =
      '<div class="message info">No hay un corte abierto en esta sucursal. Abra un corte para comenzar a acumular operaciones del turno.</div>';
    return;
  }

  const ahoraIso = new Date().toISOString();
  const sucursalActivaId = obtenerSucursalActivaId();
  const resumen = obtenerResumenFinancieroEnRango(corteActivo.fechaApertura, ahoraIso, sucursalActivaId);
  const retiros = Math.max(
    0,
    parseNumber(
      document.getElementById("retirosCorte")
        ? document.getElementById("retirosCorte").value
        : 0,
      0,
    ),
  );
  const ingresosCaja = Math.max(
    0,
    parseNumber(
      document.getElementById("ingresosCajaCorte")
        ? document.getElementById("ingresosCajaCorte").value
        : 0,
      0,
    ),
  );
  const cajaContada = Math.max(
    0,
    parseNumber(
      document.getElementById("cajaContadaCorte")
        ? document.getElementById("cajaContadaCorte").value
        : 0,
      0,
    ),
  );

  const cajaEsperada = roundTo(
    parseNumber(corteActivo.cajaInicial, 0) +
    resumen.pagosEfectivo -
    resumen.gastosEfectivo -
    retiros +
    ingresosCaja,
    2,
  );
  const diferencia = roundTo(cajaContada - cajaEsperada, 2);

  container.innerHTML = `
        <div class="corte-kpis">
          <div class="corte-kpi"><span>Ventas netas</span><strong>${formatMoney(resumen.totalVentasNetas)}</strong></div>
          <div class="corte-kpi"><span>Efectivo neto</span><strong>${formatMoney(resumen.pagosEfectivo)}</strong></div>
          <div class="corte-kpi"><span>Tarjeta</span><strong>${formatMoney(resumen.pagosTarjeta)}</strong></div>
          <div class="corte-kpi"><span>Transferencia</span><strong>${formatMoney(resumen.pagosTransferencia)}</strong></div>
          <div class="corte-kpi"><span>Gastos Efectivo</span><strong>${formatMoney(resumen.gastosEfectivo)}</strong></div>
          <div class="corte-kpi"><span>Gastos Tarjeta/Banco</span><strong>${formatMoney(resumen.gastosBancarios)}</strong></div>
          <div class="corte-kpi"><span>Caja esperada</span><strong>${formatMoney(cajaEsperada)}</strong></div>
          <div class="corte-kpi ${diferencia === 0 ? "" : diferencia > 0 ? "corte-kpi--up" : "corte-kpi--down"}"><span>Diferencia estimada</span><strong>${formatMoney(diferencia)}</strong></div>
        </div>
      `;
}

function renderEstadoCorteActual() {
  const estadoField = document.getElementById("estadoCorteActual");
  const fechaAperturaField = document.getElementById("fechaAperturaCorteActual");
  const usuarioAperturaField = document.getElementById("usuarioAperturaCorte");
  const cajaInicialField = document.getElementById("cajaInicialCorte");
  const observacionesAperturaField = document.getElementById("observacionesAperturaCorte");
  const btnAbrir = document.getElementById("btnAbrirCorte");
  const btnCerrar = document.getElementById("btnCerrarCorte");

  const panelApertura = document.getElementById("panelAperturaCorte");
  const badgeApertura = document.getElementById("badgeAperturaCorte");
  const panelCierre = document.getElementById("panelCierreCorte");
  const badgeCierre = document.getElementById("badgeCierreCorte");

  const cierreInputIds = [
    "periodicidadCorte",
    "retirosCorte",
    "ingresosCajaCorte",
    "cajaContadaCorte",
    "observacionesCierreCorte",
  ];

  const corteActivo = obtenerCorteActivo();
  const sucursalActiva = obtenerSucursalActiva();

  if (corteActivo) {
    if (estadoField) estadoField.value = `ABIERTO (${corteActivo.id}) - ${corteActivo.sucursalNombre || sucursalActiva.nombre}`;
    if (fechaAperturaField) {
      fechaAperturaField.value = obtenerFechaHoraLocalTexto(corteActivo.fechaApertura);
    }

    // Panel Apertura: Registrado y bloqueado
    if (usuarioAperturaField) {
      usuarioAperturaField.value = corteActivo.usuario || "Local";
      usuarioAperturaField.disabled = true;
    }
    if (cajaInicialField) {
      cajaInicialField.value = String(roundTo(corteActivo.cajaInicial, 2));
      cajaInicialField.disabled = true;
    }
    if (observacionesAperturaField) {
      observacionesAperturaField.value = corteActivo.observacionesApertura || "";
      observacionesAperturaField.disabled = true;
    }
    if (btnAbrir) btnAbrir.disabled = true;

    if (panelApertura) {
      panelApertura.classList.remove("corte-panel--active");
      panelApertura.classList.add("corte-panel--locked");
    }
    if (badgeApertura) {
      badgeApertura.textContent = "Registrada";
      badgeApertura.className = "corte-panel-badge corte-panel-badge--success";
    }

    // Panel Cierre: Activo y listo para operar
    cierreInputIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = false;
    });
    if (btnCerrar) btnCerrar.disabled = false;

    if (panelCierre) {
      panelCierre.classList.remove("corte-panel--disabled");
      panelCierre.classList.add("corte-panel--active");
    }
    if (badgeCierre) {
      badgeCierre.textContent = "Listo para Cierre";
      badgeCierre.className = "corte-panel-badge corte-panel-badge--info";
    }
  } else {
    if (estadoField) estadoField.value = `SIN CORTE ABIERTO (${sucursalActiva.nombre})`;
    if (fechaAperturaField) fechaAperturaField.value = "-";

    // Panel Apertura: Requerido y activo
    if (usuarioAperturaField) {
      usuarioAperturaField.disabled = false;
    }
    if (cajaInicialField) {
      cajaInicialField.disabled = false;
      const sucursalId = obtenerSucursalActivaId();
      const cortesOrdenados = (localDB.cortes || [])
        .filter(c => c.estado === "CERRADO" && c.fechaCierre && (!c.sucursalId || c.sucursalId === sucursalId))
        .sort((a, b) => new Date(b.fechaCierre) - new Date(a.fechaCierre));
      if (cortesOrdenados.length > 0) {
        cajaInicialField.value = String(roundTo(parseNumber(cortesOrdenados[0].cajaContada, 0), 2));
      } else {
        cajaInicialField.value = "0";
      }
    }
    if (observacionesAperturaField) {
      observacionesAperturaField.disabled = false;
      observacionesAperturaField.value = "";
    }
    if (btnAbrir) btnAbrir.disabled = false;

    if (panelApertura) {
      panelApertura.classList.remove("corte-panel--locked");
      panelApertura.classList.add("corte-panel--active");
    }
    if (badgeApertura) {
      badgeApertura.textContent = "Requerida";
      badgeApertura.className = "corte-panel-badge corte-panel-badge--warning";
    }

    // Panel Cierre: Deshabilitado en espera de apertura
    cierreInputIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = true;
      if (el.tagName === "TEXTAREA") {
        el.value = "";
      } else if (id !== "periodicidadCorte") {
        el.value = "0";
      }
    });
    if (btnCerrar) btnCerrar.disabled = true;

    if (panelCierre) {
      panelCierre.classList.remove("corte-panel--active");
      panelCierre.classList.add("corte-panel--disabled");
    }
    if (badgeCierre) {
      badgeCierre.textContent = "Abra Caja Primero";
      badgeCierre.className = "corte-panel-badge corte-panel-badge--muted";
    }
  }

  actualizarResumenCorteActual();
}

function abrirCorteCaja() {
  if (obtenerCorteActivo()) {
    showMessage("msgCorte", "Ya existe un corte abierto en esta sucursal.", "warning");
    return;
  }

  const usuarioApertura = (
    document.getElementById("usuarioAperturaCorte")
      ? document.getElementById("usuarioAperturaCorte").value
      : ""
  )
    .toString()
    .trim();

  if (!usuarioApertura) {
    showMessage("msgCorte", "Ingrese el nombre del usuario / cajero que realiza la apertura.", "warning");
    return;
  }

  const cajaInicial = Math.max(
    0,
    roundTo(
      parseNumber(
        document.getElementById("cajaInicialCorte")
          ? document.getElementById("cajaInicialCorte").value
          : 0,
        0,
      ),
      2,
    ),
  );
  const observacionesApertura = (
    document.getElementById("observacionesAperturaCorte")
      ? document.getElementById("observacionesAperturaCorte").value
      : ""
  )
    .toString()
    .trim();

  const sucursalActual = obtenerSucursalActiva();
  localDB.corteActivo = {
    id: `CA-${Date.now()}`,
    fechaApertura: new Date().toISOString(),
    cajaInicial,
    observacionesApertura,
    estado: "ABIERTO",
    usuario: usuarioApertura,
    sucursalId: sucursalActual.id,
    sucursalNombre: sucursalActual.nombre,
  };

  if (_dbFirestore) {
    obtenerRefDocConfig("corteActivo").set(localDB.corteActivo).catch((e) => console.warn("Firestore corte error:", e));
  }

  guardarEstadoLocal();
  renderEstadoCorteActual();
  actualizarResumenCorteActual();
  showMessage("msgCorte", `Corte abierto por ${usuarioApertura} en sucursal ${sucursalActual.nombre} correctamente.`, "success");
}

function cerrarCorteCaja() {
  const corteActivo = obtenerCorteActivo();
  if (!corteActivo) {
    showMessage("msgCorte", "No hay un corte abierto para cerrar en esta sucursal.", "warning");
    return;
  }

  const periodicidad = normalizeCode(
    document.getElementById("periodicidadCorte")
      ? document.getElementById("periodicidadCorte").value
      : "DIARIO",
  );
  const retiros = Math.max(
    0,
    roundTo(
      parseNumber(
        document.getElementById("retirosCorte")
          ? document.getElementById("retirosCorte").value
          : 0,
        0,
      ),
      2,
    ),
  );
  const ingresosCaja = Math.max(
    0,
    roundTo(
      parseNumber(
        document.getElementById("ingresosCajaCorte")
          ? document.getElementById("ingresosCajaCorte").value
          : 0,
        0,
      ),
      2,
    ),
  );
  const cajaContada = roundTo(
    parseNumber(
      document.getElementById("cajaContadaCorte")
        ? document.getElementById("cajaContadaCorte").value
        : NaN,
      NaN,
    ),
    2,
  );
  const observacionesCierre = (
    document.getElementById("observacionesCierreCorte")
      ? document.getElementById("observacionesCierreCorte").value
      : ""
  )
    .toString()
    .trim();

  if (!Number.isFinite(cajaContada) || cajaContada < 0) {
    showMessage(
      "msgCorte",
      "Capture la caja contada para cerrar el corte.",
      "warning",
    );
    return;
  }

  const fechaCierre = new Date().toISOString();
  const sucursalActiva = obtenerSucursalActiva();
  const sucursalId = corteActivo.sucursalId || sucursalActiva.id;
  const sucursalNombre = corteActivo.sucursalNombre || sucursalActiva.nombre;

  const resumen = obtenerResumenFinancieroEnRango(
    corteActivo.fechaApertura,
    fechaCierre,
    sucursalId,
  );
  const cajaEsperada = roundTo(
    parseNumber(corteActivo.cajaInicial, 0) +
    resumen.pagosEfectivo -
    resumen.gastosEfectivo -
    retiros +
    ingresosCaja,
    2,
  );
  const diferencia = roundTo(cajaContada - cajaEsperada, 2);

  const nuevoCorte = {
    id: `CC-${Date.now()}`,
    periodicidad:
      periodicidad === "SEMANAL" ||
        periodicidad === "QUINCENAL" ||
        periodicidad === "MENSUAL"
        ? periodicidad
        : "DIARIO",
    fechaApertura: corteActivo.fechaApertura,
    fechaCierre,
    cajaInicial: roundTo(parseNumber(corteActivo.cajaInicial, 0), 2),
    ventasCount: resumen.ventasCount,
    gastosCount: resumen.gastosCount,
    pagosEfectivo: resumen.pagosEfectivo,
    pagosTarjeta: resumen.pagosTarjeta,
    pagosTransferencia: resumen.pagosTransferencia,
    totalVentasNetas: resumen.totalVentasNetas,
    totalGastos: resumen.totalGastos,
    gastosEfectivo: resumen.gastosEfectivo,
    gastosTarjeta: resumen.gastosTarjeta,
    gastosTransferencia: resumen.gastosTransferencia,
    gastosBancarios: resumen.gastosBancarios,
    retiros,
    ingresosCaja,
    cajaEsperada,
    cajaContada,
    diferencia,
    observacionesApertura: corteActivo.observacionesApertura || "",
    observacionesCierre,
    usuario: corteActivo.usuario || "Local",
    sucursalId,
    sucursalNombre,
    estado: "CERRADO",
  };

  localDB.cortes.push(nuevoCorte);

  if (_dbFirestore) {
    obtenerRefColeccion("cortes").doc(nuevoCorte.id).set(nuevoCorte).catch((e) => console.warn("Firestore corte error:", e));
  }

  localDB.corteActivo = null;
  guardarEstadoLocal();
  renderEstadoCorteActual();
  mostrarReporteCortes(true);
  loadDashboard();
  showMessage(
    "msgCorte",
    `Corte cerrado en ${sucursalNombre}. Caja esperada: ${formatMoney(cajaEsperada)}. Diferencia: ${formatMoney(diferencia)}.`,
    "success",
  );
}

function obtenerReporteCortes(filtros) {
  const desde = new Date(`${filtros.fechaDesde}T00:00:00`);
  const hasta = new Date(`${filtros.fechaHasta}T23:59:59`);

  if (
    Number.isNaN(desde.getTime()) ||
    Number.isNaN(hasta.getTime()) ||
    desde > hasta
  ) {
    return [];
  }

  return (Array.isArray(localDB.cortes) ? localDB.cortes : [])
    .filter((corte) => {
      const fecha = new Date(corte.fechaCierre || corte.fechaApertura);
      if (Number.isNaN(fecha.getTime())) return false;
      if (fecha < desde || fecha > hasta) return false;
      if (
        filtros.periodicidad &&
        normalizeCode(corte.periodicidad) !== normalizeCode(filtros.periodicidad)
      ) {
        return false;
      }
      if (filtros.sucursalId && filtros.sucursalId !== "TODAS") {
        const cSucursal = corte.sucursalId || "SUC-MAIN";
        if (cSucursal !== filtros.sucursalId) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.fechaCierre) - new Date(a.fechaCierre));
}

function displayReporteCortesTable(data) {
  const container = document.getElementById("cortesTable");
  if (!container) return;

  if (!data.length) {
    container.innerHTML =
      '<div class="message warning">No hay cortes en el periodo seleccionado.</div>';
    return;
  }

  const resumen = data.reduce(
    (acc, corte) => {
      acc.totalCortes += 1;
      acc.ventas += parseNumber(corte.totalVentasNetas, 0);
      acc.gastos += parseNumber(corte.totalGastos, 0);
      acc.efectivo += parseNumber(corte.pagosEfectivo, 0);
      acc.diferencia += parseNumber(corte.diferencia, 0);
      return acc;
    },
    { totalCortes: 0, ventas: 0, gastos: 0, efectivo: 0, diferencia: 0 },
  );

  let html = `
        <div class="message success">${resumen.totalCortes} corte(s). Ventas netas: ${formatMoney(resumen.ventas)} | Gastos: ${formatMoney(resumen.gastos)} | Efectivo neto: ${formatMoney(resumen.efectivo)} | Diferencia acumulada: ${formatMoney(resumen.diferencia)}</div>
        <table>
          <thead>
            <tr>
              <th>Folio</th>
              <th>Sucursal</th>
              <th>Usuario</th>
              <th>Periodicidad</th>
              <th>Apertura</th>
              <th>Cierre</th>
              <th>Caja Inicial</th>
              <th>Ventas Netas</th>
              <th>Efectivo</th>
              <th>Tarjeta</th>
              <th>Transferencia</th>
              <th>Gastos</th>
              <th>Caja Esperada</th>
              <th>Caja Contada</th>
              <th>Diferencia</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
      `;

  data.forEach((corte) => {
    html += `
          <tr>
            <td>${corte.id || "-"}</td>
            <td><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600;">${escapeXml(corte.sucursalNombre || "Matriz")}</span></td>
            <td><strong>${corte.usuario || "Local"}</strong></td>
            <td>${corte.periodicidad || "DIARIO"}</td>
            <td>${obtenerFechaHoraLocalTexto(corte.fechaApertura)}</td>
            <td>${obtenerFechaHoraLocalTexto(corte.fechaCierre)}</td>
            <td>${formatMoney(corte.cajaInicial)}</td>
            <td>${formatMoney(corte.totalVentasNetas)}</td>
            <td>${formatMoney(corte.pagosEfectivo)}</td>
            <td>${formatMoney(corte.pagosTarjeta)}</td>
            <td>${formatMoney(corte.pagosTransferencia)}</td>
            <td>${formatMoney(corte.totalGastos)}</td>
            <td>${formatMoney(corte.cajaEsperada)}</td>
            <td>${formatMoney(corte.cajaContada)}</td>
            <td>${formatMoney(corte.diferencia)}</td>
            <td>
              <button type="button" class="btn btn-danger" onclick="eliminarCorteCaja('${corte.id || corte.fechaCierre || corte.fechaApertura || ""}')">Eliminar</button>
            </td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function mostrarReporteCortes(silencioso = false) {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeCorte")
      ? document.getElementById("fechaDesdeCorte").value
      : "",
    fechaHasta: document.getElementById("fechaHastaCorte")
      ? document.getElementById("fechaHastaCorte").value
      : "",
    periodicidad: document.getElementById("tipoCorteFiltro")
      ? document.getElementById("tipoCorteFiltro").value
      : "",
    sucursalId: document.getElementById("filtroSucursalCortes")
      ? document.getElementById("filtroSucursalCortes").value
      : "TODAS",
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    if (!silencioso) {
      showMessage(
        "cortesTable",
        "Seleccione las fechas para consultar cortes.",
        "warning",
      );
    }
    return;
  }

  const data = obtenerReporteCortes(filtros);
  displayReporteCortesTable(data);
}

function exportarReporteCortes() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeCorte")
      ? document.getElementById("fechaDesdeCorte").value
      : "",
    fechaHasta: document.getElementById("fechaHastaCorte")
      ? document.getElementById("fechaHastaCorte").value
      : "",
    periodicidad: document.getElementById("tipoCorteFiltro")
      ? document.getElementById("tipoCorteFiltro").value
      : "",
    sucursalId: document.getElementById("filtroSucursalCortes")
      ? document.getElementById("filtroSucursalCortes").value
      : "TODAS",
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "cortesTable",
      "Seleccione las fechas para exportar cortes.",
      "warning",
    );
    return;
  }

  const data = obtenerReporteCortes(filtros);
  if (!data.length) {
    showMessage(
      "cortesTable",
      "No hay cortes para exportar en el periodo seleccionado.",
      "warning",
    );
    return;
  }

  let csv =
    "Folio,Sucursal,Usuario,Periodicidad,Apertura,Cierre,Caja Inicial,Ventas Netas,Efectivo,Tarjeta,Transferencia,Gastos,Retiros,Ingresos Caja,Caja Esperada,Caja Contada,Diferencia,Observaciones Apertura,Observaciones Cierre\n";

  data.forEach((corte) => {
    csv += `"${corte.id || ""}","${(corte.sucursalNombre || "Matriz").replace(/"/g, '""')}","${(corte.usuario || "Local").replace(/"/g, '""')}","${corte.periodicidad || "DIARIO"}","${obtenerFechaHoraLocalTexto(corte.fechaApertura)}","${obtenerFechaHoraLocalTexto(corte.fechaCierre)}","${roundTo(parseNumber(corte.cajaInicial, 0), 2)}","${roundTo(parseNumber(corte.totalVentasNetas, 0), 2)}","${roundTo(parseNumber(corte.pagosEfectivo, 0), 2)}","${roundTo(parseNumber(corte.pagosTarjeta, 0), 2)}","${roundTo(parseNumber(corte.pagosTransferencia, 0), 2)}","${roundTo(parseNumber(corte.totalGastos, 0), 2)}","${roundTo(parseNumber(corte.retiros, 0), 2)}","${roundTo(parseNumber(corte.ingresosCaja, 0), 2)}","${roundTo(parseNumber(corte.cajaEsperada, 0), 2)}","${roundTo(parseNumber(corte.cajaContada, 0), 2)}","${roundTo(parseNumber(corte.diferencia, 0), 2)}","${(corte.observacionesApertura || "").replace(/"/g, '""')}","${(corte.observacionesCierre || "").replace(/"/g, '""')}"\n`;
  });

  descargarArchivo(
    `Reporte_Cortes_${filtros.fechaDesde}_${filtros.fechaHasta}.csv`,
    csv,
    "text/csv;charset=utf-8;",
  );
  showMessage("cortesTable", "Reporte de cortes exportado exitosamente.", "success");
}

function eliminarCorteCaja(corteId) {
  const id = (corteId || "").toString().trim();
  if (!id) return;

  const corteTarget = (localDB.cortes || []).find((corte) => {
    const cid = (corte.id || "").toString().trim();
    if (cid && cid === id) return true;
    if (corte.fechaCierre === id || corte.fechaApertura === id) return true;
    return false;
  });

  if (!corteTarget) {
    showMessage("msgCorte", "No se encontró el corte a eliminar.", "warning");
    return;
  }

  const confirmado = confirm(
    `Se eliminará el corte seleccionado. Esta acción no se puede deshacer. ¿Desea continuar?`,
  );
  if (!confirmado) return;

  localDB.cortes = (localDB.cortes || []).filter((corte) => corte !== corteTarget);
  if (_dbFirestore) {
    const docId = corteTarget.id || id;
    obtenerRefColeccion("cortes").doc(docId).delete().catch((e) => console.warn("Firestore delete corte error:", e));
  }
  guardarEstadoLocal();
  mostrarReporteCortes(true);
  showMessage("msgCorte", `Corte eliminado correctamente.`, "success");
}

function cargarModuloCortes() {
  renderEstadoCorteActual();
  mostrarReporteCortes(true);
}

function validarIntegridad() {
  const data = validarIntegridadLocal();
  let html = "<h4>Validacion de Integridad del Sistema</h4>";

  if (data.errores.length === 0) {
    html +=
      '<div class="message success">Todos los datos estan correctos. El sistema esta integro.</div>';
  } else {
    html +=
      '<div class="message error"><strong>Se encontraron los siguientes errores:</strong></div>';
    html += "<ul>";
    data.errores.forEach((error) => {
      html += `<li class="text-danger">${error}</li>`;
    });
    html += "</ul>";
  }

  document.getElementById("configResults").innerHTML = html;
}

function descargarArchivo(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
}

function exportarStock() {
  const csv = exportarStockCSVLocal();
  if (!csv) {
    showMessage("stockTable", "No hay datos para exportar", "warning");
    return;
  }
  const fecha = new Date().toISOString().slice(0, 10);
  descargarArchivo(`Inventario_${fecha}.csv`, csv, "text/csv;charset=utf-8;");
  showMessage("stockTable", "Stock exportado exitosamente", "success");
}



function limpiarFormProducto() {
  document.getElementById("formProducto").reset();
  const stockInicialEl = document.getElementById("stockInicialProd");
  if (stockInicialEl) stockInicialEl.value = "0";
  document.getElementById("stockMinProd").value = "0";
  document.getElementById("precioVentaProd").value = "";
  actualizarPrecioVariableProducto();
  document.getElementById("msgProd").innerHTML = "";
}

function limpiarFormMovimiento() {
  document.getElementById("formMovimiento").reset();
  document.getElementById("fechaMov").valueAsDate = new Date();
  document.getElementById("msgMov").innerHTML = "";
  document.getElementById("autocompleteDropdown").style.display = "none";
  handleTipoChange();
}

function limpiarFormGasto() {
  document.getElementById("formGasto").reset();
  document.getElementById("fechaGasto").valueAsDate = new Date();
  document.getElementById("msgGasto").innerHTML = "";
}



function showMessage(containerId, message, type) {
  const container = document.getElementById(containerId);
  let className = "message";

  if (type === "success") className += " success";
  else if (type === "error") className += " error";
  else if (type === "warning") className += " warning";
  else if (type === "info") className += " info";
  else className += " success";

  container.innerHTML = `<div class="${className}">${message}</div>`;

  if (type === "success") {
    setTimeout(() => {
      container.innerHTML = "";
    }, 2000);
  }
}

function descargarBackupBaseDeDatos() {
  try {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(localDB, null, 2));
    const downloadAnchor = document.createElement("a");
    const fecha = new Date().toISOString().slice(0, 10);
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `backup_inventario_${fecha}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    return true;
  } catch (e) {
    console.error("Error al descargar backup:", e);
    return false;
  }
}

async function vaciarColeccionFirestore(nombreColeccion) {
  if (!_dbFirestore) return;
  try {
    const snap = await obtenerRefColeccion(nombreColeccion).get();
    if (snap.empty) return;
    const batch = _dbFirestore.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  } catch (err) {
    console.warn(`Error al vaciar colección ${nombreColeccion} en Firestore:`, err);
  }
}

async function respaldarEnFirestoreColeccionBackup() {
  if (_dbFirestore) {
    try {
      const docId = obtenerDocIdFirestore();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupDocId = `${docId}_backup_${timestamp}`;
      await _dbFirestore.collection("backups").doc(backupDocId).set({
        fecha: new Date().toISOString(),
        usuarioDocId: docId,
        datos: JSON.parse(JSON.stringify(localDB))
      });
      console.info("📦 Copia de respaldo guardada en Firestore en la colección 'backups'.");
    } catch (err) {
      console.warn("⚠️ No se pudo guardar la copia adicional en Firestore:", err);
    }
  }
}

async function realizarCierreOResetPeriodico(modo) {
  // MODO: 'reset_operativo' (mantiene productos e inventario), 'simplificar_movimientos' (unifica historial), 'reset_total' (vacia todo)
  let titulo = "";
  let descripcion = "";

  if (modo === "reset_operativo") {
    titulo = "Reset de Operaciones (Mensual / Periódico)";
    descripcion = "Se descargará un BACKUP automático de seguridad.\nSe BORRARÁN: Ventas, Gastos, Pedidos entregados, Cortes de Caja y Carritos pendientes.\nSe CONSERVARÁN: Productos, Stock actual y Configuración.";
  } else if (modo === "simplificar_movimientos") {
    titulo = "Simplificación de Movimientos del Historial";
    descripcion = "Se descargará un BACKUP automático de seguridad.\nSe UNIFICARÁ el historial de movimientos reemplazándolos por un único movimiento de 'Ajuste / Cierre' con el stock actual de cada producto.\nSe conservará el catálogo de Productos e Inventario intacto.";
  } else if (modo === "reset_total") {
    titulo = "Reset TOTAL del Sistema";
    descripcion = "ADVERTENCIA: Se descargará un BACKUP automático de seguridad.\nSe BORRARÁN TODOS los productos, inventario, ventas, gastos y configuraciones.";
  }

  if (!confirm(`⚠️ ¿Deseas proceder con: ${titulo}?\n\n${descripcion}`)) return;

  // 1. Crear backup automático antes de realizar cualquier cambio
  const backupDescargado = descargarBackupBaseDeDatos();
  await respaldarEnFirestoreColeccionBackup();

  if (!backupDescargado) {
    if (!confirm("⚠️ No se pudo descargar automáticamente el archivo de respaldo JSON local. ¿Deseas continuar de todos modos?")) {
      return;
    }
  } else {
    alert("✅ Se ha descargado exitosamente un respaldo (Backup JSON) en tu computadora.");
  }

  // 2. Ejecutar la acción según el modo seleccionado
  if (modo === "reset_operativo" || modo === "simplificar_movimientos") {
    const fechaHoraActual = new Date().toISOString();
    const nuevosMovimientos = [];

    // Calcular y preservar el stock actual exacto de cada producto
    (localDB.productos || []).forEach(p => {
      const stockActual = calcularStock(p.codigo);
      if (stockActual > 0) {
        nuevosMovimientos.push({
          id: `M-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          codigo: normalizeCode(p.codigo),
          fecha: fechaHoraActual,
          tipo: TIPOS_MOVIMIENTO.INGRESO,
          cantidad: roundTo(stockActual, 4),
          usuario: "Sistema",
          timestamp: fechaHoraActual,
          observaciones: "Stock inicial / Cierre de periodo anterior",
          unidadCompra: p.unidad || "PIEZA"
        });
      }
    });

    // Conservar únicamente los pedidos personalizados que AÚN NO estén entregados (PENDIENTE, EN_PROCESO, TERMINADO)
    const pedidosNoEntregados = (localDB.pedidosPersonalizados || []).filter(
      (pedido) => pedido.estado !== "ENTREGADO"
    );

    localDB.movimientos = nuevosMovimientos;
    localDB.ventas = [];
    localDB.gastos = [];
    localDB.cortes = [];
    localDB.corteActivo = null;
    localDB.carritosPendientes = [];
    localDB.pedidosPersonalizados = pedidosNoEntregados;

    // Sincronizar borrado de documentos en Colecciones Firestore
    if (_dbFirestore) {
      await Promise.all([
        vaciarColeccionFirestore("ventas"),
        vaciarColeccionFirestore("gastos"),
        vaciarColeccionFirestore("cortes"),
        vaciarColeccionFirestore("movimientos"),
        vaciarColeccionFirestore("chunks_ventas"),
        vaciarColeccionFirestore("chunks_gastos"),
        vaciarColeccionFirestore("chunks_cortes"),
        vaciarColeccionFirestore("chunks_movimientos")
      ]);
      for (const m of nuevosMovimientos) {
        await obtenerRefColeccion("movimientos").doc(m.id).set(m);
      }
    }
  } else if (modo === "reset_total") {
    localDB.productos = [];
    localDB.movimientos = [];
    localDB.ventas = [];
    localDB.gastos = [];
    localDB.cortes = [];
    localDB.corteActivo = null;
    localDB.carritosPendientes = [];
    localDB.pedidosPersonalizados = [];
    localDB.config = { ...DEFAULT_CONFIG };

    // Vaciar todas las colecciones en Firestore
    if (_dbFirestore) {
      await Promise.all([
        vaciarColeccionFirestore("productos"),
        vaciarColeccionFirestore("ventas"),
        vaciarColeccionFirestore("gastos"),
        vaciarColeccionFirestore("cortes"),
        vaciarColeccionFirestore("movimientos"),
        vaciarColeccionFirestore("chunks_productos"),
        vaciarColeccionFirestore("chunks_ventas"),
        vaciarColeccionFirestore("chunks_gastos"),
        vaciarColeccionFirestore("chunks_cortes"),
        vaciarColeccionFirestore("chunks_movimientos")
      ]);
    }
  }

  // 3. Persistir y refrescar vistas
  await _persistirEnServidor();
  refrescarVistaActual();
  cargarConfiguracionSistema();

  showMessage(
    "configResults",
    `✅ Operación "${titulo}" ejecutada correctamente. Backup creado previa acción.`,
    "success"
  );
}

function restaurarBackupDesdeJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = JSON.parse(e.target.result);
      if (validarEstructuraEstado(data)) {
        if (confirm("⚠️ ¿Estás seguro de restaurar este respaldo? Se sobrescribirán todos los datos del sistema con los del archivo.")) {
          mostrarCargando(true);
          _aplicarDatosALocalDB(data);

          // 1. Guardar configuraciones y colecciones completas agrupadas en Chunks en Firestore
          await _persistirEnServidor();

          mostrarCargando(false);
          refrescarVistaActual();
          cargarConfiguracionSistema();
          alert(`✅ Base de datos restaurada con éxito.\n• Productos: ${localDB.productos.length}\n• Ventas: ${localDB.ventas.length}\n• Gastos: ${localDB.gastos.length}\n• Movimientos: ${localDB.movimientos.length}\n• Cortes: ${localDB.cortes.length}`);
        }
      } else {
        alert("❌ El archivo seleccionado no contiene una estructura válida de respaldo.");
      }
    } catch (err) {
      mostrarCargando(false);
      alert("❌ Error al leer el archivo JSON: " + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = ""; // reset input
}

function exportarReporte() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesde").value,
    fechaHasta: document.getElementById("fechaHasta").value,
    tipo: document.getElementById("filtroTipo").value,
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "historialTable",
      "Seleccione las fechas para exportar",
      "warning",
    );
    return;
  }

  const data = obtenerHistorial(filtros);
  if (data.length === 0) {
    showMessage(
      "historialTable",
      "No hay datos para exportar en el periodo seleccionado",
      "warning",
    );
    return;
  }

  let csv = "Fecha,Codigo,Producto,Tipo,Cantidad,Observaciones\n";
  data.forEach((mov) => {
    csv += `"${mov.fecha}","${mov.codigo}","${mov.producto}","${mov.tipo}","${mov.cantidad}","${mov.observaciones}"\n`;
  });

  descargarArchivo(
    `Reporte_Movimientos_${filtros.fechaDesde}_${filtros.fechaHasta}.csv`,
    csv,
    "text/csv;charset=utf-8;",
  );
  showMessage("historialTable", "Reporte exportado exitosamente", "success");
}

/* ==========================================================================
   MÓDULO: PEDIDOS PERSONALIZADOS (RF1 - RF6)
   ========================================================================== */

function renderizarModuloPedidos() {
  if (!localDB.pedidosPersonalizados) {
    localDB.pedidosPersonalizados = [];
  }

  const pedidos = localDB.pedidosPersonalizados;
  const now = new Date();
  const totalCount = pedidos.length;
  const pendientes = pedidos.filter((p) => p.estado === "PENDIENTE").length;
  const proceso = pedidos.filter((p) => p.estado === "EN_PROCESO").length;
  const terminados = pedidos.filter((p) => p.estado === "TERMINADO").length;
  const entregados = pedidos.filter((p) => p.estado === "ENTREGADO").length;
  const vencidos = pedidos.filter((p) => {
    if (p.estado === "TERMINADO" || p.estado === "ENTREGADO") return false;
    if (!p.fechaEntregaEstimada) return false;
    const fechaEntrega = new Date(p.fechaEntregaEstimada);
    return !Number.isNaN(fechaEntrega.getTime()) && fechaEntrega < now;
  }).length;

  const statTotal = document.getElementById("statTotalPedidos");
  const statPendientes = document.getElementById("statPendientesPedidos");
  const statProceso = document.getElementById("statProcesoPedidos");
  const statTerminados = document.getElementById("statTerminadosPedidos");
  const statEntregados = document.getElementById("statEntregadosPedidos");
  const statVencidos = document.getElementById("statVencidosPedidos");

  if (statTotal) statTotal.textContent = totalCount;
  if (statPendientes) statPendientes.textContent = pendientes;
  if (statProceso) statProceso.textContent = proceso;
  if (statTerminados) statTerminados.textContent = terminados;
  if (statEntregados) statEntregados.textContent = entregados;
  if (statVencidos) statVencidos.textContent = vencidos;

  filtrarPedidosPersonalizados();
}

function verPedidosVencidos() {
  showTab("pedidos");
  const select = document.getElementById("filtroEstadoPedido");
  if (select) {
    select.value = "VENCIDOS";
    filtrarPedidosPersonalizados();
  }
}

function filtrarPedidosPersonalizados() {
  if (!localDB.pedidosPersonalizados) return;

  const busqueda = normalizeCode(
    document.getElementById("filtroBusquedaPedido")
      ? document.getElementById("filtroBusquedaPedido").value
      : "",
  );
  const estadoFiltro = document.getElementById("filtroEstadoPedido")
    ? document.getElementById("filtroEstadoPedido").value
    : "TODOS";
  const fechaInicioStr = document.getElementById("filtroFechaInicioPedido")
    ? document.getElementById("filtroFechaInicioPedido").value
    : "";
  const fechaFinStr = document.getElementById("filtroFechaFinPedido")
    ? document.getElementById("filtroFechaFinPedido").value
    : "";

  let lista = [...localDB.pedidosPersonalizados];

  if (estadoFiltro && estadoFiltro !== "TODOS") {
    if (estadoFiltro === "VENCIDOS") {
      const now = new Date();
      lista = lista.filter((p) => {
        if (p.estado === "TERMINADO" || p.estado === "ENTREGADO") return false;
        if (!p.fechaEntregaEstimada) return false;
        const fechaEntrega = new Date(p.fechaEntregaEstimada);
        return !Number.isNaN(fechaEntrega.getTime()) && fechaEntrega < now;
      });
    } else {
      lista = lista.filter((p) => p.estado === estadoFiltro);
    }
  }

  if (busqueda) {
    lista = lista.filter(
      (p) =>
        normalizeCode(p.folio).includes(busqueda) ||
        normalizeCode(p.cliente && p.cliente.nombre).includes(busqueda) ||
        normalizeCode(p.cliente && p.cliente.telefono).includes(busqueda) ||
        normalizeCode(p.especificaciones).includes(busqueda),
    );
  }

  if (fechaInicioStr) {
    const fInicio = new Date(fechaInicioStr + "T00:00:00");
    lista = lista.filter((p) => new Date(p.fechaCreacion) >= fInicio);
  }

  if (fechaFinStr) {
    const fFin = new Date(fechaFinStr + "T23:59:59");
    lista = lista.filter((p) => new Date(p.fechaCreacion) <= fFin);
  }

  // Ordenar por fecha más reciente
  lista.sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));

  const tbody = document.getElementById("tbodyPedidosPersonalizados");
  if (!tbody) return;

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; color: #64748b; padding: 20px;">
          No se encontraron pedidos personalizados registrados con los filtros seleccionados.
        </td>
      </tr>`;
    return;
  }

  const now = new Date();

  tbody.innerHTML = lista
    .map((p) => {
      const totalPagado = (p.pagos || []).reduce(
        (acc, pago) => acc + parseNumber(pago.monto, 0),
        0,
      );
      const saldo = Math.max(0, parseNumber(p.precioTotal, 0) - totalPagado);

      let isVencido = false;
      if (
        p.estado !== "TERMINADO" &&
        p.estado !== "ENTREGADO" &&
        p.fechaEntregaEstimada
      ) {
        const fechaEntrega = new Date(p.fechaEntregaEstimada);
        if (!Number.isNaN(fechaEntrega.getTime()) && fechaEntrega < now) {
          isVencido = true;
        }
      }

      let badgeClass = "badge-pedido-pendiente";
      let estadoTexto = "Pendiente";
      if (p.estado === "EN_PROCESO") {
        badgeClass = "badge-pedido-proceso";
        estadoTexto = "En Proceso";
      } else if (p.estado === "TERMINADO") {
        badgeClass = "badge-pedido-terminado";
        estadoTexto = "Terminado";
      } else if (p.estado === "ENTREGADO") {
        badgeClass = "badge-pedido-entregado";
        estadoTexto = "Entregado";
      }

      return `
      <tr style="${isVencido ? "background-color: #fff5f5;" : ""}">
        <td onclick="verDetallePedido('${p.id}')" style="white-space: nowrap; text-align: center; cursor: pointer;"><strong>${escapeXml(p.folio)}</strong></td>
        <td onclick="verDetallePedido('${p.id}')" style="white-space: nowrap; text-align: center; cursor: pointer;">${formatDateOnly(p.fechaCreacion)}</td>
        <td onclick="verDetallePedido('${p.id}')" style="white-space: nowrap; text-align: center; cursor: pointer;">${escapeXml(p.cliente ? p.cliente.nombre : "Sin Nombre")}</td>
        <td onclick="verDetallePedido('${p.id}')" style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; cursor: pointer;" title="${escapeXml(p.especificaciones)}">
          ${escapeXml(p.especificaciones)}
        </td>
        <td onclick="verDetallePedido('${p.id}')" style="white-space: nowrap; text-align: center; cursor: pointer;"><strong>${formatMoney(p.precioTotal)}</strong></td>
        <td onclick="verDetallePedido('${p.id}')" style="color:#047857; white-space: nowrap; text-align: center; cursor: pointer;">${formatMoney(totalPagado)}</td>
        <td onclick="verDetallePedido('${p.id}')" style="color:${saldo > 0 ? "#dc2626" : "#16a34a"}; font-weight:700; white-space: nowrap; text-align: center; cursor: pointer;">
          ${formatMoney(saldo)}
        </td>
        <td onclick="verDetallePedido('${p.id}')" style="white-space: nowrap; text-align: center; cursor: pointer;">
          <span class="badge ${badgeClass}">${estadoTexto}</span>
        </td>
        <td style="white-space: nowrap; text-align: center">
          <div style="display: inline-flex; gap: 6px; align-items: center;">
            <button class="btn btn-primary btn-sm" onclick="imprimirTicketPedidoPersonalizado('${p.id}')" title="Imprimir Nota / Ticket" style="padding: 5px 10px; font-size: 0.82rem; font-weight: 600; border-radius: 6px; border: none; box-shadow: 0 1px 2px rgba(0,0,0,0.05); cursor: pointer; transition: all 0.2s ease;">
              🖨️ Ticket
            </button>
            <button class="btn btn-danger btn-sm" onclick="eliminarPedidoPersonalizado('${p.id}')" title="Eliminar Pedido" style="padding: 5px 10px; font-size: 0.82rem; font-weight: 600; border-radius: 6px; border: none; box-shadow: 0 1px 2px rgba(0,0,0,0.05); cursor: pointer; transition: all 0.2s ease;">
              🗑️
            </button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function generarHTMLTicketPedidoPersonalizado(pedido) {
  const config = localDB.config || DEFAULT_CONFIG;
  const totalPagado = (pedido.pagos || []).reduce(
    (acc, pago) => acc + parseNumber(pago.monto, 0),
    0,
  );
  const saldoPendiente = Math.max(0, parseNumber(pedido.precioTotal, 0) - totalPagado);
  const fecha = formatDate(pedido.fechaCreacion);

  let materiasPrimasFilas = "";
  if (pedido.materiasPrimas && pedido.materiasPrimas.length > 0) {
    materiasPrimasFilas = pedido.materiasPrimas
      .map((m) => {
        const pu = parseNumber(m.precioUnitario, 0);
        const sub = roundTo(parseNumber(m.subtotal, m.cantidad * pu), 2);
        return `<tr>
            <td class="c-cant">${m.cantidad}</td>
            <td class="c-prod">${m.codigo ? `[${escapeXml(m.codigo)}] ` : ""}${escapeXml(m.nombre)}</td>
            <td class="c-sub">${sub > 0 ? formatMoney(sub) : (pu > 0 ? formatMoney(pu) : "-")}</td>
          </tr>`;
      })
      .join("");
  } else {
    materiasPrimasFilas = `<tr><td colspan="3" class="center muted">Sin insumos especificadas</td></tr>`;
  }

  let historialPagosFilas = "";
  if (pedido.pagos && pedido.pagos.length > 0) {
    historialPagosFilas = pedido.pagos
      .map(
        (pago) =>
          `<div class="totals-row">
            <span>${escapeXml(pago.concepto)} (${escapeXml(pago.metodo || "EFECTIVO")}):</span>
            <span>${formatMoney(pago.monto)}</span>
          </div>`,
      )
      .join("");
  }

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Ticket de Pedido - ${escapeXml(pedido.folio)}</title>
      <style>
        @page {
          size: 80mm auto;
          margin: 0;
        }
        html, body {
          width: 80mm;
          margin: 0;
          padding: 0;
          color: #000;
          font-family: "Arial", sans-serif;
          font-size: 11px;
          line-height: 1.2;
        }
        h1, h2, h3, p { margin: 0; }
        .ticket {
          width: 72mm;
          margin: 0 auto;
          padding: 3mm 0;
        }
        .center { text-align: center; }
        .space { margin-top: 4px; }
        .muted { color: #000; font-size: 11px; }
        .line {
          border-top: 1px dashed #000;
          margin: 4px 0;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 4px;
          table-layout: fixed;
        }
        th, td {
          padding: 2px 0;
          vertical-align: top;
          word-wrap: break-word;
        }
        th { text-align: left; font-weight: 700; }
        .c-cant { width: 10mm; text-align: left; }
        .c-prod { width: 42mm; }
        .c-sub { width: 20mm; text-align: right; }
        .totals { margin-top: 4px; font-size: 11px; }
        .totals-row { display: flex; justify-content: space-between; margin: 2px 0; }
        .total-final { font-size: 12px; font-weight: 700; }
        .strong { font-weight: 700; }
        .box-spec {
          border: 1px solid #666;
          padding: 4px;
          margin: 4px 0;
          font-size: 11px;
        }

        @media print {
          html, body {
            width: 80mm;
          }
        }
      </style>
    </head>
    <body>
      <div class="ticket">
        <div class="center">
          <h3>${escapeXml(config.businessName || DEFAULT_CONFIG.businessName)}</h3>
          <p class="muted">NOTA DE PEDIDO</p>
          ${config.businessPhone ? `<p class="muted">TEL: ${escapeXml(config.businessPhone)}</p>` : ""}
        </div>

        <div class="line"></div>

        <div class="space">
          <p><span class="strong">FOLIO:</span> ${escapeXml(pedido.folio)}</p>
          <p><span class="strong">FECHA REGISTRO:</span> ${fecha}</p>
          <p><span class="strong">CLIENTE:</span> ${escapeXml(pedido.cliente ? pedido.cliente.nombre : "Sin Nombre")}</p>
          ${pedido.cliente && pedido.cliente.telefono ? `<p><span class="strong">TELÉFONO:</span> ${escapeXml(pedido.cliente.telefono)}</p>` : ""}
          ${pedido.fechaEntregaEstimada ? `<p><span class="strong">FECHA DE ENTREGA ESTIMADA:</span> ${formatDate(pedido.fechaEntregaEstimada)}</p>` : ""}
        </div>

        <div class="line"></div>
        <p class="strong">ESPECIFICACIONES / DISEÑO:</p>
        <div class="box-spec">
          ${escapeXml(pedido.especificaciones)}
        </div>

        <div class="line"></div>
        <p class="strong">INSUMOS Y MATERIA PRIMA:</p>
        <table>
          <thead>
            <tr>
              <th class="c-cant">CANT</th>
              <th class="c-prod">DESCRIPCIÓN</th>
              <th class="c-sub"></th>
            </tr>
          </thead>
          <tbody>
            ${materiasPrimasFilas}
          </tbody>
        </table>

        <div class="line"></div>

        <div class="totals">
          <div class="totals-row total-final"><span>PRECIO TOTAL:</span><span>${formatMoney(pedido.precioTotal)}</span></div>
          <div class="line"></div>
          <p class="strong muted">DESGLOSE DE PAGOS Y ABONOS:</p>
          ${historialPagosFilas}
          <div class="line"></div>
          <div class="totals-row total-final" style="color: #000;">
            <span>TOTAL PAGADO:</span>
            <span>${formatMoney(totalPagado)}</span>
          </div>
          <div class="totals-row total-final" style="margin-top: 4px; font-size: 13px;">
            <span>SALDO PENDIENTE:</span>
            <span>${formatMoney(saldoPendiente)}</span>
          </div>
        </div>

        <div class="line"></div>
        <p class="center muted">¡GRACIAS POR SU PREFERENCIA!</p>
        ${config.fiscalLegend ? `<p class="center muted">${escapeXml(config.fiscalLegend)}</p>` : ""}
        <p class="center muted space">------ CONSERVE SU TICKET ------</p>
      </div>
      <script>window.onload = function(){ window.print(); };</script>
    </body>
    </html>
  `;
}

function imprimirTicketPedidoPersonalizado(pedidoId) {
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === pedidoId);
  if (!pedido) {
    alert("No se encontró el pedido personalizado para imprimir.");
    return;
  }

  const printWindow = window.open("", "_blank", "width=400,height=600");
  if (!printWindow) {
    alert("Por favor permita las ventanas emergentes para imprimir la nota del pedido.");
    return;
  }

  const ticketHTML = generarHTMLTicketPedidoPersonalizado(pedido);
  printWindow.document.open();
  printWindow.document.write(ticketHTML);
  printWindow.document.close();
}

function abrirModalNuevoPedido() {
  const form = document.getElementById("formNuevoPedido");
  if (form) form.reset();

  const container = document.getElementById("contenedorMateriaPrimaPedido");
  if (container) {
    container.innerHTML = "";
    agregarFilaMateriaPrimaPedido("INVENTARIO"); // Fila inicial
  }

  calcularSaldoPendienteModalNuevo();

  const modal = document.getElementById("modalNuevoPedido");
  if (modal) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }
}

function cerrarModalNuevoPedido() {
  const modal = document.getElementById("modalNuevoPedido");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
}

function cargarDatalistInsumosInventario() {
  const datalist = document.getElementById("listaInsumosInventario");
  if (!datalist) return;
  datalist.innerHTML = localDB.productos
    .map((p) => {
      const stock = calcularStock(p.codigo);
      return `<option value="[${escapeXml(p.codigo)}] ${escapeXml(p.nombre)}" data-codigo="${escapeXml(p.codigo)}" data-precio="${Math.max(0, parseNumber(p.precioVenta, 0))}">(Stock: ${stock})</option>`;
    })
    .join("");
}

function agregarFilaMateriaPrimaPedido(tipoDef = "INVENTARIO", datosDef = {}) {
  const container = document.getElementById("contenedorMateriaPrimaPedido");
  if (!container) return;

  cargarDatalistInsumosInventario();

  const sinInsumos = document.getElementById("divSinInsumosModal");
  if (sinInsumos) sinInsumos.remove();

  const div = document.createElement("div");
  div.className = "materia-prima-row";

  const esExtra = tipoDef === "EXTRA" || datosDef.esExtra === true;
  const cantDef = parseNumber(datosDef.cantidad, 1);
  const precioDef = parseNumber(datosDef.precioUnitario, 0);
  const subtotalDef = roundTo(cantDef * precioDef, 2);

  div.style.cssText = `
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: ${esExtra ? "#fff7ed" : "#f8fafc"};
    border: 1px solid ${esExtra ? "#fed7aa" : "#e2e8f0"};
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    width: 100%;
    box-sizing: border-box;
    flex-wrap: wrap;
  `;

  if (!esExtra) {
    let initialDisplayVal = "";
    let initialCodigo = datosDef.codigo || "";
    if (initialCodigo) {
      const prodEncontrado = localDB.productos.find((p) => p.codigo === initialCodigo);
      if (prodEncontrado) {
        initialDisplayVal = `[${prodEncontrado.codigo}] ${prodEncontrado.nombre}`;
      } else {
        initialDisplayVal = initialCodigo;
      }
    }

    div.innerHTML = `
      <div style="flex: 2 1 200px; min-width: 160px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 4px;">INSUMO (INVENTARIO)</label>
        <input type="text" class="mat-prod-input" list="listaInsumosInventario" value="${escapeXml(initialDisplayVal)}" data-codigo="${escapeXml(initialCodigo)}" placeholder="🔍 Escribe o busca un insumo..." oninput="onInsumoInputChanged(this)" onfocus="this.select()" style="width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85rem; background: #ffffff;">
      </div>
      <div style="flex: 1 1 70px; min-width: 60px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 4px; text-align: center;">CANT.</label>
        <input type="number" class="mat-prod-cant" min="0" step="1" value="${cantDef}" placeholder="1" oninput="recalcularSubtotalFilaInsumo(this)" style="width: 100%; box-sizing: border-box; padding: 7px 6px; border-radius: 6px; border: 1px solid #cbd5e1; text-align: center; font-size: 0.85rem;">
      </div>
      <div style="flex: 1 1 90px; min-width: 80px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 4px; text-align: right;">PRECIO U.</label>
        <input type="number" class="mat-prod-precio" min="0" step="1" value="${precioDef || ""}" placeholder="0.00" oninput="recalcularSubtotalFilaInsumo(this)" style="width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid #cbd5e1; text-align: right; font-size: 0.85rem;">
      </div>
      <div style="flex: 1 1 90px; min-width: 80px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 4px; text-align: right;">SUBTOTAL</label>
        <input type="number" class="mat-prod-subtotal" readonly value="${subtotalDef || ""}" placeholder="0.00" style="width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid #cbd5e1; text-align: right; font-size: 0.85rem; background: #f1f5f9; font-weight: 700; color: #0f172a;">
      </div>
      <div style="display: flex; align-items: flex-end; flex-shrink: 0; margin-left: auto;">
        <button type="button" class="btn btn-danger btn-sm" onclick="eliminarFilaInsumoPedido(this)" title="Eliminar fila" style="padding: 7px 12px; font-weight: bold; border-radius: 6px; height: 35px; line-height: 1;">✕</button>
      </div>
    `;
  } else {
    div.innerHTML = `
      <div style="flex: 2 1 200px; min-width: 160px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #c2410c; margin-bottom: 4px;">SERVICIO / CONCEPTO EXTRA</label>
        <input type="text" class="mat-prod-extra-nombre" value="${escapeXml(datosDef.nombre || "")}" placeholder="Ej. Mano de obra, Diseño, Servicio..." style="width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 6px; border: 1px solid #f97316; font-size: 0.85rem; background: #ffffff;">
      </div>
      <div style="flex: 1 1 70px; min-width: 60px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #c2410c; margin-bottom: 4px; text-align: center;">CANT.</label>
        <input type="number" class="mat-prod-cant" min="0" step="1" value="${cantDef}" placeholder="1" oninput="recalcularSubtotalFilaInsumo(this)" style="width: 100%; box-sizing: border-box; padding: 7px 6px; border-radius: 6px; border: 1px solid #fdba74; text-align: center; font-size: 0.85rem;">
      </div>
      <div style="flex: 1 1 90px; min-width: 80px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #c2410c; margin-bottom: 4px; text-align: right;">PRECIO U.</label>
        <input type="number" class="mat-prod-precio" min="0" step="1" value="${precioDef || ""}" placeholder="0.00" oninput="recalcularSubtotalFilaInsumo(this)" style="width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid #fdba74; text-align: right; font-size: 0.85rem;">
      </div>
      <div style="flex: 1 1 90px; min-width: 80px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #c2410c; margin-bottom: 4px; text-align: right;">SUBTOTAL</label>
        <input type="number" class="mat-prod-subtotal" readonly value="${subtotalDef || ""}" placeholder="0.00" style="width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid #f97316; text-align: right; font-size: 0.85rem; background: #ffedd5; font-weight: 700; color: #c2410c;">
      </div>
      <div style="display: flex; align-items: flex-end; flex-shrink: 0; margin-left: auto;">
        <button type="button" class="btn btn-danger btn-sm" onclick="eliminarFilaInsumoPedido(this)" title="Eliminar fila" style="padding: 7px 12px; font-weight: bold; border-radius: 6px; height: 35px; line-height: 1;">✕</button>
      </div>
    `;
  }

  container.appendChild(div);
  const modalOverlay = container.closest(".modal-overlay");
  if (modalOverlay) {
    modalOverlay.scrollTop = modalOverlay.scrollHeight;
  }
  recalcularTotalPedidoModal();
}

function onInsumoInputChanged(inputEl) {
  const val = inputEl.value.trim();
  const row = inputEl.closest(".materia-prima-row");
  if (!row) return;

  const datalist = document.getElementById("listaInsumosInventario");
  let codigoEncontrado = "";
  let precioSugerido = 0;

  if (datalist) {
    const options = Array.from(datalist.options);
    const matchedOption = options.find((opt) => opt.value === val);
    if (matchedOption) {
      codigoEncontrado = matchedOption.getAttribute("data-codigo") || "";
      precioSugerido = parseNumber(matchedOption.getAttribute("data-precio") || 0, 0);
    } else {
      const prod = localDB.productos.find(
        (p) => p.codigo.toLowerCase() === val.toLowerCase() || `[${p.codigo}] ${p.nombre}`.toLowerCase() === val.toLowerCase()
      );
      if (prod) {
        codigoEncontrado = prod.codigo;
        precioSugerido = Math.max(0, parseNumber(prod.precioVenta, 0));
      }
    }
  }

  inputEl.setAttribute("data-codigo", codigoEncontrado);

  const inputPrecio = row.querySelector(".mat-prod-precio");
  if (codigoEncontrado && inputPrecio && (!inputPrecio.value || parseNumber(inputPrecio.value, 0) === 0)) {
    inputPrecio.value = precioSugerido > 0 ? precioSugerido : "";
  }

  recalcularSubtotalFilaInsumo(inputEl);
}

function recalcularSubtotalFilaInsumo(el) {
  const row = el.closest(".materia-prima-row");
  if (!row) return;

  const cantInput = row.querySelector(".mat-prod-cant");
  const precioInput = row.querySelector(".mat-prod-precio");
  const subtotalInput = row.querySelector(".mat-prod-subtotal");

  const cant = parseNumber(cantInput ? cantInput.value : 0, 0);
  const precio = parseNumber(precioInput ? precioInput.value : 0, 0);
  const subtotal = roundTo(cant * precio, 2);

  if (subtotalInput) {
    subtotalInput.value = subtotal > 0 ? subtotal.toFixed(2) : "0.00";
  }

  recalcularTotalPedidoModal();
}

function eliminarFilaInsumoPedido(btnEl) {
  const row = btnEl.closest(".materia-prima-row");
  if (row) row.remove();

  const container = document.getElementById("contenedorMateriaPrimaPedido");
  if (container && container.querySelectorAll(".materia-prima-row").length === 0) {
    container.innerHTML = `
      <div id="divSinInsumosModal" style="text-align: center; color: #94a3b8; padding: 18px 10px; font-style: italic; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
        Haga clic en los botones de arriba para agregar insumos del inventario o servicios extras.
      </div>
    `;
  }
  recalcularTotalPedidoModal();
}

function recalcularTotalPedidoModal() {
  const subtotales = document.querySelectorAll("#contenedorMateriaPrimaPedido .mat-prod-subtotal");
  let suma = 0;
  let hayFilas = false;

  subtotales.forEach((subInput) => {
    hayFilas = true;
    suma += parseNumber(subInput.value, 0);
  });

  const totalInput = document.getElementById("pedidoPrecioTotal");
  if (totalInput && (hayFilas || suma > 0)) {
    totalInput.value = roundTo(suma, 2).toFixed(2);
  }

  calcularSaldoPendienteModalNuevo();
}

function calcularSaldoPendienteModalNuevo() {
  const total = parseNumber(
    document.getElementById("pedidoPrecioTotal")
      ? document.getElementById("pedidoPrecioTotal").value
      : 0,
    0,
  );
  const anticipo = parseNumber(
    document.getElementById("pedidoAnticipo")
      ? document.getElementById("pedidoAnticipo").value
      : 0,
    0,
  );

  const saldo = Math.max(0, total - anticipo);
  const lbl = document.getElementById("lblSaldoPendienteModalNuevo");
  if (lbl) {
    lbl.textContent = formatMoney(saldo);
  }
}

function agregarFilaMateriaPrimaPedidoEdit(tipoDef = "INVENTARIO", datosDef = {}) {
  const container = document.getElementById("contenedorMateriaPrimaPedidoEdit");
  if (!container) return;

  cargarDatalistInsumosInventario();

  const sinInsumos = container.querySelector("#divSinInsumosModalEdit");
  if (sinInsumos) sinInsumos.remove();

  const div = document.createElement("div");
  div.className = "materia-prima-row";

  const esExtra = tipoDef === "EXTRA" || datosDef.esExtra === true;
  const cantDef = parseNumber(datosDef.cantidad, 1);
  const precioDef = parseNumber(datosDef.precioUnitario, 0);
  const subtotalDef = roundTo(cantDef * precioDef, 2);

  div.style.cssText = `
    display: flex;
    align-items: flex-end;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
    background: ${esExtra ? "#fff7ed" : "#f8fafc"};
    border: 1px solid ${esExtra ? "#fed7aa" : "#e2e8f0"};
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    width: 100%;
    box-sizing: border-box;
    flex-wrap: wrap;
  `;

  if (!esExtra) {
    let initialDisplayVal = "";
    let initialCodigo = datosDef.codigo || "";
    if (initialCodigo) {
      const prodEncontrado = localDB.productos.find((p) => p.codigo === initialCodigo);
      if (prodEncontrado) {
        initialDisplayVal = `[${prodEncontrado.codigo}] ${prodEncontrado.nombre}`;
      } else {
        initialDisplayVal = initialCodigo;
      }
    } else if (datosDef.nombre) {
      initialDisplayVal = datosDef.nombre;
    }

    div.innerHTML = `
      <div style="flex: 2 1 200px; min-width: 160px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 4px;">INSUMO (INVENTARIO)</label>
        <input type="text" class="mat-prod-input" list="listaInsumosInventario" value="${escapeXml(initialDisplayVal)}" data-codigo="${escapeXml(initialCodigo)}" placeholder="🔍 Escribe o busca un insumo..." oninput="onInsumoInputChanged(this)" onfocus="this.select()" style="width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85rem; background: #ffffff;">
      </div>
      <div style="flex: 1 1 70px; min-width: 60px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 4px; text-align: center;">CANT.</label>
        <input type="number" class="mat-prod-cant" min="0" step="1" value="${cantDef}" placeholder="1" oninput="recalcularSubtotalFilaInsumoEdit(this)" style="width: 100%; box-sizing: border-box; padding: 7px 6px; border-radius: 6px; border: 1px solid #cbd5e1; text-align: center; font-size: 0.85rem;">
      </div>
      <div style="flex: 1 1 90px; min-width: 80px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 4px; text-align: right;">PRECIO U.</label>
        <input type="number" class="mat-prod-precio" min="0" step="1" value="${precioDef || ""}" placeholder="0.00" oninput="recalcularSubtotalFilaInsumoEdit(this)" style="width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid #cbd5e1; text-align: right; font-size: 0.85rem;">
      </div>
      <div style="flex: 1 1 90px; min-width: 80px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 4px; text-align: right;">SUBTOTAL</label>
        <input type="number" class="mat-prod-subtotal" readonly value="${subtotalDef || ""}" placeholder="0.00" style="width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid #cbd5e1; text-align: right; font-size: 0.85rem; background: #f1f5f9; font-weight: 700; color: #0f172a;">
      </div>
      <div style="display: flex; align-items: flex-end; flex-shrink: 0; margin-left: auto;">
        <button type="button" class="btn btn-danger btn-sm" onclick="eliminarFilaInsumoPedidoEdit(this)" title="Eliminar fila" style="padding: 7px 12px; font-weight: bold; border-radius: 6px; height: 35px; line-height: 1;">✕</button>
      </div>
    `;
  } else {
    div.innerHTML = `
      <div style="flex: 2 1 200px; min-width: 160px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #c2410c; margin-bottom: 4px;">SERVICIO / CONCEPTO EXTRA</label>
        <input type="text" class="mat-prod-extra-nombre" value="${escapeXml(datosDef.nombre || "")}" placeholder="Ej. Mano de obra, Diseño, Servicio..." style="width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 6px; border: 1px solid #f97316; font-size: 0.85rem; background: #ffffff;">
      </div>
      <div style="flex: 1 1 70px; min-width: 60px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #c2410c; margin-bottom: 4px; text-align: center;">CANT.</label>
        <input type="number" class="mat-prod-cant" min="0" step="1" value="${cantDef}" placeholder="1" oninput="recalcularSubtotalFilaInsumoEdit(this)" style="width: 100%; box-sizing: border-box; padding: 7px 6px; border-radius: 6px; border: 1px solid #fdba74; text-align: center; font-size: 0.85rem;">
      </div>
      <div style="flex: 1 1 90px; min-width: 80px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #c2410c; margin-bottom: 4px; text-align: right;">PRECIO U.</label>
        <input type="number" class="mat-prod-precio" min="0" step="1" value="${precioDef || ""}" placeholder="0.00" oninput="recalcularSubtotalFilaInsumoEdit(this)" style="width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid #fdba74; text-align: right; font-size: 0.85rem;">
      </div>
      <div style="flex: 1 1 90px; min-width: 80px;">
        <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #c2410c; margin-bottom: 4px; text-align: right;">SUBTOTAL</label>
        <input type="number" class="mat-prod-subtotal" readonly value="${subtotalDef || ""}" placeholder="0.00" style="width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 6px; border: 1px solid #f97316; text-align: right; font-size: 0.85rem; background: #ffedd5; font-weight: 700; color: #c2410c;">
      </div>
      <div style="display: flex; align-items: flex-end; flex-shrink: 0; margin-left: auto;">
        <button type="button" class="btn btn-danger btn-sm" onclick="eliminarFilaInsumoPedidoEdit(this)" title="Eliminar fila" style="padding: 7px 12px; font-weight: bold; border-radius: 6px; height: 35px; line-height: 1;">✕</button>
      </div>
    `;
  }

  container.appendChild(div);
  recalcularTotalPedidoModalEdit();
}

function recalcularSubtotalFilaInsumoEdit(el) {
  const row = el.closest(".materia-prima-row");
  if (!row) return;

  const cantInput = row.querySelector(".mat-prod-cant");
  const precioInput = row.querySelector(".mat-prod-precio");
  const subtotalInput = row.querySelector(".mat-prod-subtotal");

  const cant = parseNumber(cantInput ? cantInput.value : 0, 0);
  const precio = parseNumber(precioInput ? precioInput.value : 0, 0);
  const subtotal = roundTo(cant * precio, 2);

  if (subtotalInput) {
    subtotalInput.value = subtotal > 0 ? subtotal.toFixed(2) : "0.00";
  }

  recalcularTotalPedidoModalEdit();
}

function eliminarFilaInsumoPedidoEdit(btnEl) {
  const row = btnEl.closest(".materia-prima-row");
  if (row) row.remove();

  const container = document.getElementById("contenedorMateriaPrimaPedidoEdit");
  if (container && container.querySelectorAll(".materia-prima-row").length === 0) {
    container.innerHTML = `
      <div id="divSinInsumosModalEdit" style="text-align: center; color: #94a3b8; padding: 18px 10px; font-style: italic; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
        Haga clic en los botones de arriba para agregar insumos del inventario o servicios extras.
      </div>
    `;
  }
  recalcularTotalPedidoModalEdit();
}

function recalcularTotalPedidoModalEdit() {
  const subtotales = document.querySelectorAll("#contenedorMateriaPrimaPedidoEdit .mat-prod-subtotal");
  let suma = 0;
  let hayFilas = false;

  subtotales.forEach((subInput) => {
    hayFilas = true;
    suma += parseNumber(subInput.value, 0);
  });

  const totalInput = document.getElementById("editPedidoPrecioTotal");
  if (totalInput && (hayFilas || suma > 0)) {
    totalInput.value = roundTo(suma, 2).toFixed(2);
  }

  calcularSaldoPendienteModalEdit();
}

function calcularSaldoPendienteModalEdit() {
  const total = parseNumber(
    document.getElementById("editPedidoPrecioTotal")
      ? document.getElementById("editPedidoPrecioTotal").value
      : 0,
    0,
  );

  const id = document.getElementById("editPedidoId") ? document.getElementById("editPedidoId").value : "";
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === id);

  const totalPagado = pedido ? (pedido.pagos || []).reduce((acc, p) => acc + parseNumber(p.monto, 0), 0) : 0;
  const saldo = Math.max(0, total - totalPagado);

  const lblPagado = document.getElementById("lblTotalPagadoModalEdit");
  if (lblPagado) lblPagado.textContent = formatMoney(totalPagado);

  const lblSaldo = document.getElementById("lblSaldoPendienteModalEdit");
  if (lblSaldo) lblSaldo.textContent = formatMoney(saldo);
}

function abrirModalEditarPedido(pedidoId) {
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === pedidoId);
  if (!pedido) {
    alert("No se encontró el pedido para editar.");
    return;
  }

  document.getElementById("editPedidoId").value = pedido.id;
  document.getElementById("editPedidoClienteNombre").value = pedido.cliente ? pedido.cliente.nombre : "";
  document.getElementById("editPedidoClienteTelefono").value = pedido.cliente ? pedido.cliente.telefono || "" : "";
  document.getElementById("editPedidoFechaEntrega").value = pedido.fechaEntregaEstimada || "";
  document.getElementById("editPedidoEspecificaciones").value = pedido.especificaciones || "";
  document.getElementById("editPedidoPrecioTotal").value = parseNumber(pedido.precioTotal, 0).toFixed(2);

  const container = document.getElementById("contenedorMateriaPrimaPedidoEdit");
  if (container) {
    container.innerHTML = "";
    if (pedido.materiasPrimas && pedido.materiasPrimas.length > 0) {
      pedido.materiasPrimas.forEach((m) => {
        agregarFilaMateriaPrimaPedidoEdit(m.esExtra ? "EXTRA" : "INVENTARIO", m);
      });
    } else {
      agregarFilaMateriaPrimaPedidoEdit("INVENTARIO");
    }
  }

  calcularSaldoPendienteModalEdit();

  const modalDetalle = document.getElementById("modalDetallePedido");
  if (modalDetalle) {
    modalDetalle.classList.remove("open");
    modalDetalle.setAttribute("aria-hidden", "true");
  }

  const modal = document.getElementById("modalEditarPedido");
  if (modal) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }
}

function cerrarModalEditarPedido() {
  const modal = document.getElementById("modalEditarPedido");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
}

function guardarEdicionPedidoPersonalizado(event) {
  event.preventDefault();

  const id = document.getElementById("editPedidoId").value;
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === id);
  if (!pedido) {
    alert("No se encontró el pedido a actualizar.");
    return;
  }

  const clienteNombre = document.getElementById("editPedidoClienteNombre").value.trim();
  const clienteTelefono = document.getElementById("editPedidoClienteTelefono").value.trim();
  const fechaEntrega = document.getElementById("editPedidoFechaEntrega").value;
  const especificaciones = document.getElementById("editPedidoEspecificaciones").value.trim();
  const total = parseNumber(document.getElementById("editPedidoPrecioTotal").value, 0);

  if (!clienteNombre) {
    alert("Por favor ingrese el nombre del cliente.");
    return;
  }

  if (total <= 0) {
    alert("El monto total acordado debe ser mayor a $0.00.");
    return;
  }

  const totalPagado = (pedido.pagos || []).reduce((acc, p) => acc + parseNumber(p.monto, 0), 0);
  if (total < roundTo(totalPagado, 2)) {
    alert(`El total acordado (${formatMoney(total)}) no puede ser menor a los abonos/anticipos ya recibidos (${formatMoney(totalPagado)}).`);
    return;
  }

  // Recolectar insumos actualizados
  const materiasPrimas = [];
  const filasMat = document.querySelectorAll("#contenedorMateriaPrimaPedidoEdit .materia-prima-row");
  filasMat.forEach((row) => {
    const inputInsumo = row.querySelector(".mat-prod-input");
    const extraNombreInput = row.querySelector(".mat-prod-extra-nombre");
    const inputCant = row.querySelector(".mat-prod-cant");
    const inputPrecio = row.querySelector(".mat-prod-precio");

    const cantRaw = parseNumber(inputCant ? inputCant.value : 1, 1);
    const cant = cantRaw > 0 ? cantRaw : 1;
    const precioUnitario = parseNumber(inputPrecio ? inputPrecio.value : 0, 0);
    const subtotal = roundTo(cant * precioUnitario, 2);

    if (inputInsumo) {
      let codigo = inputInsumo.getAttribute("data-codigo") || "";
      const val = inputInsumo.value.trim();

      if (!codigo && val) {
        const prod = localDB.productos.find(
          (p) => p.codigo.toLowerCase() === val.toLowerCase() || `[${p.codigo}] ${p.nombre}`.toLowerCase() === val.toLowerCase()
        );
        if (prod) codigo = prod.codigo;
      }

      if (codigo) {
        const prod = localDB.productos.find((p) => p.codigo === codigo);
        materiasPrimas.push({
          codigo: codigo,
          nombre: prod ? prod.nombre : (val || codigo),
          cantidad: cant,
          precioUnitario,
          subtotal,
          esExtra: false,
        });
      } else if (val) {
        materiasPrimas.push({
          codigo: "",
          nombre: val,
          cantidad: cant,
          precioUnitario,
          subtotal,
          esExtra: true,
        });
      }
    } else if (extraNombreInput && extraNombreInput.value.trim()) {
      materiasPrimas.push({
        codigo: "",
        nombre: extraNombreInput.value.trim(),
        cantidad: cant,
        precioUnitario,
        subtotal,
        esExtra: true,
      });
    }
  });

  pedido.cliente = {
    nombre: clienteNombre,
    telefono: clienteTelefono,
  };
  pedido.fechaEntregaEstimada = fechaEntrega || "";
  pedido.especificaciones = especificaciones;
  pedido.precioTotal = total;
  pedido.materiasPrimas = materiasPrimas;

  if (!pedido.historialEstados) pedido.historialEstados = [];
  pedido.historialEstados.push({
    estado: pedido.estado,
    fecha: new Date().toISOString(),
    nota: "Pedido corregido / editado por el usuario",
  });

  guardarEstadoLocal();
  cerrarModalEditarPedido();
  renderizarModuloPedidos();

  if (document.getElementById("modalDetallePedido") && document.getElementById("modalDetallePedido").classList.contains("open")) {
    verDetallePedido(pedido.id);
  }

  alert(`¡Pedido ${pedido.folio} actualizado correctamente!`);
}

function calcularSaldoPendienteModalNuevo() {
  const total = parseNumber(
    document.getElementById("pedidoPrecioTotal")
      ? document.getElementById("pedidoPrecioTotal").value
      : 0,
    0,
  );
  const anticipo = parseNumber(
    document.getElementById("pedidoAnticipo")
      ? document.getElementById("pedidoAnticipo").value
      : 0,
    0,
  );

  const saldo = Math.max(0, total - anticipo);
  const lbl = document.getElementById("lblSaldoPendienteModalNuevo");
  if (lbl) {
    lbl.textContent = formatMoney(saldo);
  }
}

function guardarNuevoPedidoPersonalizado(event) {
  event.preventDefault();

  const clienteNombre = document.getElementById("pedidoClienteNombre").value.trim();
  const clienteTelefono = document.getElementById("pedidoClienteTelefono").value.trim();
  const fechaEntrega = document.getElementById("pedidoFechaEntrega").value;
  const especificaciones = document.getElementById("pedidoEspecificaciones").value.trim();

  const total = parseNumber(document.getElementById("pedidoPrecioTotal").value, 0);
  const anticipo = parseNumber(document.getElementById("pedidoAnticipo").value, 0);
  const metodoPago = document.getElementById("pedidoMetodoPago").value;

  if (!clienteNombre) {
    alert("Por favor ingrese el nombre del cliente.");
    return;
  }

  if (total <= 0) {
    alert("El monto total acordado debe ser mayor a $0.00.");
    return;
  }

  if (anticipo > total) {
    alert("El anticipo no puede ser mayor al precio total acordado.");
    return;
  }

  // Recolectar materias primas e insumos/servicios extras
  const materiasPrimas = [];
  const filasMat = document.querySelectorAll("#contenedorMateriaPrimaPedido .materia-prima-row");
  filasMat.forEach((row) => {
    const inputInsumo = row.querySelector(".mat-prod-input");
    const extraNombreInput = row.querySelector(".mat-prod-extra-nombre");
    const inputCant = row.querySelector(".mat-prod-cant");
    const inputPrecio = row.querySelector(".mat-prod-precio");

    const cantRaw = parseNumber(inputCant ? inputCant.value : 1, 1);
    const cant = cantRaw > 0 ? cantRaw : 1;
    const precioUnitario = parseNumber(inputPrecio ? inputPrecio.value : 0, 0);
    const subtotal = roundTo(cant * precioUnitario, 2);

    if (inputInsumo) {
      let codigo = inputInsumo.getAttribute("data-codigo") || "";
      const val = inputInsumo.value.trim();

      if (!codigo && val) {
        const prod = localDB.productos.find(
          (p) => p.codigo.toLowerCase() === val.toLowerCase() || `[${p.codigo}] ${p.nombre}`.toLowerCase() === val.toLowerCase()
        );
        if (prod) codigo = prod.codigo;
      }

      if (codigo) {
        const prod = localDB.productos.find((p) => p.codigo === codigo);
        materiasPrimas.push({
          codigo: codigo,
          nombre: prod ? prod.nombre : codigo,
          cantidad: cant,
          precioUnitario,
          subtotal,
          esExtra: false,
        });
      }
    } else if (extraNombreInput && extraNombreInput.value.trim()) {
      materiasPrimas.push({
        codigo: "",
        nombre: extraNombreInput.value.trim(),
        cantidad: cant,
        precioUnitario,
        subtotal,
        esExtra: true,
      });
    }
  });

  const numPedido = (localDB.pedidosPersonalizados ? localDB.pedidosPersonalizados.length : 0) + 1;
  const folio = `PED-${String(numPedido).padStart(4, "0")}`;

  const fechaAhora = new Date().toISOString();
  const pagos = [];
  let pagoAnticipoObj = null;
  if (anticipo > 0) {
    pagoAnticipoObj = {
      id: `PAGO-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      fecha: fechaAhora,
      concepto: "Anticipo Inicial",
      monto: anticipo,
      metodo: metodoPago,
      ventaId: null,
    };
    pagos.push(pagoAnticipoObj);
  }

  const pedido = {
    id: `PED-${Date.now()}`,
    folio,
    fechaCreacion: fechaAhora,
    fechaEntregaEstimada: fechaEntrega || "",
    cliente: {
      nombre: clienteNombre,
      telefono: clienteTelefono,
    },
    especificaciones,
    materiasPrimas,
    descontadoInventario: false,
    precioTotal: total,
    anticipoInicial: anticipo,
    pagos,
    estado: "PENDIENTE",
    historialEstados: [
      {
        estado: "PENDIENTE",
        fecha: fechaAhora,
        nota: "Pedido registrado con anticipo de " + formatMoney(anticipo),
      },
    ],
    ventaId: null,
  };

  if (!localDB.pedidosPersonalizados) {
    localDB.pedidosPersonalizados = [];
  }

  localDB.pedidosPersonalizados.push(pedido);

  if (pagoAnticipoObj) {
    registrarPagoPedidoComoVenta(pedido, pagoAnticipoObj);
  }

  guardarEstadoLocal();
  cerrarModalNuevoPedido();
  renderizarModuloPedidos();

  alert(`¡Pedido personalizado ${folio} registrado con éxito!`);
}

function verDetallePedido(pedidoId) {
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === pedidoId);
  if (!pedido) return;

  const body = document.getElementById("bodyDetallePedido");
  if (!body) return;

  const totalPagado = (pedido.pagos || []).reduce(
    (acc, pago) => acc + parseNumber(pago.monto, 0),
    0,
  );
  const saldoPendiente = Math.max(0, parseNumber(pedido.precioTotal, 0) - totalPagado);

  // Determinar posición en la línea de tiempo (Timeline)
  const estadosOrder = ["PENDIENTE", "EN_PROCESO", "TERMINADO", "ENTREGADO"];
  const currentIdx = estadosOrder.indexOf(pedido.estado);
  const progressPercent = (currentIdx / 3) * 100;

  // Generar HTML de la Línea de Tiempo
  const timelineHTML = `
    <div class="timeline-wrapper" style="overflow: hidden; width: 100%;">
      <h4 style="margin:0 0 15px 0; color:#1e293b; font-size:1rem;">📌 Estado Actual del Pedido: <span style="text-transform:uppercase; font-weight:800; color:#2563eb;">${pedido.estado.replace("_", " ")}</span></h4>
      <div class="timeline" style="overflow: hidden; width: 100%; position: relative; box-sizing: border-box;">
        <div class="timeline-progress-bar" style="width: ${progressPercent}%;"></div>

        <div class="timeline-step ${currentIdx >= 0 ? (currentIdx === 0 ? "step-active" : "step-completed") : ""}" onclick="cambiarEstadoPedido('${pedido.id}', 'PENDIENTE')">
          <div class="step-icon">📋</div>
          <div class="step-label">Pendiente</div>
        </div>

        <div class="timeline-step ${currentIdx >= 1 ? (currentIdx === 1 ? "step-active" : "step-completed") : ""}" onclick="cambiarEstadoPedido('${pedido.id}', 'EN_PROCESO')">
          <div class="step-icon">⚙️</div>
          <div class="step-label">En Proceso</div>
        </div>

        <div class="timeline-step ${currentIdx >= 2 ? (currentIdx === 2 ? "step-active" : "step-completed") : ""}" onclick="cambiarEstadoPedido('${pedido.id}', 'TERMINADO')">
          <div class="step-icon">📦</div>
          <div class="step-label">Terminado</div>
        </div>

        <div class="timeline-step ${currentIdx >= 3 ? (currentIdx === 3 ? "step-active" : "step-completed") : ""}" onclick="cambiarEstadoPedido('${pedido.id}', 'ENTREGADO')">
          <div class="step-icon">✅</div>
          <div class="step-label">Entregado</div>
        </div>
      </div>
    </div>
  `;

  // Filas de Materia Prima y Servicios
  const materiaPrimaHTML = (pedido.materiasPrimas || []).length > 0
    ? `
      <div style="overflow-x: auto;">
        <table class="table" style="width: 100%; font-size: 0.85rem; margin: 0;">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Concepto / Producto</th>
              <th style="text-align:center;">Cant.</th>
              <th style="text-align:right;">P. Unitario</th>
              <th style="text-align:right;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${pedido.materiasPrimas
      .map((m) => {
        const esEx = m.esExtra || !m.codigo;
        const pu = parseNumber(m.precioUnitario, 0);
        const sub = roundTo(parseNumber(m.subtotal, m.cantidad * pu), 2);
        return `
                <tr>
                  <td><span class="badge" style="background:${esEx ? "#ffedd5" : "#e2e8f0"}; color:${esEx ? "#c2410c" : "#1e293b"};">${esEx ? "Servicio / Extra" : "Inventario"}</span></td>
                  <td><strong>${m.codigo ? `[${escapeXml(m.codigo)}] ` : ""}${escapeXml(m.nombre)}</strong></td>
                  <td style="text-align:center;">${m.cantidad}</td>
                  <td style="text-align:right;">${pu > 0 ? formatMoney(pu) : "-"}</td>
                  <td style="text-align:right; font-weight:700; color:#0f172a;">${sub > 0 ? formatMoney(sub) : "-"}</td>
                </tr>`;
      })
      .join("")}
          </tbody>
        </table>
      </div>`
    : "<p style='color:#94a3b8; font-style:italic;'>No se especificaron materias primas o servicios registrados.</p>";

  // Historial de Pagos
  const pagosHTML = (pedido.pagos || [])
    .map(
      (pago) => `
      <tr>
        <td>${formatDate(pago.fecha)}</td>
        <td>${escapeXml(pago.concepto)}</td>
        <td><span class="badge" style="background:#e0f2fe; color:#0369a1;">${escapeXml(pago.metodo || "EFECTIVO")}</span></td>
        <td style="font-weight:700; color:#059669;">${formatMoney(pago.monto)}</td>
      </tr>`,
    )
    .join("");

  body.innerHTML = `
    <!-- Header del Pedido -->
    <div class="pedido-detail-card" style="background: #f8fafc; border: 1px solid #e2e8f0; margin-bottom: 14px; padding: 14px 18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="display:flex; align-items:center; gap:10px;">
            <h2 style="margin:0; color:#0f172a; font-size:1.4rem; font-weight:800;">${escapeXml(pedido.folio)}</h2>
            <span class="badge badge-pedido-${pedido.estado.toLowerCase().replace('_', '')}" style="font-size:0.88rem; padding: 5px 14px; text-transform:uppercase;">
              ${pedido.estado.replace('_', ' ')}
            </span>
          </div>
          <small style="color:#64748b; font-size:0.82rem;">Registrado el ${formatDate(pedido.fechaCreacion)}</small>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-warning btn-sm" onclick="abrirModalEditarPedido('${pedido.id}')" style="padding: 8px 16px;">
            ✏️ Editar / Corregir Pedido
          </button>
          <button class="btn btn-primary btn-sm" onclick="imprimirTicketPedidoPersonalizado('${pedido.id}')" style="box-shadow:0 2px 6px rgba(14,165,233,0.25); padding: 8px 16px;">
            🖨️ Imprimir Ticket / Nota
          </button>
        </div>
      </div>
    </div>

    <!-- Sección 1: Línea de Tiempo (Ancho Completo) -->
    <div class="pedido-detail-card" style="margin-bottom: 14px; padding: 16px 18px; overflow: hidden; width: 100%; box-sizing: border-box;">
      <div class="timeline-wrapper" style="margin: 0; padding: 0; background: transparent; border: none; overflow: hidden; width: 100%;">
        <h4 style="margin:0 0 15px 0; color:#1e293b; font-size:1rem;">📌 Estado Actual del Pedido: <span style="text-transform:uppercase; font-weight:800; color:#2563eb;">${pedido.estado.replace("_", " ")}</span></h4>
        <div class="timeline" style="width: 100%; box-sizing: border-box;">
          <div class="timeline-progress-bar" style="width: ${progressPercent}%;"></div>

          <div class="timeline-step ${currentIdx >= 0 ? (currentIdx === 0 ? "step-active" : "step-completed") : ""}" onclick="cambiarEstadoPedido('${pedido.id}', 'PENDIENTE')">
            <div class="step-icon">📋</div>
            <div class="step-label">Pendiente</div>
          </div>

          <div class="timeline-step ${currentIdx >= 1 ? (currentIdx === 1 ? "step-active" : "step-completed") : ""}" onclick="cambiarEstadoPedido('${pedido.id}', 'EN_PROCESO')">
            <div class="step-icon">⚙️</div>
            <div class="step-label">En Proceso</div>
          </div>

          <div class="timeline-step ${currentIdx >= 2 ? (currentIdx === 2 ? "step-active" : "step-completed") : ""}" onclick="cambiarEstadoPedido('${pedido.id}', 'TERMINADO')">
            <div class="step-icon">📦</div>
            <div class="step-label">Terminado</div>
          </div>

          <div class="timeline-step ${currentIdx >= 3 ? (currentIdx === 3 ? "step-active" : "step-completed") : ""}" onclick="cambiarEstadoPedido('${pedido.id}', 'ENTREGADO')">
            <div class="step-icon">✅</div>
            <div class="step-label">Entregado</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Contenedor Secuencial de Ancho Completo (Full Width) -->
    <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 14px; width: 100%;">

      <!-- Sección 2: Control de Avance de Producción -->
      <!-- <div class="pedido-detail-card" style="margin-bottom: 0; padding: 16px; background: #fdfdfd; border-left: 4px solid #3b82f6;">
        <div class="pedido-detail-header" style="font-size: 0.95rem; border-bottom-color: #e2e8f0; padding-bottom: 8px; margin-bottom: 12px; color: #1e293b;">
          <span>⚡ Acciones de Avance de Producción</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
          ${pedido.estado !== "PENDIENTE" ? `<button class="btn btn-secondary btn-sm" style="justify-content:center;" onclick="cambiarEstadoPedido('${pedido.id}', 'PENDIENTE')">⏪ Regresar a PENDIENTE</button>` : ""}
          ${pedido.estado !== "EN_PROCESO" ? `<button class="btn btn-info btn-sm" style="justify-content:center;" onclick="cambiarEstadoPedido('${pedido.id}', 'EN_PROCESO')">⚙️ Pasar a EN PROCESO</button>` : ""}
          ${pedido.estado !== "TERMINADO" ? `<button class="btn btn-warning btn-sm" style="justify-content:center;" onclick="cambiarEstadoPedido('${pedido.id}', 'TERMINADO')">📦 Marcar TERMINADO</button>` : ""}
          ${pedido.estado !== "ENTREGADO" ? `<button class="btn btn-success btn-sm" style="justify-content:center;" onclick="cambiarEstadoPedido('${pedido.id}', 'ENTREGADO')">✅ Marcar ENTREGADO y Liquidar</button>` : ""}
        </div>
      </div> -->

      <!-- Sección 3: Datos del Cliente y Trabajo -->
      <div class="pedido-detail-card" style="margin-bottom: 0; padding: 16px;">
        <div class="pedido-detail-header" style="font-size: 0.95rem; border-bottom-color: #e2e8f0; padding-bottom: 8px; margin-bottom: 12px;">
          <span>👤 Información del Cliente y Especificaciones</span>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; font-size: 0.88rem; margin-bottom: 12px; background: #f8fafc; padding: 12px 14px; border-radius: 8px; border: 1px solid #e2e8f0;">
          <div>
            <span style="color: #64748b; font-size: 0.75rem; font-weight: 700; display: block;">CLIENTE</span>
            <strong style="color: #1e293b; font-size: 0.95rem;">${escapeXml(pedido.cliente ? pedido.cliente.nombre : "Sin Nombre")}</strong>
          </div>
          <div>
            <span style="color: #64748b; font-size: 0.75rem; font-weight: 700; display: block;">TELÉFONO</span>
            <strong style="color: #1e293b; font-size: 0.95rem;">${escapeXml(pedido.cliente ? pedido.cliente.telefono || "No registrado" : "-")}</strong>
          </div>
          <div>
            <span style="color: #64748b; font-size: 0.75rem; font-weight: 700; display: block;">ENTREGA ESTIMADA</span>
            <strong style="color: #2563eb; font-size: 0.95rem;">📅 ${pedido.fechaEntregaEstimada ? formatDate(pedido.fechaEntregaEstimada) : "Sin fecha límite"}</strong>
          </div>
        </div>

        <span style="color: #475569; font-size: 0.8rem; font-weight: 700; display: block; margin-bottom: 6px;">📝 ESPECIFICACIONES / DETALLES DEL DISEÑO:</span>
        <div style="background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 14px; font-size: 0.88rem; color: #334155; max-height: 120px; overflow-y: auto; white-space: pre-wrap;">${escapeXml(pedido.especificaciones)}</div>
      </div>

      <!-- Sección 4: Materias Primas e Insumos (Ancho Completo) -->
      <div class="pedido-detail-card" style="margin-bottom: 0; padding: 16px;">
        <div class="pedido-detail-header" style="font-size: 0.95rem; border-bottom-color: #e2e8f0; padding-bottom: 8px; margin-bottom: 12px;">
          <span>📦 Materias Primas e Insumos Registrados</span>
          <span class="badge ${pedido.descontadoInventario ? "badge-success" : "badge-warning"}" style="font-size: 0.76rem;">
            ${pedido.descontadoInventario ? "✔️ Inventario Descontado" : "⏳ Pendiente de Descontar"}
          </span>
        </div>
        <div style="margin: 0; max-height: 240px; overflow-y: auto;">
          ${materiaPrimaHTML}
        </div>
      </div>

      <!-- Sección 5: Estado Financiero y Control de Abonos (Ancho Completo) -->
      <div class="pedido-detail-card" style="margin-bottom: 0; padding: 16px;">
        <div class="pedido-detail-header" style="font-size: 0.95rem; border-bottom-color: #e2e8f0; padding-bottom: 8px; margin-bottom: 12px;">
          <span>💳 Estado Financiero y Historial de Pagos</span>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px;">
          <div style="background: #f1f5f9; padding: 10px 12px; border-radius: 8px; text-align: center; border: 1px solid #e2e8f0;">
            <span style="font-size: 0.75rem; color: #64748b; font-weight: 700; text-transform: uppercase;">MONTO TOTAL</span>
            <h3 style="margin: 4px 0 0 0; color: #0f172a; font-size: 1.15rem;">${formatMoney(pedido.precioTotal)}</h3>
          </div>
          <div style="background: #dcfce7; padding: 10px 12px; border-radius: 8px; text-align: center; border: 1px solid #bbf7d0;">
            <span style="font-size: 0.75rem; color: #15803d; font-weight: 700; text-transform: uppercase;">TOTAL PAGADO</span>
            <h3 style="margin: 4px 0 0 0; color: #16a34a; font-size: 1.15rem;">${formatMoney(totalPagado)}</h3>
          </div>
          <div style="background: #fee2e2; padding: 10px 12px; border-radius: 8px; text-align: center; border: 1px solid #fca5a5;">
            <span style="font-size: 0.75rem; color: #991b1b; font-weight: 700; text-transform: uppercase;">SALDO PENDIENTE</span>
            <h3 style="margin: 4px 0 0 0; color: #dc2626; font-size: 1.15rem;">${formatMoney(saldoPendiente)}</h3>
          </div>
        </div>

        <span style="color: #475569; font-size: 0.8rem; font-weight: 700; display: block; margin-bottom: 6px;">HISTORIAL DE ABONOS RECIBIDOS:</span>
        <div style="max-height: 130px; overflow-y: auto; margin-bottom: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <table class="table" style="font-size: 0.85rem; width: 100%; margin: 0;">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th>Método de Pago</th>
                <th>Monto Abonado</th>
              </tr>
            </thead>
            <tbody>
              ${pagosHTML || '<tr><td colspan="4" style="text-align:center; color:#94a3b8; padding:10px;">No hay abonos registrados aún.</td></tr>'}
            </tbody>
          </table>
        </div>

        ${saldoPendiente > 0 && pedido.estado !== "ENTREGADO"
      ? `
        <div style="background: #f8fafc; padding: 12px 14px; border-radius: 8px; border: 1px solid #cbd5e1; margin-top: 8px;">
          <span style="font-size: 0.82rem; font-weight: 700; color: #1e293b; display: block; margin-bottom: 8px;">+ REGISTRAR NUEVO ABONO:</span>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <input type="number" id="montoAbonoInput" min="0.01" max="${saldoPendiente}" step="0.01" placeholder="Monto a abonar ($)" style="padding: 8px 12px; border-radius: 6px; border: 1px solid #cbd5e1; flex: 1; min-width: 130px; font-size: 0.88rem;">
            <select id="metodoAbonoSelect" style="padding: 8px 12px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.88rem;">
              <option value="EFECTIVO">Efectivo</option>
              <option value="TARJETA">Tarjeta</option>
              <option value="TRANSFERENCIA">Transferencia</option>
            </select>
            <button class="btn btn-success" onclick="registrarAbonoPedido('${pedido.id}')" style="white-space: nowrap; padding: 8px 16px; font-size: 0.88rem;">💰 Agregar Abono</button>
          </div>
        </div>`
      : ""
    }
      </div>

    </div>

    </div>
  `;

  const modal = document.getElementById("modalDetallePedido");
  if (modal) {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  }
}

function cerrarModalDetallePedido() {
  const modal = document.getElementById("modalDetallePedido");
  if (modal) {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  }
}

function cambiarEstadoPedido(pedidoId, nuevoEstado) {
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === pedidoId);
  if (!pedido) return;

  const estadoAnterior = pedido.estado;
  if (estadoAnterior === nuevoEstado) return;

  // Si pasa a EN_PROCESO o TERMINADO y aún no se ha descontado el inventario de materia prima
  if ((nuevoEstado === "EN_PROCESO" || nuevoEstado === "TERMINADO" || nuevoEstado === "ENTREGADO") && !pedido.descontadoInventario) {
    descontarMateriaPrimaPedido(pedido);
  }

  // Si cambia a ENTREGADO, liquidar la venta final e integrarlo con localDB.ventas
  if (nuevoEstado === "ENTREGADO") {
    const totalPagado = (pedido.pagos || []).reduce(
      (acc, p) => acc + parseNumber(p.monto, 0),
      0,
    );
    const saldoPendiente = Math.max(0, parseNumber(pedido.precioTotal, 0) - totalPagado);

    let metodoPagoFinal = "EFECTIVO";
    if (saldoPendiente > 0) {
      const respMetodo = prompt(
        `El pedido tiene un saldo pendiente de ${formatMoney(saldoPendiente)}.\nIngrese el método de pago para liquidar el saldo (EFECTIVO, TARJETA, TRANSFERENCIA):`,
        "EFECTIVO",
      );
      if (!respMetodo) {
        return; // Cancelar si el usuario no especifica
      }
      metodoPagoFinal = respMetodo.trim().toUpperCase();
      if (!["EFECTIVO", "TARJETA", "TRANSFERENCIA"].includes(metodoPagoFinal)) {
        metodoPagoFinal = "EFECTIVO";
      }

      // Registrar pago de liquidación
      const pagoLiquidacion = {
        id: `PAGO-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        fecha: new Date().toISOString(),
        concepto: "Liquidación Final de Entrega",
        monto: saldoPendiente,
        metodo: metodoPagoFinal,
        ventaId: null,
      };
      pedido.pagos.push(pagoLiquidacion);
      registrarPagoPedidoComoVenta(pedido, pagoLiquidacion);
    }

    // Registrar en localDB.ventas para integración con finanzas y cortes de caja
    registrarVentaFinalPedidoPersonalizado(pedido, metodoPagoFinal);
  }

  pedido.estado = nuevoEstado;
  pedido.historialEstados.push({
    estado: nuevoEstado,
    fecha: new Date().toISOString(),
    nota: `Estado cambiado de ${estadoAnterior} a ${nuevoEstado}`,
  });

  guardarEstadoLocal();
  renderizarModuloPedidos();
  verDetallePedido(pedidoId);
}

function descontarMateriaPrimaPedido(pedido) {
  if (!pedido || pedido.descontadoInventario || !pedido.materiasPrimas || pedido.materiasPrimas.length === 0) {
    return;
  }

  pedido.materiasPrimas.forEach((m) => {
    if (m.esExtra || !m.codigo) return; // Omitir servicios/insumos extras fuera de inventario
    const prod = localDB.productos.find((p) => p.codigo === m.codigo);
    if (prod) {
      // Registrar movimiento de SALIDA de materia prima
      const movimiento = {
        id: `MOV-PED-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        fecha: new Date().toISOString(),
        codigo: m.codigo,
        producto: prod.nombre,
        tipo: TIPOS_MOVIMIENTO.SALIDA,
        cantidad: parseNumber(m.cantidad, 0),
        observaciones: `Uso en Pedido Personalizado ${pedido.folio} (${pedido.cliente ? pedido.cliente.nombre : ""})`,
      };
      localDB.movimientos.push(movimiento);
    }
  });

  pedido.descontadoInventario = true;
}

function registrarAbonoPedido(pedidoId) {
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === pedidoId);
  if (!pedido) return;

  const montoInput = document.getElementById("montoAbonoInput");
  const metodoInput = document.getElementById("metodoAbonoSelect") || document.getElementById("metodoAbonoInput");

  const monto = parseNumber(montoInput ? montoInput.value : 0, 0);
  const metodo = metodoInput ? metodoInput.value : "EFECTIVO";

  const totalPagado = (pedido.pagos || []).reduce(
    (acc, p) => acc + parseNumber(p.monto, 0),
    0,
  );
  const saldoPendiente = Math.max(0, parseNumber(pedido.precioTotal, 0) - totalPagado);

  if (monto <= 0) {
    alert("Por favor ingrese un monto de abono mayor a $0.00.");
    return;
  }

  if (monto > saldoPendiente + 0.01) {
    alert(`El abono ($${monto.toFixed(2)}) no puede exceder el saldo pendiente ($${saldoPendiente.toFixed(2)}).`);
    return;
  }

  const nuevoPago = {
    id: `PAGO-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    fecha: new Date().toISOString(),
    concepto: "Abono Parcial",
    monto,
    metodo,
    ventaId: null,
  };

  pedido.pagos.push(nuevoPago);
  registrarPagoPedidoComoVenta(pedido, nuevoPago);

  guardarEstadoLocal();
  renderizarModuloPedidos();
  verDetallePedido(pedidoId);
  alert(`¡Abono de ${formatMoney(monto)} registrado correctamente!`);
}

function registrarPagoPedidoComoVenta(pedido, pagoObj) {
  if (!pedido || !pagoObj) return;
  const monto = roundTo(parseNumber(pagoObj.monto, 0), 2);
  if (monto <= 0) return;
  if (pagoObj.ventaId) return; // Ya registrado previamente

  const ventaId = `VTA-PED-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const metodo = (pagoObj.metodo || "EFECTIVO").toUpperCase();
  const concepto = pagoObj.concepto || "Pago de Pedido";

  const pagos = {
    efectivo: metodo === "EFECTIVO" ? monto : 0,
    tarjeta: metodo === "TARJETA" ? monto : 0,
    transferencia: metodo === "TRANSFERENCIA" ? monto : 0,
  };

  const fechaPago = pagoObj.fecha || new Date().toISOString();

  const nuevaVenta = {
    id: ventaId,
    fecha: fechaPago,
    items: [
      {
        codigo: pedido.folio || "PEDIDO",
        nombre: `${concepto}: ${pedido.folio} (${pedido.cliente ? pedido.cliente.nombre : "Cliente"})`,
        cantidad: 1,
        precioUnitario: monto,
        subtotal: monto,
        total: monto,
      },
    ],
    total: monto,
    pagos: pagos,
    tipo: "VENTA_PEDIDO_PERSONALIZADO",
    cliente: pedido.cliente ? pedido.cliente.nombre : "",
    folioPedido: pedido.folio,
    conceptoPedido: concepto,
  };

  if (!localDB.ventas) localDB.ventas = [];
  localDB.ventas.push(nuevaVenta);
  pagoObj.ventaId = ventaId;
}

function registrarVentaFinalPedidoPersonalizado(pedido, metodoPagoUltimo) {
  if (!pedido || !pedido.pagos) return;
  (pedido.pagos || []).forEach((pago) => {
    if (!pago.ventaId && parseNumber(pago.monto, 0) > 0) {
      registrarPagoPedidoComoVenta(pedido, pago);
    }
  });
}

function eliminarPedidoPersonalizado(pedidoId) {
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === pedidoId);
  if (!pedido) return;

  if (
    confirm(
      `¿Está seguro de eliminar el pedido personalizado ${pedido.folio}?\nEsta acción no se puede deshacer.`,
    )
  ) {
    localDB.pedidosPersonalizados = localDB.pedidosPersonalizados.filter(
      (p) => p.id !== pedidoId,
    );
    guardarEstadoLocal();
    renderizarModuloPedidos();
  }
}

function imprimirTicketPedidoPersonalizado(pedidoId) {
  const pedido = localDB.pedidosPersonalizados.find((p) => p.id === pedidoId);
  if (!pedido) {
    alert("No se encontró el pedido a imprimir.");
    return;
  }

  const popup = window.open("", "_blank", "width=420,height=680");
  if (!popup) {
    alert("El navegador bloqueó la ventana de impresión. Habilite los popups.");
    return;
  }

  popup.document.open();
  popup.document.write(construirHtmlTicketPedido(pedido));
  popup.document.close();
}

function construirHtmlTicketPedido(pedido) {
  const config = localDB.config || DEFAULT_CONFIG;
  const fecha = formatDate(pedido.fechaCreacion);
  const clienteNombre = pedido.cliente ? pedido.cliente.nombre : "Cliente";
  const clienteTel = pedido.cliente && pedido.cliente.telefono ? pedido.cliente.telefono : "";

  const totalPagado = (pedido.pagos || []).reduce((acc, p) => acc + parseNumber(p.monto, 0), 0);
  const saldoPendiente = Math.max(0, parseNumber(pedido.precioTotal, 0) - totalPagado);

  let rows = "";
  (pedido.materiasPrimas || []).forEach((m) => {
    const pu = parseNumber(m.precioUnitario, 0);
    const sub = roundTo(parseNumber(m.subtotal, m.cantidad * pu), 2);
    rows += `
      <tr>
        <td class="c-cant">${roundTo(m.cantidad, 2)}</td>
        <td class="c-prod">
          ${escapeXml(m.nombre)}
          ${pu > 0 ? `<br><small style="color:#333;">@ ${formatMoney(pu)} c/u</small>` : ""}
        </td>
        <td class="c-sub">${formatMoney(sub)}</td>
      </tr>
    `;
  });

  if (!rows) {
    rows = `
      <tr>
        <td class="c-cant">1</td>
        <td class="c-prod">Pedido Personalizado (${escapeXml(pedido.folio)})</td>
        <td class="c-sub">${formatMoney(pedido.precioTotal)}</td>
      </tr>
    `;
  }

  let pagosRows = "";
  (pedido.pagos || []).forEach((pago) => {
    pagosRows += `
      <div class="totals-row">
        <span>${escapeXml(pago.concepto)} (${escapeXml(pago.metodo || "EFECTIVO")})</span>
        <span>${formatMoney(pago.monto)}</span>
      </div>
    `;
  });

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Nota de Pedido ${pedido.folio}</title>
      <style>
        @page { size: 80mm auto; margin: 0; }
        html, body {
          width: 80mm; margin: 0; padding: 0;
          color: #000; font-family: "Arial", sans-serif;
          font-size: 11px; line-height: 1.2;
        }
        h1, h2, h3, p { margin: 0; }
        .ticket { width: 72mm; margin: 0 auto; padding: 3mm 0; }
        .center { text-align: center; }
        .space { margin-top: 4px; }
        .muted { color: #000; font-size: 10px; }
        .line { border-top: 1px dashed #000; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
        th, td { padding: 2px 0; vertical-align: top; word-wrap: break-word; }
        th { text-align: left; font-weight: 700; }
        .c-cant { width: 10mm; text-align: left; }
        .c-prod { width: 42mm; }
        .c-sub { width: 20mm; text-align: right; }
        .totals { margin-top: 4px; font-size: 11px; }
        .totals-row { display: flex; justify-content: space-between; margin: 2px 0; }
        .total-final { font-size: 12px; font-weight: 700; }
        .strong { font-weight: 700; }
      </style>
    </head>
    <body>
      <div class="ticket">
        <div class="center">
          <h3>${config.businessName || DEFAULT_CONFIG.businessName}</h3>
          <p class="muted">NOTA / TICKET DE PEDIDO</p>
          ${config.businessPhone ? `<p class="muted">TEL: ${config.businessPhone}</p>` : ""}
        </div>

        <div class="line"></div>

        <div class="space">
          <p><span class="strong">FOLIO:</span> ${pedido.folio}</p>
          <p><span class="strong">FECHA REGISTRO:</span> ${fecha}</p>
          ${pedido.fechaEntregaEstimada ? `<p><span class="strong">ENTREGA ESTIMADA:</span> ${formatDate(pedido.fechaEntregaEstimada)}</p>` : ""}
          <p><span class="strong">CLIENTE:</span> ${escapeXml(clienteNombre)}</p>
          ${clienteTel ? `<p><span class="strong">TELÉFONO:</span> ${escapeXml(clienteTel)}</p>` : ""}
          <p><span class="strong">ESTADO:</span> ${pedido.estado}</p>
        </div>

        ${pedido.especificaciones ? `
        <div class="line"></div>
        <p><span class="strong">ESPECIFICACIONES:</span></p>
        <p style="font-size:10px; white-space:pre-wrap;">${escapeXml(pedido.especificaciones)}</p>
        ` : ""}

        <div class="line"></div>

        <table>
          <thead>
            <tr>
              <th class="c-cant">CANT</th>
              <th class="c-prod">CONCEPTO / INSUMO</th>
              <th class="c-sub">SUBTOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="line"></div>

        <div class="totals">
          <div class="totals-row total-final"><span>TOTAL ACORDADO</span><span>${formatMoney(pedido.precioTotal)}</span></div>
          <div class="line"></div>
          <p class="strong" style="margin:2px 0;">PAGOS / ABONOS:</p>
          ${pagosRows || '<div class="totals-row"><span>Anticipo</span><span>$0.00</span></div>'}
          <div class="totals-row"><span>TOTAL PAGADO</span><span>${formatMoney(totalPagado)}</span></div>
          <div class="totals-row total-final"><span>SALDO PENDIENTE</span><span>${formatMoney(saldoPendiente)}</span></div>
        </div>

        <div class="line"></div>
        <p class="center muted">GRACIAS POR SU PREFERENCIA</p>
        ${config.fiscalLegend ? `<p class="center muted">${config.fiscalLegend}</p>` : ""}
        <p class="center muted space">------ FIN DE NOTA ------</p>
      </div>
      <script>window.onload = function(){ window.print(); };</script>
    </body>
    </html>
  `;
}

function generarReportePedidosPersonalizados() {
  const container = document.getElementById("reportePedidosContainer");
  const body = document.getElementById("reportePedidosBody");
  if (!container || !body) return;

  const busqueda = normalizeCode(
    document.getElementById("filtroBusquedaPedido")
      ? document.getElementById("filtroBusquedaPedido").value
      : "",
  );
  const estadoFiltro = document.getElementById("filtroEstadoPedido")
    ? document.getElementById("filtroEstadoPedido").value
    : "TODOS";
  const fechaInicioStr = document.getElementById("filtroFechaInicioPedido")
    ? document.getElementById("filtroFechaInicioPedido").value
    : "";
  const fechaFinStr = document.getElementById("filtroFechaFinPedido")
    ? document.getElementById("filtroFechaFinPedido").value
    : "";

  let lista = [...(localDB.pedidosPersonalizados || [])];

  if (estadoFiltro && estadoFiltro !== "TODOS") {
    if (estadoFiltro === "VENCIDOS") {
      const now = new Date();
      lista = lista.filter((p) => {
        if (p.estado === "TERMINADO" || p.estado === "ENTREGADO") return false;
        if (!p.fechaEntregaEstimada) return false;
        const fechaEntrega = new Date(p.fechaEntregaEstimada);
        return !Number.isNaN(fechaEntrega.getTime()) && fechaEntrega < now;
      });
    } else {
      lista = lista.filter((p) => p.estado === estadoFiltro);
    }
  }
  if (busqueda) {
    lista = lista.filter(
      (p) =>
        normalizeCode(p.folio).includes(busqueda) ||
        normalizeCode(p.cliente && p.cliente.nombre).includes(busqueda) ||
        normalizeCode(p.especificaciones).includes(busqueda),
    );
  }
  if (fechaInicioStr) {
    const fInicio = new Date(fechaInicioStr + "T00:00:00");
    lista = lista.filter((p) => new Date(p.fechaCreacion) >= fInicio);
  }
  if (fechaFinStr) {
    const fFin = new Date(fechaFinStr + "T23:59:59");
    lista = lista.filter((p) => new Date(p.fechaCreacion) <= fFin);
  }

  let totalCotizado = 0;
  let totalAnticiposAbonos = 0;
  let totalSaldosPendientes = 0;
  let totalVentasEntregadas = 0;

  lista.forEach((p) => {
    const precio = parseNumber(p.precioTotal, 0);
    const pagado = (p.pagos || []).reduce(
      (acc, pago) => acc + parseNumber(pago.monto, 0),
      0,
    );
    const saldo = Math.max(0, precio - pagado);

    totalCotizado += precio;
    totalAnticiposAbonos += pagado;
    totalSaldosPendientes += saldo;
    if (p.estado === "ENTREGADO") {
      totalVentasEntregadas += precio;
    }
  });

  body.innerHTML = `
    <div style="margin-bottom:15px;">
      <h4>Reporte Consolidado de Pedidos Personalizados</h4>
      <p style="color:#64748b; margin-top: -5px;">Periodo: ${fechaInicioStr || "Inicio"} a ${fechaFinStr || "Hoy"} | Filtro Estado: ${estadoFiltro}</p>
    </div>
    <div class="stats-grid" style="grid-template-columns: repeat(4, 1fr); margin-bottom:20px;">
      <div style="background:#e0f2fe; padding:12px; border-radius:8px;">
        <span style="font-size:0.85rem; color:#0369a1;">Total Pedidos Filtrados</span>
        <h2 style="margin:5px 0; color:#0284c7;">${lista.length}</h2>
      </div>
      <div style="background:#fef3c7; padding:12px; border-radius:8px;">
        <span style="font-size:0.85rem; color:#b45309;">Total Cotizado ($)</span>
        <h2 style="margin:5px 0; color:#d97706;">${formatMoney(totalCotizado)}</h2>
      </div>
      <div style="background:#dcfce7; padding:12px; border-radius:8px;">
        <span style="font-size:0.85rem; color:#15803d;">Anticipos y Abonos Recibidos ($)</span>
        <h2 style="margin:5px 0; color:#16a34a;">${formatMoney(totalAnticiposAbonos)}</h2>
      </div>
      <div style="background:#fee2e2; padding:12px; border-radius:8px;">
        <span style="font-size:0.85rem; color:#991b1b;">Saldos por Cobrar ($)</span>
        <h2 style="margin:5px 0; color:#dc2626;">${formatMoney(totalSaldosPendientes)}</h2>
      </div>
    </div>

    <div style="text-align:right;">
      <button class="btn btn-secondary btn-sm" onclick="this.parentElement.parentElement.parentElement.style.display='none'">Cerrar Reporte</button>
    </div>
  `;

  container.style.display = "block";
}

document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    const modalEditar = document.getElementById("modalEditarProducto");
    if (modalEditar && modalEditar.classList.contains("open")) {
      cerrarModalEditarProducto();
      return;
    }
    const modalPrecioVariable = document.getElementById(
      "modalPrecioVariableVenta",
    );
    if (modalPrecioVariable && modalPrecioVariable.classList.contains("open")) {
      cancelarModalPrecioVariableVenta();
      return;
    }
    const modalNuevoPed = document.getElementById("modalNuevoPedido");
    if (modalNuevoPed && modalNuevoPed.classList.contains("open")) {
      cerrarModalNuevoPedido();
      return;
    }
    const modalDetallePed = document.getElementById("modalDetallePedido");
    if (modalDetallePed && modalDetallePed.classList.contains("open")) {
      cerrarModalDetallePedido();
      return;
    }
    const modalSuc = document.getElementById("modalSucursal");
    if (modalSuc && modalSuc.classList.contains("open")) {
      cerrarModalSucursal();
      return;
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key === "s") {
    event.preventDefault();

    if (currentTab === "productos") {
      document
        .getElementById("formProducto")
        .dispatchEvent(new Event("submit"));
    }
    if (currentTab === "movimientos") {
      document
        .getElementById("formMovimiento")
        .dispatchEvent(new Event("submit"));
    }
    if (currentTab === "gastos") {
      document.getElementById("formGasto").dispatchEvent(new Event("submit"));
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key === "r") {
    event.preventDefault();

    if (currentTab === "dashboard") {
      loadDashboard();
    }
    if (currentTab === "inventario") {
      mostrarStock();
    }
  }
});

document.addEventListener("click", function (event) {
  if (!event.target.closest(".autocomplete-container")) {
    const dropdownMov = document.getElementById("autocompleteDropdown");
    const dropdownVenta = document.getElementById("autocompleteDropdownVenta");
    if (dropdownMov) dropdownMov.style.display = "none";
    if (dropdownVenta) dropdownVenta.style.display = "none";
  }
});

window.addEventListener("load", () => {
  handleTipoChange();

  ["pagoEfectivo", "pagoTarjeta", "pagoTransferencia"].forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("input", actualizarTotalesPagoVenta);
      input.addEventListener("change", actualizarTotalesPagoVenta);
      input.addEventListener("focus", function () {
        if (parseNumber(this.value, 0) === 0) {
          this.value = "";
        } else {
          this.select();
        }
      });
      input.addEventListener("blur", function () {
        if (this.value.trim() === "") {
          this.value = "0";
          actualizarTotalesPagoVenta();
        }
      });
    }
  });

  ["retirosCorte", "ingresosCajaCorte", "cajaContadaCorte"].forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("input", actualizarResumenCorteActual);
      input.addEventListener("change", actualizarResumenCorteActual);
    }
  });

  renderVentaCarrito();
  renderVentasRecientes();
  renderCarritosPendientes();
  actualizarTotalesPagoVenta();
  actualizarCampoAdelantoPendiente();
  actualizarPrecioVariableProducto();
  actualizarPrecioVariableProductoEdicion();
  cargarModuloCortes();

  const formEditar = document.getElementById("formEditarProducto");
  const cerrarEditarBtn = document.getElementById("cerrarModalEditarBtn");
  const cancelarEditarBtn = document.getElementById("cancelarModalEditarBtn");
  const modalEditar = document.getElementById("modalEditarProducto");

  if (formEditar) {
    formEditar.addEventListener("submit", guardarEdicionProducto);
  }
  if (cerrarEditarBtn) {
    cerrarEditarBtn.addEventListener("click", cerrarModalEditarProducto);
  }
  if (cancelarEditarBtn) {
    cancelarEditarBtn.addEventListener("click", cerrarModalEditarProducto);
  }
  if (modalEditar) {
    modalEditar.addEventListener("click", (event) => {
      if (event.target === modalEditar) {
        cerrarModalEditarProducto();
      }
    });
  }

  const modalSucursal = document.getElementById("modalSucursal");
  if (modalSucursal) {
    modalSucursal.addEventListener("click", (event) => {
      if (event.target === modalSucursal) {
        cerrarModalSucursal();
      }
    });
  }

  const modalPrecioVariable = document.getElementById(
    "modalPrecioVariableVenta",
  );
  const cerrarPrecioVariableBtn = document.getElementById(
    "cerrarModalPrecioVariableVentaBtn",
  );
  const cancelarPrecioVariableBtn = document.getElementById(
    "cancelarModalPrecioVariableVentaBtn",
  );
  const confirmarPrecioVariableBtn = document.getElementById(
    "confirmarModalPrecioVariableVentaBtn",
  );
  const inputPrecioVariable = document.getElementById(
    "precioVariableVentaInput",
  );

  if (cerrarPrecioVariableBtn) {
    cerrarPrecioVariableBtn.addEventListener(
      "click",
      cancelarModalPrecioVariableVenta,
    );
  }
  if (cancelarPrecioVariableBtn) {
    cancelarPrecioVariableBtn.addEventListener(
      "click",
      cancelarModalPrecioVariableVenta,
    );
  }
  if (confirmarPrecioVariableBtn) {
    confirmarPrecioVariableBtn.addEventListener(
      "click",
      confirmarModalPrecioVariableVenta,
    );
  }
  if (inputPrecioVariable) {
    inputPrecioVariable.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmarModalPrecioVariableVenta();
      }
    });
  }
  if (modalPrecioVariable) {
    modalPrecioVariable.addEventListener("click", (event) => {
      if (event.target === modalPrecioVariable) {
        cancelarModalPrecioVariableVenta();
      }
    });
  }
});

// ── Funciones de Gestión de Configuración de Firebase ─────────────────────────
function cargarFormularioConfigFirebase() {
  const config = obtenerConfigFirebaseGuardada();
  if (!config) return;
  const fields = ["fbApiKey", "fbAuthDomain", "fbProjectId", "fbStorageBucket", "fbMessagingSenderId", "fbAppId"];
  const keys = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];

  fields.forEach((fieldId, idx) => {
    const el = document.getElementById(fieldId);
    if (el && config[keys[idx]]) {
      el.value = config[keys[idx]];
    }
  });

  const msg = document.getElementById("msgConfigFirebase");
  if (msg && _dbFirestore) {
    msg.innerHTML = '<span style="color:#10b981; font-weight:600;">✅ Conectado exitosamente a Firebase Cloud Firestore.</span>';
  }
}

function guardarConfiguracionFirebase(event) {
  event.preventDefault();
  const config = {
    apiKey: document.getElementById("fbApiKey")?.value.trim() || "",
    authDomain: document.getElementById("fbAuthDomain")?.value.trim() || "",
    projectId: document.getElementById("fbProjectId")?.value.trim() || "",
    storageBucket: document.getElementById("fbStorageBucket")?.value.trim() || "",
    messagingSenderId: document.getElementById("fbMessagingSenderId")?.value.trim() || "",
    appId: document.getElementById("fbAppId")?.value.trim() || "",
  };

  if (!config.apiKey || !config.projectId || !config.appId) {
    alert("Por favor completa los campos obligatorios: apiKey, projectId y appId.");
    return;
  }

  localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(config));
  const exito = inicializarFirebaseSIEsPosible();
  const msg = document.getElementById("msgConfigFirebase");

  if (exito) {
    if (msg) {
      msg.innerHTML = '<span style="color:#10b981; font-weight:600;">✅ ¡Credenciales guardadas! Conectando y sincronizando con Firestore...</span>';
    }
    iniciarSincronizacionAuto();
    cargarEstadoLocal().then(() => {
      refrescarVistaActual();
    });
  } else {
    if (msg) {
      msg.innerHTML = '<span style="color:#ef4444; font-weight:600;">❌ Error al conectar a Firebase. Revisa los datos ingresados.</span>';
    }
  }
}

function desconectarFirebase() {
  if (!confirm("¿Seguro que deseas desconectar Firebase y volver al modo local?")) return;
  localStorage.removeItem(FIREBASE_CONFIG_KEY);
  if (_unsubscribeFirestore) {
    _unsubscribeFirestore();
    _unsubscribeFirestore = null;
  }
  _dbFirestore = null;

  const fields = ["fbApiKey", "fbAuthDomain", "fbProjectId", "fbStorageBucket", "fbMessagingSenderId", "fbAppId"];
  fields.forEach((fieldId) => {
    const el = document.getElementById(fieldId);
    if (el) el.value = "";
  });

  const msg = document.getElementById("msgConfigFirebase");
  if (msg) {
    msg.innerHTML = '<span style="color:#eab308; font-weight:600;">⚠️ Firebase desconectado. Usando modo de red local / localStorage.</span>';
  }
  iniciarSincronizacionAuto();
}

// ── GESTIÓN DE SEGURIDAD Y CAMBIO DE CONTRASEÑA ──────────────────────────────

function abrirModalCambiarPassword() {
  const modal = document.getElementById("modalCambiarPassword");
  if (!modal) return;
  const user = (typeof firebase !== "undefined" && firebase.auth) ? firebase.auth().currentUser : null;
  const modalCuentaEl = document.getElementById("lblModalUsuarioEmail");
  if (modalCuentaEl && user) modalCuentaEl.textContent = user.email || "";

  const form = document.getElementById("formModalCambiarPassword");
  if (form) form.reset();
  const msg = document.getElementById("modalMsgPassword");
  if (msg) msg.innerHTML = "";

  modal.classList.add("active");
  modal.classList.add("open");
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  document.getElementById("modalPassActual")?.focus();
}

function cerrarModalCambiarPassword() {
  const modal = document.getElementById("modalCambiarPassword");
  if (!modal) return;
  modal.classList.remove("active");
  modal.classList.remove("open");
  modal.style.display = "none";
  modal.setAttribute("aria-hidden", "true");
}

async function procesarCambioPassword({ passActual, passNueva, passConfirmar, btnSubmit, msgEl, onSuccess }) {
  if (!passActual || !passNueva || !passConfirmar) {
    if (msgEl) msgEl.innerHTML = '<span style="color:#ef4444; font-weight:600;">⚠️ Todos los campos son obligatorios.</span>';
    return;
  }
  if (passNueva.length < 6) {
    if (msgEl) msgEl.innerHTML = '<span style="color:#ef4444; font-weight:600;">⚠️ La nueva contraseña debe tener al menos 6 caracteres.</span>';
    return;
  }
  if (passNueva !== passConfirmar) {
    if (msgEl) msgEl.innerHTML = '<span style="color:#ef4444; font-weight:600;">⚠️ Las nuevas contraseñas no coinciden.</span>';
    return;
  }
  if (passActual === passNueva) {
    if (msgEl) msgEl.innerHTML = '<span style="color:#ef4444; font-weight:600;">⚠️ La nueva contraseña no puede ser igual a la actual.</span>';
    return;
  }

  if (typeof firebase === "undefined" || !firebase.auth) {
    if (msgEl) msgEl.innerHTML = '<span style="color:#ef4444; font-weight:600;">❌ Firebase no está disponible.</span>';
    return;
  }

  const user = firebase.auth().currentUser;
  if (!user || !user.email) {
    if (msgEl) msgEl.innerHTML = '<span style="color:#ef4444; font-weight:600;">❌ No hay un usuario autenticado activo.</span>';
    return;
  }

  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.innerText = "Actualizando...";
  }
  if (msgEl) {
    msgEl.innerHTML = '<span style="color:#0284c7; font-weight:600;">⏳ Verificando credenciales y actualizando contraseña...</span>';
  }

  try {
    // 1. Reautenticar con la contraseña actual
    const credencial = firebase.auth.EmailAuthProvider.credential(user.email, passActual);
    await user.reauthenticateWithCredential(credencial);

    // 2. Actualizar contraseña
    await user.updatePassword(passNueva);

    if (msgEl) {
      msgEl.innerHTML = '<span style="color:#10b981; font-weight:600;">✅ ¡Contraseña actualizada exitosamente!</span>';
    }
    if (typeof onSuccess === "function") {
      onSuccess();
    }
  } catch (error) {
    console.error("Error al cambiar contraseña:", error);
    let textoError = "❌ No se pudo actualizar la contraseña.";
    switch (error.code) {
      case "auth/wrong-password":
      case "auth/invalid-credential":
        textoError = "❌ La contraseña actual ingresada es incorrecta.";
        break;
      case "auth/weak-password":
        textoError = "⚠️ La nueva contraseña es muy débil (mínimo 6 caracteres).";
        break;
      case "auth/requires-recent-login":
        textoError = "⚠️ Por seguridad, debes cerrar sesión e iniciar nuevamente para cambiar tu contraseña.";
        break;
      case "auth/too-many-requests":
        textoError = "⚠️ Demasiados intentos fallidos. Intenta más tarde.";
        break;
      case "auth/network-request-failed":
        textoError = "🌐 Error de conexión. Revisa tu conexión a internet.";
        break;
      default:
        textoError = `❌ ${error.message || "Error al actualizar contraseña."}`;
    }
    if (msgEl) {
      msgEl.innerHTML = `<span style="color:#ef4444; font-weight:600;">${textoError}</span>`;
    }
  } finally {
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.innerText = btnSubmit.dataset.originalText || "Actualizar Contraseña";
    }
  }
}

async function cambiarPasswordUsuario(event) {
  event.preventDefault();
  const passActual = document.getElementById("passActualConfig")?.value || "";
  const passNueva = document.getElementById("passNuevaConfig")?.value || "";
  const passConfirmar = document.getElementById("passConfirmarConfig")?.value || "";
  const btnSubmit = document.getElementById("btnGuardarPassConfig");
  const msgEl = document.getElementById("msgConfigPassword");

  if (btnSubmit && !btnSubmit.dataset.originalText) {
    btnSubmit.dataset.originalText = btnSubmit.innerText;
  }

  await procesarCambioPassword({
    passActual,
    passNueva,
    passConfirmar,
    btnSubmit,
    msgEl,
    onSuccess: () => {
      document.getElementById("formCambiarPasswordConfig")?.reset();
    }
  });
}

async function cambiarPasswordUsuarioModal(event) {
  event.preventDefault();
  const passActual = document.getElementById("modalPassActual")?.value || "";
  const passNueva = document.getElementById("modalPassNueva")?.value || "";
  const passConfirmar = document.getElementById("modalPassConfirmar")?.value || "";
  const btnSubmit = document.getElementById("btnModalGuardarPass");
  const msgEl = document.getElementById("modalMsgPassword");

  if (btnSubmit && !btnSubmit.dataset.originalText) {
    btnSubmit.dataset.originalText = btnSubmit.innerText;
  }

  await procesarCambioPassword({
    passActual,
    passNueva,
    passConfirmar,
    btnSubmit,
    msgEl,
    onSuccess: () => {
      document.getElementById("formModalCambiarPassword")?.reset();
      setTimeout(() => {
        cerrarModalCambiarPassword();
      }, 1500);
    }
  });
}

async function enviarEmailRestablecimientoDesdeSistema() {
  if (typeof firebase === "undefined" || !firebase.auth) {
    alert("Firebase no está disponible.");
    return;
  }
  const user = firebase.auth().currentUser;
  if (!user || !user.email) {
    alert("No hay un usuario autenticado activo.");
    return;
  }

  const confirmar = confirm(`¿Deseas enviar un correo de restablecimiento de contraseña a ${user.email}?`);
  if (!confirmar) return;

  try {
    await firebase.auth().sendPasswordResetEmail(user.email);
    alert(`📧 Se ha enviado un enlace para restablecer tu contraseña al correo ${user.email}.\nRevisa tu bandeja de entrada o carpeta de spam.`);
  } catch (error) {
    console.error("Error al enviar email de restablecimiento:", error);
    alert(`❌ No se pudo enviar el correo: ${error.message}`);
  }
}

// ── Control de Navegación por Pestañas (Tabs) y Menú Lateral Móvil ─────────────

function toggleSidebar(force) {
  const sidebar = document.querySelector(".sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (!sidebar) return;

  const isOpen = typeof force === "boolean" ? force : !sidebar.classList.contains("open");

  if (isOpen) {
    sidebar.classList.add("open");
    if (overlay) overlay.classList.add("active");
  } else {
    sidebar.classList.remove("open");
    if (overlay) overlay.classList.remove("active");
  }
}

function showTab(tabId) {
  currentTab = tabId;
  const tabs = document.querySelectorAll(".tab-content");
  tabs.forEach((tab) => tab.classList.remove("active"));

  const targetTab = document.getElementById(tabId);
  if (targetTab) targetTab.classList.add("active");

  const navLinks = document.querySelectorAll(".nav-link");
  navLinks.forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("onclick") && link.getAttribute("onclick").includes(`'${tabId}'`)) {
      link.classList.add("active");
    }
  });

  // Si estamos en vista móvil (<= 768px), cerrar automáticamente el sidebar al cambiar de pestaña
  if (window.innerWidth <= 768) {
    toggleSidebar(false);
  }

  // Refrescar vistas pertinentes
  if (tabId === "dashboard") loadDashboard();
  if (tabId === "inventario") mostrarStock();
  if (tabId === "ventas") {
    renderVentaCarrito();
    renderVentasRecientes();
    renderCarritosPendientes();
    actualizarTotalesPagoVenta();
  }
  if (tabId === "pedidos") renderizarModuloPedidos();
  if (tabId === "gastos") renderGastosRecientes();
  if (tabId === "cortes") cargarModuloCortes();
  if (tabId === "configuracion") {
    cargarConfiguracionSistema();
    cargarFormularioConfigFirebase();
    const inputDispositivo = document.getElementById("inputNombreDispositivo");
    if (inputDispositivo) inputDispositivo.value = obtenerNombreDispositivoLocal();
  }

  // 🎯 Auto-focus al input principal del módulo seleccionado
  setTimeout(() => {
    const inputFocusMap = {
      ventas: "codigoVenta",
      productos: "codigoProd",
      movimientos: "codigoMov",
      gastos: "conceptoGasto",
      inventario: "buscarInventarioTexto",
      pedidos: "filtroBusquedaPedido",
      reportes: "fechaDesde",
      cortes: document.getElementById("cajaContadaCorte") && !document.getElementById("cajaContadaCorte").disabled ? "cajaContadaCorte" : "cajaInicialCorte",
      configuracion: "businessNameConfig"
    };

    const targetInputId = inputFocusMap[tabId];
    if (targetInputId) {
      const el = document.getElementById(targetInputId);
      if (el && typeof el.focus === "function") {
        el.focus();
        if (typeof el.select === "function" && el.value) {
          el.select();
        }
      }
    }
  }, 100);
}

document.addEventListener("DOMContentLoaded", initializeApp);


