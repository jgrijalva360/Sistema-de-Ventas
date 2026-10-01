export interface StockSucursal {
  stockActual: number;
  stockMinimo: number;
}

export interface LoteFifo {
  id: string;
  movimientoId?: string;
  fecha: string;
  cantidadInicial: number;
  cantidadDisponible: number;
  costoUnitario: number;
  sucursalId: string;
}

export interface Producto {
  id?: string;
  codigo: string;
  nombre: string;
  stockMinimo: number;
  stockActual: number;
  precioVenta: number;
  ultimoCosto?: number;
  fechaUltimoCosto?: string;
  costoPromedio?: number;
  lotesFifo?: LoteFifo[];
  precioVariable?: boolean;
  grupo?: string;
  unidad?: string;
  categoria?: string;
  stockPorSucursal?: {
    [sucursalId: string]: StockSucursal;
  };
}

export interface ItemCarrito {
  codigo: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  costoUnitarioFifo?: number;
  costoTotalFifo?: number;
  precioVariable?: boolean;
}

export interface PagosDetalle {
  efectivo: number;
  tarjeta: number;
  transferencia: number;
}

export interface Venta {
  id: string;
  fecha: string;
  items: ItemCarrito[];
  total: number;
  totalPagado: number;
  cambio: number;
  pagos: PagosDetalle;
  sucursalId: string;
  sucursalNombre: string;
  usuario?: string;
  estado?: 'COMPLETADA' | 'CANCELADA';
  fechaCancelacion?: string;
  motivoCancelacion?: string;
  usuarioCancelacion?: string;
  socioTransferenciaId?: string;
  socioTransferenciaNombre?: string;
  socioTarjetaId?: string;
  socioTarjetaNombre?: string;
}

export interface CarritoPendiente {
  id: string;
  alias: string;
  fecha: string;
  items: ItemCarrito[];
  total: number;
  sucursalId: string;
}

export interface Gasto {
  id: string;
  fecha: string;
  concepto: string;
  monto: number;
  categoria: string;
  persona: string;
  metodoPago: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | string;
  observaciones?: string;
  sucursalId: string;
  sucursalNombre: string;
  socioId?: string;
}

export interface ResguardoCajaItem {
  id: string;
  fecha: string;
  monto: number;
  socioId: string;
  socioNombre: string;
  concepto?: string;
  usuario?: string;
  tipo?: 'RETIRO' | 'DEVOLUCION' | 'PAGO_REPARTO';
  metodoPago?: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';
  socioOrigenId?: string;
  socioOrigenNombre?: string;
  liquidacionFolio?: string;
}

export interface CorteActivo {
  id: string;
  fechaApertura: string;
  cajaInicial: number;
  observacionesApertura?: string;
  estado: 'ABIERTO';
  usuario: string;
  sucursalId: string;
  sucursalNombre: string;
  resguardos?: ResguardoCajaItem[];
}

export interface Corte {
  id: string;
  periodicidad: 'DIARIO' | 'SEMANAL' | 'QUINCENAL' | 'MENSUAL' | string;
  fechaApertura: string;
  fechaCierre: string;
  cajaInicial: number;
  ventasCount: number;
  gastosCount: number;
  pagosEfectivo: number;
  pagosTarjeta: number;
  pagosTransferencia: number;
  totalVentasNetas: number;
  totalGastos: number;
  gastosEfectivo: number;
  gastosTarjeta: number;
  gastosTransferencia: number;
  gastosBancarios: number;
  retiros: number;
  ingresosCaja: number;
  socioRetiroId?: string;
  socioRetiroNombre?: string;
  resguardosDetalle?: ResguardoCajaItem[];
  cajaEsperada: number;
  cajaContada: number;
  diferencia: number;
  observacionesApertura?: string;
  observacionesCierre?: string;
  usuario: string;
  sucursalId: string;
  sucursalNombre: string;
  estado: 'CERRADO';
}

export interface MateriaPrimaItem {
  tipo: 'INVENTARIO' | 'EXTRA';
  codigo?: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface AbonoPedido {
  id: string;
  fecha: string;
  concepto: string;
  monto: number;
  metodoPago: string;
  socioTransferenciaId?: string;
  socioTransferenciaNombre?: string;
  socioTarjetaId?: string;
  socioTarjetaNombre?: string;
}

export interface PedidoPersonalizado {
  id: string;
  clienteNombre: string;
  clienteTelefono?: string;
  fechaRegistro: string;
  fechaEntrega?: string;
  especificaciones: string;
  estado: 'PENDIENTE' | 'EN_PROCESO' | 'LISTO' | 'TERMINADO' | 'ENTREGADO' | 'CANCELADO';
  materiasPrimas: MateriaPrimaItem[];
  totalAcordado: number;
  anticipo: number;
  saldoRestante: number;
  metodoPagoAnticipo?: string;
  metodoPagoLiquidacion?: string;
  fechaLiquidacion?: string;
  abonos?: AbonoPedido[];
  insumosDescontados?: boolean;
  socioTransferenciaId?: string;
  socioTransferenciaNombre?: string;
  socioTarjetaId?: string;
  socioTarjetaNombre?: string;
  sucursalId: string;
  sucursalNombre: string;
  fechaCancelacion?: string;
  motivoCancelacion?: string;
  usuarioCancelacion?: string;
}

export interface MovimientoInventario {
  id: string;
  fecha: string;
  tipo: 'ENTRADA' | 'SALIDA' | 'AJUSTE' | 'INICIAL' | 'INGRESO';
  codigo: string;
  nombre: string;
  cantidad: number;
  stockAnterior: number;
  stockNuevo: number;
  costoUnitario?: number;
  costoTotal?: number;
  motivo?: string;
  usuario?: string;
  sucursalId: string;
}

export interface Sucursal {
  id: string;
  nombre: string;
  direccion: string;
  telefono: string;
  esMatriz: boolean;
}

export interface ConfigSistema {
  businessName: string;
  businessPhone: string;
  fiscalLegend: string;
}

export interface ListasConfig {
  unidades: string[];
  grupos: string[];
}

export interface VersionInfo {
  appVersion: string;
  dataRevision: number;
  lastDevice: string;
  lastTimestamp: string;
}

export type ModuloBitacora =
  | 'VENTAS'
  | 'INVENTARIO'
  | 'CORTES'
  | 'GASTOS'
  | 'PEDIDOS'
  | 'SUCURSALES'
  | 'CONFIGURACION'
  | 'SEGURIDAD'
  | 'REPORTES'
  | 'SOCIOS';

export type TipoAccionBitacora =
  | 'CREAR'
  | 'EDITAR'
  | 'ELIMINAR'
  | 'CANCELAR'
  | 'APERTURA'
  | 'CIERRE'
  | 'TRASPASO'
  | 'ABONO'
  | 'LIQUIDACION'
  | 'LOGIN'
  | 'RESET';

export interface BitacoraEvento {
  id: string;
  fecha: string;
  modulo: ModuloBitacora;
  accion: TipoAccionBitacora;
  descripcion: string;
  detalles?: any;
  usuario: string;
  dispositivo: string;
  sucursalId: string;
  sucursalNombre: string;
  nivel?: 'INFO' | 'WARNING' | 'DANGER' | 'SUCCESS';
}

// ── Modelos SaaS y Control de Usuarios ─────────────────────────
export type RolUsuario = 'SUPERADMIN' | 'ADMIN' | 'ENCARGADO' | 'CAJERO';

export interface UsuarioSistema {
  uid: string;
  email: string;
  nombre: string;
  empresaId: string;
  rol: RolUsuario;
  sucursalId?: string;
  sucursalNombre?: string;
  activo: boolean;
  fechaCreacion: string;
  ultimoAcceso?: string | null;
  sesionActivaId?: string | null;
  dispositivoActual?: string | null;
  pin?: string;
  claveAcceso?: string;
  creadoPorAdmin?: boolean;
  dispositivoAutorizadoId?: string | null;
  dispositivoAutorizadoNombre?: string | null;
  fechaVinculacionDispositivo?: string | null;
  permitirCualquierDispositivo?: boolean;
}

export type PlanSuscripcion = 'TRIAL' | 'BASICO' | 'PRO' | 'ENTERPRISE';
export type EstadoSuscripcion = 'ACTIVA' | 'PRUEBA' | 'VENCIDA' | 'CANCELADA';

export interface SuscripcionEmpresa {
  empresaId: string;
  nombreNegocio: string;
  contactoEmail: string;
  contactoTelefono?: string;
  plan: PlanSuscripcion;
  estado: EstadoSuscripcion;
  fechaInicio: string;
  fechaVencimiento: string;
  diasPrueba?: number;
  limites: {
    maxUsuarios: number;
    maxSucursales: number;
  };
  codigoActivacionUsado?: string;
  tipoCobro?: 'RECURRENTE' | 'UNICO';
  preapprovalId?: string;
  ultimoPago?: {
    idPago?: string;
    monto?: number;
    metodo?: string;
    fecha?: string;
    referenciaExterna?: string;
  };
  actualizadoEn?: string;
}

export interface PlanCatalogo {
  id: PlanSuscripcion;
  titulo: string;
  subtitulo: string;
  precio: number;
  moneda: string;
  periodo: 'MENSUAL' | 'ANUAL';
  meses: number;
  destacado?: boolean;
  caracteristicas: string[];
  maxUsuarios: number;
  maxSucursales: number;
  maxProductos?: number;
  mpPreferenceUrl?: string;
}

export interface CodigoPromocional {
  id?: string;
  codigo: string;
  diasOtorgados: number;
  planAsignado: PlanSuscripcion;
  usosMaximos: number;
  usosActuales: number;
  activo: boolean;
  fechaCreacion: string;
  expiraEn?: string;
  descripcion?: string;
  empresasQueCanjearon?: string[];
}

export interface MensajeTicket {
  id: string;
  remitenteUid: string;
  remitenteNombre: string;
  remitenteRol: 'SUPERADMIN' | 'CLIENTE';
  texto: string;
  imagenUrl?: string;
  fecha: string;
}

export interface TicketSoporte {
  id?: string;
  folio: string;
  empresaId: string;
  nombreNegocio: string;
  plan: string;
  usuarioUid: string;
  usuarioEmail: string;
  usuarioNombre: string;
  categoria: string;
  prioridad: string;
  telefono?: string;
  descripcion: string;
  imagenAdjunta?: string;
  estado: 'ABIERTO' | 'EN_PROCESO' | 'RESUELTO' | 'CERRADO';
  fechaCreacion: string;
  respuestaAdmin?: string;
  fechaRespuesta?: string;
  mensajes?: MensajeTicket[];
  ultimaActualizacion?: string;
}

export interface SocioConfig {
  id: string;
  nombre: string;
  porcentaje: number; // Ej: 40, 40, 20
  activo: boolean;
  recibeTransferenciasDefault?: boolean;
  recibeTarjetasDefault?: boolean;
  recibeResguardosDefault?: boolean;
}

export interface AjusteEntreSocios {
  id: string;
  socioAcreedorId: string; // Quien prestó o recibe (+)
  socioAcreedorNombre: string;
  socioDeudorId: string;   // Quien debe o se le descuenta (-)
  socioDeudorNombre: string;
  monto: number;
  concepto: string;
  fecha?: string;
  liquidado?: boolean;
  liquidacionFolio?: string;
  usuarioRegistro?: string;
}

export interface DetalleLiquidacionSocio {
  socioId: string;
  nombre: string;
  porcentaje: number;
  gananciaAsignada: number;
  gastosBolsilloAportados: number;
  cuotaGastosBolsillo: number;
  transferenciasRecibidas?: number;
  tarjetasRecibidas?: number;
  resguardosRecibidos?: number;
  devolucionesRealizadas?: number;
  resguardoNeto?: number;
  ajusteDirecto?: number;
  montoNetoACobrar: number;
  metodoPagoSalida?: 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA';
  socioOrigenId?: string;
  socioOrigenNombre?: string;
  montoPagado?: number;
  montoPendiente?: number;
  saldado?: boolean;
}

export interface GastoBolsilloItem {
  id: string;
  concepto: string;
  monto: number;
  fecha: string;
  socioId: string;
  socioNombre: string;
  origen: 'SISTEMA_GASTOS' | 'MANUAL';
  gastoOriginalId?: string;
}

export interface LiquidacionSocios {
  id: string;
  folio?: string;
  fechaCreacion: string;
  fechaDesde: string;
  fechaHasta: string;
  baseCalculo: 'FLUJO_EFECTIVO' | 'UTILIDAD_FIFO';
  totalIngresos: number;
  totalCostoFifo: number;
  totalGastosNegocio: number;
  totalGastosSocios: number;
  totalTransferencias?: number;
  totalTarjetas?: number;
  totalResguardos?: number;
  totalDevoluciones?: number;
  utilidadBaseReparto: number;
  socios: DetalleLiquidacionSocio[];
  gastosBolsilloDetalle: GastoBolsilloItem[];
  ajustesEntreSocios?: AjusteEntreSocios[];
  observaciones?: string;
  usuarioRegistro?: string;
  sucursalId?: string;
  sucursalNombre?: string;
}

// ── Modelos de Estado de Cuenta / Flujo Financiero ──────────────
export type TipoFlujoFinanciero = 'INGRESO' | 'EGRESO';
export type EntidadFinanciera = 'CAJA' | 'SOCIO' | 'EMPRESA';
export type ModuloFinanciero = 'VENTAS' | 'PEDIDOS' | 'GASTOS' | 'CORTES' | 'SOCIOS';

export interface MovimientoFinanciero {
  id: string;
  fecha: string;
  concepto: string;
  tipo: TipoFlujoFinanciero;
  importe: number;
  cuenta: EntidadFinanciera;
  titularSocioId?: string;
  titularSocioNombre?: string;
  contraparteId?: string;
  contraparteNombre?: string;
  metodoPago: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'BOLSILLO_SOCIO' | string;
  moduloOrigen: ModuloFinanciero;
  referenciaId: string;
  sucursalId?: string;
  sucursalNombre?: string;
  usuario?: string;
  saldoAcumulado?: number;
}

export interface FiltrosEstadoCuenta {
  periodo?: 'HOY' | 'AYER' | 'ESTA_SEMANA' | 'ESTE_MES' | 'MES_ANTERIOR' | 'PERSONALIZADO' | 'TODO';
  fechaDesde: string;
  fechaHasta: string;
  cuenta: 'TODAS' | 'CAJA' | 'EMPRESA' | string; // 'TODAS' | 'CAJA' | socioId
  tipo: 'TODOS' | 'INGRESO' | 'EGRESO';
  metodoPago: 'TODOS' | 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA';
  moduloOrigen: 'TODOS' | ModuloFinanciero;
  sucursalId: string;
  terminoBusqueda?: string;
}

export interface ResumenEstadoCuenta {
  saldoInicial: number;
  totalIngresos: number;
  totalEgresos: number;
  flujoNeto: number;
  saldoFinal: number;
  movimientos: MovimientoFinanciero[];
}

export interface ResumenArchivoBackup {
  fileName: string;
  data: any;
  fecha?: string;
  appVersion?: string;
  productosCount: number;
  ventasCount: number;
  movimientosCount: number;
  gastosCount: number;
  cortesCount: number;
  pedidosCount: number;
  sucursalesCount: number;
  bitacoraCount: number;
  usuariosCount: number;
  sociosCount: number;
  liquidacionesCount: number;
  prestamosCount: number;
  hasConfig: boolean;
}

export interface ResultadoRestauracionBackup {
  productosCount: number;
  ventasCount: number;
  gastosCount: number;
  movimientosCount: number;
  cortesCount: number;
  pedidosCount: number;
  sucursalesCount: number;
  bitacoraCount: number;
  usuariosCount: number;
  sociosCount: number;
  liquidacionesCount: number;
  prestamosCount: number;
  configRestaurada: boolean;
}


