import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MercadoPagoService } from '../../core/services/mercado-pago.service';
import { AuthService } from '../../core/services/auth.service';
import { PlanCatalogo } from '../../core/models/models';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.scss'
})
export class LandingPageComponent {
  public mpService = inject(MercadoPagoService);
  public authService = inject(AuthService);
  private router = inject(Router);

  // Modal de Registro Rápido con Plan
  public modalRegistroAbierto = signal<boolean>(false);
  public planSeleccionado = signal<PlanCatalogo | null>(null);

  public nombreNegocio = '';
  public nombreDueno = '';
  public email = '';
  public password = '';
  public errorRegistro = signal<string>('');
  public registrando = signal<boolean>(false);

  abrirRegistroConPlan(plan?: PlanCatalogo): void {
    this.planSeleccionado.set(plan || null);
    this.errorRegistro.set('');
    this.modalRegistroAbierto.set(true);
  }

  cerrarModal(): void {
    this.modalRegistroAbierto.set(false);
  }

  async registrarseYContinuar(): Promise<void> {
    if (!this.email || !this.password || !this.nombreNegocio) {
      this.errorRegistro.set('Por favor completa todos los campos requeridos.');
      return;
    }
    if (this.password.length < 6) {
      this.errorRegistro.set('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    this.registrando.set(true);
    this.errorRegistro.set('');

    try {
      // 1. Crear cuenta y registrar empresa con 15 días de prueba gratis
      await this.authService.register(this.email, this.password, this.nombreNegocio);

      const plan = this.planSeleccionado();

      if (plan) {
        // 2. Si eligió un plan directo, redirigir al checkout de Mercado Pago
        const sub = {
          empresaId: this.authService.getTenantId(),
          nombreNegocio: this.nombreNegocio,
          contactoEmail: this.email,
          plan: plan.id,
          estado: 'PRUEBA' as const,
          fechaInicio: new Date().toISOString(),
          fechaVencimiento: new Date().toISOString(),
          limites: { maxUsuarios: plan.maxUsuarios, maxSucursales: plan.maxSucursales }
        };

        const linkPago = await this.mpService.iniciarCheckoutPlan(plan, sub);
        this.cerrarModal();

        if (linkPago.startsWith('http')) {
          window.location.href = linkPago;
          return;
        }
      }

      // Si inició prueba gratis, ir directo al punto de venta
      this.cerrarModal();
      this.router.navigate(['/dashboard']);
    } catch (e: any) {
      this.errorRegistro.set(e.message || 'Error al crear tu cuenta.');
    } finally {
      this.registrando.set(false);
    }
  }
}
