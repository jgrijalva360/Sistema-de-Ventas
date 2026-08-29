import { Injectable, signal } from '@angular/core';
import { FirestoreChunksService } from './firestore-chunks.service';
import { getDoc, setDoc, increment } from 'firebase/firestore';
import { VersionInfo } from '../models/models';
import { Subscription } from 'rxjs';
import { docStream$ } from '../utils/realtime.util';
import { APP_VERSION } from '../../../environments/version';

@Injectable({
  providedIn: 'root'
})
export class SyncService {
  public syncStatus = signal<'online' | 'saving' | 'updated' | 'offline'>('online');
  public syncMessage = signal<string>('En Línea');
  public currentVersion = signal<string>(APP_VERSION);
  public dataRevision = signal<number>(1);
  public lastDevice = signal<string>('Este equipo');
  public lastTimestamp = signal<string>('Hace un momento');
  public newVersionAvailable = signal<string | null>(null);

  private subs: Subscription[] = [];
  private myRevisionLocal = 0;

  constructor(private firestoreService: FirestoreChunksService) {}

  getNombreDispositivoLocal(): string {
    let nombre = localStorage.getItem('pos_device_name');
    if (!nombre) {
      const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      const tipo = isMobile ? 'Celular/Móvil' : 'Caja/PC';
      nombre = `${tipo} ${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      localStorage.setItem('pos_device_name', nombre);
    }
    return nombre;
  }

  setNombreDispositivoLocal(nuevoNombre: string): void {
    const limpio = (nuevoNombre || '').trim();
    if (limpio) {
      localStorage.setItem('pos_device_name', limpio);
      this.lastDevice.set(`${limpio} (Este equipo)`);
    }
  }

  setStatus(status: 'online' | 'saving' | 'updated' | 'offline', message: string): void {
    this.syncStatus.set(status);
    this.syncMessage.set(message);
  }

  iniciarEscuchadorVersion(): void {
    // 1. Escuchador de Versión Global en la raíz de Firestore (sistema_global/version)
    const globalVersionDocRef = this.firestoreService.getRefDocVersionGlobal();
    const subGlobal = docStream$(globalVersionDocRef).subscribe({
      next: (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as any;
          const remoteVersion = data?.appVersion || data?.version;
          console.log('[SyncService] Versión detectada en sistema_global/version:', remoteVersion);

          if (remoteVersion && this.esVersionMasNueva(remoteVersion, APP_VERSION)) {
            this.newVersionAvailable.set(remoteVersion);
          } else if (this.newVersionAvailable() === remoteVersion) {
            this.newVersionAvailable.set(null);
          }
        }
      },
      error: (err) => console.warn('Aviso stream de versión global:', err)
    });
    this.subs.push(subGlobal);

    // 2. Escuchador de Versión, Revisiones y Dispositivos del Tenant/Usuario (sistema/{userId}/config/version)
    const versionDocRef = this.firestoreService.getRefDocConfig('version');
    const subTenant = docStream$(versionDocRef).subscribe({
      next: (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data() as VersionInfo;
          const rev = data.dataRevision || 1;
          const device = data.lastDevice || 'Desconocido';
          const remoteTenantVersion = data.appVersion || (data as any)?.version;
          const myDevice = this.getNombreDispositivoLocal();

          this.dataRevision.set(rev);
          this.lastDevice.set(device === myDevice ? `${device} (Este equipo)` : device);
          this.lastTimestamp.set(data.lastTimestamp || new Date().toISOString());

          // Si el usuario actualizó la versión en el config del usuario
          if (remoteTenantVersion && this.esVersionMasNueva(remoteTenantVersion, APP_VERSION)) {
            console.log('[SyncService] Versión más nueva detectada en config/version:', remoteTenantVersion);
            this.newVersionAvailable.set(remoteTenantVersion);
          }

          // Notificación de cambios de otro dispositivo en la misma empresa
          if (this.myRevisionLocal > 0 && rev > this.myRevisionLocal && device !== myDevice) {
            this.setStatus('updated', `¡Cambios de ${device}!`);
            setTimeout(() => this.setStatus('online', 'En Línea'), 3000);
          }

          this.myRevisionLocal = rev;
        }
      },
      error: (err) => console.error('Error en stream de sincronización:', err)
    });
    this.subs.push(subTenant);

    this.registrarVersionEnFirestoreSiEsNecesario();
  }

  async registrarVersionEnFirestoreSiEsNecesario(): Promise<void> {
    try {
      const globalVersionDocRef = this.firestoreService.getRefDocVersionGlobal();
      const versionDocRef = this.firestoreService.getRefDocConfig('version');
      const parentDocRef = this.firestoreService.getRootEmpresaDocRef();
      const myDevice = this.getNombreDispositivoLocal();

      // Verificar versión global en la raíz
      const globalSnap = await getDoc(globalVersionDocRef);
      const remoteGlobalVersion = globalSnap.exists() ? (globalSnap.data() as any)?.appVersion : null;

      const debeActualizarGlobal = !remoteGlobalVersion || this.esVersionMasNueva(APP_VERSION, remoteGlobalVersion);

      const promises: Promise<any>[] = [
        setDoc(versionDocRef, {
          lastDevice: myDevice,
          lastTimestamp: new Date().toISOString()
        }, { merge: true }),
        setDoc(parentDocRef, {
          actualizadoEn: new Date().toISOString(),
          estado: 'activo'
        }, { merge: true })
      ];

      if (debeActualizarGlobal) {
        promises.push(
          setDoc(globalVersionDocRef, {
            appVersion: APP_VERSION,
            actualizadoEn: new Date().toISOString()
          }, { merge: true })
        );
      }

      await Promise.all(promises);
    } catch (e) {
      console.warn('Error al registrar versión en Firestore:', e);
    }
  }

  async incrementarRevision(dispositivo?: string): Promise<void> {
    try {
      const versionDocRef = this.firestoreService.getRefDocConfig('version');
      await setDoc(
        versionDocRef,
        {
          dataRevision: increment(1),
          lastDevice: dispositivo || this.getNombreDispositivoLocal(),
          lastTimestamp: new Date().toISOString()
        },
        { merge: true }
      );
    } catch (_) {}
  }

  public esVersionMasNueva(remota: string, local: string): boolean {
    if (!remota || !local) return false;
    if (remota === local) return false;

    // Comparación estructurada por segmentos
    const limpiar = (v: string) => v.replace(/^v/i, '').trim();
    const partsRemota = limpiar(remota).split('.').map((p) => parseInt(p, 10) || 0);
    const partsLocal = limpiar(local).split('.').map((p) => parseInt(p, 10) || 0);

    const maxLen = Math.max(partsRemota.length, partsLocal.length);
    for (let i = 0; i < maxLen; i++) {
      const r = partsRemota[i] || 0;
      const l = partsLocal[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }

    return false;
  }

  limpiarSuscripciones(): void {
    this.subs.forEach((sub) => sub.unsubscribe());
    this.subs = [];
  }
}
