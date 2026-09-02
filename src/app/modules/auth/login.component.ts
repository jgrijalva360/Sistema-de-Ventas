import { Component, signal, inject, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink],
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
      await this.authService.login(this.email, this.password);
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      this.errorMessage.set('El correo o contraseña es incorrecto.');
    } finally {
      this.loading.set(false);
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
      this.router.navigate(['/dashboard']);
    } catch (err: any) {
      this.errorMessage.set('Error al registrar usuario.');
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
