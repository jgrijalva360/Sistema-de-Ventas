import { Injectable, signal } from '@angular/core';
import {
  ConfigSistema,
  ListasConfig,
  Sucursal,
  Producto,
  MovimientoInventario,
  Venta,
  ItemCarrito,
  Gasto,
  Corte,
  PedidoPersonalizado,
  MateriaPrimaItem,
  AbonoPedido
} from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { ProductosService } from './productos.service';
import { VentasService } from './ventas.service';
import { GastosService } from './gastos.service';
import { CortesService } from './cortes.service';
import { MovimientosService } from './movimientos.service';
import { PedidosService } from './pedidos.service';
import { SucursalesService } from './sucursales.service';
import { SyncService } from './sync.service';
import { doc, getDoc, setDoc, deleteDoc, getDocs, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { getFechaLocalString } from '../../shared/utils/date.util';
import { Subscription } from 'rxjs';
import { docStream$ } from '../utils/realtime.util';

import { BitacoraService } from './bitacora.service';

export const DEFAULT_CONFIG: ConfigSistema = {
  businessName: 'Mi Negocio',
  businessPhone: '',
  fiscalLegend: '¡Gracias por su compra!'
};

export const DEFAULT_LISTAS: ListasConfig = {
  unidades: ['Unidades', 'Pieza', 'Caja', 'Paquetes', 'Docenas'],
  grupos: ['General', 'Materia Prima', 'Producto', 'Herramientas', 'Consumibles']
};

@Injectable({
  providedIn: 'root'
})
export class ConfiguracionService {
  private configSignal = signal<ConfigSistema>(DEFAULT_CONFIG);
  private listasSignal = signal<ListasConfig>(DEFAULT_LISTAS);

  public config = this.configSignal.asReadonly();
  public listas = this.listasSignal.asReadonly();

  private subLive?: Subscription;

  constructor(
    private firestoreService: FirestoreChunksService,
    private productosService: ProductosService,
    private ventasService: VentasService,
    private gastosService: GastosService,
    private cortesService: CortesService,
    private movimientosService: MovimientosService,
    private pedidosService: PedidosService,
    private sucursalesService: SucursalesService,
    private syncService: SyncService,
    private bitacoraService: BitacoraService
  ) {}

  async cargarConfiguracion(): Promise<void> {
    try {
      const ref = this.firestoreService.getRefDocConfig('general');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data();
        if (data['config']) this.configSignal.set({ ...DEFAULT_CONFIG, ...data['config'] });
        if (data['listas']) this.listasSignal.set(data['listas']);
      }
    } catch (_) {}
  }

  iniciarEscuchadorLive(): void {
    if (this.subLive) this.subLive.unsubscribe();
    const ref = this.firestoreService.getRefDocConfig('general');
    this.subLive = docStream$(ref).subscribe({
      next: (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data['config']) {
            this.configSignal.set({ ...DEFAULT_CONFIG, ...data['config'] });
          }
          if (data['listas']) {
            this.listasSignal.set(data['listas']);
          }
        }
      },
      error: (err) => console.error('Error en stream de configuración:', err)
    });
  }

  async guardarConfiguracion(nuevaConfig: ConfigSistema): Promise<void> {
    this.configSignal.set(nuevaConfig);
    try {
      const ref = this.firestoreService.getRefDocConfig('general');
      await setDoc(ref, { config: nuevaConfig, listas: this.listasSignal() }, { merge: true });
      await this.syncService.incrementarRevision();
    } catch (e) {
      console.warn('Error al guardar configuración general:', e);
    }
  }

  // ── Copias de Seguridad (Backup JSON) ───────────────────────
  descargarBackupJSON(): void {
    const backupData = {
      version: '2.1.0',
      fecha: new Date().toISOString(),
      config: this.configSignal(),
      listas: this.listasSignal(),
      sucursales: this.sucursalesService.sucursales(),
      productos: this.productosService.productos(),
      ventas: this.ventasService.ventas(),
      gastos: this.gastosService.gastos(),
      movimientos: this.movimientosService.movimientos(),
      cortes: this.cortesService.cortesHistorial(),
      corteActivo: this.cortesService.corteActivo(),
      carritosPendientes: this.ventasService.carritosPendientes(),
      pedidosPersonalizados: this.pedidosService.pedidos(),
      bitacora: this.bitacoraService.eventos()
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fecha = getFechaLocalString();
    a.href = url;
    a.download = `backup_sistema_ventas_${fecha}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async analizarArchivoBackup(file: File): Promise<{
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
    hasConfig: boolean;
  }> {
    const text = await file.text();
    const data = JSON.parse(text);

    const normalizar = (campoPrincipal: any, ...alias: any[]): any[] => {
      const candidatos = [campoPrincipal, ...alias];
      for (const val of candidatos) {
        if (!val) continue;
        if (Array.isArray(val)) return val;
        if (typeof val === 'object') {
          if (Array.isArray(val.items)) return val.items;
          if (Array.isArray(val.data)) return val.data;
          const vals = Object.values(val);
          if (vals.length > 0 && typeof vals[0] === 'object') return vals;
        }
      }
      return [];
    };

    const rawProductos = normalizar(data.productos, data.products, data.catalogo, data.catalogoProductos);
    const rawMovimientos = normalizar(data.movimientos, data.kardex, data.movimientosInventario);
    const rawVentas = normalizar(data.ventas, data.sales, data.historialVentas, data.ventasHistorial);
    const rawGastos = normalizar(data.gastos, data.expenses, data.gastosHistorial);
    const rawCortes = normalizar(data.cortes, data.cortesHistorial, data.cortesCaja);
    const hasCorteActivo = Boolean(data.corteActivo && (data.corteActivo.id || data.corteActivo.estado === 'ABIERTO'));
    const rawPedidos = normalizar(data.pedidosPersonalizados, data.pedidos, data.customOrders);
    const rawSucursales = normalizar(data.sucursales, data.branches);
    const rawBitacora = normalizar(data.bitacora, data.auditoria, data.bitacoraEventos, data.log);
    const hasConfig = Boolean(data.config || data.general || data.listas || data.nombreNegocio || data.businessName);

    return {
      fileName: file.name,
      data,
      fecha: data.timestamp || data.fechaExportacion || data.actualizadoEn,
      appVersion: data.appVersion || data.version,
      productosCount: rawProductos.length,
      ventasCount: rawVentas.length,
      movimientosCount: rawMovimientos.length,
      gastosCount: rawGastos.length,
      cortesCount: rawCortes.length + (hasCorteActivo ? 1 : 0),
      pedidosCount: rawPedidos.length,
      sucursalesCount: rawSucursales.length,
      bitacoraCount: rawBitacora.length,
      hasConfig
    };
  }

  async restaurarBackupSeleccionado(
    data: any,
    opciones: {
      restaurarProductos: boolean;
      restaurarVentas: boolean;
      restaurarMovimientos: boolean;
      restaurarGastos: boolean;
      restaurarCortes: boolean;
      restaurarPedidos: boolean;
      restaurarSucursales: boolean;
      restaurarConfiguracion: boolean;
      restaurarBitacora?: boolean;
    }
  ): Promise<{
    productosCount: number;
    ventasCount: number;
    gastosCount: number;
    movimientosCount: number;
    cortesCount: number;
    pedidosCount: number;
    sucursalesCount: number;
    bitacoraCount: number;
    configRestaurada: boolean;
  }> {
    this.syncService.setStatus('saving', 'Restaurando copia de seguridad...');

    // Función auxiliar para normalizar arrays desde distintos formatos posibles
    const normalizar = (campoPrincipal: any, ...alias: any[]): any[] => {
      const candidatos = [campoPrincipal, ...alias];
      for (const val of candidatos) {
        if (!val) continue;
        if (Array.isArray(val)) return val;
        if (typeof val === 'object') {
          if (Array.isArray(val.items)) return val.items;
          if (Array.isArray(val.data)) return val.data;
          const vals = Object.values(val);
          if (vals.length > 0 && typeof vals[0] === 'object') return vals;
        }
      }
      return [];
    };

    const rawProductos = normalizar(data.productos, data.products, data.catalogo, data.catalogoProductos);
    const rawMovimientos = normalizar(data.movimientos, data.kardex, data.movimientosInventario);
    const rawVentas = normalizar(data.ventas, data.sales, data.historialVentas, data.ventasHistorial);
    const rawGastos = normalizar(data.gastos, data.expenses, data.gastosHistorial);
    const rawCortes = normalizar(data.cortes, data.cortesHistorial, data.cortesCaja);
    const rawCarritos = normalizar(data.carritosPendientes, data.carritos, data.ventasEnEspera);
    const rawPedidos = normalizar(data.pedidosPersonalizados, data.pedidos, data.customOrders);
    const rawSucursales = normalizar(data.sucursales, data.branches);

    let sucursalesRestauradas = 0;
    let productosRestaurados = 0;
    let movimientosRestaurados = 0;
    let ventasRestauradas = 0;
    let gastosRestaurados = 0;
    let cortesRestaurados = 0;
    let pedidosRestaurados = 0;
    let configRestaurada = false;

    // 0. Sucursales
    if (opciones.restaurarSucursales && rawSucursales.length > 0) {
      const sucursales: Sucursal[] = rawSucursales.map((s: any) => ({
        id: s.id || 'SUC-MAIN',
        nombre: s.nombre || 'JBGraphic',
        direccion: s.direccion || '',
        telefono: s.telefono || '',
        esMatriz: Boolean(s.esMatriz)
      }));

      this.sucursalesService.setSucursales(sucursales);
      const sucRef = this.firestoreService.getRefDocConfig('sucursales');
      await setDoc(sucRef, this.firestoreService.sanitizarParaFirestore({ items: sucursales, actualizadoEn: new Date().toISOString() }), { merge: true });
      sucursalesRestauradas = sucursales.length;
    }

    // 1. Mapear Productos
    if (opciones.restaurarProductos && rawProductos.length > 0) {
      const productos: Producto[] = rawProductos.map((p: any) => {
        const cod = (p.codigo || '').trim();
        const stockMin = typeof p.stockMinimo === 'number' ? p.stockMinimo : typeof p.stockMin === 'number' ? p.stockMin : 1;
        const stockAct = typeof p.stockActual === 'number' ? p.stockActual : (p.existencias ?? stockMin);

        return {
          codigo: cod,
          nombre: p.nombre || 'Producto',
          precioVenta: Number(p.precioVenta) || 0,
          stockMinimo: stockMin,
          stockActual: stockAct,
          precioVariable: Boolean(p.precioVariable),
          grupo: p.grupo || 'General',
          unidad: p.unidad || 'Unidades',
          categoria: p.categoria || p.grupo || 'General'
        };
      });

      this.productosService.setProductos(productos);
      await this.firestoreService.guardarColeccionChunked('productos', productos);
      const catRef = this.firestoreService.getRefDocConfig('catalogoProductos');
      await setDoc(catRef, this.firestoreService.sanitizarParaFirestore({
        items: productos,
        total: productos.length,
        actualizadoEn: new Date().toISOString()
      }), { merge: true });
      productosRestaurados = productos.length;
    }

    // 2. Mapear Movimientos
    if (opciones.restaurarMovimientos && rawMovimientos.length > 0) {
      const movimientos: MovimientoInventario[] = rawMovimientos.map((m: any, idx: number) => {
        const tipoRaw = (m.tipo || '').toUpperCase();
        let tipo: MovimientoInventario['tipo'] = 'AJUSTE';
        if (tipoRaw === 'INGRESO' || tipoRaw === 'ENTRADA') tipo = 'ENTRADA';
        else if (tipoRaw === 'SALIDA') tipo = 'SALIDA';
        else if (tipoRaw === 'INICIAL') tipo = 'INICIAL';

        const cod = (m.codigo || '').trim();
        const nom = m.nombre || m.producto || 'Producto';
        const cant = Number(m.cantidad) || 1;

        return {
          id: m.id || `MOV-${String(idx + 1).padStart(4, '0')}`,
          fecha: m.fecha || m.timestamp || new Date().toISOString(),
          tipo,
          codigo: cod,
          nombre: nom,
          cantidad: cant,
          stockAnterior: typeof m.stockAnterior === 'number' ? m.stockAnterior : cant,
          stockNuevo: typeof m.stockNuevo === 'number' ? m.stockNuevo : cant,
          motivo: m.observaciones || m.motivo || '',
          usuario: m.usuario || 'Local',
          sucursalId: m.sucursalId || 'SUC-MAIN'
        };
      });

      this.movimientosService.setMovimientos(movimientos);
      await this.firestoreService.guardarColeccionChunked('movimientos', movimientos);
      movimientosRestaurados = movimientos.length;
    }

    // 3. Mapear Ventas
    if (opciones.restaurarVentas && rawVentas.length > 0) {
      const ventas: Venta[] = rawVentas.map((v: any, idx: number) => {
        const tot = typeof v.total === 'number' ? v.total : parseFloat(v.total) || 0;
        const pag = v.pagos || {};
        const efec = typeof pag.efectivo === 'number' ? pag.efectivo : (pag.tarjeta || pag.transferencia ? 0 : tot);
        const tarj = typeof pag.tarjeta === 'number' ? pag.tarjeta : 0;
        const trans = typeof pag.transferencia === 'number' ? pag.transferencia : 0;
        const totalPag = typeof v.totalPagado === 'number' ? v.totalPagado : (efec + tarj + trans || tot);
        const cambio = typeof v.cambio === 'number' ? v.cambio : Math.max(0, totalPag - tot);

        const rawItems = Array.isArray(v.items) ? v.items : [];
        const items: ItemCarrito[] = rawItems.map((it: any) => ({
          codigo: it.codigo || '',
          nombre: it.nombre || 'Artículo',
          cantidad: Number(it.cantidad) || 1,
          precioUnitario: typeof it.precioUnitario === 'number' ? it.precioUnitario : tot,
          subtotal: typeof it.subtotal === 'number' ? it.subtotal : (Number(it.cantidad) || 1) * (typeof it.precioUnitario === 'number' ? it.precioUnitario : tot),
          precioVariable: Boolean(it.precioVariable)
        }));

        return {
          id: v.id || `V-${String(idx + 1).padStart(4, '0')}`,
          fecha: v.fecha || new Date().toISOString(),
          items: items.length > 0 ? items : [{
            codigo: 'GEN',
            nombre: v.conceptoPedido || 'Venta',
            cantidad: 1,
            precioUnitario: tot,
            subtotal: tot
          }],
          total: tot,
          totalPagado: totalPag,
          cambio,
          pagos: {
            efectivo: efec,
            tarjeta: tarj,
            transferencia: trans
          },
          sucursalId: v.sucursalId || 'SUC-MAIN',
          sucursalNombre: v.sucursalNombre || 'JBGraphic',
          usuario: v.usuario || 'Local'
        };
      });

      this.ventasService.setVentas(ventas);
      await this.firestoreService.guardarColeccionChunked('ventas', ventas);
      ventasRestauradas = ventas.length;

      // Carritos Pendientes
      if (rawCarritos.length > 0) {
        const carritosPendientes = rawCarritos.map((cp: any, idx: number) => ({
          id: cp.id || `CP-${String(idx + 1).padStart(4, '0')}`,
          alias: cp.alias || 'Ticket',
          fecha: cp.fecha || new Date().toISOString(),
          items: Array.isArray(cp.items) ? cp.items : [],
          total: Number(cp.total) || 0,
          sucursalId: cp.sucursalId || 'SUC-MAIN'
        }));
        const carritosRef = this.firestoreService.getRefDocConfig('carritosPendientes');
        await setDoc(carritosRef, this.firestoreService.sanitizarParaFirestore({
          items: carritosPendientes,
          actualizadoEn: new Date().toISOString()
        }), { merge: true });
      }
    }

    // 4. Mapear Gastos
    if (opciones.restaurarGastos && rawGastos.length > 0) {
      const gastos: Gasto[] = rawGastos.map((g: any, idx: number) => ({
        id: g.id || `G-${String(idx + 1).padStart(4, '0')}`,
        fecha: g.fecha || g.timestamp || new Date().toISOString(),
        concepto: g.concepto || 'Gasto',
        monto: Number(g.monto) || 0,
        categoria: g.categoria || 'Servicios',
        persona: g.persona || g.usuario || 'Local',
        metodoPago: g.metodoPago || 'EFECTIVO',
        observaciones: g.observaciones || '',
        sucursalId: g.sucursalId || 'SUC-MAIN',
        sucursalNombre: g.sucursalNombre || 'JBGraphic'
      }));

      this.gastosService.setGastos(gastos);
      await this.firestoreService.guardarColeccionChunked('gastos', gastos);
      gastosRestaurados = gastos.length;
    }

    // 5. Mapear Cortes y Corte Activo
    if (opciones.restaurarCortes) {
      if (rawCortes.length > 0) {
        const cortes: Corte[] = rawCortes.map((c: any, idx: number) => ({
          id: c.id || `CC-${String(idx + 1).padStart(4, '0')}`,
          periodicidad: c.periodicidad || 'DIARIO',
          fechaApertura: c.fechaApertura || new Date().toISOString(),
          fechaCierre: c.fechaCierre || new Date().toISOString(),
          cajaInicial: Number(c.cajaInicial) || 0,
          ventasCount: Number(c.ventasCount) || 0,
          gastosCount: Number(c.gastosCount) || 0,
          pagosEfectivo: Number(c.pagosEfectivo) || 0,
          pagosTarjeta: Number(c.pagosTarjeta) || 0,
          pagosTransferencia: Number(c.pagosTransferencia) || 0,
          totalVentasNetas: Number(c.totalVentasNetas) || 0,
          totalGastos: Number(c.totalGastos) || 0,
          gastosEfectivo: Number(c.gastosEfectivo) || 0,
          gastosTarjeta: Number(c.gastosTarjeta) || 0,
          gastosTransferencia: Number(c.gastosTransferencia) || 0,
          gastosBancarios: Number(c.gastosBancarios) || 0,
          retiros: Number(c.retiros) || 0,
          ingresosCaja: Number(c.ingresosCaja) || 0,
          cajaEsperada: Number(c.cajaEsperada) || 0,
          cajaContada: Number(c.cajaContada) || 0,
          diferencia: Number(c.diferencia) || 0,
          observacionesApertura: c.observacionesApertura || '',
          observacionesCierre: c.observacionesCierre || '',
          usuario: c.usuario || 'Local',
          sucursalId: c.sucursalId || 'SUC-MAIN',
          sucursalNombre: c.sucursalNombre || 'JBGraphic',
          estado: 'CERRADO'
        }));

        this.cortesService.setCortes(cortes);
        await this.firestoreService.guardarColeccionChunked('cortes', cortes);
        cortesRestaurados = cortes.length;
      }

      // Corte Activo
      if (data.corteActivo && (data.corteActivo.id || data.corteActivo.estado === 'ABIERTO')) {
        const corteActivo = {
          id: data.corteActivo.id || `CA-${Date.now()}`,
          fechaApertura: data.corteActivo.fechaApertura || new Date().toISOString(),
          cajaInicial: Number(data.corteActivo.cajaInicial) || 0,
          observacionesApertura: data.corteActivo.observacionesApertura || '',
          estado: 'ABIERTO' as const,
          usuario: data.corteActivo.usuario || 'Cajero',
          sucursalId: data.corteActivo.sucursalId || 'SUC-MAIN',
          sucursalNombre: data.corteActivo.sucursalNombre || 'JBGraphic'
        };
        const corteRef = this.firestoreService.getRefDocConfig('corteActivo');
        const sanitizado = this.firestoreService.sanitizarParaFirestore(corteActivo);
        await setDoc(corteRef, sanitizado);
        this.cortesService.setCorteActivo(sanitizado as any);
        cortesRestaurados += 1;
      }
    }

    // 6. Pedidos Personalizados
    if (opciones.restaurarPedidos && rawPedidos.length > 0) {
      const pedidos: PedidoPersonalizado[] = rawPedidos.map((p: any, idx: number) => {
        const cliNombre = p.clienteNombre || (typeof p.cliente === 'object' ? p.cliente?.nombre : p.cliente) || 'Cliente';
        const cliTel = p.clienteTelefono || (typeof p.cliente === 'object' ? p.cliente?.telefono : '') || '';
        const total = typeof p.totalAcordado === 'number' ? p.totalAcordado : parseFloat(p.totalAcordado || p.precioTotal) || 0;
        let estado = p.estado || 'PENDIENTE';
        if (estado === 'TERMINADO') estado = 'LISTO';

        const rawMP = Array.isArray(p.materiasPrimas) ? p.materiasPrimas : [];
        const materiasPrimas: MateriaPrimaItem[] = rawMP.map((mp: any) => ({
          tipo: mp.tipo || (mp.esExtra ? 'EXTRA' : (mp.codigo ? 'INVENTARIO' : 'EXTRA')),
          codigo: mp.codigo || '',
          nombre: mp.nombre || 'Insumo',
          cantidad: Number(mp.cantidad) || 1,
          precioUnitario: Number(mp.precioUnitario) || 0,
          subtotal: Number(mp.subtotal) || (Number(mp.cantidad) || 1) * (Number(mp.precioUnitario) || 0)
        }));

        // Mapeo exhaustivo de abonos / pagos
        const rawAbonos = Array.isArray(p.abonos) && p.abonos.length > 0
          ? p.abonos
          : Array.isArray(p.pagos) && p.pagos.length > 0
            ? p.pagos
            : Array.isArray(p.historialPagos)
              ? p.historialPagos
              : [];

        const abonos: AbonoPedido[] = rawAbonos.map((a: any, aIdx: number) => {
          const monto = typeof a.monto === 'number' ? a.monto : parseFloat(a.monto || a.cantidad || a.importe || a.total) || 0;
          const fecha = a.fecha || a.fechaPago || a.timestamp || p.fechaRegistro || p.fechaCreacion || new Date().toISOString();
          const concepto = a.concepto || a.descripcion || a.nota || (aIdx === 0 ? 'Anticipo Inicial' : `Abono ${aIdx + 1}`);
          const metodo = (a.metodoPago || a.metodo || a.formaPago || p.metodoPagoAnticipo || 'EFECTIVO').toUpperCase();

          return {
            id: a.id || a.pagoId || `ABO-${aIdx + 1}`,
            fecha,
            concepto,
            monto,
            metodoPago: metodo
          };
        });

        const rawAnticipo = typeof p.anticipo === 'number' ? p.anticipo : parseFloat(p.anticipo || p.anticipoInicial) || 0;
        const totalAbonos = abonos.reduce((acc, a) => acc + (a.monto || 0), 0);

        if (abonos.length === 0 && rawAnticipo > 0) {
          abonos.push({
            id: 'ABO-1',
            fecha: p.fechaRegistro || p.fechaCreacion || new Date().toISOString(),
            concepto: 'Anticipo Inicial',
            monto: rawAnticipo,
            metodoPago: (p.metodoPagoAnticipo || 'EFECTIVO').toUpperCase()
          });
        } else if (rawAnticipo > totalAbonos) {
          const diferencia = Math.round((rawAnticipo - totalAbonos) * 100) / 100;
          abonos.unshift({
            id: 'ABO-1',
            fecha: p.fechaRegistro || p.fechaCreacion || new Date().toISOString(),
            concepto: 'Anticipo Inicial',
            monto: diferencia,
            metodoPago: (p.metodoPagoAnticipo || 'EFECTIVO').toUpperCase()
          });
        }

        const ant = Math.round(abonos.reduce((acc, a) => acc + (a.monto || 0), 0) * 100) / 100;
        const saldoRestante = Math.max(0, Math.round((total - ant) * 100) / 100);

        return {
          id: p.id || p.folio || `PED-${String(idx + 1).padStart(4, '0')}`,
          clienteNombre: cliNombre,
          clienteTelefono: cliTel || '',
          fechaRegistro: p.fechaRegistro || p.fechaCreacion || new Date().toISOString(),
          fechaEntrega: p.fechaEntrega || p.fechaEntregaEstimada || '',
          especificaciones: p.especificaciones || '',
          estado: estado as any,
          materiasPrimas,
          totalAcordado: total,
          anticipo: ant,
          saldoRestante,
          abonos,
          metodoPagoAnticipo: p.metodoPagoAnticipo || (abonos.length > 0 ? abonos[0].metodoPago : 'EFECTIVO'),
          metodoPagoLiquidacion: p.metodoPagoLiquidacion || '',
          fechaLiquidacion: p.fechaLiquidacion || '',
          insumosDescontados: Boolean(p.insumosDescontados),
          sucursalId: p.sucursalId || 'SUC-MAIN',
          sucursalNombre: p.sucursalNombre || 'Principal'
        };
      });

      this.pedidosService.setPedidos(pedidos);
      await this.firestoreService.guardarColeccionChunked('pedidos', pedidos, 30);
      pedidosRestaurados = pedidos.length;
    }

    // 7. Configuración General y Listas
    if (opciones.restaurarConfiguracion) {
      const configRaw = data.config || data.general || {};
      const configToSave: ConfigSistema = {
        businessName: configRaw.businessName || data.businessName || data.nombreNegocio || (this.sucursalesService.sucursales()[0]?.nombre) || 'Mi Negocio',
        businessPhone: configRaw.businessPhone || data.businessPhone || data.telefono || (this.sucursalesService.sucursales()[0]?.telefono) || '',
        fiscalLegend: configRaw.fiscalLegend || data.fiscalLegend || data.leyendaTicket || '¡Gracias por su compra!'
      };

      const listasRaw = data.listas || {};
      const listasToSave: ListasConfig = {
        unidades: Array.isArray(listasRaw.unidades) && listasRaw.unidades.length > 0 ? listasRaw.unidades : DEFAULT_LISTAS.unidades,
        grupos: Array.isArray(listasRaw.grupos) && listasRaw.grupos.length > 0 ? listasRaw.grupos : DEFAULT_LISTAS.grupos
      };

      this.configSignal.set(configToSave);
      this.listasSignal.set(listasToSave);

      const generalRef = this.firestoreService.getRefDocConfig('general');
      await setDoc(generalRef, this.firestoreService.sanitizarParaFirestore({
        config: configToSave,
        listas: listasToSave,
        actualizadoEn: new Date().toISOString()
      }), { merge: true });
      configRestaurada = true;
    }

    // 8. Bitácora y Auditoría de Actividades
    let bitacoraRestaurada = 0;
    if (opciones.restaurarBitacora) {
      const rawBitacora = normalizar(data.bitacora, data.auditoria, data.bitacoraEventos, data.log);
      const bitacora = rawBitacora.map((b: any, idx: number) => ({
        id: b.id || `BIT-${String(idx + 1).padStart(4, '0')}`,
        fecha: b.fecha || new Date().toISOString(),
        modulo: b.modulo || 'SISTEMA',
        accion: b.accion || 'EVENTO',
        descripcion: b.descripcion || 'Evento restaurado de copia de seguridad',
        detalles: b.detalles || null,
        usuario: b.usuario || 'Usuario POS',
        dispositivo: b.dispositivo || 'Dispositivo',
        sucursalId: b.sucursalId || 'SUC-MAIN',
        sucursalNombre: b.sucursalNombre || 'Matriz Principal',
        nivel: b.nivel || 'INFO'
      }));

      this.bitacoraService.setEventos(bitacora);
      await Promise.all([
        this.firestoreService.guardarColeccionChunked('bitacora', bitacora),
        setDoc(this.firestoreService.getRefDocConfig('bitacoraReciente'), {
          items: bitacora.slice(0, 150),
          total: bitacora.length,
          actualizadoEn: new Date().toISOString()
        }, { merge: true })
      ]);
      bitacoraRestaurada = bitacora.length;
    }

    await this.syncService.incrementarRevision();
    this.syncService.setStatus('online', 'En Línea');

    return {
      productosCount: productosRestaurados,
      ventasCount: ventasRestauradas,
      gastosCount: gastosRestaurados,
      movimientosCount: movimientosRestaurados,
      cortesCount: cortesRestaurados,
      pedidosCount: pedidosRestaurados,
      sucursalesCount: sucursalesRestauradas,
      bitacoraCount: bitacoraRestaurada,
      configRestaurada
    };
  }

  async restaurarBackupDesdeJSON(file: File): Promise<{
    productosCount: number;
    ventasCount: number;
    gastosCount: number;
    movimientosCount: number;
    cortesCount: number;
    bitacoraCount?: number;
  }> {
    const text = await file.text();
    const data = JSON.parse(text);
    const resultado = await this.restaurarBackupSeleccionado(data, {
      restaurarProductos: true,
      restaurarVentas: true,
      restaurarMovimientos: true,
      restaurarGastos: true,
      restaurarCortes: true,
      restaurarPedidos: true,
      restaurarSucursales: true,
      restaurarConfiguracion: true,
      restaurarBitacora: true
    });
    return resultado;
  }

  // ── Mantenimiento y Resets Periódicos ───────────────────────
  async realizarResetPeriodico(tipo: 'simplificar_movimientos' | 'reset_operativo' | 'reset_total'): Promise<void> {
    // 1. Descarga de respaldo de seguridad previa
    this.descargarBackupJSON();

    if (tipo === 'simplificar_movimientos') {
      const movimientosIniciales = this.productosService.productos().map((p) => ({
        id: `MOV-INIT-${Date.now()}-${p.codigo}`,
        fecha: new Date().toISOString(),
        tipo: 'INICIAL' as const,
        codigo: p.codigo,
        nombre: p.nombre,
        cantidad: p.stockActual,
        stockAnterior: p.stockActual,
        stockNuevo: p.stockActual,
        motivo: 'Consolidación periódica de movimientos',
        sucursalId: 'SUC-MAIN'
      }));
      await this.firestoreService.guardarColeccionChunked('movimientos', movimientosIniciales);
      this.movimientosService.setMovimientos(movimientosIniciales as any);
    } else if (tipo === 'reset_operativo') {
      this.syncService.setStatus('saving', 'Ejecutando Reset Operativo...');

      // 1. Filtrar pedidos que se encuentren PENDIENTES o EN PROCESO o con saldo restante pendiente
      const pedidosPendientes = this.pedidosService.pedidos().filter(
        (p) => p.estado === 'PENDIENTE' || p.estado === 'EN_PROCESO' || ((p.saldoRestante || 0) > 0 && p.estado !== 'CANCELADO')
      );

      // 2. Guardar pedidos pendientes en Firestore (chunks de 30)
      await this.firestoreService.guardarColeccionChunked('pedidos', pedidosPendientes, 30);
      this.pedidosService.setPedidos(pedidosPendientes);

      // 3. Eliminar todas las ventas y carritos pendientes
      await this.firestoreService.guardarColeccionChunked('ventas', []);
      this.ventasService.setVentas([]);
      await setDoc(this.firestoreService.getRefDocConfig('carritosPendientes'), {
        items: [],
        actualizadoEn: new Date().toISOString()
      });

      // 4. Eliminar gastos
      await this.firestoreService.guardarColeccionChunked('gastos', []);
      this.gastosService.setGastos([]);

      // 5. Eliminar cortes cerrados y limpiar corte activo
      await this.firestoreService.guardarColeccionChunked('cortes', []);
      this.cortesService.setCortes([]);
      await setDoc(this.firestoreService.getRefDocConfig('corteActivo'), {});

      // 6. Vaciar historial de movimientos de inventario (el stock actual reside directamente en los productos)
      await this.firestoreService.guardarColeccionChunked('movimientos', []);
      this.movimientosService.setMovimientos([]);
    } else if (tipo === 'reset_total') {
      this.syncService.setStatus('saving', 'Borrando toda la base de datos de fábrica...');
      await this.firestoreService.borrarTodaBaseDeDatosEmpresa();
      this.productosService.setProductos([]);
      this.ventasService.setVentas([]);
      this.gastosService.setGastos([]);
      this.movimientosService.setMovimientos([]);
      this.cortesService.setCortes([]);
      this.pedidosService.setPedidos([]);
    }

    await this.syncService.incrementarRevision();
    window.location.reload();
  }
}
