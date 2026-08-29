import { Injectable, signal, computed } from '@angular/core';
import { Sucursal } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { getDoc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { docStream$ } from '../utils/realtime.util';

export const DEFAULT_SUCURSALES: Sucursal[] = [
  {
    id: 'SUC-MAIN',
    nombre: 'Matriz Principal',
    direccion: 'Dirección Principal #100',
    telefono: '555-123-4567',
    esMatriz: true
  }
];

@Injectable({
  providedIn: 'root'
})
export class SucursalesService {
  private sucursalesSignal = signal<Sucursal[]>(DEFAULT_SUCURSALES);
  private activaIdSignal = signal<string>('SUC-MAIN');

  public sucursales = this.sucursalesSignal.asReadonly();
  public activaId = this.activaIdSignal.asReadonly();
  public sucursalActiva = computed(() => {
    const list = this.sucursalesSignal();
    const id = this.activaIdSignal();
    return list.find((s) => s.id === id) || list[0] || DEFAULT_SUCURSALES[0];
  });

  private subLive?: Subscription;

  constructor(private firestoreService: FirestoreChunksService) {
    const guardada = localStorage.getItem('sucursal_activa_id');
    if (guardada) this.activaIdSignal.set(guardada);
  }

  async cargarSucursales(): Promise<Sucursal[]> {
    try {
      const docRef = this.firestoreService.getRefDocConfig('sucursales');
      const snap = await getDoc(docRef);
      if (snap.exists() && Array.isArray(snap.data()['items']) && snap.data()['items'].length > 0) {
        const list = snap.data()['items'] as Sucursal[];
        this.setSucursales(list);
        return list;
      }
    } catch (_) {}
    return this.sucursalesSignal();
  }

  iniciarEscuchadorLive(): void {
    if (this.subLive) this.subLive.unsubscribe();

    const docRef = this.firestoreService.getRefDocConfig('sucursales');
    this.subLive = docStream$(docRef).subscribe({
      next: (docSnap) => {
        if (docSnap.exists() && Array.isArray(docSnap.data()['items']) && docSnap.data()['items'].length > 0) {
          this.setSucursales(docSnap.data()['items'] as Sucursal[]);
        }
      },
      error: (err) => console.error('Error en stream de sucursales:', err)
    });
  }

  setSucursales(list: Sucursal[]): void {
    if (Array.isArray(list) && list.length > 0) {
      this.sucursalesSignal.set(list);
      // Validar si la activa sigue existiendo
      if (!list.some((s) => s.id === this.activaIdSignal())) {
        this.cambiarSucursalActiva(list[0].id);
      }
    }
  }

  cambiarSucursalActiva(id: string): void {
    this.activaIdSignal.set(id);
    localStorage.setItem('sucursal_activa_id', id);
  }

  async agregarOEditarSucursal(sucursal: Sucursal): Promise<void> {
    const current = [...this.sucursalesSignal()];
    const idx = current.findIndex((s) => s.id === sucursal.id);
    if (idx >= 0) {
      current[idx] = sucursal;
    } else {
      current.push(sucursal);
    }
    this.sucursalesSignal.set(current);
    await this.guardarEnServidor();
  }

  async eliminarSucursal(id: string): Promise<void> {
    let current = this.sucursalesSignal().filter((s) => s.id !== id);
    if (current.length === 0) {
      current = [...DEFAULT_SUCURSALES];
    }
    this.sucursalesSignal.set(current);
    if (this.activaIdSignal() === id) {
      this.cambiarSucursalActiva(current[0].id);
    }
    await this.guardarEnServidor();
  }

  async guardarEnServidor(): Promise<void> {
    try {
      const docRef = this.firestoreService.getRefDocConfig('sucursales');
      await setDoc(docRef, {
        items: this.sucursalesSignal(),
        actualizadoEn: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.warn('Error al guardar sucursales en Firestore:', e);
    }
  }
}
