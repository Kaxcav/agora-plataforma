import { useState, type FormEvent } from 'react';
import type { AlteracaoContratual, EfeitoExtincaoContrato, ResultadoParecerAlteracao } from '@agora/contratos';
import { formatarData, formatarMoeda, validarDataISO, type Centavos } from '@agora/dominio';
import {
  useAssinarAlteracao,
  useDecidirExtincao,
  useDefesaExtincao,
  useDivulgarTermo,
  useIndeferirAlteracao,
  useParecerAlteracao,
} from '../../../api/alteracoes';
import { AreaTexto, Botao, CaixaSelecao, CampoMoeda, CampoTexto, Dialogo, Etiqueta, GrupoOpcoes, LinkExterno, ListaDefinicoes, useAvisos } from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { AlertaErro } from './AlertaErro';
import { DIVULGACAO_ALTERACAO, EFEITOS_EXTINCAO, ESPECIES_ALTERACAO, SITUACOES_ALTERACAO, TIPOS_ALTERACAO, hojeLocal, tituloAlteracao } from './rotulos';

type Acao = 'parecer' | 'assinar' | 'indeferir' | 'defesa' | 'decidir' | null;

const RESULTADOS_PARECER: readonly { valor: ResultadoParecerAlteracao; rotulo: string }[] = [
  { valor: 'favoravel', rotulo: 'Favorável' },
  { valor: 'favoravel_com_ressalvas', rotulo: 'Favorável com ressalvas' },
  { valor: 'desfavoravel', rotulo: 'Desfavorável' },
];

function valorComSinal(valor: number): string {
  return valor < 0 ? `− ${formatarMoeda(Math.abs(valor))}` : formatarMoeda(valor);
}

/** Detalhe de um ato do histórico, com os próximos passos que o perfil pode dar (o servidor confere a permissão). */
export function DialogoAlteracao({ contratoId, alteracao, aoFechar }: { contratoId: string; alteracao: AlteracaoContratual; aoFechar: () => void }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const parecer = useParecerAlteracao(contratoId);
  const assinar = useAssinarAlteracao(contratoId);
  const indeferir = useIndeferirAlteracao(contratoId);
  const defesa = useDefesaExtincao(contratoId);
  const decidir = useDecidirExtincao(contratoId);
  const divulgar = useDivulgarTermo(contratoId);
  const [acao, definirAcao] = useState<Acao>(null);
  const [resultado, definirResultado] = useState<ResultadoParecerAlteracao | null>(null);
  const [numeroParecer, definirNumeroParecer] = useState('');
  const [texto, definirTexto] = useState('');
  const [confirmado, definirConfirmado] = useState(false);
  const [valorReconhecido, definirValorReconhecido] = useState<Centavos | null>(alteracao.tipo === 'reequilibrio' ? Math.abs(alteracao.valor) : null);
  const [semManifestacao, definirSemManifestacao] = useState(false);
  const [dataDefesa, definirDataDefesa] = useState(hojeLocal());
  const [decisao, definirDecisao] = useState<'extinguir' | 'arquivar'>('extinguir');
  const [dataEfeitos, definirDataEfeitos] = useState(hojeLocal());
  const [culpa, definirCulpa] = useState(false);
  const [efeitos, definirEfeitos] = useState<EfeitoExtincaoContrato[]>([]);
  const [ministro, definirMinistro] = useState(false);
  const [erroLocal, definirErroLocal] = useState<string | null>(null);
  const idFormulario = `formulario-alteracao-${alteracao.id}`;
  const situacao = SITUACOES_ALTERACAO[alteracao.situacao];
  const divulgacao = DIVULGACAO_ALTERACAO[alteracao.divulgacao.situacao];
  const titulo = tituloAlteracao(alteracao);
  const mutacoes = [parecer, assinar, indeferir, defesa, decidir, divulgar];
  const processando = mutacoes.some((m) => m.isPending);
  const erro = mutacoes.find((m) => m.error)?.error ?? null;

  const concluir = (mensagem: string) => (resultado: AlteracaoContratual) => {
    avisar({ tipo: 'sucesso', titulo: mensagem, mensagem: `${resultado.numero ?? titulo}: ${SITUACOES_ALTERACAO[resultado.situacao].rotulo.toLowerCase()}.` });
    definirAcao(null);
    aoFechar();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirErroLocal(null);
    const alvo = { alteracaoId: alteracao.id };
    if (acao === 'parecer') {
      if (!resultado || numeroParecer.trim().length < 3 || texto.trim().length < 20) {
        definirErroLocal('Escolha o resultado, informe o número do parecer e escreva a conclusão (20 caracteres ou mais).');
        return;
      }
      parecer.mutate({ ...alvo, entrada: { resultado, numero: numeroParecer.trim(), texto: texto.trim() } }, { onSuccess: concluir('Parecer registrado') });
    } else if (acao === 'assinar') {
      if (!confirmado) {
        definirErroLocal('Confirme a assinatura do termo.');
        return;
      }
      assinar.mutate(
        {
          ...alvo,
          entrada: {
            confirmacao: true,
            ...(alteracao.tipo === 'reequilibrio' && valorReconhecido ? { valorReconhecido } : {}),
            ...(texto.trim() ? { fundamentacao: texto.trim() } : {}),
          },
        },
        { onSuccess: concluir('Termo aditivo assinado') },
      );
    } else if (acao === 'indeferir') {
      if (texto.trim().length < 20) {
        definirErroLocal('Fundamente o indeferimento com pelo menos 20 caracteres.');
        return;
      }
      indeferir.mutate({ ...alvo, entrada: { fundamentacao: texto.trim() } }, { onSuccess: concluir('Alteração indeferida') });
    } else if (acao === 'defesa') {
      if (!semManifestacao && (!validarDataISO(dataDefesa) || texto.trim().length < 20)) {
        definirErroLocal('Informe a data da defesa e resuma os argumentos (20 caracteres ou mais).');
        return;
      }
      defesa.mutate(
        { ...alvo, entrada: semManifestacao ? { semManifestacao: true } : { apresentadaEm: dataDefesa, resumo: texto.trim() } },
        { onSuccess: concluir('Defesa registrada') },
      );
    } else if (acao === 'decidir') {
      if (!validarDataISO(dataEfeitos) || texto.trim().length < 30) {
        definirErroLocal('Informe a data dos efeitos e fundamente a decisão (30 caracteres ou mais).');
        return;
      }
      decidir.mutate(
        {
          ...alvo,
          entrada: {
            decisao,
            dataEfeitos,
            fundamentacao: texto.trim(),
            culpaAdministracao: culpa,
            efeitos: decisao === 'extinguir' ? efeitos : [],
            ...(efeitos.includes('ocupacao_local') ? { autorizacaoMinistro: ministro } : {}),
          },
        },
        { onSuccess: concluir(decisao === 'extinguir' ? 'Extinção decidida' : 'Processo de extinção arquivado') },
      );
    }
  };

  const abrir = (nova: Acao) => () => {
    for (const m of mutacoes) m.reset();
    definirErroLocal(null);
    definirTexto('');
    definirConfirmado(false);
    definirAcao(nova);
  };

  const podeDecidir = temPermissao('alteracoes:decidir');
  const podeEditar = temPermissao('contratos:editar');
  const botoes = acao
    ? null
    : [
        alteracao.acoes.parecer && temPermissao('alteracoes:parecer') ? (
          <Botao key="parecer" variante="primario" onClick={abrir('parecer')}>
            Registrar parecer jurídico
          </Botao>
        ) : null,
        alteracao.acoes.assinar && podeDecidir ? (
          <Botao key="assinar" variante="primario" onClick={abrir('assinar')}>
            {alteracao.tipo === 'reequilibrio' ? 'Deferir e assinar' : 'Assinar termo aditivo'}
          </Botao>
        ) : null,
        alteracao.acoes.defesa && podeEditar ? (
          <Botao key="defesa" variante="primario" onClick={abrir('defesa')}>
            Registrar defesa
          </Botao>
        ) : null,
        alteracao.acoes.decidirExtincao && podeDecidir ? (
          <Botao key="decidir" variante="primario" onClick={abrir('decidir')}>
            Decidir a extinção
          </Botao>
        ) : null,
        alteracao.acoes.indeferir && podeDecidir ? (
          <Botao key="indeferir" variante="secundario" onClick={abrir('indeferir')}>
            Indeferir
          </Botao>
        ) : null,
        alteracao.acoes.divulgar && podeDecidir ? (
          <Botao key="divulgar" variante="secundario" onClick={() => divulgar.mutate(alteracao.id, { onSuccess: concluir('Divulgação reenviada ao PNCP') })} carregando={divulgar.isPending}>
            Reenviar ao PNCP
          </Botao>
        ) : null,
      ].filter(Boolean);

  const ROTULOS_ACAO: Record<Exclude<Acao, null>, string> = {
    parecer: 'Registrar parecer',
    assinar: alteracao.tipo === 'reequilibrio' ? 'Deferir e assinar' : 'Assinar',
    indeferir: 'Indeferir',
    defesa: 'Registrar defesa',
    decidir: 'Registrar decisão',
  };

  return (
    <Dialogo
      aberto
      aoFechar={processando ? () => undefined : aoFechar}
      titulo={titulo}
      largura="ampla"
      descricao={
        <p>
          {ESPECIES_ALTERACAO[alteracao.especie]} — {TIPOS_ALTERACAO[alteracao.tipo].toLowerCase()}. <Etiqueta tom={situacao.tom}>{situacao.rotulo}</Etiqueta>
        </p>
      }
      rodape={
        acao ? (
          <>
            <Botao variante="secundario" onClick={() => definirAcao(null)} disabled={processando}>
              Voltar
            </Botao>
            <Botao variante={acao === 'indeferir' ? 'perigo' : 'primario'} type="submit" form={idFormulario} carregando={processando}>
              {ROTULOS_ACAO[acao]}
            </Botao>
          </>
        ) : (
          <>
            {botoes}
            <Botao variante="secundario" onClick={aoFechar}>
              Fechar
            </Botao>
          </>
        )
      }
    >
      <div className="pilha">
        <ListaDefinicoes
          colunas={2}
          itens={[
            { termo: 'Valor', valor: <span className="numero">{alteracao.valor === 0 ? 'Sem reflexo no valor' : valorComSinal(alteracao.valor)}</span> },
            ...(alteracao.novaVigenciaFim ? [{ termo: 'Nova vigência', valor: <span className="numero">até {formatarData(alteracao.novaVigenciaFim)}</span> }] : []),
            { termo: 'Proposto por', valor: alteracao.propostoPor ? `${alteracao.propostoPor.nome}, em ${formatarData(alteracao.propostoEm.slice(0, 10))}` : 'Registro importado' },
            ...(alteracao.assinadoEm ? [{ termo: 'Assinado', valor: `${formatarData(alteracao.assinadoEm)}${alteracao.assinadoPor ? ` por ${alteracao.assinadoPor.nome}` : ''}` }] : []),
            ...alteracao.detalhes.map((d) => ({ termo: d.rotulo, valor: d.valor, largo: d.valor.length > 60 })),
            { termo: 'Justificativa', valor: alteracao.justificativa, largo: true },
          ]}
        />
        {alteracao.avaliacao ? (
          <p className="texto-secundario">
            {alteracao.avaliacao.explicacao} <span className="texto-pequeno">Fundamento: {alteracao.avaliacao.fundamento}.</span>
          </p>
        ) : null}
        {alteracao.parecer ? (
          <p>
            <strong>Parecer jurídico nº {alteracao.parecer.numero}</strong> ({RESULTADOS_PARECER.find((r) => r.valor === alteracao.parecer?.resultado)?.rotulo.toLowerCase()}
            {alteracao.parecer.emitidoPor ? `, por ${alteracao.parecer.emitidoPor.nome}` : ''}): {alteracao.parecer.texto}
          </p>
        ) : null}
        {alteracao.contraditorio ? (
          <p>
            <strong>Contraditório:</strong> prazo de {alteracao.contraditorio.prazoDiasUteis} dias úteis, até {formatarData(alteracao.contraditorio.prazoFim)}.{' '}
            {alteracao.contraditorio.defesa
              ? `Defesa apresentada em ${formatarData(alteracao.contraditorio.defesa.apresentadaEm)}: ${alteracao.contraditorio.defesa.resumo}`
              : alteracao.contraditorio.semManifestacao
                ? 'O contratado não se manifestou no prazo.'
                : 'Aguardando a defesa do contratado.'}
          </p>
        ) : null}
        {alteracao.decisao ? (
          <p>
            <strong>Decisão ({alteracao.decisao.resultado.replace(/_/g, ' ')})</strong>
            {alteracao.decisao.decididoPor ? ` por ${alteracao.decisao.decididoPor.nome}` : ''}: {alteracao.decisao.fundamentacao}
          </p>
        ) : null}
        {alteracao.situacao === 'assinado' && alteracao.origem === 'agora' ? (
          <div className="pilha pilha--compacta">
            <p>
              <Etiqueta tom={divulgacao.tom}>{divulgacao.rotulo}</Etiqueta>
              {alteracao.divulgacao.modo === 'offline' && alteracao.divulgacao.protocolo ? <span className="texto-pequeno texto-secundario"> Simulação (integrações em modo offline).</span> : null}
            </p>
            {alteracao.divulgacao.protocolo ? (
              <p className="texto-pequeno">
                Protocolo: <code>{alteracao.divulgacao.protocolo}</code>
              </p>
            ) : null}
            {alteracao.divulgacao.ultimoErro ? <p className="texto-pequeno">Motivo: {alteracao.divulgacao.ultimoErro}</p> : null}
            {alteracao.divulgacao.prazo ? <p className="texto-pequeno texto-secundario">{alteracao.divulgacao.prazo.explicacao}</p> : null}
            {alteracao.linkTermo ? (
              <LinkExterno href={alteracao.linkTermo} comoBotao="secundario">
                Termo em PDF
              </LinkExterno>
            ) : null}
          </div>
        ) : null}

        {acao ? (
          <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
            {acao === 'parecer' ? (
              <>
                <GrupoOpcoes legenda="Resultado do parecer" nome={`parecer-${alteracao.id}`} opcoes={RESULTADOS_PARECER} valor={resultado} aoMudar={definirResultado} obrigatorio horizontal />
                <CampoTexto rotulo="Número do parecer" obrigatorio maxLength={60} value={numeroParecer} onChange={(e) => definirNumeroParecer(e.target.value)} />
                <AreaTexto rotulo="Conclusão do parecer" obrigatorio rows={4} maxLength={5000} contador value={texto} onChange={(e) => definirTexto(e.target.value)} />
              </>
            ) : null}
            {acao === 'assinar' ? (
              <>
                {alteracao.tipo === 'reequilibrio' ? (
                  <>
                    <CampoMoeda rotulo="Valor reconhecido" valor={valorReconhecido} aoMudar={definirValorReconhecido} ajuda="Igual ou menor que o valor pleiteado." />
                    <AreaTexto rotulo="Fundamentação da decisão" rows={3} maxLength={5000} value={texto} onChange={(e) => definirTexto(e.target.value)} />
                  </>
                ) : null}
                <p className="texto-secundario">
                  Antes de registrar, a Ágora consulta de novo o CEIS e o CNEP e confere as certidões do contratado (art. 91, § 4º) e repete as travas. Depois da assinatura, o termo segue para o PNCP pela fila de integrações.
                </p>
                <CaixaSelecao rotulo="Confirmo a assinatura do termo como autoridade competente" checked={confirmado} onChange={(e) => definirConfirmado(e.target.checked)} />
              </>
            ) : null}
            {acao === 'indeferir' ? (
              <AreaTexto rotulo="Fundamentação do indeferimento" obrigatorio rows={4} maxLength={5000} contador value={texto} onChange={(e) => definirTexto(e.target.value)} />
            ) : null}
            {acao === 'defesa' ? (
              <>
                <CaixaSelecao
                  rotulo="O contratado não apresentou defesa no prazo"
                  ajuda={alteracao.contraditorio ? `Só depois de ${formatarData(alteracao.contraditorio.prazoFim)}.` : undefined}
                  checked={semManifestacao}
                  onChange={(e) => definirSemManifestacao(e.target.checked)}
                />
                {!semManifestacao ? (
                  <>
                    <CampoTexto rotulo="Data da defesa" type="date" obrigatorio max={hojeLocal()} value={dataDefesa} onChange={(e) => definirDataDefesa(e.target.value)} />
                    <AreaTexto rotulo="Resumo da defesa" obrigatorio rows={4} maxLength={5000} contador value={texto} onChange={(e) => definirTexto(e.target.value)} />
                  </>
                ) : null}
              </>
            ) : null}
            {acao === 'decidir' ? (
              <>
                <GrupoOpcoes
                  legenda="Decisão"
                  nome={`decisao-${alteracao.id}`}
                  horizontal
                  opcoes={[
                    { valor: 'extinguir', rotulo: 'Extinguir o contrato' },
                    { valor: 'arquivar', rotulo: 'Arquivar o processo' },
                  ]}
                  valor={decisao}
                  aoMudar={definirDecisao}
                />
                {decisao === 'extinguir' ? (
                  <>
                    <CampoTexto rotulo="Efeitos a partir de" type="date" obrigatorio value={dataEfeitos} onChange={(e) => definirDataEfeitos(e.target.value)} />
                    <CaixaSelecao rotulo="A extinção decorre de culpa exclusiva da Administração (art. 138, § 2º)" checked={culpa} onChange={(e) => definirCulpa(e.target.checked)} />
                    <fieldset className="pilha pilha--compacta">
                      <legend>Efeitos decididos pela autoridade</legend>
                      {(Object.keys(EFEITOS_EXTINCAO) as EfeitoExtincaoContrato[]).map((efeito) => (
                        <CaixaSelecao
                          key={efeito}
                          rotulo={EFEITOS_EXTINCAO[efeito]}
                          checked={efeitos.includes(efeito)}
                          onChange={(e) => definirEfeitos(e.target.checked ? [...efeitos, efeito] : efeitos.filter((x) => x !== efeito))}
                        />
                      ))}
                    </fieldset>
                    {efeitos.includes('ocupacao_local') ? (
                      <CaixaSelecao rotulo="Há autorização expressa do ministro de Estado (art. 139, § 2º)" checked={ministro} onChange={(e) => definirMinistro(e.target.checked)} />
                    ) : null}
                  </>
                ) : null}
                <AreaTexto rotulo="Fundamentação da decisão" obrigatorio rows={4} maxLength={5000} contador value={texto} onChange={(e) => definirTexto(e.target.value)} />
              </>
            ) : null}
            {erroLocal ? <p className="campo__erro" role="alert">{erroLocal}</p> : null}
            <AlertaErro erro={erro} titulo="A operação não foi concluída" />
          </form>
        ) : (
          <AlertaErro erro={erro} titulo="A operação não foi concluída" />
        )}
      </div>
    </Dialogo>
  );
}
