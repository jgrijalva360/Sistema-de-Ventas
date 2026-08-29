import { Component, signal, inject, computed, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { ProductosService } from '../../core/services/productos.service';
import { MovimientosService } from '../../core/services/movimientos.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { Producto, StockSucursal } from '../../core/models/models';
import { renderBarcodeToCanvas } from '../../shared/utils/barcode.util';

export interface ItemAuditoria {
  codigo: string;
  nombre: string;
  stockCatalogo: number;
  stockKardex: number | null;
  diferencia: number;
  totalEntradas: number;
  totalSalidas: number;
  totalMovimientos: number;
  ultimoMovimiento?: {
    fecha: string;
    tipo: string;
    cantidad: number;
    stockNuevo: number;
    motivo?: string;
  };
  estado: 'CONCILIADO' | 'DISCREPANCIA' | 'SIN_KARDEX';
}

@Component({
  selector: 'app-inventario',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe, FechaLocalPipe],
  templateUrl: './inventario.component.html',
  styleUrl: './inventario.component.scss'
})
export class InventarioComponent implements AfterViewInit {
  @ViewChild('busquedaInputRef') busquedaInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('nuevoCodigoInputRef') nuevoCodigoInputRef?: ElementRef<HTMLInputElement>;

  public busqueda = signal<string>('');
  public filtro = signal<'TODOS' | 'BAJO' | 'AGOTADO'>('TODOS');
  public sucursalFiltro = signal<string>('TODAS');

  // Control de Formulario / Modal de Registro y Edición de Producto
  public formularioRegistroVisible = signal<boolean>(false);
  public productoEnEdicion = signal<Producto | null>(null);
  public stocksEdicion = signal<{ [sucId: string]: StockSucursal }>({});

  public nuevoProducto: Producto = {
    codigo: '',
    nombre: '',
    precioVenta: 0,
    stockActual: 0,
    stockMinimo: 1,
    grupo: 'GENERAL',
    precioVariable: false
  };
  public nuevaSucursalDestino = signal<string>('SUC-MAIN');

  // Modal y controles de Auditoría de Stock
  public modalAuditoriaAbierto = signal<boolean>(false);
  public busquedaAuditoria = signal<string>('');
  public filtroAuditoria = signal<'TODOS' | 'DISCREPANCIAS'>('TODOS');
  public procesandoConciliacion = signal<boolean>(false);
  public mensajeAuditoria = signal<string | null>(null);

  public productosService = inject(ProductosService);
  public movimientosService = inject(MovimientosService);
  public sucursalesService = inject(SucursalesService);

  ngAfterViewInit(): void {
    setTimeout(() => this.busquedaInputRef?.nativeElement.focus(), 100);
    // Establecer la sucursal activa por defecto
    const act = this.sucursalesService.activaId();
    if (act) {
      this.nuevaSucursalDestino.set(act);
    }
  }

  // Obtiene el stock correspondiente según la sucursal seleccionada en el filtro
  public obtenerStockMostrado(prod: Producto): StockSucursal {
    const suc = this.sucursalFiltro();
    if (suc === 'TODAS') {
      return {
        stockActual: Number(prod.stockActual) || 0,
        stockMinimo: Number(prod.stockMinimo) || 1
      };
    }
    return this.productosService.obtenerStockSucursal(prod, suc);
  }

  public productosAgotados = computed(() => {
    return this.productosService.productos().filter((p) => {
      const stock = this.obtenerStockMostrado(p);
      return stock.stockActual <= 0;
    });
  });

  public productosConStockBajo = computed(() => {
    return this.productosService.productos().filter((p) => {
      const stock = this.obtenerStockMostrado(p);
      return stock.stockActual > 0 && stock.stockActual <= stock.stockMinimo;
    });
  });

  public productosFiltrados = computed(() => {
    const list = this.productosService.productos();
    const query = this.busqueda().trim().toLowerCase();
    const f = this.filtro();

    return list.filter((p) => {
      const stock = this.obtenerStockMostrado(p);
      if (f === 'BAJO' && (stock.stockActual > stock.stockMinimo || stock.stockActual <= 0)) return false;
      if (f === 'AGOTADO' && stock.stockActual > 0) return false;
      if (query) {
        const matchesCod = (p.codigo || '').toLowerCase().includes(query);
        const matchesNom = (p.nombre || '').toLowerCase().includes(query);
        const matchesGrp = (p.grupo || '').toLowerCase().includes(query);
        if (!matchesCod && !matchesNom && !matchesGrp) return false;
      }
      return true;
    });
  });

  // ── Métodos de Gestión y Registro de Productos ───────────────
  toggleFormularioRegistro(): void {
    const nuevoEstado = !this.formularioRegistroVisible();
    this.formularioRegistroVisible.set(nuevoEstado);
    if (nuevoEstado) {
      setTimeout(() => this.nuevoCodigoInputRef?.nativeElement.focus(), 150);
    }
  }

  sugerirCodigo(): void {
    const existingCodes = new Set(this.productosService.productos().map((p) => p.codigo));
    let generado = '';
    let intentos = 0;

    do {
      const randomNum = Math.floor(10000000 + Math.random() * 90000000);
      generado = randomNum.toString().slice(0, 8);
      intentos++;
    } while (existingCodes.has(generado) && intentos < 100);

    this.nuevoProducto.codigo = generado;
  }

  onCodigoChange(): void {
    if (this.nuevoProducto.codigo && this.nuevoProducto.codigo.length > 8) {
      this.nuevoProducto.codigo = this.nuevoProducto.codigo.slice(0, 8);
    }
  }

  guardarCodigoBarrasComoImagen(): void {
    if (!this.nuevoProducto.codigo) {
      alert('Por favor ingresa o genera un código primero.');
      return;
    }

    const canvas = document.createElement('canvas');
    renderBarcodeToCanvas(
      canvas,
      this.nuevoProducto.codigo,
      this.nuevoProducto.nombre || 'PRODUCTO'
    );

    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `codigo_${this.nuevoProducto.codigo}.png`;
    link.href = dataUrl;
    link.click();
  }

  descargarCodigoProducto(prod: Producto): void {
    const canvas = document.createElement('canvas');
    renderBarcodeToCanvas(
      canvas,
      prod.codigo,
      prod.nombre
    );

    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `codigo_${prod.codigo}.png`;
    link.href = dataUrl;
    link.click();
  }

  limpiarFormulario(): void {
    this.nuevoProducto = {
      codigo: '',
      nombre: '',
      precioVenta: 0,
      stockActual: 0,
      stockMinimo: 1,
      grupo: 'GENERAL',
      precioVariable: false
    };
  }

  async onGuardarNuevo(): Promise<void> {
    if (!this.nuevoProducto.codigo || !this.nuevoProducto.nombre) {
      alert('Por favor ingresa el código y nombre del producto.');
      return;
    }

    const sucursalDestino = this.nuevaSucursalDestino() || this.sucursalesService.activaId() || 'SUC-MAIN';
    this.nuevoProducto.stockPorSucursal = {
      [sucursalDestino]: {
        stockActual: Number(this.nuevoProducto.stockActual) || 0,
        stockMinimo: Number(this.nuevoProducto.stockMinimo) || 1
      }
    };

    await this.productosService.guardarProducto(this.nuevoProducto, sucursalDestino);
    this.limpiarFormulario();
    this.formularioRegistroVisible.set(false);
  }

  abrirEditar(prod: Producto): void {
    this.productoEnEdicion.set({ ...prod });
    const sucursales = this.sucursalesService.sucursales();
    const mapaStocks: { [sucId: string]: StockSucursal } = {};

    sucursales.forEach((suc) => {
      mapaStocks[suc.id] = { ...this.productosService.obtenerStockSucursal(prod, suc.id) };
    });

    this.stocksEdicion.set(mapaStocks);
  }

  async onGuardarEdicion(): Promise<void> {
    const prod = this.productoEnEdicion();
    if (prod) {
      prod.stockPorSucursal = { ...this.stocksEdicion() };
      await this.productosService.guardarProducto(prod);
      this.productoEnEdicion.set(null);
    }
  }

  async onEliminar(codigo: string): Promise<void> {
    if (confirm(`¿Estás seguro de eliminar el producto con código "${codigo}" de todas las sucursales?`)) {
      await this.productosService.eliminarProducto(codigo);
    }
  }

  // ── Auditoría Completa: Catálogo vs Kardex por Sucursal ──────
  public auditoriaInventario = computed<ItemAuditoria[]>(() => {
    const productos = this.productosService.productos();
    const movimientos = this.movimientosService.movimientos();
    const suc = this.sucursalFiltro();

    return productos.map((p) => {
      const cod = (p.codigo || '').trim().toLowerCase();
      const movsProd = movimientos
        .filter((m) => {
          const matchCod = (m.codigo || '').trim().toLowerCase() === cod;
          if (!matchCod) return false;
          if (suc !== 'TODAS') {
            return (m.sucursalId || 'SUC-MAIN') === suc;
          }
          return true;
        })
        .sort((a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime());

      const totalMovimientos = movsProd.length;
      const totalEntradas = movsProd
        .filter((m) => m.tipo === 'ENTRADA' || m.tipo === 'INGRESO' || m.tipo === 'INICIAL')
        .reduce((acc, m) => acc + (Number(m.cantidad) || 0), 0);

      const totalSalidas = movsProd
        .filter((m) => m.tipo === 'SALIDA')
        .reduce((acc, m) => acc + (Number(m.cantidad) || 0), 0);

      const ultimoMov = totalMovimientos > 0 ? movsProd[totalMovimientos - 1] : undefined;
      const stockKardex = ultimoMov ? Number(ultimoMov.stockNuevo) || 0 : null;
      const stockCatalogo = this.obtenerStockMostrado(p).stockActual;

      let estado: ItemAuditoria['estado'] = 'SIN_KARDEX';
      let diferencia = 0;

      if (stockKardex !== null) {
        diferencia = stockCatalogo - stockKardex;
        estado = diferencia === 0 ? 'CONCILIADO' : 'DISCREPANCIA';
      }

      return {
        codigo: p.codigo,
        nombre: p.nombre,
        stockCatalogo,
        stockKardex,
        diferencia,
        totalEntradas,
        totalSalidas,
        totalMovimientos,
        ultimoMovimiento: ultimoMov
          ? {
              fecha: ultimoMov.fecha,
              tipo: ultimoMov.tipo,
              cantidad: ultimoMov.cantidad,
              stockNuevo: ultimoMov.stockNuevo,
              motivo: ultimoMov.motivo
            }
          : undefined,
        estado
      };
    });
  });

  public resumenAuditoria = computed(() => {
    const items = this.auditoriaInventario();
    const total = items.length;
    const conciliados = items.filter((i) => i.estado === 'CONCILIADO').length;
    const discrepancias = items.filter((i) => i.estado === 'DISCREPANCIA').length;
    const sinKardex = items.filter((i) => i.estado === 'SIN_KARDEX').length;

    return { total, conciliados, discrepancias, sinKardex };
  });

  public auditoriaFiltrada = computed(() => {
    const items = this.auditoriaInventario();
    const query = this.busquedaAuditoria().trim().toLowerCase();
    const f = this.filtroAuditoria();

    return items.filter((item) => {
      if (f === 'DISCREPANCIAS' && item.estado === 'CONCILIADO') return false;
      if (query) {
        const matchCod = item.codigo.toLowerCase().includes(query);
        const matchNom = item.nombre.toLowerCase().includes(query);
        if (!matchCod && !matchNom) return false;
      }
      return true;
    });
  });

  abrirAuditoria(): void {
    this.busquedaAuditoria.set('');
    this.filtroAuditoria.set('TODOS');
    this.mensajeAuditoria.set(null);
    this.modalAuditoriaAbierto.set(true);
  }

  async conciliarKardexConStock(item: ItemAuditoria): Promise<void> {
    if (this.procesandoConciliacion()) return;

    this.procesandoConciliacion.set(true);
    this.mensajeAuditoria.set(null);

    const sid = this.sucursalFiltro() !== 'TODAS' ? this.sucursalFiltro() : this.sucursalesService.activaId() || 'SUC-MAIN';

    try {
      await this.movimientosService.registrarMovimiento(
        'AJUSTE',
        item.codigo,
        item.stockCatalogo,
        'Conciliación y auditoría de inventario físico',
        sid
      );
      this.mensajeAuditoria.set(`✅ Producto ${item.codigo} conciliado exitosamente.`);
      setTimeout(() => this.mensajeAuditoria.set(null), 4000);
    } catch (e: any) {
      this.mensajeAuditoria.set(`❌ Error al conciliar ${item.codigo}: ` + (e.message || e));
    } finally {
      this.procesandoConciliacion.set(false);
    }
  }

  async conciliarTodasDiscrepancias(): Promise<void> {
    if (this.procesandoConciliacion()) return;
    const discrepantes = this.auditoriaInventario().filter((i) => i.estado !== 'CONCILIADO');

    if (discrepantes.length === 0) {
      alert('✨ Todo el inventario ya se encuentra 100% conciliado.');
      return;
    }

    const confirmar = confirm(
      `Se generarán movimientos formales de Ajuste de Conciliación para ${discrepantes.length} producto(s) para que el Kardex y el Catálogo queden 100% alineados.\n\n¿Deseas continuar?`
    );
    if (!confirmar) return;

    this.procesandoConciliacion.set(true);
    this.mensajeAuditoria.set('Procesando conciliación masiva...');
    const sid = this.sucursalFiltro() !== 'TODAS' ? this.sucursalFiltro() : this.sucursalesService.activaId() || 'SUC-MAIN';

    try {
      for (const item of discrepantes) {
        await this.movimientosService.registrarMovimiento(
          'AJUSTE',
          item.codigo,
          item.stockCatalogo,
          'Conciliación masiva de inventario',
          sid
        );
      }
      this.mensajeAuditoria.set(`🎉 Se conciliaron exitosamente ${discrepantes.length} productos.`);
      setTimeout(() => this.mensajeAuditoria.set(null), 5000);
    } catch (e: any) {
      this.mensajeAuditoria.set('❌ Error durante la conciliación: ' + (e.message || e));
    } finally {
      this.procesandoConciliacion.set(false);
    }
  }

  async onRecalcularStockDesdeMovimientos(): Promise<void> {
    if (this.procesandoConciliacion()) return;

    const sucNombre = this.sucursalFiltro() === 'TODAS' ? 'Todas las sucursales' : (this.sucursalesService.sucursales().find(s => s.id === this.sucursalFiltro())?.nombre || this.sucursalFiltro());
    const confirmar = confirm(
      `¿Deseas recalcular y actualizar el Stock Actual para "${sucNombre}" en base a su historial de movimientos (Kardex)?\n\nEsta acción corregirá cualquier discrepancia en el catálogo de productos.`
    );
    if (!confirmar) return;

    this.procesandoConciliacion.set(true);
    this.mensajeAuditoria.set('Recalculando stock de productos desde movimientos...');

    try {
      const res = await this.productosService.recalcularStockDesdeMovimientos(
        this.movimientosService.movimientos(),
        this.sucursalFiltro()
      );

      if (res.productosActualizados > 0) {
        this.mensajeAuditoria.set(
          `🎉 Se actualizó el stock de ${res.productosActualizados} producto(s) en base al Kardex.`
        );
      } else {
        this.mensajeAuditoria.set('✨ Todos los productos ya coinciden con su historial de movimientos.');
      }
      setTimeout(() => this.mensajeAuditoria.set(null), 5000);
    } catch (e: any) {
      this.mensajeAuditoria.set('❌ Error al recalcular stock: ' + (e.message || e));
    } finally {
      this.procesandoConciliacion.set(false);
    }
  }
}
