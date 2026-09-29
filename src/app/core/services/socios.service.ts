import { Injectable, signal, computed, inject } from '@angular/core';
import { SocioConfig, LiquidacionSocios, AjusteEntreSocios } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { SyncService } from './sync.service';
import { BitacoraService } from './bitacora.service';
import { getDoc, setDoc } from 'firebase/firestore';
import { generarSiguienteConsecutivo } from '../utils/consecutivo.util';

const SOCIOS_DEFAULT: SocioConfig[] = [
  { id: 'socio-1', nombre: 'Socio 1', porcentaje: 100, activo: true }
];

@Injectable({
  providedIn: 'root'
})
export class SociosService {
  private firestoreService = inject(FirestoreChunksService);
  private syncService = inject(SyncService);
  private bitacoraService = inject(BitacoraService);

  private sociosSignal = signal<SocioConfig[]>(SOCIOS_DEFAULT);
  private liquidacionesSignal = signal<LiquidacionSocios[]>([]);
  private prestamosSignal = signal<AjusteEntreSocios[]>([]);
  public cargando = signal<boolean>(false);

  public socios = this.sociosSignal.asReadonly();
  public liquidaciones = this.liquidacionesSignal.asReadonly();
  public prestamos = this.prestamosSignal.asReadonly();

  public prestamosPendientes = computed(() => {
    return this.prestamosSignal().filter((p) => !p.liquidado);
  });

  public sociosActivos = computed(() => {
    return this.sociosSignal().filter((s) => s.activo !== false);
  });

  public sumaPorcentajes = computed(() => {
    return this.sociosActivos().reduce((sum, s) => sum + (Number(s.porcentaje) || 0), 0);
  });

  public porcentajesValidos = computed(() => {
    return Math.abs(this.sumaPorcentajes() - 100) < 0.01;
  });

  public socioTransferenciasDefault = computed(() => {
    const list = this.sociosActivos();
    const def = list.find((s) => s.recibeTransferenciasDefault === true);
    return def || (list.length > 0 ? list[0] : null);
  });

  public socioTarjetasDefault = computed(() => {
    const list = this.sociosActivos();
    const def = list.find((s) => s.recibeTarjetasDefault === true);
    return def || this.socioTransferenciasDefault();
  });

  public socioResguardosDefault = computed(() => {
    const list = this.sociosActivos();
    const def = list.find((s) => s.recibeResguardosDefault === true);
    return def || (list.length > 0 ? list[0] : null);
  });

  async cargarDatos(): Promise<void> {
    this.cargando.set(true);
    try {
      await Promise.all([
        this.cargarSociosConfig(),
        this.cargarLiquidaciones(),
        this.cargarPrestamos()
      ]);
    } finally {
      this.cargando.set(false);
    }
  }

  async cargarSociosConfig(): Promise<SocioConfig[]> {
    try {
      const docRef = this.firestoreService.getRefDocConfig('sociosConfig');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        if (Array.isArray(data?.['socios']) && data['socios'].length > 0) {
          this.sociosSignal.set(data['socios']);
          return data['socios'];
        }
      }
    } catch (err) {
      console.warn('Aviso al cargar sociosConfig de Firestore:', err);
    }
    // Si no existía, mantener defaults
    return this.sociosSignal();
  }

  async guardarSociosConfig(nuevosSocios: SocioConfig[]): Promise<void> {
    this.sociosSignal.set([...nuevosSocios]);
    try {
      this.syncService.setStatus('saving', 'Guardando socios...');
      const docRef = this.firestoreService.getRefDocConfig('sociosConfig');
      await setDoc(docRef, {
        socios: nuevosSocios,
        ultimaActualizacion: new Date().toISOString()
      }, { merge: true });
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      await this.bitacoraService.registrarEvento({
        modulo: 'CONFIGURACION',
        accion: 'EDITAR',
        descripcion: `Configuración de socios actualizada (${nuevosSocios.length} socios)`,
        detalles: nuevosSocios
      });
    } catch (err) {
      console.error('Error al guardar sociosConfig en Firestore:', err);
      this.syncService.setStatus('offline', 'Error al guardar');
      throw err;
    }
  }

  async cargarLiquidaciones(): Promise<LiquidacionSocios[]> {
    try {
      const list = await this.firestoreService.cargarColeccionChunked<LiquidacionSocios>('liquidaciones_socios');
      const ordenadas = [...list].sort((a, b) => new Date(b.fechaCreacion).getTime() - new Date(a.fechaCreacion).getTime());
      this.liquidacionesSignal.set(ordenadas);
      return ordenadas;
    } catch (err) {
      console.warn('Aviso al cargar liquidaciones de socios:', err);
      return [];
    }
  }

  async guardarLiquidacion(liq: Omit<LiquidacionSocios, 'id' | 'folio' | 'fechaCreacion'>): Promise<LiquidacionSocios> {
    const listActual = this.liquidacionesSignal();
    const nuevoFolio = generarSiguienteConsecutivo(listActual.map((l) => l.folio || l.id), 'REP', 4);
    const nuevaLiq: LiquidacionSocios = {
      ...liq,
      id: `LIQ-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      folio: nuevoFolio,
      fechaCreacion: new Date().toISOString()
    };

    const actualizadas = [nuevaLiq, ...listActual];
    this.liquidacionesSignal.set(actualizadas);

    try {
      this.syncService.setStatus('saving', 'Guardando liquidación...');
      await this.firestoreService.guardarColeccionChunked('liquidaciones_socios', actualizadas);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      await this.bitacoraService.registrarEvento({
        modulo: 'REPORTES',
        accion: 'CREAR',
        descripcion: `Liquidación #${nuevaLiq.folio} guardada para periodo ${nuevaLiq.fechaDesde} al ${nuevaLiq.fechaHasta}. Total: $${nuevaLiq.utilidadBaseReparto.toFixed(2)}`,
        detalles: nuevaLiq
      });
    } catch (err) {
      console.error('Error al guardar liquidación en Firestore:', err);
      this.syncService.setStatus('offline', 'Error al guardar');
      throw err;
    }

    return nuevaLiq;
  }

  async eliminarLiquidacion(id: string): Promise<void> {
    const liqAEliminar = this.liquidacionesSignal().find((l) => l.id === id);
    const actualizadas = this.liquidacionesSignal().filter((l) => l.id !== id);
    this.liquidacionesSignal.set(actualizadas);

    try {
      this.syncService.setStatus('saving', 'Eliminando liquidación...');
      await this.firestoreService.guardarColeccionChunked('liquidaciones_socios', actualizadas);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      if (liqAEliminar) {
        await this.bitacoraService.registrarEvento({
          modulo: 'REPORTES',
          accion: 'ELIMINAR',
          descripcion: `Liquidación #${liqAEliminar.folio || liqAEliminar.id} eliminada`,
          detalles: liqAEliminar
        });
      }
    } catch (err) {
      console.error('Error al eliminar liquidación en Firestore:', err);
      this.syncService.setStatus('offline', 'Error al sincronizar');
      throw err;
    }
  }

  // --- PRÉSTAMOS / AJUSTES ENTRE SOCIOS EN FIRESTORE ---

  async cargarPrestamos(): Promise<AjusteEntreSocios[]> {
    try {
      const list = await this.firestoreService.cargarColeccionChunked<AjusteEntreSocios>('prestamos_socios');
      this.prestamosSignal.set(list || []);
      return list || [];
    } catch (err) {
      console.warn('Aviso al cargar préstamos entre socios de Firestore:', err);
      return [];
    }
  }

  async guardarAjusteEntreSocios(ajuste: AjusteEntreSocios): Promise<void> {
    const listActual = this.prestamosSignal();
    const existeIdx = listActual.findIndex((a) => a.id === ajuste.id);
    let actualizadas: AjusteEntreSocios[];
    if (existeIdx >= 0) {
      actualizadas = [...listActual];
      actualizadas[existeIdx] = ajuste;
    } else {
      actualizadas = [ajuste, ...listActual];
    }

    this.prestamosSignal.set(actualizadas);

    try {
      this.syncService.setStatus('saving', 'Guardando préstamo entre socios...');
      await this.firestoreService.guardarColeccionChunked('prestamos_socios', actualizadas);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      await this.bitacoraService.registrarEvento({
        modulo: 'REPORTES',
        accion: 'CREAR',
        descripcion: `Préstamo registrado: ${ajuste.socioAcreedorNombre} prestó $${ajuste.monto.toFixed(2)} a ${ajuste.socioDeudorNombre} (${ajuste.concepto || 'Sin concepto'})`,
        detalles: ajuste
      });
    } catch (err) {
      console.error('Error al guardar préstamo entre socios en Firestore:', err);
      this.syncService.setStatus('offline', 'Error al guardar');
      throw err;
    }
  }

  async eliminarAjusteEntreSocios(id: string): Promise<void> {
    const prestamoAEliminar = this.prestamosSignal().find((p) => p.id === id);
    const actualizadas = this.prestamosSignal().filter((p) => p.id !== id);
    this.prestamosSignal.set(actualizadas);

    try {
      this.syncService.setStatus('saving', 'Eliminando préstamo entre socios...');
      await this.firestoreService.guardarColeccionChunked('prestamos_socios', actualizadas);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      if (prestamoAEliminar) {
        await this.bitacoraService.registrarEvento({
          modulo: 'REPORTES',
          accion: 'ELIMINAR',
          descripcion: `Préstamo entre socios eliminado: ${prestamoAEliminar.socioAcreedorNombre} -> ${prestamoAEliminar.socioDeudorNombre} ($${prestamoAEliminar.monto.toFixed(2)})`,
          detalles: prestamoAEliminar
        });
      }
    } catch (err) {
      console.error('Error al eliminar préstamo entre socios en Firestore:', err);
      this.syncService.setStatus('offline', 'Error al sincronizar');
      throw err;
    }
  }

  async liquidarAjustes(ids: string[], folio: string): Promise<void> {
    if (!ids || ids.length === 0) return;
    const actualizadas = this.prestamosSignal().map((p) => {
      if (ids.includes(p.id)) {
        return { ...p, liquidado: true, liquidacionFolio: folio };
      }
      return p;
    });
    this.prestamosSignal.set(actualizadas);

    try {
      await this.firestoreService.guardarColeccionChunked('prestamos_socios', actualizadas);
      await this.syncService.incrementarRevision();
    } catch (err) {
      console.warn('Error al marcar préstamos como liquidados en Firestore:', err);
    }
  }

  async reactivarAjustesLiquidados(folio: string): Promise<void> {
    if (!folio) return;
    const actualizadas = this.prestamosSignal().map((p) => {
      if (p.liquidacionFolio === folio) {
        return { ...p, liquidado: false, liquidacionFolio: undefined };
      }
      return p;
    });
    this.prestamosSignal.set(actualizadas);

    try {
      await this.firestoreService.guardarColeccionChunked('prestamos_socios', actualizadas);
      await this.syncService.incrementarRevision();
    } catch (err) {
      console.warn('Error al reactivar préstamos liquidados en Firestore:', err);
    }
  }
}
