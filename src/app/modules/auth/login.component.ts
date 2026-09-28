import { Component, signal, inject, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements AfterViewInit {
  @ViewChild('emailInputRef') emailInputRef?: ElementRef<HTMLInputElement>;

  public email = '';
  public password = '';
  public loading = signal<boolean>(false);
  public errorMessage = signal<string>('');
  public successMessage = signal<string>('');

  private authService = inject(AuthService);
  private router = inject(Router);

  ngAfterViewInit(): void {
    setTimeout(() => this.emailInputRef?.nativeElement.focus(), 100);
  }

  async onSubmit(): Promise<void> {
    if (!this.email || !this.password) return;
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      let emailFinal = this.email.trim();

      // Si el usuario no ingresó un '@', buscar si es una caja o colaborador por alias o nombre
      if (!emailFinal.includes('@')) {
        const emailEncontrado = await this.buscarEmailPorAliasONombre(emailFinal);
        if (emailEncontrado) {
          emailFinal = emailEncontrado;
        }
      }

      // Si la contraseña tiene 4 o 5 dígitos numéricos (como un PIN), puede estar paddeada a 6 caracteres en Firebase
      const passOriginal = this.password.trim();
      const passPadded = /^\d{4,5}$/.test(passOriginal) ? passOriginal.padEnd(6, '0') : passOriginal;

      let user;
      try {
        user = await this.authService.login(emailFinal, passOriginal);
      } catch (loginErr) {
        if (passPadded !== passOriginal) {
          // Reintentar con el PIN paddeado
          user = await this.authService.login(emailFinal, passPadded);
        } else {
          throw loginErr;
        }
      }

      const perfil = await this.authService.cargarPerfilUsuario(user);
      const esCuentaColaborador = perfil && (perfil.creadoPorAdmin || perfil.rol === 'CAJERO' || perfil.rol === 'ENCARGADO');

      if (!user.emailVerified && !this.authService.esSuperAdmin() && !esCuentaColaborador) {
        this.router.navigate(['/verificar-correo']);
      } else if (this.authService.esSuperAdmin() && !this.authService.estaEnModoSoporte()) {
        this.router.navigate(['/super-admin']);
      } else if (perfil?.rol === 'CAJERO') {
        this.router.navigate(['/ventas']);
      } else {
        this.router.navigate(['/dashboard']);
      }
    } catch (err: any) {
      this.errorMessage.set('El correo/usuario o contraseña es incorrecto.');
    } finally {
      this.loading.set(false);
    }
  }

  private async buscarEmailPorAliasONombre(termino: string): Promise<string | null> {
    try {
      const { collection, getDocs } = await import('firebase/firestore');
      const cleanTerm = termino.trim().toLowerCase();
      const colRef = collection(this.authService.fb.firestore, 'usuarios');
      const snap = await getDocs(colRef);
      for (const d of snap.docs) {
        const u = d.data() as any;
        if (u.activo === false) continue;
        const nombre = (u.nombre || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const alias = email.split('@')[0];
        if (nombre === cleanTerm || alias === cleanTerm) {
          return u.email;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  async onRegistrar(): Promise<void> {
    if (!this.email || !this.password) {
      this.errorMessage.set('Completa el correo y la contraseña (mínimo 6 caracteres).');
      return;
    }
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      await this.authService.register(this.email, this.password);
      this.router.navigate(['/verificar-correo']);
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Error al registrar usuario.');
    } finally {
      this.loading.set(false);
    }
  }

  async onForgotPassword(): Promise<void> {
    if (!this.email) {
      this.errorMessage.set('Ingresa tu correo para enviarte el enlace de restablecimiento.');
      return;
    }
    try {
      await this.authService.sendPasswordReset(this.email);
      this.successMessage.set(`📧 Se envió un enlace de restablecimiento a ${this.email}.`);
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Error al enviar correo.');
    }
  }
}
