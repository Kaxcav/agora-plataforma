import { Link } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import type { Pagamento } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { mensagemDeErro } from '../../api/cliente';
import { useRegularidadePagamento, useVerificarPagamento } from '../../api/regularidade';
import { Alerta, Botao, ConteudoConsulta, Dialogo, EsqueletoTabela, ListaDefinicoes, useAvisos } from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ChecklistRegularidade, ResumoRegularidade } from '../regularidade/ChecklistRegularidade';

/**
 * Recheque da regularidade do contratado (RN-23): prévia no atesto e verificação registrada antes do pagamento.
 * A irregularidade não impede atestar o que foi executado; abre pendência para notificar o contratado (art. 92, XVI).
 */

/** Prévia compacta exibida no diálogo de atesto, com a última consulta registrada. */
export function PreviaRegularidadeAtesto({ pagamentoId }: { pagamentoId: string }) {
  const consulta = useRegularidadePagamento(pagamentoId);
  const idTitulo = `previa-atesto-${pagamentoId}`;
  return (
    <div className="pilha">
      <p className="texto-pequeno">
        Ao confirmar, a Ágora consulta de novo o CEIS e o CNEP e confere as certidões do contratado (RN-23). Se houver restrição, o atesto é
        registrado com a ressalva e uma pendência é aberta para o gestor notificar o contratado.
      </p>
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={2} />} rotuloCarregando="Carregando a regularidade do contratado">
        {(dados) => (
          <section className="regularidade" aria-labelledby={idTitulo}>
            <div className="regularidade__cabecalho">
              <h3 className="secao__titulo" id={idTitulo}>
                Última verificação registrada
              </h3>
              <ResumoRegularidade checklist={dados} />
            </div>
            <p className="regularidade__fonte">
              {dados.consulta
                ? `CEIS/CNEP: ${dados.consulta.fonte}, consulta de ${formatarInstante(dados.consulta.consultadoEm)}.`
                : 'CEIS/CNEP ainda não consultados para este fornecedor.'}
            </p>
            {dados.motivos.length + dados.avisos.length > 0 ? (
              <ul className="regularidade__detalhes">
                {[...dados.motivos, ...dados.avisos].map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            ) : null}
            <Link to={`/fornecedores/${dados.fornecedor.id}`}>Ver a regularidade completa de {dados.fornecedor.razaoSocial}</Link>
          </section>
        )}
      </ConteudoConsulta>
    </div>
  );
}

/** Verificação antes do pagamento, a pedido do financeiro. */
export function DialogoVerificarPagamento({ pagamento, aoFechar }: { pagamento: Pagamento | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const verificar = useVerificarPagamento();
  const fechar = () => {
    verificar.reset();
    aoFechar();
  };
  return (
    <Dialogo
      aberto={pagamento !== null}
      aoFechar={verificar.isPending ? () => undefined : fechar}
      titulo="Verificar regularidade antes do pagamento"
      largura="ampla"
      descricao={
        <p>
          Consulta de novo o CEIS e o CNEP e confere as certidões do contratado antes de pagar (Lei 14.133/2021, art. 92, XVI). A verificação
          fica registrada na trilha de auditoria.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={verificar.isPending}>
            {verificar.data ? 'Fechar' : 'Cancelar'}
          </Botao>
          {verificar.data ? null : (
            <Botao
              variante="primario"
              icone={ShieldCheck}
              carregando={verificar.isPending}
              onClick={() => {
                if (!pagamento) return;
                verificar.mutate(pagamento.id, {
                  onSuccess: (v) =>
                    avisar({
                      tipo: v.regular ? 'sucesso' : 'aviso',
                      titulo: 'Verificação registrada',
                      mensagem: v.regular
                        ? `NF ${pagamento.notaFiscal}: contratado regular.`
                        : `NF ${pagamento.notaFiscal}: ${v.motivos.length} restrição(ões). Pendência aberta para notificar o contratado.`,
                    }),
                });
              }}
            >
              Consultar e verificar
            </Botao>
          )}
        </>
      }
    >
      {pagamento ? (
        <div className="pilha">
          <ListaDefinicoes
            colunas={2}
            itens={[
              { termo: 'Nota fiscal', valor: <span className="mono">{pagamento.notaFiscal}</span> },
              { termo: 'Contrato', valor: `Contrato ${pagamento.contrato.numero}` },
              { termo: 'Fornecedor', valor: pagamento.fornecedor, largo: true },
              { termo: 'Vencimento', valor: formatarData(pagamento.vencimento) },
              { termo: 'Valor', valor: <strong className="numero">{formatarMoeda(pagamento.valor)}</strong> },
            ]}
          />
          {verificar.error ? (
            <Alerta tipo="erro" anunciar titulo="A verificação não foi concluída">
              <p>{mensagemDeErro(verificar.error)}</p>
            </Alerta>
          ) : null}
          {verificar.data ? (
            <div aria-live="polite">
              <ChecklistRegularidade checklist={verificar.data} titulo="Resultado da verificação" idTitulo={`verificacao-pagamento-${pagamento.id}`} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialogo>
  );
}
