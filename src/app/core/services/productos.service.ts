import { Injectable, signal, computed } from '@angular/core';
import { Producto, StockSucursal } from '../models/models';
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

    const prod: Producto = {
      codigo: (p.codigo || '').trim(),
      nombre: p.nombre || 'Producto',
      stockMinimo: Number(totalMinimo) || Number(stockMin) || 1,
      stockActual: Number(totalActual) || 0,
      precioVenta: typeof p.precioVenta === 'number' ? p.precioVenta : parseFloat(p.precioVenta) || 0,
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
      current[idx] = { ...norm };
    } else {
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

  async descontarStockVenta(itemsVendidos: { codigo: string; cantidad: number }[], sucursalId: string = 'SUC-MAIN'): Promise<void> {
    const current = [...this.productosSignal()];
    let huboCambios = false;

    itemsVendidos.forEach((item) => {
      const idx = current.findIndex(
        (p) => (p.codigo || '').toLowerCase() === (item.codigo || '').toLowerCase().trim()
      );
      if (idx >= 0) {
        const prod = current[idx];
        const stocks = { ...(prod.stockPorSucursal || {}) };
        const sucData = stocks[sucursalId] || { stockActual: 0, stockMinimo: 1 };

        const nuevoSuc = Math.max(0, (sucData.stockActual || 0) - (Number(item.cantidad) || 0));
        stocks[sucursalId] = {
          ...sucData,
          stockActual: nuevoSuc
        };

        const totalAct = Object.values(stocks).reduce((acc, s) => acc + (s.stockActual || 0), 0);

        current[idx] = {
          ...prod,
          stockActual: totalAct,
          stockPorSucursal: stocks
        };
        huboCambios = true;
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
