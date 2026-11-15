export const HOST_ORIGIN: string;
export const SANDBOX_ORIGIN: string;
export function hostHeaders(o?: { dev?: boolean }): Record<string, string>;
export function sandboxHeaders(): Record<string, string>;

export const HOST_ORIGINS: string[];
