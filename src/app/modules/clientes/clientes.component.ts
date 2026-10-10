import { Component, signal, inject, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { ClientesService } from '../../core/services/clientes.service';
import { PedidosService } from '../../core/services/pedidos.service';
import { Cliente, PedidoPersonalizado } from '../../core/models/models';
import { FechaLocalPipe } from '../../shared/pipes/fecha-local.pipe';
import { CurrencyMxnPipe } from '../../shared/pipes/currency-mxn.pipe';

@Component({
  selector: 'app-clientes',
  standalone: true,
  imports: [CommonModule, FormsModule, FechaLocalPipe, CurrencyMxnPipe],
  templateUrl: './clientes.component.html',
  styleUrl: './clientes.component.scss'
})
export class ClientesComponent {
  public clientesService = inject(ClientesService);
  public pedidosService = inject(PedidosService);

  // Filtro de búsqueda
  public busqueda = signal<string>('');

  // Modales
  public modalNuevoAbierto = signal<boolean>(false);
  public modalEditarAbierto = signal<boolean>(false);
  public modalPedidosAbierto = signal<boolean>(false);

  // Formulario Nuevo Cliente
  public nuevoNombre = '';
  public nuevoTelefono = '';
  public nuevoEmail = '';
  public nuevaDireccion = '';
  public nuevasNotas = '';

  // Cliente en edición
  public clienteEditando = signal<Cliente | null>(null);
  public editNombre = '';
  public editTelefono = '';
  public editEmail = '';
  public editDireccion = '';
  public editNotas = '';

  // Historial de pedidos del cliente seleccionado
  public clienteSeleccionadoPedidos = signal<Cliente | null>(null);

  // Lista filtrada reactiva
  public clientesFiltrados = computed(() => {
    const q = this.busqueda().trim().toLowerCase();
    const lista = this.clientesService.clientesActivos();
    if (!q) return lista;

    return lista.filter((c) => {
      const nom = (c.nombre || '').toLowerCase();
      const tel = (c.telefono || '').toLowerCase();
      const em = (c.email || '').toLowerCase();
      const dir = (c.direccion || '').toLowerCase();
      const id = (c.id || '').toLowerCase();
      return nom.includes(q) || tel.includes(q) || em.includes(q) || dir.includes(q) || id.includes(q);
    });
  });

  // Métricas
  public totalClientesConPedidos = computed(() => {
    const pedidos = this.pedidosService.pedidos();
    const nombresConPedidos = new Set(pedidos.map((p) => (p.clienteNombre || '').trim().toLowerCase()));
    return this.clientesService.clientesActivos().filter((c) => nombresConPedidos.has(c.nombre.trim().toLowerCase())).length;
  });

  // Mapa de conteo de pedidos por cliente
  public conteoPedidosPorCliente = computed(() => {
    const map = new Map<string, number>();
    const pedidos = this.pedidosService.pedidos();
    for (const p of pedidos) {
      const nom = (p.clienteNombre || '').trim().toLowerCase();
      if (nom) {
        map.set(nom, (map.get(nom) || 0) + 1);
      }
    }
    return map;
  });

  obtenerConteoPedidos(cliente: Cliente): number {
    const key = (cliente.nombre || '').trim().toLowerCase();
    return this.conteoPedidosPorCliente().get(key) || 0;
  }

  // --- ACCIONES NUEVO CLIENTE ---
  abrirModalNuevo(): void {
    this.nuevoNombre = '';
    this.nuevoTelefono = '';
    this.nuevoEmail = '';
    this.nuevaDireccion = '';
    this.nuevasNotas = '';
    this.modalNuevoAbierto.set(true);
  }

  cerrarModalNuevo(): void {
    this.modalNuevoAbierto.set(false);
  }

  async guardarNuevoCliente(): Promise<void> {
    if (!this.nuevoNombre.trim()) {
      alert('Por favor ingresa el nombre del cliente.');
      return;
    }

    try {
      await this.clientesService.crearCliente({
        nombre: this.nuevoNombre,
        telefono: this.nuevoTelefono,
        email: this.nuevoEmail,
        direccion: this.nuevaDireccion,
        notas: this.nuevasNotas
      });
      this.cerrarModalNuevo();
    } catch (e) {
      console.error('Error al guardar cliente:', e);
      alert('Ocurrió un error al guardar el cliente.');
    }
  }

  // --- ACCIONES EDITAR CLIENTE ---
  abrirModalEditar(c: Cliente): void {
    this.clienteEditando.set(c);
    this.editNombre = c.nombre || '';
    this.editTelefono = c.telefono || '';
    this.editEmail = c.email || '';
    this.editDireccion = c.direccion || '';
    this.editNotas = c.notas || '';
    this.modalEditarAbierto.set(true);
  }

  cerrarModalEditar(): void {
    this.modalEditarAbierto.set(false);
    this.clienteEditando.set(null);
  }

  async guardarEdicionCliente(): Promise<void> {
    const c = this.clienteEditando();
    if (!c) return;

    if (!this.editNombre.trim()) {
      alert('Por favor ingresa el nombre del cliente.');
      return;
    }

    try {
      await this.clientesService.actualizarCliente(c.id, {
        nombre: this.editNombre.trim(),
        telefono: this.editTelefono.trim(),
        email: this.editEmail.trim(),
        direccion: this.editDireccion.trim(),
        notas: this.editNotas.trim()
      });
      this.cerrarModalEditar();
    } catch (e) {
      console.error('Error al actualizar cliente:', e);
      alert('Ocurrió un error al actualizar el cliente.');
    }
  }

  // --- ELIMINAR CLIENTE ---
  async confirmarEliminarCliente(c: Cliente): Promise<void> {
    const pedidosCount = this.obtenerConteoPedidos(c);
    let msg = `¿Estás seguro de eliminar al cliente "${c.nombre}"?`;
    if (pedidosCount > 0) {
      msg += `\n\nNota: Este cliente tiene ${pedidosCount} pedido(s) registrado(s) en el sistema. Los pedidos conservarán su información.`;
    }

    if (confirm(msg)) {
      try {
        await this.clientesService.eliminarCliente(c.id);
      } catch (e) {
        console.error('Error al eliminar cliente:', e);
        alert('Ocurrió un error al eliminar el cliente.');
      }
    }
  }

  // --- VER PEDIDOS DEL CLIENTE ---
  abrirModalPedidos(c: Cliente): void {
    this.clienteSeleccionadoPedidos.set(c);
    this.modalPedidosAbierto.set(true);
  }

  cerrarModalPedidos(): void {
    this.modalPedidosAbierto.set(false);
    this.clienteSeleccionadoPedidos.set(null);
  }

  public pedidosDelClienteSeleccionado = computed(() => {
    const c = this.clienteSeleccionadoPedidos();
    if (!c) return [];
    const nom = (c.nombre || '').trim().toLowerCase();
    const tel = (c.telefono || '').trim();

    return this.pedidosService.pedidos().filter((p) => {
      const pNom = (p.clienteNombre || '').trim().toLowerCase();
      const pTel = (p.clienteTelefono || '').trim();
      return pNom === nom || (tel && pTel && pTel === tel);
    });
  });

  // --- IMPORTAR DESDE PEDIDOS ---
  async importarDesdePedidos(): Promise<void> {
    const pedidos = this.pedidosService.pedidos();
    if (pedidos.length === 0) {
      alert('No hay pedidos registrados en el sistema para importar.');
      return;
    }

    if (!confirm('Esta acción buscará clientes únicos en los pedidos históricos y los agregará al catálogo si aún no están registrados. ¿Deseas continuar?')) {
      return;
    }

    try {
      const importados = await this.clientesService.importarClientesDesdePedidos(pedidos);
      if (importados > 0) {
        alert(`¡Éxito! Se importaron ${importados} nuevos cliente(s) desde los pedidos históricos.`);
      } else {
        alert('Todos los clientes de los pedidos ya se encuentran registrados en el catálogo.');
      }
    } catch (e) {
      console.error('Error al importar clientes:', e);
      alert('Ocurrió un error durante la importación.');
    }
  }

  // --- ENLACE WHATSAPP ---
  obtenerEnlaceWhatsapp(tel?: string): string {
    if (!tel) return '';
    const limpio = tel.replace(/\D/g, '');
    if (!limpio) return '';
    // Si tiene 10 dígitos (típico en México), agregar 52
    const conCodigo = limpio.length === 10 ? `52${limpio}` : limpio;
    return `https://wa.me/${conCodigo}`;
  }
}
