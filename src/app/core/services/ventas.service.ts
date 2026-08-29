import { Injectable, signal, computed } from '@angular/core';
import { Venta, ItemCarrito, CarritoPendiente, PagosDetalle } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { ProductosService } from './productos.service';
import { SucursalesService } from './sucursales.service';
import { SyncService } from './sync.service';
import { doc, setDoc, onSnapshot, query, where, Unsubscribe } from 'firebase/firestore';
import { getFechaLocalString } from '../../shared/utils/date.util';
import { Subscription } from 'rxjs';
import { collectionStream$, docStream$ } from '../utils/realtime.util';
import { generarSiguienteConsecutivo } from '../utils/consecutivo.util';

import { BitacoraService } from './bitacora.service';

@Injectable({
  providedIn: 'root'
})
export class VentasService {
  // Carrito Activo
  public carrito = signal<ItemCarrito[]>([]);
  public pagos = signal<PagosDetalle>({ efectivo: 0, tarjeta: 0, transferencia: 0 });

  // Historial de Ventas y Carritos Pendientes
  private ventasSignal = signal<Venta[]>([]);
  private carritosPendientesSignal = signal<CarritoPendiente[]>([]);

  public ventas = this.ventasSignal.asReadonly();
  public carritosPendientes = this.carritosPendientesSignal.asReadonly();

  private subLiveVentas?: Subscription;
  private subLiveCarritos?: Subscription;

  // Computados
  public totalCarrito = computed(() => {
    return this.carrito().reduce((acc, item) => acc + item.subtotal, 0);
  });

  public totalPagado = computed(() => {
    const p = this.pagos();
    return (p.efectivo || 0) + (p.tarjeta || 0) + (p.transferencia || 0);
  });

  public cambio = computed(() => {
    const total = this.totalCarrito();
    const pagado = this.totalPagado();
    return Math.max(0, pagado - total);
  });

  public faltante = computed(() => {
    const tot = this.totalCarrito();
    const pag = this.totalPagado();
    return Math.max(0, tot - pag);
  });

  public ventasDeHoy = computed(() => {
    const hoyStr = getFechaLocalString();
    return this.ventasSignal()
      .filter((v) => {
        if (!v.fecha) return false;
        try {
          const vDate = getFechaLocalString(v.fecha);
          return vDate === hoyStr;
        } catch {
          return false;
        }
      })
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  });

  public totalVentasHoy = computed(() => {
    return this.ventasDeHoy().reduce((acc, v) => acc + (v.total || 0), 0);
  });

  public ventasRecientes = computed(() => {
    return [...this.ventasSignal()]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 15);
  });

  private unsubLiveVentas?: Unsubscribe;
  private unsubLiveCarritos?: Unsubscribe;

  constructor(
    private firestoreService: FirestoreChunksService,
    private productosService: ProductosService,
    private sucursalesService: SucursalesService,
    private syncService: SyncService,
    private bitacoraService: BitacoraService
  ) {}

  // ── Gestión de Carrito ─────────────────────────────────────
  agregarAlCarrito(codigo: string, cantidad = 1, precioManual?: number): boolean {
    const prod = this.productosService.obtenerPorCodigo(codigo);
    if (!prod) return false;

    const current = [...this.carrito()];
    const idx = current.findIndex((item) => item.codigo === prod.codigo);
    const precioUnitario = typeof precioManual === 'number' ? precioManual : prod.precioVenta;

    if (idx >= 0) {
      current[idx].cantidad += cantidad;
      current[idx].subtotal = current[idx].cantidad * current[idx].precioUnitario;
    } else {
      current.push({
        codigo: prod.codigo,
        nombre: prod.nombre,
        cantidad,
        precioUnitario,
        subtotal: cantidad * precioUnitario,
        precioVariable: prod.precioVariable
      });
    }

    this.carrito.set(current);
    this.ajustarPagoEfectivoPorDefecto();
    return true;
  }

  eliminarDelCarrito(index: number): void {
    const current = this.carrito().filter((_, i) => i !== index);
    this.carrito.set(current);
    this.ajustarPagoEfectivoPorDefecto();
  }

  actualizarCantidadItem(index: number, nuevaCantidad: number): void {
    const current = [...this.carrito()];
    if (current[index] && nuevaCantidad > 0) {
      current[index].cantidad = nuevaCantidad;
      current[index].subtotal = nuevaCantidad * current[index].precioUnitario;
      this.carrito.set(current);
      this.ajustarPagoEfectivoPorDefecto();
    }
  }

  limpiarCarrito(): void {
    this.carrito.set([]);
    this.pagos.set({ efectivo: 0, tarjeta: 0, transferencia: 0 });
  }

  ajustarPagoEfectivoPorDefecto(): void {
    const tot = this.totalCarrito();
    this.pagos.set({ efectivo: tot, tarjeta: 0, transferencia: 0 });
  }

  // ── Procesamiento de Venta ────────────────────────────────
  async procesarVenta(): Promise<Venta> {
    const items = [...this.carrito()];
    if (items.length === 0) throw new Error('El carrito está vacío.');

    const total = this.totalCarrito();
    const pagado = this.totalPagado();
    if (pagado < total) throw new Error(`El pago es insuficiente. Falta $${(total - pagado).toFixed(2)}`);

    const sucursal = this.sucursalesService.sucursalActiva();
    const nuevoId = generarSiguienteConsecutivo(this.ventasSignal().map((v) => v.id), 'V', 4);
    
    const nuevaVenta: Venta = {
      id: nuevoId,
      fecha: new Date().toISOString(),
      items,
      total,
      totalPagado: pagado,
      cambio: this.cambio(),
      pagos: { ...this.pagos() },
      sucursalId: sucursal.id,
      sucursalNombre: sucursal.nombre
    };

    // 1. Guardar local y actualizar lista
    const currentVentas = [nuevaVenta, ...this.ventasSignal()];
    this.ventasSignal.set(currentVentas);

    // 2. Descontar stock de la sucursal activa
    await this.productosService.descontarStockVenta(items, sucursal.id);

    // 3. Guardar en Firestore: chunks_ventas
    try {
      this.syncService.setStatus('saving', 'Registrando venta...');
      await this.firestoreService.guardarColeccionChunked('ventas', currentVentas);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      // Registrar en Bitácora
      await this.bitacoraService.registrarEvento({
        modulo: 'VENTAS',
        accion: 'CREAR',
        descripcion: `Venta #${nuevaVenta.id} registrada por $${nuevaVenta.total.toFixed(2)} (${items.length} artículos)`,
        detalles: {
          folio: nuevaVenta.id,
          total: nuevaVenta.total,
          itemsCount: items.length,
          pagos: nuevaVenta.pagos
        },
        sucursalId: sucursal.id,
        sucursalNombre: sucursal.nombre
      });
    } catch (e) {
      console.warn('Error al persistir venta en Firestore:', e);
    }

    this.limpiarCarrito();
    return nuevaVenta;
  }

  // ── Registrar Pago / Abono de Pedido en Ventas ──────────────
  async registrarPagoPedido(params: {
    pedidoId: string;
    abonoId?: string;
    fecha?: string;
    clienteNombre: string;
    concepto: string;
    monto: number;
    metodoPago: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | string;
    sucursalId?: string;
    sucursalNombre?: string;
  }): Promise<Venta> {
    const monto = Number(params.monto) || 0;
    if (monto <= 0) {
      throw new Error('El monto del abono o pago debe ser mayor a cero.');
    }

    const sucursal = this.sucursalesService.sucursalActiva();
    const sucursalId = params.sucursalId || sucursal.id;
    const sucursalNombre = params.sucursalNombre || sucursal.nombre;

    const met = (params.metodoPago || 'EFECTIVO').toUpperCase();
    const pagos: PagosDetalle = {
      efectivo: met === 'EFECTIVO' ? monto : 0,
      tarjeta: met === 'TARJETA' ? monto : 0,
      transferencia: met === 'TRANSFERENCIA' ? monto : 0
    };

    const ventaId = generarSiguienteConsecutivo(this.ventasSignal().map((v) => v.id), 'V', 4);

    const nuevaVenta: Venta = {
      id: ventaId,
      fecha: params.fecha || new Date().toISOString(),
      items: [
        {
          codigo: params.pedidoId,
          nombre: `${params.concepto} (${params.pedidoId}) - ${params.clienteNombre}`,
          cantidad: 1,
          precioUnitario: monto,
          subtotal: monto
        }
      ],
      total: monto,
      totalPagado: monto,
      cambio: 0,
      pagos,
      sucursalId,
      sucursalNombre,
      usuario: 'Cajero'
    };

    const currentVentas = [nuevaVenta, ...this.ventasSignal()];
    this.ventasSignal.set(currentVentas);

    try {
      this.syncService.setStatus('saving', 'Registrando ingreso en ventas...');
      await this.firestoreService.guardarColeccionChunked('ventas', currentVentas);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      // Registrar en Bitácora
      await this.bitacoraService.registrarEvento({
        modulo: 'PEDIDOS',
        accion: 'ABONO',
        descripcion: `Ingreso de $${monto.toFixed(2)} registrado por ${params.concepto} de ${params.clienteNombre} (${params.pedidoId})`,
        detalles: {
          folioVenta: ventaId,
          pedidoId: params.pedidoId,
          monto,
          metodoPago: met
        },
        sucursalId,
        sucursalNombre
      });
    } catch (e) {
      console.warn('Error al persistir ingreso en ventas:', e);
    }

    return nuevaVenta;
  }

  // ── Carritos en Espera / Pendientes ────────────────────────
  async pausarVentaEnEspera(alias: string): Promise<void> {
    const items = [...this.carrito()];
    if (items.length === 0) return;

    const sucursal = this.sucursalesService.sucursalActiva();
    const nuevoId = generarSiguienteConsecutivo(this.carritosPendientesSignal().map((c) => c.id), 'CP', 4);
    
    const nuevoCarrito: CarritoPendiente = {
      id: nuevoId,
      alias: alias.trim() || `Ticket ${nuevoId}`,
      fecha: new Date().toISOString(),
      items,
      total: this.totalCarrito(),
      sucursalId: sucursal.id
    };

    const current = [...this.carritosPendientesSignal(), nuevoCarrito];
    this.carritosPendientesSignal.set(current);
    this.limpiarCarrito();
    await this.guardarCarritosPendientesEnFirestore();
  }

  async recuperarVentaEnEspera(id: string): Promise<void> {
    const item = this.carritosPendientesSignal().find((c) => c.id === id);
    if (!item) return;

    this.carrito.set(item.items);
    this.ajustarPagoEfectivoPorDefecto();

    const current = this.carritosPendientesSignal().filter((c) => c.id !== id);
    this.carritosPendientesSignal.set(current);
    await this.guardarCarritosPendientesEnFirestore();
  }

  async eliminarVentaEnEspera(id: string): Promise<void> {
    const current = this.carritosPendientesSignal().filter((c) => c.id !== id);
    this.carritosPendientesSignal.set(current);
    await this.guardarCarritosPendientesEnFirestore();
  }

  private async guardarCarritosPendientesEnFirestore(): Promise<void> {
    try {
      const ref = this.firestoreService.getRefDocConfig('carritosPendientes');
      await setDoc(ref, {
        items: this.carritosPendientesSignal(),
        actualizadoEn: new Date().toISOString()
      }, { merge: true });
    } catch (_) {}
  }

  // ── Carga y Sincronización en Vivo ─────────────────────────
  validarYLimpiarDuplicados(list: Venta[]): Venta[] {
    if (!Array.isArray(list)) return [];
    const ids = new Set<string>();
    const firmas = new Set<string>();
    const limpios: Venta[] = [];

    for (const v of list) {
      if (!v) continue;
      const id = (v.id || '').trim();
      const firma = `${v.fecha}_${v.total}_${v.totalPagado}_${v.items?.length || 0}`;

      if (id && ids.has(id)) continue;
      if (firma && firmas.has(firma)) continue;

      if (id) ids.add(id);
      if (firma) firmas.add(firma);
      limpios.push(v);
    }
    return limpios;
  }

  async depurarVentasDuplicadas(): Promise<{ totalOriginal: number; totalLimpios: number; duplicadosEliminados: number }> {
    const listaOriginal = this.ventasSignal();
    const totalOriginal = listaOriginal.length;
    const listaLimpia = this.validarYLimpiarDuplicados(listaOriginal);
    const totalLimpios = listaLimpia.length;
    const duplicadosEliminados = totalOriginal - totalLimpios;

    if (duplicadosEliminados > 0) {
      this.ventasSignal.set(listaLimpia);
      this.syncService.setStatus('saving', 'Depurando ventas duplicadas...');
      try {
        await this.firestoreService.guardarColeccionChunked('ventas', listaLimpia);
        await this.syncService.incrementarRevision();
        this.syncService.setStatus('online', 'En Línea');
      } catch (e) {
        console.error('Error al guardar ventas depuradas:', e);
        this.syncService.setStatus('online', 'En Línea');
        throw e;
      }
    }
    return { totalOriginal, totalLimpios, duplicadosEliminados };
  }

  setVentas(list: Venta[]): void {
    if (Array.isArray(list)) {
      this.ventasSignal.set(this.validarYLimpiarDuplicados(list));
    }
  }

  async cargarVentas(): Promise<Venta[]> {
    const list = await this.firestoreService.cargarColeccionChunked<Venta>('ventas');
    const limpios = this.validarYLimpiarDuplicados(list);
    this.ventasSignal.set(limpios);
    return limpios;
  }

  iniciarEscuchadorLiveVentas(): void {
    if (this.subLiveVentas) this.subLiveVentas.unsubscribe();
    if (this.subLiveCarritos) this.subLiveCarritos.unsubscribe();

    const chunksCollRef = this.firestoreService.getRefColeccion('chunks_ventas');
    this.subLiveVentas = collectionStream$(chunksCollRef).subscribe({
      next: (snapshot) => {
        if (!snapshot.empty) {
          const chunkDocs = snapshot.docs
            .filter((d) => d.id.startsWith('chunk_'))
            .sort((a, b) => {
              const idxA = parseInt(a.id.replace('chunk_', ''), 10) || 0;
              const idxB = parseInt(b.id.replace('chunk_', ''), 10) || 0;
              return idxA - idxB;
            });

          const actualizados: Venta[] = [];
          chunkDocs.forEach((d) => {
            const data = d.data();
            if (Array.isArray(data['items'])) {
              actualizados.push(...data['items']);
            }
          });

          if (actualizados.length > 0) {
            const limpios = this.validarYLimpiarDuplicados(actualizados);
            this.ventasSignal.set(limpios);
          }
        }
      },
      error: (err) => console.error('Error en stream de ventas:', err)
    });

    // Escuchador de carritos pendientes reactivo
    const carritosRef = this.firestoreService.getRefDocConfig('carritosPendientes');
    this.subLiveCarritos = docStream$(carritosRef).subscribe({
      next: (docSnap) => {
        if (docSnap.exists() && Array.isArray(docSnap.data()['items'])) {
          this.carritosPendientesSignal.set(docSnap.data()['items']);
        }
      },
      error: (err) => console.error('Error en stream de carritos:', err)
    });
  }
}
