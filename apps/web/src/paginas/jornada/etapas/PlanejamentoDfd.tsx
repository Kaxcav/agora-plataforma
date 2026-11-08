/**
 * Planejamento no DFD (etapa 1): item do PCA publicado em que a demanda está prevista ou a justificativa da demanda fora
 * do plano (art. 18, § 1º, II — RF-31), código do catálogo de cada item com a sugestão por semelhança de texto (RIA-13,
 * escolha do agente) e o sinal de registro de preços compartilhado com outras unidades (RIA-01). As consultas ao PNCP e
 * ao catálogo oficial são feitas pelo servidor; a conferência e os bloqueios também.
 *
 * As escritas daqui gravam no DFD salvo: com alterações não salvas no formulário, ficam indisponíveis até salvar ou
 * descartar, para que um lado não sobrescreva o outro.
 */
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BookCheck, CloudDownload, Lightbulb, Link2, PackageSearch } from 'lucide-react';
import type { DadosDfd } from '../../../api/jornada';
import type { ProcessoDetalhe, SugestoesCatalogo, TipoItemCatalogo } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { useConsultarPcaPncp, useEscolherCodigoCatalogo, usePlanejamentoDfd, useSugestoesCatalogo, useVincularPca } from '../../../api/planejamento';
import { Alerta, AreaTexto, Botao, Etiqueta, GrupoOpcoes, Selecao, useAvisos } from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { formatarInstante, formatarNumero } from '../../../utilitarios/formatacao';
import { ErroOperacao } from '../comum';
import { MINIMO_TEXTO } from './tipos';

interface PropsPlanejamentoDfd {
  processo: ProcessoDetalhe;
  editavel: boolean;
  /** O formulário do DFD tem alterações não salvas. */
  formularioAlterado: boolean;
  /** Atualiza o formulário do DFD com o que o servidor gravou (só é chamado sem alterações pendentes). */
  aoAtualizarDfd: (dfd: DadosDfd) => void;
}

type OpcaoVinculo = 'item' | 'fora_do_pca';

function SecaoPca({ processo, editavel, formularioAlterado, aoAtualizarDfd }: PropsPlanejamentoDfd) {
  const base = useId();
  const { avisar } = useAvisos();
  const consulta = usePlanejamentoDfd(processo.id, processo.atualizadoEm);
  const vincular = useVincularPca(processo.id);
  const consultarPncp = useConsultarPcaPncp(processo.id);
  const [opcao, definirOpcao] = useState<OpcaoVinculo | null>(null);
  const [itemId, definirItemId] = useState('');
  const [justificativa, definirJustificativa] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const painel = consulta.data;
  const tituloId = `${base}-pca`;

  if (!painel) {
    return (
      <section className="jornada-referencia" aria-labelledby={tituloId} aria-busy={consulta.isPending}>
        <h3 id={tituloId} className="jornada-requisitos__titulo">
          Plano de contratações anual (PCA)
        </h3>
        {consulta.isError ? <ErroOperacao erro={consulta.error} titulo="Não foi possível carregar o PCA da UASG" /> : <p className="texto-secundario">Carregando o PCA da UASG…</p>}
      </section>
    );
  }

  const escolhida: OpcaoVinculo | null = opcao ?? painel.vinculo?.tipo ?? null;
  const itemSelecionado = itemId || (painel.vinculo?.tipo === 'item' ? painel.vinculo.item.id : '');
  const podeEscrever = editavel && !formularioAlterado;

  const registrar = (evento: FormEvent) => {
    evento.preventDefault();
    if (escolhida === null) {
      definirErro('Escolha se a demanda está prevista em um item do PCA ou se não consta do plano.');
      return;
    }
    if (escolhida === 'item' && itemSelecionado === '') {
      definirErro('Escolha o item do PCA em que a demanda está prevista.');
      return;
    }
    const texto = justificativa.trim() || (painel.vinculo?.tipo === 'fora_do_pca' ? painel.vinculo.justificativa : '');
    if (escolhida === 'fora_do_pca' && texto.length < MINIMO_TEXTO) {
      definirErro(`Registre a justificativa da contratação não prevista no PCA, com pelo menos ${MINIMO_TEXTO} caracteres.`);
      document.getElementById(`${base}-justificativa`)?.focus();
      return;
    }
    definirErro(null);
    vincular.mutate(escolhida === 'item' ? { tipo: 'item', itemId: itemSelecionado } : { tipo: 'fora_do_pca', justificativa: texto }, {
      onSuccess: (atualizado) => {
        aoAtualizarDfd(atualizado.dfd);
        definirOpcao(null);
        definirJustificativa('');
        avisar({ tipo: 'sucesso', titulo: 'Vínculo com o PCA registrado', mensagem: escolhida === 'item' ? 'O DFD aponta o item do plano.' : 'A justificativa entrou no processo.' });
      },
    });
  };

  const { conferencia } = painel;
  return (
    <section className="jornada-referencia" aria-labelledby={tituloId}>
      <h3 id={tituloId} className="jornada-requisitos__titulo">
        Plano de contratações anual (PCA)
      </h3>
      <p>
        {painel.exigePca
          ? `A UASG ${painel.uasg} tem PCA ${painel.exercicio} publicado: aponte o item do plano em que a demanda está prevista ou justifique a contratação não planejada (Lei 14.133/2021, art. 18, § 1º, II).`
          : `A UASG ${painel.uasg} não tem PCA ${painel.exercicio} publicado. A demonstração da previsão no plano só é exigida quando ele foi elaborado; se a demanda constar de um plano, aponte o item.`}
      </p>
      {painel.vinculo ? (
        <p className="linha">
          <Etiqueta tom={painel.vinculo.tipo === 'item' ? 'sucesso' : 'aviso'} compacta>
            {painel.vinculo.tipo === 'item' ? 'Prevista no PCA' : 'Fora do PCA, com justificativa'}
          </Etiqueta>
          <span>
            {painel.vinculo.tipo === 'item'
              ? `Item ${painel.vinculo.item.identificador} — ${painel.vinculo.item.descricao} (${formatarMoeda(painel.vinculo.item.valorTotal)} planejados)`
              : painel.vinculo.justificativa}
          </span>
        </p>
      ) : null}
      {conferencia.pendencias.length > 0 ? (
        <Alerta tipo="aviso" compacto titulo="Conferência do DFD com o PCA (RF-31)">
          <ul>
            {conferencia.pendencias.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}
      {conferencia.alertas.map((a) => (
        <Alerta key={a.mensagem} tipo={a.nivel === 'atencao' ? 'aviso' : 'info'} compacto>
          <p>{a.mensagem}</p>
        </Alerta>
      ))}

      {editavel ? (
        <form className="formulario" onSubmit={registrar} noValidate aria-describedby={formularioAlterado ? `${base}-pendente` : undefined}>
          <fieldset className="grupo-campos" disabled={!podeEscrever || vincular.isPending}>
            <legend className="sr-only">Vínculo do DFD com o PCA</legend>
            <GrupoOpcoes
              legenda="Previsão da demanda no PCA"
              nome={`${base}-opcao`}
              horizontal
              opcoes={[
                { valor: 'item', rotulo: 'Item do PCA publicado', ajuda: `${painel.itensDisponiveis.length} itens publicados para a UASG` },
                { valor: 'fora_do_pca', rotulo: 'Não consta do PCA', ajuda: 'Exige justificativa e a revisão do plano' },
              ]}
              valor={escolhida}
              aoMudar={(v) => {
                definirOpcao(v);
                definirErro(null);
              }}
            />
            {escolhida === 'item' ? (
              <Selecao
                rotulo="Item do PCA"
                obrigatorio
                opcaoVazia="Selecione o item do plano"
                opcoes={painel.itensDisponiveis.map((i) => ({
                  valor: i.id,
                  rotulo: `${i.identificador} — ${i.descricao} (${formatarNumero(i.quantidade)} ${i.unidadeFornecimento}, ${formatarMoeda(i.valorTotal)}, até ${formatarData(i.dataDesejada)})`,
                }))}
                value={itemSelecionado}
                onChange={(e) => definirItemId(e.target.value)}
                ajuda={painel.itensDisponiveis.length === 0 ? 'Não há item publicado para a UASG. Consulte o PNCP ou justifique a demanda fora do plano.' : undefined}
              />
            ) : null}
            {escolhida === 'fora_do_pca' ? (
              <AreaTexto
                id={`${base}-justificativa`}
                rotulo="Justificativa da contratação não prevista no PCA"
                obrigatorio
                rows={3}
                maxLength={4000}
                value={justificativa || (painel.vinculo?.tipo === 'fora_do_pca' ? painel.vinculo.justificativa : '')}
                onChange={(e) => definirJustificativa(e.target.value)}
                ajuda={`Por que a demanda não constava do plano. Mínimo de ${MINIMO_TEXTO} caracteres. O plano deve ser revisado para incluí-la.`}
              />
            ) : null}
            {erro ? (
              <p className="campo__erro" role="alert">
                {erro}
              </p>
            ) : null}
            <div className="linha">
              <Botao type="submit" variante="primario" icone={Link2} carregando={vincular.isPending}>
                Registrar vínculo com o PCA
              </Botao>
              <Botao
                variante="secundario"
                icone={CloudDownload}
                carregando={consultarPncp.isPending}
                onClick={() =>
                  consultarPncp.mutate(undefined, {
                    onSuccess: (p) => avisar({ tipo: 'sucesso', titulo: 'PCA consultado', mensagem: `${p.itensDisponiveis.length} itens publicados para a UASG ${p.uasg}.` }),
                  })
                }
              >
                Consultar o PCA no PNCP
              </Botao>
            </div>
          </fieldset>
          {formularioAlterado ? (
            <p id={`${base}-pendente`} className="texto-pequeno texto-secundario">
              Salve ou descarte as alterações do DFD antes de registrar o vínculo com o PCA.
            </p>
          ) : null}
          <ErroOperacao erro={vincular.error ?? consultarPncp.error} titulo="Não foi possível concluir a operação do PCA" />
        </form>
      ) : null}
      {painel.consultaPncp ? (
        <p className="texto-pequeno texto-secundario">
          Última consulta ao PNCP: {formatarInstante(painel.consultaPncp.consultadoEm)} ({painel.consultaPncp.modo === 'online' ? 'PNCP' : 'modo offline, carga de demonstração'}),{' '}
          {painel.consultaPncp.registros} itens, conteúdo <span className="mono">{painel.consultaPncp.hash.slice(0, 12)}</span>.
        </p>
      ) : null}
      <p className="texto-pequeno texto-secundario">A marcação “Demanda prevista no PCA” do DFD acompanha o vínculo registrado aqui. {conferencia.fundamento}.</p>
    </section>
  );
}

function SugestaoItem({
  processo,
  indice,
  podeEscrever,
  aoAtualizarDfd,
}: {
  processo: ProcessoDetalhe;
  indice: number;
  podeEscrever: boolean;
  aoAtualizarDfd: (dfd: DadosDfd) => void;
}) {
  const { avisar } = useAvisos();
  const sugerir = useSugestoesCatalogo();
  const escolher = useEscolherCodigoCatalogo(processo.id);
  const [resultado, definirResultado] = useState<SugestoesCatalogo | null>(null);
  const item = processo.dfd.itens[indice];
  if (!item) return null;
  const n = indice + 1;
  const tipo: TipoItemCatalogo = processo.dfd.tipoObjeto === 'bens' ? 'material' : 'servico';
  const listaId = `sugestoes-item-${n}`;

  return (
    <li className="pilha pilha--compacta">
      <p className="linha">
        <strong>Item {n}</strong>
        <span>{item.descricao}</span>
        <Etiqueta tom={item.catmat ? 'sucesso' : 'aviso'} compacta>
          {item.catmat ? `${tipo === 'material' ? 'CATMAT' : 'CATSER'} ${item.catmat}` : 'Sem código do catálogo'}
        </Etiqueta>
      </p>
      <div>
        <Botao
          variante="secundario"
          tamanho="compacto"
          icone={Lightbulb}
          carregando={sugerir.isPending}
          disabled={item.descricao.trim().length < 3}
          onClick={() => sugerir.mutate({ descricao: item.descricao, tipo }, { onSuccess: definirResultado })}
        >
          Sugerir código para o item {n}
        </Botao>
      </div>
      <ErroOperacao erro={sugerir.error ?? escolher.error} titulo="Não foi possível concluir a operação do catálogo" />
      {resultado ? (
        resultado.sugestoes.length === 0 ? (
          <p className="texto-pequeno texto-secundario" role="status">
            Nenhum item do catálogo parecido com a descrição. Consulte o catálogo pelo código ou justifique a não utilização (RN-02).
          </p>
        ) : (
          <div className="pilha pilha--compacta">
            <ul aria-label={`Sugestões para o item ${n}`} className="pilha pilha--compacta">
              {resultado.sugestoes.map((s) => (
                <li key={`${s.tipo}-${s.codigo}`} className="linha">
                  <span className="mono">{s.codigo}</span>
                  <span>{s.descricao}</span>
                  <Etiqueta tom="info" compacta titulo={`Termos em comum: ${s.termosComuns.join(', ')}`}>
                    Semelhança {s.pontuacao}%
                  </Etiqueta>
                  <Botao
                    variante="terciario"
                    tamanho="compacto"
                    icone={BookCheck}
                    disabled={!podeEscrever || item.catmat === s.codigo}
                    carregando={escolher.isPending && escolher.variables?.entrada.codigo === s.codigo}
                    onClick={() =>
                      escolher.mutate(
                        { indice: n, entrada: { codigo: s.codigo, tipo: s.tipo, origem: 'sugestao', pontuacao: s.pontuacao } },
                        {
                          onSuccess: (atualizado) => {
                            aoAtualizarDfd(atualizado.dfd);
                            avisar({ tipo: 'sucesso', titulo: 'Código do catálogo registrado', mensagem: `Item ${n}: código ${s.codigo}.` });
                          },
                        },
                      )
                    }
                  >
                    Usar o código {s.codigo} no item {n}
                  </Botao>
                </li>
              ))}
            </ul>
            <p id={listaId} className="texto-pequeno texto-secundario">
              {resultado.aviso} Fonte: {resultado.fontes.join('; ')}.
            </p>
          </div>
        )
      ) : null}
    </li>
  );
}

function SecaoCatalogo({ processo, editavel, formularioAlterado, aoAtualizarDfd }: PropsPlanejamentoDfd) {
  const tituloId = `${useId()}-catalogo`;
  if (processo.dfd.itens.length === 0) return null;
  const podeEscrever = editavel && !formularioAlterado;
  return (
    <section className="jornada-referencia" aria-labelledby={tituloId}>
      <h3 id={tituloId} className="jornada-requisitos__titulo">
        Código do catálogo (CATMAT/CATSER)
      </h3>
      <p>
        A sugestão compara a descrição de cada item salvo com o catálogo de materiais e serviços do governo federal, consultado pelo servidor (RIA-13). Confira o
        item no catálogo antes de usar o código: a escolha é sua e fica na trilha de auditoria.
      </p>
      {editavel && formularioAlterado ? (
        <p className="texto-pequeno texto-secundario">Salve ou descarte as alterações do DFD antes de escolher os códigos.</p>
      ) : null}
      <ul className="pilha">
        {processo.dfd.itens.map((_, i) => (
          <SugestaoItem key={i} processo={processo} indice={i} podeEscrever={podeEscrever} aoAtualizarDfd={aoAtualizarDfd} />
        ))}
      </ul>
    </section>
  );
}

function SecaoRegistroCompartilhado({ processo }: { processo: ProcessoDetalhe }) {
  const { temPermissao } = useSessao();
  const consulta = usePlanejamentoDfd(processo.id, processo.atualizadoEm);
  const tituloId = `${useId()}-irp`;
  const painel = consulta.data;
  if (!painel || (painel.registroPrecosCompartilhado.length === 0 && painel.irps.length === 0)) return null;
  return (
    <section className="jornada-referencia" aria-labelledby={tituloId}>
      <h3 id={tituloId} className="jornada-requisitos__titulo">
        Registro de preços compartilhado (RIA-01)
      </h3>
      {painel.registroPrecosCompartilhado.map((s) => {
        const item = processo.dfd.itens.find((i) => i.catmat === s.codigoCatalogo);
        const parametros = new URLSearchParams({
          nova: '1',
          processo: processo.id,
          uasg: painel.uasg,
          codigo: s.codigoCatalogo,
          objeto: `Registro de preços: ${item?.descricao ?? s.descricao}`,
          quantidade: String(item?.quantidade ?? ''),
          unidade: item?.unidade ?? 'unidade',
        });
        return (
          <Alerta key={s.codigoCatalogo} tipo="info" compacto titulo={`Demanda semelhante em outras unidades — código ${s.codigoCatalogo}`}>
            <p>{s.mensagem}</p>
            <p className="texto-pequeno">Sinal para análise: a decisão de propor a intenção de registro de preços é sua. {s.fundamento}.</p>
            {temPermissao('irp:gerenciar') ? (
              <p>
                <Link to={`/planejamento/irp?${parametros.toString()}`}>
                  <PackageSearch size={16} aria-hidden="true" /> Propor intenção de registro de preços para o código {s.codigoCatalogo}
                </Link>
              </p>
            ) : null}
          </Alerta>
        );
      })}
      {painel.irps.length > 0 ? (
        <ul>
          {painel.irps.map((i) => (
            <li key={i.id}>
              <Link to={`/planejamento/irp?irp=${encodeURIComponent(i.id)}`}>IRP {i.numero}</Link> — {i.situacao}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function PlanejamentoDfd(props: PropsPlanejamentoDfd) {
  return (
    <>
      <SecaoPca {...props} />
      <SecaoCatalogo {...props} />
      <SecaoRegistroCompartilhado processo={props.processo} />
    </>
  );
}
