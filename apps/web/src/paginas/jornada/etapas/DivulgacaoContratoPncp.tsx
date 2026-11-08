/**
 * Divulgação do contrato no PNCP (art. 94; RF-19): condição de eficácia, em até 20 dias úteis da assinatura. O envio
 * passa pela fila de integrações do servidor; concluído, a pendência de divulgação do contrato é resolvida.
 */
import { useState } from 'react';
import { Send } from 'lucide-react';
import type { ProcessoDetalhe } from '@agora/contratos';
import { useDivulgarContratoPncp, usePublicacaoPncp } from '../../../api/fila';
import { Botao, ConfirmarAcao, Secao, useAvisos } from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { CartaoEnvioPncp, SITUACOES_ENVIO } from './EnviosPncp';

export default function DivulgacaoContratoPncp({ processo }: { processo: ProcessoDetalhe }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const consulta = usePublicacaoPncp(processo.id);
  const divulgar = useDivulgarContratoPncp(processo.id);
  const [confirmando, definirConfirmando] = useState(false);
  const contrato = processo.contratoGerado;
  if (!contrato) return null;
  const envio = consulta.data?.contrato ?? null;
  const podeDivulgar = temPermissao('jornada:publicar') && processo.publicacao.pncp === 'publicado' && (envio === null || envio.situacao === 'erro');

  return (
    <Secao
      titulo="Divulgação do contrato no PNCP"
      id="etapa7-divulgacao-pncp"
      nivel={3}
      simples
      descricao="Condição de eficácia do contrato: até 20 dias úteis da assinatura (Lei 14.133/2021, art. 94, I)."
    >
      {envio ? (
        <ul className="lista-simples">
          <CartaoEnvioPncp envio={envio} />
        </ul>
      ) : (
        <p className="texto-secundario">
          {processo.publicacao.pncp === 'publicado'
            ? `O contrato ${contrato.numero} ainda não foi enviado ao PNCP.`
            : 'O contrato só pode ser divulgado depois que a contratação estiver publicada no PNCP.'}
        </p>
      )}
      {podeDivulgar ? (
        <div>
          <Botao
            variante={envio ? 'secundario' : 'primario'}
            icone={Send}
            onClick={() => {
              divulgar.reset();
              definirConfirmando(true);
            }}
          >
            {envio ? 'Reenviar ao PNCP' : 'Divulgar no PNCP'}
          </Botao>
        </div>
      ) : null}
      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => definirConfirmando(false)}
        titulo="Divulgar o contrato no PNCP"
        largura="media"
        descricao={
          <>
            <p>
              Envia os dados do contrato {contrato.numero} ao PNCP pela fila de integrações do servidor, vinculado à contratação publicada. Se o
              PNCP estiver fora do ar, o servidor tenta de novo sozinho.
            </p>
            <p>Concluído o envio, a pendência de divulgação do contrato é resolvida e o registro fica na trilha de auditoria.</p>
          </>
        }
        rotuloConfirmar="Divulgar"
        aoConfirmar={() =>
          divulgar.mutate(undefined, {
            onSuccess: (publicacao) => {
              definirConfirmando(false);
              const situacao = publicacao.contrato ? SITUACOES_ENVIO[publicacao.contrato.situacao].rotulo.toLowerCase() : 'na fila';
              avisar({
                tipo: publicacao.contrato?.situacao === 'erro' ? 'erro' : 'sucesso',
                titulo: 'Divulgação enviada',
                mensagem: publicacao.contrato?.numeroControle
                  ? `Contrato divulgado no PNCP sob o nº ${publicacao.contrato.numeroControle}.`
                  : `Situação do envio: ${situacao}.`,
              });
            },
          })
        }
        processando={divulgar.isPending}
        erro={divulgar.error}
      />
    </Secao>
  );
}
