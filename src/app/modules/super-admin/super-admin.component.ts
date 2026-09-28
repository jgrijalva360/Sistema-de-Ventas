import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { SuscripcionService } from '../../core/services/suscripcion.service';
import { AuthService } from '../../core/services/auth.service';
import { SoporteService } from '../../core/services/soporte.service';
import { SuscripcionEmpresa, PlanSuscripcion, EstadoSuscripcion, CodigoPromocional, PlanCatalogo, TicketSoporte, MensajeTicket } from '../../core/models/models';
import { MercadoPagoService } from '../../core/services/mercado-pago.service';
import { comprimirImagen, calcularTamanioBase64 } from '../../core/utils/image.util';

@Component({
  selector: 'app-super-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePipe],
  templateUrl: './super-admin.component.html',
  styleUrl: './super-admin.component.scss'
})
export class SuperAdminComponent implements OnInit {
  public suscripcionService = inject(SuscripcionService);
  public authService = inject(AuthService);
  public mpService = inject(MercadoPagoService);
  public soporteService = inject(SoporteService);
  public route = inject(ActivatedRoute);

  public pestanaActiva = signal<'EMPRESAS' | 'CODIGOS' | 'PLANES' | 'TICKETS'>('EMPRESAS');

  public empresas = signal<SuscripcionEmpresa[]>([]);
  public codigos = signal<CodigoPromocional[]>([]);
  public cargando = signal<boolean>(false);
  public filtroTexto = signal<string>('');
  public filtroPlan = signal<string>('TODOS');
  public filtroEstado = signal<string>('TODOS');

  // Filtros de Tickets
  public filtroTicketEstado = signal<string>('TODOS');
  public filtroTicketPrioridad = signal<string>('TODOS');
  public filtroTicketTexto = signal<string>('');

  public totalTicketsEnProceso = () => this.soporteService.tickets().filter(t => t.estado === 'EN_PROCESO').length;
  public totalTicketsResueltos = () => this.soporteService.tickets().filter(t => t.estado === 'RESUELTO' || t.estado === 'CERRADO').length;

  // Modal Detalle / Seguimiento de Ticket (Chat en Vivo)
  public modalTicket = signal<TicketSoporte | null>(null);
  public ticketActivo = computed<TicketSoporte | null>(() => {
    const sel = this.modalTicket();
    if (!sel) return null;
    return this.soporteService.tickets().find(t => t.folio === sel.folio) || sel;
  });

  public estadoTicketSeleccionado: TicketSoporte['estado'] = 'ABIERTO';
  public nuevoMensajeTexto = '';
  public imagenAdjuntaBase64 = signal<string>('');
  public imagenAdjuntaNombre = signal<string>('');
  public enviandoMensaje = signal<boolean>(false);
  public procesandoImagen = signal<boolean>(false);
  public modalImagenZoom = signal<string | null>(null);
  public guardandoTicket = signal<boolean>(false);
  public calcularTamanioBase64 = calcularTamanioBase64;

  // Modal de Edición Manual de Suscripción
  public modalEditar = signal<SuscripcionEmpresa | null>(null);
  public diasSumar = 30;
  public planSeleccionado: PlanSuscripcion = 'PRO';
  public estadoSeleccionado: EstadoSuscripcion = 'ACTIVA';
  public guardando = signal<boolean>(false);
  public eliminandoEmpresaId = signal<string | null>(null);
  public mensajeModal = signal<string>('');

  // Modal de Crear Código Promocional
  public modalNuevoCodigo = signal<boolean>(false);
  public codigoNuevo = '';
  public diasCodigo = 30;
  public planCodigo: PlanSuscripcion = 'PRO';
  public usosMaximosCodigo = 10;
  public descripcionCodigo = '';
  public expiraEnCodigo = '';
  public guardandoCodigo = signal<boolean>(false);
  public errorCodigoModal = signal<string>('');

  // Modal de Edición de Planes de Catálogo
  public modalEditarPlan = signal<PlanCatalogo | null>(null);
  public planEditTitulo = '';
  public planEditSubtitulo = '';
  public planEditPrecio = 0;
  public planEditMoneda = 'MXN';
  public planEditPeriodo: 'MENSUAL' | 'ANUAL' = 'MENSUAL';
  public planEditMeses = 1;
  public planEditMaxUsuarios = 2;
  public planEditMaxSucursales = 1;
  public planEditMaxProductos = 200;
  public planEditDestacado = false;
  public planEditCaracteristicasTexto = '';
  public guardandoPlan = signal<boolean>(false);
  public errorPlanModal = signal<string>('');

  async ngOnInit(): Promise<void> {
    this.route.queryParams.subscribe(params => {
      const tab = (params['tab'] || '').toUpperCase();
      if (tab === 'EMPRESAS' || tab === 'CODIGOS' || tab === 'PLANES' || tab === 'TICKETS') {
        this.pestanaActiva.set(tab);
      }
    });
    await Promise.all([this.cargarEmpresas(), this.cargarCodigos()]);
  }

  async cargarEmpresas(): Promise<void> {
    this.cargando.set(true);
    try {
      const list = await this.suscripcionService.listarTodasEmpresas();
      this.empresas.set(list);
    } catch (e: any) {
      console.error('Error al cargar empresas SaaS:', e);
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarCodigos(): Promise<void> {
    try {
      const list = await this.suscripcionService.listarCodigosPromocionales();
      this.codigos.set(list);
    } catch (e: any) {
      console.error('Error al cargar códigos promocionales:', e);
    }
  }

  // Filtrado reactivo de empresas
  empresasFiltradas(): SuscripcionEmpresa[] {
    const txt = this.filtroTexto().toLowerCase().trim();
    const plan = this.filtroPlan();
    const est = this.filtroEstado();

    return this.empresas().filter((emp) => {
      const matchTxt = !txt || 
        (emp.nombreNegocio || '').toLowerCase().includes(txt) || 
        (emp.contactoEmail || '').toLowerCase().includes(txt) || 
        (emp.empresaId || '').toLowerCase().includes(txt);
      const matchPlan = plan === 'TODOS' || emp.plan === plan;
      const matchEst = est === 'TODOS' || emp.estado === est;
      return matchTxt && matchPlan && matchEst;
    });
  }

  ingresarComoEmpresa(emp: SuscripcionEmpresa): void {
    const nombre = emp.nombreNegocio || 'esta empresa';
    const conf = confirm(`¿Deseas ingresar al sistema con los datos y registros de "${nombre}" en Modo Soporte?\n\nPodrás ver su inventario, ventas, gastos, pedidos y configuración tal cual los ve el cliente.`);
    if (!conf) return;
    this.authService.entrarModoSoporte(emp.empresaId, emp.nombreNegocio || 'Empresa');
  }

  public nombreNegocioEdit = '';

  abrirModalEditar(emp: SuscripcionEmpresa): void {
    this.modalEditar.set(emp);
    this.nombreNegocioEdit = emp.nombreNegocio || '';
    this.diasSumar = 30;
    this.planSeleccionado = emp.plan || 'PRO';
    this.estadoSeleccionado = emp.estado || 'ACTIVA';
    this.mensajeModal.set('');
  }

  cerrarModal(): void {
    this.modalEditar.set(null);
  }

  async guardarCambiosVigencia(): Promise<void> {
    const emp = this.modalEditar();
    if (!emp) return;

    this.guardando.set(true);
    this.mensajeModal.set('');

    try {
      await this.suscripcionService.modificarVigenciaManual(
        emp.empresaId,
        Number(this.diasSumar),
        this.planSeleccionado,
        this.estadoSeleccionado,
        this.nombreNegocioEdit
      );
      await this.cargarEmpresas();
      this.cerrarModal();
    } catch (e: any) {
      this.mensajeModal.set(e.message || 'Error al actualizar vigencia.');
    } finally {
      this.guardando.set(false);
    }
  }

  async eliminarEmpresa(emp: SuscripcionEmpresa): Promise<void> {
    const nombre = emp.nombreNegocio || 'este negocio';
    const conf = prompt(
      `⚠️ ¡ATENCIÓN! ACCIÓN DESTRUCTIVA E IRREVERSIBLE ⚠️\n\n` +
      `Estás a punto de ELIMINAR COMPLETAMENTE el negocio:\n"${nombre}" (ID: ${emp.empresaId})\n\n` +
      `Esta acción borrará de forma permanente:\n` +
      `• Todos los colaboradores y administradores del negocio.\n` +
      `• Todo su inventario, productos y categorías.\n` +
      `• Todas sus ventas, movimientos, gastos, cortes y pedidos.\n` +
      `• Toda su bitácora y configuraciones.\n` +
      `• Todos sus tickets de soporte.\n` +
      `• Su suscripción SaaS.\n\n` +
      `Para confirmar, escribe exactamente "ELIMINAR" o el nombre del negocio:`
    );

    if (!conf) return;

    const respuestaLimpia = conf.trim().toUpperCase();
    const nombreNegocioUpper = nombre.trim().toUpperCase();

    if (respuestaLimpia !== 'ELIMINAR' && respuestaLimpia !== nombreNegocioUpper) {
      alert('La palabra de confirmación no coincide. Se ha cancelado la eliminación.');
      return;
    }

    this.eliminandoEmpresaId.set(emp.empresaId);

    try {
      // Si el SuperAdmin estaba inspeccionando esta empresa en Modo Soporte, salir
      if (this.authService.getTenantId() === emp.empresaId) {
        this.authService.salirModoSoporte();
      }

      await this.suscripcionService.eliminarEmpresaCompleta(emp.empresaId);

      // Si el modal de edición estaba abierto, cerrarlo
      if (this.modalEditar()?.empresaId === emp.empresaId) {
        this.cerrarModal();
      }

      await this.cargarEmpresas();
      alert(`El negocio "${nombre}" y todos sus datos han sido eliminados por completo.`);
    } catch (e: any) {
      console.error('Error al eliminar negocio completo:', e);
      alert('Ocurrió un error al intentar eliminar el negocio: ' + (e.message || e));
    } finally {
      this.eliminandoEmpresaId.set(null);
    }
  }

  abrirModalNuevoCodigo(): void {
    this.codigoNuevo = '';
    this.diasCodigo = 30;
    this.planCodigo = 'PRO';
    this.usosMaximosCodigo = 10;
    this.descripcionCodigo = '';
    this.expiraEnCodigo = '';
    this.errorCodigoModal.set('');
    this.modalNuevoCodigo.set(true);
  }

  cerrarModalNuevoCodigo(): void {
    this.modalNuevoCodigo.set(false);
  }

  async guardarNuevoCodigo(): Promise<void> {
    if (!this.codigoNuevo.trim()) {
      this.errorCodigoModal.set('El código es obligatorio.');
      return;
    }

    this.guardandoCodigo.set(true);
    this.errorCodigoModal.set('');

    try {
      const nuevo: CodigoPromocional = {
        codigo: this.codigoNuevo.trim().toUpperCase(),
        diasOtorgados: Number(this.diasCodigo) || 30,
        planAsignado: this.planCodigo,
        usosMaximos: Number(this.usosMaximosCodigo) || 0,
        usosActuales: 0,
        activo: true,
        fechaCreacion: new Date().toISOString(),
        expiraEn: this.expiraEnCodigo || undefined,
        descripcion: this.descripcionCodigo.trim(),
        empresasQueCanjearon: []
      };

      await this.suscripcionService.guardarCodigoPromocional(nuevo);
      await this.cargarCodigos();
      this.cerrarModalNuevoCodigo();
    } catch (e: any) {
      this.errorCodigoModal.set(e.message || 'Error al crear código.');
    } finally {
      this.guardandoCodigo.set(false);
    }
  }

  async toggleActivoCodigo(c: CodigoPromocional): Promise<void> {
    const nuevoEstado = !c.activo;
    await this.suscripcionService.guardarCodigoPromocional({
      ...c,
      activo: nuevoEstado
    });
    await this.cargarCodigos();
  }

  async eliminarCodigo(c: CodigoPromocional): Promise<void> {
    if (confirm(`¿Eliminar definitivamente el código promocional "${c.codigo}"?`)) {
      await this.suscripcionService.eliminarCodigoPromocional(c.codigo);
      await this.cargarCodigos();
    }
  }

  // ── Gestión de Planes de Catálogo ─────────────────────────────
  abrirModalEditarPlan(plan: PlanCatalogo): void {
    this.modalEditarPlan.set(plan);
    this.planEditTitulo = plan.titulo;
    this.planEditSubtitulo = plan.subtitulo;
    this.planEditPrecio = plan.precio;
    this.planEditMoneda = plan.moneda;
    this.planEditPeriodo = plan.periodo;
    this.planEditMeses = plan.meses;
    this.planEditMaxUsuarios = plan.maxUsuarios;
    this.planEditMaxSucursales = plan.maxSucursales;
    this.planEditMaxProductos = plan.maxProductos || (plan.id === 'TRIAL' ? 100 : (plan.id === 'BASICO' ? 200 : (plan.id === 'PRO' ? 1000 : 10000)));
    this.planEditDestacado = !!plan.destacado;
    this.planEditCaracteristicasTexto = (plan.caracteristicas || []).join('\n');
    this.errorPlanModal.set('');
  }

  cerrarModalEditarPlan(): void {
    this.modalEditarPlan.set(null);
  }

  async guardarCambiosPlan(): Promise<void> {
    const plan = this.modalEditarPlan();
    if (!plan) return;

    if (!this.planEditTitulo || this.planEditPrecio < 0) {
      this.errorPlanModal.set('El título y precio válido son obligatorios.');
      return;
    }

    this.guardandoPlan.set(true);
    this.errorPlanModal.set('');

    try {
      const caracteristicas = this.planEditCaracteristicasTexto
        .split('\n')
        .map(c => c.trim())
        .filter(c => !!c);

      const actualizados = this.mpService.planesDisponibles().map(p => {
        if (p.id === plan.id) {
          return {
            ...p,
            titulo: this.planEditTitulo.trim(),
            subtitulo: this.planEditSubtitulo.trim(),
            precio: Number(this.planEditPrecio),
            moneda: this.planEditMoneda,
            periodo: this.planEditPeriodo,
            meses: plan.id === 'TRIAL' ? (Number(this.planEditMeses) || 0) : (Number(this.planEditMeses) || 1),
            maxUsuarios: Number(this.planEditMaxUsuarios) || 2,
            maxSucursales: Number(this.planEditMaxSucursales) || 1,
            maxProductos: Number(this.planEditMaxProductos) || (plan.id === 'TRIAL' ? 100 : (plan.id === 'BASICO' ? 200 : (plan.id === 'PRO' ? 1000 : 10000))),
            destacado: plan.id === 'TRIAL' ? false : this.planEditDestacado,
            caracteristicas
          };
        }
        return p;
      });

      await this.mpService.guardarPlanesCatalogo(actualizados);
      this.cerrarModalEditarPlan();
    } catch (e: any) {
      this.errorPlanModal.set(e.message || 'Error al guardar los cambios del plan.');
    } finally {
      this.guardandoPlan.set(false);
    }
  }

  calcularDiasRestantes(fechaVencimiento?: string): number {
    if (!fechaVencimiento) return 0;
    const fin = new Date(fechaVencimiento).getTime();
    const diff = fin - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  // Métricas globales
  totalEmpresasActivas(): number {
    return this.empresas().filter(e => e.estado === 'ACTIVA').length;
  }

  totalEnTrial(): number {
    return this.empresas().filter(e => e.estado === 'PRUEBA' || e.plan === 'TRIAL').length;
  }

  totalVencidas(): number {
    return this.empresas().filter(e => e.estado === 'VENCIDA' || this.calcularDiasRestantes(e.fechaVencimiento) === 0).length;
  }

  // ── Gestión y Seguimiento de Tickets de Soporte ───────────────

  ticketsFiltrados(): TicketSoporte[] {
    const txt = this.filtroTicketTexto().toLowerCase().trim();
    const est = this.filtroTicketEstado();
    const prio = this.filtroTicketPrioridad();

    return this.soporteService.tickets().filter(t => {
      const matchTxt = !txt ||
        (t.nombreNegocio || '').toLowerCase().includes(txt) ||
        (t.folio || '').toLowerCase().includes(txt) ||
        (t.usuarioNombre || '').toLowerCase().includes(txt) ||
        (t.usuarioEmail || '').toLowerCase().includes(txt) ||
        (t.descripcion || '').toLowerCase().includes(txt) ||
        (t.telefono || '').toLowerCase().includes(txt);
      const matchEst = est === 'TODOS' || t.estado === est;
      const matchPrio = prio === 'TODOS' || t.prioridad === prio;
      return matchTxt && matchEst && matchPrio;
    });
  }

  abrirDetalleTicket(ticket: TicketSoporte): void {
    this.modalTicket.set(ticket);
    this.estadoTicketSeleccionado = ticket.estado;
    this.nuevoMensajeTexto = '';
    this.imagenAdjuntaBase64.set('');
    this.imagenAdjuntaNombre.set('');
    setTimeout(() => this.scrollChatAlFinal(), 120);
  }

  cerrarModalTicket(): void {
    this.modalTicket.set(null);
    this.nuevoMensajeTexto = '';
    this.imagenAdjuntaBase64.set('');
    this.imagenAdjuntaNombre.set('');
  }

  async onSeleccionarImagen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    this.procesandoImagen.set(true);

    try {
      const base64Comprimida = await comprimirImagen(file, {
        maxAncho: 1200,
        maxAlto: 1200,
        calidad: 0.75
      });
      this.imagenAdjuntaBase64.set(base64Comprimida);
      this.imagenAdjuntaNombre.set(file.name);
      setTimeout(() => this.scrollChatAlFinal(), 60);
    } catch (e: any) {
      alert('Error al procesar la imagen: ' + (e.message || e));
    } finally {
      this.procesandoImagen.set(false);
      input.value = '';
    }
  }

  quitarImagenAdjunta(): void {
    this.imagenAdjuntaBase64.set('');
    this.imagenAdjuntaNombre.set('');
  }

  onEnterMensaje(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      this.enviarMensajeChat();
    }
  }

  async enviarMensajeChat(event?: Event): Promise<void> {
    if (event) event.preventDefault();

    const t = this.ticketActivo();
    if (!t) return;

    const texto = this.nuevoMensajeTexto.trim();
    const imagen = this.imagenAdjuntaBase64();

    if (!texto && !imagen) return;

    this.enviandoMensaje.set(true);
    try {
      const user = this.authService.currentUser();
      const remitenteNombre = this.authService.nombreUsuario() || 'Super Administrador';

      await this.soporteService.enviarMensajeTicket(
        t.folio,
        {
          texto,
          imagenUrl: imagen,
          remitenteRol: 'SUPERADMIN',
          remitenteNombre: `🛡️ Soporte (${remitenteNombre})`,
          remitenteUid: user?.uid || 'SUPERADMIN'
        },
        this.estadoTicketSeleccionado
      );

      this.nuevoMensajeTexto = '';
      this.imagenAdjuntaBase64.set('');
      this.imagenAdjuntaNombre.set('');
      setTimeout(() => this.scrollChatAlFinal(), 80);
    } catch (e: any) {
      alert('Error al enviar el mensaje: ' + (e.message || e));
    } finally {
      this.enviandoMensaje.set(false);
    }
  }

  async cambiarEstadoTicketEnChat(nuevoEstado: TicketSoporte['estado']): Promise<void> {
    this.estadoTicketSeleccionado = nuevoEstado;
    const t = this.ticketActivo();
    if (!t) return;
    try {
      await this.soporteService.actualizarEstadoTicket(t.folio, nuevoEstado);
    } catch (e: any) {
      alert('Error al actualizar estado del ticket: ' + (e.message || e));
    }
  }

  verImagenGrande(url: string): void {
    this.modalImagenZoom.set(url);
  }

  cerrarImagenZoom(): void {
    this.modalImagenZoom.set(null);
  }

  scrollChatAlFinal(): void {
    const el = document.getElementById('chatMessagesScroll');
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }

  async cambiarEstadoRapido(ticket: TicketSoporte, nuevoEstado: TicketSoporte['estado']): Promise<void> {
    try {
      await this.soporteService.actualizarEstadoTicket(ticket.folio, nuevoEstado);
    } catch (e: any) {
      alert('Error al cambiar estado: ' + (e.message || e));
    }
  }

  contactarClienteWhatsApp(ticket: TicketSoporte): void {
    const url = this.soporteService.generarEnlaceWhatsApp(ticket);
    if (!url) {
      alert('Este ticket no contiene un número telefónico válido para WhatsApp.');
      return;
    }
    window.open(url, '_blank');
  }

  inspeccionarEmpresaTicket(ticket: TicketSoporte): void {
    this.soporteService.darSeguimientoEnEmpresa(ticket);
  }

  async eliminarTicket(ticket: TicketSoporte, event?: Event): Promise<void> {
    if (event) event.stopPropagation();

    const conf = confirm(
      `¿Estás seguro de que deseas eliminar permanentemente el ticket #${ticket.folio} de "${ticket.nombreNegocio}"?\n\nEsta acción eliminará el ticket y todos sus mensajes de forma definitiva.`
    );
    if (!conf) return;

    try {
      const idAEliminar = ticket.id || ticket.folio;
      await this.soporteService.eliminarTicket(idAEliminar);
      if (this.modalTicket()?.folio === ticket.folio) {
        this.cerrarModalTicket();
      }
    } catch (e: any) {
      alert('Error al eliminar el ticket: ' + (e.message || e));
    }
  }
}

