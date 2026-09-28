import { Component, signal, inject, computed, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { MovimientosService } from '../../core/services/movimientos.service';
import { ProductosService } from '../../core/services/productos.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { MovimientoInventario, Producto, LoteFifo } from '../../core/models/models';

@Component({
  selector: 'app-movimientos',
  standalone: true,
  imports: [FormsModule, FechaLocalPipe, CurrencyMxnPipe],
  templateUrl: './movimientos.component.html',
  styleUrl: './movimientos.component.scss'
})
export class MovimientosComponent implements AfterViewInit {
  @ViewChild('movProductoRef') movProductoRef?: ElementRef<HTMLInputElement>;

  public tipoMov = signal<MovimientoInventario['tipo'] | 'TRASPASO'>('ENTRADA');
  public codigoSeleccionado = signal<string>('');
  public cantidad = signal<number>(1);
  public costoUnitario = signal<number | null>(null);
  public actualizarPrecioVenta = signal<boolean>(false);
  public nuevoPrecioVentaSugerido = signal<number | null>(null);
  public motivo = signal<string>('');
  public modalLotesFifoAbierto = signal<boolean>(false);

  // Sucursales para el movimiento
  public sucursalOrigen = signal<string>('SUC-MAIN');
  public sucursalDestinoTraspaso = signal<string>('');
  public sucursalFiltroKardex = signal<string>('TODAS');

  // Autocomplete y búsqueda interactiva de productos
  public busquedaProducto = signal<string>('');
  public mostrarSugerencias = signal<boolean>(false);
  public indiceSeleccionado = signal<number>(-1);

  public guardando = signal<boolean>(false);
  public depurandoDuplicados = signal<boolean>(false);
  public mensajeExito = signal<string | null>(null);
  public mensajeError = signal<string | null>(null);

  public movimientosService = inject(MovimientosService);
  public productosService = inject(ProductosService);
  public sucursalesService = inject(SucursalesService);

  ngAfterViewInit(): void {
    setTimeout(() => this.movProductoRef?.nativeElement.focus(), 100);
    const act = this.sucursalesService.activaId();
    if (act) {
      this.sucursalOrigen.set(act);
    }
  }

  public productoSeleccionado = computed<Producto | undefined>(() => {
    const cod = this.codigoSeleccionado();
    if (!cod) return undefined;
    return this.productosService.obtenerPorCodigo(cod);
  });

  public stockActualProducto = computed(() => {
    const prod = this.productoSeleccionado();
    if (!prod) return 0;
    const sid = this.sucursalOrigen();
    return this.productosService.obtenerStockSucursal(prod, sid).stockActual;
  });

  public precioVentaActual = computed(() => {
    return this.productoSeleccionado()?.precioVenta || 0;
  });

  public ultimoCostoProducto = computed(() => {
    const prod = this.productoSeleccionado();
    return prod?.ultimoCosto ?? null;
  });

  public fechaUltimoCostoProducto = computed(() => {
    const prod = this.productoSeleccionado();
    return prod?.fechaUltimoCosto ?? null;
  });

  public costoFifoActual = computed(() => {
    const prod = this.productoSeleccionado();
    if (!prod) return null;
    return this.productosService.obtenerCostoFifoActual(prod, this.sucursalOrigen());
  });

  public lotesFifoActivos = computed(() => {
    const prod = this.productoSeleccionado();
    if (!prod) return [];
    return this.productosService.obtenerLotesFifoActivos(prod, this.sucursalOrigen());
  });

  public costoTotalCalculado = computed(() => {
    const c = this.costoUnitario();
    const cant = this.cantidad() || 0;
    if (c === null || c === undefined || isNaN(c) || c < 0) return 0;
    return cant * c;
  });

  public margenEstimado = computed(() => {
    const prod = this.productoSeleccionado();
    const costo = this.costoUnitario();
    if (!prod || costo === null || costo === undefined || isNaN(costo) || costo < 0) return null;
    const precioVenta = prod.precioVenta || 0;
    if (precioVenta <= 0) return null;

    const ganancia = precioVenta - costo;
    const margenPorcentaje = Math.round((ganancia / precioVenta) * 100);
    const markup = costo > 0 ? Math.round((ganancia / costo) * 100) : 0;

    return {
      ganancia,
      margenPorcentaje,
      markup
    };
  });

  public costoMayorQuePrecio = computed(() => {
    const costo = this.costoUnitario();
    const precio = this.precioVentaActual();
    return costo !== null && costo > 0 && precio > 0 && costo >= precio;
  });

  public precioSugerido30 = computed(() => {
    const costo = this.costoUnitario();
    if (costo === null || costo <= 0) return 0;
    // Margen deseado de 30%: costo / (1 - 0.30)
    return Math.ceil((costo / 0.70) * 10) / 10;
  });

  public margenConNuevoPrecio = computed(() => {
    const costo = this.costoUnitario();
    const nuevo = this.nuevoPrecioVentaSugerido();
    if (costo === null || costo <= 0 || nuevo === null || nuevo <= 0) return null;
    const ganancia = nuevo - costo;
    const margenPorcentaje = Math.round((ganancia / nuevo) * 100);
    const markup = Math.round((ganancia / costo) * 100);
    return { ganancia, margenPorcentaje, porcentaje: margenPorcentaje, markup };
  });

  public sugerenciasProductos = computed<Producto[]>(() => {
    const query = this.busquedaProducto().trim().toLowerCase();
    const list = this.productosService.productos();
    if (!query) {
      return list.slice(0, 15);
    }
    return list
      .filter((p) => {
        const cod = (p.codigo || '').toLowerCase();
        const nom = (p.nombre || '').toLowerCase();
        const grp = (p.grupo || '').toLowerCase();
        return cod.includes(query) || nom.includes(query) || grp.includes(query);
      })
      .slice(0, 20);
  });

  public movimientosFiltrados = computed(() => {
    const list = this.movimientosService.movimientos();
    const sf = this.sucursalFiltroKardex();
    if (sf === 'TODAS') return list;
    return list.filter((m) => (m.sucursalId || 'SUC-MAIN') === sf);
  });

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.busquedaProducto.set(input.value);
    this.mostrarSugerencias.set(true);
    this.indiceSeleccionado.set(-1);

    const exacto = this.productosService.obtenerPorCodigo(input.value.trim());
    if (exacto) {
      this.codigoSeleccionado.set(exacto.codigo);
      if (this.tipoMov() === 'ENTRADA' && exacto.ultimoCosto !== undefined && exacto.ultimoCosto > 0) {
        this.costoUnitario.set(exacto.ultimoCosto);
      }
    } else {
      this.codigoSeleccionado.set('');
    }
  }

  onInputFocus(): void {
    this.mostrarSugerencias.set(true);
  }

  cerrarSugerencias(): void {
    setTimeout(() => {
      this.mostrarSugerencias.set(false);
      this.indiceSeleccionado.set(-1);
    }, 200);
  }

  seleccionarProducto(prod: Producto): void {
    this.codigoSeleccionado.set(prod.codigo);
    this.busquedaProducto.set(`${prod.codigo} - ${prod.nombre}`);
    this.mostrarSugerencias.set(false);
    this.indiceSeleccionado.set(-1);

    this.actualizarPrecioVenta.set(false);
    this.nuevoPrecioVentaSugerido.set(null);

    if (this.tipoMov() === 'ENTRADA' && prod.ultimoCosto !== undefined && prod.ultimoCosto > 0) {
      this.costoUnitario.set(prod.ultimoCosto);
    }
  }

  limpiarSeleccion(): void {
    this.codigoSeleccionado.set('');
    this.busquedaProducto.set('');
    this.costoUnitario.set(null);
    this.actualizarPrecioVenta.set(false);
    this.nuevoPrecioVentaSugerido.set(null);
    this.mostrarSugerencias.set(true);
  }

  onCostoChange(valor: any): void {
    if (valor === '' || valor === null || valor === undefined) {
      this.costoUnitario.set(null);
    } else {
      const num = Number(valor);
      this.costoUnitario.set(!isNaN(num) && num >= 0 ? num : null);
    }
  }

  onToggleActualizarPrecio(activo: boolean): void {
    this.actualizarPrecioVenta.set(activo);
    if (activo && !this.nuevoPrecioVentaSugerido()) {
      this.aplicarPrecioSugerido(30);
    }
  }

  onNuevoPrecioChange(valor: any): void {
    if (valor === '' || valor === null || valor === undefined) {
      this.nuevoPrecioVentaSugerido.set(null);
    } else {
      const num = Number(valor);
      this.nuevoPrecioVentaSugerido.set(!isNaN(num) && num > 0 ? num : null);
    }
  }

  aplicarPrecioSugerido(margenPorc = 30): void {
    const costo = this.costoUnitario();
    if (!costo || costo <= 0) return;
    const factor = Math.max(0.05, 1 - (margenPorc / 100));
    const sugerido = Math.ceil((costo / factor) * 10) / 10;
    this.nuevoPrecioVentaSugerido.set(sugerido);
    this.actualizarPrecioVenta.set(true);
  }

  navegarSugerencias(delta: number, event: Event): void {
    event.preventDefault();
    const max = this.sugerenciasProductos().length;
    if (max === 0) return;
    if (!this.mostrarSugerencias()) {
      this.mostrarSugerencias.set(true);
      this.indiceSeleccionado.set(0);
      return;
    }
    let nuevo = this.indiceSeleccionado() + delta;
    if (nuevo < 0) nuevo = max - 1;
    if (nuevo >= max) nuevo = 0;
    this.indiceSeleccionado.set(nuevo);
  }

  onEnterProducto(event?: Event): void {
    if (event) event.preventDefault();
    const sugs = this.sugerenciasProductos();
    const idx = this.indiceSeleccionado();
    if (this.mostrarSugerencias() && idx >= 0 && sugs[idx]) {
      this.seleccionarProducto(sugs[idx]);
    } else if (sugs.length === 1) {
      this.seleccionarProducto(sugs[0]);
    } else if (this.codigoSeleccionado()) {
      this.mostrarSugerencias.set(false);
    }
  }

  obtenerNombreProducto(mov: MovimientoInventario): string {
    const nombreGuardado = (mov?.nombre || '').trim();
    if (nombreGuardado && nombreGuardado.toLowerCase() !== 'producto') {
      return nombreGuardado;
    }

    const prod = this.productosService.obtenerPorCodigo(mov?.codigo);
    if (prod?.nombre && prod.nombre.trim().toLowerCase() !== 'producto') {
      return prod.nombre;
    }

    return nombreGuardado || 'Producto';
  }

  obtenerNombreSucursal(sucId?: string): string {
    if (!sucId) return 'Matriz';
    const suc = this.sucursalesService.sucursales().find((s) => s.id === sucId);
    return suc?.nombre || sucId;
  }

  abrirModalLotesFifo(): void {
    this.modalLotesFifoAbierto.set(true);
  }

  cerrarModalLotesFifo(): void {
    this.modalLotesFifoAbierto.set(false);
  }

  async onRegistrarMovimiento(): Promise<void> {
    const cod = this.codigoSeleccionado();
    const cant = this.cantidad();
    if (!cod || cant <= 0 || this.guardando()) return;

    this.guardando.set(true);
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    const tipo = this.tipoMov();
    const origenId = this.sucursalOrigen() || this.sucursalesService.activaId() || 'SUC-MAIN';
    const costoUnit = this.costoUnitario();

    try {
      if (tipo === 'TRASPASO') {
        const destinoId = this.sucursalDestinoTraspaso();
        if (!destinoId) {
          throw new Error('Por favor selecciona la sucursal de destino para el traspaso.');
        }
        await this.movimientosService.registrarTraspaso(
          cod,
          cant,
          origenId,
          destinoId,
          this.motivo()
        );
        this.mensajeExito.set(`Traspaso de ${cant} piezas realizado con éxito.`);
      } else {
        await this.movimientosService.registrarMovimiento(
          tipo,
          cod,
          cant,
          this.motivo(),
          origenId,
          costoUnit !== null && costoUnit !== undefined && costoUnit >= 0 ? Number(costoUnit) : undefined
        );

        // Si el usuario decidió actualizar el precio de venta general del producto en el catálogo
        if (
          this.actualizarPrecioVenta() &&
          this.nuevoPrecioVentaSugerido() !== null &&
          this.nuevoPrecioVentaSugerido()! > 0
        ) {
          await this.productosService.actualizarPrecioVenta(cod, Number(this.nuevoPrecioVentaSugerido()));
          this.mensajeExito.set(
            `✅ Movimiento registrado y precio de venta actualizado a $${Number(this.nuevoPrecioVentaSugerido()).toFixed(2)} exitosamente.`
          );
        } else {
          this.mensajeExito.set('Movimiento de stock registrado exitosamente.');
        }
      }

      this.cantidad.set(1);
      this.costoUnitario.set(null);
      this.actualizarPrecioVenta.set(false);
      this.nuevoPrecioVentaSugerido.set(null);
      this.motivo.set('');
      this.limpiarSeleccion();
      this.mostrarSugerencias.set(false);
      setTimeout(() => this.mensajeExito.set(null), 4000);
    } catch (e: any) {
      this.mensajeError.set(e.message || 'Error al registrar movimiento.');
      setTimeout(() => this.mensajeError.set(null), 5000);
    } finally {
      this.guardando.set(false);
    }
  }

  async onDepurarDuplicados(): Promise<void> {
    if (this.depurandoDuplicados() || this.guardando()) return;

    const confirmar = confirm(
      '¿Deseas validar y eliminar los movimientos duplicados en la base de datos basándose en fecha exacta, ID y datos idénticos?'
    );
    if (!confirmar) return;

    this.depurandoDuplicados.set(true);
    this.mensajeExito.set(null);
    this.mensajeError.set(null);

    try {
      const res = await this.movimientosService.depurarMovimientosDuplicados();
      if (res.duplicadosEliminados > 0) {
        this.mensajeExito.set(
          `🧹 Se depuraron con éxito ${res.duplicadosEliminados} movimiento(s) duplicado(s). Registros limpios actuales: ${res.totalLimpios}.`
        );
      } else {
        this.mensajeExito.set('✨ No se encontraron movimientos duplicados. La base de datos está íntegra.');
      }
      setTimeout(() => this.mensajeExito.set(null), 5000);
    } catch (e: any) {
      this.mensajeError.set(e.message || 'Error al depurar movimientos duplicados.');
      setTimeout(() => this.mensajeError.set(null), 5000);
    } finally {
      this.depurandoDuplicados.set(false);
    }
  }
}
