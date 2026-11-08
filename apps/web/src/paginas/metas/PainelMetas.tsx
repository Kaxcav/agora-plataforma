/**
 * Painel das metas do ETP (RF-39; Lei 14.133/2021, art. 18, § 1º, IX): tempo de instrução por etapa, erros formais
 * barrados pelas travas e economia, contra as metas configuradas pelo órgão. O servidor mede no escopo de UASG do
 * usuário; o painel diz o que mede e o que não mede e não atribui a economia à IA.
 */
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Clock, FileDown, PiggyBank, Settings, ShieldCheck } from 'lucide-react';
import type { ConfiguracaoMetasEtp, EconomiaProcessoPainel, ExplicacaoIndicador, PainelMetasEtp, SituacaoMetaIndicador } from '@agora/contratos';
import { formatarData, formatarMoeda, hojeISO, validarDataISO } from '@agora/dominio';
import { urlCsvMetas, useConfiguracaoMetas, useConfigurarMetas, usePainelMetas } from '../../api/metas';
import {
  Alerta,
  Botao,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EstadoVazio,
  Etiqueta,
  Indicador,
  ListaDefinicoes,
  Pagina,
  Secao,
  Tabela,
  useAvisos,
  type TomEtiqueta,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante, formatarNumero, formatarPercentual } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { CampoUasg } from '../compartilhado/CampoUasg';
import './metas.css';

const SITUACOES: Record<SituacaoMetaIndicador, { rotulo: string; tom: TomEtiqueta }> = {
  atingida: { rotulo: 'Meta atingida', tom: 'sucesso' },
  nao_atingida: { rotulo: 'Meta não atingida', tom: 'aviso' },
  sem_meta: { rotulo: 'Sem meta', tom: 'neutro' },
  sem_dados: { rotulo: 'Sem dados no período', tom: 'neutro' },
};

function tomIndicador(s: SituacaoMetaIndicador): 'sucesso' | 'aviso' | 'neutro' {
  return s === 'atingida' ? 'sucesso' : s === 'nao_atingida' ? 'aviso' : 'neutro';
}

function SituacaoMeta({ situacao }: { situacao: SituacaoMetaIndicador }) {
  const s = SITUACOES[situacao];
  return (
    <Etiqueta tom={s.tom} compacta>
      {s.rotulo}
    </Etiqueta>
  );
}

function dias(valor: number | null): string {
  return valor === null ? '—' : `${valor.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dias`;
}

function percentualOuTraco(valor: number | null, casas = 1): string {
  return valor === null ? '—' : formatarPercentual(valor, casas);
}

function Explicacao({ explicacao }: { explicacao: ExplicacaoIndicador }) {
  return (
    <div className="metas-explicacao">
      <div>
        <h3>O que este indicador mede</h3>
        <p className="texto-pequeno">{explicacao.mede}</p>
      </div>
      <div>
        <h3>O que ele não mede</h3>
        <p className="texto-pequeno">{explicacao.naoMede}</p>
      </div>
    </div>
  );
}

// ───────────────────────── (a) tempo de instrução ─────────────────────────

type LinhaEtapa = PainelMetasEtp['tempoInstrucao']['etapas'][number];

function SecaoTempo({ tempo }: { tempo: PainelMetasEtp['tempoInstrucao'] }) {
  return (
    <Secao
      titulo="Tempo de instrução da fase preparatória"
      id="metas-tempo"
      descricao={
        tempo.metaReducaoPercentual === null
          ? 'Sem meta de redução configurada.'
          : `Meta: reduzir em ${formatarPercentual(tempo.metaReducaoPercentual, 0)} o tempo da linha de base. Medido pelos avanços de etapa registrados na trilha de auditoria.`
      }
    >
      <Tabela<LinhaEtapa>
        id="metas-tempo-etapas"
        legenda="Tempo de instrução por etapa"
        semFerramentas
        linhas={tempo.etapas}
        chave={(e) => String(e.etapa)}
        colunas={[
          { id: 'etapa', cabecalho: 'Etapa', identificadora: true, prioritaria: true, celula: (e) => `${e.etapa}. ${e.titulo}` },
          { id: 'medidos', cabecalho: 'Processos medidos', alinhamento: 'fim', celula: (e) => <span className="numero">{formatarNumero(e.processosMedidos)}</span> },
          { id: 'atual', cabecalho: 'Atual (média)', alinhamento: 'fim', prioritaria: true, celula: (e) => <span className="numero">{dias(e.mediaDias)}</span> },
          { id: 'mediana', cabecalho: 'Mediana', alinhamento: 'fim', celula: (e) => <span className="numero">{dias(e.medianaDias)}</span> },
          { id: 'base', cabecalho: 'Linha de base', alinhamento: 'fim', celula: (e) => <span className="numero">{dias(e.linhaBaseDias)}</span> },
          { id: 'alvo', cabecalho: 'Alvo', alinhamento: 'fim', celula: (e) => <span className="numero">{dias(e.alvoDias)}</span> },
          { id: 'reducao', cabecalho: 'Redução obtida', alinhamento: 'fim', celula: (e) => <span className="numero">{percentualOuTraco(e.reducaoObtidaPercentual)}</span> },
          { id: 'situacao', cabecalho: 'Situação', prioritaria: true, celula: (e) => <SituacaoMeta situacao={e.situacao} /> },
        ]}
      />
      <ListaDefinicoes
        colunas={4}
        itens={[
          { termo: 'Fase (etapas 1 a 4): atual', valor: <span className="numero">{dias(tempo.fase.mediaDias)}</span> },
          { termo: 'Linha de base da fase', valor: <span className="numero">{dias(tempo.fase.linhaBaseDias)}</span> },
          { termo: 'Alvo da fase', valor: <span className="numero">{dias(tempo.fase.alvoDias)}</span> },
          { termo: 'Situação da fase', valor: <SituacaoMeta situacao={tempo.fase.situacao} /> },
        ]}
      />
      <Explicacao explicacao={tempo.explicacao} />
    </Secao>
  );
}

// ───────────────────────── (b) erros formais ─────────────────────────

function SecaoErros({ erros, podeVerTrilha }: { erros: PainelMetasEtp['errosFormais']; podeVerTrilha: boolean }) {
  return (
    <Secao
      titulo="Erros formais barrados pelas travas"
      id="metas-erros"
      descricao={erros.metaPercentual === null ? 'Sem meta de mitigação configurada.' : `Meta: barrar pelo menos ${formatarPercentual(erros.metaPercentual, 0)} das ocorrências de erro formal.`}
    >
      <ListaDefinicoes
        colunas={4}
        itens={[
          { termo: 'Bloqueios aplicados', valor: <span className="numero">{formatarNumero(erros.bloqueios)}</span> },
          { termo: 'Processos afetados', valor: <span className="numero">{formatarNumero(erros.processosAfetados)}</span> },
          { termo: 'Erros que passaram pelas travas', valor: <span className="numero">{formatarNumero(erros.ocorrenciasNaoBarradas)}</span> },
          { termo: 'Mitigação', valor: <span className="pilha pilha--compacta"><span className="numero">{percentualOuTraco(erros.mitigacaoPercentual)}</span><SituacaoMeta situacao={erros.situacao} /></span> },
        ]}
      />
      <div className="grade grade--2">
        <Tabela<PainelMetasEtp['errosFormais']['porRegra'][number]>
          id="metas-erros-regras"
          legenda="Bloqueios por regra"
          semFerramentas
          linhas={erros.porRegra}
          chave={(r) => r.regra}
          vazio={<EstadoVazio icone={ShieldCheck} titulo="Nenhum bloqueio no período" />}
          colunas={[
            { id: 'regra', cabecalho: 'Regra', identificadora: true, prioritaria: true, celula: (r) => <span><strong>{r.regra}</strong> — {r.titulo}</span> },
            { id: 'bloqueios', cabecalho: 'Bloqueios', alinhamento: 'fim', prioritaria: true, celula: (r) => <span className="numero">{formatarNumero(r.bloqueios)}</span> },
          ]}
        />
        <Tabela<PainelMetasEtp['errosFormais']['porTrava'][number]>
          id="metas-erros-travas"
          legenda="Bloqueios por ponto da jornada"
          semFerramentas
          linhas={erros.porTrava}
          chave={(t) => t.trava}
          vazio={<EstadoVazio icone={ShieldCheck} titulo="Nenhum bloqueio no período" />}
          colunas={[
            { id: 'trava', cabecalho: 'Onde a trava atuou', identificadora: true, prioritaria: true, celula: (t) => t.rotulo },
            { id: 'bloqueios', cabecalho: 'Bloqueios', alinhamento: 'fim', prioritaria: true, celula: (t) => <span className="numero">{formatarNumero(t.bloqueios)}</span> },
          ]}
        />
      </div>
      <p className="texto-pequeno texto-secundario">
        Cada bloqueio fica na {podeVerTrilha ? <Link to="/auditoria?acao=trava.bloqueio">trilha de auditoria</Link> : 'trilha de auditoria'} como “trava.bloqueio”, com
        a regra, a UASG e quem tentou o ato.
      </p>
      <Explicacao explicacao={erros.explicacao} />
    </Secao>
  );
}

// ───────────────────────── (c) economia ─────────────────────────

function SecaoEconomia({ economia }: { economia: PainelMetasEtp['economia'] }) {
  return (
    <Secao
      titulo="Economia: estimado × contratado"
      id="metas-economia"
      descricao={economia.metaPercentual === null ? 'Sem meta de economia configurada.' : `Meta: economia de pelo menos ${formatarPercentual(economia.metaPercentual, 1)} sobre o valor estimado.`}
    >
      <ListaDefinicoes
        colunas={4}
        itens={[
          { termo: 'Valor estimado', valor: <span className="numero">{formatarMoeda(economia.totalEstimado)}</span> },
          { termo: 'Valor contratado ou homologado', valor: <span className="numero">{formatarMoeda(economia.totalContratado)}</span> },
          { termo: 'Economia', valor: <span className="numero">{formatarMoeda(economia.economia)}</span> },
          { termo: 'Economia sobre o estimado', valor: <span className="pilha pilha--compacta"><span className="numero">{percentualOuTraco(economia.economiaPercentual, 2)}</span><SituacaoMeta situacao={economia.situacao} /></span> },
        ]}
      />
      <Tabela<EconomiaProcessoPainel>
        id="metas-economia-processos"
        legenda="Economia por processo"
        semFerramentas
        linhas={economia.processos}
        chave={(p) => p.processo.id}
        vazio={<EstadoVazio icone={PiggyBank} titulo="Nenhum processo homologado ou contratado no período" />}
        colunas={[
          { id: 'processo', cabecalho: 'Processo', identificadora: true, prioritaria: true, celula: (p) => <Link to={p.processo.caminho}>{p.processo.identificador}</Link> },
          { id: 'origem', cabecalho: 'Valor final', celula: (p) => `${p.origem === 'contrato' ? 'Contrato' : 'Homologação'} em ${formatarData(p.data)}` },
          { id: 'estimado', cabecalho: 'Estimado', alinhamento: 'fim', celula: (p) => <span className="numero">{formatarMoeda(p.valorEstimado)}</span> },
          { id: 'contratado', cabecalho: 'Contratado', alinhamento: 'fim', celula: (p) => <span className="numero">{formatarMoeda(p.valorContratado)}</span> },
          { id: 'economia', cabecalho: 'Economia', alinhamento: 'fim', prioritaria: true, celula: (p) => <span className="numero">{percentualOuTraco(p.economiaPercentual, 2)}</span> },
        ]}
      />
      <Secao titulo="Efeito dos expurgos da cesta de preços (à parte)" simples nivel={3}>
        <p className="texto-pequeno">
          Quanto a média das cotações mudou ao descartar os preços discrepantes. Mostra o efeito do saneamento na referência de preço; não é economia e não se soma
          a ela.
        </p>
        <ListaDefinicoes
          colunas={3}
          itens={[
            { termo: 'Processos com expurgo', valor: <span className="numero">{formatarNumero(economia.expurgos.processosComExpurgo)}</span> },
            { termo: 'Cotações descartadas', valor: <span className="numero">{formatarNumero(economia.expurgos.cotacoesDescartadas)}</span> },
            { termo: 'Efeito na referência', valor: <span className="numero">{formatarMoeda(economia.expurgos.efeitoNoEstimado)}</span> },
          ]}
        />
        <Tabela<EconomiaProcessoPainel>
          id="metas-economia-expurgos"
          legenda="Média da cesta com e sem as cotações descartadas"
          semFerramentas
          linhas={economia.processos}
          chave={(p) => p.processo.id}
          vazio={<EstadoVazio icone={PiggyBank} titulo="Nenhum processo no período" />}
          colunas={[
            { id: 'processo', cabecalho: 'Processo', identificadora: true, prioritaria: true, celula: (p) => p.processo.identificador },
            { id: 'descartadas', cabecalho: 'Descartadas', alinhamento: 'fim', celula: (p) => <span className="numero">{`${p.expurgos.descartadas} de ${p.expurgos.cotacoes}`}</span> },
            { id: 'com', cabecalho: 'Média com as descartadas', alinhamento: 'fim', prioritaria: true, celula: (p) => <span className="numero">{p.expurgos.mediaComDescartadas === null ? '—' : formatarMoeda(p.expurgos.mediaComDescartadas)}</span> },
            { id: 'sem', cabecalho: 'Média sem as descartadas', alinhamento: 'fim', prioritaria: true, celula: (p) => <span className="numero">{p.expurgos.mediaSemDescartadas === null ? '—' : formatarMoeda(p.expurgos.mediaSemDescartadas)}</span> },
            { id: 'efeito', cabecalho: 'Efeito na referência', alinhamento: 'fim', celula: (p) => <span className="numero">{formatarMoeda(p.expurgos.efeitoNoEstimado)}</span> },
          ]}
        />
      </Secao>
      <Explicacao explicacao={economia.explicacao} />
    </Secao>
  );
}

// ───────────────────────── configuração das metas ─────────────────────────

type CamposMetas = Record<'reducao' | 'mitigacao' | 'economia' | 'e1' | 'e2' | 'e3' | 'e4', string>;
const ETAPAS = ['1', '2', '3', '4'] as const;
const ROTULOS_ETAPAS: Record<(typeof ETAPAS)[number], string> = { '1': 'Demanda e PCA', '2': 'Instrução no SEI e equipe', '3': 'ETP, riscos e preços', '4': 'TR, edital e minuta' };

function paraTexto(v: number | null): string {
  return v === null ? '' : String(v).replace('.', ',');
}

function lerNumero(texto: string): number | null | 'invalido' {
  const limpo = texto.trim().replace(',', '.');
  if (limpo === '') return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 'invalido';
}

function FormularioMetas({ configuracao, idFormulario, aoConcluir }: { configuracao: ConfiguracaoMetasEtp; idFormulario: string; aoConcluir: () => void }) {
  const { avisar } = useAvisos();
  const configurar = useConfigurarMetas();
  const b = configuracao.tempoInstrucao.linhaBaseDias;
  const [campos, definirCampos] = useState<CamposMetas>({
    reducao: paraTexto(configuracao.tempoInstrucao.reducaoPercentual),
    mitigacao: paraTexto(configuracao.errosFormais.mitigacaoPercentual),
    economia: paraTexto(configuracao.economia.economiaPercentual),
    e1: paraTexto(b['1']),
    e2: paraTexto(b['2']),
    e3: paraTexto(b['3']),
    e4: paraTexto(b['4']),
  });
  const [erros, definirErros] = useState<Partial<CamposMetas>>({});
  const mudar = (campo: keyof CamposMetas) => (e: { target: { value: string } }) => definirCampos((c) => ({ ...c, [campo]: e.target.value }));

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: Partial<CamposMetas> = {};
    const percentual = (campo: 'reducao' | 'mitigacao' | 'economia') => {
      const v = lerNumero(campos[campo]);
      if (v === 'invalido' || (v !== null && (v <= 0 || v > 100))) {
        novos[campo] = 'Informe um percentual maior que 0 e até 100, ou deixe em branco.';
        return null;
      }
      return v;
    };
    const diasBase = (campo: 'e1' | 'e2' | 'e3' | 'e4') => {
      const v = lerNumero(campos[campo]);
      if (v === 'invalido' || (v !== null && (v <= 0 || v > 3650))) {
        novos[campo] = 'Informe dias maiores que 0 e até 3.650, ou deixe em branco.';
        return null;
      }
      return v;
    };
    const entrada = {
      tempoInstrucao: { reducaoPercentual: percentual('reducao'), linhaBaseDias: { '1': diasBase('e1'), '2': diasBase('e2'), '3': diasBase('e3'), '4': diasBase('e4') } },
      errosFormais: { mitigacaoPercentual: percentual('mitigacao') },
      economia: { economiaPercentual: percentual('economia') },
    };
    definirErros(novos);
    if (Object.keys(novos).length > 0) return;
    configurar.mutate(entrada, {
      onSuccess: () => {
        avisar({ tipo: 'sucesso', titulo: 'Metas salvas', mensagem: 'O painel passa a medir contra as novas metas. A alteração ficou na trilha de auditoria.' });
        aoConcluir();
      },
    });
  };

  return (
    <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
      <fieldset className="grupo-campos">
        <legend>Tempo de instrução</legend>
        <CampoTexto rotulo="Redução pretendida (%)" inputMode="decimal" value={campos.reducao} onChange={mudar('reducao')} erro={erros.reducao} ajuda="Sobre a linha de base de cada etapa." />
        <div className="metas-formulario__etapas">
          {ETAPAS.map((etapa) => {
            const campo = `e${etapa}` as const;
            return (
              <CampoTexto
                key={etapa}
                rotulo={`Linha de base da etapa ${etapa} (dias)`}
                ajuda={ROTULOS_ETAPAS[etapa]}
                inputMode="decimal"
                value={campos[campo]}
                onChange={mudar(campo)}
                erro={erros[campo]}
              />
            );
          })}
        </div>
      </fieldset>
      <fieldset className="grupo-campos">
        <legend>Erros formais e economia</legend>
        <CampoTexto rotulo="Mitigação mínima de erros formais (%)" inputMode="decimal" value={campos.mitigacao} onChange={mudar('mitigacao')} erro={erros.mitigacao} />
        <CampoTexto rotulo="Economia mínima sobre o estimado (%)" inputMode="decimal" value={campos.economia} onChange={mudar('economia')} erro={erros.economia} />
      </fieldset>
    </form>
  );
}

function DialogoMetas({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const idFormulario = useId();
  const consulta = useConfiguracaoMetas(aberto);
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Configurar as metas do ETP"
      largura="ampla"
      descricao={<p>Informe as metas que o órgão declarou no demonstrativo de resultados do ETP. Deixe em branco o que não tiver meta. A alteração fica na trilha de auditoria.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario}>
            Salvar metas
          </Botao>
        </>
      }
    >
      {aberto ? (
        <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando as metas" tituloErro="Não foi possível carregar as metas">
          {(configuracao) => <FormularioMetas configuracao={configuracao} idFormulario={idFormulario} aoConcluir={aoFechar} />}
        </ConteudoConsulta>
      ) : null}
    </Dialogo>
  );
}

// ───────────────────────── página ─────────────────────────

function Conteudo({ painel, podeVerTrilha }: { painel: PainelMetasEtp; podeVerTrilha: boolean }) {
  const t = painel.tempoInstrucao.fase;
  const e = painel.errosFormais;
  const c = painel.economia;
  return (
    <div className="pilha pilha--ampla">
      {!painel.metasConfiguradas ? (
        <Alerta tipo="info" titulo="Metas ainda não configuradas">
          <p>O painel mostra as medições, mas só compara com a meta depois que o órgão informar as metas do ETP.</p>
        </Alerta>
      ) : null}
      <section aria-labelledby="metas-resumo" className="pilha pilha--compacta">
        <h2 id="metas-resumo" className="sr-only">
          Resumo dos três indicadores
        </h2>
        <div className="grade grade--kpi">
          <Indicador
            rotulo="Tempo de instrução"
            valor={dias(t.mediaDias)}
            icone={Clock}
            tom={tomIndicador(t.situacao)}
            detalhe={`Alvo ${dias(t.alvoDias)} · linha de base ${dias(t.linhaBaseDias)} · ${SITUACOES[t.situacao].rotulo.toLowerCase()}`}
          />
          <Indicador
            rotulo="Erros formais barrados"
            valor={formatarNumero(e.bloqueios)}
            icone={ShieldCheck}
            tom={tomIndicador(e.situacao)}
            detalhe={`Mitigação ${percentualOuTraco(e.mitigacaoPercentual)} · meta ${percentualOuTraco(e.metaPercentual, 0)} · ${SITUACOES[e.situacao].rotulo.toLowerCase()}`}
          />
          <Indicador
            rotulo="Economia sobre o estimado"
            valor={percentualOuTraco(c.economiaPercentual, 2)}
            icone={PiggyBank}
            tom={tomIndicador(c.situacao)}
            detalhe={`${formatarMoeda(c.economia)} · meta ${percentualOuTraco(c.metaPercentual)} · ${SITUACOES[c.situacao].rotulo.toLowerCase()}`}
          />
        </div>
      </section>
      <SecaoTempo tempo={painel.tempoInstrucao} />
      <SecaoErros erros={painel.errosFormais} podeVerTrilha={podeVerTrilha} />
      <SecaoEconomia economia={painel.economia} />
      <Secao titulo="Premissas e fontes" id="metas-fontes" simples>
        <ul>
          {[...painel.premissas, ...painel.fontes].map((texto) => (
            <li key={texto} className="texto-pequeno">
              {texto}
            </li>
          ))}
        </ul>
        <p className="texto-pequeno texto-secundario">Painel montado pelo servidor em {formatarInstante(painel.geradoEm)}.</p>
      </Secao>
    </div>
  );
}

export default function PainelMetas() {
  const { temPermissao } = useSessao();
  const p = useParametrosUrl();
  const hoje = hojeISO(new Date());
  const de = p.texto('de');
  const ate = p.texto('ate');
  const filtro = { uasg: p.texto('uasg'), de: de && validarDataISO(de) ? de : undefined, ate: ate && validarDataISO(ate) ? ate : undefined };
  const consulta = usePainelMetas(filtro);
  const [configurando, definirConfigurando] = useState(false);
  const periodo = consulta.data?.filtro;

  return (
    <Pagina
      titulo="Metas do ETP"
      subtitulo="Resultados pretendidos do Estudo Técnico Preliminar (Lei 14.133/2021, art. 18, § 1º, IX), medidos contra as metas configuradas pelo órgão."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="metas"
      acoes={
        temPermissao('metas:configurar') ? (
          <Botao variante="primario" icone={Settings} onClick={() => definirConfigurando(true)}>
            Configurar metas
          </Botao>
        ) : undefined
      }
    >
      <div className="pilha">
        <div className="filtros-metas" role="group" aria-label="Filtros do painel">
          <CampoUasg valor={filtro.uasg} aoMudar={(v) => p.atualizar({ uasg: v })} />
          <CampoTexto rotulo="De" type="date" value={filtro.de ?? ''} max={filtro.ate ?? hoje} onChange={(ev) => p.atualizar({ de: ev.target.value })} ajuda="Padrão: 12 meses antes do fim." />
          <CampoTexto rotulo="Até" type="date" value={filtro.ate ?? ''} max={hoje} onChange={(ev) => p.atualizar({ ate: ev.target.value })} ajuda="Padrão: hoje." />
          <a className="botao botao--secundario" href={urlCsvMetas(filtro)} download>
            <FileDown size={16} aria-hidden="true" />
            <span>Baixar CSV</span>
          </a>
        </div>
        {periodo ? (
          <p className="texto-pequeno texto-secundario" role="status">
            Período: {formatarData(periodo.de)} a {formatarData(periodo.ate)}
            {periodo.uasg ? `, UASG ${periodo.uasg}` : ', todas as UASGs do seu escopo'}.
          </p>
        ) : null}
        <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando o painel das metas" tituloErro="Não foi possível carregar o painel das metas">
          {(painel) => <Conteudo painel={painel} podeVerTrilha={temPermissao('auditoria:ler')} />}
        </ConteudoConsulta>
      </div>
      <DialogoMetas aberto={configurando} aoFechar={() => definirConfigurando(false)} />
    </Pagina>
  );
}
