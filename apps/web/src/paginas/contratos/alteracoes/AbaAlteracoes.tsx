import { useState } from 'react';
import { FilePen, FilePlus2, Gavel, Percent, Users } from 'lucide-react';
import type { AlteracaoContratual, ContratoDetalhe, PainelAlteracoesContrato } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { useAlteracoesContrato } from '../../../api/alteracoes';
import {
  Alerta,
  BarraProgresso,
  Botao,
  ConteudoConsulta,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  ListaDefinicoes,
  Secao,
  Tabela,
  TextoLongo,
  type ColunaTabela,
} from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { ProrrogacaoContrato } from '../ProrrogacaoContrato';
import { SimuladorAditivo } from '../SimuladorAditivo';
import { DialogoAlteracao } from './DialogoAlteracao';
import { DialogoPropostaAditivo } from './DialogoPropostaAditivo';
import { DialogoExtincao, DialogoReajuste, DialogoRepactuacao } from './DialogosApostilaExtincao';
import { DIVULGACAO_ALTERACAO, ESPECIES_ALTERACAO, NATUREZAS, PRORROGACAO, SITUACOES_ALTERACAO, TIPOS_ALTERACAO, tituloAlteracao } from './rotulos';

function valorComSinal(valor: number): string {
  if (valor === 0) return '—';
  return valor < 0 ? `− ${formatarMoeda(Math.abs(valor))}` : formatarMoeda(valor);
}

function colunas(abrir: (a: AlteracaoContratual) => void): ColunaTabela<AlteracaoContratual>[] {
  return [
    {
      id: 'termo',
      cabecalho: 'Termo',
      identificadora: true,
      fixa: true,
      celula: (a) => (
        <Botao variante="terciario" tamanho="compacto" onClick={() => abrir(a)} aria-label={`Ver ${tituloAlteracao(a).toLowerCase()}`}>
          {a.numero ?? (a.tipo === 'extincao' ? 'Processo' : 'Proposta')}
        </Botao>
      ),
    },
    { id: 'tipo', cabecalho: 'Tipo', prioritaria: true, celula: (a) => `${TIPOS_ALTERACAO[a.tipo]} (${ESPECIES_ALTERACAO[a.especie].toLowerCase()})` },
    {
      id: 'valor',
      cabecalho: 'Valor',
      alinhamento: 'fim',
      ordenavel: true,
      valorOrdenacao: (a) => a.valor,
      celula: (a) => <span className="numero">{valorComSinal(a.valor)}</span>,
    },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      prioritaria: true,
      celula: (a) => (
        <Etiqueta tom={SITUACOES_ALTERACAO[a.situacao].tom} compacta>
          {SITUACOES_ALTERACAO[a.situacao].rotulo}
        </Etiqueta>
      ),
    },
    {
      id: 'pncp',
      cabecalho: 'PNCP',
      celula: (a) =>
        a.situacao === 'assinado' ? (
          <Etiqueta tom={DIVULGACAO_ALTERACAO[a.divulgacao.situacao].tom} compacta>
            {DIVULGACAO_ALTERACAO[a.divulgacao.situacao].rotulo}
          </Etiqueta>
        ) : (
          <span className="texto-secundario">—</span>
        ),
    },
    {
      id: 'data',
      cabecalho: 'Data',
      ordenavel: true,
      valorOrdenacao: (a) => a.assinadoEm ?? a.propostoEm,
      celula: (a) => <span className="numero">{formatarData(a.assinadoEm ?? a.propostoEm.slice(0, 10))}</span>,
    },
    { id: 'justificativa', cabecalho: 'Justificativa', larguraMinima: '16rem', celula: (a) => <TextoLongo texto={a.justificativa} /> },
  ];
}

function Limites({ painel }: { painel: PainelAlteracoesContrato }) {
  const l = painel.limites;
  const tom = l.nivel === 'excedido' ? 'erro' : l.nivel === 'proximo' ? 'aviso' : 'sucesso';
  return (
    <Secao titulo="Limites de alteração (art. 125)" id="limites-art-125" descricao="Acréscimos e supressões somam-se separadamente, sem compensação, sobre o valor inicial atualizado.">
      <div className="medidor">
        <div className="medidor__linha">
          <span className="medidor__rotulo">Acréscimos</span>
          <BarraProgresso
            valor={(l.percentualAcrescimos / l.limiteAcrescimos) * 100}
            rotulo={`Acréscimos acumulados: ${l.percentualAcrescimos}% de ${l.limiteAcrescimos}%`}
            textoValor={`${l.percentualAcrescimos.toLocaleString('pt-BR')}% de ${l.limiteAcrescimos}%`}
            tom={tom}
          />
        </div>
        <div className="medidor__linha">
          <span className="medidor__rotulo">Supressões</span>
          <BarraProgresso
            valor={(l.percentualSupressoes / l.limiteSupressoes) * 100}
            rotulo={`Supressões acumuladas: ${l.percentualSupressoes}% de ${l.limiteSupressoes}%`}
            textoValor={`${l.percentualSupressoes.toLocaleString('pt-BR')}% de ${l.limiteSupressoes}%`}
            tom={tom}
          />
        </div>
      </div>
      <ListaDefinicoes
        colunas={2}
        itens={[
          { termo: 'Valor inicial', valor: <span className="numero">{formatarMoeda(l.valorInicial)}</span> },
          { termo: 'Reajustes e repactuações', valor: <span className="numero">{formatarMoeda(l.reajustes)}</span> },
          { termo: 'Valor inicial atualizado', valor: <span className="numero">{formatarMoeda(l.valorInicialAtualizado)}</span> },
          { termo: 'Margem para acréscimos', valor: <span className="numero">{formatarMoeda(l.margemAcrescimos)}</span> },
          { termo: 'Margem para supressões', valor: <span className="numero">{formatarMoeda(l.margemSupressoes)}</span> },
        ]}
      />
      <p className="texto-pequeno texto-secundario">{l.explicacao} Acima do limite, a Ágora recusa o termo aditivo (RN-32).</p>
    </Secao>
  );
}

function ProrrogacaoReajuste({ painel, aoReajustar }: { painel: PainelAlteracoesContrato; aoReajustar: (() => void) | null }) {
  const p = PRORROGACAO[painel.prorrogacao.tipo];
  const r = painel.reajuste;
  return (
    <Secao titulo="Prorrogação e reajuste" id="prorrogacao-reajuste">
      <ListaDefinicoes
        colunas={2}
        itens={[
          { termo: 'Natureza do contrato', valor: painel.natureza ? NATUREZAS[painel.natureza] : 'Não informada' },
          {
            termo: 'Prorrogação (RN-33)',
            valor: (
              <span className="pilha pilha--compacta">
                <Etiqueta tom={p.tom} compacta>
                  {p.rotulo}
                </Etiqueta>
                <span>{painel.prorrogacao.mensagem.charAt(0).toUpperCase() + painel.prorrogacao.mensagem.slice(1)}</span>
              </span>
            ),
            largo: true,
          },
          { termo: 'Índice de reajuste', valor: r.indice },
          { termo: 'Data-base (orçamento estimado)', valor: <span className="numero">{formatarData(r.dataBase)}</span> },
          { termo: 'Reajustes aplicados', valor: <span className="numero">{r.ciclosAplicados}</span> },
          {
            termo: 'Próximo reajuste possível',
            valor: (
              <span className="pilha pilha--compacta">
                <span className="numero">{formatarData(r.proximoAniversario)}</span>
                <Etiqueta tom={r.disponivel ? 'sucesso' : 'neutro'} compacta>
                  {r.disponivel ? 'Interregno de 12 meses cumprido' : 'Antes de 12 meses: vedado'}
                </Etiqueta>
              </span>
            ),
          },
        ]}
      />
      {aoReajustar ? (
        <div>
          <Botao variante="secundario" icone={Percent} onClick={aoReajustar}>
            Registrar reajuste
          </Botao>
        </div>
      ) : null}
      <p className="texto-pequeno texto-secundario">Lei 14.133/2021, art. 25, § 7º, art. 92, § 3º, e art. 136, I (reajuste por apostila).</p>
    </Secao>
  );
}

type Janela = 'proposta' | 'reajuste' | 'repactuacao' | 'extincao' | null;

function ConteudoAlteracoes({ contrato, painel }: { contrato: ContratoDetalhe; painel: PainelAlteracoesContrato }) {
  const { temPermissao } = useSessao();
  const [janela, definirJanela] = useState<Janela>(null);
  const [selecionadaId, definirSelecionadaId] = useState<string | null>(null);
  const selecionada = painel.alteracoes.find((a) => a.id === selecionadaId) ?? null;
  const extinto = painel.extintoEm !== null;
  const podeEditar = temPermissao('contratos:editar') && !extinto;
  const podeDecidir = temPermissao('alteracoes:decidir') && !extinto;
  const extincaoAberta = painel.alteracoes.some((a) => a.tipo === 'extincao' && ['em_contraditorio', 'aguardando_decisao'].includes(a.situacao));
  const pendentes = painel.alteracoes.filter((a) => ['aguardando_parecer', 'pronto_para_assinatura', 'em_contraditorio', 'aguardando_decisao'].includes(a.situacao)).length;

  return (
    <div className="pilha pilha--ampla">
      {extinto ? (
        <Alerta tipo="aviso" titulo={`Contrato extinto em ${formatarData(painel.extintoEm ?? '')}`}>
          Não cabem novos aditivos, apostilas nem prorrogação (arts. 137 a 139).
        </Alerta>
      ) : null}
      <div className="grade grade--2">
        <Limites painel={painel} />
        <ProrrogacaoReajuste painel={painel} aoReajustar={podeDecidir && painel.reajuste.disponivel ? () => definirJanela('reajuste') : null} />
      </div>

      <Secao
        titulo="Histórico de alterações"
        id="historico-alteracoes"
        descricao={
          <p>
            Termos aditivos, apostilas, reequilíbrios e extinção, com parecer, assinatura e divulgação no PNCP.
            {pendentes > 0 ? ` ${pendentes} ${pendentes === 1 ? 'ato aguarda' : 'atos aguardam'} providência.` : ''}
          </p>
        }
        acoes={
          <>
            {podeEditar ? (
              <Botao variante="primario" icone={FilePlus2} onClick={() => definirJanela('proposta')}>
                Propor termo aditivo
              </Botao>
            ) : null}
            {podeDecidir ? (
              <Botao variante="secundario" icone={Users} onClick={() => definirJanela('repactuacao')}>
                Registrar repactuação
              </Botao>
            ) : null}
            {podeEditar && !extincaoAberta ? (
              <Botao variante="secundario" icone={Gavel} onClick={() => definirJanela('extincao')}>
                Abrir extinção
              </Botao>
            ) : null}
          </>
        }
      >
        <Tabela
          id="contrato-alteracoes"
          legenda="Histórico de alterações"
          colunas={colunas((a) => definirSelecionadaId(a.id))}
          linhas={painel.alteracoes}
          chave={(a) => a.id}
          destaque={(a) => (a.divulgacao.situacao === 'erro' ? 'erro' : ['aguardando_parecer', 'pronto_para_assinatura', 'em_contraditorio', 'aguardando_decisao'].includes(a.situacao) ? 'aviso' : undefined)}
          vazio={<EstadoVazio icone={FilePen} titulo="Nenhuma alteração registrada" descricao="O contrato mantém as condições originais." />}
        />
      </Secao>

      {extinto ? null : <ProrrogacaoContrato contrato={contrato} natureza={painel.natureza} />}
      <SimuladorAditivo contrato={contrato} />

      {janela === 'proposta' ? (
        <DialogoPropostaAditivo contratoId={contrato.id} numero={contrato.numero} vigenciaFim={contrato.vigenciaFim} painel={painel} aberto aoFechar={() => definirJanela(null)} />
      ) : null}
      {janela === 'reajuste' ? <DialogoReajuste contratoId={contrato.id} numero={contrato.numero} painel={painel} aoFechar={() => definirJanela(null)} /> : null}
      {janela === 'repactuacao' ? <DialogoRepactuacao contratoId={contrato.id} numero={contrato.numero} painel={painel} aoFechar={() => definirJanela(null)} /> : null}
      {janela === 'extincao' ? <DialogoExtincao contratoId={contrato.id} numero={contrato.numero} aoFechar={() => definirJanela(null)} /> : null}
      {selecionada ? <DialogoAlteracao contratoId={contrato.id} alteracao={selecionada} aoFechar={() => definirSelecionadaId(null)} /> : null}
    </div>
  );
}

/** Aba "Alterações" do contrato (RF-27): limites do art. 125, prorrogação, reajuste e o histórico de atos. */
export function AbaAlteracoes({ contrato }: { contrato: ContratoDetalhe }) {
  const consulta = useAlteracoesContrato(contrato.id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={4} />} rotuloCarregando="Carregando as alterações do contrato">
      {(painel) => <ConteudoAlteracoes contrato={contrato} painel={painel} />}
    </ConteudoConsulta>
  );
}
