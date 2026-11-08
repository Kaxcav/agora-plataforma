/**
 * Etapa 7 — Contrato e gestão: contratação com a trava pré-assinatura (RN-09, art. 91, § 4º) e link para o
 * contrato criado na carteira, com o plano de gestão de assinatura.
 */
import { useEffect, useRef, useState } from 'react';
import { FileSignature, FileText } from 'lucide-react';
import { formatarMoeda } from '@agora/dominio';
import { ehResultadoDesempate, useContratar } from '../../../api/jornada';
import { Alerta, Botao, ConfirmarAcao, LinkBotao, ListaDefinicoes, Secao, useAvisos } from '../../../componentes';
import { ErroOperacao } from '../comum';
import type { PropsEtapa } from './tipos';

export default function Etapa7Contrato({ processo, editavel }: PropsEtapa) {
  const { avisar } = useAvisos();
  const contratar = useContratar(processo.id);
  const [confirmando, definirConfirmando] = useState(false);
  const [recemCriado, definirRecemCriado] = useState(false);
  const alertaContrato = useRef<HTMLDivElement>(null);
  const resultado = ehResultadoDesempate(processo.disputa.resultado) ? processo.disputa.resultado : null;
  // O contrato é celebrado com o adjudicatário (art. 71, IV), que pode não ser o primeiro classificado (RN-20, RN-22).
  const adjudicatario = processo.selecao.adjudicacao?.licitante.id ?? null;
  const vencedor = resultado?.classificacao.find((c) => (adjudicatario ? c.id === adjudicatario : c.posicao === 1)) ?? null;
  const contrato = processo.contratoGerado;

  useEffect(() => {
    if (!recemCriado || !contrato) return;
    const quadro = window.requestAnimationFrame(() => alertaContrato.current?.focus());
    return () => window.cancelAnimationFrame(quadro);
  }, [recemCriado, contrato]);

  if (contrato) {
    return (
      <div className="pilha pilha--ampla">
        <div ref={alertaContrato} tabIndex={-1} className="jornada-foco">
          <Alerta
            tipo="sucesso"
            titulo={`Contrato ${contrato.numero} criado na carteira`}
            acoes={
              <LinkBotao to={`/contratos/${contrato.id}`} variante="primario" icone={FileText}>
                Abrir o contrato {contrato.numero}
              </LinkBotao>
            }
          >
            <p>
              O contrato entrou na carteira com as tarefas do modelo de gestão de assinatura. A divulgação no PNCP é condição de eficácia e deve
              ocorrer em até 20 dias úteis da assinatura (art. 94, I — RN-11).
            </p>
          </Alerta>
        </div>
        <p className="texto-secundario">
          A partir daqui, a execução é acompanhada no detalhe do contrato: plano de gestão, empenhos, pagamentos em ordem cronológica e
          aditivos (art. 125).
        </p>
      </div>
    );
  }

  return (
    <div className="pilha pilha--ampla">
      <Secao titulo="Contratação" id="etapa7-contratacao" nivel={3} simples>
        <ListaDefinicoes
          colunas={2}
          itens={[
            { termo: 'Fornecedor vencedor', valor: vencedor ? vencedor.nome : 'Definido após o registro da disputa' },
            { termo: 'Valor adjudicado', valor: vencedor ? <span className="numero">{formatarMoeda(vencedor.valorConsiderado)}</span> : '—' },
            {
              termo: 'Valor estimado',
              valor: processo.valorEstimado !== null ? <span className="numero">{formatarMoeda(processo.valorEstimado)}</span> : 'Não estimado',
            },
            { termo: 'Modalidade', valor: processo.modalidadePrevista ?? 'Não informada' },
          ]}
        />
      </Secao>

      <Secao titulo="Verificações antes da assinatura (RN-09)" id="etapa7-verificacoes" nivel={3} simples descricao="Lei 14.133/2021, art. 91, § 4º.">
        <ul className="jornada-lista-compacta">
          <li>Consulta ao CEIS e ao CNEP: o vencedor não pode ter impedimento de licitar e contratar nem declaração de inidoneidade vigentes.</li>
          <li>Regularidade fiscal perante a Fazenda federal e o FGTS, e regularidade trabalhista (CNDT).</li>
        </ul>
        <p className="texto-pequeno texto-secundario">
          As consultas são feitas pelo servidor da Ágora no momento da contratação, com fonte e data registradas. Havendo restrição, a
          contratação é bloqueada e a regra aparece abaixo.
        </p>
        {editavel ? (
          <div>
            <Botao
              variante="primario"
              icone={FileSignature}
              onClick={() => {
                contratar.reset();
                definirConfirmando(true);
              }}
            >
              Contratar
            </Botao>
          </div>
        ) : null}
        {!confirmando ? <ErroOperacao erro={contratar.error} titulo="A contratação foi bloqueada" /> : null}
      </Secao>

      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => definirConfirmando(false)}
        titulo="Contratar"
        largura="media"
        descricao={
          <p>
            Executa as verificações do art. 91, § 4º, e, se não houver restrição, cria o contrato
            {vencedor ? (
              <>
                {' '}
                com <strong>{vencedor.nome}</strong> no valor de <strong className="numero">{formatarMoeda(vencedor.valorConsiderado)}</strong>
              </>
            ) : null}{' '}
            na carteira, com as tarefas do modelo de gestão de assinatura.
          </p>
        }
        rotuloConfirmar="Contratar"
        aoConfirmar={() =>
          contratar.mutate(undefined, {
            onSuccess: (atualizado) => {
              definirConfirmando(false);
              definirRecemCriado(true);
              avisar({
                tipo: 'sucesso',
                titulo: 'Contrato criado',
                mensagem: atualizado.contratoGerado ? `Contrato ${atualizado.contratoGerado.numero} incluído na carteira.` : 'Contrato incluído na carteira.',
              });
            },
            onError: () => definirConfirmando(false),
          })
        }
        processando={contratar.isPending}
      />
    </div>
  );
}
