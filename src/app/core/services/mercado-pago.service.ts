import { Injectable, signal } from '@angular/core';
import { PlanCatalogo, SuscripcionEmpresa } from '../models/models';
import { environment } from '../../../environments/environment';
import { FirebaseService } from './firebase.service';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { docStream$ } from '../utils/realtime.util';
import { Subscription } from 'rxjs';

export const DEFAULT_PLANES: PlanCatalogo[] = [
  {
    id: 'BASICO',
    titulo: 'Plan Básico',
    subtitulo: 'Ideal para pequeños negocios o emprendedores iniciando.',
    precio: 299,
    moneda: 'MXN',
    periodo: 'MENSUAL',
    meses: 1,
    destacado: false,
    maxUsuarios: 2,
    maxSucursales: 1,
    caracteristicas: [
      'Hasta 2 usuarios (Cajeros/Admin)',
      '1 Sucursal',
      'Ventas en Vivo & POS ilimitado',
      'Cortes de caja y arqueos',
      'Inventario y catálogo de productos',
      'Soporte técnico por WhatsApp'
    ]
  },
  {
    id: 'PRO',
    titulo: 'Plan Pro',
    subtitulo: 'Para negocios en crecimiento con múltiples colaboradores y sucursales.',
    precio: 499,
    moneda: 'MXN',
    periodo: 'MENSUAL',
    meses: 1,
    destacado: true,
    maxUsuarios: 6,
    maxSucursales: 3,
    caracteristicas: [
      'Hasta 6 usuarios y roles configurables',
      'Hasta 3 Sucursales interconectadas',
      'Gestión de Pedidos Personalizados y Abonos',
      'Reportes financieros y gráficos de utilidad',
      'Kardex y auditoría con Bitácora en vivo',
      'Respaldos automáticos en la nube',
      'Soporte prioritario'
    ]
  },
  {
    id: 'ENTERPRISE',
    titulo: 'Plan Anual VIP',
    subtitulo: 'Máximo ahorro (2 meses gratis) y capacidad ilimitada.',
    precio: 4990,
    moneda: 'MXN',
    periodo: 'ANUAL',
    meses: 12,
    destacado: false,
    maxUsuarios: 99,
    maxSucursales: 10,
    caracteristicas: [
      'Usuarios y Cajeros ILIMITADOS',
      'Hasta 10 Sucursales',
      'Ahorra 2 meses de suscripción anual',
      'Capacitación y asesoría personalizada',
      'Todas las funciones del Plan Pro incluidas',
      'Acceso prioritario a nuevas versiones'
    ]
  }
];

@Injectable({
  providedIn: 'root'
})
export class MercadoPagoService {
  private publicKey = environment.mercadoPago.publicKey;
  private moneda = environment.mercadoPago.moneda || 'MXN';

  // Catálogo oficial de Planes SaaS configurables y sincronizados en tiempo real
  public planesDisponibles = signal<PlanCatalogo[]>(DEFAULT_PLANES);

  private subLive?: Subscription;

  constructor(private fb: FirebaseService) {
    this.iniciarEscuchadorPlanes();
  }

  iniciarEscuchadorPlanes(): void {
    if (this.subLive) this.subLive.unsubscribe();

    const planDocRef = doc(this.fb.firestore, 'sistema_global', 'planes_catalogo');
    this.subLive = docStream$(planDocRef).subscribe({
      next: (snap) => {
        if (snap.exists() && Array.isArray(snap.data()['items']) && snap.data()['items'].length > 0) {
          this.planesDisponibles.set(snap.data()['items'] as PlanCatalogo[]);
        }
      },
      error: (e) => console.warn('Usando catálogo default de planes:', e)
    });
  }

  /**
   * Actualiza el catálogo oficial de planes en Firestore (Solo SuperAdmin)
   */
  async guardarPlanesCatalogo(planes: PlanCatalogo[]): Promise<void> {
    const planDocRef = doc(this.fb.firestore, 'sistema_global', 'planes_catalogo');
    await setDoc(planDocRef, {
      items: planes,
      actualizadoEn: new Date().toISOString()
    }, { merge: true });
    this.planesDisponibles.set(planes);
  }

  /**
   * Genera el payload de preferencia de pago y retorna la URL o ID de Checkout Pro.
   * Vincula la transacción al empresaId mediante external_reference.
   */
  async iniciarCheckoutPlan(plan: PlanCatalogo, suscripcion: SuscripcionEmpresa): Promise<string> {
    const origin = window.location.origin;
    const empresaId = suscripcion.empresaId;
    const email = suscripcion.contactoEmail || 'cliente@stockup.com';

    // Construcción de la preferencia para Mercado Pago Checkout Pro
    const preferenceData = {
      items: [
        {
          id: `PLAN-${plan.id}`,
          title: `Stockup POS: ${plan.titulo} (${plan.periodo === 'ANUAL' ? '12 Meses' : '1 Mes'})`,
          description: `Licencia de software de punto de venta Stockup para ${suscripcion.nombreNegocio}`,
          quantity: 1,
          currency_id: plan.moneda,
          unit_price: plan.precio
        }
      ],
      payer: {
        email: email,
        name: suscripcion.nombreNegocio
      },
      external_reference: `${empresaId}|${plan.id}|${plan.meses}`,
      back_urls: {
        success: `${origin}/suscripcion/pago-resultado?status=success&plan=${plan.id}&meses=${plan.meses}`,
        pending: `${origin}/suscripcion/pago-resultado?status=pending&plan=${plan.id}&meses=${plan.meses}`,
        failure: `${origin}/suscripcion/pago-resultado?status=failure`
      },
      auto_return: 'approved',
      statement_descriptor: 'STOCKUP POS'
    };

    console.log('[MercadoPagoService] Datos de preferencia listos:', preferenceData);

    // Llamada a la Cloud Function para generar la preferencia oficial de Mercado Pago
    const functionUrl = 'https://us-central1-sistemadeventas-d7877.cloudfunctions.net/crearPreferenciaPago';
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresaId,
        planId: plan.id,
        meses: plan.meses,
        precio: plan.precio,
        titulo: `${plan.titulo} (${plan.periodo === 'ANUAL' ? '12 Meses' : '1 Mes'})`,
        email,
        nombreNegocio: suscripcion.nombreNegocio,
        returnUrl: origin
      })
    });

    const data = await response.json();

    if (response.ok && data.init_point) {
      return data.init_point;
    }

    throw new Error(data.error || 'No se pudo generar la orden de pago en Mercado Pago.');
  }
}
