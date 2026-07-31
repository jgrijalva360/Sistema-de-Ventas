# Sistema de Ventas y Control de Inventario

Sistema web ligero, moderno e interactivo para la gestión de inventario, punto de venta (POS), control de gastos y cortes de caja. Funciona 100% de forma local en el navegador mediante `localStorage` sin necesidad de bases de datos externas o servidores complejos.

## 🚀 Características Principales

- **📊 Dashboard Interactivo:** Métricas financieras en tiempo real, balance de caja actual, resumen de inventario y tendencias.
- **💳 Punto de Venta (POS):** 
  - Búsqueda y escaneo de productos por código de barras.
  - Pagos combinados (Efectivo, Tarjeta, Transferencia).
  - Impresión de tickets de venta.
  - Carritos pendientes y apartados de productos.
- **📦 Control de Inventario:**
  - Registro y edición de productos con precios y stock mínimo.
  - Generación e impresión/descarga de códigos de barras (Code 39).
  - Búsqueda en tiempo real e historial de productos.
- **📋 Movimientos de Stock:** Registro de entradas, salidas y ajustes de inventario.
- **💸 Control de Gastos:** Registro clasificado por categoría con impacto directo en caja.
- **🧾 Sistema de Cortes de Caja:**
  - Apertura con caja inicial (precargada automáticamente con la caja contada anterior).
  - Seguimiento de ventas, efectivo y gastos durante la sesión.
  - Control de ingresos/retiros de caja y cálculo de diferencias al cierre.
  - Historial completo de cortes con exportación a CSV.
- **💾 Respaldo y Configuración:** Exportación e importación completa de la base de datos local en formato JSON.

## 🛠️ Requisitos

- Navegador web moderno (Google Chrome, Microsoft Edge, Mozilla Firefox, Safari).

## 🚀 Uso e Instalación

No requiere instalaciones complejas ni dependencias adicionales:

1. **Vía Servidor Local (Recomendado):**
   - Inicia un servidor HTTP local en la carpeta del proyecto:
     ```bash
     python -m http.server 8000
     ```
   - Abre tu navegador e ingresa a `http://localhost:8000`.

2. **Abrir Directamente:**
   - Haz doble clic en el archivo [index.html](file:///e:/USER/Documentos%20E/Programas/SISTEMA%20WEB%20INVENTARIO-20260114T231922Z-3-001/SISTEMA%20WEB%20INVENTARIO/index.html) para ejecutar la aplicación en tu navegador.

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.