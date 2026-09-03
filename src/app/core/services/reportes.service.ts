import { Injectable } from '@angular/core';
import { VentasService } from './ventas.service';
import { GastosService } from './gastos.service';
import { CortesService } from './cortes.service';
import { PedidosService } from './pedidos.service';
import { Venta, Gasto, Corte, PedidoPersonalizado } from '../models/models';

export interface CobroPedidoItem {
  pedidoId: string;
  clienteNombre: string;
  fecha: string;
  concepto: string;
  monto: number;
  metodoPago: 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | string;
  sucursalId: string;
  sucursalNombre: string;
  estadoPedido: string;
}

@Injectable({
  providedIn: 'root'
})
export class ReportesService {
  constructor(
    private ventasService: VentasService,
    private gastosService: GastosService,
    private cortesService: CortesService,
    private pedidosService: PedidosService
  ) {}

  filtrarVentas(desdeStr: string, hastaStr: string, sucursalId = 'TODAS', incluirCanceladas = false): Venta[] {
    const desde = new Date(`${desdeStr}T00:00:00`).getTime();
    const hasta = new Date(`${hastaStr}T23:59:59`).getTime();

    return this.ventasService.ventas().filter((v) => {
      if (!incluirCanceladas && v.estado === 'CANCELADA') return false;
      const t = new Date(v.fecha).getTime();
      if (isNaN(t) || t < desde || t > hasta) return false;
      if (sucursalId !== 'TODAS' && v.sucursalId !== sucursalId) return false;
      return true;
    });
  }

  filtrarPedidos(desdeStr: string, hastaStr: string, sucursalId = 'TODAS'): PedidoPersonalizado[] {
    const desde = new Date(`${desdeStr}T00:00:00`).getTime();
    const hasta = new Date(`${hastaStr}T23:59:59`).getTime();

    return this.pedidosService.pedidos().filter((p) => {
      const t = new Date(p.fechaRegistro).getTime();
      if (isNaN(t) || t < desde || t > hasta) return false;
      if (sucursalId !== 'TODAS' && p.sucursalId !== sucursalId) return false;
      return true;
    });
  }

  obtenerCobrosPedidos(desdeStr: string, hastaStr: string, sucursalId = 'TODAS'): CobroPedidoItem[] {
    const desde = new Date(`${desdeStr}T00:00:00`).getTime();
    const hasta = new Date(`${hastaStr}T23:59:59`).getTime();

    const cobros: CobroPedidoItem[] = [];

    this.pedidosService.pedidos().forEach((p) => {
      if (sucursalId !== 'TODAS' && p.sucursalId && p.sucursalId !== sucursalId) return;
      if (p.estado === 'CANCELADO') return;

      const listaAbonos = (p.abonos && p.abonos.length > 0)
        ? p.abonos
        : ((p as any).pagos && (p as any).pagos.length > 0)
          ? (p as any).pagos
          : null;

      if (listaAbonos) {
        listaAbonos.forEach((a: any) => {
          const aTime = new Date(a.fecha || p.fechaRegistro).getTime();
          if (!isNaN(aTime) && aTime >= desde && aTime <= hasta) {
            const met = (a.metodoPago || a.metodo || 'EFECTIVO').toUpperCase();
            const monto = Number(a.monto) || 0;
            if (monto > 0) {
              cobros.push({
                pedidoId: p.id,
                clienteNombre: p.clienteNombre,
                fecha: a.fecha || p.fechaRegistro,
                concepto: a.concepto || 'Abono / Anticipo',
                monto,
                metodoPago: met,
                sucursalId: p.sucursalId,
                sucursalNombre: p.sucursalNombre || 'Principal',
                estadoPedido: p.estado
              });
            }
          }
        });
      } else {
        const pagado = (p.saldoRestante === 0 && (p.totalAcordado || 0) > 0)
          ? (p.totalAcordado || 0)
          : (p.anticipo || 0);

        if (pagado > 0) {
          const pTime = new Date(p.fechaRegistro).getTime();
          if (!isNaN(pTime) && pTime >= desde && pTime <= hasta) {
            const met = (p.metodoPagoAnticipo || 'EFECTIVO').toUpperCase();
            cobros.push({
              pedidoId: p.id,
              clienteNombre: p.clienteNombre,
              fecha: p.fechaRegistro,
              concepto: 'Anticipo',
              monto: pagado,
              metodoPago: met,
              sucursalId: p.sucursalId,
              sucursalNombre: p.sucursalNombre || 'Principal',
              estadoPedido: p.estado
            });
          }
        }
      }
    });

    return cobros.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  }

  filtrarGastos(desdeStr: string, hastaStr: string, sucursalId = 'TODAS'): Gasto[] {
    const desde = new Date(`${desdeStr}T00:00:00`).getTime();
    const hasta = new Date(`${hastaStr}T23:59:59`).getTime();

    return this.gastosService.gastos().filter((g) => {
      const t = new Date(g.fecha).getTime();
      if (isNaN(t) || t < desde || t > hasta) return false;
      if (sucursalId !== 'TODAS' && g.sucursalId !== sucursalId) return false;
      return true;
    });
  }

  filtrarCortes(desdeStr: string, hastaStr: string, sucursalId = 'TODAS'): Corte[] {
    const desde = new Date(`${desdeStr}T00:00:00`).getTime();
    const hasta = new Date(`${hastaStr}T23:59:59`).getTime();

    return this.cortesService.cortesHistorial().filter((c) => {
      const t = new Date(c.fechaCierre || c.fechaApertura).getTime();
      if (isNaN(t) || t < desde || t > hasta) return false;
      if (sucursalId !== 'TODAS' && c.sucursalId !== sucursalId) return false;
      return true;
    });
  }

  exportarCSV(nombreArchivo: string, encabezados: string[], filas: string[][]): void {
    let csvContent = '\uFEFF'; // UTF-8 BOM
    csvContent += encabezados.join(',') + '\n';

    filas.forEach((fila) => {
      const filaEscapada = fila.map((campo) => `"${(campo || '').replace(/"/g, '""')}"`).join(',');
      csvContent += filaEscapada + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nombreArchivo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
