import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';
import { TicketSoporte, MensajeTicket } from '../models/models';
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  arrayUnion,
  Unsubscribe
} from 'firebase/firestore';

@Injectable({
  providedIn: 'root'
})
export class SoporteService {
  private fb = inject(FirebaseService);
  private authService = inject(AuthService);

  // Tickets globales para SuperAdmin
  private ticketsSignal = signal<TicketSoporte[]>([]);
  public tickets = this.ticketsSignal.asReadonly();

  // Tickets propios de la empresa cliente actual
  private ticketsEmpresaSignal = signal<TicketSoporte[]>([]);
  public ticketsEmpresa = this.ticketsEmpresaSignal.asReadonly();

  public cargando = signal<boolean>(false);

  private unsubscribeAdminListener: Unsubscribe | null = null;
  private unsubscribeEmpresaListener: Unsubscribe | null = null;
  private prevCount = 0;

  // Tickets pendientes o en proceso (SuperAdmin)
  public ticketsAbiertos = computed(() => {
    return this.ticketsSignal().filter(t => t.estado === 'ABIERTO' || t.estado === 'EN_PROCESO');
  });

  public conteoAbiertos = computed(() => this.ticketsAbiertos().length);

  public conteoNuevos = computed(() => {
    return this.ticketsSignal().filter(t => t.estado === 'ABIERTO').length;
  });

  // Conteo de tickets no resueltos para el cliente actual
  public conteoTicketsActivosEmpresa = computed(() => {
    return this.ticketsEmpresaSignal().filter(t => t.estado === 'ABIERTO' || t.estado === 'EN_PROCESO').length;
  });

  constructor() {
    // Escuchar automáticamente según el rol del usuario
    effect(() => {
      const user = this.authService.currentUser();
      const esAdmin = this.authService.esSuperAdmin();
      const tenantId = this.authService.getTenantId();

      if (esAdmin) {
        this.detenerEscuchaEmpresa();
        this.iniciarEscuchaTicketsAdmin();
      } else if (user && tenantId) {
        this.detenerEscuchaAdmin();
        this.iniciarEscuchaTicketsEmpresa(tenantId);
      } else {
        this.detenerEscuchaAdmin();
        this.detenerEscuchaEmpresa();
      }
    });
  }

  /**
   * Inicia la escucha en tiempo real de todos los tickets generados (SuperAdmin)
   */
  public iniciarEscuchaTicketsAdmin(): void {
    if (this.unsubscribeAdminListener) return;

    this.cargando.set(true);
    const colRef = collection(this.fb.firestore, 'tickets_soporte');
    const q = query(colRef, orderBy('fechaCreacion', 'desc'));

    this.unsubscribeAdminListener = onSnapshot(
      q,
      (snapshot) => {
        const list: TicketSoporte[] = [];
        snapshot.forEach((d) => {
          list.push({ ...d.data(), id: d.id } as TicketSoporte);
        });

        // Detectar si entró un ticket nuevo para emitir alerta sonora sutil
        if (this.prevCount > 0 && list.length > this.prevCount) {
          this.reproducirAlerta();
        }
        this.prevCount = list.length;

        this.ticketsSignal.set(list);
        this.cargando.set(false);
      },
      (error) => {
        console.error('Error al escuchar tickets de soporte en tiempo real:', error);
        this.cargando.set(false);
      }
    );
  }

  /**
   * Inicia la escucha en tiempo real de los tickets pertenecientes a la empresa logueada
   */
  public iniciarEscuchaTicketsEmpresa(empresaId: string): void {
    if (!empresaId) return;
    if (this.unsubscribeEmpresaListener) {
      this.unsubscribeEmpresaListener();
      this.unsubscribeEmpresaListener = null;
    }

    const colRef = collection(this.fb.firestore, 'tickets_soporte');
    const q = query(colRef, where('empresaId', '==', empresaId));

    this.unsubscribeEmpresaListener = onSnapshot(
      q,
      (snapshot) => {
        const list: TicketSoporte[] = [];
        snapshot.forEach((d) => {
          list.push({ ...d.data(), id: d.id } as TicketSoporte);
        });
        // Ordenar en memoria por fecha de creación descendente
        list.sort((a, b) => {
          const tA = new Date(a.fechaCreacion || 0).getTime();
          const tB = new Date(b.fechaCreacion || 0).getTime();
          return tB - tA;
        });
        this.ticketsEmpresaSignal.set(list);
      },
      (error) => {
        console.error('Error al escuchar tickets de la empresa:', error);
      }
    );
  }

  public detenerEscuchaAdmin(): void {
    if (this.unsubscribeAdminListener) {
      this.unsubscribeAdminListener();
      this.unsubscribeAdminListener = null;
    }
    this.ticketsSignal.set([]);
    this.prevCount = 0;
  }

  public detenerEscuchaEmpresa(): void {
    if (this.unsubscribeEmpresaListener) {
      this.unsubscribeEmpresaListener();
      this.unsubscribeEmpresaListener = null;
    }
    this.ticketsEmpresaSignal.set([]);
  }

  public detenerEscucha(): void {
    this.detenerEscuchaAdmin();
    this.detenerEscuchaEmpresa();
  }

  /**
   * Envía un mensaje tipo chat dentro del ticket, permitiendo adjuntar imagen y actualizar estado
   */
  async enviarMensajeTicket(
    folio: string,
    datos: {
      texto: string;
      imagenUrl?: string;
      remitenteRol: 'SUPERADMIN' | 'CLIENTE';
      remitenteNombre: string;
      remitenteUid: string;
    },
    nuevoEstado?: TicketSoporte['estado']
  ): Promise<void> {
    const docRef = doc(this.fb.firestore, 'tickets_soporte', folio);

    // Validación: El cliente no puede enviar mensajes a tickets cerrados
    if (datos.remitenteRol === 'CLIENTE') {
      const ticketLocal = this.ticketsEmpresaSignal().find(t => t.folio === folio);
      if (ticketLocal && ticketLocal.estado === 'CERRADO') {
        throw new Error('El ticket se encuentra cerrado y no admite más mensajes.');
      }
    }

    const nuevoMsg: MensajeTicket = {
      id: 'MSG-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      remitenteUid: datos.remitenteUid,
      remitenteNombre: datos.remitenteNombre,
      remitenteRol: datos.remitenteRol,
      texto: datos.texto.trim(),
      imagenUrl: datos.imagenUrl || '',
      fecha: new Date().toISOString()
    };

    const updatePayload: any = {
      mensajes: arrayUnion(nuevoMsg),
      ultimaActualizacion: new Date().toISOString()
    };

    if (nuevoEstado) {
      updatePayload.estado = nuevoEstado;
    }

    if (datos.remitenteRol === 'SUPERADMIN') {
      updatePayload.respuestaAdmin = datos.texto.trim();
      updatePayload.fechaRespuesta = nuevoMsg.fecha;
    }

    await updateDoc(docRef, updatePayload);
  }

  /**
   * Actualiza el estado del ticket y opcionalmente guarda una nota o respuesta administrativa
   */
  async actualizarEstadoTicket(
    folio: string,
    nuevoEstado: TicketSoporte['estado'],
    respuestaAdmin?: string
  ): Promise<void> {
    const docRef = doc(this.fb.firestore, 'tickets_soporte', folio);
    const dataUpdate: Partial<TicketSoporte> = {
      estado: nuevoEstado,
      ultimaActualizacion: new Date().toISOString()
    };

    if (respuestaAdmin !== undefined && respuestaAdmin.trim() !== '') {
      dataUpdate.respuestaAdmin = respuestaAdmin.trim();
      dataUpdate.fechaRespuesta = new Date().toISOString();
    }

    await updateDoc(docRef, dataUpdate as any);
  }

  /**
   * Elimina permanentemente un ticket de soporte (SuperAdmin)
   */
  async eliminarTicket(folio: string): Promise<void> {
    const docRef = doc(this.fb.firestore, 'tickets_soporte', folio);
    await deleteDoc(docRef);
  }

  /**
   * Genera el enlace directo a WhatsApp para responder y dar seguimiento al cliente
   */
  generarEnlaceWhatsApp(ticket: TicketSoporte): string {
    let tel = (ticket.telefono || '').replace(/\D/g, '');
    if (!tel) return '';

    // Si tiene 10 dígitos (México), anteponer 52
    if (tel.length === 10) {
      tel = '52' + tel;
    }

    const texto = `Hola ${ticket.usuarioNombre || 'Cliente'}, te contacto de Soporte Técnico del Sistema de Ventas en relación a tu solicitud *#${ticket.folio}* para el negocio *${ticket.nombreNegocio}*. Cuéntanos, ¿cómo podemos apoyarte a resolverlo?`;

    return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
  }

  /**
   * Activa el modo soporte para inspeccionar la cuenta y datos de la empresa de dicho ticket
   */
  darSeguimientoEnEmpresa(ticket: TicketSoporte): void {
    const negocio = ticket.nombreNegocio || 'este negocio';
    const conf = confirm(
      `¿Deseas ingresar a la cuenta de "${negocio}" (Ticket #${ticket.folio}) en Modo Soporte?\n\nPodrás inspeccionar su inventario, ventas, gastos, pedidos y configuración para diagnosticar el problema reportado.`
    );
    if (!conf) return;

    this.authService.entrarModoSoporte(ticket.empresaId, negocio);
  }

  private reproducirAlerta(): void {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch {
      // Audio no permitido o silenciado
    }
  }
}
