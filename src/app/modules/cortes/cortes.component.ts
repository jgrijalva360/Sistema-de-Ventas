import { Component, signal, inject, computed, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { CortesService } from '../../core/services/cortes.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-cortes',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe, FechaLocalPipe],
  templateUrl: './cortes.component.html',
  styleUrl: './cortes.component.scss'
})
export class CortesComponent implements AfterViewInit {
  @ViewChild('cajaInicialRef') cajaInicialRef?: ElementRef<HTMLInputElement>;
  @ViewChild('cajaContadaRef') cajaContadaRef?: ElementRef<HTMLInputElement>;

  public cortesService = inject(CortesService);
  private authService = inject(AuthService);

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (this.cajaContadaRef) {
        this.cajaContadaRef.nativeElement.focus();
      } else if (this.cajaInicialRef) {
        this.cajaInicialRef.nativeElement.focus();
      }
    }, 100);
  }

  // Formulario Apertura
  public usuarioApertura = this.authService.currentUser()?.email || 'Cajero 1';
  public cajaInicialApertura = 0;
  public observacionesApertura = '';

  // Formulario Cierre (Reactivo con Signals)
  public periodicidad = 'DIARIO';
  public retiros = signal<number>(0);
  public ingresosCaja = signal<number>(0);
  public cajaContada = signal<number | null>(null);
  public observacionesCierre = '';

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

    await this.cortesService.cerrarCorte(
      contada,
      this.retiros() || 0,
      this.ingresosCaja() || 0,
      this.observacionesCierre,
      this.periodicidad
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
