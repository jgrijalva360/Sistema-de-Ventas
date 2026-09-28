import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MercadoPagoService } from '../../core/services/mercado-pago.service';
import { SuscripcionService } from '../../core/services/suscripcion.service';
import { AuthService } from '../../core/services/auth.service';
import { PlanCatalogo } from '../../core/models/models';

@Component({
  selector: 'app-planes-suscripcion',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './planes-suscripcion.component.html',
  styleUrl: './planes-suscripcion.component.scss'
})
export class PlanesSuscripcionComponent {
  public mpService = inject(MercadoPagoService);
  public suscripcionService = inject(SuscripcionService);
  public authService = inject(AuthService);
  private router = inject(Router);

  public procesandoPlan = signal<string | null>(null);
  public modalConfirmacion = signal<PlanCatalogo | null>(null);
  public modalidadCobro = signal<'RECURRENTE' | 'UNICO'>('RECURRENTE');

  seleccionarPlan(plan: PlanCatalogo): void {
    if (plan.periodo === 'ANUAL') {
      this.modalidadCobro.set('UNICO');
    } else {
      this.modalidadCobro.set('RECURRENTE');
    }
    this.modalConfirmacion.set(plan);
  }

  setModalidad(modo: 'RECURRENTE' | 'UNICO'): void {
    this.modalidadCobro.set(modo);
  }

  async confirmarPagoMercadoPago(): Promise<void> {
    const plan = this.modalConfirmacion();
    if (!plan) return;

    this.procesandoPlan.set(plan.id);

    try {
      const sub = this.suscripcionService.suscripcion();
      if (!sub) {
        throw new Error('No se encontró la información de tu organización.');
      }

      let linkPago = '';
      if (plan.periodo === 'MENSUAL' && this.modalidadCobro() === 'RECURRENTE') {
        // Débito automático recurrente mensual (PreApproval)
        linkPago = await this.mpService.iniciarSuscripcionRecurrente(plan, sub);
      } else {
        // Pago único mensual o anual (Checkout Pro con tarjeta, OXXO, SPEI)
        linkPago = await this.mpService.iniciarCheckoutPlan(plan, sub);
      }

      this.modalConfirmacion.set(null);
      if (linkPago.startsWith('http')) {
        window.location.href = linkPago;
      } else {
        // Fallback local
        await this.suscripcionService.renovarSuscripcion(sub.empresaId, plan.meses, plan.id);
        this.router.navigate(['/suscripcion/pago-resultado'], {
          queryParams: { status: 'success', plan: plan.id, meses: plan.meses }
        });
      }
    } catch (err: any) {
      alert('⚠️ ' + (err.message || 'Error al procesar con Mercado Pago.'));
    } finally {
      this.procesandoPlan.set(null);
    }
  }

  cerrarModal(): void {
    this.modalConfirmacion.set(null);
  }
}
