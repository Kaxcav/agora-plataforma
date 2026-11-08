/**
 * Etapa 4 — TR, edital e minuta: parâmetros do edital com prévia das vedações (RN-06), rascunhos com premissas
 * e fontes, visualização lado a lado e aprovação humana (RIA-04).
 */
import { useId, useState, type FormEvent } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import type { ParametrosEdital } from '@agora/contratos';
import { aplicarPercentual, formatarMoeda } from '@agora/dominio';
import { useSalvarParametrosEdital, type TipoDocumento } from '../../../api/jornada';
import { Alerta, Alternador, Botao, CampoTexto, Etiqueta, ListaDefinicoes, Selecao, useAvisos } from '../../../componentes';
import { opcoesDe } from '../../compartilhado/rotulos';
import { ErroOperacao, mesmoConteudo, Requisitos, textoOuNulo, type Requisito } from '../comum';
import { DocumentosEtapa, ultimaVersao } from '../Documentos';
import {
  CRITERIOS_JULGAMENTO,
  ehCriterioJulgamento,
  ehRegimeExecucao,
  REGIMES_EXECUCAO,
  TIPOS_DOCUMENTO,
  vedacoesEdital,
} from '../rotulos';
import { CamposParametrosSelecao, INVERSAO_VAZIA, itensParametrosSelecao, pendenciasParametrosSelecao, PROVA_CONCEITO_VAZIA } from './ParametrosSelecao';
import { SecaoSustentabilidade, sustentabilidadeCompleta } from './SecaoSustentabilidade';
import type { PropsEtapa } from './tipos';
import { LicoesAprendidas } from '../../licoes/LicoesAprendidas';
import { CriterioDesempenhoEdital } from '../../desempenho/CriterioDesempenhoEdital';

const TIPOS: readonly TipoDocumento[] = ['tr', 'edital', 'minuta_contrato'];

function textoPercentual(valor: number | null): string {
  return valor === null ? '' : String(valor).replace('.', ',');
}

/** "" → null (não exige); número válido ≥ 0 → valor; caso contrário, undefined (inválido). */
function lerPercentual(texto: string): number | null | undefined {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) && valor >= 0 ? valor : undefined;
}

/** "" → null; inteiro de 1 a 30 → valor; caso contrário, undefined (inválido). */
function lerPrazo(texto: string): number | null | undefined {
  const limpo = texto.trim();
  if (limpo === '') return null;
  const valor = Number(limpo);
  return Number.isInteger(valor) && valor >= 1 && valor <= 30 ? valor : undefined;
}

function ParametrosDoEdital({ processo, editavel }: PropsEtapa) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarParametrosEdital(processo.id);
  const [parametros, definirParametros] = useState<ParametrosEdital>(() => processo.parametrosEdital);
  const [textoPl, definirTextoPl] = useState(() => textoPercentual(processo.parametrosEdital.patrimonioLiquidoMinimoPercentual));
  const [textoPrazo, definirTextoPrazo] = useState(() => String(processo.parametrosEdital.provaConceito?.prazoDiasUteis ?? ''));
  const percentual = lerPercentual(textoPl);
  const prazo = lerPrazo(textoPrazo);
  const prova = parametros.provaConceito ?? PROVA_CONCEITO_VAZIA;
  const inversao = parametros.inversaoFases ?? INVERSAO_VAZIA;
  const atual: ParametrosEdital = {
    ...parametros,
    patrimonioLiquidoMinimoPercentual: percentual ?? null,
    provaConceito: { ...prova, prazoDiasUteis: prazo ?? null, roteiro: textoOuNulo(prova.roteiro ?? ''), justificativa: textoOuNulo(prova.justificativa ?? '') },
    inversaoFases: { ...inversao, motivacao: textoOuNulo(inversao.motivacao ?? '') },
  };
  const prazoInvalido = prova.exigencia !== 'nenhuma' && prazo === undefined;
  const pendenciasSelecao = pendenciasParametrosSelecao(atual.provaConceito ?? PROVA_CONCEITO_VAZIA, atual.inversaoFases ?? INVERSAO_VAZIA);
  const vedacoes = vedacoesEdital(atual);
  const alterado = !mesmoConteudo(atual, processo.parametrosEdital) || percentual === undefined || prazoInvalido;
  const limitePl = processo.valorEstimado !== null ? aplicarPercentual(processo.valorEstimado, 10) : null;
  const valorPl = processo.valorEstimado !== null && typeof percentual === 'number' ? aplicarPercentual(processo.valorEstimado, percentual) : null;

  const alterar = <K extends keyof ParametrosEdital>(campo: K, valor: ParametrosEdital[K]) => definirParametros((p) => ({ ...p, [campo]: valor }));

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (percentual === undefined) {
      document.getElementById(`${base}-pl`)?.focus();
      return;
    }
    if (prazoInvalido) {
      document.getElementById(`${base}-prazo-prova`)?.focus();
      return;
    }
    salvar.mutate(atual, {
      onSuccess: (atualizado) => {
        definirParametros(atualizado.parametrosEdital);
        definirTextoPl(textoPercentual(atualizado.parametrosEdital.patrimonioLiquidoMinimoPercentual));
        definirTextoPrazo(String(atualizado.parametrosEdital.provaConceito?.prazoDiasUteis ?? ''));
        const regerar = atualizado.documentos.filter((d) => d.geradoComParametrosAnteriores).length;
        avisar({
          tipo: vedacoes.length === 0 && regerar === 0 ? 'sucesso' : 'aviso',
          titulo: 'Parâmetros do edital salvos',
          mensagem:
            vedacoes.length > 0
              ? 'Há vedações a corrigir antes de avançar (RN-06).'
              : regerar > 0
                ? `Gere novamente e aprove ${regerar === 1 ? 'o documento afetado' : `os ${regerar} documentos afetados`} (RN-06).`
                : 'Nenhuma vedação de habilitação identificada.',
        });
      },
    });
  };

  if (!editavel) {
    const p = processo.parametrosEdital;
    const vedacoesSalvas = vedacoesEdital(p);
    return (
      <section className="secao jornada-subsecao" aria-labelledby={`${base}-titulo`}>
        <h3 id={`${base}-titulo`} className="secao__titulo">
          Parâmetros do edital
        </h3>
        <ListaDefinicoes
          colunas={2}
          itens={[
            { termo: 'Critério de julgamento', valor: CRITERIOS_JULGAMENTO[p.criterioJulgamento] },
            { termo: 'Regime de execução', valor: REGIMES_EXECUCAO[p.regimeExecucao] },
            { termo: 'Faturamento mínimo', valor: p.exigeFaturamentoMinimo ? 'Exigido (vedado)' : 'Não exigido' },
            {
              termo: 'Patrimônio líquido mínimo',
              valor: p.patrimonioLiquidoMinimoPercentual === null ? 'Não exigido' : `${textoPercentual(p.patrimonioLiquidoMinimoPercentual)}% do valor estimado`,
            },
            { termo: 'Registro cadastral complementar', valor: p.exigeRegistroCadastralComplementar ? 'Exigido (vedado)' : 'Não exigido' },
            ...itensParametrosSelecao(p.provaConceito ?? PROVA_CONCEITO_VAZIA, p.inversaoFases ?? INVERSAO_VAZIA),
          ]}
        />
        {vedacoesSalvas.length > 0 ? (
          <Alerta tipo="erro" compacto titulo="Vedações de habilitação (RN-06)">
            <ul>
              {vedacoesSalvas.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </Alerta>
        ) : null}
      </section>
    );
  }

  return (
    <form className="secao jornada-subsecao" onSubmit={enviar} noValidate aria-labelledby={`${base}-titulo`}>
      <div className="secao__cabecalho">
        <div>
          <h3 id={`${base}-titulo`} className="secao__titulo">
            Parâmetros do edital
          </h3>
          <p className="secao__descricao">Usados na redação do edital, no prazo mínimo de propostas (art. 55) e na verificação da habilitação.</p>
        </div>
        <Etiqueta tom={vedacoes.length === 0 ? 'sucesso' : 'erro'}>
          {vedacoes.length === 0 ? 'Sem vedações (RN-06)' : `${vedacoes.length === 1 ? '1 vedação' : `${vedacoes.length} vedações`} (RN-06)`}
        </Etiqueta>
      </div>
      <div className="formulario__linha">
        <Selecao
          rotulo="Critério de julgamento (art. 33)"
          obrigatorio
          opcoes={opcoesDe(CRITERIOS_JULGAMENTO)}
          value={parametros.criterioJulgamento}
          onChange={(e) => {
            const v = e.target.value;
            if (ehCriterioJulgamento(v)) alterar('criterioJulgamento', v);
          }}
        />
        <Selecao
          rotulo="Regime de execução (art. 46)"
          obrigatorio
          opcoes={opcoesDe(REGIMES_EXECUCAO)}
          value={parametros.regimeExecucao}
          onChange={(e) => {
            const v = e.target.value;
            if (ehRegimeExecucao(v)) alterar('regimeExecucao', v);
          }}
        />
      </div>
      <fieldset className="grupo-campos">
        <legend>Habilitação econômico-financeira e acesso ao edital</legend>
        <Alternador
          rotulo="Exige faturamento mínimo anterior"
          ligado={parametros.exigeFaturamentoMinimo}
          aoMudar={(v) => alterar('exigeFaturamentoMinimo', v)}
          ajuda="Vedado: não se exige faturamento mínimo nem índices de rentabilidade ou lucratividade (art. 69, § 2º)."
        />
        <CampoTexto
          id={`${base}-pl`}
          rotulo="Patrimônio líquido mínimo (% do valor estimado)"
          inputMode="decimal"
          className="jornada-campo-percentual"
          value={textoPl}
          onChange={(e) => definirTextoPl(e.target.value)}
          erro={
            percentual === undefined
              ? 'Informe um percentual numérico, por exemplo 5 ou 7,5 — ou deixe em branco para não exigir.'
              : percentual !== null && percentual > 10
                ? 'Máximo de 10% do valor estimado (art. 69, § 4º).'
                : null
          }
          ajuda={
            valorPl !== null && limitePl !== null
              ? `Equivale a ${formatarMoeda(valorPl)}; limite legal de ${formatarMoeda(limitePl)} (10% do valor estimado). Em branco: não exige.`
              : 'Até 10% do valor estimado, nas compras para entrega futura e na execução de obras e serviços (art. 69, § 4º). Em branco: não exige.'
          }
        />
        <Alternador
          rotulo="Exige registro cadastral complementar para acesso ao edital"
          ligado={parametros.exigeRegistroCadastralComplementar}
          aoMudar={(v) => alterar('exigeRegistroCadastralComplementar', v)}
          ajuda="Vedado: o edital e os anexos ficam acessíveis sem cadastro prévio (art. 87, § 2º; art. 25, § 3º)."
        />
      </fieldset>
      <CamposParametrosSelecao
        prova={prova}
        inversao={inversao}
        textoPrazo={textoPrazo}
        idPrazo={`${base}-prazo-prova`}
        erroPrazo={prazoInvalido ? 'Informe um número inteiro de dias úteis, de 1 a 30.' : null}
        aoMudarProva={(nova) => alterar('provaConceito', nova)}
        aoMudarInversao={(nova) => alterar('inversaoFases', nova)}
        aoMudarTextoPrazo={definirTextoPrazo}
      />
      <div aria-live="polite">
        {vedacoes.length > 0 ? (
          <Alerta tipo="erro" compacto titulo="O edital não pode avançar com estas exigências (RN-06)">
            <ul>
              {vedacoes.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </Alerta>
        ) : null}
        {pendenciasSelecao.length > 0 ? (
          <Alerta tipo="aviso" compacto titulo="Complete os parâmetros de seleção antes de avançar">
            <ul>
              {pendenciasSelecao.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </Alerta>
        ) : null}
      </div>
      <ErroOperacao erro={salvar.error} titulo="Não foi possível salvar os parâmetros do edital" />
      <div className="jornada-barra-acoes">
        <p className="texto-pequeno texto-secundario" aria-live="polite">
          {alterado ? 'Há alterações não salvas.' : 'Sem alterações pendentes.'}
        </p>
        <div className="linha">
          <Botao
            variante="terciario"
            icone={RotateCcw}
            disabled={!alterado || salvar.isPending}
            onClick={() => {
              definirParametros(processo.parametrosEdital);
              definirTextoPl(textoPercentual(processo.parametrosEdital.patrimonioLiquidoMinimoPercentual));
              definirTextoPrazo(String(processo.parametrosEdital.provaConceito?.prazoDiasUteis ?? ''));
              salvar.reset();
            }}
          >
            Descartar alterações
          </Botao>
          <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending} disabled={!alterado}>
            Salvar parâmetros
          </Botao>
        </div>
      </div>
    </form>
  );
}

export default function Etapa4Documentos(props: PropsEtapa) {
  const { processo, editavel } = props;
  // O servidor marca o TR, o edital e a minuta gerados com parâmetros anteriores e emite o sinal RN-06 com a lista.
  const sinalParametros = processo.sinais.find((s) => s.regra === 'RN-06');
  const desatualizados = TIPOS.flatMap((tipo) => {
    const doc = ultimaVersao(processo.documentos, tipo);
    return doc?.geradoComParametrosAnteriores ? [`${TIPOS_DOCUMENTO[tipo].rotulo} (versão ${doc.versao})`] : [];
  });
  const requisitos: Requisito[] = [
    ...TIPOS.map((tipo): Requisito => {
      const doc = ultimaVersao(processo.documentos, tipo);
      let detalhe: string | undefined = ' — ainda não gerado';
      if (doc?.geradoComParametrosAnteriores) detalhe = ` — versão ${doc.versao} gerada com parâmetros anteriores: gere nova versão`;
      else if (doc) detalhe = doc.situacao === 'aprovado' ? undefined : ` — versão ${doc.versao} em rascunho`;
      return {
        id: tipo,
        rotulo: `${TIPOS_DOCUMENTO[tipo].rotulo} gerado com os parâmetros atuais e aprovado após revisão humana`,
        atendido: doc?.situacao === 'aprovado' && !doc.geradoComParametrosAnteriores,
        detalhe,
      };
    }),
    {
      id: 'rn06',
      rotulo: 'Parâmetros do edital sem vedações de habilitação (RN-06, art. 69, §§ 2º e 4º; art. 87, § 2º)',
      atendido: vedacoesEdital(processo.parametrosEdital).length === 0,
      detalhe: ' — com os parâmetros salvos',
    },
    {
      id: 'rn20',
      rotulo: 'Prova de conceito ou amostra e inversão de fases bem instruídas, quando adotadas (RN-20, RN-22)',
      atendido:
        pendenciasParametrosSelecao(processo.parametrosEdital.provaConceito ?? PROVA_CONCEITO_VAZIA, processo.parametrosEdital.inversaoFases ?? INVERSAO_VAZIA)
          .length === 0,
      detalhe: ' — com os parâmetros salvos',
    },
    {
      id: 'rn21',
      rotulo: 'Critérios de sustentabilidade e logística reversa no TR (RN-21)',
      atendido: !processo.sustentabilidade.politicaObrigatoria || (sustentabilidadeCompleta(processo.sustentabilidade) && !processo.bloqueiosDetalhe.some((b) => b.regra === 'RN-21')),
      detalhe: processo.sustentabilidade.politicaObrigatoria ? undefined : ' — política do órgão desligada',
    },
  ];

  return (
    <div className="pilha pilha--ampla">
      <Alerta tipo="info" titulo="Redação assistida, decisão humana (RIA-04)">
        <p>
          Os rascunhos são montados com os dados do processo (DFD, ETP, matriz de riscos, pesquisa de preços e parâmetros do edital) por modelo
          de texto — ou por IA auto-hospedada, quando habilitada pelo órgão —, sempre com premissas e fontes. Nenhum documento produz efeito
          antes da aprovação por servidor responsável.
        </p>
      </Alerta>

      <ParametrosDoEdital {...props} />

      <SecaoSustentabilidade {...props} documento="tr" />

      {desatualizados.length > 0 ? (
        <Alerta tipo="aviso" titulo="Gere nova versão dos documentos afetados (RN-06)">
          <p>
            {sinalParametros?.mensagem ??
              `Os parâmetros do edital foram alterados depois da geração de: ${desatualizados.join('; ')}. Gere novamente e aprove antes de avançar à etapa 5.`}
          </p>
          <p className="texto-pequeno">
            Use “Gerar nova versão”. O servidor não aceita aprovar, nem conta como aprovada no avanço, a versão gerada com os parâmetros anteriores.
          </p>
        </Alerta>
      ) : null}

      <CriterioDesempenhoEdital {...props} />
      <LicoesAprendidas {...props} documento="tr" />

      <DocumentosEtapa
        processo={processo}
        tipos={TIPOS}
        editavel={editavel}
        abrirPrimeiro
        titulo="Termo de referência, edital e minuta de contrato"
        descricao={
          <ul className="jornada-lista-compacta">
            <li>TR: elementos do art. 6º, XXIII, alíneas “a” a “j”, inclusive a estimativa de valor ou a indicação de sigilo (art. 24).</li>
            <li>Edital: art. 25, com acesso sem cadastro prévio (art. 25, § 3º), prazos (art. 55), julgamento e desempate (art. 60) e habilitação (arts. 62 a 70).</li>
            <li>Minuta: as cláusulas necessárias do art. 92 (I a XIX) e, para software sob encomenda, a cessão de direitos (art. 93).</li>
          </ul>
        }
      />

      {editavel ? <Requisitos titulo="Condições para avançar à etapa 5" itens={requisitos} /> : null}
    </div>
  );
}
