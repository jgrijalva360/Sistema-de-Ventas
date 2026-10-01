import { Injectable, inject, Injector } from '@angular/core';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  DocumentReference,
  CollectionReference
} from 'firebase/firestore';
import { FirebaseService } from './firebase.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class FirestoreChunksService {
  private fb = inject(FirebaseService);
  private injector = inject(Injector);

  private getAuth(): AuthService {
    return this.injector.get(AuthService);
  }

  getDocIdEmpresa(): string {
    const auth = this.getAuth();
    const tenantId = auth.getTenantId();
    if (tenantId && tenantId.trim() && tenantId !== 'main') {
      return tenantId.trim();
    }
    const user = auth.currentUser();
    if (user && user.uid) {
      return user.uid;
    }
    throw new Error('Tenant ID no identificado o inválido. No se puede acceder a la base de datos sin un negocio válido.');
  }

  async vaciarColeccion(nombreColeccion: string): Promise<void> {
    const tenantId = this.getDocIdEmpresa();
    try {
      const collRef = collection(this.fb.firestore, 'sistema', tenantId, nombreColeccion);
      const snap = await getDocs(collRef);
      if (!snap.empty) {
        const batch = writeBatch(this.fb.firestore);
        snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
        await batch.commit();
      }
    } catch (e) {
      console.warn(`Aviso al vaciar colección ${nombreColeccion}:`, e);
    }
  }

  getRefColeccion(nombreColeccion: string): CollectionReference {
    const tenantId = this.getDocIdEmpresa();
    return collection(this.fb.firestore, 'sistema', tenantId, nombreColeccion);
  }

  getRefDocConfig(docName: string): DocumentReference {
    const tenantId = this.getDocIdEmpresa();
    return doc(this.fb.firestore, 'sistema', tenantId, 'config', docName);
  }

  getRootEmpresaDocRef(): DocumentReference {
    const tenantId = this.getDocIdEmpresa();
    return doc(this.fb.firestore, 'sistema', tenantId);
  }

  getRefDocVersionGlobal(): DocumentReference {
    return doc(this.fb.firestore, 'sistema_global', 'version');
  }

  sanitizarParaFirestore<T>(data: T): T {
    if (data === undefined) return null as any;
    return JSON.parse(JSON.stringify(data));
  }

  async guardarColeccionChunked<T>(nombreColeccion: string, arrayItems: T[], chunkSize = 150): Promise<void> {
    if (!Array.isArray(arrayItems)) return;
    const tenantId = this.getDocIdEmpresa();
    const chunksCollRef = collection(this.fb.firestore, 'sistema', tenantId, `chunks_${nombreColeccion}`);

    const cleanItems = this.sanitizarParaFirestore(arrayItems);
    const chunks: T[][] = [];
    for (let i = 0; i < cleanItems.length; i += chunkSize) {
      chunks.push(cleanItems.slice(i, i + chunkSize));
    }

    // Obtener chunks previos para limpiar sobrantes
    const existingSnap = await getDocs(chunksCollRef);
    const existingChunkIds = new Set(existingSnap.docs.map((d) => d.id).filter((id) => id.startsWith('chunk_')));

    const batch = writeBatch(this.fb.firestore);

    // Guardar manifiesto
    const manifestRef = doc(chunksCollRef, '_manifest');
    batch.set(manifestRef, {
      totalItems: cleanItems.length,
      totalChunks: chunks.length,
      chunkSize,
      actualizadoEn: new Date().toISOString()
    });

    // Guardar chunks
    chunks.forEach((chunkArray, idx) => {
      const chunkDocRef = doc(chunksCollRef, `chunk_${idx}`);
      batch.set(chunkDocRef, {
        index: idx,
        count: chunkArray.length,
        items: chunkArray,
        actualizadoEn: new Date().toISOString()
      });
      existingChunkIds.delete(`chunk_${idx}`);
    });

    // Eliminar chunks viejos que ya no se usan
    existingChunkIds.forEach((oldChunkId) => {
      batch.delete(doc(chunksCollRef, oldChunkId));
    });

    await batch.commit();
  }

  async cargarColeccionChunked<T>(nombreColeccion: string): Promise<T[]> {
    try {
      const tenantId = this.getDocIdEmpresa();
      const chunksCollRef = collection(this.fb.firestore, 'sistema', tenantId, `chunks_${nombreColeccion}`);
      const snap = await getDocs(chunksCollRef);

      if (snap.empty) return [];

      const chunkDocs = snap.docs
        .filter((d) => d.id.startsWith('chunk_'))
        .sort((a, b) => {
          const idxA = parseInt(a.id.replace('chunk_', ''), 10) || 0;
          const idxB = parseInt(b.id.replace('chunk_', ''), 10) || 0;
          return idxA - idxB;
        });

      const resultado: T[] = [];
      chunkDocs.forEach((d) => {
        const data = d.data();
        if (Array.isArray(data['items'])) {
          resultado.push(...data['items']);
        }
      });
      return resultado;
    } catch (err) {
      console.warn(`Aviso al cargar chunks de ${nombreColeccion}:`, err);
      return [];
    }
  }

  async borrarTodaBaseDeDatosEmpresa(): Promise<void> {
    const tenantId = this.getDocIdEmpresa();
    if (!tenantId || tenantId === 'main') {
      throw new Error('No se puede ejecutar un borrado total: El identificador de empresa es inválido.');
    }

    const coleccionesAEliminar = [
      'chunks_productos',
      'chunks_ventas',
      'chunks_movimientos',
      'chunks_gastos',
      'chunks_cortes',
      'chunks_pedidos',
      'chunks_bitacora',
      'chunks_liquidaciones_socios',
      'chunks_prestamos_socios',
      'chunks_sucursales',
      'chunks_estado_cuenta',
      'config',
      'productos',
      'ventas',
      'movimientos',
      'gastos',
      'cortes',
      'pedidos',
      'bitacora',
      'liquidaciones_socios',
      'prestamos_socios',
      'estado_cuenta'
    ];

    for (const nomCol of coleccionesAEliminar) {
      try {
        const collRef = collection(this.fb.firestore, 'sistema', tenantId, nomCol);
        const snap = await getDocs(collRef);
        if (!snap.empty) {
          const batch = writeBatch(this.fb.firestore);
          snap.docs.forEach((docSnap) => {
            batch.delete(docSnap.ref);
          });
          await batch.commit();
        }
      } catch (err) {
        console.warn(`Aviso al vaciar colección ${nomCol}:`, err);
      }
    }

    // Inicializar documentos de configuración básica limpia para el negocio
    try {
      const generalRef = this.getRefDocConfig('general');
      await setDoc(generalRef, {
        config: {
          businessName: 'Mi Negocio',
          businessPhone: '',
          fiscalLegend: 'Gracias por su compra'
        },
        listas: {
          unidades: ['Unidades', 'Pieza', 'Caja', 'Paquetes', 'Docenas'],
          grupos: ['General', 'Materia Prima', 'Producto']
        },
        actualizadoEn: new Date().toISOString()
      });

      const sucRef = this.getRefDocConfig('sucursales');
      await setDoc(sucRef, {
        items: [{ id: 'SUC-MAIN', nombre: 'Matriz Principal', direccion: '', telefono: '', esMatriz: true }],
        actualizadoEn: new Date().toISOString()
      });

      const catRef = this.getRefDocConfig('catalogoProductos');
      await setDoc(catRef, { items: [], total: 0, actualizadoEn: new Date().toISOString() });

      const corteRef = this.getRefDocConfig('corteActivo');
      await setDoc(corteRef, {});

      const carritosRef = this.getRefDocConfig('carritosPendientes');
      await setDoc(carritosRef, { items: [], actualizadoEn: new Date().toISOString() });

      const pedidosRef = this.getRefDocConfig('pedidosPersonalizados');
      await setDoc(pedidosRef, { items: [], actualizadoEn: new Date().toISOString() });

      const sociosRef = this.getRefDocConfig('sociosConfig');
      await setDoc(sociosRef, {
        socios: [{ id: 'socio-1', nombre: 'Socio 1', porcentaje: 100, activo: true }],
        actualizadoEn: new Date().toISOString()
      });

      const bitacoraRef = this.getRefDocConfig('bitacoraReciente');
      await setDoc(bitacoraRef, { items: [], total: 0, actualizadoEn: new Date().toISOString() });
    } catch (e) {
      console.warn('Aviso al inicializar configs limpias:', e);
    }
  }
}
