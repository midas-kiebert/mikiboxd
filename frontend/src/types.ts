type Breakpoint = "base" | "sm" | "md" | "lg" | "xl" | "2xl";

/**
 * Accept:
 *  - T
 *  - Partial<Record<Breakpoint, T>>  -> { base?: T; md?: T; ... }
 *  - (T | null)[]                   -> ["sm", null, "lg"]
 */
export type Responsive<T> = T | Partial<Record<Breakpoint, T>> | Array<T | null>;
