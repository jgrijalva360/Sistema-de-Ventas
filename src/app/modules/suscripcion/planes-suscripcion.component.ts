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

  seleccionarPlan(plan: PlanCatalogo): void {
    this.modalConfirmacion.set(plan);
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

      // 1. Obtener la preferencia oficial generada por Mercado Pago
      const linkPago = await this.mpService.iniciarCheckoutPlan(plan, sub);

      // 2. Redirigir al Checkout Pro oficial de Mercado Pago
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
