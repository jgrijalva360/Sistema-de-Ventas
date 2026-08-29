import { Injectable, signal } from '@angular/core';
import { PedidoPersonalizado, AbonoPedido, MateriaPrimaItem, Venta, PagosDetalle } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { ProductosService } from './productos.service';
import { SucursalesService } from './sucursales.service';
import { VentasService } from './ventas.service';
import { SyncService } from './sync.service';
import { getDoc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { docStream$ } from '../utils/realtime.util';
import { generarSiguienteConsecutivo, generarSiguienteAbonoId } from '../utils/consecutivo.util';

import { BitacoraService } from './bitacora.service';

export interface ItemVentaConsolidacion {
  id: string;
  pedidoId: string;
  clienteNombre: string;
  concepto: string;
  fecha: string;
  monto: number;
  metodoPago: string;
  sucursalNombre: string;
  ventaCompleta: Venta;
}

export interface AnalisisConsolidacion {
  pedidosAnalizados: number;
  abonosAnalizados: number;
  ventasExistentes: number;
  ventasNuevas: ItemVentaConsolidacion[];
  montoTotalNuevas: number;
}

@Injectable({
  providedIn: 'root'
})
export class PedidosService {
  private pedidosSignal = signal<PedidoPersonalizado[]>([]);
  public pedidos = this.pedidosSignal.asReadonly();

  private subLive?: Subscription;

  constructor(
    private firestoreService: FirestoreChunksService,
    private productosService: ProductosService,
    private sucursalesService: SucursalesService,
    private ventasService: VentasService,
    private syncService: SyncService,
    private bitacoraService: BitacoraService
  ) {}

  normalizarPedido(p: any): PedidoPersonalizado {
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

    const total = typeof p.totalAcordado === 'number' ? p.totalAcordado : parseFloat(p.totalAcordado || p.precioTotal) || 0;
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

    const rawMP = Array.isArray(p.materiasPrimas) ? p.materiasPrimas : [];
    const materiasPrimas: MateriaPrimaItem[] = rawMP.map((mp: any) => ({
      tipo: mp.tipo || (mp.esExtra ? 'EXTRA' : (mp.codigo ? 'INVENTARIO' : 'EXTRA')),
      codigo: mp.codigo || '',
      nombre: mp.nombre || 'Insumo',
      cantidad: Number(mp.cantidad) || 1,
      precioUnitario: Number(mp.precioUnitario) || 0,
      subtotal: Number(mp.subtotal) || (Number(mp.cantidad) || 1) * (Number(mp.precioUnitario) || 0)
    }));

    return {
      id: String(p.id || p.folio || `PED-${Date.now()}`),
      clienteNombre: p.clienteNombre || (typeof p.cliente === 'object' ? p.cliente?.nombre : p.cliente) || 'Cliente',
      clienteTelefono: p.clienteTelefono || (typeof p.cliente === 'object' ? p.cliente?.telefono : '') || '',
      fechaRegistro: p.fechaRegistro || p.fechaCreacion || new Date().toISOString(),
      fechaEntrega: p.fechaEntrega || p.fechaEntregaEstimada || '',
      especificaciones: p.especificaciones || '',
      estado: p.estado || 'PENDIENTE',
      materiasPrimas,
      totalAcordado: total,
      anticipo: ant,
      saldoRestante,
      abonos,
      metodoPagoAnticipo: p.metodoPagoAnticipo || (abonos.length > 0 ? abonos[0].metodoPago : 'EFECTIVO'),
      metodoPagoLiquidacion: p.metodoPagoLiquidacion,
      fechaLiquidacion: p.fechaLiquidacion,
      insumosDescontados: Boolean(p.insumosDescontados),
      sucursalId: p.sucursalId || 'SUC-MAIN',
      sucursalNombre: p.sucursalNombre || 'Principal'
    };
  }

  validarYLimpiarDuplicados(list: any[]): PedidoPersonalizado[] {
    if (!Array.isArray(list)) return [];
    const ids = new Set<string>();
    const limpios: PedidoPersonalizado[] = [];

    for (const item of list) {
      if (!item) continue;
      const p = this.normalizarPedido(item);
      const id = (p.id || '').trim();
      if (id && ids.has(id)) continue;
      if (id) ids.add(id);
      limpios.push(p);
    }
    return limpios;
  }

  setPedidos(list: PedidoPersonalizado[]): void {
    if (Array.isArray(list)) {
      this.pedidosSignal.set(this.validarYLimpiarDuplicados(list));
    }
  }

  async cargarPedidos(): Promise<PedidoPersonalizado[]> {
    try {
      const ref = this.firestoreService.getRefDocConfig('pedidosPersonalizados');
      const snap = await getDoc(ref);
      if (snap.exists() && Array.isArray(snap.data()['items'])) {
        const list = snap.data()['items'] as PedidoPersonalizado[];
        const limpios = this.validarYLimpiarDuplicados(list);
        this.pedidosSignal.set(limpios);
        return limpios;
      }
    } catch (_) {}

    const rawList = await this.firestoreService.cargarColeccionChunked<PedidoPersonalizado>('pedidosPersonalizados');
    const list = this.validarYLimpiarDuplicados(rawList);
    this.pedidosSignal.set(list);
    return list;
  }

  async crearPedido(
    pedido: Omit<PedidoPersonalizado, 'id' | 'fechaRegistro' | 'sucursalId' | 'sucursalNombre'>
  ): Promise<PedidoPersonalizado> {
    const sucursal = this.sucursalesService.sucursalActiva();
    const nuevoId = generarSiguienteConsecutivo(this.pedidosSignal().map((p) => p.id), 'PED', 4);
    const fechaActual = new Date().toISOString();

    const abonosIniciales = pedido.anticipo > 0 ? [
      {
        id: `ABO-1`,
        fecha: fechaActual,
        concepto: 'Anticipo Inicial',
        monto: pedido.anticipo,
        metodoPago: pedido.metodoPagoAnticipo || 'EFECTIVO'
      }
    ] : [];

    const nuevoPedido: PedidoPersonalizado = {
      ...pedido,
      id: nuevoId,
      fechaRegistro: fechaActual,
      abonos: abonosIniciales,
      insumosDescontados: false,
      sucursalId: sucursal.id,
      sucursalNombre: sucursal.nombre
    };

    const current = [nuevoPedido, ...this.pedidosSignal()];
    this.pedidosSignal.set(current);
    await this.guardarEnFirestore(current);

    // Registrar en Bitácora
    await this.bitacoraService.registrarEvento({
      modulo: 'PEDIDOS',
      accion: 'CREAR',
      descripcion: `Pedido #${nuevoPedido.id} creado para cliente "${nuevoPedido.clienteNombre}" por $${nuevoPedido.totalAcordado.toFixed(2)}. Anticipo: $${nuevoPedido.anticipo.toFixed(2)}`,
      detalles: nuevoPedido,
      sucursalId: nuevoPedido.sucursalId,
      sucursalNombre: nuevoPedido.sucursalNombre
    });

    // Si tiene anticipo inicial, registrarlo en Ventas
    if (pedido.anticipo > 0) {
      await this.ventasService.registrarPagoPedido({
        pedidoId: nuevoPedido.id,
        clienteNombre: nuevoPedido.clienteNombre,
        concepto: 'Anticipo Inicial',
        monto: pedido.anticipo,
        metodoPago: pedido.metodoPagoAnticipo || 'EFECTIVO',
        sucursalId: nuevoPedido.sucursalId,
        sucursalNombre: nuevoPedido.sucursalNombre
      });
    }

    return nuevoPedido;
  }

  async actualizarEstado(id: string, nuevoEstado: PedidoPersonalizado['estado']): Promise<PedidoPersonalizado | null> {
    const current = [...this.pedidosSignal()];
    const pedido = current.find((p) => p.id === id);
    if (!pedido) return null;

    // No permitir marcar como ENTREGADO si tiene saldo pendiente
    if (nuevoEstado === 'ENTREGADO' && (pedido.saldoRestante || 0) > 0) {
      return null;
    }

    const estadoAnterior = pedido.estado;
    pedido.estado = nuevoEstado;

    // Descontar inventario si avanza a EN_PROCESO, TERMINADO o ENTREGADO y aún no se había descontado
    const estadosAvanzados = ['EN_PROCESO', 'TERMINADO', 'LISTO', 'ENTREGADO'];
    if (estadosAvanzados.includes(nuevoEstado) && !pedido.insumosDescontados) {
      const insumosInventario = (pedido.materiasPrimas || [])
        .filter((mp) => mp.tipo === 'INVENTARIO' && mp.codigo)
        .map((mp) => ({ codigo: mp.codigo!, cantidad: mp.cantidad }));

      if (insumosInventario.length > 0) {
        await this.productosService.descontarStockVenta(insumosInventario, pedido.sucursalId || 'SUC-MAIN');
        pedido.insumosDescontados = true;
      }
    }

    this.pedidosSignal.set(current);
    await this.guardarEnFirestore(current);

    // Registrar en Bitácora
    await this.bitacoraService.registrarEvento({
      modulo: 'PEDIDOS',
      accion: 'EDITAR',
      descripcion: `Pedido #${pedido.id} cambió de estado: ${estadoAnterior} ➔ ${nuevoEstado}`,
      detalles: { id: pedido.id, estadoAnterior, nuevoEstado },
      sucursalId: pedido.sucursalId,
      sucursalNombre: pedido.sucursalNombre
    });

    return pedido;
  }

  async agregarAbono(
    id: string,
    monto: number,
    metodoPago: string,
    concepto: string = 'Abono a cuenta'
  ): Promise<PedidoPersonalizado | null> {
    const current = [...this.pedidosSignal()];
    const pedido = current.find((p) => p.id === id);
    if (!pedido || monto <= 0) return null;

    if (!pedido.abonos) pedido.abonos = [];
    const nuevoAbonoId = generarSiguienteAbonoId(pedido.abonos);

    const nuevoAbono: AbonoPedido = {
      id: nuevoAbonoId,
      fecha: new Date().toISOString(),
      concepto: concepto.trim() || 'Abono a cuenta',
      monto: Math.round(monto * 100) / 100,
      metodoPago: (metodoPago || 'EFECTIVO').toUpperCase()
    };

    pedido.abonos.push(nuevoAbono);

    pedido.anticipo = Math.round(((pedido.anticipo || 0) + monto) * 100) / 100;
    pedido.saldoRestante = Math.max(0, Math.round((pedido.totalAcordado - pedido.anticipo) * 100) / 100);

    if (pedido.saldoRestante <= 0 && pedido.estado !== 'CANCELADO') {
      pedido.fechaLiquidacion = new Date().toISOString();
      pedido.metodoPagoLiquidacion = nuevoAbono.metodoPago;
    }

    this.pedidosSignal.set(current);
    await this.guardarEnFirestore(current);

    // Registrar en ventas para reflejar en corte de caja, balance y reportes
    await this.ventasService.registrarPagoPedido({
      pedidoId: pedido.id,
      abonoId: nuevoAbono.id,
      fecha: nuevoAbono.fecha,
      clienteNombre: pedido.clienteNombre,
      concepto: nuevoAbono.concepto,
      monto: nuevoAbono.monto,
      metodoPago: nuevoAbono.metodoPago,
      sucursalId: pedido.sucursalId,
      sucursalNombre: pedido.sucursalNombre
    });

    return pedido;
  }

  async actualizarPedidoCompleto(
    id: string,
    cambios: Partial<PedidoPersonalizado>
  ): Promise<PedidoPersonalizado | null> {
    const current = [...this.pedidosSignal()];
    const index = current.findIndex((p) => p.id === id);
    if (index === -1) return null;

    const actualizado: PedidoPersonalizado = {
      ...current[index],
      ...cambios
    };
    actualizado.saldoRestante = Math.max(
      0,
      Math.round(((actualizado.totalAcordado || 0) - (actualizado.anticipo || 0)) * 100) / 100
    );

    current[index] = actualizado;
    this.pedidosSignal.set(current);
    await this.guardarEnFirestore(current);
    return actualizado;
  }

  async liquidarPedido(id: string, metodoPago: string): Promise<PedidoPersonalizado | null> {
    const current = [...this.pedidosSignal()];
    const pedido = current.find((p) => p.id === id);
    if (!pedido) return null;

    const saldoPendiente = pedido.saldoRestante;
    const metodo = (metodoPago || 'EFECTIVO').toUpperCase();

    if (saldoPendiente > 0) {
      if (!pedido.abonos) pedido.abonos = [];
      const nuevoAbonoId = generarSiguienteAbonoId(pedido.abonos);

      const nuevoAbono: AbonoPedido = {
        id: nuevoAbonoId,
        fecha: new Date().toISOString(),
        concepto: 'Liquidación Final',
        monto: saldoPendiente,
        metodoPago: metodo
      };

      pedido.abonos.push(nuevoAbono);

      await this.ventasService.registrarPagoPedido({
        pedidoId: pedido.id,
        abonoId: nuevoAbono.id,
        fecha: nuevoAbono.fecha,
        clienteNombre: pedido.clienteNombre,
        concepto: 'Liquidación Final',
        monto: saldoPendiente,
        metodoPago: metodo,
        sucursalId: pedido.sucursalId,
        sucursalNombre: pedido.sucursalNombre
      });
    }

    pedido.anticipo = pedido.totalAcordado;
    pedido.saldoRestante = 0;
    pedido.metodoPagoLiquidacion = metodo;
    pedido.fechaLiquidacion = new Date().toISOString();
    pedido.estado = 'ENTREGADO';

    // Descontar inventario si aún no se había descontado
    if (!pedido.insumosDescontados) {
      const insumosInventario = (pedido.materiasPrimas || [])
        .filter((mp) => mp.tipo === 'INVENTARIO' && mp.codigo)
        .map((mp) => ({ codigo: mp.codigo!, cantidad: mp.cantidad }));

      if (insumosInventario.length > 0) {
        await this.productosService.descontarStockVenta(insumosInventario, pedido.sucursalId || 'SUC-MAIN');
        pedido.insumosDescontados = true;
      }
    }

    this.pedidosSignal.set(current);
    await this.guardarEnFirestore(current);
    return pedido;
  }

  async eliminarPedido(id: string): Promise<void> {
    const pedidoEliminado = this.pedidosSignal().find((p) => p.id === id);
    const current = this.pedidosSignal().filter((p) => p.id !== id);
    this.pedidosSignal.set(current);
    await this.guardarEnFirestore(current);

    if (pedidoEliminado) {
      await this.bitacoraService.registrarEvento({
        modulo: 'PEDIDOS',
        accion: 'ELIMINAR',
        descripcion: `Pedido #${id} de "${pedidoEliminado.clienteNombre}" eliminado`,
        detalles: pedidoEliminado,
        sucursalId: pedidoEliminado.sucursalId,
        sucursalNombre: pedidoEliminado.sucursalNombre
      });
    }
  }

  private async guardarEnFirestore(pedidosList: PedidoPersonalizado[]): Promise<void> {
    try {
      this.syncService.setStatus('saving', 'Guardando pedidos...');
      const ref = this.firestoreService.getRefDocConfig('pedidosPersonalizados');
      const cleanList = JSON.parse(JSON.stringify(pedidosList));
      await setDoc(ref, {
        items: cleanList,
        actualizadoEn: new Date().toISOString()
      }, { merge: true });
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');
    } catch (e) {
      console.error('Error al guardar pedidos en Firestore:', e);
      this.syncService.setStatus('offline', 'Error al guardar');
    }
  }

  /**
   * Analiza todos los pedidos y sus abonos para generar una vista previa detallada
   * de qué ventas se crearían sin aplicar cambios todavía.
   */
  analizarAbonosPendientesDeConsolidar(): AnalisisConsolidacion {
    const pedidos = this.pedidosSignal();
    const ventasActuales = [...this.ventasService.ventas()];
    const ventaIdsSet = new Set(ventasActuales.map((v) => (v.id || '').trim()));

    let abonosAnalizados = 0;
    let ventasExistentes = 0;
    let montoTotalNuevas = 0;
    const ventasNuevas: ItemVentaConsolidacion[] = [];

    for (const ped of pedidos) {
      const abonosList: { id: string; fecha: string; concepto: string; monto: number; metodoPago: string }[] = [];

      if (Array.isArray(ped.abonos) && ped.abonos.length > 0) {
        for (const abo of ped.abonos) {
          if ((abo.monto || 0) > 0) {
            abonosList.push({
              id: abo.id || `ABO-1`,
              fecha: abo.fecha || ped.fechaRegistro || new Date().toISOString(),
              concepto: abo.concepto || 'Abono a cuenta',
              monto: Number(abo.monto) || 0,
              metodoPago: abo.metodoPago || 'EFECTIVO'
            });
          }
        }
      } else if ((ped.anticipo || 0) > 0) {
        // Pedido con anticipo pero sin desglose de abonos
        abonosList.push({
          id: 'ABO-ANTICIPO-INI',
          fecha: ped.fechaRegistro || new Date().toISOString(),
          concepto: 'Anticipo Inicial',
          monto: Number(ped.anticipo) || 0,
          metodoPago: ped.metodoPagoAnticipo || 'EFECTIVO'
        });
      }

      for (const abo of abonosList) {
        abonosAnalizados++;
        const monto = Math.round(abo.monto * 100) / 100;
        if (monto <= 0) continue;

        const idEstandar = `V-PED-${ped.id}-${abo.id}`;

        const yaExiste =
          ventaIdsSet.has(idEstandar) ||
          ventasActuales.some((v) => {
            if (v.id === idEstandar) return true;
            const itemMatch = (v.items || []).some(
              (it) => it.codigo === ped.id && Math.abs((it.subtotal || v.total) - monto) < 0.01
            );
            if (!itemMatch) return false;
            const vTime = new Date(v.fecha).getTime();
            const aTime = new Date(abo.fecha).getTime();
            if (!isNaN(vTime) && !isNaN(aTime) && Math.abs(vTime - aTime) < 86400000 * 3) {
              return true;
            }
            return (v.items || []).some((it) => (it.nombre || '').includes(ped.id));
          });

        if (yaExiste) {
          ventasExistentes++;
        } else {
          const met = (abo.metodoPago || 'EFECTIVO').toUpperCase();
          const pagos: PagosDetalle = {
            efectivo: met === 'EFECTIVO' ? monto : 0,
            tarjeta: met === 'TARJETA' ? monto : 0,
            transferencia: met === 'TRANSFERENCIA' ? monto : 0
          };

          const nuevoFolioVenta = generarSiguienteConsecutivo([...ventaIdsSet], 'V', 4);

          const nuevaVenta: Venta = {
            id: nuevoFolioVenta,
            fecha: abo.fecha || ped.fechaRegistro || new Date().toISOString(),
            items: [
              {
                codigo: ped.id,
                nombre: `${abo.concepto} (${ped.id}) - ${ped.clienteNombre}`,
                cantidad: 1,
                precioUnitario: monto,
                subtotal: monto
              }
            ],
            total: monto,
            totalPagado: monto,
            cambio: 0,
            pagos,
            sucursalId: ped.sucursalId || 'SUC-MAIN',
            sucursalNombre: ped.sucursalNombre || 'Matriz Principal',
            usuario: 'Cajero'
          };

          ventasNuevas.push({
            id: nuevoFolioVenta,
            pedidoId: ped.id,
            clienteNombre: ped.clienteNombre,
            concepto: abo.concepto,
            fecha: abo.fecha,
            monto,
            metodoPago: met,
            sucursalNombre: ped.sucursalNombre || 'Matriz Principal',
            ventaCompleta: nuevaVenta
          });

          ventaIdsSet.add(nuevoFolioVenta);
          montoTotalNuevas += monto;
        }
      }
    }

    return {
      pedidosAnalizados: pedidos.length,
      abonosAnalizados,
      ventasExistentes,
      ventasNuevas,
      montoTotalNuevas: Math.round(montoTotalNuevas * 100) / 100
    };
  }

  /**
   * Aplica la consolidación de la lista seleccionada de ventas a Firestore.
   */
  async aplicarConsolidacionVentas(ventasAAgregar: Venta[]): Promise<number> {
    if (!ventasAAgregar || ventasAAgregar.length === 0) return 0;
    const ventasActuales = [...this.ventasService.ventas(), ...ventasAAgregar];
    ventasActuales.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

    this.ventasService.setVentas(ventasActuales);
    await this.firestoreService.guardarColeccionChunked('ventas', ventasActuales);
    await this.syncService.incrementarRevision();
    this.syncService.setStatus('online', 'En Línea');
    return ventasAAgregar.length;
  }

  /**
   * Método directo de consolidación completa.
   */
  async consolidarAbonosEnVentas(): Promise<{
    pedidosAnalizados: number;
    abonosAnalizados: number;
    ventasAgregadas: number;
    ventasExistentes: number;
    montoTotalConsolidado: number;
  }> {
    const analisis = this.analizarAbonosPendientesDeConsolidar();
    if (analisis.ventasNuevas.length > 0) {
      await this.aplicarConsolidacionVentas(analisis.ventasNuevas.map((v) => v.ventaCompleta));
    }
    return {
      pedidosAnalizados: analisis.pedidosAnalizados,
      abonosAnalizados: analisis.abonosAnalizados,
      ventasAgregadas: analisis.ventasNuevas.length,
      ventasExistentes: analisis.ventasExistentes,
      montoTotalConsolidado: analisis.montoTotalNuevas
    };
  }

  iniciarEscuchadorLive(): void {
    if (this.subLive) this.subLive.unsubscribe();

    const ref = this.firestoreService.getRefDocConfig('pedidosPersonalizados');
    this.subLive = docStream$(ref).subscribe({
      next: (docSnap) => {
        if (docSnap.exists() && Array.isArray(docSnap.data()['items'])) {
          this.pedidosSignal.set(this.validarYLimpiarDuplicados(docSnap.data()['items']));
        }
      },
      error: (err) => console.error('Error en stream de pedidos:', err)
    });
  }
}
