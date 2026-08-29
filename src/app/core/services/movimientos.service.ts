import { Injectable, signal } from '@angular/core';
import { MovimientoInventario } from '../models/models';
import { FirestoreChunksService } from './firestore-chunks.service';
import { ProductosService } from './productos.service';
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
export class MovimientosService {
  private movimientosSignal = signal<MovimientoInventario[]>([]);
  public movimientos = this.movimientosSignal.asReadonly();

  private subLiveMovimientos?: Subscription;

  constructor(
    private firestoreService: FirestoreChunksService,
    private productosService: ProductosService,
    private sucursalesService: SucursalesService,
    private syncService: SyncService,
    private bitacoraService: BitacoraService
  ) {}

  setMovimientos(list: MovimientoInventario[]): void {
    if (Array.isArray(list)) {
      this.movimientosSignal.set(this.validarYLimpiarDuplicados(list));
    }
  }

  /**
   * Extrae claves de fecha normalizadas para comparación estricta de fecha/hora.
   */
  private extraerClavesFecha(fechaRaw: any): {
    isoExacta: string;
    segundoKey: string;
    minutoKey: string;
    raw: string;
  } {
    const raw = String(fechaRaw || '').trim();
    if (!raw) {
      return { isoExacta: '', segundoKey: '', minutoKey: '', raw: '' };
    }

    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      const yr = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, '0');
      const da = String(d.getDate()).padStart(2, '0');
      const hr = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      const se = String(d.getSeconds()).padStart(2, '0');

      return {
        isoExacta: d.toISOString(),
        segundoKey: `${yr}-${mo}-${da}_${hr}:${mi}:${se}`,
        minutoKey: `${yr}-${mo}-${da}_${hr}:${mi}`,
        raw
      };
    }

    return {
      isoExacta: raw,
      segundoKey: raw,
      minutoKey: raw,
      raw
    };
  }

  /**
   * Valida si un movimiento específico ya existe en la lista dada (por ID o por fecha/hora y código).
   */
  validarMovimientoDuplicado(
    mov: Partial<MovimientoInventario>,
    listaExistente: MovimientoInventario[] = this.movimientosSignal()
  ): boolean {
    if (!mov) return false;
    const id = mov.id ? String(mov.id).trim() : '';
    const codigo = (mov.codigo || '').trim().toUpperCase();
    const tipo = (mov.tipo || '').trim().toUpperCase();
    const cantidad = Number(mov.cantidad) || 0;
    const claves = this.extraerClavesFecha(mov.fecha);

    return listaExistente.some((existente) => {
      // 1. Coincidencia por ID único
      if (id && existente.id && String(existente.id).trim() === id) {
        return true;
      }

      const exCodigo = (existente.codigo || '').trim().toUpperCase();
      // Si ambos tienen código y son diferentes productos, no son duplicados entre sí
      if (codigo && exCodigo && codigo !== exCodigo) {
        return false;
      }

      const exClaves = this.extraerClavesFecha(existente.fecha);

      // 2. Coincidencia por fecha exacta ISO o raw para el mismo producto
      if (claves.isoExacta && exClaves.isoExacta && claves.isoExacta === exClaves.isoExacta) {
        return true;
      }
      if (claves.raw && exClaves.raw && claves.raw === exClaves.raw) {
        return true;
      }

      // 3. Coincidencia por año-mes-día-hora-minuto-segundo exacto para el mismo producto
      if (claves.segundoKey && exClaves.segundoKey && claves.segundoKey === exClaves.segundoKey) {
        return true;
      }

      // 4. Mismo minuto exacto con mismo tipo y misma cantidad para el mismo producto
      const exTipo = (existente.tipo || '').trim().toUpperCase();
      const exCantidad = Number(existente.cantidad) || 0;
      if (
        claves.minutoKey &&
        exClaves.minutoKey &&
        claves.minutoKey === exClaves.minutoKey &&
        tipo === exTipo &&
        cantidad === exCantidad
      ) {
        return true;
      }

      return false;
    });
  }

  /**
   * Filtra un arreglo de movimientos eliminando registros duplicados.
   * Criterios estrictos:
   * - Mismo ID repetido
   * - Misma fecha/hora exacta (segundo) para el mismo código de producto
   * - Mismo minuto exacto con mismo producto, mismo tipo y misma cantidad
   * - Misma firma completa de datos
   */
  validarYLimpiarDuplicados(lista: MovimientoInventario[]): MovimientoInventario[] {
    if (!Array.isArray(lista)) return [];

    const idsVistos = new Set<string>();
    const fechasIsoVistas = new Set<string>();
    const segundosVistos = new Set<string>();
    const minutosFirmasVistas = new Set<string>();
    const firmasCompletas = new Set<string>();
    const limpios: MovimientoInventario[] = [];

    for (const mov of lista) {
      if (!mov) continue;

      const id = mov.id ? String(mov.id).trim() : '';
      const codigo = (mov.codigo || '').trim().toUpperCase();
      const tipo = (mov.tipo || '').trim().toUpperCase();
      const cantidad = Number(mov.cantidad) || 0;
      const claves = this.extraerClavesFecha(mov.fecha);

      // Llaves de unicidad
      const keyIso = codigo && claves.isoExacta ? `${codigo}_${claves.isoExacta}` : '';
      const keyRaw = codigo && claves.raw ? `${codigo}_${claves.raw}` : '';
      const keySegundo = codigo && claves.segundoKey ? `${codigo}_${claves.segundoKey}` : '';
      const keyMinutoFirma = codigo && claves.minutoKey ? `${codigo}_${claves.minutoKey}_${tipo}_${cantidad}` : '';
      const firmaCompleta = `${codigo}_${claves.segundoKey}_${tipo}_${cantidad}_${mov.stockAnterior ?? ''}_${mov.stockNuevo ?? ''}`;

      // Comprobar si ya fue visto
      if (id && idsVistos.has(id)) {
        continue;
      }
      if (keyIso && fechasIsoVistas.has(keyIso)) {
        continue;
      }
      if (keyRaw && fechasIsoVistas.has(keyRaw)) {
        continue;
      }
      if (keySegundo && segundosVistos.has(keySegundo)) {
        continue;
      }
      if (keyMinutoFirma && minutosFirmasVistas.has(keyMinutoFirma)) {
        continue;
      }
      if (firmaCompleta && firmasCompletas.has(firmaCompleta)) {
        continue;
      }

      // Registrar como visto
      if (id) idsVistos.add(id);
      if (keyIso) fechasIsoVistas.add(keyIso);
      if (keyRaw) fechasIsoVistas.add(keyRaw);
      if (keySegundo) segundosVistos.add(keySegundo);
      if (keyMinutoFirma) minutosFirmasVistas.add(keyMinutoFirma);
      if (firmaCompleta) firmasCompletas.add(firmaCompleta);

      let nombreFinal = (mov.nombre || '').trim();
      if (!nombreFinal || nombreFinal.toLowerCase() === 'producto') {
        const prod = this.productosService.obtenerPorCodigo(codigo);
        if (prod?.nombre && prod.nombre.trim().toLowerCase() !== 'producto') {
          nombreFinal = prod.nombre;
        }
      }

      limpios.push({
        ...mov,
        codigo,
        nombre: nombreFinal || 'Producto'
      });
    }

    return limpios;
  }

  async cargarMovimientos(): Promise<MovimientoInventario[]> {
    const list = await this.firestoreService.cargarColeccionChunked<MovimientoInventario>('movimientos');
    const limpios = this.validarYLimpiarDuplicados(list);
    this.movimientosSignal.set(limpios);
    return limpios;
  }

  iniciarEscuchadorLive(): void {
    if (this.subLiveMovimientos) this.subLiveMovimientos.unsubscribe();

    const chunksCollRef = this.firestoreService.getRefColeccion('chunks_movimientos');
    this.subLiveMovimientos = collectionStream$(chunksCollRef).subscribe({
      next: (snapshot) => {
        if (!snapshot.empty) {
          const chunkDocs = snapshot.docs
            .filter((d) => d.id.startsWith('chunk_'))
            .sort((a, b) => {
              const idxA = parseInt(a.id.replace('chunk_', ''), 10) || 0;
              const idxB = parseInt(b.id.replace('chunk_', ''), 10) || 0;
              return idxA - idxB;
            });

          const actualizados: MovimientoInventario[] = [];
          chunkDocs.forEach((d) => {
            const data = d.data();
            if (Array.isArray(data['items'])) {
              actualizados.push(...data['items']);
            }
          });

          if (actualizados.length > 0) {
            const limpios = this.validarYLimpiarDuplicados(actualizados);
            this.movimientosSignal.set(limpios);
          }
        }
      },
      error: (err) => console.error('Error en stream de movimientos:', err)
    });
  }

  /**
   * Depura la base de datos de movimientos eliminando todos los registros duplicados
   * y guardando la colección limpia en Firestore y memoria.
   */
  async depurarMovimientosDuplicados(): Promise<{
    totalOriginal: number;
    totalLimpios: number;
    duplicadosEliminados: number;
  }> {
    const listaOriginal = this.movimientosSignal();
    const totalOriginal = listaOriginal.length;
    const listaLimpia = this.validarYLimpiarDuplicados(listaOriginal);
    const totalLimpios = listaLimpia.length;
    const duplicadosEliminados = totalOriginal - totalLimpios;

    if (duplicadosEliminados > 0) {
      this.movimientosSignal.set(listaLimpia);
      this.syncService.setStatus('saving', 'Depurando movimientos duplicados en BD...');
      try {
        await this.firestoreService.guardarColeccionChunked('movimientos', listaLimpia);
        await this.syncService.incrementarRevision();
        this.syncService.setStatus('online', 'En Línea');
      } catch (e) {
        console.error('Error al guardar movimientos depurados en Firestore:', e);
        this.syncService.setStatus('online', 'En Línea');
        throw e;
      }
    }

    return { totalOriginal, totalLimpios, duplicadosEliminados };
  }

  async registrarMovimiento(
    tipo: MovimientoInventario['tipo'],
    codigo: string,
    cantidad: number,
    motivo = '',
    sucursalId?: string
  ): Promise<void> {
    const prod = this.productosService.obtenerPorCodigo(codigo);
    if (!prod) throw new Error('Producto no encontrado');

    const cantNum = Number(cantidad) || 0;
    if (cantNum <= 0) throw new Error('La cantidad debe ser mayor a 0');

    const sucursalActiva = this.sucursalesService.sucursalActiva();
    const sid = sucursalId || sucursalActiva?.id || 'SUC-MAIN';

    const stockSucursal = this.productosService.obtenerStockSucursal(prod, sid);
    const stockAnterior = stockSucursal.stockActual || 0;
    let stockNuevo = stockAnterior;

    if (tipo === 'ENTRADA') stockNuevo += cantNum;
    else if (tipo === 'SALIDA') stockNuevo = Math.max(0, stockAnterior - cantNum);
    else if (tipo === 'AJUSTE' || tipo === 'INICIAL') stockNuevo = Math.max(0, cantNum);

    // 1. Actualizar el stock del producto en la sucursal específica
    await this.productosService.actualizarStock(prod.codigo, stockNuevo, sid);

    // 2. Registrar el movimiento en el historial validando fecha única
    let fechaIso = new Date().toISOString();
    
    // Validar que no exista un movimiento con la misma fecha exacta para este producto
    if (this.validarMovimientoDuplicado({ fecha: fechaIso, codigo: prod.codigo })) {
      await new Promise((res) => setTimeout(res, 5));
      fechaIso = new Date().toISOString();
    }

    const nuevoId = generarSiguienteConsecutivo(this.movimientosSignal().map((m) => m.id), 'MOV', 4);

    const nuevoMov: MovimientoInventario = {
      id: nuevoId,
      fecha: fechaIso,
      tipo,
      codigo: prod.codigo,
      nombre: prod.nombre,
      cantidad: cantNum,
      stockAnterior,
      stockNuevo,
      motivo: motivo.trim(),
      sucursalId: sid
    };

    const current = this.validarYLimpiarDuplicados([nuevoMov, ...this.movimientosSignal()]);
    this.movimientosSignal.set(current);

    this.syncService.setStatus('saving', 'Registrando movimiento...');
    try {
      await this.firestoreService.guardarColeccionChunked('movimientos', current);
      await this.syncService.incrementarRevision();
      this.syncService.setStatus('online', 'En Línea');

      // Registrar en Bitácora
      const sucursalNombre = this.sucursalesService.sucursales().find((s) => s.id === sid)?.nombre || 'Matriz';
      await this.bitacoraService.registrarEvento({
        modulo: 'INVENTARIO',
        accion: tipo === 'AJUSTE' ? 'EDITAR' : 'CREAR',
        descripcion: `${tipo} de ${cantNum} pza(s) para "${prod.nombre}" (${prod.codigo}). Stock resultante: ${stockNuevo}. ${motivo ? '(' + motivo + ')' : ''}`,
        detalles: nuevoMov,
        sucursalId: sid,
        sucursalNombre
      });
    } catch (e) {
      console.warn('Error al guardar movimiento en Firestore:', e);
      this.syncService.setStatus('online', 'En Línea');
    }
  }

  async registrarTraspaso(
    codigo: string,
    cantidad: number,
    sucursalOrigenId: string,
    sucursalDestinoId: string,
    motivo = ''
  ): Promise<void> {
    if (sucursalOrigenId === sucursalDestinoId) {
      throw new Error('La sucursal origen y destino no pueden ser la misma.');
    }

    const sucursales = this.sucursalesService.sucursales();
    const origen = sucursales.find((s) => s.id === sucursalOrigenId)?.nombre || sucursalOrigenId;
    const destino = sucursales.find((s) => s.id === sucursalDestinoId)?.nombre || sucursalDestinoId;

    const motivoSalida = `Traspaso enviado a ${destino}${motivo ? ': ' + motivo : ''}`;
    const motivoEntrada = `Traspaso recibido desde ${origen}${motivo ? ': ' + motivo : ''}`;

    // 1. Registrar salida en origen
    await this.registrarMovimiento('SALIDA', codigo, cantidad, motivoSalida, sucursalOrigenId);

    // 2. Registrar entrada en destino
    await this.registrarMovimiento('ENTRADA', codigo, cantidad, motivoEntrada, sucursalDestinoId);
  }
}
