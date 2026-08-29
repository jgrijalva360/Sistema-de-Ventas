import { Component, signal, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { JsonPipe } from '@angular/common';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { BitacoraService } from '../../core/services/bitacora.service';
import { SucursalesService } from '../../core/services/sucursales.service';
import { BitacoraEvento, ModuloBitacora, TipoAccionBitacora } from '../../core/models/models';

@Component({
  selector: 'app-bitacora',
  standalone: true,
  imports: [FormsModule, JsonPipe, FechaLocalPipe],
  templateUrl: './bitacora.component.html',
  styleUrl: './bitacora.component.scss'
})
export class BitacoraComponent {
  public busqueda = signal<string>('');
  public moduloFiltro = signal<string>('TODOS');
  public accionFiltro = signal<string>('TODAS');
  public sucursalFiltro = signal<string>('TODAS');
  public nivelFiltro = signal<string>('TODOS');
  public fechaDesde = signal<string>('');
  public fechaHasta = signal<string>('');

  public eventoSeleccionado = signal<BitacoraEvento | null>(null);

  public bitacoraService = inject(BitacoraService);
  public sucursalesService = inject(SucursalesService);

  public eventosFiltrados = computed(() => {
    const list = this.bitacoraService.eventos();
    const query = this.busqueda().trim().toLowerCase();
    const mod = this.moduloFiltro();
    const acc = this.accionFiltro();
    const suc = this.sucursalFiltro();
    const niv = this.nivelFiltro();
    const fDesde = this.fechaDesde();
    const fHasta = this.fechaHasta();

    return list.filter((e) => {
      if (mod !== 'TODOS' && e.modulo !== mod) return false;
      if (acc !== 'TODAS' && e.accion !== acc) return false;
      if (suc !== 'TODAS' && (e.sucursalId || 'SUC-MAIN') !== suc) return false;
      if (niv !== 'TODOS' && e.nivel !== niv) return false;

      if (fDesde) {
        const fechaE = e.fecha.split('T')[0];
        if (fechaE < fDesde) return false;
      }

      if (fHasta) {
        const fechaE = e.fecha.split('T')[0];
        if (fechaE > fHasta) return false;
      }

      if (query) {
        const matchDesc = (e.descripcion || '').toLowerCase().includes(query);
        const matchUser = (e.usuario || '').toLowerCase().includes(query);
        const matchDisp = (e.dispositivo || '').toLowerCase().includes(query);
        const matchId = (e.id || '').toLowerCase().includes(query);
        const matchSuc = (e.sucursalNombre || '').toLowerCase().includes(query);
        if (!matchDesc && !matchUser && !matchDisp && !matchId && !matchSuc) return false;
      }

      return true;
    });
  });

  public metricas = computed(() => {
    const total = this.bitacoraService.eventos().length;
    const ventas = this.bitacoraService.eventos().filter((e) => e.modulo === 'VENTAS').length;
    const inventario = this.bitacoraService.eventos().filter((e) => e.modulo === 'INVENTARIO').length;
    const cortes = this.bitacoraService.eventos().filter((e) => e.modulo === 'CORTES').length;
    const gastos = this.bitacoraService.eventos().filter((e) => e.modulo === 'GASTOS').length;
    const pedidos = this.bitacoraService.eventos().filter((e) => e.modulo === 'PEDIDOS').length;

    return { total, ventas, inventario, cortes, gastos, pedidos };
  });

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.moduloFiltro.set('TODOS');
    this.accionFiltro.set('TODAS');
    this.sucursalFiltro.set('TODAS');
    this.nivelFiltro.set('TODOS');
    this.fechaDesde.set('');
    this.fechaHasta.set('');
  }

  verDetalles(evento: BitacoraEvento): void {
    this.eventoSeleccionado.set(evento);
  }

  cerrarModalDetalles(): void {
    this.eventoSeleccionado.set(null);
  }

  exportarCSV(): void {
    const items = this.eventosFiltrados();
    if (items.length === 0) {
      alert('No hay eventos que coincidan para exportar.');
      return;
    }

    const headers = ['Folio', 'Fecha ISO', 'Módulo', 'Acción', 'Descripción', 'Usuario', 'Dispositivo', 'Sucursal', 'Nivel'];
    const rows = items.map((e) => [
      `"${e.id}"`,
      `"${e.fecha}"`,
      `"${e.modulo}"`,
      `"${e.accion}"`,
      `"${(e.descripcion || '').replace(/"/g, '""')}"`,
      `"${e.usuario || ''}"`,
      `"${e.dispositivo || ''}"`,
      `"${e.sucursalNombre || ''}"`,
      `"${e.nivel || 'INFO'}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `bitacora_auditoria_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async confirmarLimpieza(): Promise<void> {
    const confirmar = confirm(
      '⚠️ ¿Estás seguro de que deseas vaciar el historial de la bitácora?\n\nEsta acción eliminará todos los registros de auditoría de Firestore.'
    );
    if (confirmar) {
      await this.bitacoraService.limpiarBitacora();
    }
  }
}
