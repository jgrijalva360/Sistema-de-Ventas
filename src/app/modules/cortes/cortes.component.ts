import { Component, signal, inject, computed, ViewChild, ElementRef, AfterViewInit, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { CortesService } from '../../core/services/cortes.service';
import { AuthService } from '../../core/services/auth.service';
import { SociosService } from '../../core/services/socios.service';

@Component({
  selector: 'app-cortes',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe, FechaLocalPipe],
  templateUrl: './cortes.component.html',
  styleUrl: './cortes.component.scss'
})
export class CortesComponent implements OnInit, AfterViewInit {
  @ViewChild('cajaInicialRef') cajaInicialRef?: ElementRef<HTMLInputElement>;
  @ViewChild('cajaContadaRef') cajaContadaRef?: ElementRef<HTMLInputElement>;

  public cortesService = inject(CortesService);
  public sociosService = inject(SociosService);
  private authService = inject(AuthService);

  // Formulario Apertura
  public usuarioApertura = this.authService.nombreOperadorActual();
  public cajaInicialApertura = 0;
  public observacionesApertura = '';

  // Formulario Cierre (Reactivo con Signals)
  public periodicidad = 'DIARIO';
  public retiros = signal<number>(0);
  public socioRetiroId = signal<string>('');
  public ingresosCaja = signal<number>(0);
  public cajaContada = signal<number | null>(null);
  public observacionesCierre = '';

  // Resguardo / Devolución en Turno Activo (Modal)
  public mostrarModalResguardo = signal<boolean>(false);
  public tipoMovimientoResguardo = signal<'RETIRO' | 'DEVOLUCION'>('RETIRO');
  public montoResguardo = signal<number | null>(null);
  public socioResguardoId = signal<string>('');
  public conceptoResguardo = signal<string>('Resguardo de efectivo');

  public totalResguardosTurnoActivo = computed(() => {
    const activo = this.cortesService.corteActivo();
    return (activo?.resguardos || [])
      .filter((r) => !r.tipo || r.tipo === 'RETIRO')
      .reduce((sum, r) => sum + (r.monto || 0), 0);
  });

  public totalDevolucionesTurnoActivo = computed(() => {
    const activo = this.cortesService.corteActivo();
    return (activo?.resguardos || [])
      .filter((r) => r.tipo === 'DEVOLUCION')
      .reduce((sum, r) => sum + (r.monto || 0), 0);
  });

  public resumenEnVivo = computed(() => {
    return this.cortesService.calcularResumenTurnoActivo(
      this.retiros() || 0,
      this.ingresosCaja() || 0,
      this.cajaContada() || 0
    );
  });

  public diferenciaCalculada = computed(() => {
    const contada = this.cajaContada();
    if (contada === null || contada === undefined) return 0;
    const esp = this.resumenEnVivo().cajaEsperada;
    const diff = Math.round((contada - esp) * 100) / 100;
    return Math.abs(diff) < 0.005 ? 0 : diff;
  });

  ngOnInit(): void {
    const defSocio = this.sociosService.socioResguardosDefault();
    if (defSocio) {
      this.socioRetiroId.set(defSocio.id);
      this.socioResguardoId.set(defSocio.id);
    }
    // Si el turno activo ya tenía resguardos o devoluciones registradas, precargar
    const resgAcumulados = this.totalResguardosTurnoActivo();
    if (resgAcumulados > 0 && this.retiros() === 0) {
      this.retiros.set(resgAcumulados);
    }
    const devAcumuladas = this.totalDevolucionesTurnoActivo();
    if (devAcumuladas > 0 && this.ingresosCaja() === 0) {
      this.ingresosCaja.set(devAcumuladas);
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (this.cajaContadaRef) {
        this.cajaContadaRef.nativeElement.focus();
      } else if (this.cajaInicialRef) {
        this.cajaInicialRef.nativeElement.focus();
      }
    }, 100);
  }

  abrirModalResguardo(tipo: 'RETIRO' | 'DEVOLUCION' = 'RETIRO'): void {
    this.tipoMovimientoResguardo.set(tipo);
    const defSocio = this.sociosService.socioResguardosDefault();
    if (defSocio && !this.socioResguardoId()) {
      this.socioResguardoId.set(defSocio.id);
    }
    this.montoResguardo.set(null);
    this.conceptoResguardo.set(tipo === 'DEVOLUCION' ? 'Devolución de efectivo a caja' : 'Resguardo parcial de efectivo');
    this.mostrarModalResguardo.set(true);
  }

  cerrarModalResguardo(): void {
    this.mostrarModalResguardo.set(false);
  }

  async onGuardarResguardoTurno(): Promise<void> {
    const monto = Number(this.montoResguardo());
    const socioId = this.socioResguardoId();
    const socio = this.sociosService.sociosActivos().find((s) => s.id === socioId);
    const tipo = this.tipoMovimientoResguardo();

    if (!monto || monto <= 0 || !socio) {
      alert('Ingresa un monto válido y selecciona el socio correspondiente.');
      return;
    }

    await this.cortesService.registrarResguardoTurnoActivo(
      monto,
      socio.id,
      socio.nombre,
      this.conceptoResguardo().trim() || (tipo === 'DEVOLUCION' ? 'Devolución a caja' : 'Resguardo de efectivo'),
      tipo
    );

    if (tipo === 'DEVOLUCION') {
      // Sumar al campo ingresosCaja del formulario de cierre
      this.ingresosCaja.update((v) => Math.round(((v || 0) + monto) * 100) / 100);
    } else {
      // Sumar al campo retiros del formulario de cierre
      this.retiros.update((v) => Math.round(((v || 0) + monto) * 100) / 100);
      if (!this.socioRetiroId()) {
        this.socioRetiroId.set(socio.id);
      }
    }

    this.mostrarModalResguardo.set(false);
  }

  async onEliminarResguardoTurno(id: string): Promise<void> {
    const activo = this.cortesService.corteActivo();
    const item = (activo?.resguardos || []).find((r) => r.id === id);

    const texto = item?.tipo === 'DEVOLUCION' ? 'devolución' : 'resguardo';
    if (confirm(`¿Eliminar el registro de ${texto} por $${item?.monto || 0}?`)) {
      await this.cortesService.eliminarResguardoTurnoActivo(id);
      if (item) {
        if (item.tipo === 'DEVOLUCION') {
          this.ingresosCaja.update((v) => Math.max(0, Math.round(((v || 0) - item.monto) * 100) / 100));
        } else {
          this.retiros.update((v) => Math.max(0, Math.round(((v || 0) - item.monto) * 100) / 100));
        }
      }
    }
  }

  async onAbrirCorte(): Promise<void> {
    if (!this.usuarioApertura || this.cajaInicialApertura < 0) return;

    await this.cortesService.abrirCorte(
      this.usuarioApertura,
      this.cajaInicialApertura,
      this.observacionesApertura
    );
    this.cajaInicialApertura = 0;
    this.observacionesApertura = '';
  }

  async onCerrarCorte(): Promise<void> {
    const contada = this.cajaContada();
    if (contada === null || contada < 0) return;

    const montoRetiros = this.retiros() || 0;
    let socioRetiro = this.sociosService.sociosActivos().find((s) => s.id === this.socioRetiroId());

    if (montoRetiros > 0 && !socioRetiro) {
      socioRetiro = this.sociosService.socioResguardosDefault() || this.sociosService.sociosActivos()[0];
    }

    await this.cortesService.cerrarCorte(
      contada,
      montoRetiros,
      this.ingresosCaja() || 0,
      this.observacionesCierre,
      this.periodicidad,
      {
        socioRetiroId: socioRetiro?.id,
        socioRetiroNombre: socioRetiro?.nombre,
        resguardosDetalle: this.cortesService.corteActivo()?.resguardos
      }
    );

    this.cajaContada.set(null);
    this.retiros.set(0);
    this.ingresosCaja.set(0);
    this.observacionesCierre = '';
  }

  async onEliminarCorte(id: string): Promise<void> {
    if (confirm('¿Eliminar este corte de caja?')) {
      await this.cortesService.eliminarCorte(id);
    }
  }
}
