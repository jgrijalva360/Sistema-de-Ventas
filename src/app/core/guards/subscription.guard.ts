import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { SuscripcionService } from '../services/suscripcion.service';

export const subscriptionGuard: CanActivateFn = async () => {
  const authService = inject(AuthService);
  const suscripcionService = inject(SuscripcionService);
  const router = inject(Router);

  await authService.waitForAuthReady();

  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  // Los SuperAdmin de la plataforma tienen bypass
  if (authService.rol() === 'SUPERADMIN') {
    return true;
  }

  if (suscripcionService.estaVencida()) {
    router.navigate(['/suscripcion-vencida']);
    return false;
  }

  return true;
};
