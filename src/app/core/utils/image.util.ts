/**
 * Utilidades para manejo, compresión y optimización de imágenes en el cliente
 */

export interface OpcionesCompresion {
  maxAncho?: number;
  maxAlto?: number;
  calidad?: number; // 0.1 a 1.0
}

/**
 * Comprime una imagen a formato JPEG Base64 optimizado para almacenamiento ligero en Firestore.
 */
export async function comprimirImagen(
  archivo: File,
  opciones: OpcionesCompresion = {}
): Promise<string> {
  const maxAncho = opciones.maxAncho || 1200;
  const maxAlto = opciones.maxAlto || 1200;
  const calidad = opciones.calidad !== undefined ? opciones.calidad : 0.75;

  if (!archivo.type.startsWith('image/')) {
    throw new Error('El archivo seleccionado no es una imagen.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (event: ProgressEvent<FileReader>) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) {
        reject(new Error('No se pudo leer el archivo de imagen.'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Calcular nuevo tamaño manteniendo la proporción
        if (width > maxAncho || height > maxAlto) {
          const ratio = Math.min(maxAncho / width, maxAlto / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          // Si no hay contexto 2d, retornar el original si no excede límites
          resolve(dataUrl);
          return;
        }

        // Fondo blanco para imágenes transparentes como PNG convertidas a JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0, width, height);

        // Convertir a JPEG con calidad controlada
        const resultadoBase64 = canvas.toDataURL('image/jpeg', calidad);
        resolve(resultadoBase64);
      };

      img.onerror = () => reject(new Error('No se pudo procesar la imagen seleccionada.'));
      img.src = dataUrl;
    };

    reader.onerror = () => reject(new Error('Error al cargar la imagen desde el disco.'));
    reader.readAsDataURL(archivo);
  });
}

/**
 * Retorna el peso aproximado de un string Base64 en kilobytes legibles
 */
export function calcularTamanioBase64(base64String: string): string {
  if (!base64String) return '0 KB';
  const longitudLimpia = base64String.replace(/^data:image\/\w+;base64,/, '').length;
  const bytes = (longitudLimpia * 3) / 4;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
