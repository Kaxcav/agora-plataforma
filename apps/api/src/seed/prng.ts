/** Gerador pseudoaleatório determinístico (mulberry32) para a carga sintética de demonstração. */
export class Prng {
  #estado: number;

  constructor(semente: number) {
    this.#estado = semente >>> 0;
  }

  /** Número em [0, 1). */
  proximo(): number {
    this.#estado = (this.#estado + 0x6d2b79f5) >>> 0;
    let t = this.#estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Inteiro em [min, max] (inclusivo). */
  inteiro(min: number, max: number): number {
    return min + Math.floor(this.proximo() * (max - min + 1));
  }

  chance(probabilidade: number): boolean {
    return this.proximo() < probabilidade;
  }

  escolher<T>(itens: readonly T[]): T {
    const item = itens[Math.floor(this.proximo() * itens.length)];
    if (item === undefined) throw new RangeError('Lista vazia');
    return item;
  }

  embaralhar<T>(itens: readonly T[]): T[] {
    const copia = [...itens];
    for (let i = copia.length - 1; i > 0; i--) {
      const j = Math.floor(this.proximo() * (i + 1));
      const a = copia[i];
      const b = copia[j];
      if (a !== undefined && b !== undefined) {
        copia[i] = b;
        copia[j] = a;
      }
    }
    return copia;
  }

  /** UUID v4 determinístico. */
  uuid(): string {
    const bytes = Array.from({ length: 16 }, () => this.inteiro(0, 255));
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  digitos(quantidade: number): string {
    return Array.from({ length: quantidade }, () => String(this.inteiro(0, 9))).join('');
  }
}
