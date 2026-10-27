import { Component, signal, inject, computed, HostListener, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { PedidosService, AnalisisConsolidacion } from '../../core/services/pedidos.service';
import { ProductosService } from '../../core/services/productos.service';
import { ConfiguracionService } from '../../core/services/configuracion.service';
import { SociosService } from '../../core/services/socios.service';
import { ClientesService } from '../../core/services/clientes.service';
import { FirestoreChunksService } from '../../core/services/firestore-chunks.service';
import { generateQRCodeDataUrl } from '../../shared/utils/qrcode.util';
import { PedidoPersonalizado, MateriaPrimaItem, Producto, Cliente } from '../../core/models/models';
import { generarTrackingToken } from '../../core/utils/consecutivo.util';

export interface ItemPedidoForm {
  tipo: 'INVENTARIO' | 'EXTRA';
  codigo?: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  busqueda?: string;
  mostrarSugerencias?: boolean;
}

@Component({
  selector: 'app-pedidos',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe, NgTemplateOutlet, UpperCasePipe],
  templateUrl: './pedidos.component.html',
  styleUrl: './pedidos.component.scss'
})
export class PedidosComponent implements AfterViewInit {
  @ViewChild('busquedaInputRef') busquedaInputRef?: ElementRef<HTMLInputElement>;

  // Filtros
  public busquedaTexto = signal<string>('');
  public filtroEstado = signal<string>('TODOS');
  public filtroDesde = signal<string>('');
  public filtroHasta = signal<string>('');

  ngAfterViewInit(): void {
    setTimeout(() => this.busquedaInputRef?.nativeElement.focus(), 100);
  }

  // Modales
  public modalNuevoAbierto = signal<boolean>(false);
  public modalTicketAbierto = signal<boolean>(false);
  public modalFacturaCartaAbierto = signal<boolean>(false);
  public modalLiquidarAbierto = signal<boolean>(false);
  public modalDetalleAbierto = signal<boolean>(false);
  public modalEditarAbierto = signal<boolean>(false);
  public modalCancelarAbierto = signal<boolean>(false);

  public pedidoSeleccionado = signal<PedidoPersonalizado | null>(null);
  public pedidoDetalle = signal<PedidoPersonalizado | null>(null);
  public pedidoACancelar = signal<PedidoPersonalizado | null>(null);
  public motivoCancelacionPedido = '';
  public reponerStockPedido = true;
  public cancelandoPedido = signal<boolean>(false);
  public autoImprimirTicket = signal<boolean>(localStorage.getItem('pos_auto_imprimir_ticket') !== 'false');
  public mostrarQrSeguimiento = signal<boolean>(localStorage.getItem('pos_mostrar_qr_pedidos') !== 'false');
  public modalExitoNuevoAbierto = signal<boolean>(false);
  public pedidoRecienCreado = signal<PedidoPersonalizado | null>(null);
  public copiadoExito = signal<boolean>(false);
  public mensajeToast = signal<string | null>(null);

  mostrarToast(mensaje: string): void {
    this.mensajeToast.set(mensaje);
    setTimeout(() => {
      if (this.mensajeToast() === mensaje) {
        this.mensajeToast.set(null);
      }
    }, 3200);
  }

  // Formulario nuevo
  public nuevoCliente = '';
  public nuevoTelefono = '';
  public nuevaFechaEntrega = '';
  public nuevasEspecificaciones = '';
  public nuevoTotal = 0;
  public nuevoAnticipo = 0;
  public metodoPagoAnticipo = 'EFECTIVO';
  public socioTransferenciaAnticipoId = signal<string>('');
  public socioTarjetaAnticipoId = signal<string>('');
  public itemsPedido = signal<ItemPedidoForm[]>([]);

  // Autocompletado de Clientes en Nuevo Pedido
  public sugerenciasClientes = signal<Cliente[]>([]);
  public mostrarSugerenciasClientes = signal<boolean>(false);
  public clienteSeleccionadoId = signal<string | null>(null);
  public guardarClienteNuevoEnCatalogo = signal<boolean>(true);

  // Formulario Editar
  public editandoId = '';
  public editCliente = '';
  public editTelefono = '';
  public editFechaEntrega = '';
  public editEspecificaciones = '';
  public editTotal = 0;
  public editItems = signal<ItemPedidoForm[]>([]);
  public pedidoEditando = signal<PedidoPersonalizado | null>(null);
  public montoAbonoEditar = 0;
  public metodoPagoAbonoEditar = 'EFECTIVO';
  public socioTransferenciaAbonoEditarId = signal<string>('');
  public socioTarjetaAbonoEditarId = signal<string>('');
  public conceptoAbonoEditar = 'Abono a cuenta';

  // Autocompletado de Clientes en Editar Pedido
  public sugerenciasEditClientes = signal<Cliente[]>([]);
  public mostrarSugerenciasEditClientes = signal<boolean>(false);
  public editClienteId = signal<string | null>(null);

  // Registro de Abono en Detalle
  public montoNuevoAbono = 0;
  public metodoPagoNuevoAbono = 'EFECTIVO';
  public socioTransferenciaAbonoId = signal<string>('');
  public socioTarjetaAbonoId = signal<string>('');
  public conceptoNuevoAbono = 'Abono a cuenta';

  // Liquidación
  public metodoPagoLiquidacion = 'EFECTIVO';
  public socioTransferenciaLiquidacionId = signal<string>('');
  public socioTarjetaLiquidacionId = signal<string>('');

  public pedidosService = inject(PedidosService);
  public productosService = inject(ProductosService);
  public configService = inject(ConfiguracionService);
  public sociosService = inject(SociosService);
  public clientesService = inject(ClientesService);
  public firestoreChunksService = inject(FirestoreChunksService);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.autocomplete-wrapper')) {
      const current = this.itemsPedido();
      let changed = false;
      for (const it of current) {
        if (it.mostrarSugerencias) {
          it.mostrarSugerencias = false;
          changed = true;
        }
      }
      if (changed) {
        this.itemsPedido.set([...current]);
      }
    }

    if (!target.closest('.cliente-autocomplete-container')) {
      this.mostrarSugerenciasClientes.set(false);
      this.mostrarSugerenciasEditClientes.set(false);
    }
  }

  // KPIs
  public totalPedidos = computed(() => this.pedidosService.pedidos().length);

  public pendientesCount = computed(
    () => this.pedidosService.pedidos().filter((p) => p.estado === 'PENDIENTE').length
  );

  public enProcesoCount = computed(
    () => this.pedidosService.pedidos().filter((p) => p.estado === 'EN_PROCESO').length
  );

  public terminadosCount = computed(
    () => this.pedidosService.pedidos().filter((p) => p.estado === 'TERMINADO' || p.estado === 'LISTO').length
  );

  public entregadosCount = computed(
    () => this.pedidosService.pedidos().filter((p) => p.estado === 'ENTREGADO').length
  );

  public vencidosCount = computed(() => {
    return this.pedidosService.pedidos().filter((p) => this.esPedidoVencido(p)).length;
  });

  // Datos complementarios para Simulación de Factura / Hoja Carta
  public clientePedidoActual = computed(() => {
    const ped = this.pedidoSeleccionado();
    if (!ped) return null;
    const lista = this.clientesService.clientes();
    if (ped.clienteId) {
      const porId = lista.find((c) => c.id === ped.clienteId);
      if (porId) return porId;
    }
    if (ped.clienteNombre) {
      const porNombre = lista.find(
        (c) => c.nombre.trim().toLowerCase() === ped.clienteNombre.trim().toLowerCase()
      );
      if (porNombre) return porNombre;
    }
    return null;
  });

  public sumaMateriasPrimas = computed(() => {
    const ped = this.pedidoSeleccionado();
    if (!ped?.materiasPrimas) return 0;
    return ped.materiasPrimas.reduce((acc, it) => acc + (it.subtotal || 0), 0);
  });

  public manoObraPersonalizada = computed(() => {
    const ped = this.pedidoSeleccionado();
    if (!ped) return 0;
    const dif = (ped.totalAcordado || 0) - this.sumaMateriasPrimas();
    return dif > 0 ? dif : 0;
  });

  public totalAbonadoPedido = computed(() => {
    const ped = this.pedidoSeleccionado();
    if (!ped) return 0;
    return (ped.totalAcordado || 0) - (ped.saldoRestante || 0);
  });

  // Lista Filtrada
  public pedidosFiltrados = computed(() => {
    let list = this.pedidosService.pedidos();
    const q = this.busquedaTexto().trim().toLowerCase();
    const est = this.filtroEstado();
    const desde = this.filtroDesde();
    const hasta = this.filtroHasta();

    // Filtro por texto (Folio, Cliente, Teléfono, Especificaciones)
    if (q) {
      list = list.filter(
        (p) =>
          (p.id || '').toLowerCase().includes(q) ||
          (p.clienteNombre || '').toLowerCase().includes(q) ||
          (p.clienteTelefono || '').toLowerCase().includes(q) ||
          (p.especificaciones || '').toLowerCase().includes(q)
      );
    }

    // Filtro por estado
    if (est !== 'TODOS') {
      if (est === 'VENCIDO') {
        list = list.filter((p) => this.esPedidoVencido(p));
      } else if (est === 'TERMINADO') {
        list = list.filter((p) => p.estado === 'TERMINADO' || p.estado === 'LISTO');
      } else {
        list = list.filter((p) => p.estado === est);
      }
    }

    // Filtro por fechas
    if (desde) {
      list = list.filter((p) => {
        const fecha = p.fechaRegistro ? p.fechaRegistro.split('T')[0] : '';
        return fecha >= desde;
      });
    }

    if (hasta) {
      list = list.filter((p) => {
        const fecha = p.fechaRegistro ? p.fechaRegistro.split('T')[0] : '';
        return fecha <= hasta;
      });
    }

    // Ordenar de mayor a menor (por Folio / Fecha más reciente primero)
    return [...list].sort((a, b) => {
      const numA = parseInt(a.id?.replace(/\D/g, '') || '0', 10);
      const numB = parseInt(b.id?.replace(/\D/g, '') || '0', 10);
      if (numA !== numB) {
        return numB - numA;
      }
      const fechaA = a.fechaRegistro || '';
      const fechaB = b.fechaRegistro || '';
      return fechaB.localeCompare(fechaA);
    });
  });

  public fechaActualReporte = computed(() => {
    const ahora = new Date();
    return ahora.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  });

  public montoTotalReporte = computed(() => {
    return this.pedidosFiltrados().reduce((acc, p) => acc + (p.totalAcordado || 0), 0);
  });

  public anticipoTotalReporte = computed(() => {
    return this.pedidosFiltrados().reduce((acc, p) => acc + (p.anticipo || 0), 0);
  });

  public saldoTotalReporte = computed(() => {
    return this.pedidosFiltrados().reduce((acc, p) => acc + (p.saldoRestante || 0), 0);
  });

  // Helpers de formato
  formatearFecha(isoString?: string): string {
    if (!isoString) return '-';
    try {
      const parts = isoString.split('T')[0].split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      const d = new Date(isoString);
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const anio = d.getFullYear();
      return `${dia}/${mes}/${anio}`;
    } catch {
      return isoString;
    }
  }

  formatearFechaHora(isoString?: string): string {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const anio = d.getFullYear();
      let horas = d.getHours();
      const minutos = String(d.getMinutes()).padStart(2, '0');
      const segundos = String(d.getSeconds()).padStart(2, '0');
      const ampm = horas >= 12 ? 'p.m.' : 'a.m.';
      horas = horas % 12;
      horas = horas ? horas : 12; // 0 debe ser 12
      return `${dia}/${mes}/${anio} ${horas}:${minutos}:${segundos} ${ampm}`;
    } catch {
      return isoString;
    }
  }

  formatearFechaEntregaConHora(isoString?: string): string {
    if (!isoString) return 'No especificada';
    try {
      if (isoString.includes('T')) {
        const parts = isoString.split('T');
        const dParts = parts[0].split('-');
        const dateStr = dParts.length === 3 ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : parts[0];
        const timePart = parts[1].substring(0, 5);
        if (timePart && timePart.includes(':')) {
          const [hStr, mStr] = timePart.split(':');
          let h = parseInt(hStr, 10);
          if (!isNaN(h)) {
            const ampm = h >= 12 ? 'p.m.' : 'a.m.';
            h = h % 12;
            h = h ? h : 12;
            return `${dateStr} ${h}:${mStr} ${ampm}`;
          }
        }
        return dateStr;
      }
      const parts = isoString.split('-');
      if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      return isoString;
    } catch {
      return isoString;
    }
  }

  esPedidoVencido(ped?: PedidoPersonalizado | null): boolean {
    if (!ped || !ped.fechaEntrega) return false;
    if (
      ped.estado === 'ENTREGADO' ||
      ped.estado === 'TERMINADO' ||
      ped.estado === 'LISTO' ||
      ped.estado === 'CANCELADO'
    ) {
      return false;
    }

    try {
      if (ped.fechaEntrega.includes('T')) {
        const entregaDate = new Date(ped.fechaEntrega).getTime();
        return !isNaN(entregaDate) && entregaDate < Date.now();
      }
      const hoyLocal = new Date().toLocaleDateString('en-CA');
      return ped.fechaEntrega < hoyLocal;
    } catch {
      return false;
    }
  }

  getEstadoPillClass(ped: PedidoPersonalizado): string {
    if (this.esPedidoVencido(ped)) {
      return 'pill-vencido';
    }
    switch (ped.estado) {
      case 'PENDIENTE':
        return 'pill-pendiente';
      case 'EN_PROCESO':
        return 'pill-proceso';
      case 'TERMINADO':
      case 'LISTO':
        return 'pill-terminado';
      case 'ENTREGADO':
        return 'pill-entregado';
      case 'CANCELADO':
        return 'pill-cancelado';
      default:
        return 'pill-pendiente';
    }
  }

  getEstadoLabel(ped: PedidoPersonalizado): string {
    if (this.esPedidoVencido(ped)) {
      return 'Vencido';
    }
    switch (ped.estado) {
      case 'PENDIENTE':
        return 'Pendiente';
      case 'EN_PROCESO':
        return 'En Proceso';
      case 'TERMINADO':
      case 'LISTO':
        return 'Terminado';
      case 'ENTREGADO':
        return 'Entregado';
      case 'CANCELADO':
        return 'Cancelado';
      default:
        return ped.estado;
    }
  }

  // Acciones Modal Detalle
  abrirModalDetalle(ped: PedidoPersonalizado): void {
    this.pedidoDetalle.set(ped);
    this.montoNuevoAbono = 0;
    this.metodoPagoNuevoAbono = 'EFECTIVO';
    this.conceptoNuevoAbono = 'Abono a cuenta';
    this.modalDetalleAbierto.set(true);
  }

  cerrarModalDetalle(): void {
    this.modalDetalleAbierto.set(false);
  }

  async cambiarEstadoDesdeDetalle(nuevoEstado: PedidoPersonalizado['estado']): Promise<void> {
    const ped = this.pedidoDetalle();
    if (!ped) return;

    if (nuevoEstado === 'ENTREGADO' && (ped.saldoRestante || 0) > 0) {
      if (
        confirm(
          `⚠️ El pedido #${ped.id} no puede marcarse como ENTREGADO porque tiene un saldo pendiente de $${ped.saldoRestante}.\n\n¿Deseas abrir la ventana de liquidación para cobrar el saldo restante y entregarlo?`
        )
      ) {
        this.modalDetalleAbierto.set(false);
        this.abrirModalLiquidar(ped);
      }
      return;
    }

    if (nuevoEstado === 'CANCELADO') {
      this.abrirModalCancelar(ped);
      return;
    }

    const act = await this.pedidosService.actualizarEstado(ped.id, nuevoEstado);
    if (act) this.pedidoDetalle.set(act);
  }

  abrirModalCancelar(ped: PedidoPersonalizado): void {
    this.pedidoACancelar.set(ped);
    this.motivoCancelacionPedido = '';
    this.reponerStockPedido = true;
    this.modalCancelarAbierto.set(true);
    // Cerrar modal Detalle
    this.cerrarModalDetalle();
  }

  cerrarModalCancelar(): void {
    this.modalCancelarAbierto.set(false);
    this.pedidoACancelar.set(null);
    this.motivoCancelacionPedido = '';
  }

  async confirmarCancelacionPedido(): Promise<void> {
    const ped = this.pedidoACancelar();
    if (!ped) return;

    if (!this.motivoCancelacionPedido.trim()) {
      alert('Por favor describe el motivo de la cancelación del pedido.');
      return;
    }

    if (!confirm(`¿Estás seguro de cancelar el pedido #${ped.id} de "${ped.clienteNombre}"?`)) {
      return;
    }

    this.cancelandoPedido.set(true);
    try {
      const act = await this.pedidosService.actualizarEstado(
        ped.id,
        'CANCELADO',
        this.motivoCancelacionPedido.trim(),
        this.reponerStockPedido
      );

      if (act && this.pedidoDetalle()?.id === ped.id) {
        this.pedidoDetalle.set(act);
      }

      this.cerrarModalCancelar();
    } catch (err: any) {
      alert(err.message || 'Error al cancelar el pedido');
    } finally {
      this.cancelandoPedido.set(false);
    }
  }

  async registrarAbonoModal(): Promise<void> {
    const ped = this.pedidoDetalle();
    if (!ped) return;
    if (!this.montoNuevoAbono || this.montoNuevoAbono <= 0) {
      alert('Por favor ingresa un monto válido a abonar.');
      return;
    }
    if (this.montoNuevoAbono > ped.saldoRestante) {
      alert(`El abono ($${this.montoNuevoAbono}) no puede ser mayor al saldo pendiente ($${ped.saldoRestante}).`);
      return;
    }

    let paramsDigitales: {
      socioTransferenciaId?: string;
      socioTransferenciaNombre?: string;
      socioTarjetaId?: string;
      socioTarjetaNombre?: string;
    } | undefined;

    if (this.metodoPagoNuevoAbono === 'TRANSFERENCIA') {
      const idS = this.socioTransferenciaAbonoId() || this.sociosService.socioTransferenciasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
      const s = this.sociosService.socios().find((x) => x.id === idS);
      if (s) {
        paramsDigitales = { socioTransferenciaId: s.id, socioTransferenciaNombre: s.nombre };
      }
    } else if (this.metodoPagoNuevoAbono === 'TARJETA') {
      const idS = this.socioTarjetaAbonoId() || this.sociosService.socioTarjetasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
      const s = this.sociosService.socios().find((x) => x.id === idS);
      if (s) {
        paramsDigitales = { socioTarjetaId: s.id, socioTarjetaNombre: s.nombre };
      }
    }

    const act = await this.pedidosService.agregarAbono(
      ped.id,
      this.montoNuevoAbono,
      this.metodoPagoNuevoAbono,
      this.conceptoNuevoAbono.trim() || 'Abono a cuenta',
      paramsDigitales
    );

    if (act) {
      this.pedidoDetalle.set(act);
      this.montoNuevoAbono = 0;
      this.socioTransferenciaAbonoId.set('');
      this.socioTarjetaAbonoId.set('');
    }
  }

  imprimirTicketDesdeDetalle(): void {
    const ped = this.pedidoDetalle();
    if (!ped) return;
    this.verTicket(ped);
    this.modalDetalleAbierto.set(false);
  }

  imprimirFacturaDesdeDetalle(): void {
    const ped = this.pedidoDetalle();
    if (!ped) return;
    this.abrirModalFacturaCarta(ped);
    this.modalDetalleAbierto.set(false);
  }

  // Modal Editar
  abrirModalEditar(pedParam?: PedidoPersonalizado): void {
    const ped = pedParam || this.pedidoDetalle();
    if (!ped) return;
    this.pedidoEditando.set(ped);
    this.editandoId = ped.id;
    this.editCliente = ped.clienteNombre;
    this.editTelefono = ped.clienteTelefono || '';
    this.montoAbonoEditar = 0;
    this.metodoPagoAbonoEditar = 'EFECTIVO';
    this.conceptoAbonoEditar = 'Abono a cuenta';

    let fechaEnt = ped.fechaEntrega || '';
    if (fechaEnt) {
      if (fechaEnt.length === 10) {
        fechaEnt = `${fechaEnt}T12:00`;
      } else if (fechaEnt.length > 16) {
        fechaEnt = fechaEnt.substring(0, 16);
      }
    }
    this.editFechaEntrega = fechaEnt;
    this.editEspecificaciones = ped.especificaciones || '';
    this.editTotal = ped.totalAcordado;
    this.editClienteId.set(ped.clienteId || null);
    this.sugerenciasEditClientes.set([]);
    this.mostrarSugerenciasEditClientes.set(false);

    const items: ItemPedidoForm[] = (ped.materiasPrimas || []).map((mp) => ({
      tipo: mp.tipo,
      codigo: mp.codigo,
      nombre: mp.nombre,
      busqueda: mp.tipo === 'INVENTARIO' ? `${mp.nombre} (${mp.codigo || ''})` : mp.nombre,
      cantidad: mp.cantidad,
      precioUnitario: mp.precioUnitario,
      subtotal: mp.subtotal,
      mostrarSugerencias: false
    }));
    this.editItems.set(items);
    this.modalEditarAbierto.set(true);
  }

  async registrarAbonoEnEdicion(): Promise<void> {
    const ped = this.pedidoEditando();
    if (!ped) return;

    const monto = Number(this.montoAbonoEditar) || 0;
    if (monto <= 0) {
      alert('Por favor ingresa un monto válido a abonar.');
      return;
    }

    const saldoPendiente = ped.saldoRestante;
    if (monto > saldoPendiente) {
      alert(`El abono ($${monto.toFixed(2)}) no puede ser mayor al saldo pendiente actual ($${saldoPendiente.toFixed(2)}).`);
      return;
    }

    let paramsDigitales: {
      socioTransferenciaId?: string;
      socioTransferenciaNombre?: string;
      socioTarjetaId?: string;
      socioTarjetaNombre?: string;
    } | undefined;

    if (this.metodoPagoAbonoEditar === 'TRANSFERENCIA') {
      const idS = this.socioTransferenciaAbonoEditarId() || this.sociosService.socioTransferenciasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
      const s = this.sociosService.socios().find((x) => x.id === idS);
      if (s) {
        paramsDigitales = { socioTransferenciaId: s.id, socioTransferenciaNombre: s.nombre };
      }
    } else if (this.metodoPagoAbonoEditar === 'TARJETA') {
      const idS = this.socioTarjetaAbonoEditarId() || this.sociosService.socioTarjetasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
      const s = this.sociosService.socios().find((x) => x.id === idS);
      if (s) {
        paramsDigitales = { socioTarjetaId: s.id, socioTarjetaNombre: s.nombre };
      }
    }

    const act = await this.pedidosService.agregarAbono(
      ped.id,
      monto,
      this.metodoPagoAbonoEditar,
      this.conceptoAbonoEditar.trim() || 'Abono a cuenta',
      paramsDigitales
    );

    if (act) {
      this.pedidoEditando.set(act);
      if (this.pedidoDetalle()?.id === act.id) {
        this.pedidoDetalle.set(act);
      }
      this.montoAbonoEditar = 0;
      this.socioTransferenciaAbonoEditarId.set('');
      this.socioTarjetaAbonoEditarId.set('');
      this.conceptoAbonoEditar = 'Abono a cuenta';
      alert(`✅ Abono de $${monto.toFixed(2)} registrado con éxito y reflejado en ventas.`);
    }
  }

  agregarItemEditarInventario(): void {
    const current = [...this.editItems()];
    current.push({
      tipo: 'INVENTARIO',
      nombre: '',
      busqueda: '',
      cantidad: 1,
      precioUnitario: 0,
      subtotal: 0,
      mostrarSugerencias: false
    });
    this.editItems.set(current);
  }

  agregarItemEditarExtra(): void {
    const current = [...this.editItems()];
    current.push({
      tipo: 'EXTRA',
      nombre: '',
      cantidad: 1,
      precioUnitario: 0,
      subtotal: 0
    });
    this.editItems.set(current);
  }

  removerItemEditar(index: number): void {
    const current = this.editItems().filter((_, i) => i !== index);
    this.editItems.set(current);
    const sum = current.reduce((acc, it) => acc + (it.subtotal || 0), 0);
    this.editTotal = Math.round(sum * 100) / 100;
  }

  onEditItemChange(item: ItemPedidoForm): void {
    item.cantidad = Math.max(0.01, item.cantidad || 0);
    item.precioUnitario = Math.max(0, item.precioUnitario || 0);
    item.subtotal = Math.round(item.cantidad * item.precioUnitario * 100) / 100;
    const sum = this.editItems().reduce((acc, it) => acc + (it.subtotal || 0), 0);
    this.editTotal = Math.round(sum * 100) / 100;
  }

  seleccionarProductoInsumoEditar(item: ItemPedidoForm, prod: Producto): void {
    item.codigo = prod.codigo;
    item.nombre = prod.nombre;
    item.busqueda = `${prod.nombre} (${prod.codigo})`;
    item.precioUnitario = prod.precioVenta;
    item.subtotal = Math.round(item.cantidad * item.precioUnitario * 100) / 100;
    item.mostrarSugerencias = false;
    const sum = this.editItems().reduce((acc, it) => acc + (it.subtotal || 0), 0);
    this.editTotal = Math.round(sum * 100) / 100;
  }

  async guardarEdicionPedido(): Promise<void> {
    if (!this.editCliente.trim()) {
      alert('Por favor ingresa el nombre del cliente.');
      return;
    }
    if (!this.editEspecificaciones.trim()) {
      alert('Por favor describe las especificaciones.');
      return;
    }
    if (this.editTotal <= 0) {
      alert('El total debe ser mayor a cero.');
      return;
    }

    const materiasPrimasValidas: MateriaPrimaItem[] = this.editItems()
      .filter((it) => (it.nombre && it.nombre.trim().length > 0) || (it.busqueda && it.busqueda.trim().length > 0))
      .map((it) => ({
        tipo: it.tipo || 'INVENTARIO',
        codigo: it.codigo || '',
        nombre: (it.nombre || it.busqueda || '').trim(),
        cantidad: Number(it.cantidad) || 1,
        precioUnitario: Number(it.precioUnitario) || 0,
        subtotal: Number(it.subtotal) || 0
      }));

    const act = await this.pedidosService.actualizarPedidoCompleto(this.editandoId, {
      clienteId: this.editClienteId() || undefined,
      clienteNombre: this.editCliente.trim(),
      clienteTelefono: this.editTelefono ? this.editTelefono.trim() : '',
      fechaEntrega: this.editFechaEntrega || '',
      especificaciones: this.editEspecificaciones.trim(),
      totalAcordado: Number(this.editTotal) || 0,
      materiasPrimas: materiasPrimasValidas
    });

    if (act) {
      this.pedidoEditando.set(act);
      if (this.pedidoDetalle()?.id === act.id) {
        this.pedidoDetalle.set(act);
      }
      this.modalEditarAbierto.set(false);
      this.mostrarToast(`✅ Pedido #${act.id} actualizado con éxito.`);
    } else {
      alert('⚠️ No se encontró el pedido a modificar en el sistema. Verifica que no haya sido eliminado.');
    }
  }

  // Gestión de Insumos y Servicios - Nuevo Pedido
  abrirModalNuevo(): void {
    this.nuevoCliente = '';
    this.nuevoTelefono = '';
    this.nuevaFechaEntrega = '';
    this.nuevasEspecificaciones = '';
    this.nuevoTotal = 0;
    this.nuevoAnticipo = 0;
    this.metodoPagoAnticipo = 'EFECTIVO';
    this.clienteSeleccionadoId.set(null);
    this.sugerenciasClientes.set([]);
    this.mostrarSugerenciasClientes.set(false);
    this.guardarClienteNuevoEnCatalogo.set(true);
    this.itemsPedido.set([
      {
        tipo: 'INVENTARIO',
        nombre: '',
        busqueda: '',
        cantidad: 1,
        precioUnitario: 0,
        subtotal: 0,
        mostrarSugerencias: false
      }
    ]);
    this.modalNuevoAbierto.set(true);
  }

  // Métodos de Autocompletado de Clientes
  onBuscarCliente(valor: string): void {
    this.nuevoCliente = valor;
    const q = (valor || '').trim().toLowerCase();
    if (!q) {
      this.sugerenciasClientes.set([]);
      this.mostrarSugerenciasClientes.set(false);
      this.clienteSeleccionadoId.set(null);
      return;
    }

    const matches = this.clientesService.clientesActivos().filter((c) => {
      const nom = (c.nombre || '').toLowerCase();
      const tel = (c.telefono || '').toLowerCase();
      return nom.includes(q) || tel.includes(q);
    }).slice(0, 8);

    this.sugerenciasClientes.set(matches);
    this.mostrarSugerenciasClientes.set(true);

    const exacto = matches.find((c) => (c.nombre || '').toLowerCase() === q);
    if (exacto) {
      this.clienteSeleccionadoId.set(exacto.id);
    } else {
      this.clienteSeleccionadoId.set(null);
    }
  }

  seleccionarClienteSugerido(c: Cliente): void {
    this.nuevoCliente = c.nombre;
    this.nuevoTelefono = c.telefono || '';
    this.clienteSeleccionadoId.set(c.id);
    this.mostrarSugerenciasClientes.set(false);
  }

  onBuscarEditCliente(valor: string): void {
    this.editCliente = valor;
    const q = (valor || '').trim().toLowerCase();
    if (!q) {
      this.sugerenciasEditClientes.set([]);
      this.mostrarSugerenciasEditClientes.set(false);
      this.editClienteId.set(null);
      return;
    }

    const matches = this.clientesService.clientesActivos().filter((c) => {
      const nom = (c.nombre || '').toLowerCase();
      const tel = (c.telefono || '').toLowerCase();
      return nom.includes(q) || tel.includes(q);
    }).slice(0, 8);

    this.sugerenciasEditClientes.set(matches);
    this.mostrarSugerenciasEditClientes.set(true);

    const exacto = matches.find((c) => (c.nombre || '').toLowerCase() === q);
    if (exacto) {
      this.editClienteId.set(exacto.id);
    } else {
      this.editClienteId.set(null);
    }
  }

  seleccionarEditClienteSugerido(c: Cliente): void {
    this.editCliente = c.nombre;
    this.editTelefono = c.telefono || '';
    this.editClienteId.set(c.id);
    this.mostrarSugerenciasEditClientes.set(false);
  }

  agregarInsumoInventario(): void {
    const current = [...this.itemsPedido()];
    current.push({
      tipo: 'INVENTARIO',
      nombre: '',
      busqueda: '',
      cantidad: 1,
      precioUnitario: 0,
      subtotal: 0,
      mostrarSugerencias: false
    });
    this.itemsPedido.set(current);
  }

  agregarServicioExtra(): void {
    const current = [...this.itemsPedido()];
    current.push({
      tipo: 'EXTRA',
      nombre: '',
      cantidad: 1,
      precioUnitario: 0,
      subtotal: 0
    });
    this.itemsPedido.set(current);
  }

  removerItem(index: number): void {
    const current = this.itemsPedido().filter((_, i) => i !== index);
    this.itemsPedido.set(current);
    this.recalcularTotalSugerido();
  }

  getSugerencias(query?: string) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return this.productosService.productos().slice(0, 10);
    return this.productosService
      .productos()
      .filter(
        (p) =>
          (p.codigo || '').toLowerCase().includes(q) ||
          (p.nombre || '').toLowerCase().includes(q) ||
          (p.grupo || '').toLowerCase().includes(q)
      )
      .slice(0, 10);
  }

  seleccionarProductoInsumo(item: ItemPedidoForm, prod: Producto): void {
    item.codigo = prod.codigo;
    item.nombre = prod.nombre;
    item.busqueda = `${prod.nombre} (${prod.codigo})`;
    item.precioUnitario = prod.precioVenta;
    item.subtotal = Math.round(item.cantidad * item.precioUnitario * 100) / 100;
    item.mostrarSugerencias = false;
    this.recalcularTotalSugerido();
  }

  onItemChange(item: ItemPedidoForm): void {
    item.cantidad = Math.max(0.01, item.cantidad || 0);
    item.precioUnitario = Math.max(0, item.precioUnitario || 0);
    item.subtotal = Math.round(item.cantidad * item.precioUnitario * 100) / 100;
    this.recalcularTotalSugerido();
  }

  recalcularTotalSugerido(): void {
    const totalSuma = this.itemsPedido().reduce((acc, it) => acc + (it.subtotal || 0), 0);
    this.nuevoTotal = Math.round(totalSuma * 100) / 100;
  }

  get saldoPendienteNuevo(): number {
    return Math.max(0, (this.nuevoTotal || 0) - (this.nuevoAnticipo || 0));
  }

  async guardarNuevoPedido(): Promise<void> {
    if (!this.nuevoCliente.trim()) {
      alert('Por favor ingresa el nombre del cliente.');
      return;
    }
    if (!this.nuevasEspecificaciones.trim()) {
      alert('Por favor describe las especificaciones del pedido.');
      return;
    }
    if (this.nuevoTotal <= 0) {
      alert('El monto total debe ser mayor a cero.');
      return;
    }

    const materiasPrimasValidas: MateriaPrimaItem[] = this.itemsPedido()
      .filter((it) => (it.nombre && it.nombre.trim().length > 0) || (it.busqueda && it.busqueda.trim().length > 0))
      .map((it) => ({
        tipo: it.tipo || 'INVENTARIO',
        codigo: it.codigo || '',
        nombre: (it.nombre || it.busqueda || '').trim(),
        cantidad: Number(it.cantidad) || 1,
        precioUnitario: Number(it.precioUnitario) || 0,
        subtotal: Number(it.subtotal) || 0
      }));

    let socioTransfId: string | undefined;
    let socioTransfNombre: string | undefined;
    let socioTarjId: string | undefined;
    let socioTarjNombre: string | undefined;

    if (this.nuevoAnticipo > 0 && this.metodoPagoAnticipo === 'TRANSFERENCIA') {
      const idS = this.socioTransferenciaAnticipoId() || this.sociosService.socioTransferenciasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
      const s = this.sociosService.socios().find((x) => x.id === idS);
      if (s) {
        socioTransfId = s.id;
        socioTransfNombre = s.nombre;
      }
    } else if (this.nuevoAnticipo > 0 && this.metodoPagoAnticipo === 'TARJETA') {
      const idS = this.socioTarjetaAnticipoId() || this.sociosService.socioTarjetasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
      const s = this.sociosService.socios().find((x) => x.id === idS);
      if (s) {
        socioTarjId = s.id;
        socioTarjNombre = s.nombre;
      }
    }

    const nombreLimpio = this.nuevoCliente.trim();
    const telLimpio = this.nuevoTelefono ? this.nuevoTelefono.trim() : '';
    let idClienteFinal = this.clienteSeleccionadoId();

    // Comprobar si el cliente ya existe en el catálogo o si debe auto-registrarse
    const clienteExistente = this.clientesService.clientesActivos().find(
      (c) => c.nombre.trim().toLowerCase() === nombreLimpio.toLowerCase()
    );

    if (!clienteExistente && this.guardarClienteNuevoEnCatalogo()) {
      try {
        const nuevoRegistrado = await this.clientesService.crearCliente({
          nombre: nombreLimpio,
          telefono: telLimpio
        });
        idClienteFinal = nuevoRegistrado.id;
      } catch (err) {
        console.warn('Aviso al auto-registrar cliente en catálogo:', err);
      }
    } else if (clienteExistente) {
      idClienteFinal = clienteExistente.id;
      if (!clienteExistente.telefono && telLimpio) {
        this.clientesService.actualizarCliente(clienteExistente.id, { telefono: telLimpio }).catch(() => { });
      }
    }

    const nuevo = await this.pedidosService.crearPedido({
      clienteId: idClienteFinal || undefined,
      clienteNombre: nombreLimpio,
      clienteTelefono: telLimpio,
      fechaEntrega: this.nuevaFechaEntrega || '',
      especificaciones: this.nuevasEspecificaciones.trim(),
      estado: 'PENDIENTE',
      materiasPrimas: materiasPrimasValidas,
      totalAcordado: Number(this.nuevoTotal) || 0,
      anticipo: Number(this.nuevoAnticipo) || 0,
      saldoRestante: this.saldoPendienteNuevo,
      metodoPagoAnticipo: this.nuevoAnticipo > 0 ? this.metodoPagoAnticipo : 'EFECTIVO',
      socioTransferenciaId: socioTransfId,
      socioTransferenciaNombre: socioTransfNombre,
      socioTarjetaId: socioTarjId,
      socioTarjetaNombre: socioTarjNombre
    });

    this.socioTransferenciaAnticipoId.set('');
    this.socioTarjetaAnticipoId.set('');

    this.modalNuevoAbierto.set(false);
    this.pedidoSeleccionado.set(nuevo);
    this.pedidoRecienCreado.set(nuevo);
    this.modalExitoNuevoAbierto.set(true);

    if (this.autoImprimirTicket()) {
      this.imprimirTicket(nuevo);
    } else {
      this.modalTicketAbierto.set(false);
    }
  }

  cerrarModalExito(): void {
    this.modalExitoNuevoAbierto.set(false);
    this.pedidoRecienCreado.set(null);
    this.copiadoExito.set(false);
  }

  getTrackingUrl(pedido: PedidoPersonalizado | null): string {
    if (!pedido) return '';
    try {
      const origin = window.location.origin;
      if (!pedido.trackingToken) {
        pedido.trackingToken = generarTrackingToken();
        this.pedidosService.sincronizarPedidoPublico(pedido).catch(() => { });
      }
      return `${origin}/rastreo-pedido/${encodeURIComponent(pedido.trackingToken)}`;
    } catch {
      return '';
    }
  }

  generarMensajeWhatsApp(pedido: PedidoPersonalizado): string {
    const config = this.configService.config();
    const negocio = config?.businessName || 'nuestro negocio';
    const link = this.getTrackingUrl(pedido);

    let saldoText = '';
    if ((pedido.saldoRestante || 0) > 0) {
      saldoText = `*Saldo pendiente:* $${(pedido.saldoRestante || 0).toFixed(2)}\n`;
    } else {
      saldoText = `*Saldo:* Totalmente liquidado\n`;
    }

    let entregaText = '';
    if (pedido.fechaEntrega) {
      entregaText = `*Fecha estimada de entrega:* ${this.formatearFechaEntregaConHora(pedido.fechaEntrega)}\n`;
    }

    let espText = '';
    if (pedido.especificaciones && pedido.especificaciones.trim()) {
      const espLimpia = pedido.especificaciones.trim();
      const corta = espLimpia.length > 90 ? `${espLimpia.slice(0, 87)}...` : espLimpia;
      espText = `*Detalle:* ${corta}\n`;
    }

    return (
      `Hola *${pedido.clienteNombre}*, gracias por tu preferencia en *${negocio}*.\n\n` +
      `Tu pedido con folio *#${pedido.id}* ha sido registrado con exito.\n\n` +
      espText +
      `*Total:* $${(pedido.totalAcordado || 0).toFixed(2)}\n` +
      `*Anticipo:* $${(pedido.anticipo || 0).toFixed(2)}\n` +
      saldoText +
      entregaText +
      `\nPuedes consultar el avance y estado de tu pedido en vivo en el siguiente enlace:\n` +
      `${link}\n\n` +
      `Estamos a tu servicio.`
    );
  }

  async enviarWhatsAppSeguimiento(pedido: PedidoPersonalizado): Promise<void> {
    if (!pedido) return;
    const mensaje = this.generarMensajeWhatsApp(pedido);

    // Siempre copiar el mensaje completo al portapapeles
    try {
      await navigator.clipboard.writeText(mensaje);
      this.copiadoExito.set(true);
      setTimeout(() => this.copiadoExito.set(false), 3000);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = mensaje;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        this.copiadoExito.set(true);
        setTimeout(() => this.copiadoExito.set(false), 3000);
      } catch { }
    }

    const tel = (pedido.clienteTelefono || '').trim();
    const limpio = tel.replace(/\D/g, '');

    if (limpio && limpio.length >= 7) {
      const conCodigo = limpio.length === 10 ? `52${limpio}` : limpio;
      const waUrl = `https://wa.me/${conCodigo}?text=${encodeURIComponent(mensaje)}`;
      window.open(waUrl, '_blank');
      this.mostrarToast('Mensaje copiado y abriendo WhatsApp...');
    } else {
      this.mostrarToast('Mensaje de seguimiento copiado al portapapeles');
    }
  }

  async copiarEnlaceSeguimiento(pedido: PedidoPersonalizado): Promise<void> {
    const url = this.getTrackingUrl(pedido);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      this.copiadoExito.set(true);
      this.mostrarToast('Enlace de seguimiento copiado al portapapeles');
      setTimeout(() => this.copiadoExito.set(false), 3000);
    } catch {
      prompt('Copia este enlace de seguimiento:', url);
    }
  }

  toggleAutoImprimir(): void {
    const nuevo = !this.autoImprimirTicket();
    this.autoImprimirTicket.set(nuevo);
    localStorage.setItem('pos_auto_imprimir_ticket', nuevo ? 'true' : 'false');
  }

  toggleMostrarQr(): void {
    const nuevo = !this.mostrarQrSeguimiento();
    this.mostrarQrSeguimiento.set(nuevo);
    localStorage.setItem('pos_mostrar_qr_pedidos', nuevo ? 'true' : 'false');
  }

  getQrDataUrl(pedido: PedidoPersonalizado | null): string {
    if (!pedido) return '';
    try {
      const url = this.getTrackingUrl(pedido);
      if (!url) return '';
      return generateQRCodeDataUrl(url, { size: 180, margin: 2, errorCorrectionLevel: 'L' });
    } catch (e) {
      console.warn('No se pudo generar QR de rastreo:', e);
      return '';
    }
  }

  // Ver e Imprimir Ticket
  verTicket(pedido: PedidoPersonalizado): void {
    this.pedidoSeleccionado.set(pedido);
    this.modalTicketAbierto.set(true);
  }

  imprimirTicket(pedido?: PedidoPersonalizado): void {
    if (pedido) {
      this.pedidoSeleccionado.set(pedido);
    }
    if (!this.pedidoSeleccionado()) return;

    // Asegurar que el modal del ticket esté activo y la plantilla montada en el DOM
    this.modalFacturaCartaAbierto.set(false);
    this.modalTicketAbierto.set(true);

    document.body.classList.add('imprimiendo-ticket');
    document.documentElement.classList.add('imprimiendo-ticket');
    document.body.classList.remove('imprimiendo-carta');
    document.documentElement.classList.remove('imprimiendo-carta');

    // Remover override de carta si existiera
    const existingCarta = document.getElementById('print-letter-override');
    if (existingCarta) existingCarta.remove();

    let styleEl = document.getElementById('print-ticket-override') as HTMLStyleElement;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'print-ticket-override';
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = `
      @media print {
        @page {
          size: 80mm auto;
          margin: 0mm;
        }
        html, body, html.imprimiendo-ticket, body.imprimiendo-ticket {
          width: 80mm !important;
          max-width: 80mm !important;
          height: auto !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          overflow: visible !important;
        }
        /* Ocultar elementos de carta y modales ajenos */
        .factura-print-only,
        .factura-carta-wrapper,
        .factura-modal-overlay,
        .factura-modal-card,
        .factura-hoja-carta,
        .modal-overlay:not(.ticket-modal-overlay),
        .modal-card:not(.ticket-modal-card),
        .modal-exito-overlay,
        .modal-exito-pedido,
        .modal-no-print,
        .pedidos-toast-notif,
        .ticket-no-print {
          display: none !important;
        }
        /* Activar contenedor del ticket 80mm */
        body.imprimiendo-ticket .ticket-modal-overlay {
          position: static !important;
          background: transparent !important;
          padding: 0 !important;
          margin: 0 !important;
          display: block !important;
          width: 80mm !important;
          backdrop-filter: none !important;
        }
        body.imprimiendo-ticket .ticket-modal-card {
          box-shadow: none !important;
          border: none !important;
          background: transparent !important;
          padding: 0 !important;
          margin: 0 !important;
          max-width: 80mm !important;
          width: 80mm !important;
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
        }
        body.imprimiendo-ticket .ticket-wrapper {
          padding: 0 !important;
          margin: 0 !important;
          background: transparent !important;
          display: block !important;
          width: 80mm !important;
          overflow: visible !important;
        }
        body.imprimiendo-ticket .ticket-print-only {
          display: block !important;
          width: 80mm !important;
        }
        body.imprimiendo-ticket .ticket-thermal-80mm {
          position: static !important;
          display: block !important;
          width: 72mm !important;
          max-width: 72mm !important;
          margin: 0 auto !important;
          padding: 2mm 2mm 6mm 2mm !important;
          box-shadow: none !important;
          border: none !important;
          border-radius: 0 !important;
          color: #000000 !important;
          background: #ffffff !important;
          font-size: 11px !important;
          line-height: 1.25 !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        body.imprimiendo-ticket .ticket-thermal-80mm * {
          color: #000000 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body.imprimiendo-ticket .ticket-qr-image-wrapper {
          background: #ffffff !important;
          margin: 4px auto !important;
          padding: 4px !important;
        }
        body.imprimiendo-ticket .ticket-qr-img {
          width: 140px !important;
          height: 140px !important;
          max-width: 100% !important;
          display: block !important;
          margin: 0 auto !important;
        }
        body.imprimiendo-ticket .ticket-cut-margin {
          height: 6mm !important;
          display: block !important;
        }
      }
    `;

    const cleanup = () => {
      document.body.classList.remove('imprimiendo-ticket');
      document.documentElement.classList.remove('imprimiendo-ticket');
      styleEl?.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 2500);
    }, 100);
  }

  cerrarModalTicket(): void {
    this.modalTicketAbierto.set(false);
  }

  // Ver e Imprimir Factura / Comprobante en Hoja Tamaño Carta
  abrirModalFacturaCarta(pedido: PedidoPersonalizado): void {
    this.pedidoSeleccionado.set(pedido);
    this.modalFacturaCartaAbierto.set(true);
  }

  cerrarModalFacturaCarta(): void {
    this.modalFacturaCartaAbierto.set(false);
  }

  cambiarAFacturaCarta(): void {
    this.modalTicketAbierto.set(false);
    this.modalFacturaCartaAbierto.set(true);
  }

  cambiarATicket(): void {
    this.modalFacturaCartaAbierto.set(false);
    this.modalTicketAbierto.set(true);
  }

  imprimirFacturaCarta(pedido?: PedidoPersonalizado): void {
    if (pedido) {
      this.pedidoSeleccionado.set(pedido);
    }
    if (!this.pedidoSeleccionado()) return;

    // Asegurar que la plantilla esté montada en el DOM
    this.modalTicketAbierto.set(false);
    this.modalFacturaCartaAbierto.set(true);

    document.body.classList.add('imprimiendo-carta');
    document.documentElement.classList.add('imprimiendo-carta');

    // Remover override de ticket si existiera
    const existingTicket = document.getElementById('print-ticket-override');
    if (existingTicket) existingTicket.remove();

    let styleEl = document.getElementById('print-letter-override') as HTMLStyleElement;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'print-letter-override';
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = `
      @media print {
        @page {
          size: letter portrait;
          margin: 10mm 12mm;
        }
        html, body, html.imprimiendo-carta, body.imprimiendo-carta {
          width: 100% !important;
          max-width: 100% !important;
          height: auto !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          overflow: visible !important;
        }
        body.imprimiendo-carta .ticket-thermal-80mm,
        body.imprimiendo-carta .ticket-print-only,
        body.imprimiendo-carta .ticket-modal-overlay,
        body.imprimiendo-carta .modal-overlay:not(.factura-modal-overlay),
        body.imprimiendo-carta .modal-card:not(.factura-modal-card),
        body.imprimiendo-carta .modal-exito-overlay,
        body.imprimiendo-carta .modal-exito-pedido,
        body.imprimiendo-carta .modal-no-print,
        .pedidos-toast-notif,
        .factura-no-print {
          display: none !important;
        }
        body.imprimiendo-carta .factura-modal-overlay {
          position: static !important;
          background: transparent !important;
          padding: 0 !important;
          margin: 0 !important;
          display: block !important;
          width: 100% !important;
          backdrop-filter: none !important;
        }
        body.imprimiendo-carta .factura-modal-card {
          box-shadow: none !important;
          border: none !important;
          background: transparent !important;
          padding: 0 !important;
          margin: 0 !important;
          max-width: 100% !important;
          width: 100% !important;
          max-height: none !important;
          overflow: visible !important;
        }
        body.imprimiendo-carta .factura-preview-scroll {
          padding: 0 !important;
          margin: 0 !important;
          background: transparent !important;
          display: block !important;
          overflow: visible !important;
        }
        body.imprimiendo-carta .factura-print-only,
        body.imprimiendo-carta .factura-carta-wrapper {
          display: block !important;
          width: 100% !important;
        }
        body.imprimiendo-carta .factura-hoja-carta {
          box-shadow: none !important;
          border: none !important;
          border-radius: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          min-height: 0 !important;
          height: auto !important;
          display: flex !important;
          flex-direction: column !important;
          box-sizing: border-box !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
        }
        body.imprimiendo-carta .factura-hoja-carta * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      }
    `;

    const cleanup = () => {
      document.body.classList.remove('imprimiendo-carta');
      document.documentElement.classList.remove('imprimiendo-carta');
      styleEl?.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);

    setTimeout(() => {
      window.print();
      setTimeout(cleanup, 2500);
    }, 100);
  }

  // Transiciones de Estado
  async cambiarEstado(id: string, nuevoEstado: PedidoPersonalizado['estado']): Promise<void> {
    const ped = this.pedidosService.pedidos().find((p) => p.id === id);
    if (ped && nuevoEstado === 'ENTREGADO' && (ped.saldoRestante || 0) > 0) {
      if (
        confirm(
          `⚠️ El pedido #${ped.id} no puede marcarse como ENTREGADO porque tiene un saldo pendiente de $${ped.saldoRestante}.\n\n¿Deseas abrir la ventana de liquidación para cobrar el saldo restante y entregarlo?`
        )
      ) {
        this.abrirModalLiquidar(ped);
      }
      return;
    }
    await this.pedidosService.actualizarEstado(id, nuevoEstado);
  }

  abrirModalLiquidar(ped: PedidoPersonalizado): void {
    this.pedidoSeleccionado.set(ped);
    this.metodoPagoLiquidacion = 'EFECTIVO';
    this.modalLiquidarAbierto.set(true);
  }

  async confirmarLiquidacion(): Promise<void> {
    const ped = this.pedidoSeleccionado();
    if (!ped) return;
    let paramsDigitales: {
      socioTransferenciaId?: string;
      socioTransferenciaNombre?: string;
      socioTarjetaId?: string;
      socioTarjetaNombre?: string;
    } | undefined;

    if (this.metodoPagoLiquidacion === 'TRANSFERENCIA') {
      const idS = this.socioTransferenciaLiquidacionId() || this.sociosService.socioTransferenciasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
      const s = this.sociosService.socios().find((x) => x.id === idS);
      if (s) {
        paramsDigitales = { socioTransferenciaId: s.id, socioTransferenciaNombre: s.nombre };
      }
    } else if (this.metodoPagoLiquidacion === 'TARJETA') {
      const idS = this.socioTarjetaLiquidacionId() || this.sociosService.socioTarjetasDefault()?.id || this.sociosService.sociosActivos()[0]?.id;
      const s = this.sociosService.socios().find((x) => x.id === idS);
      if (s) {
        paramsDigitales = { socioTarjetaId: s.id, socioTarjetaNombre: s.nombre };
      }
    }

    const act = await this.pedidosService.liquidarPedido(ped.id, this.metodoPagoLiquidacion, paramsDigitales);
    this.socioTransferenciaLiquidacionId.set('');
    this.socioTarjetaLiquidacionId.set('');
    this.modalLiquidarAbierto.set(false);

    if (act && this.pedidoDetalle()?.id === act.id) {
      this.pedidoDetalle.set(act);
    }

    if (this.autoImprimirTicket() && act) {
      this.imprimirTicket(act);
    }
  }

  async eliminar(id: string): Promise<void> {
    const ped = this.pedidosService.pedidos().find((p) => p.id === id);
    const totalCobrado = ped ? ((ped.abonos || []).reduce((acc, a) => acc + (a.monto || 0), 0) || (ped.anticipo || 0)) : 0;

    let mensaje = `¿Estás seguro de eliminar el Pedido #${id}?`;
    if (totalCobrado > 0) {
      mensaje = `¿Estás seguro de eliminar el Pedido #${id}?\n\n💰 Este pedido tiene $${totalCobrado.toFixed(2)} registrados en anticipos/abonos.\nAl eliminarlo, también se anulará la entrada de dinero en el módulo de Ventas y en el Corte de Caja.`;
    }

    if (confirm(mensaje)) {
      await this.pedidosService.eliminarPedido(id);
      this.mostrarToast(`✅ Pedido #${id} y sus entradas de dinero asociadas fueron eliminados.`);
    }
  }

  exportarReporteExcel(): void {
    const lista = this.pedidosFiltrados();
    if (lista.length === 0) {
      alert('No hay pedidos en la lista actual para exportar a Excel.');
      return;
    }

    const config = this.configService.config();
    const negocio = config?.businessName || 'Sistema de Ventas';
    const ahora = new Date();
    const fechaHoraStr = ahora.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const escaparCSV = (valor: any): string => {
      if (valor === null || valor === undefined) return '""';
      const str = String(valor).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
      return `"${str}"`;
    };

    let csv = '\uFEFF'; // BOM UTF-8 para apertura directa en Microsoft Excel

    // Metadatos superiores
    csv += `${escaparCSV('REPORTE GENERAL DE PEDIDOS')},${escaparCSV(negocio)}\n`;
    csv += `${escaparCSV('Fecha de emisión:')},${escaparCSV(fechaHoraStr)}\n`;
    csv += `${escaparCSV('Cantidad de pedidos:')},${escaparCSV(lista.length + ' pedido(s)')}\n`;
    if (this.filtroEstado() !== 'TODOS') {
      csv += `${escaparCSV('Filtro de estado:')},${escaparCSV(this.filtroEstado())}\n`;
    }
    if (this.filtroDesde() || this.filtroHasta()) {
      csv += `${escaparCSV('Rango de fechas:')},${escaparCSV((this.filtroDesde() || 'Inicio') + ' al ' + (this.filtroHasta() || 'Hoy'))}\n`;
    }
    csv += '\n';

    // Encabezados de columnas
    const headers = [
      'Folio',
      'Fecha Registro',
      'Fecha Entrega',
      'Cliente',
      'Teléfono',
      'Especificaciones / Detalle',
      'Monto Total ($)',
      'Anticipo / Abonos ($)',
      'Saldo Pendiente ($)',
      'Estado'
    ];
    csv += headers.map(escaparCSV).join(',') + '\n';

    // Filas de pedidos
    let sumaTotal = 0;
    let sumaAnticipos = 0;
    let sumaSaldo = 0;

    for (const p of lista) {
      const tot = p.totalAcordado || 0;
      const ant = p.anticipo || 0;
      const sal = p.saldoRestante || 0;
      sumaTotal += tot;
      sumaAnticipos += ant;
      sumaSaldo += sal;

      const fRegistro = this.formatearFecha(p.fechaRegistro);
      const fEntrega = p.fechaEntrega ? this.formatearFechaEntregaConHora(p.fechaEntrega) : 'Sin fecha';
      const detalle = (p.materiasPrimas || []).map((m) => `${m.cantidad}x ${m.nombre}`).join(' | ') || p.especificaciones || 'Sin detalle';

      const row = [
        p.id,
        fRegistro,
        fEntrega,
        p.clienteNombre,
        p.clienteTelefono || 'Sin teléfono',
        detalle,
        tot.toFixed(2),
        ant.toFixed(2),
        sal.toFixed(2),
        this.getEstadoLabel(p)
      ];

      csv += row.map(escaparCSV).join(',') + '\n';
    }

    // Fila resumen de totales
    csv += '\n';
    csv += [
      escaparCSV(`TOTALES (${lista.length} PEDIDOS)`),
      '""',
      '""',
      '""',
      '""',
      '""',
      escaparCSV(sumaTotal.toFixed(2)),
      escaparCSV(sumaAnticipos.toFixed(2)),
      escaparCSV(sumaSaldo.toFixed(2)),
      '""'
    ].join(',') + '\n';

    // Descargar archivo
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const fechaISO = ahora.toISOString().split('T')[0];
    link.download = `Reporte_Pedidos_${fechaISO}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.mostrarToast('Reporte de pedidos exportado a Excel');
  }

  generarReporteCompleto(): void {
    this.exportarReporteExcel();
  }

  // Modal de Previsualización y Consolidación de Abonos en Ventas
  public modalConsolidarAbierto = signal<boolean>(false);
  public analisisConsolidacion = signal<AnalisisConsolidacion | null>(null);
  public aplicandoConsolidacion = signal<boolean>(false);

  abrirModalConsolidar(): void {
    const analisis = this.pedidosService.analizarAbonosPendientesDeConsolidar();
    this.analisisConsolidacion.set(analisis);
    this.modalConsolidarAbierto.set(true);
  }

  async confirmarConsolidacion(): Promise<void> {
    const analisis = this.analisisConsolidacion();
    if (!analisis || analisis.ventasNuevas.length === 0) {
      this.modalConsolidarAbierto.set(false);
      return;
    }

    try {
      this.aplicandoConsolidacion.set(true);
      const agregadas = await this.pedidosService.aplicarConsolidacionVentas(
        analisis.ventasNuevas.map((v) => v.ventaCompleta)
      );

      alert(
        `✅ Consolidación aplicada exitosamente:\n\n` +
        `• Se registraron ${agregadas} venta(s) correspondientes a abonos y anticipos.\n` +
        `• Monto total consolidado: $${analisis.montoTotalNuevas.toFixed(2)} MXN\n\n` +
        `El dinero ya se encuentra reflejado en tus ingresos y balances.`
      );
      this.modalConsolidarAbierto.set(false);
    } catch (e: any) {
      alert('❌ Error al aplicar consolidación: ' + (e.message || e));
    } finally {
      this.aplicandoConsolidacion.set(false);
    }
  }

  async consolidarEnVentas(): Promise<void> {
    this.abrirModalConsolidar();
  }
}
