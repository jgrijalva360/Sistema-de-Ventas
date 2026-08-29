# 🛒 Sistema de Ventas, Inventario y POS - Angular

Sistema web profesional e integral de **Punto de Venta (POS)**, **Control de Inventario**, **Pedidos Personalizados**, **Gastos**, **Cortes de Caja** y **Auditoría Financiera** en tiempo real, construido con **Angular 21** y **Firebase Firestore**.

---

## 🚀 Características Principales

### 📊 1. Dashboard Ejecutivo en Tiempo Real
- **KPIs Financieros:** Ingresos netos, gastos operativos, retiros y dinero físico esperado en caja.
- **Estado de Caja Activa:** Visualización inmediata del turno actual, fondo inicial y cálculo en vivo de sobrantes o faltantes.
- **Privacidad:** Opción para ocultar/mostrar cifras monetarias sensibles con un solo clic.

### 🛒 2. Punto de Venta (POS)
- **Búsqueda & Escáner:** Búsqueda rápida por nombre o lectura con lector de código de barras.
- **Pagos Mixtos:** Soporte para cobro combinado (Efectivo, Tarjeta y Transferencia).
- **Control de Cambio:** Cálculo automático de cambio y validación de montos faltantes.
- **Ventas en Espera:** Capacidad de pausar y recuperar múltiples carritos de venta simultáneos.
- **Impresión de Tickets:** Comprobante térmico formateado para impresión automática o manual.

### 📦 3. Catálogo de Productos e Inventario
- **Gestión de Stock:** Control de existencias, stock mínimo con alertas visuales de reabastecimiento.
- **Atributos Completos:** Código de barras, categoría/grupo, unidad de medida, costo y precio de venta.
- **Búsqueda y Filtros:** Filtrado instantáneo por texto, grupo y alertas de bajo inventario.

### 🔄 4. Kardex y Movimientos de Almacén
- **Trazabilidad Total:** Registro cronológico de Entradas, Salidas, Ajustes de Inventario y Consumos por Pedidos.
- **Cálculo de Stock:** Control automático del `stockAnterior` y `stockNuevo` en cada operación.

### 📝 5. Pedidos Personalizados y Maquila
- **Control de Producción:** Registro de especificaciones, cliente, teléfono y fecha estimada de entrega.
- **Flujo de Estados:** `PENDIENTE` ➔ `EN_PROCESO` ➔ `LISTO` ➔ `ENTREGADO` / `CANCELADO`.
- **Descuento de Insumos:** Descuento automático de materias primas del inventario al iniciar producción.
- **Historial de Abonos:** Registro de anticipo inicial, abonos parciales y cobro de liquidación final con comprobante de entrega.

### 🧾 6. Control de Gastos Operativos
- **Registro Detallado:** Clasificación por categorías (Servicios, Nómina, Proveedores, Mantenimiento, etc.).
- **Métodos de Pago:** Desglose en Efectivo (afecta la caja física) o Bancario (Tarjeta / Transferencia).

### 🔒 7. Cortes de Caja y Arqueo de Turnos
- **Apertura de Turno:** Registro del cajero responsable y fondo de caja inicial.
- **Monitoreo en Vivo:** Métricas del turno activo (ventas netas, cobros desglosados, gastos en efectivo y caja esperada).
- **Arqueo Físico:** Conteo de dinero en mano con detección automática de diferencias (Caja cuadrada, sobrante o faltante).
- **Cierre y Reporte:** Registro del corte con periodicidad (Diario, Semanal, etc.) y guardado en historial.

### 📈 8. Reportes Financieros y Auditoría
- **Reporte Global Consolidado:** Balance financiero neto (Ingresos vs Gastos).
- **Reportes Especializados:** Pestañas dedicadas para Ventas de Mostrador, Pedidos Personalizados, Gastos y Cortes.
- **Filtros Rápidos:** Por fechas predefinidas (Hoy, Últimos 7 días, Mes actual, Todo el historial) y filtrado por sucursal.
- **Exportación CSV:** Descarga directa de informes en formato compatible con Microsoft Excel.

### ⚙️ 9. Configuración y Respaldo de Datos
- **Multi-Sucursal:** Soporte para múltiples sucursales con matriz y sucursales secundarias.
- **Datos Fiscales:** Personalización del nombre comercial, teléfono y leyenda para los tickets de venta.
- **Copias de Seguridad:** Exportación completa de la base de datos en JSON y restauración granular con depuración de duplicados.

---

## 🛠️ Stack Tecnológico

- **Frontend:** [Angular 21](https://angular.dev/) (Standalone Components, Signals, Computed, Control Flow `@if` / `@for`).
- **Base de Datos & Backend:** [Firebase Firestore](https://firebase.google.com/) (Persistencia distribuida con arquitectura Chunked y sincronización en tiempo real vía `onSnapshot`).
- **Autenticación:** Firebase Authentication + Guardias de Ruta (`authGuard`).
- **Lenguaje:** TypeScript 5.9+.
- **Estilos:** SCSS modularizado, diseño limpio, profesional y responsivo.

---

## 📋 Requisitos Previos

- **Node.js:** Versión 18.x o superior instalada ([Descargar Node.js](https://nodejs.org/)).
- **NPM:** Versión 9.x o superior.
- **Angular CLI:** Versión 21.x (`npm install -g @angular/cli`).

---

## 💻 Instalación y Puesta en Marcha

### 1. Clonar el repositorio
```bash
git clone https://github.com/usuario/sistema-ventas-angular.git
cd sistema-ventas-angular
```

### 2. Instalar dependencias
```bash
npm install
```

### 3. Configurar variables de entorno Firebase
Verifica o edita la configuración de Firebase en el archivo [src/environments/environment.ts](src/environments/environment.ts):

```typescript
export const environment = {
  production: false,
  firebase: {
    apiKey: "TU_API_KEY",
    authDomain: "TU_AUTH_DOMAIN",
    projectId: "TU_PROJECT_ID",
    storageBucket: "TU_STORAGE_BUCKET",
    messagingSenderId: "TU_MESSAGING_SENDER_ID",
    appId: "TU_APP_ID"
  }
};
```

### 4. Iniciar el servidor de desarrollo
```bash
npm start
# o también:
ng serve
```
Abre tu navegador en `http://localhost:4200/`.

---

## 🏗️ Construcción para Producción

Para compilar el proyecto optimizado para producción:

```bash
npm run build
# o también:
ng build --configuration production
```

Los archivos compilados y minificados se generarán en el directorio `dist/sistema-ventas-angular/`.

---

## 📁 Estructura del Proyecto

```text
src/
├── app/
│   ├── core/                  # Servicios globales, modelos, guardias y autenticación
│   │   ├── guards/            # authGuard y validaciones de ruta
│   │   ├── models/            # Interfaces TypeScript (Producto, Venta, Pedido, Corte, etc.)
│   │   └── services/          # Ventas, Productos, Pedidos, Cortes, Gastos, Sync, etc.
│   ├── layout/                # Barra lateral, navegación y layout principal
│   ├── modules/               # Módulos y vistas principales de la aplicación
│   │   ├── auth/              # Inicio de sesión
│   │   ├── dashboard/         # Dashboard con métricas y estado de caja
│   │   ├── ventas/            # Terminal Punto de Venta (POS)
│   │   ├── inventario/        # Control de existencias
│   │   ├── productos/         # Catálogo y altas/bajas/cambios de productos
│   │   ├── movimientos/       # Historial y Kardex de almacén
│   │   ├── pedidos/           # Pedidos personalizados, anticipos y abonos
│   │   ├── gastos/            # Registro y categorías de egresos
│   │   ├── cortes/            # Apertura, arqueo y cierre de caja
│   │   ├── reportes/          # Auditoría financiera y exportación CSV
│   │   └── configuracion/     # Respaldos, sucursales y datos del ticket
│   └── shared/                # Pipes reutilizables (CurrencyMxn, FechaLocal, etc.)
└── environments/              # Credenciales y configuración de entornos
```

---

## 📄 Licencia

Este proyecto está desarrollado para uso comercial y administrativo. Todos los derechos reservados.
