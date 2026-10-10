import { Injectable, signal, computed, inject } from '@angular/core';
import { Cliente, PedidoPersonalizado } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { SucursalesService } from './sucursales.service';
import { SyncService } from './sync.service';
import { BitacoraService } from './bitacora.service';
import { Subscription } from 'rxjs';
import { collectionStream$ } from '../utils/realtime.util';
import { generarSiguienteConsecutivo } from '../utils/consecutivo.util';

@Injectable({
  providedIn: 'root'
})
export class ClientesService {
  private firestoreService = inject(FirestoreChunksService);
  private sucursalesService = inject(SucursalesService);
  private syncService = inject(SyncService);
  private bitacoraService = inject(BitacoraService);

  private clientesSignal = signal<Cliente[]>([]);
  public clientes = this.clientesSignal.asReadonly();

  public clientesActivos = computed(() => {
    return this.clientesSignal().filter((c) => c.activo !== false);
  });

  public totalClientes = computed(() => {
    return this.clientesActivos().length;
  });

  public totalConTelefono = computed(() => {
    return this.clientesActivos().filter((c) => !!(c.telefono && c.telefono.trim())).length;
  });

  private subLive?: Subscription;

  setClientes(list: Cliente[]): void {
    if (Array.isArray(list)) {
      this.clientesSignal.set(list);
    }
  }

  async cargarClientes(): Promise<Cliente[]> {
    try {
      const list = await this.firestoreService.cargarColeccionChunked<Cliente>('clientes');
      this.clientesSignal.set(list || []);
      return list || [];
    } catch (e) {
      console.warn('Aviso al cargar clientes:', e);
      return [];
    }
  }

  async crearCliente(datos: {
    nombre: string;
    telefono?: string;
    email?: string;
    direccion?: string;
    notas?: string;
  }): Promise<Cliente> {
    const sucursal = this.sucursalesService.sucursalActiva();
    const nuevoId = generarSiguienteConsecutivo(this.clientesSignal().map((c) => c.id), 'CLI', 4);

    const nuevoCliente: Cliente = {
      id: nuevoId,
      nombre: datos.nombre.trim(),
      telefono: datos.telefono ? datos.telefono.trim() : '',
      email: datos.email ? datos.email.trim() : '',
      direccion: datos.direccion ? datos.direccion.trim() : '',
      notas: datos.notas ? datos.notas.trim() : '',
      fechaRegistro: new Date().toISOString(),
      sucursalId: sucursal?.id,
      activo: true
    };

    const current = [nuevoCliente, ...this.clientesSignal()];
    this.clientesSignal.set(current);

    try {
      this.syncService.setStatus('saving', 'Registrando cliente...');
      await this.firestoreService.guardarColeccionChunked('clientes', current);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      await this.bitacoraService.registrarEvento({
        modulo: 'CLIENTES',
        accion: 'CREAR',
        descripcion: `Cliente #${nuevoCliente.id} registrado: "${nuevoCliente.nombre}"${nuevoCliente.telefono ? ` (Tel: ${nuevoCliente.telefono})` : ''}`,
        detalles: nuevoCliente,
        sucursalId: sucursal?.id,
        sucursalNombre: sucursal?.nombre
      });
    } catch (e) {
      console.warn('Error al persistir cliente en Firestore:', e);
    }

    return nuevoCliente;
  }

  async actualizarCliente(id: string, datos: Partial<Cliente>): Promise<void> {
    const actual = this.clientesSignal().find((c) => c.id === id);
    if (!actual) return;

    const clienteActualizado: Cliente = {
      ...actual,
      ...datos,
      id: actual.id // Preservar ID
    };

    const list = this.clientesSignal().map((c) => (c.id === id ? clienteActualizado : c));
    this.clientesSignal.set(list);

    try {
      this.syncService.setStatus('saving', 'Actualizando cliente...');
      await this.firestoreService.guardarColeccionChunked('clientes', list);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      await this.bitacoraService.registrarEvento({
        modulo: 'CLIENTES',
        accion: 'EDITAR',
        descripcion: `Cliente #${clienteActualizado.id} actualizado: "${clienteActualizado.nombre}"`,
        detalles: clienteActualizado
      });
    } catch (e) {
      console.warn('Error al actualizar cliente en Firestore:', e);
      this.syncService.setStatus('offline', 'Error al guardar');
      throw e;
    }
  }

  async eliminarCliente(id: string): Promise<void> {
    const cliente = this.clientesSignal().find((c) => c.id === id);
    if (!cliente) return;

    const list = this.clientesSignal().filter((c) => c.id !== id);
    this.clientesSignal.set(list);

    try {
      this.syncService.setStatus('saving', 'Eliminando cliente...');
      await this.firestoreService.guardarColeccionChunked('clientes', list);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      await this.bitacoraService.registrarEvento({
        modulo: 'CLIENTES',
        accion: 'ELIMINAR',
        descripcion: `Cliente #${cliente.id} "${cliente.nombre}" eliminado`,
        detalles: cliente
      });
    } catch (e) {
      console.warn('Error al eliminar cliente en Firestore:', e);
      this.syncService.setStatus('offline', 'Error al guardar');
      throw e;
    }
  }

  buscarClientes(query: string): Cliente[] {
    const q = (query || '').trim().toLowerCase();
    if (!q) return this.clientesActivos();

    return this.clientesActivos().filter((c) => {
      const nom = (c.nombre || '').toLowerCase();
      const tel = (c.telefono || '').toLowerCase();
      const em = (c.email || '').toLowerCase();
      const dir = (c.direccion || '').toLowerCase();
      return nom.includes(q) || tel.includes(q) || em.includes(q) || dir.includes(q);
    });
  }

  /**
   * Importa automáticamente clientes de pedidos existentes que no se encuentren ya registrados
   */
  async importarClientesDesdePedidos(pedidos: PedidoPersonalizado[]): Promise<number> {
    if (!Array.isArray(pedidos) || pedidos.length === 0) return 0;

    const existentesMap = new Map<string, Cliente>();
    this.clientesSignal().forEach((c) => {
      existentesMap.set(c.nombre.trim().toLowerCase(), c);
    });

    const nuevosParaAgregar: Cliente[] = [];
    let currentIds = this.clientesSignal().map((c) => c.id);

    for (const ped of pedidos) {
      const nombre = (ped.clienteNombre || '').trim();
      if (!nombre) continue;

      const clave = nombre.toLowerCase();
      if (!existentesMap.has(clave)) {
        const nuevoId = generarSiguienteConsecutivo([...currentIds, ...nuevosParaAgregar.map((c) => c.id)], 'CLI', 4);
        const nuevoCliente: Cliente = {
          id: nuevoId,
          nombre: nombre,
          telefono: (ped.clienteTelefono || '').trim(),
          email: '',
          direccion: '',
          notas: `Importado de Pedido #${ped.id}`,
          fechaRegistro: ped.fechaRegistro || new Date().toISOString(),
          activo: true
        };

        nuevosParaAgregar.push(nuevoCliente);
        existentesMap.set(clave, nuevoCliente);
      } else {
        // Si ya existe pero no tenía teléfono y el pedido sí tiene, enriquecer
        const existente = existentesMap.get(clave)!;
        if (!existente.telefono && ped.clienteTelefono && ped.clienteTelefono.trim()) {
          existente.telefono = ped.clienteTelefono.trim();
        }
      }
    }

    if (nuevosParaAgregar.length === 0) return 0;

    const listFinal = [...nuevosParaAgregar, ...this.clientesSignal()];
    this.clientesSignal.set(listFinal);

    try {
      this.syncService.setStatus('saving', 'Importando clientes...');
      await this.firestoreService.guardarColeccionChunked('clientes', listFinal);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      await this.bitacoraService.registrarEvento({
        modulo: 'CLIENTES',
        accion: 'CREAR',
        descripcion: `Se importaron ${nuevosParaAgregar.length} clientes únicos a partir de los pedidos históricos`,
        detalles: { totalImportados: nuevosParaAgregar.length }
      });
    } catch (e) {
      console.warn('Error al guardar clientes importados:', e);
    }

    return nuevosParaAgregar.length;
  }

  limpiarEstado(): void {
    if (this.subLive) {
      this.subLive.unsubscribe();
      this.subLive = undefined;
    }
    this.clientesSignal.set([]);
  }

  iniciarEscuchadorLive(): void {
    if (this.subLive) this.subLive.unsubscribe();

    try {
      const chunksCollRef = this.firestoreService.getRefColeccion('chunks_clientes');
      this.subLive = collectionStream$(chunksCollRef).subscribe({
        next: (snapshot) => {
          if (snapshot.empty) {
            this.clientesSignal.set([]);
            return;
          }

          const chunkDocs = snapshot.docs
            .filter((d) => d.id.startsWith('chunk_'))
            .sort((a, b) => {
              const idxA = parseInt(a.id.replace('chunk_', ''), 10) || 0;
              const idxB = parseInt(b.id.replace('chunk_', ''), 10) || 0;
              return idxA - idxB;
            });

          const actualizados: Cliente[] = [];
          chunkDocs.forEach((d) => {
            const data = d.data();
            if (Array.isArray(data['items'])) {
              actualizados.push(...data['items']);
            }
          });

          this.clientesSignal.set(actualizados);
        },
        error: (err) => console.error('Error en stream de clientes:', err)
      });
    } catch (e) {
      console.warn('Aviso al iniciar escuchador live de clientes:', e);
    }
  }
}
