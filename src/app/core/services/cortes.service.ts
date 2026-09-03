import { Injectable, signal, computed } from '@angular/core';
import { Corte, CorteActivo } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { VentasService } from './ventas.service';
import { GastosService } from './gastos.service';
import { SucursalesService } from './sucursales.service';
import { SyncService } from './sync.service';
import { PedidosService } from './pedidos.service';
import { doc, getDoc, setDoc, deleteDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { Subscription } from 'rxjs';
import { docStream$, collectionStream$ } from '../utils/realtime.util';
import { generarSiguienteConsecutivo } from '../utils/consecutivo.util';

import { BitacoraService } from './bitacora.service';

@Injectable({
  providedIn: 'root'
})
export class CortesService {
  private corteActivoSignal = signal<CorteActivo | null>(null);
  private cortesHistorialSignal = signal<Corte[]>([]);

  public corteActivo = this.corteActivoSignal.asReadonly();
  public cortesHistorial = this.cortesHistorialSignal.asReadonly();

  public hayCorteAbierto = computed(() => !!this.corteActivoSignal());

  private subCorteActivo?: Subscription;
  private subCortesLive?: Subscription;

  constructor(
    private firestoreService: FirestoreChunksService,
    private ventasService: VentasService,
    private gastosService: GastosService,
    private sucursalesService: SucursalesService,
    private pedidosService: PedidosService,
    private syncService: SyncService,
    private bitacoraService: BitacoraService
  ) {}

  private ordenarCortes(lista: Corte[]): Corte[] {
    return [...lista].sort((a, b) => {
      const timeA = new Date(a.fechaCierre || a.fechaApertura || 0).getTime();
      const timeB = new Date(b.fechaCierre || b.fechaApertura || 0).getTime();
      return timeB - timeA;
    });
  }

  setCortes(list: Corte[], corteActivo?: CorteActivo | null): void {
    if (Array.isArray(list)) {
      this.cortesHistorialSignal.set(this.ordenarCortes(list));
    }
    if (corteActivo !== undefined) {
      this.corteActivoSignal.set(corteActivo);
    }
  }

  setCorteActivo(corteActivo: CorteActivo | null): void {
    this.corteActivoSignal.set(corteActivo);
  }

  async cargarCortes(): Promise<Corte[]> {
    try {
      const corteRef = this.firestoreService.getRefDocConfig('corteActivo');
      const snap = await getDoc(corteRef);
      if (snap.exists() && snap.data()['id']) {
        this.corteActivoSignal.set(snap.data() as CorteActivo);
      } else {
        this.corteActivoSignal.set(null);
      }
    } catch (e) {
      console.warn('Error al cargar corte activo:', e);
    }

    const list = await this.firestoreService.cargarColeccionChunked<Corte>('cortes');
    const ordenados = this.ordenarCortes(list);
    this.cortesHistorialSignal.set(ordenados);
    return ordenados;
  }

  // ── Cálculo en Tiempo Real del Turno Activo ─────────────────
  calcularResumenTurnoActivo(retiros = 0, ingresosCaja = 0, cajaContada = 0) {
    const corte = this.corteActivoSignal();
    const sucursalId = this.sucursalesService.activaId();

    if (!corte) {
      return {
        ventasCount: 0,
        gastosCount: 0,
        totalVentasNetas: 0,
        pagosEfectivo: 0,
        pagosTarjeta: 0,
        pagosTransferencia: 0,
        totalGastos: 0,
        gastosEfectivo: 0,
        gastosBancarios: 0,
        cajaEsperada: 0,
        diferencia: 0
      };
    }

    const fechaInicio = new Date(corte.fechaApertura).getTime();

    // Filtrar ventas del turno (excluyendo ventas canceladas)
    const ventasTurno = this.ventasService.ventas().filter((v) => {
      if (v.estado === 'CANCELADA') return false;
      const t = new Date(v.fecha).getTime();
      return t >= fechaInicio && (!v.sucursalId || v.sucursalId === sucursalId || sucursalId === 'TODAS');
    });

    let pagosEfectivo = 0;
    let pagosTarjeta = 0;
    let pagosTransferencia = 0;

    ventasTurno.forEach((v) => {
      const cambio = Number(v.cambio) || 0;
      const efecBruto = Number(v.pagos?.efectivo) || 0;
      pagosEfectivo += Math.max(0, efecBruto - cambio);
      pagosTarjeta += Number(v.pagos?.tarjeta) || 0;
      pagosTransferencia += Number(v.pagos?.transferencia) || 0;
    });

    const totalVentasNetas = Math.round((pagosEfectivo + pagosTarjeta + pagosTransferencia) * 100) / 100;

    // Filtrar gastos del turno
    const gastosTurno = this.gastosService.gastos().filter((g) => {
      const t = new Date(g.fecha).getTime();
      return t >= fechaInicio && (!g.sucursalId || g.sucursalId === sucursalId || sucursalId === 'TODAS');
    });

    let gastosEfectivo = 0;
    let gastosBancarios = 0;

    gastosTurno.forEach((g) => {
      const met = (g.metodoPago || '').toUpperCase();
      if (met === 'TARJETA' || met === 'TRANSFERENCIA') {
        gastosBancarios += g.monto || 0;
      } else {
        gastosEfectivo += g.monto || 0;
      }
    });

    const totalGastos = Math.round((gastosEfectivo + gastosBancarios) * 100) / 100;
    const cajaInicial = corte.cajaInicial || 0;
    const cajaEsperada = Math.round((cajaInicial + pagosEfectivo - gastosEfectivo - retiros + ingresosCaja) * 100) / 100;
    const diff = Math.round((cajaContada - cajaEsperada) * 100) / 100;
    const diferencia = Math.abs(diff) < 0.005 ? 0 : diff;

    return {
      ventasCount: ventasTurno.length,
      gastosCount: gastosTurno.length,
      totalVentasNetas,
      pagosEfectivo: Math.round(pagosEfectivo * 100) / 100,
      pagosTarjeta: Math.round(pagosTarjeta * 100) / 100,
      pagosTransferencia: Math.round(pagosTransferencia * 100) / 100,
      totalGastos,
      gastosEfectivo: Math.round(gastosEfectivo * 100) / 100,
      gastosBancarios: Math.round(gastosBancarios * 100) / 100,
      cajaEsperada,
      diferencia
    };
  }

  // ── Apertura de Turno ──────────────────────────────────────
  async abrirCorte(usuario: string, cajaInicial: number, observaciones = ''): Promise<CorteActivo> {
    const sucursal = this.sucursalesService.sucursalActiva();
    const todosCortesIds = [
      ...(this.corteActivoSignal() ? [this.corteActivoSignal()!.id] : []),
      ...this.cortesHistorialSignal().map((c) => c.id)
    ];
    const nuevoId = generarSiguienteConsecutivo(todosCortesIds, 'CA', 4);

    const nuevoCorteActivo: CorteActivo = {
      id: nuevoId,
      fechaApertura: new Date().toISOString(),
      cajaInicial,
      observacionesApertura: observaciones,
      estado: 'ABIERTO',
      usuario: usuario.trim() || 'Cajero',
      sucursalId: sucursal.id,
      sucursalNombre: sucursal.nombre
    };

    this.corteActivoSignal.set(nuevoCorteActivo);

    try {
      this.syncService.setStatus('saving', 'Abriendo corte...');
      const ref = this.firestoreService.getRefDocConfig('corteActivo');
      await setDoc(ref, nuevoCorteActivo);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      // Registrar en Bitácora
      await this.bitacoraService.registrarEvento({
        modulo: 'CORTES',
        accion: 'APERTURA',
        descripcion: `Apertura de caja #${nuevoCorteActivo.id} con fondo inicial de $${nuevoCorteActivo.cajaInicial.toFixed(2)} (${nuevoCorteActivo.usuario})`,
        detalles: nuevoCorteActivo,
        sucursalId: sucursal.id,
        sucursalNombre: sucursal.nombre
      });
    } catch (e) {
      console.warn('Error al abrir corte en Firestore:', e);
    }

    return nuevoCorteActivo;
  }

  // ── Cierre de Turno y Arqueo ────────────────────────────────
  async cerrarCorte(
    cajaContada: number,
    retiros = 0,
    ingresosCaja = 0,
    observaciones = '',
    periodicidad = 'DIARIO'
  ): Promise<Corte> {
    const activo = this.corteActivoSignal();
    if (!activo) throw new Error('No hay corte abierto para cerrar.');

    const fechaCierre = new Date().toISOString();
    const resumen = this.calcularResumenTurnoActivo(retiros, ingresosCaja, cajaContada);
    const nuevoId = generarSiguienteConsecutivo(this.cortesHistorialSignal().map((c) => c.id), 'CC', 4);

    const nuevoCorte: Corte = {
      id: nuevoId,
      periodicidad,
      fechaApertura: activo.fechaApertura,
      fechaCierre,
      cajaInicial: activo.cajaInicial,
      ventasCount: resumen.ventasCount,
      gastosCount: resumen.gastosCount,
      pagosEfectivo: resumen.pagosEfectivo,
      pagosTarjeta: resumen.pagosTarjeta,
      pagosTransferencia: resumen.pagosTransferencia,
      totalVentasNetas: resumen.totalVentasNetas,
      totalGastos: resumen.totalGastos,
      gastosEfectivo: resumen.gastosEfectivo,
      gastosTarjeta: 0,
      gastosTransferencia: 0,
      gastosBancarios: resumen.gastosBancarios,
      retiros,
      ingresosCaja,
      cajaEsperada: resumen.cajaEsperada,
      cajaContada,
      diferencia: resumen.diferencia,
      observacionesApertura: activo.observacionesApertura,
      observacionesCierre: observaciones,
      usuario: activo.usuario,
      sucursalId: activo.sucursalId,
      sucursalNombre: activo.sucursalNombre,
      estado: 'CERRADO'
    };

    const currentHistorial = [nuevoCorte, ...this.cortesHistorialSignal()];
    this.cortesHistorialSignal.set(currentHistorial);
    this.corteActivoSignal.set(null);

    try {
      this.syncService.setStatus('saving', 'Cerrando corte...');
      await setDoc(this.firestoreService.getRefDocConfig('corteActivo'), {});
      await this.firestoreService.guardarColeccionChunked('cortes', currentHistorial);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      // Registrar en Bitácora
      await this.bitacoraService.registrarEvento({
        modulo: 'CORTES',
        accion: 'CIERRE',
        descripcion: `Cierre de caja #${nuevoCorte.id} (${nuevoCorte.ventasCount} ventas, $${nuevoCorte.totalVentasNetas.toFixed(2)}). Diferencia de arqueo: $${nuevoCorte.diferencia.toFixed(2)}`,
        detalles: nuevoCorte,
        sucursalId: activo.sucursalId,
        sucursalNombre: activo.sucursalNombre,
        nivel: Math.abs(nuevoCorte.diferencia) > 5 ? 'WARNING' : 'INFO'
      });
    } catch (e) {
      console.warn('Error al guardar corte cerrado en Firestore:', e);
    }

    return nuevoCorte;
  }

  async eliminarCorte(id: string): Promise<void> {
    const corteEliminado = this.cortesHistorialSignal().find((c) => c.id === id);
    const current = this.cortesHistorialSignal().filter((c) => c.id !== id);
    this.cortesHistorialSignal.set(current);

    try {
      this.syncService.setStatus('saving', 'Eliminando corte...');
      await this.firestoreService.guardarColeccionChunked('cortes', current);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      if (corteEliminado) {
        await this.bitacoraService.registrarEvento({
          modulo: 'CORTES',
          accion: 'ELIMINAR',
          descripcion: `Corte #${id} eliminado del historial`,
          detalles: corteEliminado,
          sucursalId: corteEliminado.sucursalId,
          sucursalNombre: corteEliminado.sucursalNombre
        });
      }
    } catch (e) {
      console.warn('Error al eliminar corte en Firestore:', e);
    }
  }

  iniciarEscuchadoresLive(): void {
    if (this.subCorteActivo) this.subCorteActivo.unsubscribe();
    if (this.subCortesLive) this.subCortesLive.unsubscribe();

    // 1. Escuchador de Corte Activo
    const corteRef = this.firestoreService.getRefDocConfig('corteActivo');
    this.subCorteActivo = docStream$(corteRef).subscribe({
      next: (docSnap) => {
        if (docSnap.exists() && docSnap.data()['id']) {
          this.corteActivoSignal.set(docSnap.data() as CorteActivo);
        } else {
          this.corteActivoSignal.set(null);
        }
      },
      error: (err) => console.error('Error en stream de corte activo:', err)
    });

    // 2. Escuchador de Cortes Cerrados en Chunks
    const cortesCollRef = this.firestoreService.getRefColeccion('chunks_cortes');
    this.subCortesLive = collectionStream$(cortesCollRef).subscribe({
      next: (snapshot) => {
        if (!snapshot.empty) {
          const chunkDocs = snapshot.docs
            .filter((d) => d.id.startsWith('chunk_'))
            .sort((a, b) => {
              const idxA = parseInt(a.id.replace('chunk_', ''), 10) || 0;
              const idxB = parseInt(b.id.replace('chunk_', ''), 10) || 0;
              return idxA - idxB;
            });

          const actualizados: Corte[] = [];
          chunkDocs.forEach((d) => {
            const data = d.data();
            if (Array.isArray(data['items'])) {
              actualizados.push(...data['items']);
            }
          });

          if (actualizados.length > 0) {
            this.cortesHistorialSignal.set(this.ordenarCortes(actualizados));
          }
        }
      },
      error: (err) => console.error('Error en stream de cortes:', err)
    });
  }
}
