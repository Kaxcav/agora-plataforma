import { useState, type FormEvent } from 'react';
import { CalendarPlus } from 'lucide-react';
import type { ContratoDetalhe, NaturezaDuracaoContrato } from '@agora/contratos';
import { formatarData, validarDataISO, type Centavos } from '@agora/dominio';
import { ErroApi, mensagemDeErro } from '../../api/cliente';
import { useProrrogarContrato, useRegularidadeContrato } from '../../api/regularidade';
import { Alerta, AreaTexto, Botao, CampoMoeda, CampoTexto, ConteudoConsulta, Dialogo, EsqueletoTabela, Secao, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { ChecklistRegularidade } from '../regularidade/ChecklistRegularidade';
import { CamposTravasProrrogacao, travasVazias, type TravasProrrogacao } from './alteracoes/CamposTravasProrrogacao';

/**
 * Prorrogação da vigência (termo aditivo de prazo) com a trava do art. 91, § 4º (RN-09): o servidor consulta de novo
 * o CEIS e o CNEP e confere as certidões; com restrição, a prorrogação não é registrada e os motivos aparecem aqui.
 * Frente K: antes, as travas dos arts. 105 a 114 (RN-33), conforme a natureza do contrato.
 */

const MINIMO_JUSTIFICATIVA = 20;

interface ErrosProrrogacao {
  data?: string;
  justificativa?: string;
}

export function ProrrogacaoContrato({ contrato, natureza: naturezaContrato }: { contrato: ContratoDetalhe; natureza: NaturezaDuracaoContrato | null }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const regularidade = useRegularidadeContrato(contrato.id);
  const prorrogar = useProrrogarContrato(contrato.id);
  const [aberto, definirAberto] = useState(false);
  const [data, definirData] = useState('');
  const [valor, definirValor] = useState<Centavos | null>(0);
  const [justificativa, definirJustificativa] = useState('');
  const [erros, definirErros] = useState<ErrosProrrogacao>({});
  const [natureza, definirNatureza] = useState<NaturezaDuracaoContrato | ''>(naturezaContrato ?? '');
  const [travas, definirTravas] = useState<TravasProrrogacao>(travasVazias);
  const podeProrrogar = temPermissao('contratos:editar');
  const idFormulario = `formulario-prorrogar-${contrato.id}`;

  const fechar = () => {
    definirData('');
    definirValor(0);
    definirJustificativa('');
    definirErros({});
    definirTravas(travasVazias);
    prorrogar.reset();
    definirAberto(false);
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: ErrosProrrogacao = {};
    if (!validarDataISO(data)) novos.data = 'Informe a nova data de fim da vigência.';
    else if (data <= contrato.vigenciaFim) novos.data = `Informe uma data posterior a ${formatarData(contrato.vigenciaFim)}.`;
    if (justificativa.trim().length < MINIMO_JUSTIFICATIVA) novos.justificativa = `Justifique com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres.`;
    definirErros(novos);
    if (Object.keys(novos).length > 0) return;
    prorrogar.mutate(
      { novaVigenciaFim: data, valor: valor ?? 0, justificativa: justificativa.trim(), ...(natureza ? { natureza } : {}), ...travas },
      {
        onSuccess: (r) => {
          avisar({
            tipo: 'sucesso',
            titulo: 'Prorrogação registrada',
            mensagem: `${r.aditivo.numero}: vigência até ${formatarData(r.aditivo.novaVigenciaFim ?? data)}. Verificação de regularidade registrada.`,
          });
          fechar();
        },
      },
    );
  };

  const erro = prorrogar.error;
  return (
    <Secao
      titulo="Prorrogação da vigência (RN-09 e RN-33)"
      id="prorrogacao-contrato"
      descricao={
        <p>
          Antes de prorrogar, a Ágora confere a vigência máxima e as condições da natureza do contrato (arts. 105 a 114), consulta o CEIS e o
          CNEP e confere as certidões fiscal federal, do FGTS e trabalhista do contratado (art. 91, § 4º). Sanção vigente ou certidão ausente,
          vencida ou positiva bloqueiam a prorrogação.
        </p>
      }
      acoes={
        podeProrrogar ? (
          <Botao variante="primario" icone={CalendarPlus} onClick={() => definirAberto(true)}>
            Registrar prorrogação
          </Botao>
        ) : null
      }
    >
      <ConteudoConsulta consulta={regularidade} carregando={<EsqueletoTabela linhas={4} />} rotuloCarregando="Carregando a regularidade do contratado">
        {(dados) => <ChecklistRegularidade checklist={dados} titulo="Regularidade do contratado" idTitulo={`regularidade-contrato-${contrato.id}`} />}
      </ConteudoConsulta>

      {podeProrrogar ? (
        <Dialogo
          aberto={aberto}
          aoFechar={prorrogar.isPending ? () => undefined : fechar}
          titulo="Registrar prorrogação"
          largura="media"
          descricao={
            <p>
              Registra o termo aditivo de prazo do contrato {contrato.numero} (vigência atual até {formatarData(contrato.vigenciaFim)}). O
              servidor executa antes o checklist de regularidade; havendo restrição, nada é gravado além da verificação.
            </p>
          }
          rodape={
            <>
              <Botao variante="secundario" onClick={fechar} disabled={prorrogar.isPending}>
                Cancelar
              </Botao>
              <Botao variante="primario" type="submit" form={idFormulario} carregando={prorrogar.isPending}>
                Verificar e prorrogar
              </Botao>
            </>
          }
        >
          <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
            <CampoTexto
              rotulo="Nova data de fim da vigência"
              type="date"
              obrigatorio
              value={data}
              min={contrato.vigenciaFim}
              onChange={(e) => definirData(e.target.value)}
              erro={erros.data}
            />
            <CampoMoeda
              rotulo="Valor do aditivo"
              valor={valor}
              aoMudar={definirValor}
              ajuda="Valor correspondente ao período prorrogado, quando houver. Use zero se não houver acréscimo de valor."
            />
            <AreaTexto
              rotulo="Justificativa"
              obrigatorio
              rows={4}
              maxLength={5000}
              contador
              value={justificativa}
              onChange={(e) => definirJustificativa(e.target.value)}
              erro={erros.justificativa}
              ajuda="Fundamente a prorrogação (por exemplo, serviço contínuo com preços vantajosos — art. 107) e cite o processo SEI."
            />
            <CamposTravasProrrogacao naturezaContrato={naturezaContrato} natureza={natureza} aoMudarNatureza={definirNatureza} travas={travas} aoMudar={definirTravas} />
            {erro ? (
              <Alerta tipo="erro" anunciar titulo="A prorrogação não foi registrada">
                <p>{mensagemDeErro(erro)}</p>
                {erro instanceof ErroApi && erro.detalhes.length > 0 ? (
                  <ul>
                    {erro.detalhes.map((d, i) => (
                      <li key={i}>
                        {d.campo ? <strong>{d.campo}: </strong> : null}
                        {d.mensagem}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {erro instanceof ErroApi && erro.idRequisicao ? (
                  <p className="texto-pequeno">
                    Código para o suporte: <code>{erro.idRequisicao}</code>
                  </p>
                ) : null}
              </Alerta>
            ) : null}
          </form>
        </Dialogo>
      ) : null}
    </Secao>
  );
}
