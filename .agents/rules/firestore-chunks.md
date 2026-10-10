# Regla: Persistencia de Colecciones en Chunks (Firestore)

En este proyecto, **todas las colecciones y entidades de datos deben crearse, guardarse y sincronizarse en chunks (fragmentos)** a través de `FirestoreChunksService`.

### 1. Guardado de Colecciones
- Utilizar siempre `this.firestoreService.guardarColeccionChunked(nombreColeccion, items, [tamanoChunk])`.
- Nunca crear colecciones planas con un documento por cada registro individual para entidades del sistema.

### 2. Carga de Datos
- Utilizar siempre `this.firestoreService.cargarColeccionChunked<T>(nombreColeccion)`.

### 3. Escuchador en Tiempo Real (Live Sync)
- Al suscribirse a cambios en tiempo real, escuchar la subcolección `chunks_${nombreColeccion}` usando `collectionStream$`:
```typescript
const chunksCollRef = this.firestoreService.getRefColeccion(`chunks_${nombreColeccion}`);
this.subLive = collectionStream$(chunksCollRef).subscribe({
  next: (snapshot) => {
    const chunkDocs = snapshot.docs
      .filter((d) => d.id.startsWith('chunk_'))
      .sort((a, b) => {
        const idxA = parseInt(a.id.replace('chunk_', ''), 10) || 0;
        const idxB = parseInt(b.id.replace('chunk_', ''), 10) || 0;
        return idxA - idxB;
      });

    const items: T[] = [];
    chunkDocs.forEach((d) => {
      const data = d.data();
      if (Array.isArray(data['items'])) items.push(...data['items']);
    });
    this.signal.set(items);
  }
});
```

### 4. Ciclo de Vida, Respaldo y Limpieza
- Registrar el reseteo del servicio en `DataCleanupService.limpiarTodoElEstadoLocal()`.
- Incorporar la colección en los procesos de respaldo (`descargarBackupJSON`), restauración (`restaurarBackupSeleccionado`) y vaciado de `ConfiguracionService`.
