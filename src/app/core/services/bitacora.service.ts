import { Injectable, signal, inject } from '@angular/core';
import { BitacoraEvento, ModuloBitacora, TipoAccionBitacora } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { SyncService } from './sync.service';
import { SucursalesService } from './sucursales.service';
import { AuthService } from './auth.service';
import { getDoc, setDoc } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { docStream$ } from '../utils/realtime.util';
import { generarSiguienteConsecutivo } from '../utils/consecutivo.util';

@Injectable({
  providedIn: 'root'
})
export class BitacoraService {
  private eventosSignal = signal<BitacoraEvento[]>([]);
  public eventos = this.eventosSignal.asReadonly();

  private subLiveDoc?: Subscription;
  private firestoreService = inject(FirestoreChunksService);
  private syncService = inject(SyncService);
  private sucursalesService = inject(SucursalesService);
  private authService = inject(AuthService);

  async cargarBitacora(): Promise<BitacoraEvento[]> {
    try {
      const docRef = this.firestoreService.getRefDocConfig('bitacoraReciente');
      const snap = await getDoc(docRef);
      if (snap.exists() && Array.isArray(snap.data()['items']) && snap.data()['items'].length > 0) {
        const list = snap.data()['items'] as BitacoraEvento[];
        this.eventosSignal.set(list);
        return list;
      }
    } catch (_) {}

    const rawList = await this.firestoreService.cargarColeccionChunked<BitacoraEvento>('bitacora');
    this.eventosSignal.set(rawList);
    return rawList;
  }

  iniciarEscuchadorLive(): void {
    if (this.subLiveDoc) this.subLiveDoc.unsubscribe();

    const docRef = this.firestoreService.getRefDocConfig('bitacoraReciente');
    this.subLiveDoc = docStream$(docRef).subscribe({
      next: (snap) => {
        if (snap.exists() && Array.isArray(snap.data()['items'])) {
          const items = snap.data()['items'] as BitacoraEvento[];
          if (items.length > 0) {
            this.eventosSignal.set(items);
          }
        }
      },
      error: (err) => console.error('Error en stream de bitácora:', err)
    });
  }

  setEventos(list: BitacoraEvento[]): void {
    if (Array.isArray(list)) {
      this.eventosSignal.set(list);
    }
  }

  /**
   * Registra un evento de auditoría en memoria y lo sincroniza con Firestore de forma asíncrona y segura.
   */
  async registrarEvento(params: {
    modulo: ModuloBitacora;
    accion: TipoAccionBitacora;
    descripcion: string;
    detalles?: any;
    nivel?: 'INFO' | 'WARNING' | 'DANGER' | 'SUCCESS';
    sucursalId?: string;
    sucursalNombre?: string;
    usuario?: string;
  }): Promise<BitacoraEvento> {
    const sucursalActiva = this.sucursalesService.sucursalActiva();
    const sucId = params.sucursalId || sucursalActiva?.id || 'SUC-MAIN';
    const sucNom = params.sucursalNombre || sucursalActiva?.nombre || 'Matriz Principal';
    const usuarioActual = params.usuario || this.authService.currentUser()?.email || 'Usuario POS';
    const dispositivo = this.syncService.getNombreDispositivoLocal();

    const nuevoId = generarSiguienteConsecutivo(
      this.eventosSignal().map((e) => e.id),
      'BIT',
      4
    );

    let nivel = params.nivel;
    if (!nivel) {
      if (params.accion === 'ELIMINAR' || params.accion === 'RESET' || params.accion === 'CANCELAR') {
        nivel = 'DANGER';
      } else if (params.accion === 'EDITAR' || params.accion === 'AJUSTE' as any) {
        nivel = 'WARNING';
      } else if (params.accion === 'CREAR' || params.accion === 'LIQUIDACION' || params.accion === 'ABONO') {
        nivel = 'SUCCESS';
      } else {
        nivel = 'INFO';
      }
    }

    const nuevoEvento: BitacoraEvento = {
      id: nuevoId,
      fecha: new Date().toISOString(),
      modulo: params.modulo,
      accion: params.accion,
      descripcion: params.descripcion,
      detalles: params.detalles ? this.firestoreService.sanitizarParaFirestore(params.detalles) : null,
      usuario: usuarioActual,
      dispositivo,
      sucursalId: sucId,
      sucursalNombre: sucNom,
      nivel
    };

    // Mantener los eventos más recientes en memoria (máximo 500 para rendimiento de renderizado)
    const current = [nuevoEvento, ...this.eventosSignal()].slice(0, 500);
    this.eventosSignal.set(current);

    // Persistir asíncronamente en segundo plano
    this.persistirEvento(current).catch((err) =>
      console.warn('Error no bloqueante al registrar evento en bitácora:', err)
    );

    return nuevoEvento;
  }

  private async persistirEvento(eventos: BitacoraEvento[]): Promise<void> {
    try {
      const docRef = this.firestoreService.getRefDocConfig('bitacoraReciente');
      const sanitizados = this.firestoreService.sanitizarParaFirestore(eventos);

      await Promise.all([
        this.firestoreService.guardarColeccionChunked('bitacora', sanitizados),
        setDoc(docRef, {
          items: sanitizados.slice(0, 150), // Los últimos 150 para carga ultrarrápida
          total: sanitizados.length,
          actualizadoEn: new Date().toISOString()
        }, { merge: true })
      ]);
    } catch (e) {
      console.warn('Error al persistir bitácora en Firestore:', e);
    }
  }

  async limpiarBitacora(): Promise<void> {
    this.eventosSignal.set([]);
    try {
      await this.firestoreService.guardarColeccionChunked('bitacora', []);
      await setDoc(this.firestoreService.getRefDocConfig('bitacoraReciente'), {
        items: [],
        total: 0,
        actualizadoEn: new Date().toISOString()
      });
    } catch (_) {}
  }
}
