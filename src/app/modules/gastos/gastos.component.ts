import { Component, signal, inject, computed, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { GastosService } from '../../core/services/gastos.service';
import { SociosService } from '../../core/services/socios.service';
import { Gasto } from '../../core/models/models';

@Component({
  selector: 'app-gastos',
  standalone: true,
  imports: [FormsModule, CurrencyMxnPipe, FechaLocalPipe],
  templateUrl: './gastos.component.html',
  styleUrl: './gastos.component.scss'
})
export class GastosComponent implements AfterViewInit {
  @ViewChild('conceptoInputRef') conceptoInputRef?: ElementRef<HTMLInputElement>;

  // Formulario Registro Nuevo
  public concepto = '';
  public monto = 0;
  public categoria = 'SERVICIOS';
  public origenGasto = 'CAJA'; // 'CAJA' o socioId
  public metodoPago = 'EFECTIVO';
  public observaciones = '';

  // Formulario / Modal Modificar Gasto
  public gastoEditando = signal<Gasto | null>(null);
  public editCategoria = signal<string>('SERVICIOS');
  public editOrigenGasto = signal<string>('CAJA');
  public editMetodoPago = signal<string>('EFECTIVO');
  public guardandoEdicion = signal<boolean>(false);

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

  // --- MODIFICACIÓN DE GASTO ---
  abrirModalEditar(g: Gasto): void {
    this.gastoEditando.set(g);
    this.editCategoria.set(g.categoria || 'OTROS');

    if (g.socioId) {
      this.editOrigenGasto.set(g.socioId);
    } else {
      const p = (g.persona || '').trim().toLowerCase();
      if (!p || p.includes('caja') || p.includes('empresa') || p === '-') {
        this.editOrigenGasto.set('CAJA');
      } else {
        const socio = this.sociosService.sociosActivos().find(
          (s) => s.nombre.trim().toLowerCase() === p || p.includes(s.nombre.trim().toLowerCase())
        );
        this.editOrigenGasto.set(socio ? socio.id : 'CAJA');
      }
    }

    this.editMetodoPago.set(g.metodoPago || 'EFECTIVO');
  }

  cerrarModalEditar(): void {
    this.gastoEditando.set(null);
  }

  onEditOrigenGastoChange(nuevoOrigen: string): void {
    this.editOrigenGasto.set(nuevoOrigen);
    if (nuevoOrigen === 'CAJA') {
      if (this.editMetodoPago() === 'BOLSILLO_SOCIO') {
        this.editMetodoPago.set('EFECTIVO');
      }
    } else {
      this.editMetodoPago.set('BOLSILLO_SOCIO');
    }
  }

  async onGuardarEdicionGasto(): Promise<void> {
    const actual = this.gastoEditando();
    if (!actual) return;

    let personaNombre = 'Caja (Negocio)';
    let socioId: string | undefined = undefined;

    if (this.editOrigenGasto() !== 'CAJA') {
      const socio = this.sociosService.sociosActivos().find((s) => s.id === this.editOrigenGasto());
      personaNombre = socio ? socio.nombre : 'Socio';
      socioId = this.editOrigenGasto();
    }

    const gastoModificado: Gasto = {
      ...actual,
      categoria: this.editCategoria(),
      persona: personaNombre,
      socioId,
      metodoPago: this.editMetodoPago()
    };

    this.guardandoEdicion.set(true);
    try {
      await this.gastosService.actualizarGasto(gastoModificado);
      this.cerrarModalEditar();
    } catch (err) {
      alert('Error al actualizar los datos del gasto.');
    } finally {
      this.guardandoEdicion.set(false);
    }
  }

  async onEliminarGasto(id: string): Promise<void> {
    if (confirm('¿Desea eliminar este registro de gasto?')) {
      await this.gastosService.eliminarGasto(id);
    }
  }
}
