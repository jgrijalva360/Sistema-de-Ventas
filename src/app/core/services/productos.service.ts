import { Injectable, signal, computed } from '@angular/core';
import { Producto, StockSucursal, LoteFifo } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { SyncService } from './sync.service';
import { Subscription } from 'rxjs';
import { collectionStream$ } from '../utils/realtime.util';
import { BitacoraService } from './bitacora.service';

@Injectable({
  providedIn: 'root'
})
export class ProductosService {
  private productosSignal = signal<Producto[]>([]);
  public productos = this.productosSignal.asReadonly();

  public productosConStockBajo = computed(() => {
    return this.productosSignal().filter((p) => (p.stockActual || 0) <= (p.stockMinimo || 0));
  });

  public totalStockItems = computed(() => {
    return this.productosSignal().reduce((acc, p) => acc + (p.stockActual || 0), 0);
  });

  private subLiveDoc?: Subscription;

  constructor(
    private firestoreService: FirestoreChunksService,
    private syncService: SyncService,
    private bitacoraService: BitacoraService
  ) {}

  public normalizarProducto(p: any): Producto {
    const stockMin = typeof p.stockMinimo === 'number'
      ? p.stockMinimo
      : typeof p.stockMin === 'number'
        ? p.stockMin
        : 1;

    const stockAct = typeof p.stockActual === 'number'
      ? p.stockActual
      : typeof p.existencias === 'number'
        ? p.existencias
        : (p.stockMinimo ?? p.stockMin ?? 0);

    // Normalizar mapa de stock por sucursal
    const stockPorSucursal: { [sucId: string]: StockSucursal } = {};
    if (p.stockPorSucursal && typeof p.stockPorSucursal === 'object') {
      Object.keys(p.stockPorSucursal).forEach((sucId) => {
        const item = p.stockPorSucursal[sucId];
        if (item) {
          stockPorSucursal[sucId] = {
            stockActual: Number(item.stockActual) || 0,
            stockMinimo: Number(item.stockMinimo) || 1
          };
        }
      });
    }

    // Si aún no tiene mapa de sucursales, asignar las existencias a la matriz principal (SUC-MAIN)
    if (Object.keys(stockPorSucursal).length === 0) {
      stockPorSucursal['SUC-MAIN'] = {
        stockActual: Number(stockAct) || 0,
        stockMinimo: Number(stockMin) || 1
      };
    }

    // Calcular el stock total consolidado
    const totalActual = Object.values(stockPorSucursal).reduce((acc, s) => acc + (s.stockActual || 0), 0);
    const totalMinimo = Object.values(stockPorSucursal).reduce((acc, s) => acc + (s.stockMinimo || 0), 0);

    // Normalizar Lotes FIFO
    const lotesFifo: LoteFifo[] = [];
    if (Array.isArray(p.lotesFifo)) {
      p.lotesFifo.forEach((lote: any) => {
        if (lote && typeof lote === 'object') {
          lotesFifo.push({
            id: String(lote.id || '').trim(),
            movimientoId: lote.movimientoId ? String(lote.movimientoId).trim() : undefined,
            fecha: lote.fecha || new Date().toISOString(),
            cantidadInicial: Number(lote.cantidadInicial) || 0,
            cantidadDisponible: Math.max(0, Number(lote.cantidadDisponible) || 0),
            costoUnitario: Number(lote.costoUnitario) || 0,
            sucursalId: lote.sucursalId || 'SUC-MAIN'
          });
        }
      });
    }

    const prod: Producto = {
      codigo: (p.codigo || '').trim(),
      nombre: p.nombre || 'Producto',
      stockMinimo: Number(totalMinimo) || Number(stockMin) || 1,
      stockActual: Number(totalActual) || 0,
      precioVenta: typeof p.precioVenta === 'number' ? p.precioVenta : parseFloat(p.precioVenta) || 0,
      ultimoCosto: p.ultimoCosto !== undefined ? Number(p.ultimoCosto) : undefined,
      fechaUltimoCosto: p.fechaUltimoCosto || undefined,
      costoPromedio: p.costoPromedio !== undefined ? Number(p.costoPromedio) : undefined,
      lotesFifo,
      precioVariable: Boolean(p.precioVariable),
      grupo: p.grupo || 'General',
      unidad: p.unidad || 'Unidades',
      categoria: p.categoria || p.grupo || 'General',
      stockPorSucursal
    };

    if (p.id) {
      prod.id = p.id;
    }

    return prod;
  }

  setProductos(list: Producto[]): void {
    if (Array.isArray(list)) {
      this.productosSignal.set(list.map((p) => this.normalizarProducto(p)));
    }
  }

  async cargarProductos(): Promise<Producto[]> {
    // 1. Cargar desde chunks_productos
    const rawList = await this.firestoreService.cargarColeccionChunked<any>('productos');
    if (rawList.length > 0) {
      const list = rawList.map((p) => this.normalizarProducto(p));
      this.productosSignal.set(list);
      return list;
    }

    // 2. Fallback de migración única: si venía del documento viejo catalogoProductos
    try {
      const catRef = this.firestoreService.getRefDocConfig('catalogoProductos');
      const { getDoc } = await import('firebase/firestore');
      const snap = await getDoc(catRef);
      if (snap.exists() && Array.isArray(snap.data()['items']) && snap.data()['items'].length > 0) {
        const list = (snap.data()['items'] as any[]).map((p) => this.normalizarProducto(p));
        this.productosSignal.set(list);
        await this.persistirCatalogo(list);
        return list;
      }
    } catch (_) {}

    this.productosSignal.set([]);
    return [];
  }

  iniciarEscuchadorLive(): void {
    if (this.subLiveDoc) this.subLiveDoc.unsubscribe();

    const chunksCollRef = this.firestoreService.getRefColeccion('chunks_productos');
    this.subLiveDoc = collectionStream$(chunksCollRef).subscribe({
      next: (snapshot) => {
        if (!snapshot.empty) {
          const chunkDocs = snapshot.docs
            .filter((d) => d.id.startsWith('chunk_'))
            .sort((a, b) => {
              const idxA = parseInt(a.id.replace('chunk_', ''), 10) || 0;
              const idxB = parseInt(b.id.replace('chunk_', ''), 10) || 0;
              return idxA - idxB;
            });

          const actualizados: Producto[] = [];
          chunkDocs.forEach((d) => {
            const data = d.data();
            if (Array.isArray(data['items'])) {
              actualizados.push(...data['items']);
            }
          });

          if (actualizados.length > 0) {
            this.productosSignal.set(actualizados.map((p) => this.normalizarProducto(p)));
          }
        }
      },
      error: (err) => console.error('Error en stream de productos:', err)
    });
  }

  private async persistirCatalogo(catalogo: Producto[]): Promise<void> {
    const cleanCatalogo = catalogo.map((p) => this.normalizarProducto(p));
    await this.firestoreService.guardarColeccionChunked('productos', cleanCatalogo);
  }

  obtenerStockSucursal(prod: Producto, sucursalId?: string): StockSucursal {
    if (!prod) return { stockActual: 0, stockMinimo: 1 };
    const sid = sucursalId || 'SUC-MAIN';
    if (prod.stockPorSucursal && prod.stockPorSucursal[sid]) {
      return prod.stockPorSucursal[sid];
    }
    return { stockActual: 0, stockMinimo: 1 };
  }

  async guardarProducto(producto: Producto, sucursalId?: string): Promise<void> {
    const norm = this.normalizarProducto(producto);
    const sid = sucursalId || 'SUC-MAIN';

    // Si se pasa una sucursal específica y el producto ya tenía stocks
    if (producto.stockPorSucursal) {
      norm.stockPorSucursal = { ...producto.stockPorSucursal };
    } else {
      norm.stockPorSucursal = {
        [sid]: {
          stockActual: Number(producto.stockActual) || 0,
          stockMinimo: Number(producto.stockMinimo) || 1
        }
      };
    }

    // Recalcular consolidado
    const totalAct = Object.values(norm.stockPorSucursal).reduce((acc, s) => acc + (s.stockActual || 0), 0);
    norm.stockActual = totalAct;

    const current = [...this.productosSignal()];
    const idx = current.findIndex((p) => (p.codigo || '').toLowerCase() === (norm.codigo || '').toLowerCase());

    if (idx >= 0) {
      // Conservar stocks de otras sucursales si ya existían
      const previo = current[idx];
      norm.stockPorSucursal = {
        ...(previo.stockPorSucursal || {}),
        ...(norm.stockPorSucursal || {})
      };
      norm.stockActual = Object.values(norm.stockPorSucursal).reduce((acc, s) => acc + (s.stockActual || 0), 0);

      // Conservar costos previos y lotes si no se sobreescribieron
      if (norm.ultimoCosto === undefined && previo.ultimoCosto !== undefined) {
        norm.ultimoCosto = previo.ultimoCosto;
        norm.fechaUltimoCosto = previo.fechaUltimoCosto;
      }
      if (!norm.lotesFifo || norm.lotesFifo.length === 0) {
        norm.lotesFifo = previo.lotesFifo || [];
      }
      if (norm.costoPromedio === undefined && previo.costoPromedio !== undefined) {
        norm.costoPromedio = previo.costoPromedio;
      }

      current[idx] = { ...norm };
    } else {
      // Si es un producto nuevo con stock inicial y costo, inicializar su primer lote FIFO
      if (norm.stockActual > 0 && norm.ultimoCosto && norm.ultimoCosto > 0) {
        norm.lotesFifo = [
          {
            id: `LOTE-INI-${Date.now()}`,
            fecha: new Date().toISOString(),
            cantidadInicial: norm.stockActual,
            cantidadDisponible: norm.stockActual,
            costoUnitario: norm.ultimoCosto,
            sucursalId: sid
          }
        ];
      }
      current.push({ ...norm });
    }

    this.productosSignal.set(current);
    this.syncService.setStatus('saving', 'Guardando catálogo...');

    try {
      await this.persistirCatalogo(current);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      // Registrar en Bitácora
      await this.bitacoraService.registrarEvento({
        modulo: 'INVENTARIO',
        accion: idx >= 0 ? 'EDITAR' : 'CREAR',
        descripcion: idx >= 0
          ? `Producto "${norm.nombre}" (${norm.codigo}) actualizado. Precio: $${norm.precioVenta.toFixed(2)}, Stock: ${norm.stockActual}`
          : `Nuevo producto "${norm.nombre}" (${norm.codigo}) registrado con stock inicial de ${norm.stockActual}`,
        detalles: norm,
        sucursalId: sid
      });
    } catch (e) {
      console.warn('Error al guardar producto:', e);
      this.syncService.setStatus('online', 'En Línea');
    }
  }

  async actualizarStock(codigo: string, nuevoStock: number, sucursalId: string = 'SUC-MAIN', nuevoMinimo?: number): Promise<void> {
    const current = [...this.productosSignal()];
    const idx = current.findIndex((p) => (p.codigo || '').toLowerCase() === (codigo || '').toLowerCase().trim());
    if (idx >= 0) {
      const prod = current[idx];
      const stocks = { ...(prod.stockPorSucursal || {}) };
      const currentSuc = stocks[sucursalId] || { stockActual: 0, stockMinimo: 1 };

      stocks[sucursalId] = {
        stockActual: Number(nuevoStock) || 0,
        stockMinimo: nuevoMinimo !== undefined ? Number(nuevoMinimo) : currentSuc.stockMinimo
      };

      const totalAct = Object.values(stocks).reduce((acc, s) => acc + (s.stockActual || 0), 0);
      const totalMin = Object.values(stocks).reduce((acc, s) => acc + (s.stockMinimo || 0), 0);

      current[idx] = {
        ...prod,
        stockActual: totalAct,
        stockMinimo: totalMin,
        stockPorSucursal: stocks
      };

      this.productosSignal.set(current);
      await this.persistirCatalogo(current);
    }
  }

  async actualizarPrecioVenta(codigo: string, nuevoPrecio: number): Promise<void> {
    const current = [...this.productosSignal()];
    const idx = current.findIndex((p) => (p.codigo || '').toLowerCase() === (codigo || '').toLowerCase().trim());
    if (idx >= 0) {
      const prod = current[idx];
      const precioAnterior = prod.precioVenta;
      current[idx] = {
        ...prod,
        precioVenta: Math.max(0, Number(nuevoPrecio) || 0)
      };
      this.productosSignal.set(current);
      this.syncService.setStatus('saving', 'Actualizando precio de venta...');
      try {
        await this.persistirCatalogo(current);
        await this.syncService.incrementarRevision();
        this.syncService.setStatus('online', 'En Línea');

        await this.bitacoraService.registrarEvento({
          modulo: 'INVENTARIO',
          accion: 'EDITAR',
          descripcion: `Precio de venta de "${prod.nombre}" (${prod.codigo}) actualizado de $${precioAnterior.toFixed(2)} a $${Number(nuevoPrecio).toFixed(2)}`,
          detalles: { codigo: prod.codigo, precioAnterior, nuevoPrecio }
        });
      } catch (e) {
        console.warn('Error al actualizar precio de venta:', e);
        this.syncService.setStatus('online', 'En Línea');
      }
    }
  }

  async eliminarProducto(codigo: string): Promise<void> {
    const prodEliminado = this.productosSignal().find(
      (p) => (p.codigo || '').toLowerCase() === (codigo || '').toLowerCase().trim()
    );
    const current = this.productosSignal().filter(
      (p) => (p.codigo || '').toLowerCase() !== (codigo || '').toLowerCase().trim()
    );
    this.productosSignal.set(current);
    this.syncService.setStatus('saving', 'Guardando catálogo...');

    try {
      await this.persistirCatalogo(current);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      if (prodEliminado) {
        await this.bitacoraService.registrarEvento({
          modulo: 'INVENTARIO',
          accion: 'ELIMINAR',
          descripcion: `Producto "${prodEliminado.nombre}" (${prodEliminado.codigo}) eliminado del catálogo`,
          detalles: prodEliminado
        });
      }
    } catch (e) {
      console.warn('Error al eliminar producto:', e);
      this.syncService.setStatus('online', 'En Línea');
    }
  }

  /**
   * Registra una nueva capa/lote FIFO cuando ingresa mercancía por compra o surtido.
   */
  async registrarEntradaFifo(
    codigo: string,
    cantidad: number,
    costoUnitario: number,
    sucursalId: string = 'SUC-MAIN',
    movimientoId?: string
  ): Promise<void> {
    const current = [...this.productosSignal()];
    const idx = current.findIndex(
      (p) => (p.codigo || '').toLowerCase() === (codigo || '').toLowerCase().trim()
    );
    if (idx < 0) return;

    const prod = current[idx];
    const lotes = [...(prod.lotesFifo || [])];
    const fechaIso = new Date().toISOString();
    const loteId = movimientoId ? `LOTE-${movimientoId}` : `LOTE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const nuevoLote: LoteFifo = {
      id: loteId,
      movimientoId,
      fecha: fechaIso,
      cantidadInicial: Number(cantidad) || 0,
      cantidadDisponible: Number(cantidad) || 0,
      costoUnitario: Number(costoUnitario) || 0,
      sucursalId
    };

    lotes.push(nuevoLote);

    // Calcular costo promedio ponderado de los lotes activos con saldo
    const lotesConSaldo = lotes.filter((l) => l.cantidadDisponible > 0);
    const sumaCosto = lotesConSaldo.reduce((acc, l) => acc + l.cantidadDisponible * l.costoUnitario, 0);
    const sumaCant = lotesConSaldo.reduce((acc, l) => acc + l.cantidadDisponible, 0);
    const costoProm = sumaCant > 0 ? sumaCosto / sumaCant : Number(costoUnitario) || 0;

    current[idx] = {
      ...prod,
      ultimoCosto: Number(costoUnitario) || 0,
      fechaUltimoCosto: fechaIso,
      costoPromedio: Math.round(costoProm * 100) / 100,
      lotesFifo: lotes
    };

    this.productosSignal.set(current);
    try {
      await this.persistirCatalogo(current);
    } catch (e) {
      console.warn('Error al persistir entrada FIFO en productos:', e);
    }
  }

  /**
   * Consume unidades de los lotes FIFO ordenados por fecha ascendente (el más viejo primero).
   */
  consumirStockFifo(
    prod: Producto,
    cantidadAConsumir: number,
    sucursalId: string = 'SUC-MAIN'
  ): {
    lotesActualizados: LoteFifo[];
    costoTotalFifo: number;
    costoUnitarioPonderado: number;
  } {
    let cantRestante = Math.max(0, Number(cantidadAConsumir) || 0);
    const lotes = (prod.lotesFifo || []).map((l) => ({ ...l }));
    let costoTotal = 0;
    let cantConsumidaDeLotes = 0;

    // Ordenar lotes por fecha ascendente (el más viejo primero)
    // Filtramos lotes con saldo para esta sucursal (o generales sin sucursal fija)
    const lotesCandidatos = lotes
      .filter((l) => l.cantidadDisponible > 0 && (l.sucursalId === sucursalId || !l.sucursalId))
      .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

    for (const lote of lotesCandidatos) {
      if (cantRestante <= 0) break;
      const tomar = Math.min(cantRestante, lote.cantidadDisponible);
      lote.cantidadDisponible -= tomar;
      cantRestante -= tomar;
      costoTotal += tomar * (lote.costoUnitario || 0);
      cantConsumidaDeLotes += tomar;
    }

    // Si aún quedó cantidad por consumir (ej: existencias previas sin registro de lote FIFO),
    // aplicamos el costo de fallback (ultimoCosto o costoPromedio)
    if (cantRestante > 0) {
      const costoFallback = Number(prod.ultimoCosto) || Number(prod.costoPromedio) || 0;
      costoTotal += cantRestante * costoFallback;
      cantConsumidaDeLotes += cantRestante;
    }

    const costoUnitarioPonderado =
      cantConsumidaDeLotes > 0 ? costoTotal / cantConsumidaDeLotes : Number(prod.ultimoCosto) || 0;

    return {
      lotesActualizados: lotes,
      costoTotalFifo: Math.round(costoTotal * 100) / 100,
      costoUnitarioPonderado: Math.round(costoUnitarioPonderado * 100) / 100
    };
  }

  /**
   * Obtiene el costo unitario de la capa FIFO más antigua con saldo disponible para el producto.
   * Si no hay capas con saldo, retorna el último costo registrado.
   */
  obtenerCostoFifoActual(prod: Producto, sucursalId?: string): number {
    if (!prod) return 0;
    const lotes = prod.lotesFifo || [];
    const sid = sucursalId || 'SUC-MAIN';

    const lotesActivos = lotes
      .filter((l) => l.cantidadDisponible > 0 && (sid === 'TODAS' || l.sucursalId === sid))
      .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

    if (lotesActivos.length > 0) {
      return lotesActivos[0].costoUnitario || 0;
    }
    return Number(prod.ultimoCosto) || Number(prod.costoPromedio) || 0;
  }

  /**
   * Devuelve los lotes FIFO con saldo activo para un producto y sucursal.
   */
  obtenerLotesFifoActivos(prod: Producto, sucursalId?: string): LoteFifo[] {
    if (!prod || !Array.isArray(prod.lotesFifo)) return [];
    return prod.lotesFifo
      .filter(
        (l) => l.cantidadDisponible > 0 && (!sucursalId || sucursalId === 'TODAS' || l.sucursalId === sucursalId)
      )
      .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());
  }

  async descontarStockVenta(
    itemsVendidos: { codigo: string; cantidad: number }[],
    sucursalId: string = 'SUC-MAIN'
  ): Promise<{ codigo: string; cantidad: number; costoUnitarioFifo: number; costoTotalFifo: number }[]> {
    const current = [...this.productosSignal()];
    let huboCambios = false;
    const desgloseFifo: { codigo: string; cantidad: number; costoUnitarioFifo: number; costoTotalFifo: number }[] = [];

    itemsVendidos.forEach((item) => {
      const idx = current.findIndex(
        (p) => (p.codigo || '').toLowerCase() === (item.codigo || '').toLowerCase().trim()
      );
      if (idx >= 0) {
        const prod = current[idx];
        const cant = Number(item.cantidad) || 0;

        // 1. Consumir de capas FIFO
        const resultadoFifo = this.consumirStockFifo(prod, cant, sucursalId);
        desgloseFifo.push({
          codigo: prod.codigo,
          cantidad: cant,
          costoUnitarioFifo: resultadoFifo.costoUnitarioPonderado,
          costoTotalFifo: resultadoFifo.costoTotalFifo
        });

        // 2. Actualizar existencias de la sucursal
        const stocks = { ...(prod.stockPorSucursal || {}) };
        const sucData = stocks[sucursalId] || { stockActual: 0, stockMinimo: 1 };
        const nuevoSuc = Math.max(0, (sucData.stockActual || 0) - cant);
        stocks[sucursalId] = {
          ...sucData,
          stockActual: nuevoSuc
        };

        const totalAct = Object.values(stocks).reduce((acc, s) => acc + (s.stockActual || 0), 0);

        current[idx] = {
          ...prod,
          stockActual: totalAct,
          stockPorSucursal: stocks,
          lotesFifo: resultadoFifo.lotesActualizados
        };
        huboCambios = true;
      } else {
        desgloseFifo.push({
          codigo: item.codigo,
          cantidad: Number(item.cantidad) || 0,
          costoUnitarioFifo: 0,
          costoTotalFifo: 0
        });
      }
    });

    if (huboCambios) {
      this.productosSignal.set(current);
      try {
        await this.persistirCatalogo(current);
      } catch (e) {
        console.warn('Error al descontar stock de venta:', e);
      }
    }

    return desgloseFifo;
  }

  async reponerStockDevolucion(
    itemsDevueltos: { codigo: string; cantidad: number; costoUnitarioFifo?: number }[],
    sucursalId: string = 'SUC-MAIN'
  ): Promise<void> {
    const current = [...this.productosSignal()];
    let huboCambios = false;

    itemsDevueltos.forEach((item) => {
      const idx = current.findIndex(
        (p) => (p.codigo || '').toLowerCase() === (item.codigo || '').toLowerCase().trim()
      );
      if (idx >= 0) {
        const prod = current[idx];
        const cant = Number(item.cantidad) || 0;
        const stocks = { ...(prod.stockPorSucursal || {}) };
        const sucData = stocks[sucursalId] || { stockActual: 0, stockMinimo: 1 };

        const nuevoSuc = (sucData.stockActual || 0) + cant;
        stocks[sucursalId] = {
          ...sucData,
          stockActual: nuevoSuc
        };

        const totalAct = Object.values(stocks).reduce((acc, s) => acc + (s.stockActual || 0), 0);

        // Si el ítem devuelto tenía costo FIFO, reingresarlo como lote disponible para futuras ventas
        const lotes = [...(prod.lotesFifo || [])];
        const costo = item.costoUnitarioFifo !== undefined ? Number(item.costoUnitarioFifo) : (prod.ultimoCosto || 0);

        lotes.unshift({
          id: `LOTE-DEV-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          fecha: new Date().toISOString(),
          cantidadInicial: cant,
          cantidadDisponible: cant,
          costoUnitario: costo,
          sucursalId
        });

        current[idx] = {
          ...prod,
          stockActual: totalAct,
          stockPorSucursal: stocks,
          lotesFifo: lotes
        };
        huboCambios = true;
      }
    });

    if (huboCambios) {
      this.productosSignal.set(current);
      try {
        await this.persistirCatalogo(current);
      } catch (e) {
        console.warn('Error al reponer stock de devolución:', e);
      }
    }
  }

  async recalcularStockDesdeMovimientos(movimientos: any[], sucursalId?: string): Promise<{
    productosActualizados: number;
    totalProductos: number;
    detalles: { codigo: string; nombre: string; stockAnterior: number; stockRecalculado: number }[];
  }> {
    const catalogo = [...this.productosSignal()];
    const detalles: { codigo: string; nombre: string; stockAnterior: number; stockRecalculado: number }[] = [];
    let productosActualizados = 0;

    for (let i = 0; i < catalogo.length; i++) {
      const prod = catalogo[i];
      const cod = (prod.codigo || '').trim().toLowerCase();

      // Si se especificó sucursal, filtramos por esa sucursal
      const movsProd = movimientos
        .filter((m) => {
          const matchCod = (m.codigo || '').trim().toLowerCase() === cod;
          if (!matchCod) return false;
          if (sucursalId && sucursalId !== 'TODAS') {
            return (m.sucursalId || 'SUC-MAIN') === sucursalId;
          }
          return true;
        })
        .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      if (movsProd.length === 0) {
        continue;
      }

      let stockCalc = 0;
      for (const m of movsProd) {
        const cant = Number(m.cantidad) || 0;
        const tipo = (m.tipo || '').toUpperCase();

        if (tipo === 'INICIAL' || tipo === 'AJUSTE') {
          stockCalc = m.stockNuevo !== undefined && typeof m.stockNuevo === 'number' ? m.stockNuevo : cant;
        } else if (tipo === 'ENTRADA' || tipo === 'INGRESO') {
          stockCalc += cant;
        } else if (tipo === 'SALIDA') {
          stockCalc = Math.max(0, stockCalc - cant);
        }
      }

      const sid = (sucursalId && sucursalId !== 'TODAS') ? sucursalId : 'SUC-MAIN';
      const stocks = { ...(prod.stockPorSucursal || {}) };
      const stockAnterior = stocks[sid]?.stockActual ?? (prod.stockActual || 0);

      if (stockAnterior !== stockCalc) {
        stocks[sid] = {
          stockActual: stockCalc,
          stockMinimo: stocks[sid]?.stockMinimo || prod.stockMinimo || 1
        };

        const totalAct = Object.values(stocks).reduce((acc, s) => acc + (s.stockActual || 0), 0);
        catalogo[i] = {
          ...prod,
          stockActual: totalAct,
          stockPorSucursal: stocks
        };

        detalles.push({
          codigo: prod.codigo,
          nombre: prod.nombre,
          stockAnterior,
          stockRecalculado: stockCalc
        });
        productosActualizados++;
      }
    }

    if (productosActualizados > 0) {
      this.productosSignal.set(catalogo);
      this.syncService.setStatus('saving', 'Actualizando stock desde movimientos...');
      try {
        await this.persistirCatalogo(catalogo);
        await this.syncService.incrementarRevision();
        this.syncService.setStatus('online', 'En Línea');
      } catch (e) {
        console.warn('Error al guardar catálogo recalculado:', e);
        this.syncService.setStatus('online', 'En Línea');
      }
    }

    return {
      productosActualizados,
      totalProductos: catalogo.length,
      detalles
    };
  }

  obtenerPorCodigo(codigo: string | null | undefined): Producto | undefined {
    if (!codigo) return undefined;
    const limpio = String(codigo).trim().toLowerCase();
    return this.productosSignal().find((p) => {
      const codP = String(p.codigo || '').trim().toLowerCase();
      const idP = String(p.id || '').trim().toLowerCase();
      return codP === limpio || (idP && idP === limpio);
    });
  }
}
