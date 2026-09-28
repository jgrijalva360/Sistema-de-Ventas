import { Component, signal, inject, computed, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { GastosService } from '../../core/services/gastos.service';
import { SociosService } from '../../core/services/socios.service';

@Component({
  selector: 'app-gastos',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe, FechaLocalPipe],
  templateUrl: './gastos.component.html',
  styleUrl: './gastos.component.scss'
})
export class GastosComponent implements AfterViewInit {
  @ViewChild('conceptoInputRef') conceptoInputRef?: ElementRef<HTMLInputElement>;

  public concepto = '';
  public monto = 0;
  public categoria = 'SERVICIOS';
  public metodoPago = 'EFECTIVO';
  public origenGasto = 'CAJA'; // 'CAJA' o socioId
  public observaciones = '';

  public gastosService = inject(GastosService);
  public sociosService = inject(SociosService);

  ngAfterViewInit(): void {
    setTimeout(() => this.conceptoInputRef?.nativeElement.focus(), 100);
  }

  onOrigenGastoChange(nuevoOrigen: string): void {
    this.origenGasto = nuevoOrigen;
    if (nuevoOrigen === 'CAJA') {
      if (this.metodoPago === 'BOLSILLO_SOCIO') {
        this.metodoPago = 'EFECTIVO';
      }
    } else {
      this.metodoPago = 'BOLSILLO_SOCIO';
    }
  }

  public totalAcumulado = computed(() => {
    return this.gastosService.gastos().reduce((acc, g) => acc + (g.monto || 0), 0);
  });

  async onRegistrarGasto(): Promise<void> {
    if (!this.concepto || this.monto <= 0) return;

    let personaNombre = 'Caja (Negocio)';
    let socioId: string | undefined = undefined;

    if (this.origenGasto !== 'CAJA') {
      const socio = this.sociosService.sociosActivos().find((s) => s.id === this.origenGasto);
      personaNombre = socio ? socio.nombre : 'Socio';
      socioId = this.origenGasto;
    }

    await this.gastosService.registrarGasto({
      concepto: this.concepto,
      monto: this.monto,
      categoria: this.categoria,
      persona: personaNombre,
      socioId,
      metodoPago: this.metodoPago,
      observaciones: this.observaciones
    });

    this.concepto = '';
    this.monto = 0;
    this.origenGasto = 'CAJA';
    this.metodoPago = 'EFECTIVO';
    this.observaciones = '';
  }

  async onEliminarGasto(id: string): Promise<void> {
    if (confirm('¿Desea eliminar este registro de gasto?')) {
      await this.gastosService.eliminarGasto(id);
    }
  }
}
