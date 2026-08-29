/**
 * Utilidad centralizada para generar folios / identificadores consecutivos legibles
 * (ej. V-0001, G-0001, PED-0001, CC-0001, MOV-0001, etc.)
 */

/**
 * Calcula el siguiente consecutivo numérico a partir de una lista de IDs existentes.
 * Ignora timestamps o números astronómicos (> 1,000,000,000) para garantizar números correlativos limpios.
 *
 * @param ids Lista de IDs existentes
 * @param prefijo Prefijo de la entidad (ej: 'V', 'G', 'PED', 'CC', 'CA', 'MOV', 'CP', 'ABO')
 * @param pad Longitud mínima de ceros a la izquierda (por defecto 4, ej. '0001')
 */
export function generarSiguienteConsecutivo(
  ids: (string | undefined | null)[],
  prefijo: string,
  pad: number = 4
): string {
  let maxNum = 0;
  const cleanPrefijo = prefijo.trim().toUpperCase();
  // Regex flexible que acepta 'V-0001', 'V0001', 'V_0001', 'PED-12', etc.
  const regex = new RegExp(`^${cleanPrefijo}[-_]?(\\d+)$`, 'i');

  for (const rawId of ids) {
    if (!rawId) continue;
    const id = String(rawId).trim();
    const match = id.match(regex);
    if (match && match[1]) {
      const num = parseInt(match[1], 10);
      // Evitar timestamps tipo Date.now() (ej. 1724892839210)
      if (!isNaN(num) && num > 0 && num < 1000000000) {
        if (num > maxNum) {
          maxNum = num;
        }
      }
    }
  }

  const siguiente = maxNum + 1;
  return `${cleanPrefijo}-${String(siguiente).padStart(pad, '0')}`;
}

/**
 * Extrae el número consecutivo dentro de un pedido para sus abonos (ej: ABO-1, ABO-2, ...)
 */
export function generarSiguienteAbonoId(abonosExistentes: { id?: string }[] = []): string {
  let maxNum = 0;
  for (const abo of abonosExistentes) {
    if (!abo || !abo.id) continue;
    const match = String(abo.id).match(/ABO-(\d+)/i);
    if (match && match[1]) {
      const n = parseInt(match[1], 10);
      if (!isNaN(n) && n > maxNum && n < 1000000) {
        maxNum = n;
      }
    }
  }
  return `ABO-${maxNum + 1}`;
}
