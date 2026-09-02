export interface StockSucursal {
  stockActual: number;
  stockMinimo: number;
}

export interface Producto {
  id?: string;
  codigo: string;
  nombre: string;
  stockMinimo: number;
  stockActual: number;
  precioVenta: number;
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
  sucursalId: string;
  sucursalNombre: string;
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
  | 'SEGURIDAD';

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
  ultimoAcceso?: string;
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
  mpPreferenceUrl?: string;
}

