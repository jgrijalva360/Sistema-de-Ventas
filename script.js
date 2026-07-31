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

const localDB = {
  productos: [],
  movimientos: [],
  ventas: [],
  gastos: [],
  cortes: [],
  corteActivo: null,
  carritosPendientes: [],
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

function initializeApp() {
  cargarEstadoLocal();
  setDefaultDates();
  loadListas();
  cargarConfiguracionSistema();
  loadDashboard();
  showTab("dashboard");
}

function guardarEstadoLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(localDB));
  } catch (error) {
    console.error("No se pudo guardar en localStorage:", error);
  }
}

function cargarEstadoLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    if (!validarEstructuraEstado(data)) return;

    localDB.productos = Array.isArray(data.productos) ? data.productos : [];
    localDB.movimientos = Array.isArray(data.movimientos)
      ? data.movimientos
      : [];
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
    if (migrado) {
      guardarEstadoLocal();
    }
    localDB.corteActivo =
      data.corteActivo && typeof data.corteActivo === "object"
        ? data.corteActivo
        : null;
    localDB.carritosPendientes = Array.isArray(data.carritosPendientes)
      ? data.carritosPendientes
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
  } catch (error) {
    console.error("No se pudo cargar estado local:", error);
  }
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
  const nombre = document.getElementById("nombreProd")
    ? document.getElementById("nombreProd").value
    : "";
  const base = slugifyCode(nombre)
    .split("-")
    .filter(Boolean)
    .slice(0, 3)
    .map((parte) => parte.slice(0, 3))
    .join("");
  const fecha = new Date();
  const stamp = `${String(fecha.getHours()).padStart(2, "0")}${String(fecha.getMinutes()).padStart(2, "0")}`;
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  const prefijo = (base || "PRO").slice(0, 3);

  let codigo = `B${prefijo}${stamp}${random}`.slice(0, 12);
  const existentes = new Set(
    localDB.productos.map((p) => normalizeCode(p.codigo)),
  );
  while (existentes.has(normalizeCode(codigo))) {
    codigo =
      `B${prefijo}${stamp}${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(
        0,
        12,
      );
  }

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

function construirSvgCode39(codigo) {
  const { texto, body, widthTotal } = construirCode39Data(codigo);
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${widthTotal}" height="140" viewBox="0 0 ${widthTotal} 140">
      <rect width="100%" height="100%" fill="#fff" />
      ${body}
      <text x="${widthTotal / 2}" y="126" text-anchor="middle" font-family="Arial, sans-serif" font-size="25px" fill="#111">${texto}</text>
    </svg>
  `;
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
  return `${day}/${month}/${year}`;
}

function setDefaultDates() {
  const today = new Date();
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  document.getElementById("fechaMov").valueAsDate = today;
  const fechaGasto = document.getElementById("fechaGasto");
  if (fechaGasto) fechaGasto.valueAsDate = today;
  document.getElementById("fechaDesde").valueAsDate = monthAgo;
  document.getElementById("fechaHasta").valueAsDate = today;

  const fechaDesdeVentas = document.getElementById("fechaDesdeVentas");
  const fechaHastaVentas = document.getElementById("fechaHastaVentas");
  if (fechaDesdeVentas) fechaDesdeVentas.valueAsDate = monthAgo;
  if (fechaHastaVentas) fechaHastaVentas.valueAsDate = today;

  const fechaDesdeGastos = document.getElementById("fechaDesdeGastos");
  const fechaHastaGastos = document.getElementById("fechaHastaGastos");
  if (fechaDesdeGastos) fechaDesdeGastos.valueAsDate = monthAgo;
  if (fechaHastaGastos) fechaHastaGastos.valueAsDate = today;

  const fechaDesdeCorte = document.getElementById("fechaDesdeCorte");
  const fechaHastaCorte = document.getElementById("fechaHastaCorte");
  if (fechaDesdeCorte) fechaDesdeCorte.valueAsDate = monthAgo;
  if (fechaHastaCorte) fechaHastaCorte.valueAsDate = today;
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
}

function calcularStock(codigo) {
  const codigoNormalizado = normalizeCode(codigo);
  let cantidad = 0;

  localDB.movimientos.forEach((mov) => {
    if (normalizeCode(mov.codigo) !== codigoNormalizado) return;
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

function obtenerStock() {
  return localDB.productos
    .map((p) => {
      const costoPromedioPieza = calcularCostoPromedioPorPieza(p.codigo);
      const precioVenta = Math.max(0, parseNumber(p.precioVenta, 0));
      return {
        codigo: p.codigo,
        nombre: p.nombre,
        stockMin: p.stockMin,
        cantidad: calcularStock(p.codigo),
        costoPromedioPieza,
        precioVenta,
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
  const corteActivo = obtenerCorteActivo();
  if (corteActivo) {
    const resumen = obtenerResumenFinancieroEnRango(corteActivo.fechaApertura, new Date().toISOString());
    const cajaEstimada = roundTo(parseNumber(corteActivo.cajaInicial, 0) + resumen.pagosEfectivo - resumen.totalGastos, 2);
    return {
      valor: cajaEstimada,
      estado: "ABIERTO",
      label: `Caja inicial: ${formatMoney(corteActivo.cajaInicial)}`
    };
  } else {
    const cortesOrdenados = (localDB.cortes || [])
      .filter(c => c.estado === "CERRADO" && c.fechaCierre)
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
    
    const resumen = obtenerResumenFinancieroEnRango(fechaInicioIso, new Date().toISOString());
    const cajaEstimada = roundTo(baseCash + resumen.pagosEfectivo - resumen.totalGastos, 2);
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

  let sinStock = 0;
  let stockBajo = 0;
  let valorTotalInventario = 0;
  let movimientosUltimoMes = 0;

  stock.forEach((item) => {
    if (item.cantidad <= 0) {
      sinStock += 1;
    } else if (item.cantidad <= item.stockMin && item.stockMin > 0) {
      stockBajo += 1;
    }
    valorTotalInventario += item.cantidad;
  });

  localDB.movimientos.forEach((mov) => {
    const fecha = new Date(mov.fecha);
    if (!Number.isNaN(fecha.getTime()) && fecha >= mesAtras) {
      movimientosUltimoMes += 1;
    }
  });

  const ventasUltimoMes = localDB.ventas.filter((venta) => {
    const fechaVenta = new Date(venta.fecha);
    return !Number.isNaN(fechaVenta.getTime()) && fechaVenta >= mesAtras;
  }).length;

  const resumenPagos = acumularPagosNetos(localDB.ventas);
  const totalVentas =
    resumenPagos.efectivo + resumenPagos.tarjeta + resumenPagos.transferencia;
  const totalGastos = localDB.gastos.reduce((acumulado, gasto) => {
    return acumulado + parseNumber(gasto.monto, 0);
  }, 0);

  return {
    totalProductos: localDB.productos.length,
    totalMovimientos: localDB.movimientos.length,
    totalVentas: roundTo(totalVentas, 2),
    cantidadVentas: localDB.ventas.length,
    totalGastos: roundTo(totalGastos, 2),
    sinStock,
    stockBajo,
    valorTotalInventario: Math.round(valorTotalInventario * 100) / 100,
    movimientosUltimoMes,
    ventasUltimoMes,
    pagosEfectivo: roundTo(resumenPagos.efectivo, 2),
    pagosTarjeta: roundTo(resumenPagos.tarjeta, 2),
    pagosTransferencia: roundTo(resumenPagos.transferencia, 2),
    dineroEnCaja: obtenerDetalleCajaDashboard().valor,
    cajaEstadoLabel: `${obtenerDetalleCajaDashboard().estado} (${obtenerDetalleCajaDashboard().label})`,
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
    stockMin: Math.max(0, parseInt(producto.stockMin, 10) || 0),
    margen: roundTo(margen, 2),
    precioVenta: roundTo(precioVenta, 2),
    precioVariable,
    fechaCreacion: new Date().toISOString(),
  });

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
  stockMinField.value = Math.max(0, parseInt(producto.stockMin, 10) || 0);
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
  producto.stockMin = nuevoStockMin;
  producto.precioVenta = roundTo(nuevoPrecioVenta, 2);
  producto.precioVariable = precioVariable;

  guardarEstadoLocal();
  loadDashboard();
  mostrarStock();

  const textoBusqueda = document.getElementById("buscarTexto");
  if (textoBusqueda && textoBusqueda.value.trim().length >= 2) {
    displaySearchResults(buscarProductoLocal(textoBusqueda.value.trim()));
  }

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

  const stockActual = calcularStock(codigo);
  if (
    (tipo === TIPOS_MOVIMIENTO.SALIDA ||
      tipo === TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO) &&
    stockActual < cantidadProcesada
  ) {
    return `Stock insuficiente. Disponible: ${stockActual}, Solicitado: ${cantidadProcesada}`;
  }

  const fechaMovimiento = new Date(`${mov.fecha}T12:00:00`);
  localDB.movimientos.push({
    codigo,
    fecha: fechaMovimiento.toISOString(),
    tipo,
    cantidad: roundTo(cantidadProcesada, 4),
    usuario: "Local",
    timestamp: new Date().toISOString(),
    observaciones: mov.observaciones || "",
  });

  guardarEstadoLocal();

  return "Movimiento registrado correctamente.";
}

function registrarGastoLocal(gasto) {
  const now = new Date();
  const fecha = gasto.fecha
    ? new Date(`${gasto.fecha}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`)
    : now;
  const concepto = (gasto.concepto || "").toString().trim();
  const categoria = (gasto.categoria || "General").toString().trim();
  const monto = parseNumber(gasto.monto, 0);

  if (
    !concepto ||
    concepto.length < 2 ||
    Number.isNaN(fecha.getTime()) ||
    monto <= 0
  ) {
    return "Datos del gasto incompletos.";
  }

  localDB.gastos.push({
    id: `G-${Date.now()}`,
    fecha: fecha.toISOString(),
    concepto,
    categoria: categoria || "General",
    monto: roundTo(monto, 2),
    usuario: "Local",
    timestamp: new Date().toISOString(),
    observaciones: gasto.observaciones || "",
  });

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
  sonidoAgregarCarrito.play().catch(() => {});
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

  carritoVenta.forEach((item) => {
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
      return;
    }
  }

  const ventaId = `V-${Date.now()}`;
  const timestamp = new Date().toISOString();

  carritoVenta.forEach((item) => {
    localDB.movimientos.push({
      codigo: normalizeCode(item.codigo),
      fecha: timestamp,
      tipo: TIPOS_MOVIMIENTO.SALIDA,
      cantidad: roundTo(item.cantidad, 4),
      usuario: "Local",
      timestamp,
      observaciones: `Venta ${ventaId}`,
      cantidadCompra: 0,
      unidadCompra: "PIEZA",
      piezasPorPresentacion: 1,
      costoCompra: 0,
      costoPorPieza: 0,
    });
  });

  localDB.ventas.push({
    id: ventaId,
    fecha: timestamp,
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
  });

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

  const autoImprimir = document.getElementById("autoImprimirVenta");
  if (autoImprimir && autoImprimir.checked) {
    imprimirVentaPorId(ventaId);
  }
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
        <table>
          <thead>
            <tr>
              <th>Folio</th>
              <th>Fecha</th>
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
              <th>Categoria</th>
              <th>Concepto</th>
              <th>Monto</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
      `;

  recientes.forEach((gasto) => {
    html += `
          <tr>
            <td>${gasto.id}</td>
            <td>${formatDate(gasto.fecha)}</td>
            <td>${gasto.categoria || "General"}</td>
            <td>${gasto.concepto || "-"}</td>
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
    rows += `
          <tr>
            <td class="c-cant">${roundTo(item.cantidad, 2)}</td>
            <td class="c-prod">${item.nombre}</td>
            <td class="c-sub">${formatMoney(item.subtotal)}</td>
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
              color: #111;
              font-family: "Courier New", monospace;
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
            .muted { color: #444; font-size: 10px; }
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
              <p><span class="strong">FECHA:</span> ${fecha} ${hora}</p>
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
        stockMin: p.stockMin,
        stockActual: calcularStock(p.codigo),
        costoPromedioPieza,
        precioVenta,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

function obtenerListas() {
  return {
    unidades: [...localDB.listas.unidades].sort(),
    grupos: [...localDB.listas.grupos].sort(),
  };
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
      Number.isNaN(parseInt(p.stockMin, 10)) ||
      parseInt(p.stockMin, 10) < 0
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

function exportarStockCSVLocal() {
  const stock = obtenerStock();
  if (!stock.length) return null;

  let csv =
    "Codigo,Nombre,Stock Minimo,Stock Actual,Precio Real/Venta,Estado,Diferencia\n";
  stock.forEach((producto) => {
    let estado = "Normal";
    let diferencia = 0;

    if (producto.cantidad <= 0) {
      estado = "Sin Stock";
      diferencia = -producto.stockMin;
    } else if (
      producto.cantidad <= producto.stockMin &&
      producto.stockMin > 0
    ) {
      estado = "Stock Bajo";
      diferencia = -(producto.stockMin - producto.cantidad);
    } else {
      diferencia = producto.cantidad - producto.stockMin;
    }

    csv += `"${producto.codigo}","${producto.nombre}",${producto.stockMin},${producto.cantidad},${roundTo(producto.precioVenta || 0, 4)},"${estado}","${diferencia}"\n`;
  });

  return csv;
}

function exportarEstadoLocal() {
  return JSON.stringify(localDB, null, 2);
}

function loadDashboard() {
  const data = obtenerResumen();
  const statsGrid = document.getElementById("statsGrid");
  statsGrid.innerHTML = `
        <section class="stats-section">
          <div class="stats-section-header">
            <h3>Ventas y Caja</h3>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--cash">
              <div class="stat-kicker">PAGO</div>
              <div class="stat-value">${formatMoney(data.pagosEfectivo)}</div>
              <div class="stat-label">Pagos en Efectivo</div>
            </div>
            <div class="stat-card stat-card--card-payment">
              <div class="stat-kicker">Pago</div>
              <div class="stat-value">${formatMoney(data.pagosTarjeta)}</div>
              <div class="stat-label">Pagos con Tarjeta</div>
            </div>
            <div class="stat-card stat-card--transfer-payment">
              <div class="stat-kicker">Pago</div>
              <div class="stat-value">${formatMoney(data.pagosTransferencia)}</div>
              <div class="stat-label">Pagos por Transferencia</div>
            </div>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--sales">
              <div class="stat-kicker">Ingresos</div>
              <div class="stat-value">${formatMoney(data.totalVentas)}</div>
              <div class="stat-label">Total Ventas</div>
            </div>
            <div class="stat-card stat-card--expense">
              <div class="stat-kicker">Salidas</div>
              <div class="stat-value">${formatMoney(data.totalGastos)}</div>
              <div class="stat-label">Total Gastos</div>
            </div>
            <div class="stat-card stat-card--cash">
              <div class="stat-kicker">Caja actual</div>
              <div class="stat-value">${formatMoney(data.dineroEnCaja)}</div>
              <div class="stat-label">${data.cajaEstadoLabel}</div>
            </div>
          </div>
          <div class="stats-row">
            <div class="stat-card stat-card--neutral">
              <div class="stat-kicker">Actividad</div>
              <div class="stat-value">${data.cantidadVentas}</div>
              <div class="stat-label">Cantidad de Ventas</div>
            </div>
            <div class="stat-card stat-card--neutral">
              <div class="stat-kicker">Tendencia</div>
              <div class="stat-value">${data.ventasUltimoMes}</div>
              <div class="stat-label">Ventas Ultimo Mes</div>
            </div>
            <div class="stat-card stat-card--neutral">
              <div class="stat-kicker">Flujo</div>
              <div class="stat-value">${formatMoney(data.pagosTarjeta + data.pagosTransferencia)}</div>
              <div class="stat-label">Total Cobros Bancarios</div>
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

  const producto = {
    codigo: document.getElementById("codigoProd").value.trim().toUpperCase(),
    nombre: document.getElementById("nombreProd").value.trim(),
    stockMin: parseInt(document.getElementById("stockMinProd").value, 10) || 0,
    margen: parseFloat(document.getElementById("margenProd").value) || 0,
    precioVenta:
      parseFloat(document.getElementById("precioVentaProd").value) || 0,
    precioVariable,
  };

  const mensaje = registrarProductoLocal(producto);
  const ok = mensaje.includes("correctamente");
  showMessage("msgProd", mensaje, ok ? "success" : "error");

  if (ok) {
    document.getElementById("formProducto").reset();
    document.getElementById("stockMinProd").value = "0";
    document.getElementById("margenProd").value = "30";
    document.getElementById("precioVentaProd").value = "";
    actualizarPrecioVariableProducto();
    loadDashboard();
  }
}

function registrarMovimiento(event) {
  event.preventDefault();

  const movimiento = {
    codigo: document.getElementById("codigoMov").value.trim().toUpperCase(),
    fecha: document.getElementById("fechaMov").value,
    tipo: document.getElementById("tipoMov").value,
    cantidad: parseFloat(document.getElementById("cantMov").value) || 0,
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
    monto: parseFloat(document.getElementById("montoGasto").value) || 0,
    observaciones: document.getElementById("obsGasto").value.trim(),
  };

  const mensaje = registrarGastoLocal(gasto);
  const ok = mensaje.includes("correctamente");
  showMessage("msgGasto", mensaje, ok ? "success" : "error");

  if (ok) {
    document.getElementById("formGasto").reset();
    document.getElementById("fechaGasto").valueAsDate = new Date();
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

function actualizarVistaCostoPorPieza() {
  return;
}

function buscarProducto() {
  const texto = document.getElementById("buscarTexto").value.trim();
  if (!texto) {
    showMessage(
      "resultadosBusqueda",
      "Ingrese un texto para buscar",
      "warning",
    );
    return;
  }

  const data = buscarProductoLocal(texto);
  displaySearchResults(data);
}

function buscarEnTiempoReal() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const texto = document.getElementById("buscarTexto").value.trim();
    if (texto.length >= 2) {
      buscarProducto();
    } else if (texto.length === 0) {
      document.getElementById("resultadosBusqueda").innerHTML = "";
    }
  }, 300);
}

function displaySearchResults(data) {
  const container = document.getElementById("resultadosBusqueda");

  if (data.length === 0) {
    container.innerHTML =
      '<div class="message warning">No se encontraron productos</div>';
    return;
  }

  let html = `
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Nombre</th>
              <th>Stock Min.</th>
              <th>Stock Actual</th>
              <th>Precio Real/Venta</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
      `;

  data.forEach((producto) => {
    const { codigo, nombre, stockMin, stockActual, precioVenta } = producto;
    let statusClass = "status-normal";
    let estado = "Normal";

    if (stockActual <= 0) {
      statusClass = "status-zero";
      estado = "Sin Stock";
    } else if (stockActual <= stockMin && stockMin > 0) {
      statusClass = "status-low";
      estado = "Stock Bajo";
    }

    html += `
          <tr class="${statusClass}">
            <td>${codigo}</td>
            <td>${nombre}</td>
            <td>${stockMin}</td>
            <td>${stockActual}</td>
            <td>${producto.precioVariable ? "Variable" : precioVenta > 0 ? formatMoney(precioVenta) : "N/D"}</td>
            <td>${estado}</td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function mostrarStock() {
  const loading = document.getElementById("loading");
  const container = document.getElementById("stockTable");

  loading.style.display = "block";
  const data = obtenerStock();
  loading.style.display = "none";
  displayStockTable(data, container);
}

function displayStockTable(data, container) {
  if (data.length === 0) {
    container.innerHTML =
      '<div class="message warning">No hay productos registrados</div>';
    return;
  }

  let html = `
        <table>
          <thead>
            <tr>
              <th>Codigo</th>
              <th>Nombre</th>
              <th>Stock Min.</th>
              <th>Stock Actual</th>
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
      producto.cantidad <= producto.stockMin &&
      producto.stockMin > 0
    ) {
      statusClass = "status-low";
      estado = "Stock Bajo";
    }

    html += `
          <tr class="${statusClass}">
            <td><button type="button" class="barcode-code-btn" onclick="imprimirCodigoProducto('${producto.codigo}', '${(producto.nombre || "").replace(/'/g, "\\'")}')">${producto.codigo}</button></td>
            <td>${producto.nombre}</td>
            <td>${producto.stockMin}</td>
            <td>${producto.cantidad}</td>
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

  loading.style.display = "block";
  const data = obtenerStock();
  loading.style.display = "none";

  const alertProducts = data.filter(
    (p) => p.cantidad <= 0 || (p.cantidad <= p.stockMin && p.stockMin > 0),
  );
  if (alertProducts.length === 0) {
    container.innerHTML =
      '<div class="message success">No hay productos con alertas de stock</div>';
    return;
  }
  displayStockTable(alertProducts, container);
}

function showStockAlerts() {
  const data = obtenerStock();
  const alertProducts = data.filter(
    (p) => p.cantidad <= 0 || (p.cantidad <= p.stockMin && p.stockMin > 0),
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
            <td>${p.stockMin}</td>
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
      return fecha >= desde && fecha <= hasta;
    })
    .flatMap((venta) => {
      const items = Array.isArray(venta.items) ? venta.items : [];
      const efectivo = parseNumber(venta.pagos && venta.pagos.efectivo, 0);
      const tarjeta = parseNumber(venta.pagos && venta.pagos.tarjeta, 0);
      const transferencia = parseNumber(
        venta.pagos && venta.pagos.transferencia,
        0,
      );
      const total = parseNumber(venta.total, 0);
      const cambio = parseNumber(venta.cambio, 0);

      if (!items.length) {
        return [
          {
            id: venta.id || "SIN-FOLIO",
            fecha: venta.fecha,
            fechaTexto: formatDate(venta.fecha),
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

function mostrarReporteVentas() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeVentas").value,
    fechaHasta: document.getElementById("fechaHastaVentas").value,
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "reporteVentasTable",
      "Seleccione las fechas para el reporte de ventas.",
      "warning",
    );
    return;
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
  const totalVentas = roundTo(
    data.reduce((acc, row) => acc + parseNumber(row.importeLinea, 0), 0),
    2,
  );

  let html = `
        <div class="message success">Se encontraron ${foliosUnicos} venta(s) y ${data.length} linea(s) de producto. Importe total: ${formatMoney(totalVentas)}</div>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Folio</th>
              <th>Codigo</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Precio Unitario</th>
              <th>Importe Total</th>
              <th>Efectivo</th>
              <th>Tarjeta</th>
              <th>Transferencia</th>
            </tr>
          </thead>
          <tbody>
      `;

  data.forEach((row) => {
    html += `
          <tr>
            <td>${row.fechaTexto}</td>
            <td>${row.id}</td>
            <td>${row.codigoProducto}</td>
            <td>${row.nombreProducto}</td>
            <td>${row.cantidad}</td>
            <td>${formatMoney(row.precioUnitario)}</td>
            <td>${formatMoney(row.importeLinea)}</td>
            <td>${formatMoney(row.efectivo)}</td>
            <td>${formatMoney(row.tarjeta)}</td>
            <td>${formatMoney(row.transferencia)}</td>
          </tr>
        `;
  });

  html += "</tbody></table>";
  container.innerHTML = html;
}

function exportarReporteVentas() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeVentas").value,
    fechaHasta: document.getElementById("fechaHastaVentas").value,
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

  let csv =
    "Fecha,Folio,Codigo,Producto,Cantidad,Precio Unitario,Importe Total,Importe Venta,Efectivo,Tarjeta,Transferencia,Cambio\n";
  data.forEach((row) => {
    csv += `"${row.fechaTexto}","${row.id}","${row.codigoProducto}","${row.nombreProducto}","${row.cantidad}","${row.precioUnitario}","${row.importeLinea}","${row.importeVenta}","${row.efectivo}","${row.tarjeta}","${row.transferencia}","${row.cambio}"\n`;
  });

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
      return fecha >= desde && fecha <= hasta;
    })
    .map((gasto) => ({
      id: gasto.id || "SIN-FOLIO",
      fecha: gasto.fecha,
      fechaTexto: formatDate(gasto.fecha),
      categoria: gasto.categoria || "General",
      concepto: gasto.concepto || "Sin concepto",
      monto: roundTo(parseNumber(gasto.monto, 0), 2),
      observaciones: gasto.observaciones || "",
    }))
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function mostrarReporteGastos() {
  const filtros = {
    fechaDesde: document.getElementById("fechaDesdeGastos").value,
    fechaHasta: document.getElementById("fechaHastaGastos").value,
  };

  if (!filtros.fechaDesde || !filtros.fechaHasta) {
    showMessage(
      "reporteGastosTable",
      "Seleccione las fechas para el reporte de gastos.",
      "warning",
    );
    return;
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
              <th>Categoría</th>
              <th>Concepto</th>
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
            <td>${row.categoria}</td>
            <td>${row.concepto}</td>
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

  let csv = "Fecha,Folio,Categoria,Concepto,Monto,Observaciones\n";
  data.forEach((row) => {
    csv += `"${row.fechaTexto}","${row.id}","${row.categoria}","${row.concepto}","${row.monto}","${row.observaciones}"\n`;
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

function obtenerCorteActivo() {
  if (!localDB.corteActivo || typeof localDB.corteActivo !== "object") {
    return null;
  }
  if (normalizeCode(localDB.corteActivo.estado) !== "ABIERTO") {
    return null;
  }
  return localDB.corteActivo;
}

function obtenerResumenFinancieroEnRango(fechaInicioIso, fechaFinIso) {
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
    };
  }

  const ventasPeriodo = localDB.ventas.filter((venta) => {
    const fechaVenta = new Date(venta.fecha);
    return (
      !Number.isNaN(fechaVenta.getTime()) &&
      fechaVenta >= inicio &&
      fechaVenta <= fin
    );
  });

  const pagos = acumularPagosNetos(ventasPeriodo);
  const totalVentasNetas =
    pagos.efectivo + pagos.tarjeta + pagos.transferencia;

  const gastosPeriodo = localDB.gastos.filter((gasto) => {
    const fechaGasto = new Date(gasto.timestamp || gasto.fecha);
    return (
      !Number.isNaN(fechaGasto.getTime()) &&
      fechaGasto >= inicio &&
      fechaGasto <= fin
    );
  });

  const totalGastos = gastosPeriodo.reduce((acumulado, gasto) => {
    return acumulado + parseNumber(gasto.monto, 0);
  }, 0);

  return {
    ventasCount: ventasPeriodo.length,
    gastosCount: gastosPeriodo.length,
    pagosEfectivo: roundTo(pagos.efectivo, 2),
    pagosTarjeta: roundTo(pagos.tarjeta, 2),
    pagosTransferencia: roundTo(pagos.transferencia, 2),
    totalVentasNetas: roundTo(totalVentasNetas, 2),
    totalGastos: roundTo(totalGastos, 2),
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
      '<div class="message info">No hay un corte abierto. Abra un corte para comenzar a acumular operaciones del periodo.</div>';
    return;
  }

  const ahoraIso = new Date().toISOString();
  const resumen = obtenerResumenFinancieroEnRango(corteActivo.fechaApertura, ahoraIso);
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
      resumen.totalGastos -
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
          <div class="corte-kpi"><span>Gastos</span><strong>${formatMoney(resumen.totalGastos)}</strong></div>
          <div class="corte-kpi"><span>Caja esperada</span><strong>${formatMoney(cajaEsperada)}</strong></div>
          <div class="corte-kpi ${diferencia === 0 ? "" : diferencia > 0 ? "corte-kpi--up" : "corte-kpi--down"}"><span>Diferencia estimada</span><strong>${formatMoney(diferencia)}</strong></div>
        </div>
      `;
}

function renderEstadoCorteActual() {
  const estadoField = document.getElementById("estadoCorteActual");
  const fechaAperturaField = document.getElementById("fechaAperturaCorteActual");
  const cajaInicialField = document.getElementById("cajaInicialCorte");
  const observacionesAperturaField = document.getElementById(
    "observacionesAperturaCorte",
  );
  const btnAbrir = document.getElementById("btnAbrirCorte");
  const btnCerrar = document.getElementById("btnCerrarCorte");
  const corteActivo = obtenerCorteActivo();

  if (corteActivo) {
    if (estadoField) estadoField.value = `ABIERTO (${corteActivo.id})`;
    if (fechaAperturaField) {
      fechaAperturaField.value = obtenerFechaHoraLocalTexto(
        corteActivo.fechaApertura,
      );
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
    if (btnCerrar) btnCerrar.disabled = false;
  } else {
    if (estadoField) estadoField.value = "SIN CORTE ABIERTO";
    if (fechaAperturaField) fechaAperturaField.value = "-";
    if (cajaInicialField) {
      cajaInicialField.disabled = false;
      const cortesOrdenados = (localDB.cortes || [])
        .filter(c => c.estado === "CERRADO" && c.fechaCierre)
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
    if (btnCerrar) btnCerrar.disabled = true;

    const cierreIds = [
      "retirosCorte",
      "ingresosCajaCorte",
      "cajaContadaCorte",
      "observacionesCierreCorte",
    ];
    cierreIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === "TEXTAREA") {
        el.value = "";
      } else {
        el.value = "0";
      }
    });
  }

  actualizarResumenCorteActual();
}

function abrirCorteCaja() {
  if (obtenerCorteActivo()) {
    showMessage("msgCorte", "Ya existe un corte abierto.", "warning");
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

  localDB.corteActivo = {
    id: `CA-${Date.now()}`,
    fechaApertura: new Date().toISOString(),
    cajaInicial,
    observacionesApertura,
    estado: "ABIERTO",
    usuario: "Local",
  };

  guardarEstadoLocal();
  renderEstadoCorteActual();
  showMessage("msgCorte", "Corte abierto correctamente.", "success");
}

function cerrarCorteCaja() {
  const corteActivo = obtenerCorteActivo();
  if (!corteActivo) {
    showMessage("msgCorte", "No hay un corte abierto para cerrar.", "warning");
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
  const resumen = obtenerResumenFinancieroEnRango(
    corteActivo.fechaApertura,
    fechaCierre,
  );
  const cajaEsperada = roundTo(
    parseNumber(corteActivo.cajaInicial, 0) +
      resumen.pagosEfectivo -
      resumen.totalGastos -
      retiros +
      ingresosCaja,
    2,
  );
  const diferencia = roundTo(cajaContada - cajaEsperada, 2);

  localDB.cortes.push({
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
    retiros,
    ingresosCaja,
    cajaEsperada,
    cajaContada,
    diferencia,
    observacionesApertura: corteActivo.observacionesApertura || "",
    observacionesCierre,
    usuario: "Local",
    estado: "CERRADO",
  });

  localDB.corteActivo = null;
  guardarEstadoLocal();
  renderEstadoCorteActual();
  mostrarReporteCortes(true);
  loadDashboard();
  showMessage(
    "msgCorte",
    `Corte cerrado. Caja esperada: ${formatMoney(cajaEsperada)}. Diferencia: ${formatMoney(diferencia)}.`,
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
    "Folio,Periodicidad,Apertura,Cierre,Caja Inicial,Ventas Netas,Efectivo,Tarjeta,Transferencia,Gastos,Retiros,Ingresos Caja,Caja Esperada,Caja Contada,Diferencia,Observaciones Apertura,Observaciones Cierre\n";

  data.forEach((corte) => {
    csv += `"${corte.id || ""}","${corte.periodicidad || "DIARIO"}","${obtenerFechaHoraLocalTexto(corte.fechaApertura)}","${obtenerFechaHoraLocalTexto(corte.fechaCierre)}","${roundTo(parseNumber(corte.cajaInicial, 0), 2)}","${roundTo(parseNumber(corte.totalVentasNetas, 0), 2)}","${roundTo(parseNumber(corte.pagosEfectivo, 0), 2)}","${roundTo(parseNumber(corte.pagosTarjeta, 0), 2)}","${roundTo(parseNumber(corte.pagosTransferencia, 0), 2)}","${roundTo(parseNumber(corte.totalGastos, 0), 2)}","${roundTo(parseNumber(corte.retiros, 0), 2)}","${roundTo(parseNumber(corte.ingresosCaja, 0), 2)}","${roundTo(parseNumber(corte.cajaEsperada, 0), 2)}","${roundTo(parseNumber(corte.cajaContada, 0), 2)}","${roundTo(parseNumber(corte.diferencia, 0), 2)}","${(corte.observacionesApertura || "").replace(/"/g, '""')}","${(corte.observacionesCierre || "").replace(/"/g, '""')}"\n`;
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

function exportarDatosJSON() {
  const fecha = new Date().toISOString().slice(0, 10);
  descargarArchivo(
    `Inventario_Local_${fecha}.json`,
    exportarEstadoLocal(),
    "application/json;charset=utf-8;",
  );
  showMessage("configResults", "Datos locales exportados a JSON.", "success");
}

function importarDatosJSON() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function () {
      try {
        const data = JSON.parse(reader.result);
        if (!validarEstructuraEstado(data)) {
          showMessage(
            "configResults",
            "El archivo JSON no tiene la estructura esperada.",
            "error",
          );
          return;
        }

        localDB.productos = data.productos;
        localDB.movimientos = data.movimientos;
        localDB.ventas = Array.isArray(data.ventas) ? data.ventas : [];
        localDB.gastos = Array.isArray(data.gastos) ? data.gastos : [];
        localDB.cortes = Array.isArray(data.cortes) ? data.cortes : [];
        localDB.corteActivo =
          data.corteActivo && typeof data.corteActivo === "object"
            ? data.corteActivo
            : null;
        localDB.carritosPendientes = Array.isArray(data.carritosPendientes)
          ? data.carritosPendientes
          : [];
        localDB.config = {
          ...DEFAULT_CONFIG,
          ...(data.config && typeof data.config === "object"
            ? data.config
            : {}),
        };
        localDB.listas = data.listas;
        localDB.productos = localDB.productos.map((producto) => ({
          ...producto,
          precioVenta: Math.max(0, parseNumber(producto.precioVenta, 0)),
          precioVariable: parseBoolean(producto.precioVariable),
        }));
        guardarEstadoLocal();

        loadListas();
        loadDashboard();
        cargarConfiguracionSistema();
        if (currentTab === "inventario") {
          mostrarStock();
        }
        if (currentTab === "gastos") {
          renderGastosRecientes();
        }
        renderCarritosPendientes();
        showMessage(
          "configResults",
          "Datos importados correctamente desde JSON.",
          "success",
        );
      } catch (error) {
        showMessage(
          "configResults",
          `Error al importar JSON: ${error.message}`,
          "error",
        );
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function limpiarFormProducto() {
  document.getElementById("formProducto").reset();
  document.getElementById("stockMinProd").value = "0";
  document.getElementById("margenProd").value = "30";
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

function limpiarBusqueda() {
  document.getElementById("buscarTexto").value = "";
  document.getElementById("resultadosBusqueda").innerHTML = "";
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

function confirmarReset() {
  if (
    confirm(
      "ADVERTENCIA: Esta accion eliminara TODOS los datos locales en memoria.\n\n¿Desea continuar?",
    )
  ) {
    if (confirm("Ultima confirmacion. ¿Proceder con reset local?")) {
      localDB.productos = [];
      localDB.movimientos = [];
      localDB.ventas = [];
      localDB.gastos = [];
      localDB.cortes = [];
      localDB.corteActivo = null;
      localDB.carritosPendientes = [];
      localDB.config = { ...DEFAULT_CONFIG };
      guardarEstadoLocal();
      loadDashboard();
      mostrarStock();
      cargarConfiguracionSistema();
      if (currentTab === "gastos") {
        renderGastosRecientes();
      }
      showMessage(
        "configResults",
        "Datos locales reiniciados correctamente.",
        "success",
      );
    }
  }
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
  const configActions = document.querySelector("#configuracion .actions");
  if (configActions && !document.getElementById("btnExportJson")) {
    const btn = document.createElement("button");
    btn.id = "btnExportJson";
    btn.className = "btn btn-secondary";
    btn.textContent = "Exportar JSON";
    btn.onclick = exportarDatosJSON;
    configActions.appendChild(btn);
  }

  if (configActions && !document.getElementById("btnImportJson")) {
    const btnImport = document.createElement("button");
    btnImport.id = "btnImportJson";
    btnImport.className = "btn btn-info";
    btnImport.textContent = "Importar JSON";
    btnImport.onclick = importarDatosJSON;
    configActions.appendChild(btnImport);
  }

  handleTipoChange();
  ["cantMov", "tipoMov"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", actualizarVistaCostoPorPieza);
      el.addEventListener("change", actualizarVistaCostoPorPieza);
    }
  });

  ["pagoEfectivo", "pagoTarjeta", "pagoTransferencia"].forEach((id) => {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener("input", actualizarTotalesPagoVenta);
      input.addEventListener("change", actualizarTotalesPagoVenta);
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

document.addEventListener("DOMContentLoaded", initializeApp);
