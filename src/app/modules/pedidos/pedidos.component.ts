import { Component, signal, inject, computed, HostListener, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet, UpperCasePipe } from '@angular/common';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { PedidosService, AnalisisConsolidacion } from '../../core/services/pedidos.service';
import { ProductosService } from '../../core/services/productos.service';
import { ConfiguracionService } from '../../core/services/configuracion.service';
import { PedidoPersonalizado, MateriaPrimaItem, Producto } from '../../core/models/models';

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
  public modalLiquidarAbierto = signal<boolean>(false);
  public modalDetalleAbierto = signal<boolean>(false);
  public modalEditarAbierto = signal<boolean>(false);

  public pedidoSeleccionado = signal<PedidoPersonalizado | null>(null);
  public pedidoDetalle = signal<PedidoPersonalizado | null>(null);
  public autoImprimirTicket = signal<boolean>(localStorage.getItem('pos_auto_imprimir_ticket') !== 'false');

  // Formulario nuevo
  public nuevoCliente = '';
  public nuevoTelefono = '';
  public nuevaFechaEntrega = '';
  public nuevasEspecificaciones = '';
  public nuevoTotal = 0;
  public nuevoAnticipo = 0;
  public metodoPagoAnticipo = 'EFECTIVO';
  public itemsPedido = signal<ItemPedidoForm[]>([]);

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
  public conceptoAbonoEditar = 'Abono a cuenta';

  // Registro de Abono en Detalle
  public montoNuevoAbono = 0;
  public metodoPagoNuevoAbono = 'EFECTIVO';
  public conceptoNuevoAbono = 'Abono a cuenta';

  // Liquidación
  public metodoPagoLiquidacion = 'EFECTIVO';

  public pedidosService = inject(PedidosService);
  public productosService = inject(ProductosService);
  public configService = inject(ConfiguracionService);

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

    const act = await this.pedidosService.actualizarEstado(ped.id, nuevoEstado);
    if (act) this.pedidoDetalle.set(act);
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

    const act = await this.pedidosService.agregarAbono(
      ped.id,
      this.montoNuevoAbono,
      this.metodoPagoNuevoAbono,
      this.conceptoNuevoAbono.trim() || 'Abono a cuenta'
    );

    if (act) {
      this.pedidoDetalle.set(act);
      this.montoNuevoAbono = 0;
    }
  }

  imprimirTicketDesdeDetalle(): void {
    const ped = this.pedidoDetalle();
    if (!ped) return;
    this.verTicket(ped);
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

    const act = await this.pedidosService.agregarAbono(
      ped.id,
      monto,
      this.metodoPagoAbonoEditar,
      this.conceptoAbonoEditar.trim() || 'Abono a cuenta'
    );

    if (act) {
      this.pedidoEditando.set(act);
      if (this.pedidoDetalle()?.id === act.id) {
        this.pedidoDetalle.set(act);
      }
      this.montoAbonoEditar = 0;
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

    const nuevo = await this.pedidosService.crearPedido({
      clienteNombre: this.nuevoCliente.trim(),
      clienteTelefono: this.nuevoTelefono ? this.nuevoTelefono.trim() : '',
      fechaEntrega: this.nuevaFechaEntrega || '',
      especificaciones: this.nuevasEspecificaciones.trim(),
      estado: 'PENDIENTE',
      materiasPrimas: materiasPrimasValidas,
      totalAcordado: Number(this.nuevoTotal) || 0,
      anticipo: Number(this.nuevoAnticipo) || 0,
      saldoRestante: this.saldoPendienteNuevo,
      metodoPagoAnticipo: this.nuevoAnticipo > 0 ? this.metodoPagoAnticipo : 'EFECTIVO'
    });

    this.modalNuevoAbierto.set(false);
    this.pedidoSeleccionado.set(nuevo);

    if (this.autoImprimirTicket()) {
      this.modalTicketAbierto.set(false);
      setTimeout(() => {
        window.print();
      }, 50);
    } else {
      this.modalTicketAbierto.set(false);
    }
  }

  toggleAutoImprimir(): void {
    const nuevo = !this.autoImprimirTicket();
    this.autoImprimirTicket.set(nuevo);
    localStorage.setItem('pos_auto_imprimir_ticket', nuevo ? 'true' : 'false');
  }

  // Ver e Imprimir Ticket
  verTicket(pedido: PedidoPersonalizado): void {
    this.pedidoSeleccionado.set(pedido);
    this.modalTicketAbierto.set(true);
  }

  imprimirTicket(): void {
    window.print();
  }

  cerrarModalTicket(): void {
    this.modalTicketAbierto.set(false);
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
    const act = await this.pedidosService.liquidarPedido(ped.id, this.metodoPagoLiquidacion);
    this.modalLiquidarAbierto.set(false);

    if (act && this.pedidoDetalle()?.id === act.id) {
      this.pedidoDetalle.set(act);
    }

    if (this.autoImprimirTicket()) {
      setTimeout(() => {
        window.print();
      }, 50);
    }
  }

  async eliminar(id: string): Promise<void> {
    if (confirm('¿Estás seguro de eliminar este pedido?')) {
      await this.pedidosService.eliminarPedido(id);
    }
  }

  generarReporteCompleto(): void {
    window.print();
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
