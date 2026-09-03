import { Component, signal, inject, ElementRef, ViewChild, computed, HostListener, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { VentasService } from '../../core/services/ventas.service';
import { ProductosService } from '../../core/services/productos.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { ConfiguracionService } from '../../core/services/configuracion.service';
import { AuthService } from '../../core/services/auth.service';
import { Venta, Producto } from '../../core/models/models';

@Component({
  selector: 'app-ventas',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe, FechaLocalPipe, NgTemplateOutlet],
  templateUrl: './ventas.component.html',
  styleUrl: './ventas.component.scss'
})
export class VentasComponent implements AfterViewInit {
  @ViewChild('codigoInputRef') codigoInputRef?: ElementRef<HTMLInputElement>;

  public codigoBusqueda = signal<string>('');
  public cantidadAgregar = 1;
  public mensajeAlerta = signal<string>('');
  public tipoAlerta = signal<'warning' | 'success'>('warning');

  public mostrarSugerencias = signal<boolean>(false);
  public indiceSeleccionado = signal<number>(-1);

  public sonidoAgregarCarrito = new Audio('assets/ball-origin-beep.mp3');
  public sonidoFinalizarVenta = new Audio('assets/hell_AJWSn3e.mp3');

  ngAfterViewInit(): void {
    setTimeout(() => this.codigoInputRef?.nativeElement.focus(), 100);
  }

  public modalPausarAbierto = signal<boolean>(false);
  public aliasPausa = '';
  public ticketVenta = signal<Venta | null>(null);
  public modalTicketAbierto = signal<boolean>(false);
  public autoImprimirTicket = signal<boolean>(localStorage.getItem('pos_auto_imprimir_ticket') !== 'false');

  // Modal Cancelar Venta / Devolución
  public modalCancelarAbierto = signal<boolean>(false);
  public ventaACancelar = signal<Venta | null>(null);
  public motivoCancelacion = '';
  public reponerStockCancelacion = true;
  public cancelandoVenta = signal<boolean>(false);

  public ventasService = inject(VentasService);
  public productosService = inject(ProductosService);
  public sucursalesService = inject(SucursalesService);
  public configuracionService = inject(ConfiguracionService);
  public authService = inject(AuthService);

  obtenerStockSucursal(prod: Producto): number {
    const sid = this.sucursalesService.activaId() || 'SUC-MAIN';
    return this.productosService.obtenerStockSucursal(prod, sid).stockActual;
  }

  public totalArticulosTicket = computed(() => {
    const v = this.ticketVenta();
    if (!v || !v.items) return 0;
    return v.items.reduce((acc, it) => acc + (it.cantidad || 0), 0);
  });

  public sugerenciasProductos = computed(() => {
    const q = this.codigoBusqueda().trim().toLowerCase();
    if (!q || q.length < 1) return [];

    return this.productosService
      .productos()
      .filter(
        (p) =>
          (p.codigo || '').toLowerCase().includes(q) ||
          (p.nombre || '').toLowerCase().includes(q)
      )
      .slice(0, 8);
  });

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.search-autocomplete-container')) {
      this.mostrarSugerencias.set(false);
    }
  }

  onInputChange(event?: Event): void {
    if (event) {
      const val = (event.target as HTMLInputElement).value || '';
      this.codigoBusqueda.set(val);
    }
    const q = this.codigoBusqueda().trim();
    if (q.length > 0) {
      this.mostrarSugerencias.set(true);
      this.indiceSeleccionado.set(0);
    } else {
      this.mostrarSugerencias.set(false);
      this.indiceSeleccionado.set(-1);
    }
  }

  onInputFocus(): void {
    if (this.codigoBusqueda().trim().length > 0 && this.sugerenciasProductos().length > 0) {
      this.mostrarSugerencias.set(true);
    }
  }

  cerrarSugerencias(): void {
    this.mostrarSugerencias.set(false);
    this.indiceSeleccionado.set(-1);
  }

  navegarSugerencias(delta: number, event: Event): void {
    if (!this.mostrarSugerencias()) {
      this.mostrarSugerencias.set(true);
      return;
    }
    event.preventDefault();
    const total = this.sugerenciasProductos().length;
    if (total === 0) return;

    let nuevoIdx = this.indiceSeleccionado() + delta;
    if (nuevoIdx < 0) nuevoIdx = total - 1;
    if (nuevoIdx >= total) nuevoIdx = 0;
    this.indiceSeleccionado.set(nuevoIdx);
  }

  seleccionarProducto(prod: Producto): void {
    let precioManual: number | undefined;

    if (prod.precioVariable) {
      const resp = prompt(`Ingresa el precio de venta para "${prod.nombre}":`, prod.precioVenta.toString());
      if (resp === null) return; // Cancelado
      const parsed = parseFloat(resp);
      if (isNaN(parsed) || parsed <= 0) {
        alert('Precio inválido.');
        return;
      }
      precioManual = parsed;
    }

    const agregado = this.ventasService.agregarAlCarrito(prod.codigo, this.cantidadAgregar, precioManual);
    if (agregado) {
      this.codigoBusqueda.set('');
      this.cantidadAgregar = 1;
      this.mensajeAlerta.set('');
      this.cerrarSugerencias();
      this.reproducirSonidoAgregarCarrito();
    }

    setTimeout(() => this.codigoInputRef?.nativeElement.focus(), 50);
  }

  reproducirSonidoAgregarCarrito(): void {
    try {
      this.sonidoAgregarCarrito.currentTime = 0;
      this.sonidoAgregarCarrito.play().catch((err) => {
        console.warn('Audio play bloqueado o falló:', err);
      });
    } catch (err) {
      console.warn('Error al reproducir sonido:', err);
    }
  }

  onEnterCodigo(event?: Event): void {
    if (event) {
      event.preventDefault();
    }

    const sugerencias = this.sugerenciasProductos();
    const idx = this.indiceSeleccionado();

    // Si hay una sugerencia seleccionada con el teclado o lista activa
    if (this.mostrarSugerencias() && idx >= 0 && sugerencias[idx]) {
      this.seleccionarProducto(sugerencias[idx]);
      return;
    }

    const cod = this.codigoBusqueda().trim();
    if (!cod) return;

    // Buscar coincidencia exacta por código
    const exacto = this.productosService.obtenerPorCodigo(cod);
    if (exacto) {
      this.seleccionarProducto(exacto);
      return;
    }

    // Si hay sugerencias coincidentes, tomar la primera
    if (sugerencias.length > 0) {
      this.seleccionarProducto(sugerencias[0]);
      return;
    }

    // Si no se encontró nada
    this.mensajeAlerta.set(`⚠️ Producto "${cod}" no encontrado.`);
    this.tipoAlerta.set('warning');
    this.cerrarSugerencias();
    setTimeout(() => this.codigoInputRef?.nativeElement.focus(), 50);
  }

  modificarCantidad(index: number, delta: number): void {
    const item = this.ventasService.carrito()[index];
    if (item) {
      this.ventasService.actualizarCantidadItem(index, item.cantidad + delta);
    }
  }

  onCantidadChange(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const cant = parseInt(input.value, 10) || 1;
    this.ventasService.actualizarCantidadItem(index, cant);
  }

  onPagoChange(metodo: 'efectivo' | 'tarjeta' | 'transferencia', valor: number): void {
    const current = { ...this.ventasService.pagos() };
    current[metodo] = Math.max(0, valor || 0);
    this.ventasService.pagos.set(current);
  }

  setExacto(): void {
    this.ventasService.ajustarPagoEfectivoPorDefecto();
  }

  setEfectivo(monto: number): void {
    const current = { ...this.ventasService.pagos() };
    current.efectivo = monto;
    this.ventasService.pagos.set(current);
  }

  abrirModalPausar(): void {
    this.aliasPausa = `Cuenta ${this.ventasService.carritosPendientes().length + 1}`;
    this.modalPausarAbierto.set(true);
  }

  async confirmarPausa(): Promise<void> {
    await this.ventasService.pausarVentaEnEspera(this.aliasPausa);
    this.modalPausarAbierto.set(false);
  }

  toggleAutoImprimir(): void {
    const nuevo = !this.autoImprimirTicket();
    this.autoImprimirTicket.set(nuevo);
    localStorage.setItem('pos_auto_imprimir_ticket', nuevo ? 'true' : 'false');
  }

  reproducirSonidoFinalizarVenta(): void {
    try {
      this.sonidoFinalizarVenta.currentTime = 0;
      this.sonidoFinalizarVenta.play().catch((err) => {
        console.warn('Audio play bloqueado o falló:', err);
      });
    } catch (err) {
      console.warn('Error al reproducir sonido:', err);
    }
  }

  async realizarCobro(): Promise<void> {
    if (this.ventasService.procesandoCobro()) {
      return;
    }

    try {
      const venta = await this.ventasService.procesarVenta();
      this.ticketVenta.set(venta);
      this.modalTicketAbierto.set(false); // No mostramos modal intrusivo

      this.reproducirSonidoFinalizarVenta();
      // Si la impresión automática está activada, lanzar diálogo de impresión directo
      if (this.autoImprimirTicket()) {
        setTimeout(() => {
          window.print();
        }, 50);
      }

      setTimeout(() => this.codigoInputRef?.nativeElement.focus(), 150);
    } catch (err: any) {
      alert(err.message || 'Error al procesar cobro');
    }
  }

  imprimirTicket(): void {
    window.print();
  }

  verTicket(venta: Venta): void {
    this.ticketVenta.set(venta);
    this.modalTicketAbierto.set(true);
  }

  cerrarModalTicket(): void {
    this.modalTicketAbierto.set(false);
  }

  abrirModalCancelar(venta: Venta): void {
    this.ventaACancelar.set(venta);
    this.motivoCancelacion = '';
    this.reponerStockCancelacion = true;
    this.modalCancelarAbierto.set(true);
  }

  cerrarModalCancelar(): void {
    this.modalCancelarAbierto.set(false);
    this.ventaACancelar.set(null);
    this.motivoCancelacion = '';
  }

  async confirmarCancelacionVenta(): Promise<void> {
    const venta = this.ventaACancelar();
    if (!venta) return;

    if (!this.motivoCancelacion.trim()) {
      alert('Por favor especifica el motivo de la cancelación o devolución.');
      return;
    }

    if (!confirm(`¿Estás seguro de cancelar la venta #${venta.id} por un monto de $${venta.total.toFixed(2)}? Esta acción ajustará el corte de caja y el inventario.`)) {
      return;
    }

    this.cancelandoVenta.set(true);
    try {
      await this.ventasService.cancelarVenta({
        ventaId: venta.id,
        motivo: this.motivoCancelacion.trim(),
        reponerInventario: this.reponerStockCancelacion,
        usuario: this.authService.nombreUsuario()
      });

      this.cerrarModalCancelar();
      this.mensajeAlerta.set(`✅ Venta #${venta.id} cancelada exitosamente.`);
      this.tipoAlerta.set('success');
      setTimeout(() => this.mensajeAlerta.set(''), 4000);
    } catch (err: any) {
      alert(err.message || 'Error al cancelar la venta');
    } finally {
      this.cancelandoVenta.set(false);
    }
  }
}
