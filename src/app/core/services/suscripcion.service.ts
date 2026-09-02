import { Injectable, signal, computed } from '@angular/core';
import { SuscripcionEmpresa, PlanSuscripcion, EstadoSuscripcion } from '../models/models';
import { FirebaseService } from './firebase.service';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { docStream$ } from '../utils/realtime.util';

@Injectable({
  providedIn: 'root'
})
export class SuscripcionService {
  private suscripcionSignal = signal<SuscripcionEmpresa | null>(null);
  public suscripcion = this.suscripcionSignal.asReadonly();

  // Límites computados según el plan
  public limites = computed(() => {
    const sub = this.suscripcionSignal();
    const plan = sub?.plan || 'TRIAL';

    switch (plan) {
      case 'BASICO':
        return { maxUsuarios: 2, maxSucursales: 1, maxProductos: 500, nombre: 'Plan Básico' };
      case 'PRO':
        return { maxUsuarios: 6, maxSucursales: 3, maxProductos: 5000, nombre: 'Plan Pro' };
      case 'ENTERPRISE':
        return { maxUsuarios: 99, maxSucursales: 10, maxProductos: 50000, nombre: 'Plan Anual VIP' };
      case 'TRIAL':
      default:
        return { maxUsuarios: 5, maxSucursales: 3, maxProductos: 1000, nombre: 'Período de Prueba' };
    }
  });

  public diasRestantes = computed(() => {
    const s = this.suscripcionSignal();
    if (!s || !s.fechaVencimiento) return 0;
    const fin = new Date(s.fechaVencimiento).getTime();
    const ahora = new Date().getTime();
    const diffMs = fin - ahora;
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  });

  public estaVencida = computed(() => {
    const s = this.suscripcionSignal();
    if (!s) return false;
    if (s.estado === 'CANCELADA' || s.estado === 'VENCIDA') return true;
    const fin = new Date(s.fechaVencimiento).getTime();
    return new Date().getTime() > fin;
  });

  public estaPorVencer = computed(() => {
    const dias = this.diasRestantes();
    return !this.estaVencida() && dias <= 5;
  });

  public esTrial = computed(() => {
    return this.suscripcionSignal()?.plan === 'TRIAL' || this.suscripcionSignal()?.estado === 'PRUEBA';
  });

  public puedeCrearUsuario(cantidadActual: number): { permitido: boolean; mensaje?: string } {
    const max = this.limites().maxUsuarios;
    if (cantidadActual >= max) {
      return {
        permitido: false,
        mensaje: `Has alcanzado el límite máximo de ${max} usuario(s) permitidos en tu ${this.limites().nombre}. Mejora tu plan para agregar más colaboradores.`
      };
    }
    return { permitido: true };
  }

  public puedeCrearSucursal(cantidadActual: number): { permitido: boolean; mensaje?: string } {
    const max = this.limites().maxSucursales;
    if (cantidadActual >= max) {
      return {
        permitido: false,
        mensaje: `Has alcanzado el límite de ${max} sucursal(es) en tu ${this.limites().nombre}. Mejora tu plan para abrir más sucursales.`
      };
    }
    return { permitido: true };
  }

  private subLive?: Subscription;

  constructor(private fb: FirebaseService) {}

  /**
   * Obtiene o inicializa la suscripción de una empresa en Firestore.
   * Si no existe, genera 15 días de prueba gratuita (Trial).
   */
  async inicializarSuscripcion(empresaId: string, email: string, nombreNegocio = 'Mi Negocio'): Promise<SuscripcionEmpresa> {
    if (!empresaId) throw new Error('empresaId es requerido');

    const subRef = doc(this.fb.firestore, 'suscripciones', empresaId);
    const snap = await getDoc(subRef);

    if (snap.exists()) {
      const data = snap.data() as SuscripcionEmpresa;
      this.suscripcionSignal.set(data);
      return data;
    }

    // Crear suscripción Trial de 15 días por defecto
    const fechaInicio = new Date();
    const fechaVencimiento = new Date();
    fechaVencimiento.setDate(fechaInicio.getDate() + 15);

    const nuevaSub: SuscripcionEmpresa = {
      empresaId,
      nombreNegocio,
      contactoEmail: email,
      plan: 'TRIAL',
      estado: 'PRUEBA',
      fechaInicio: fechaInicio.toISOString(),
      fechaVencimiento: fechaVencimiento.toISOString(),
      diasPrueba: 15,
      limites: {
        maxUsuarios: 5,
        maxSucursales: 3
      },
      actualizadoEn: new Date().toISOString()
    };

    await setDoc(subRef, nuevaSub);
    this.suscripcionSignal.set(nuevaSub);
    return nuevaSub;
  }

  iniciarEscuchadorLive(empresaId: string): void {
    if (this.subLive) this.subLive.unsubscribe();
    if (!empresaId) return;

    const subRef = doc(this.fb.firestore, 'suscripciones', empresaId);
    this.subLive = docStream$(subRef).subscribe({
      next: (snap) => {
        if (snap.exists()) {
          this.suscripcionSignal.set(snap.data() as SuscripcionEmpresa);
        }
      },
      error: (err) => console.error('Error en stream de suscripción:', err)
    });
  }

  /**
   * Extiende o renueva la suscripción por X días o meses
   */
  async renovarSuscripcion(empresaId: string, meses: number, plan: PlanSuscripcion = 'PRO'): Promise<void> {
    const subRef = doc(this.fb.firestore, 'suscripciones', empresaId);
    const current = this.suscripcionSignal();

    const baseDate = (current && !this.estaVencida()) 
      ? new Date(current.fechaVencimiento)
      : new Date();

    baseDate.setMonth(baseDate.getMonth() + meses);

    const updated: Partial<SuscripcionEmpresa> = {
      plan,
      estado: 'ACTIVA',
      fechaVencimiento: baseDate.toISOString(),
      actualizadoEn: new Date().toISOString()
    };

    await setDoc(subRef, updated, { merge: true });
  }

  /**
   * Valida un código de activación manual/promocional
   */
  async activarConCodigo(empresaId: string, codigo: string): Promise<boolean> {
    const cod = (codigo || '').trim().toUpperCase();
    let meses = 0;
    let plan: PlanSuscripcion = 'BASICO';

    if (cod === 'PRO30' || cod === 'MES-PRO') {
      meses = 1;
      plan = 'PRO';
    } else if (cod === 'ANUAL-PRO' || cod === 'VIP365') {
      meses = 12;
      plan = 'ENTERPRISE';
    } else if (cod === 'TRIAL30') {
      meses = 1;
      plan = 'TRIAL';
    } else {
      throw new Error('Código de activación inválido o expirado.');
    }

    await this.renovarSuscripcion(empresaId, meses, plan);
    return true;
  }
}
