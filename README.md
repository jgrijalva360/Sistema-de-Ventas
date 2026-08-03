# Sistema de Ventas y Control de Inventario

Sistema web moderno e interactivo para la gestión de inventario, punto de venta (POS), control de gastos y cortes de caja. Funciona en **red local**: un servidor Node.js centraliza la base de datos en `db.json` para que múltiples computadoras puedan acceder a los mismos datos simultáneamente.

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
- **🌐 Base de Datos en Red Local:** Los datos se almacenan en `backend/db.json` y son accesibles desde cualquier computadora de la red.
- **💾 Respaldo y Configuración:** Exportación e importación completa de la base de datos en formato JSON.

## 🛠️ Requisitos

- [Node.js](https://nodejs.org) v18 o superior (para el servidor de red local).
- Navegador web moderno (Google Chrome, Microsoft Edge, Mozilla Firefox, Safari).

## 🚀 Instalación y Uso

### Primera vez

1. Abre una terminal en la carpeta `backend/`:
   ```bash
   cd backend
   npm install
   ```

2. Inicia el servidor:
   ```bash
   node server.js
   ```

3. Abre el navegador en `http://localhost:3000`.

### Uso diario

**Con ventana de terminal visible:**
- Doble clic en `backend/iniciar-servidor.bat`

**En segundo plano (sin ventana):**
- Doble clic en `backend/iniciar-oculto.vbs` para iniciar.
- Doble clic en `backend/detener-servidor.bat` para detener.

### Acceso desde otras computadoras en la misma red

Al iniciar el servidor, la terminal mostrará la IP de tu PC:

```
  Esta PC:    http://localhost:3000
  Otras PCs:  http://192.168.X.X:3000
```

Las demás computadoras solo necesitan abrir esa dirección en su navegador.

## 📁 Estructura del proyecto

```
├── index.html               # Interfaz principal de la aplicación
├── script.js                # Lógica de negocio y comunicación con el servidor
├── styles.css               # Estilos visuales
├── assets/                  # Recursos multimedia (sonidos, etc.)
└── backend/
    ├── server.js            # Servidor Express (red local, puerto 3000)
    ├── db.json              # Base de datos (archivo JSON persistente)
    ├── package.json         # Dependencias Node.js
    ├── iniciar-servidor.bat # Inicia el servidor con terminal visible
    ├── iniciar-oculto.vbs   # Inicia el servidor en segundo plano
    └── detener-servidor.bat # Detiene el servidor en segundo plano
```

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.