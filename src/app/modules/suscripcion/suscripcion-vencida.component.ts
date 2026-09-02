import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { SuscripcionService } from '../../core/services/suscripcion.service';
import { AuthService } from '../../core/services/auth.service';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-suscripcion-vencida',
  standalone: true,
  imports: [FormsModule, DatePipe, RouterLink],
  templateUrl: './suscripcion-vencida.component.html',
  styleUrl: './suscripcion-vencida.component.scss'
})
export class SuscripcionVencidaComponent {
  public suscripcionService = inject(SuscripcionService);
  public authService = inject(AuthService);
  private router = inject(Router);

  public codigoActivacion = '';
  public activando = signal<boolean>(false);
  public errorMsg = signal<string>('');
  public successMsg = signal<string>('');

  async activarCodigo(): Promise<void> {
    if (!this.codigoActivacion.trim()) return;
    this.activando.set(true);
    this.errorMsg.set('');
    this.successMsg.set('');

    try {
      const empresaId = this.authService.getTenantId();
      await this.suscripcionService.activarConCodigo(empresaId, this.codigoActivacion);
      this.successMsg.set('🎉 ¡Suscripción activada con éxito! Redirigiendo...');
      setTimeout(() => {
        this.router.navigate(['/dashboard']);
      }, 1500);
    } catch (e: any) {
      this.errorMsg.set(e.message || 'Código no válido');
    } finally {
      this.activando.set(false);
    }
  }

  cerrarSesion(): void {
    this.authService.logout();
  }
}
