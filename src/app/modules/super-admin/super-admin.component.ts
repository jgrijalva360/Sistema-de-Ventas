import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SuscripcionService } from '../../core/services/suscripcion.service';
import { AuthService } from '../../core/services/auth.service';
import { SuscripcionEmpresa, PlanSuscripcion, EstadoSuscripcion, CodigoPromocional, PlanCatalogo } from '../../core/models/models';
import { MercadoPagoService } from '../../core/services/mercado-pago.service';

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

  public pestanaActiva = signal<'EMPRESAS' | 'CODIGOS' | 'PLANES'>('EMPRESAS');

  public empresas = signal<SuscripcionEmpresa[]>([]);
  public codigos = signal<CodigoPromocional[]>([]);
  public cargando = signal<boolean>(false);
  public filtroTexto = signal<string>('');
  public filtroPlan = signal<string>('TODOS');
  public filtroEstado = signal<string>('TODOS');

  // Modal de Edición Manual de Suscripción
  public modalEditar = signal<SuscripcionEmpresa | null>(null);
  public diasSumar = 30;
  public planSeleccionado: PlanSuscripcion = 'PRO';
  public estadoSeleccionado: EstadoSuscripcion = 'ACTIVA';
  public guardando = signal<boolean>(false);
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
  public planEditMaxProductos = 500;
  public planEditDestacado = false;
  public planEditCaracteristicasTexto = '';
  public guardandoPlan = signal<boolean>(false);
  public errorPlanModal = signal<string>('');

  async ngOnInit(): Promise<void> {
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

  abrirModalEditar(emp: SuscripcionEmpresa): void {
    this.modalEditar.set(emp);
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
        this.estadoSeleccionado
      );
      await this.cargarEmpresas();
      this.cerrarModal();
    } catch (e: any) {
      this.mensajeModal.set(e.message || 'Error al actualizar vigencia.');
    } finally {
      this.guardando.set(false);
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
    this.planEditMaxProductos = plan.maxProductos || (plan.id === 'BASICO' ? 500 : (plan.id === 'PRO' ? 5000 : 50000));
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
            meses: Number(this.planEditMeses) || 1,
            maxUsuarios: Number(this.planEditMaxUsuarios) || 2,
            maxSucursales: Number(this.planEditMaxSucursales) || 1,
            maxProductos: Number(this.planEditMaxProductos) || 500,
            destacado: this.planEditDestacado,
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
}
