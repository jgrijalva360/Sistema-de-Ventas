import { Injectable, signal, computed, inject } from '@angular/core';
import { SuscripcionEmpresa, PlanSuscripcion, EstadoSuscripcion } from '../models/models';
import { FirebaseService } from './firebase.service';
import { MercadoPagoService } from './mercado-pago.service';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { docStream$ } from '../utils/realtime.util';

@Injectable({
  providedIn: 'root'
})
export class SuscripcionService {
  private fb = inject(FirebaseService);
  private mpService = inject(MercadoPagoService);

  private suscripcionSignal = signal<SuscripcionEmpresa | null>(null);
  public suscripcion = this.suscripcionSignal.asReadonly();

  // Límites computados dinámicamente según el plan y catálogo actualizado
  public limites = computed(() => {
    const sub = this.suscripcionSignal();
    const planId = sub?.plan || 'TRIAL';

    const planCatalogo = this.mpService.planesDisponibles().find(p => p.id === planId);
    if (planCatalogo) {
      return {
        maxUsuarios: planCatalogo.maxUsuarios || (planId === 'TRIAL' ? 2 : 2),
        maxSucursales: planCatalogo.maxSucursales || 1,
        maxProductos: planCatalogo.maxProductos || (planId === 'TRIAL' ? 100 : (planId === 'BASICO' ? 200 : (planId === 'PRO' ? 1000 : 10000))),
        nombre: planCatalogo.titulo
      };
    }

    if (planId === 'TRIAL') {
      return { maxUsuarios: 2, maxSucursales: 1, maxProductos: 100, nombre: 'Período de Prueba' };
    }

    switch (planId) {
      case 'BASICO':
        return { maxUsuarios: 2, maxSucursales: 1, maxProductos: 200, nombre: 'Plan Básico' };
      case 'PRO':
        return { maxUsuarios: 6, maxSucursales: 3, maxProductos: 1000, nombre: 'Plan Pro' };
      case 'ENTERPRISE':
        return { maxUsuarios: 99, maxSucursales: 10, maxProductos: 10000, nombre: 'Plan Anual VIP' };
      default:
        return { maxUsuarios: 2, maxSucursales: 1, maxProductos: 100, nombre: 'Período de Prueba' };
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

  public puedeCrearProducto(cantidadActual: number): { permitido: boolean; mensaje?: string } {
    const max = this.limites().maxProductos;
    if (cantidadActual >= max) {
      return {
        permitido: false,
        mensaje: `Has alcanzado el límite máximo de ${max.toLocaleString()} productos / registros permitidos en tu ${this.limites().nombre}. Mejora tu plan para ampliar tu catálogo.`
      };
    }
    return { permitido: true };
  }

  private subLive?: Subscription;

  constructor() { }

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
   * Valida y canjea un código de activación / promocional en Firestore
   */
  async activarConCodigo(empresaId: string, codigo: string): Promise<boolean> {
    const cod = (codigo || '').trim().toUpperCase();
    if (!cod) throw new Error('Ingresa un código.');

    const { collection, getDocs, query, where, updateDoc } = await import('firebase/firestore');

    // 1. Buscar en la colección de códigos promocionales dinámicos
    const codRef = doc(this.fb.firestore, 'codigos_promocionales', cod);
    const snap = await getDoc(codRef);

    if (snap.exists()) {
      const data = snap.data() as import('../models/models').CodigoPromocional;

      if (!data.activo) {
        throw new Error('Este código promocional ha sido desactivado.');
      }

      if (data.expiraEn && new Date(data.expiraEn).getTime() < Date.now()) {
        throw new Error('Este código promocional ya expiró.');
      }

      if (data.usosMaximos > 0 && (data.usosActuales || 0) >= data.usosMaximos) {
        throw new Error('Este código ya alcanzó el límite máximo de usos.');
      }

      const empresasUsadas = data.empresasQueCanjearon || [];
      if (empresasUsadas.includes(empresaId)) {
        throw new Error('Tu empresa ya ha utilizado este código promocional anteriormente.');
      }

      // Aplicar días a la empresa
      const dias = data.diasOtorgados || 30;
      await this.modificarVigenciaManual(empresaId, dias, data.planAsignado || 'PRO', 'ACTIVA');

      // Incrementar uso del código
      empresasUsadas.push(empresaId);
      await updateDoc(codRef, {
        usosActuales: (data.usosActuales || 0) + 1,
        empresasQueCanjearon: empresasUsadas,
        actualizadoEn: new Date().toISOString()
      });

      return true;
    }

    // 2. Códigos estáticos universales de respaldo
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

  // ── Métodos para el Super Administrador (Master SaaS) ─────────────

  /**
   * Obtiene la lista completa de códigos promocionales creados
   */
  async listarCodigosPromocionales(): Promise<import('../models/models').CodigoPromocional[]> {
    const { collection, getDocs } = await import('firebase/firestore');
    const colRef = collection(this.fb.firestore, 'codigos_promocionales');
    const snap = await getDocs(colRef);
    const list: import('../models/models').CodigoPromocional[] = [];
    snap.forEach((d) => {
      list.push({ ...d.data(), id: d.id } as import('../models/models').CodigoPromocional);
    });
    return list;
  }

  /**
   * Crea o actualiza un código promocional en Firestore
   */
  async guardarCodigoPromocional(codigoData: import('../models/models').CodigoPromocional): Promise<void> {
    const codigoUpper = codigoData.codigo.trim().toUpperCase();
    const codRef = doc(this.fb.firestore, 'codigos_promocionales', codigoUpper);
    await setDoc(codRef, {
      ...codigoData,
      codigo: codigoUpper,
      actualizadoEn: new Date().toISOString()
    }, { merge: true });
  }

  /**
   * Elimina un código promocional
   */
  async eliminarCodigoPromocional(codigo: string): Promise<void> {
    const { deleteDoc } = await import('firebase/firestore');
    const codRef = doc(this.fb.firestore, 'codigos_promocionales', codigo.trim().toUpperCase());
    await deleteDoc(codRef);
  }

  /**
   * Obtiene la lista completa de empresas clientes registradas en la plataforma
   */
  async listarTodasEmpresas(): Promise<SuscripcionEmpresa[]> {
    const { collection, getDocs } = await import('firebase/firestore');
    const colRef = collection(this.fb.firestore, 'suscripciones');
    const snap = await getDocs(colRef);
    const list: SuscripcionEmpresa[] = [];
    snap.forEach((d) => {
      list.push(d.data() as SuscripcionEmpresa);
    });
    return list;
  }

  /**
   * Extiende o reduce días manualmente a cualquier empresa cliente
   */
  async modificarVigenciaManual(
    empresaId: string,
    diasSumar: number,
    nuevoPlan?: PlanSuscripcion,
    nuevoEstado?: EstadoSuscripcion,
    nombreNegocio?: string
  ): Promise<void> {
    const subRef = doc(this.fb.firestore, 'suscripciones', empresaId);
    const snap = await getDoc(subRef);
    if (!snap.exists()) throw new Error('La empresa no existe');

    const data = snap.data() as SuscripcionEmpresa;
    let base = new Date();
    const actualFin = new Date(data.fechaVencimiento || 0);

    if (actualFin.getTime() > base.getTime()) {
      base = actualFin;
    }

    base.setDate(base.getDate() + diasSumar);

    const updatePayload: Partial<SuscripcionEmpresa> = {
      fechaVencimiento: base.toISOString(),
      estado: nuevoEstado || (base.getTime() > Date.now() ? 'ACTIVA' : 'VENCIDA'),
      actualizadoEn: new Date().toISOString()
    };

    if (nuevoPlan) {
      updatePayload.plan = nuevoPlan;
    }

    if (nombreNegocio !== undefined && nombreNegocio.trim()) {
      updatePayload.nombreNegocio = nombreNegocio.trim();
    }

    await setDoc(subRef, updatePayload, { merge: true });
  }

  /**
   * Elimina completamente un negocio de la plataforma:
   * 1. Elimina todos los colaboradores y administradores de la colección 'usuarios'
   * 2. Elimina todos los tickets de soporte pertenecientes a este negocio
   * 3. Elimina todas las subcolecciones y documentos operativos bajo /sistema/{empresaId}/...
   * 4. Elimina el documento raíz /sistema/{empresaId}
   * 5. Elimina el registro de suscripción /suscripciones/{empresaId}
   */
  async eliminarEmpresaCompleta(empresaId: string): Promise<void> {
    if (!empresaId || !empresaId.trim()) {
      throw new Error('ID de negocio no válido.');
    }

    const { collection, getDocs, deleteDoc, doc, query, where, writeBatch } = await import('firebase/firestore');

    // 1. Eliminar usuarios asociados a este negocio
    try {
      const usersCol = collection(this.fb.firestore, 'usuarios');
      const qUsers = query(usersCol, where('empresaId', '==', empresaId));
      const usersSnap = await getDocs(qUsers);
      
      const userDocRefs = new Map<string, any>();
      usersSnap.docs.forEach((d) => userDocRefs.set(d.id, d.ref));

      // Si el id de la empresa es el uid del dueño/creador, asegurarse de incluirlo
      const ownerDocRef = doc(this.fb.firestore, 'usuarios', empresaId);
      userDocRefs.set(empresaId, ownerDocRef);

      const allRefs = Array.from(userDocRefs.values());
      for (let i = 0; i < allRefs.length; i += 400) {
        const batch = writeBatch(this.fb.firestore);
        const slice = allRefs.slice(i, i + 400);
        slice.forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
    } catch (err) {
      console.warn('Aviso al eliminar usuarios del negocio:', err);
    }

    // 2. Eliminar tickets de soporte
    try {
      const ticketsCol = collection(this.fb.firestore, 'tickets_soporte');
      const qTickets = query(ticketsCol, where('empresaId', '==', empresaId));
      const ticketsSnap = await getDocs(qTickets);
      if (!ticketsSnap.empty) {
        const docs = ticketsSnap.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = writeBatch(this.fb.firestore);
          const slice = docs.slice(i, i + 400);
          slice.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
    } catch (err) {
      console.warn('Aviso al eliminar tickets de soporte:', err);
    }

    // 3. Eliminar todas las subcolecciones operativas de /sistema/{empresaId}/...
    const subcolecciones = [
      'chunks_productos',
      'chunks_ventas',
      'chunks_movimientos',
      'chunks_gastos',
      'chunks_cortes',
      'chunks_pedidos',
      'chunks_bitacora',
      'config',
      'productos',
      'ventas',
      'movimientos',
      'gastos',
      'cortes',
      'pedidos',
      'bitacora',
      'sucursales',
      'clientes',
      'auditoria'
    ];

    for (const nomCol of subcolecciones) {
      try {
        const collRef = collection(this.fb.firestore, 'sistema', empresaId, nomCol);
        const snap = await getDocs(collRef);
        if (!snap.empty) {
          const docs = snap.docs;
          for (let i = 0; i < docs.length; i += 400) {
            const batch = writeBatch(this.fb.firestore);
            const slice = docs.slice(i, i + 400);
            slice.forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
        }
      } catch (err) {
        console.warn(`Aviso al vaciar subcolección ${nomCol}:`, err);
      }
    }

    // 4. Eliminar documento raíz /sistema/{empresaId}
    try {
      const docSistema = doc(this.fb.firestore, 'sistema', empresaId);
      await deleteDoc(docSistema);
    } catch (err) {
      console.warn('Aviso al eliminar nodo raíz en sistema:', err);
    }

    // 5. Eliminar documento de suscripción /suscripciones/{empresaId}
    try {
      const docSub = doc(this.fb.firestore, 'suscripciones', empresaId);
      await deleteDoc(docSub);
    } catch (err) {
      console.error('Error al eliminar registro de suscripción:', err);
      throw err;
    }
  }
}
