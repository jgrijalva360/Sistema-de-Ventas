import { Component, inject, signal, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { ConfiguracionService } from '../../core/services/configuracion.service';
import { UsuarioSistema } from '../../core/models/models';

@Component({
  selector: 'app-pin-lock',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="pin-overlay" [class.shake-anim]="shake()">
      <div class="pin-card">
        <!-- Encabezado de la Terminal -->
        <div class="pin-header">
          <div class="store-badge">
            <span class="icon">🏢</span>
            <span>{{ configService.config().businessName || 'Mi Negocio' }}</span>
            <span class="dot">•</span>
            <span>{{ sucursalesService.sucursalActiva().nombre || 'Matriz' }}</span>
          </div>

          <div class="terminal-icon">
            🔒
          </div>

          <h2 class="title">Terminal de Cobro Bloqueada</h2>
          <p class="subtitle">
            Ingresa tu <strong>PIN de 4 dígitos</strong> para comenzar a operar la caja
          </p>
        </div>

        <!-- Indicador de Dígitos (Dots) -->
        <div class="pin-display">
          <div class="dot" [class.filled]="pin().length >= 1"></div>
          <div class="dot" [class.filled]="pin().length >= 2"></div>
          <div class="dot" [class.filled]="pin().length >= 3"></div>
          <div class="dot" [class.filled]="pin().length >= 4"></div>
          @if (pin().length > 4) {
            <div class="dot" [class.filled]="pin().length >= 5"></div>
            <div class="dot" [class.filled]="pin().length >= 6"></div>
          }
        </div>

        <!-- Mensajes de Estado / Error -->
        @if (errorMsg()) {
          <div class="alert-error">
            ⚠️ {{ errorMsg() }}
          </div>
        } @else if (successMsg()) {
          <div class="alert-success">
            ✨ {{ successMsg() }}
          </div>
        } @else {
          <div class="alert-hint">
            Puedes teclear los números en tu teclado físico o presionar en pantalla
          </div>
        }

        <!-- Teclado Numérico Táctil -->
        <div class="keypad-grid">
          <button type="button" class="key-btn" (click)="pressDigit('1')">1</button>
          <button type="button" class="key-btn" (click)="pressDigit('2')">2</button>
          <button type="button" class="key-btn" (click)="pressDigit('3')">3</button>

          <button type="button" class="key-btn" (click)="pressDigit('4')">4</button>
          <button type="button" class="key-btn" (click)="pressDigit('5')">5</button>
          <button type="button" class="key-btn" (click)="pressDigit('6')">6</button>

          <button type="button" class="key-btn" (click)="pressDigit('7')">7</button>
          <button type="button" class="key-btn" (click)="pressDigit('8')">8</button>
          <button type="button" class="key-btn" (click)="pressDigit('9')">9</button>

          <button type="button" class="key-btn key-action" (click)="clearPin()" title="Limpiar todo">
            ✕
          </button>
          <button type="button" class="key-btn" (click)="pressDigit('0')">0</button>
          <button type="button" class="key-btn key-action" (click)="deleteDigit()" title="Borrar último dígito">
            ⌫
          </button>
        </div>

        <!-- Acceso de Emergencia para el Administrador (Solo si la sesión de la máquina es Administrador) -->
        @if (authService.perfilUsuario()?.rol === 'ADMIN' || authService.esSuperAdmin()) {
          <div class="admin-unlock-row">
            <button type="button" class="btn-admin-unlock" (click)="desbloquearComoAdmin()">
              🔑 Desbloquear como Dueño / Administrador
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .pin-overlay {
      position: fixed;
      inset: 0;
      z-index: 999999;
      background: radial-gradient(circle at 50% 20%, rgba(30, 41, 59, 0.96), rgba(15, 23, 42, 0.98));
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      user-select: none;
      font-family: inherit;
    }

    .pin-card {
      background: rgba(30, 41, 59, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 24px;
      padding: 32px 36px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(2, 132, 199, 0.15);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      color: #f8fafc;
    }

    .store-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 12px;
    }

    .store-badge .dot {
      color: #64748b;
    }

    .terminal-icon {
      font-size: 2.8rem;
      line-height: 1;
      margin-bottom: 8px;
      filter: drop-shadow(0 4px 12px rgba(2, 132, 199, 0.4));
    }

    .title {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #ffffff;
    }

    .subtitle {
      margin: 6px 0 20px;
      font-size: 0.88rem;
      color: #94a3b8;
      line-height: 1.4;
    }

    .subtitle strong {
      color: #38bdf8;
    }

    /* Indicador de Dots */
    .pin-display {
      display: flex;
      gap: 16px;
      margin-bottom: 18px;
    }

    .dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.25);
      background: transparent;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .dot.filled {
      background: #0284c7;
      border-color: #38bdf8;
      box-shadow: 0 0 14px #0284c7;
      transform: scale(1.15);
    }

    /* Mensajes */
    .alert-error {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 8px 14px;
      border-radius: 10px;
      font-size: 0.84rem;
      font-weight: 600;
      margin-bottom: 16px;
      width: 100%;
    }

    .alert-success {
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #6ee7b7;
      padding: 8px 14px;
      border-radius: 10px;
      font-size: 0.88rem;
      font-weight: 700;
      margin-bottom: 16px;
      width: 100%;
    }

    .alert-hint {
      font-size: 0.78rem;
      color: #64748b;
      margin-bottom: 16px;
    }

    /* Keypad Grid */
    .keypad-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      width: 100%;
      max-width: 320px;
      margin-bottom: 20px;
    }

    .key-btn {
      aspect-ratio: 1.35;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      color: #f8fafc;
      font-size: 1.55rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.12s ease;
      touch-action: manipulation;
    }

    .key-btn:hover {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-2px);
    }

    .key-btn:active {
      transform: scale(0.95);
      background: #0284c7;
      color: white;
    }

    .key-btn.key-action {
      font-size: 1.25rem;
      color: #94a3b8;
      background: rgba(255, 255, 255, 0.03);
    }

    .key-btn.key-action:hover {
      color: #ffffff;
      background: rgba(239, 68, 68, 0.2);
    }

    .admin-unlock-row {
      margin-top: 4px;
    }

    .btn-admin-unlock {
      background: none;
      border: none;
      color: #38bdf8;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      text-decoration: underline;
      opacity: 0.85;
      transition: opacity 0.2s;
    }

    .btn-admin-unlock:hover {
      opacity: 1;
      color: #7dd3fc;
    }

    /* Animación de Shake en caso de error */
    .shake-anim .pin-card {
      animation: shake 0.4s cubic-bezier(.36,.07,.19,.97) both;
    }

    @keyframes shake {
      10%, 90% { transform: translate3d(-3px, 0, 0); }
      20%, 80% { transform: translate3d(5px, 0, 0); }
      30%, 50%, 70% { transform: translate3d(-6px, 0, 0); }
      40%, 60% { transform: translate3d(6px, 0, 0); }
    }
  `]
})
export class PinLockComponent implements OnInit {
  public authService = inject(AuthService);
  public sucursalesService = inject(SucursalesService);
  public configService = inject(ConfiguracionService);
  private router = inject(Router);

  public pin = signal<string>('');
  public errorMsg = signal<string>('');
  public successMsg = signal<string>('');
  public shake = signal<boolean>(false);
  public validando = signal<boolean>(false);

  ngOnInit(): void {
    this.pin.set('');
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Si ya estamos validando un PIN o mostrando éxito, ignorar
    if (this.validando() || this.successMsg()) return;

    if (event.key >= '0' && event.key <= '9') {
      this.pressDigit(event.key);
      event.preventDefault();
    } else if (event.key === 'Backspace') {
      this.deleteDigit();
      event.preventDefault();
    } else if (event.key === 'Escape') {
      this.clearPin();
      event.preventDefault();
    } else if (event.key === 'Enter') {
      if (this.pin().length >= 4) {
        this.verificarPin(this.pin());
      }
      event.preventDefault();
    }
  }

  pressDigit(digit: string): void {
    if (this.validando() || this.successMsg()) return;
    if (this.pin().length >= 6) return;

    this.errorMsg.set('');
    const nuevoPin = this.pin() + digit;
    this.pin.set(nuevoPin);

    // Cuando se ingresan 4 dígitos, verificar automáticamente
    if (nuevoPin.length >= 4) {
      this.verificarPin(nuevoPin);
    }
  }

  deleteDigit(): void {
    if (this.validando() || this.successMsg()) return;
    this.errorMsg.set('');
    this.pin.set(this.pin().slice(0, -1));
  }

  clearPin(): void {
    if (this.validando() || this.successMsg()) return;
    this.pin.set('');
    this.errorMsg.set('');
  }

  async verificarPin(pinAVerificar: string): Promise<void> {
    this.validando.set(true);
    this.errorMsg.set('');

    try {
      const res = await this.authService.desbloquearConPin(pinAVerificar);
      if (res.success && res.usuario) {
        this.successMsg.set(`¡Bienvenido, ${res.usuario.nombre}!`);
        const esCajero = res.usuario.rol === 'CAJERO';
        // Breve retraso estético para ver la bienvenida
        setTimeout(() => {
          this.validando.set(false);
          this.successMsg.set('');
          this.pin.set('');
          if (esCajero) {
            this.router.navigate(['/ventas']);
          }
        }, 400);
      } else {
        this.dispararError(res.error || 'PIN no reconocido.');
      }
    } catch (e: any) {
      this.dispararError(e.message || 'Error al validar el PIN.');
    }
  }

  dispararError(msg: string): void {
    this.errorMsg.set(msg);
    this.shake.set(true);
    setTimeout(() => this.shake.set(false), 500);
    this.pin.set('');
    this.validando.set(false);
  }

  desbloquearComoAdmin(): void {
    this.authService.desbloquearComoAdmin();
    this.pin.set('');
    this.errorMsg.set('');
  }
}
