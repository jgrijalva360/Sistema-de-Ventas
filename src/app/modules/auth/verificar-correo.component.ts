import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-verificar-correo',
  standalone: true,
  template: `
    <div class="verif-wrapper">
      <div class="verif-card">
        <div class="icon-pulse">
          <span>✉️</span>
        </div>

        <h2>Verifica tu Correo Electrónico</h2>
        <p class="subtitle">
          Para garantizar la seguridad del sistema y validar tu cuenta, es necesario confirmar tu correo antes de acceder.
        </p>

        <div class="email-badge">
          <span>Enviamos un enlace de activación a:</span>
          <strong>{{ userEmail() }}</strong>
        </div>

        @if (mensajeExito()) {
          <div class="alert alert-success">
            ✅ {{ mensajeExito() }}
          </div>
        }

        @if (mensajeError()) {
          <div class="alert alert-danger">
            ⚠️ {{ mensajeError() }}
          </div>
        }

        <div class="actions-group">
          <!-- Botón de Comprobación Manual -->
          <button
            type="button"
            class="btn btn-primary btn-block"
            (click)="comprobarVerificacion()"
            [disabled]="comprobando()"
          >
            {{ comprobando() ? 'Comprobando estado...' : '🔄 Ya confirmé mi correo' }}
          </button>

          <!-- Botón de Reenvío con Cooldown -->
          <button
            type="button"
            class="btn btn-secondary btn-block"
            (click)="reenviarCorreo()"
            [disabled]="reenviando() || cooldownSegundos() > 0"
          >
            @if (cooldownSegundos() > 0) {
              ⏳ Espera {{ cooldownSegundos() }}s para reenviar
            } @else {
              {{ reenviando() ? 'Enviando enlace...' : '📧 Reenviar correo de confirmación' }}
            }
          </button>
        </div>

        <div class="help-box">
          <small>
            ¿No encuentras el correo? Revisa tu carpeta de <strong>Spam</strong> o <strong>Correo no deseado</strong>.
            La detección es automática si abres el enlace en otra pestaña o en tu teléfono.
          </small>
        </div>

        <div class="logout-link">
          <button type="button" class="btn-link" (click)="cerrarSesion()">
            🚪 Cerrar sesión / Usar otra cuenta
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .verif-wrapper {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      padding: 20px;
      font-family: inherit;
    }

    .verif-card {
      background: #ffffff;
      border-radius: 20px;
      padding: 36px 32px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(15px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .icon-pulse {
      width: 80px;
      height: 80px;
      margin: 0 auto 20px;
      background: #e0f2fe;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
      box-shadow: 0 0 0 10px rgba(2, 132, 199, 0.1);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(2, 132, 199, 0.25); }
      70% { box-shadow: 0 0 0 16px rgba(2, 132, 199, 0); }
      100% { box-shadow: 0 0 0 0 rgba(2, 132, 199, 0); }
    }

    h2 {
      margin: 0 0 8px;
      color: #0f172a;
      font-size: 1.5rem;
      font-weight: 800;
    }

    .subtitle {
      color: #64748b;
      font-size: 0.92rem;
      line-height: 1.5;
      margin: 0 0 20px;
    }

    .email-badge {
      background: #f8fafc;
      border: 1.5px dashed #cbd5e1;
      border-radius: 12px;
      padding: 12px 16px;
      margin-bottom: 22px;
      display: flex;
      flex-direction: column;
      gap: 4px;

      span {
        font-size: 0.8rem;
        color: #64748b;
        font-weight: 600;
      }
      strong {
        font-size: 1rem;
        color: #0284c7;
        word-break: break-all;
      }
    }

    .alert {
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 18px;
      text-align: left;
    }
    .alert-success {
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #bbf7d0;
    }
    .alert-danger {
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }

    .actions-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 20px;
    }

    .btn {
      padding: 12px 20px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 0.95rem;
      border: none;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;

      &:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }
    }

    .btn-block {
      width: 100%;
    }

    .btn-primary {
      background: #0284c7;
      color: #ffffff;
      &:hover:not(:disabled) {
        background: #0369a1;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
      }
    }

    .btn-secondary {
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #cbd5e1;
      &:hover:not(:disabled) {
        background: #e2e8f0;
      }
    }

    .help-box {
      background: #fdf2f8;
      border: 1px solid #fbcfe8;
      border-radius: 10px;
      padding: 10px 14px;
      margin-bottom: 20px;
      color: #9d174d;
      font-size: 0.82rem;
      line-height: 1.4;
    }

    .logout-link {
      .btn-link {
        background: none;
        border: none;
        color: #64748b;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
        padding: 4px 8px;
        transition: color 0.15s;
        &:hover {
          color: #dc2626;
          text-decoration: underline;
        }
      }
    }
  `]
})
export class VerificarCorreoComponent implements OnInit, OnDestroy {
  public authService = inject(AuthService);
  private router = inject(Router);

  public userEmail = signal<string>('');
  public comprobando = signal<boolean>(false);
  public reenviando = signal<boolean>(false);
  public mensajeExito = signal<string>('');
  public mensajeError = signal<string>('');
  public cooldownSegundos = signal<number>(0);

  private timerInterval?: any;
  private autoCheckInterval?: any;

  async ngOnInit(): Promise<void> {
    await this.authService.waitForAuthReady();
    const user = this.authService.fb.auth.currentUser;

    if (!user) {
      this.router.navigate(['/login']);
      return;
    }

    this.userEmail.set(user.email || 'tu correo');

    // Si ya está verificado, enviar directo al dashboard
    if (user.emailVerified || this.authService.esSuperAdmin()) {
      this.router.navigate(['/dashboard']);
      return;
    }

    // Auto-comprobar cada 5 segundos de forma silenciosa
    this.autoCheckInterval = setInterval(async () => {
      try {
        const verificado = await this.authService.refrescarEstadoUsuario();
        if (verificado) {
          clearInterval(this.autoCheckInterval);
          this.router.navigate(['/dashboard']);
        }
      } catch (_) { }
    }, 5000);
  }

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.autoCheckInterval) clearInterval(this.autoCheckInterval);
  }

  async comprobarVerificacion(): Promise<void> {
    this.comprobando.set(true);
    this.mensajeError.set('');
    this.mensajeExito.set('');

    try {
      const verificado = await this.authService.refrescarEstadoUsuario();
      if (verificado) {
        this.mensajeExito.set('¡Correo verificado con éxito! Redirigiendo al sistema...');
        setTimeout(() => this.router.navigate(['/dashboard']), 1200);
      } else {
        this.mensajeError.set('Aún no se ha verificado el enlace. Por favor haz clic en el link recibido en tu correo y vuelve a pulsar aquí.');
      }
    } catch (e: any) {
      this.mensajeError.set(e.message || 'Error al comprobar verificación.');
    } finally {
      this.comprobando.set(false);
    }
  }

  async reenviarCorreo(): Promise<void> {
    if (this.cooldownSegundos() > 0) return;

    this.reenviando.set(true);
    this.mensajeError.set('');
    this.mensajeExito.set('');

    try {
      await this.authService.enviarCorreoVerificacion();
      this.mensajeExito.set('Se ha reenviado el enlace de activación a tu correo.');
      this.iniciarCooldown(60);
    } catch (e: any) {
      if (e.code === 'auth/too-many-requests') {
        this.mensajeError.set('Has solicitado varios correos recientemente. Por favor espera unos minutos antes de intentar de nuevo.');
        this.iniciarCooldown(120);
      } else {
        this.mensajeError.set(e.message || 'Error al reenviar correo de confirmación.');
      }
    } finally {
      this.reenviando.set(false);
    }
  }

  private iniciarCooldown(segundos: number): void {
    this.cooldownSegundos.set(segundos);
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      const act = this.cooldownSegundos();
      if (act <= 1) {
        clearInterval(this.timerInterval);
        this.cooldownSegundos.set(0);
      } else {
        this.cooldownSegundos.set(act - 1);
      }
    }, 1000);
  }

  async cerrarSesion(): Promise<void> {
    await this.authService.logout();
    this.router.navigate(['/login']);
  }
}
