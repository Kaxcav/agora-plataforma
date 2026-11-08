import type { DriverFila } from './tipos.ts';

/**
 * Transporte em PostgreSQL (demonstração, testes e PGlite): a tabela `fila_tarefas` é a própria fila e a varredura
 * periódica do trabalhador é a entrega. Quando o trabalhador roda no mesmo processo, `despachar` já entrega o aviso,
 * sem esperar a próxima varredura. É durável (sobrevive a reinícios) e dispensa serviço adicional.
 */
export function criarDriverPostgres(aoFalhar: (erro: unknown) => void = () => undefined): DriverFila {
  let entregar: ((id: string) => Promise<void>) | null = null;
  return {
    transporte: 'postgres',
    async despachar(aviso) {
      // Nova tentativa (espera > 0) fica para a varredura, quando `disponivel_em` chegar.
      if (aviso.esperaMs > 0 || !entregar) return;
      entregar(aviso.id).catch(aoFalhar);
    },
    async registrarErro() {
      // Neste transporte, a situação 'erro' em fila_tarefas já é a fila de erro.
    },
    async consumir(processar) {
      entregar = processar;
    },
    pronto: () => true,
    async fechar() {
      entregar = null;
    },
  };
}
