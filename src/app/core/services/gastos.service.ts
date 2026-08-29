import { Injectable, signal, computed } from '@angular/core';
import { Gasto } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { SucursalesService } from './sucursales.service';
import { SyncService } from './sync.service';
import { onSnapshot, Unsubscribe } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { collectionStream$ } from '../utils/realtime.util';
import { generarSiguienteConsecutivo } from '../utils/consecutivo.util';

import { BitacoraService } from './bitacora.service';

@Injectable({
  providedIn: 'root'
})
export class GastosService {
  private gastosSignal = signal<Gasto[]>([]);
  public gastos = this.gastosSignal.asReadonly();

  public gastosRecientes = computed(() => {
    return [...this.gastosSignal()]
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .slice(0, 15);
  });

  public totalGastosHoy = computed(() => {
    const hoyInicio = new Date().setHours(0, 0, 0, 0);
    return this.gastosSignal()
      .filter((g) => new Date(g.fecha).getTime() >= hoyInicio)
      .reduce((acc, g) => acc + (g.monto || 0), 0);
  });

  private subLive?: Subscription;

  constructor(
    private firestoreService: FirestoreChunksService,
    private sucursalesService: SucursalesService,
    private syncService: SyncService,
    private bitacoraService: BitacoraService
  ) {}

  setGastos(list: Gasto[]): void {
    if (Array.isArray(list)) {
      this.gastosSignal.set(list);
    }
  }

  async cargarGastos(): Promise<Gasto[]> {
    const list = await this.firestoreService.cargarColeccionChunked<Gasto>('gastos');
    this.gastosSignal.set(list);
    return list;
  }

  async registrarGasto(gasto: Omit<Gasto, 'id' | 'fecha' | 'sucursalId' | 'sucursalNombre'>): Promise<Gasto> {
    const sucursal = this.sucursalesService.sucursalActiva();
    const nuevoId = generarSiguienteConsecutivo(this.gastosSignal().map((g) => g.id), 'G', 4);

    const nuevoGasto: Gasto = {
      ...gasto,
      id: nuevoId,
      fecha: new Date().toISOString(),
      sucursalId: sucursal.id,
      sucursalNombre: sucursal.nombre
    };

    const current = [nuevoGasto, ...this.gastosSignal()];
    this.gastosSignal.set(current);

    try {
      this.syncService.setStatus('saving', 'Registrando gasto...');
      await this.firestoreService.guardarColeccionChunked('gastos', current);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      // Registrar en Bitácora
      await this.bitacoraService.registrarEvento({
        modulo: 'GASTOS',
        accion: 'CREAR',
        descripcion: `Gasto #${nuevoGasto.id} registrado: "${nuevoGasto.concepto}" por $${nuevoGasto.monto.toFixed(2)} (${nuevoGasto.categoria})`,
        detalles: nuevoGasto,
        sucursalId: sucursal.id,
        sucursalNombre: sucursal.nombre
      });
    } catch (e) {
      console.warn('Error al persistir gasto en Firestore:', e);
    }

    return nuevoGasto;
  }

  async eliminarGasto(id: string): Promise<void> {
    const gastoEliminado = this.gastosSignal().find((g) => g.id === id);
    const current = this.gastosSignal().filter((g) => g.id !== id);
    this.gastosSignal.set(current);

    try {
      this.syncService.setStatus('saving', 'Eliminando gasto...');
      await this.firestoreService.guardarColeccionChunked('gastos', current);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      if (gastoEliminado) {
        await this.bitacoraService.registrarEvento({
          modulo: 'GASTOS',
          accion: 'ELIMINAR',
          descripcion: `Gasto #${id} eliminado: "${gastoEliminado.concepto}" ($${gastoEliminado.monto.toFixed(2)})`,
          detalles: gastoEliminado,
          sucursalId: gastoEliminado.sucursalId,
          sucursalNombre: gastoEliminado.sucursalNombre
        });
      }
    } catch (e) {
      console.warn('Error al eliminar gasto en Firestore:', e);
    }
  }

  iniciarEscuchadorLive(): void {
    if (this.subLive) this.subLive.unsubscribe();

    const chunksCollRef = this.firestoreService.getRefColeccion('chunks_gastos');
    this.subLive = collectionStream$(chunksCollRef).subscribe({
      next: (snapshot) => {
        if (!snapshot.empty) {
          const chunkDocs = snapshot.docs
            .filter((d) => d.id.startsWith('chunk_'))
            .sort((a, b) => {
              const idxA = parseInt(a.id.replace('chunk_', ''), 10) || 0;
              const idxB = parseInt(b.id.replace('chunk_', ''), 10) || 0;
              return idxA - idxB;
            });

          const actualizados: Gasto[] = [];
          chunkDocs.forEach((d) => {
            const data = d.data();
            if (Array.isArray(data['items'])) {
              actualizados.push(...data['items']);
            }
          });

          if (actualizados.length > 0) {
            this.gastosSignal.set(actualizados);
          }
        }
      },
      error: (err) => console.error('Error en stream de gastos:', err)
    });
  }
}
