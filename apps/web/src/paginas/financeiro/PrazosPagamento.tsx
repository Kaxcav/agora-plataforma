import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { AlarmClock, CalendarCheck, CalendarX, Hourglass, ListOrdered, Scale } from 'lucide-react';
import type { AlteracaoOrdemCronologica, EntradaAlteracaoOrdem, FiltroPrazosPagamento, PrazoPagamento, SituacaoPrazoPagamento } from '@agora/contratos';
import { formatarData, formatarMoeda, formatarMoedaCompacta, validarDataISO } from '@agora/dominio';
import { useAlteracoesOrdem, useComunicarAlteracaoOrdem, usePrazosPagamento, useRegistrarAlteracaoOrdem } from '../../api/execucao';
import {
  Alerta,
  AreaTexto,
  BarraFiltros,
  Botao,
  CampoBusca,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  Indicador,
  Pagina,
  Paginacao,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarCompetencia, formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import { chavesDe, opcoesDe } from '../compartilhado/rotulos';
import { ErroFormulario, hoje, SITUACOES_PRAZO } from '../contratos/execucao/comum';

/**
 * Prazos de pagamento (art. 92, V e VI): limite de cada parcela a partir do recebimento definitivo ou da liquidação,
 * atualização estimada das atrasadas e registro da alteração justificada da ordem cronológica (art. 141, § 1º).
 */

const FILTROS = ['busca', 'situacao', 'uasg'] as const;
const MINIMO_JUSTIFICATIVA = 50;

const HIPOTESES: { inciso: EntradaAlteracaoOrdem['inciso']; rotulo: string }[] = [
  { inciso: 'I', rotulo: 'I — Grave perturbação da ordem, emergência ou calamidade pública' },
  { inciso: 'II', rotulo: 'II — Microempresa, EPP, agricultor familiar, produtor rural, MEI ou cooperativa, com risco de descontinuidade' },
  { inciso: 'III', rotulo: 'III — Serviços necessários aos sistemas estruturantes, com risco de descontinuidade' },
  { inciso: 'IV', rotulo: 'IV — Direitos de contratos em falência, recuperação judicial ou dissolução da contratada' },
  { inciso: 'V', rotulo: 'V — Objeto imprescindível ao patrimônio público ou às atividades finalísticas, com risco de descontinuidade' },
];

const ORIGEM_MARCO: Record<NonNullable<PrazoPagamento['origemMarco']>, string> = {
  recebimento_definitivo: 'recebimento definitivo',
  atesto: 'atesto da nota',
  liquidacao: 'liquidação',
};

function DialogoAlteracao({ alvo, aoFechar }: { alvo: PrazoPagamento | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarAlteracaoOrdem();
  const [inciso, definirInciso] = useState<EntradaAlteracaoOrdem['inciso']>('I');
  const [justificativa, definirJustificativa] = useState('');
  const [autoridade, definirAutoridade] = useState('');
  const [ato, definirAto] = useState('');
  const [decididaEm, definirDecididaEm] = useState(hoje());
  const [erro, definirErro] = useState<string | undefined>();
  const fechar = () => {
    definirJustificativa('');
    definirAutoridade('');
    definirAto('');
    definirErro(undefined);
    registrar.reset();
    aoFechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!alvo) return;
    if (autoridade.trim().length < 5 || ato.trim().length < 3 || !validarDataISO(decididaEm)) {
      definirErro('Informe a autoridade competente, o ato e a data da decisão.');
      return;
    }
    if (justificativa.trim().length < MINIMO_JUSTIFICATIVA) {
      definirErro(`Registre a justificativa com pelo menos ${MINIMO_JUSTIFICATIVA} caracteres.`);
      return;
    }
    definirErro(undefined);
    registrar.mutate(
      { pagamentoId: alvo.pagamento.id, entrada: { inciso, justificativa: justificativa.trim(), autoridade: autoridade.trim(), ato: ato.trim(), decididaEm } },
      {
        onSuccess: () => {
          avisar({
            tipo: 'sucesso',
            titulo: 'Alteração da ordem registrada',
            mensagem: 'Registre depois as comunicações ao controle interno e ao tribunal de contas.',
          });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={alvo !== null}
      aoFechar={registrar.isPending ? () => undefined : fechar}
      titulo="Alterar a ordem cronológica"
      largura="media"
      descricao={
        alvo ? (
          <p>
            Nota fiscal {alvo.pagamento.notaFiscal} (contrato {alvo.contrato.numero}, fonte {alvo.pagamento.fonteRecurso}, posição{' '}
            {alvo.pagamento.posicaoOrdemCronologica ?? '—'} na fila). A alteração só vale nas hipóteses do art. 141, § 1º, com justificativa prévia da
            autoridade competente e comunicação posterior ao controle interno e ao tribunal de contas.
          </p>
        ) : null
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-alteracao-ordem" carregando={registrar.isPending}>
            Registrar alteração
          </Botao>
        </>
      }
    >
      <form id="formulario-alteracao-ordem" className="formulario" onSubmit={enviar} noValidate>
        <Selecao
          rotulo="Hipótese do art. 141, § 1º"
          obrigatorio
          value={inciso}
          onChange={(e) => definirInciso(e.target.value as EntradaAlteracaoOrdem['inciso'])}
          opcoes={HIPOTESES.map((h) => ({ valor: h.inciso, rotulo: h.rotulo }))}
        />
        <AreaTexto
          rotulo="Justificativa"
          obrigatorio
          rows={4}
          maxLength={5000}
          contador
          value={justificativa}
          onChange={(e) => definirJustificativa(e.target.value)}
          ajuda="Nas hipóteses II, III e V, demonstre o risco de descontinuidade."
        />
        <CampoTexto rotulo="Autoridade competente (nome e cargo)" obrigatorio maxLength={200} value={autoridade} onChange={(e) => definirAutoridade(e.target.value)} />
        <CampoTexto rotulo="Ato da decisão" obrigatorio maxLength={200} value={ato} onChange={(e) => definirAto(e.target.value)} ajuda="Ex.: despacho no processo SEI." />
        <CampoTexto rotulo="Data da decisão" type="date" obrigatorio value={decididaEm} max={hoje()} onChange={(e) => definirDecididaEm(e.target.value)} />
        {erro ? (
          <Alerta tipo="erro" anunciar compacto>
            {erro}
          </Alerta>
        ) : null}
        <ErroFormulario erro={registrar.error} titulo="A alteração não foi registrada" />
      </form>
    </Dialogo>
  );
}

function DialogoComunicacao({ alvo, aoFechar }: { alvo: { alteracao: AlteracaoOrdemCronologica; orgao: 'controle_interno' | 'tribunal_contas' } | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const comunicar = useComunicarAlteracaoOrdem();
  const [data, definirData] = useState(hoje());
  const [protocolo, definirProtocolo] = useState('');
  const [erro, definirErro] = useState<string | undefined>();
  const nomeOrgao = alvo?.orgao === 'tribunal_contas' ? 'tribunal de contas' : 'controle interno';
  const fechar = () => {
    definirProtocolo('');
    definirErro(undefined);
    comunicar.reset();
    aoFechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!alvo) return;
    if (protocolo.trim().length < 3) {
      definirErro('Informe o protocolo ou o ofício da comunicação.');
      return;
    }
    definirErro(undefined);
    comunicar.mutate(
      { id: alvo.alteracao.id, entrada: { orgao: alvo.orgao, data, protocolo: protocolo.trim() } },
      {
        onSuccess: () => {
          avisar({ tipo: 'sucesso', titulo: 'Comunicação registrada', mensagem: `Comunicação ao ${nomeOrgao} registrada.` });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={alvo !== null}
      aoFechar={comunicar.isPending ? () => undefined : fechar}
      titulo={`Comunicação ao ${nomeOrgao}`}
      largura="estreita"
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={comunicar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-comunicacao" carregando={comunicar.isPending}>
            Registrar comunicação
          </Botao>
        </>
      }
    >
      <form id="formulario-comunicacao" className="formulario" onSubmit={enviar} noValidate>
        <CampoTexto rotulo="Data" type="date" obrigatorio value={data} max={hoje()} onChange={(e) => definirData(e.target.value)} />
        <CampoTexto rotulo="Protocolo ou ofício" obrigatorio maxLength={120} value={protocolo} onChange={(e) => definirProtocolo(e.target.value)} erro={erro} />
        <ErroFormulario erro={comunicar.error} titulo="A comunicação não foi registrada" />
      </form>
    </Dialogo>
  );
}

function AlteracoesRegistradas() {
  const { temPermissao } = useSessao();
  const consulta = useAlteracoesOrdem();
  const [comunicando, definirComunicando] = useState<{ alteracao: AlteracaoOrdemCronologica; orgao: 'controle_interno' | 'tribunal_contas' } | null>(null);
  const podeRegistrar = temPermissao('pagamentos:ordem_cronologica');
  return (
    <Secao
      titulo="Alterações justificadas da ordem cronológica"
      id="alteracoes-ordem"
      descricao={<p>Registradas antes do pagamento fora da ordem; aparecem como exceções justificadas no painel da 2ª linha de defesa.</p>}
    >
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={2} />} rotuloCarregando="Carregando as alterações da ordem">
        {(alteracoes) =>
          alteracoes.length === 0 ? (
            <EstadoVazio icone={ListOrdered} titulo="Nenhuma alteração registrada" />
          ) : (
            <ul className="lista-controle">
              {alteracoes.map((a) => (
                <li key={a.id}>
                  <span className="lista-controle__titulo">
                    Nota fiscal {a.pagamento.notaFiscal} — <Link to={`/contratos/${a.contrato.id}`}>contrato {a.contrato.numero}</Link>
                  </span>
                  <span className="texto-pequeno">
                    Art. 141, § 1º, {a.inciso} — decisão de {a.autoridade} ({a.ato}, {formatarData(a.decididaEm)})
                  </span>
                  <span className="lista-controle__descricao">{a.justificativa}</span>
                  <span className="linha">
                    {(['controle_interno', 'tribunal_contas'] as const).map((orgao) => {
                      const feita = a.comunicacoes.find((m) => m.orgao === orgao);
                      const nome = orgao === 'controle_interno' ? 'Controle interno' : 'Tribunal de contas';
                      return feita ? (
                        <Etiqueta key={orgao} tom="sucesso" compacta>
                          {nome}: comunicado em {formatarData(feita.data)} ({feita.protocolo})
                        </Etiqueta>
                      ) : podeRegistrar ? (
                        <Botao key={orgao} tamanho="compacto" variante="secundario" onClick={() => definirComunicando({ alteracao: a, orgao })}>
                          Registrar comunicação ao {orgao === 'controle_interno' ? 'controle interno' : 'tribunal de contas'}
                        </Botao>
                      ) : (
                        <Etiqueta key={orgao} tom="aviso" compacta>
                          {nome}: comunicação pendente
                        </Etiqueta>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </ConteudoConsulta>
      {podeRegistrar ? <DialogoComunicacao alvo={comunicando} aoFechar={() => definirComunicando(null)} /> : null}
    </Secao>
  );
}

export default function PrazosPagamento() {
  const p = useParametrosUrl();
  const { temPermissao } = useSessao();
  const [alterando, definirAlterando] = useState<PrazoPagamento | null>(null);
  const podeAlterarOrdem = temPermissao('pagamentos:ordem_cronologica');
  const filtro: FiltroPrazosPagamento = {
    busca: p.texto('busca'),
    situacao: p.opcao('situacao', chavesDe(SITUACOES_PRAZO)) as SituacaoPrazoPagamento | undefined,
    uasg: p.texto('uasg'),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
  };
  const consulta = usePrazosPagamento(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);
  const resumo = consulta.data?.resumo;

  const colunas: ColunaTabela<PrazoPagamento>[] = [
    {
      id: 'nota',
      cabecalho: 'Nota fiscal',
      identificadora: true,
      fixa: true,
      celula: (x) => (
        <span className="pilha pilha--compacta">
          <span className="mono">{x.pagamento.notaFiscal}</span>
          <span className="texto-pequeno texto-secundario">{formatarCompetencia(x.pagamento.competencia)}</span>
        </span>
      ),
    },
    {
      id: 'contrato',
      cabecalho: 'Contrato',
      prioritaria: true,
      celula: (x) => (
        <span className="pilha pilha--compacta">
          <Link to={`/contratos/${x.contrato.id}?aba=recebimentos`}>Contrato {x.contrato.numero}</Link>
          <span className="texto-pequeno texto-secundario">{x.fornecedor}</span>
        </span>
      ),
    },
    { id: 'valor', cabecalho: 'Valor', alinhamento: 'fim', celula: (x) => <span className="numero">{formatarMoeda(x.pagamento.valor - x.descontosMulta)}</span> },
    {
      id: 'marco',
      cabecalho: 'Marco',
      celula: (x) =>
        x.dataMarco && x.origemMarco ? (
          <span className="pilha pilha--compacta">
            <span className="numero">{formatarData(x.dataMarco)}</span>
            <span className="texto-pequeno texto-secundario">{ORIGEM_MARCO[x.origemMarco]}</span>
          </span>
        ) : (
          <span className="texto-secundario">—</span>
        ),
    },
    {
      id: 'limite',
      cabecalho: 'Pagar até',
      prioritaria: true,
      celula: (x) => (x.limitePagamento ? <span className="numero">{formatarData(x.limitePagamento)}</span> : <span className="texto-secundario">—</span>),
    },
    {
      id: 'situacao',
      cabecalho: 'Situação do prazo',
      prioritaria: true,
      larguraMinima: '12rem',
      celula: (x) => (
        <span className="pilha pilha--compacta">
          <Etiqueta tom={SITUACOES_PRAZO[x.situacao].tom} compacta>
            {SITUACOES_PRAZO[x.situacao].rotulo}
            {x.diasAtraso > 0 ? ` (${x.diasAtraso} dias)` : ''}
          </Etiqueta>
          {x.liquidacaoAtrasada ? <span className="texto-pequeno">Liquidação fora do prazo</span> : null}
          {x.alteracoesOrdem > 0 ? <span className="texto-pequeno">Alteração da ordem registrada</span> : null}
        </span>
      ),
    },
    {
      id: 'atualizacao',
      cabecalho: 'Atualização estimada',
      alinhamento: 'fim',
      celula: (x) =>
        x.atualizacao ? (
          <details>
            <summary className="numero">{formatarMoeda(x.atualizacao.valorCorrecao + x.atualizacao.valorJuros)}</summary>
            <ul className="lista-simples texto-pequeno">
              {x.atualizacao.memoriaCalculo.map((m) => (
                <li key={m}>{m}</li>
              ))}
              <li>{x.atualizacao.aviso}</li>
            </ul>
          </details>
        ) : (
          <span className="texto-secundario">—</span>
        ),
    },
  ];

  return (
    <Pagina
      titulo="Prazos de pagamento"
      subtitulo="Limite de cada parcela, atualização das atrasadas e alterações justificadas da ordem cronológica."
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Pagamentos', para: '/financeiro/pagamentos' },
      ]}
      tela="pagamentos.prazos"
    >
      <Alerta tipo="info" titulo="Prazo de pagamento e atualização monetária (Lei 14.133/2021, art. 92, V e VI)">
        <p>
          O prazo conta do recebimento definitivo ou da liquidação, conforme o contrato. Passado o limite por atraso imputável à Administração, o
          valor é corrigido pelo índice do contrato desde o adimplemento, com os juros previstos. A estimativa é apoio: confirme a causa do atraso
          antes de pagar.
        </p>
      </Alerta>

      <div className="grade grade--kpi">
        <Indicador rotulo="Vencidos" icone={CalendarX} tom={resumo && resumo.vencidos > 0 ? 'erro' : 'sucesso'} valor={formatarNumero(resumo?.vencidos ?? 0)} carregando={!resumo} />
        <Indicador rotulo="Vencem hoje" icone={AlarmClock} tom="aviso" valor={formatarNumero(resumo?.venceHoje ?? 0)} carregando={!resumo} />
        <Indicador rotulo="No prazo" icone={CalendarCheck} tom="sucesso" valor={formatarNumero(resumo?.noPrazo ?? 0)} carregando={!resumo} />
        <Indicador rotulo="Aguardando o marco" icone={Hourglass} tom="info" valor={formatarNumero(resumo?.aguardandoMarco ?? 0)} carregando={!resumo} />
        <Indicador
          rotulo="Atualização estimada"
          icone={Scale}
          tom="aviso"
          valor={formatarMoedaCompacta(resumo?.atualizacaoEstimada ?? 0)}
          valorAcessivel={formatarMoeda(resumo?.atualizacaoEstimada ?? 0)}
          detalhe="Nas parcelas vencidas"
          carregando={!resumo}
        />
      </div>

      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <BarraFiltros total={consulta.data?.total} substantivo={['parcela', 'parcelas']} filtrosAtivos={filtrosAtivos} aoLimpar={limpar} rotulo="Filtros dos prazos de pagamento">
            <CampoBusca rotulo="Buscar" placeholder="Nota fiscal, contrato ou fornecedor" valor={filtro.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
            <Selecao
              rotulo="Situação do prazo"
              opcaoVazia="Todas"
              opcoes={opcoesDe(SITUACOES_PRAZO)}
              value={filtro.situacao ?? ''}
              onChange={(e) => p.atualizar({ situacao: e.target.value })}
            />
            <CampoUasg valor={filtro.uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
          </BarraFiltros>
          <Tabela
            id="prazos-pagamento"
            legenda="Prazos de pagamento das parcelas"
            colunas={colunas}
            linhas={consulta.data?.itens}
            chave={(x) => x.pagamento.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            destaque={(x) => (x.situacao === 'vencido' ? 'erro' : x.situacao === 'vence_hoje' ? 'aviso' : undefined)}
            acoes={
              podeAlterarOrdem
                ? {
                    cabecalho: 'Ações',
                    celula: (x) =>
                      x.pagamento.exigivel &&
                      x.pagamento.posicaoOrdemCronologica !== null &&
                      x.pagamento.posicaoOrdemCronologica > 1 ? (
                        <Botao
                          tamanho="compacto"
                          variante="secundario"
                          icone={ListOrdered}
                          aria-label={`Alterar a ordem cronológica para a nota fiscal ${x.pagamento.notaFiscal}`}
                          onClick={() => definirAlterando(x)}
                        >
                          Alterar a ordem
                        </Botao>
                      ) : (
                        <span className="texto-pequeno texto-secundario">—</span>
                      ),
                  }
                : undefined
            }
            vazio={<EstadoVazio titulo={filtrosAtivos ? 'Nenhuma parcela atende aos filtros' : 'Nenhuma parcela no seu escopo'} />}
            rodape={
              consulta.data && consulta.data.total > 0 ? (
                <Paginacao
                  pagina={p.pagina}
                  tamanhoPagina={p.tamanhoPagina}
                  total={consulta.data.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação dos prazos de pagamento"
                />
              ) : null
            }
          />
        </>
      )}

      <AlteracoesRegistradas />
      {podeAlterarOrdem ? <DialogoAlteracao alvo={alterando} aoFechar={() => definirAlterando(null)} /> : null}
    </Pagina>
  );
}
