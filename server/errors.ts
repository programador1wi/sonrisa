export class AppError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export function requireValue<T>(value: T | null | undefined, message = 'No se encontró la simulación.'): T {
  if (value === undefined || value === null) throw new AppError(404, 'NOT_FOUND', message);
  return value;
}
