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
import { SociosService } from '../../core/services/socios.service';
import { GastosService } from '../../core/services/gastos.service';
import { Venta, Producto } from '../../core/models/models';
import { ScannerCamaraModalComponent } from '../../shared/components/scanner-camara-modal/scanner-camara-modal.component';
import { getFechaLocalString } from '../../shared/utils/date.util';

@Component({
  selector: 'app-ventas',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe, FechaLocalPipe, NgTemplateOutlet, ScannerCamaraModalComponent],
  templateUrl: './ventas.component.html',
  styleUrl: './ventas.component.scss'
})
export class VentasComponent implements AfterViewInit {
  @ViewChild('codigoInputRef') codigoInputRef?: ElementRef<HTMLInputElement>;

  public codigoBusqueda = signal<string>('');
  public cantidadAgregar = 1;
  public mensajeAlerta = signal<string>('');
  public tipoAlerta = signal<'warning' | 'success'>('warning');

  // Escáner de Códigos con Cámara
  public scannerModalAbierto = signal<boolean>(false);

  public mostrarSugerencias = signal<boolean>(false);
  public indiceSeleccionado = signal<number>(-1);

  public sonidoAgregarCarrito = new Audio('assets/ball-origin-beep.mp3');
  public sonidoFinalizarVenta = new Audio('assets/hell_AJWSn3e.mp3');

  ngAfterViewInit(): void {
    this.enfocarInputEscaneo();
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
  public reembolsarEfectivoDeCajaTurno = signal<boolean>(true);

  // Socio que recibe transferencia o tarjeta
  public socioTransferenciaId = signal<string>('');
  public socioTarjetaId = signal<string>('');

  // Filtros del Listado de Ventas / Historial
  public filtroPeriodoVentas = signal<'HOY' | 'AYER' | 'SEMANA' | 'TODAS'>('HOY');
  public busquedaFolioVentas = signal<string>('');

  public ventasService = inject(VentasService);
  public productosService = inject(ProductosService);
  public sucursalesService = inject(SucursalesService);
  public configuracionService = inject(ConfiguracionService);
  public authService = inject(AuthService);
  public sociosService = inject(SociosService);
  public gastosService = inject(GastosService);

  public ventasVisualizadas = computed(() => {
    const todas = this.ventasService.ventas();
    const query = this.busquedaFolioVentas().trim().toLowerCase();

    // 1. Si hay texto en el buscador, busca en todas las ventas por Folio, Artículo o Sucursal
    if (query) {
      return todas
        .filter((v) => {
          const id = (v.id || '').toLowerCase();
          const tieneArticulo = (v.items || []).some(
            (it) => (it.nombre || '').toLowerCase().includes(query) || (it.codigo || '').toLowerCase().includes(query)
          );
          const sucursal = (v.sucursalNombre || '').toLowerCase();
          return id.includes(query) || tieneArticulo || sucursal.includes(query);
        })
        .slice(0, 100);
    }

    // 2. Si no hay búsqueda por texto, filtra por el periodo seleccionado
    const periodo = this.filtroPeriodoVentas();
    if (periodo === 'HOY') {
      return this.ventasService.ventasDeHoy();
    }

    if (periodo === 'AYER') {
      const ayer = new Date();
      ayer.setDate(ayer.getDate() - 1);
      const ayerStr = getFechaLocalString(ayer);
      return todas
        .filter((v) => {
          if (!v.fecha) return false;
          return getFechaLocalString(v.fecha) === ayerStr;
        })
        .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    }

    if (periodo === 'SEMANA') {
      const limite = new Date();
      limite.setDate(limite.getDate() - 7);
      limite.setHours(0, 0, 0, 0);
      return todas
        .filter((v) => {
          if (!v.fecha) return false;
          return new Date(v.fecha).getTime() >= limite.getTime();
        })
        .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
    }

    // 'TODAS'
    return [...todas]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 100);
  });

  public totalMontoVisualizado = computed(() => {
    return this.ventasVisualizadas()
      .filter((v) => v.estado !== 'CANCELADA')
      .reduce((acc, v) => acc + (v.total || 0), 0);
  });

  public esVentaDeFechaAnterior = computed(() => {
    const v = this.ventaACancelar();
    if (!v || !v.fecha) return false;
    return getFechaLocalString(v.fecha) !== getFechaLocalString();
  });

  public montoEfectivoDevolucion = computed(() => {
    const v = this.ventaACancelar();
    if (!v) return 0;
    const pagadoEfec = Number(v.pagos?.efectivo) || 0;
    const cambio = Number(v.cambio) || 0;
    return Math.max(0, pagadoEfec - cambio);
  });

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

  // ── Lector Físico de Código de Barras (Hardware Wedge) y Atajos POS ──
  private barcodeBuffer = '';
  private barcodeLastTime = 0;
  private barcodeKeyDelays: number[] = [];

  @HostListener('document:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    // F2 / Fn+F2 / Ctrl+K: Atajo para enfocar el buscador/escáner desde cualquier lugar
    const isF2 = event.key === 'F2' || event.code === 'F2' || event.key?.toLowerCase() === 'f2';
    const isCtrlK = (event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === 'k';

    if (isF2 || isCtrlK) {
      event.preventDefault();
      event.stopPropagation();
      this.enfocarInputEscaneo();
      return;
    }

    // F9: Atajo rápido para cobrar
    const isF9 = event.key === 'F9' || event.code === 'F9' || event.key?.toLowerCase() === 'f9';
    if (isF9) {
      event.preventDefault();
      event.stopPropagation();
      if (this.ventasService.carrito().length > 0 && !this.ventasService.procesandoCobro()) {
        this.realizarCobro();
      }
      return;
    }

    // Si hay un modal activo o abierto, no interceptar como pistola global
    if (
      this.modalPausarAbierto() ||
      this.modalCancelarAbierto() ||
      this.modalTicketAbierto() ||
      this.scannerModalAbierto()
    ) {
      return;
    }

    const activeEl = document.activeElement as HTMLElement | null;
    const isTargetInput = activeEl === this.codigoInputRef?.nativeElement || activeEl?.id === 'codigoInput';
    const isOtherInput =
      activeEl &&
      (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable) &&
      !isTargetInput;

    const now = Date.now();
    const timeDiff = now - this.barcodeLastTime;
    this.barcodeLastTime = now;

    // Si pasaron más de 110ms entre teclas, reiniciamos el búfer
    if (timeDiff > 110) {
      this.barcodeBuffer = '';
      this.barcodeKeyDelays = [];
    } else {
      this.barcodeKeyDelays.push(timeDiff);
    }

    // Procesar envío con Enter
    if (event.key === 'Enter') {
      const avgDelay =
        this.barcodeKeyDelays.length > 0
          ? this.barcodeKeyDelays.reduce((a, b) => a + b, 0) / this.barcodeKeyDelays.length
          : 999;

      // Si no estábamos en el input principal y fue una ráfaga de escáner (o usuario enfocado en área neutral)
      if (
        !isTargetInput &&
        this.barcodeBuffer.length >= 3 &&
        (avgDelay < 55 || !isOtherInput)
      ) {
        event.preventDefault();
        const escaneado = this.barcodeBuffer.trim();
        this.barcodeBuffer = '';
        this.barcodeKeyDelays = [];
        this.procesarEscaneoDirecto(escaneado);
        return;
      }

      this.barcodeBuffer = '';
      this.barcodeKeyDelays = [];
      return;
    }

    // Acumular caracteres simples (longitud 1 sin modificadores ctrl/alt)
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
      this.barcodeBuffer += event.key;
    }
  }

  enfocarInputEscaneo(): void {
    const doFocus = () => {
      const el =
        this.codigoInputRef?.nativeElement ||
        (document.getElementById('codigoInput') as HTMLInputElement | null);
      if (el) {
        el.focus();
        el.select();
      }
    };
    doFocus();
    setTimeout(doFocus, 30);
    setTimeout(doFocus, 100);
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

  seleccionarProducto(prod: Producto, cantidadCustom?: number): void {
    const cant = cantidadCustom && cantidadCustom > 0 ? cantidadCustom : this.cantidadAgregar;
    let precioManual: number | undefined;

    if (prod.precioVariable) {
      const resp = prompt(`Ingresa el precio de venta para "${prod.nombre}":`, prod.precioVenta.toString());
      if (resp === null) return; // Cancelado
      const parsed = parseFloat(resp);
      if (isNaN(parsed) || parsed <= 0) {
        alert('Precio inválido.');
        this.reproducirBeepError();
        return;
      }
      precioManual = parsed;
    }

    const agregado = this.ventasService.agregarAlCarrito(prod.codigo, cant, precioManual);
    if (agregado) {
      this.codigoBusqueda.set('');
      this.cantidadAgregar = 1;
      this.mensajeAlerta.set('');
      this.cerrarSugerencias();
      this.reproducirBeepExito();
    } else {
      this.mensajeAlerta.set(`⚠️ No se pudo agregar "${prod.nombre}".`);
      this.tipoAlerta.set('warning');
      this.reproducirBeepError();
    }

    this.enfocarInputEscaneo();
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

  reproducirBeepExito(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1350, ctx.currentTime);
        gain.gain.setValueAtTime(0.22, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      } else {
        this.reproducirSonidoAgregarCarrito();
      }
    } catch {
      this.reproducirSonidoAgregarCarrito();
    }

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(50);
      } catch {}
    }
  }

  reproducirBeepError(): void {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const playTone = (freq: number, start: number, dur: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
          gain.gain.setValueAtTime(0.18, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + dur);
        };
        playTone(220, 0, 0.08);
        playTone(180, 0.1, 0.12);
      }
    } catch {}

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([120, 50, 120]);
      } catch {}
    }
  }

  onEnterCodigo(event?: Event): void {
    if (event) {
      event.preventDefault();
    }

    let cod = this.codigoBusqueda().trim();
    if (!cod) return;

    let cantidad = 1;
    // Soporte de multiplicador rápido: ej. "3*750100" o "3x750100"
    const multiplicadorMatch = cod.match(/^(\d+)[*xX](.+)$/);
    if (multiplicadorMatch) {
      cantidad = Math.max(1, parseInt(multiplicadorMatch[1], 10));
      cod = multiplicadorMatch[2].trim();
    }

    const sugerencias = this.sugerenciasProductos();
    const idx = this.indiceSeleccionado();

    // Si hay una sugerencia seleccionada con el teclado o lista activa
    if (this.mostrarSugerencias() && idx >= 0 && sugerencias[idx]) {
      this.seleccionarProducto(sugerencias[idx], cantidad);
      return;
    }

    // Buscar coincidencia exacta por código
    const exacto = this.productosService.obtenerPorCodigo(cod);
    if (exacto) {
      this.seleccionarProducto(exacto, cantidad);
      return;
    }

    // Si hay sugerencias coincidentes, tomar la primera
    if (sugerencias.length > 0) {
      this.seleccionarProducto(sugerencias[0], cantidad);
      return;
    }

    // Si no se encontró nada
    this.mensajeAlerta.set(`⚠️ Producto "${cod}" no encontrado.`);
    this.tipoAlerta.set('warning');
    this.reproducirBeepError();
    this.cerrarSugerencias();
    this.enfocarInputEscaneo();
  }

  procesarEscaneoDirecto(texto: string): void {
    let cod = (texto || '').trim();
    if (!cod) return;

    let cantidad = 1;
    const multiplicadorMatch = cod.match(/^(\d+)[*xX](.+)$/);
    if (multiplicadorMatch) {
      cantidad = Math.max(1, parseInt(multiplicadorMatch[1], 10));
      cod = multiplicadorMatch[2].trim();
    }

    // 1. Buscar coincidencia exacta por código
    let prod = this.productosService.obtenerPorCodigo(cod);

    // 2. Si no es exacto, buscar coincidencia por nombre o código parcial
    if (!prod) {
      const match = this.productosService.productos().find(
        (p) =>
          (p.codigo || '').toLowerCase() === cod.toLowerCase() ||
          (p.nombre || '').toLowerCase() === cod.toLowerCase()
      );
      if (match) {
        prod = match;
      }
    }

    if (prod) {
      this.seleccionarProducto(prod, cantidad);
      this.codigoBusqueda.set('');
      this.cerrarSugerencias();
    } else {
      this.mensajeAlerta.set(`⚠️ Código "${cod}" no encontrado en catálogo.`);
      this.tipoAlerta.set('warning');
      this.reproducirBeepError();
      this.cerrarSugerencias();
    }

    this.enfocarInputEscaneo();
  }

  abrirScanner(): void {
    this.scannerModalAbierto.set(true);
  }

  cerrarScannerModal(): void {
    this.scannerModalAbierto.set(false);
    this.enfocarInputEscaneo();
  }

  onCodigoEscaneado(codigo: string): void {
    this.procesarEscaneoDirecto(codigo);
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
    this.enfocarInputEscaneo();
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
      let paramsDigitales: {
        socioTransferenciaId?: string;
        socioTransferenciaNombre?: string;
        socioTarjetaId?: string;
        socioTarjetaNombre?: string;
      } | undefined;

      if (this.ventasService.pagos().transferencia > 0) {
        const idSocio = this.socioTransferenciaId() || this.sociosService.socioTransferenciasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
        const socio = this.sociosService.socios().find((s) => s.id === idSocio);
        if (socio) {
          if (!paramsDigitales) paramsDigitales = {};
          paramsDigitales.socioTransferenciaId = socio.id;
          paramsDigitales.socioTransferenciaNombre = socio.nombre;
        }
      }

      if (this.ventasService.pagos().tarjeta > 0) {
        const idSocio = this.socioTarjetaId() || this.sociosService.socioTarjetasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
        const socio = this.sociosService.socios().find((s) => s.id === idSocio);
        if (socio) {
          if (!paramsDigitales) paramsDigitales = {};
          paramsDigitales.socioTarjetaId = socio.id;
          paramsDigitales.socioTarjetaNombre = socio.nombre;
        }
      }

      const venta = await this.ventasService.procesarVenta(paramsDigitales);
      this.socioTransferenciaId.set('');
      this.socioTarjetaId.set('');
      this.ticketVenta.set(venta);
      this.modalTicketAbierto.set(false); // No mostramos modal intrusivo

      this.reproducirSonidoFinalizarVenta();
      // Si la impresión automática está activada, lanzar diálogo de impresión directo
      if (this.autoImprimirTicket()) {
        setTimeout(() => {
          window.print();
        }, 100);
      }

      this.enfocarInputEscaneo();
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
    this.enfocarInputEscaneo();
  }

  abrirModalCancelar(venta: Venta): void {
    this.ventaACancelar.set(venta);
    this.motivoCancelacion = '';
    this.reponerStockCancelacion = true;
    const esAnterior = getFechaLocalString(venta.fecha) !== getFechaLocalString();
    const teniaEfectivo = (Number(venta.pagos?.efectivo) || 0) > 0;
    this.reembolsarEfectivoDeCajaTurno.set(esAnterior && teniaEfectivo);
    this.modalCancelarAbierto.set(true);
  }

  cerrarModalCancelar(): void {
    this.modalCancelarAbierto.set(false);
    this.ventaACancelar.set(null);
    this.motivoCancelacion = '';
    this.reembolsarEfectivoDeCajaTurno.set(true);
    this.enfocarInputEscaneo();
  }

  async confirmarCancelacionVenta(): Promise<void> {
    const venta = this.ventaACancelar();
    if (!venta) return;

    if (!this.motivoCancelacion.trim()) {
      alert('Por favor especifica el motivo de la cancelación o devolución.');
      return;
    }

    const esAnterior = this.esVentaDeFechaAnterior();
    const debeReembolsarEfectivo = esAnterior && this.reembolsarEfectivoDeCajaTurno();
    const montoAReembolsar = this.montoEfectivoDevolucion();

    let confirmMsg = `¿Estás seguro de cancelar la venta #${venta.id} por un monto de $${venta.total.toFixed(2)}? Esta acción reintegrará el inventario.`;
    if (esAnterior) {
      confirmMsg += `\n\n⚠️ Esta venta es de una fecha anterior (${new Date(venta.fecha).toLocaleDateString()}).`;
      if (debeReembolsarEfectivo && montoAReembolsar > 0) {
        confirmMsg += `\nSe registrará una salida de efectivo de $${montoAReembolsar.toFixed(2)} en la caja del turno actual para mantener el corte de caja cuadrado.`;
      }
    } else {
      confirmMsg += ` Esta acción ajustará el corte de caja del turno actual.`;
    }

    if (!confirm(confirmMsg)) {
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

      // Si es de un día anterior y se reembolsa dinero físico de la caja de hoy, registrar egreso en el corte activo
      if (debeReembolsarEfectivo && montoAReembolsar > 0) {
        try {
          await this.gastosService.registrarGasto({
            concepto: `Devolución Venta #${venta.id} (${this.motivoCancelacion.trim()})`,
            monto: montoAReembolsar,
            categoria: 'OTROS',
            persona: 'Caja (Negocio)',
            metodoPago: 'EFECTIVO',
            observaciones: `Reembolso en efectivo del ticket #${venta.id} emitido originalmente el ${new Date(venta.fecha).toLocaleDateString()}`
          });
        } catch (errGasto) {
          console.warn('Aviso al registrar gasto de devolución en turno actual:', errGasto);
        }
      }

      this.cerrarModalCancelar();
      this.mensajeAlerta.set(`✅ Venta #${venta.id} cancelada / devuelta exitosamente.`);
      this.tipoAlerta.set('success');
      setTimeout(() => this.mensajeAlerta.set(''), 4000);
    } catch (err: any) {
      alert(err.message || 'Error al cancelar la venta');
    } finally {
      this.cancelandoVenta.set(false);
    }
  }
}
