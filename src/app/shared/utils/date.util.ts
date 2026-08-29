/**
 * Utilidades para manejo de fechas en zona horaria local.
 * Evita el desfase generado por toISOString() que convierte a UTC.
 */

/**
 * Retorna la fecha en formato YYYY-MM-DD según la zona horaria local del cliente.
 * @param date Instancia de Date (por defecto new Date()) o string de fecha
 */
export function getFechaLocalString(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) {
    return '';
  }
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
