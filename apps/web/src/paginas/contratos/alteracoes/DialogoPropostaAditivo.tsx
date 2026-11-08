import { useState, type FormEvent } from 'react';
import type { EnquadramentoReequilibrio, EntradaProporAlteracao, NaturezaDuracaoContrato, PainelAlteracoesContrato } from '@agora/contratos';
import { formatarData, formatarMoeda, validarDataISO, type Centavos } from '@agora/dominio';
import { useProporAlteracao } from '../../../api/alteracoes';
import { useMatrizRiscosContrato } from '../../../api/controle';
import { AreaTexto, Botao, CaixaSelecao, CampoMoeda, CampoTexto, Dialogo, GrupoOpcoes, Selecao, useAvisos } from '../../../componentes';
import { AlertaErro } from './AlertaErro';
import { CamposTravasProrrogacao, travasVazias, type TravasProrrogacao } from './CamposTravasProrrogacao';
import { ENQUADRAMENTOS, hojeLocal } from './rotulos';

type TipoProposta = EntradaProporAlteracao['tipo'];

const TIPOS: readonly { valor: TipoProposta; rotulo: string; ajuda: string }[] = [
  { valor: 'acrescimo', rotulo: 'Acréscimo quantitativo', ajuda: 'Conta no limite de 25% (50% em reforma) do art. 125.' },
  { valor: 'supressao', rotulo: 'Supressão quantitativa', ajuda: 'Conta no limite de 25% do art. 125.' },
  { valor: 'qualitativa', rotulo: 'Alteração qualitativa', ajuda: 'Mudança do projeto ou das especificações (art. 124, I, "a"); o reflexo no valor conta no limite.' },
  { valor: 'prazo', rotulo: 'Prorrogação da vigência', ajuda: 'Segue os limites dos arts. 105 a 114 (RN-33).' },
  { valor: 'reequilibrio', rotulo: 'Reequilíbrio econômico-financeiro', ajuda: 'Pedido instruído e decidido pela autoridade (art. 124, II, "d"); não conta no art. 125.' },
];

const MINIMO_JUSTIFICATIVA = 30;

interface Props {
  contratoId: string;
  numero: string;
  vigenciaFim: string;
  painel: PainelAlteracoesContrato;
  aberto: boolean;
  aoFechar: () => void;
}

/** Proposta de termo aditivo (RN-32): a API confere o limite do art. 125 e recusa acima dele; depois vem o parecer jurídico. */
export function DialogoPropostaAditivo({ contratoId, numero, vigenciaFim, painel, aberto, aoFechar }: Props) {
  const { avisar } = useAvisos();
  const propor = useProporAlteracao(contratoId);
  const matriz = useMatrizRiscosContrato(contratoId);
  const [tipo, definirTipo] = useState<TipoProposta>('acrescimo');
  const [valor, definirValor] = useState<Centavos | null>(null);
  const [reforma, definirReforma] = useState(false);
  const [efeito, definirEfeito] = useState<'acrescimo' | 'supressao' | 'nenhum'>('nenhum');
  const [descricao, definirDescricao] = useState('');
  const [novaVigencia, definirNovaVigencia] = useState('');
  const [natureza, definirNatureza] = useState<NaturezaDuracaoContrato | ''>(painel.natureza ?? '');
  const [travas, definirTravas] = useState<TravasProrrogacao>(travasVazias);
  const [enquadramento, definirEnquadramento] = useState<EnquadramentoReequilibrio>('fato_imprevisivel');
  const [riscoId, definirRiscoId] = useState('');
  const [dataEvento, definirDataEvento] = useState('');
  const [solicitadoEm, definirSolicitadoEm] = useState(hojeLocal());
  const [solicitante, definirSolicitante] = useState<'contratada' | 'administracao'>('contratada');
  const [sentido, definirSentido] = useState<'aumento' | 'reducao'>('aumento');
  const [demonstracao, definirDemonstracao] = useState('');
  const [justificativa, definirJustificativa] = useState('');
  const [erros, definirErros] = useState<Record<string, string>>({});
  const idFormulario = `formulario-proposta-${contratoId}`;

  const fechar = () => {
    definirTipo('acrescimo');
    definirValor(null);
    definirReforma(false);
    definirEfeito('nenhum');
    definirDescricao('');
    definirNovaVigencia('');
    definirTravas(travasVazias);
    definirDataEvento('');
    definirDemonstracao('');
    definirJustificativa('');
    definirErros({});
    propor.reset();
    aoFechar();
  };

  const montar = (): EntradaProporAlteracao | null => {
    const novos: Record<string, string> = {};
    if (justificativa.trim().length < MINIMO_JUSTIFICATIVA) novos['justificativa'] = `Justifique com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres.`;
    let entrada: EntradaProporAlteracao | null = null;
    if (tipo === 'acrescimo' || tipo === 'supressao') {
      if (!valor || valor <= 0) novos['valor'] = 'Informe o valor da alteração.';
      entrada = { tipo, valor: valor ?? 0, reformaEdificioOuEquipamento: reforma, justificativa: justificativa.trim() };
    } else if (tipo === 'qualitativa') {
      if (descricao.trim().length < 10) novos['descricao'] = 'Descreva a alteração do projeto ou das especificações.';
      if (efeito !== 'nenhum' && (!valor || valor <= 0)) novos['valor'] = 'Informe o valor do reflexo financeiro.';
      entrada = { tipo, valor: efeito === 'nenhum' ? 0 : (valor ?? 0), efeitoFinanceiro: efeito, descricaoAlteracao: descricao.trim(), justificativa: justificativa.trim() };
    } else if (tipo === 'prazo') {
      if (!validarDataISO(novaVigencia)) novos['novaVigencia'] = 'Informe a nova data de fim da vigência.';
      else if (novaVigencia <= vigenciaFim) novos['novaVigencia'] = `Informe uma data posterior a ${formatarData(vigenciaFim)}.`;
      entrada = {
        tipo,
        novaVigenciaFim: novaVigencia,
        valor: valor ?? 0,
        justificativa: justificativa.trim(),
        ...(natureza ? { natureza } : {}),
        ...travas,
      };
    } else {
      if (!validarDataISO(dataEvento)) novos['dataEvento'] = 'Informe a data do evento.';
      if (!valor || valor <= 0) novos['valor'] = 'Informe o valor pleiteado.';
      if (demonstracao.trim().length < 50) novos['demonstracao'] = 'Descreva a demonstração do desequilíbrio com pelo menos 50 caracteres.';
      entrada = {
        tipo,
        enquadramento,
        riscoId: riscoId || null,
        dataEvento,
        solicitadoEm,
        solicitante,
        sentido,
        valor: valor ?? 0,
        demonstracao: demonstracao.trim(),
        justificativa: justificativa.trim(),
      };
    }
    definirErros(novos);
    return Object.keys(novos).length === 0 ? entrada : null;
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const entrada = montar();
    if (!entrada) return;
    propor.mutate(entrada, {
      onSuccess: () => {
        avisar({ tipo: 'sucesso', titulo: 'Termo aditivo proposto', mensagem: 'A proposta segue para o parecer jurídico (art. 53, § 4º).' });
        fechar();
      },
    });
  };

  const margem = tipo === 'supressao' ? painel.limites.margemSupressoes : painel.limites.margemAcrescimos;
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={propor.isPending ? () => undefined : fechar}
      titulo="Propor termo aditivo"
      largura="ampla"
      descricao={
        <p>
          Contrato {numero}. A Ágora confere as travas na proposta e de novo na assinatura: acima do limite do art. 125 a alteração não é registrada.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={propor.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={propor.isPending}>
            Propor termo aditivo
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <GrupoOpcoes legenda="Tipo de alteração" nome={`tipo-aditivo-${contratoId}`} opcoes={TIPOS} valor={tipo} aoMudar={definirTipo} obrigatorio />

        {tipo === 'acrescimo' || tipo === 'supressao' ? (
          <>
            <CampoMoeda
              rotulo={tipo === 'acrescimo' ? 'Valor do acréscimo' : 'Valor da supressão'}
              valor={valor}
              aoMudar={definirValor}
              obrigatorio
              erro={erros['valor']}
              ajuda={`Margem atual até o limite de ${tipo === 'supressao' ? painel.limites.limiteSupressoes : painel.limites.limiteAcrescimos}%: ${formatarMoeda(margem)}.`}
            />
            {tipo === 'acrescimo' ? (
              <CaixaSelecao
                rotulo="Reforma de edifício ou de equipamento"
                ajuda="Eleva o limite de acréscimos para 50% (art. 125)."
                checked={reforma}
                onChange={(e) => definirReforma(e.target.checked)}
              />
            ) : null}
          </>
        ) : null}

        {tipo === 'qualitativa' ? (
          <>
            <AreaTexto rotulo="Alteração do projeto ou das especificações" obrigatorio rows={3} maxLength={2000} value={descricao} onChange={(e) => definirDescricao(e.target.value)} erro={erros['descricao']} />
            <GrupoOpcoes
              legenda="Reflexo no valor do contrato"
              nome={`efeito-${contratoId}`}
              horizontal
              opcoes={[
                { valor: 'nenhum', rotulo: 'Sem reflexo' },
                { valor: 'acrescimo', rotulo: 'Acréscimo' },
                { valor: 'supressao', rotulo: 'Supressão' },
              ]}
              valor={efeito}
              aoMudar={definirEfeito}
            />
            {efeito !== 'nenhum' ? <CampoMoeda rotulo="Valor do reflexo financeiro" valor={valor} aoMudar={definirValor} obrigatorio erro={erros['valor']} /> : null}
          </>
        ) : null}

        {tipo === 'prazo' ? (
          <>
            <CampoTexto
              rotulo="Nova data de fim da vigência"
              type="date"
              obrigatorio
              min={vigenciaFim}
              value={novaVigencia}
              onChange={(e) => definirNovaVigencia(e.target.value)}
              erro={erros['novaVigencia']}
              ajuda={painel.prorrogacao.limiteVigencia ? `Vigência máxima: ${formatarData(painel.prorrogacao.limiteVigencia)}.` : undefined}
            />
            <CampoMoeda rotulo="Valor do período prorrogado" valor={valor} aoMudar={definirValor} ajuda="Use zero se não houver valor." />
            <CamposTravasProrrogacao naturezaContrato={painel.natureza} natureza={natureza} aoMudarNatureza={definirNatureza} travas={travas} aoMudar={definirTravas} />
          </>
        ) : null}

        {tipo === 'reequilibrio' ? (
          <>
            <Selecao
              rotulo="Enquadramento do evento"
              obrigatorio
              value={enquadramento}
              onChange={(e) => definirEnquadramento(e.target.value as EnquadramentoReequilibrio)}
              opcoes={Object.entries(ENQUADRAMENTOS).map(([v, r]) => ({ valor: v, rotulo: r }))}
            />
            <Selecao
              rotulo="Risco da matriz de riscos"
              value={riscoId}
              onChange={(e) => definirRiscoId(e.target.value)}
              opcaoVazia="Evento não previsto na matriz"
              opcoes={(matriz.data?.riscos ?? []).map((r) => ({ valor: r.id, rotulo: `${r.descricao} — risco da ${r.alocacao === 'contratante' ? 'contratante' : r.alocacao === 'contratada' ? 'contratada' : 'ambas as partes'}` }))}
              ajuda="Risco alocado à contratada não gera reequilíbrio, salvo tributo novo ou alteração unilateral (art. 103, § 5º)."
            />
            <CampoTexto rotulo="Data do evento" type="date" obrigatorio max={hojeLocal()} value={dataEvento} onChange={(e) => definirDataEvento(e.target.value)} erro={erros['dataEvento']} />
            <CampoTexto rotulo="Data do pedido" type="date" obrigatorio max={hojeLocal()} value={solicitadoEm} onChange={(e) => definirSolicitadoEm(e.target.value)} />
            <GrupoOpcoes
              legenda="Quem pediu"
              nome={`solicitante-${contratoId}`}
              horizontal
              opcoes={[
                { valor: 'contratada', rotulo: 'Contratada' },
                { valor: 'administracao', rotulo: 'Administração' },
              ]}
              valor={solicitante}
              aoMudar={definirSolicitante}
            />
            <GrupoOpcoes
              legenda="Efeito no preço"
              nome={`sentido-${contratoId}`}
              horizontal
              opcoes={[
                { valor: 'aumento', rotulo: 'Aumento' },
                { valor: 'reducao', rotulo: 'Redução' },
              ]}
              valor={sentido}
              aoMudar={definirSentido}
            />
            <CampoMoeda rotulo="Valor pleiteado" valor={valor} aoMudar={definirValor} obrigatorio erro={erros['valor']} />
            <AreaTexto
              rotulo="Demonstração do desequilíbrio"
              obrigatorio
              rows={4}
              maxLength={5000}
              contador
              value={demonstracao}
              onChange={(e) => definirDemonstracao(e.target.value)}
              erro={erros['demonstracao']}
              ajuda="Memória de cálculo e documentos (notas fiscais, cotações, norma tributária)."
            />
          </>
        ) : null}

        <AreaTexto
          rotulo="Justificativa"
          obrigatorio
          rows={4}
          maxLength={5000}
          contador
          value={justificativa}
          onChange={(e) => definirJustificativa(e.target.value)}
          erro={erros['justificativa']}
          ajuda="Fundamente a alteração (art. 124) e cite o processo SEI."
        />
        <AlertaErro erro={propor.error} titulo="A proposta não foi registrada" />
      </form>
    </Dialogo>
  );
}
