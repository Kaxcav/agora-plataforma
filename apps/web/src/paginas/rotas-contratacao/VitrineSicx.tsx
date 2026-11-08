/**
 * `/sicx` — vitrine do Sistema de Compras Expressas (RN-42; art. 79, IV; Decreto 13.106/2026). Ranqueia as ofertas
 * aptas para a UF da UASG e a quantidade pedida; a ordem de compra usa a reserva do ETP abrangente ou o processo na
 * rota Sicx (etapa 6). No modo offline as ofertas são simuladas.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { CheckCheck, PackageCheck, ShoppingCart, Wallet } from 'lucide-react';
import type { CompraSicx, OfertaVitrineSicx } from '@agora/contratos';
import { formatarData, formatarMoeda, hojeISO } from '@agora/dominio';
import { useAcaoCompraSicx, useComprasSicx, useEmitirOrdemSicx, useReservasSicx, useVitrineSicx } from '../../api/rotas-contratacao';
import {
  Alerta,
  AreaTexto,
  Botao,
  CampoBusca,
  CampoTexto,
  Dialogo,
  Etiqueta,
  FalhaConsulta,
  Pagina,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { ErroOperacao } from '../jornada/comum';

const SITUACOES: Record<NonNullable<CompraSicx['prazos']>['situacao'], string> = {
  aguardando_entrega: 'Aguardando entrega',
  aguardando_recebimento_provisorio: 'Aguardando recebimento provisório',
  aguardando_recebimento_definitivo: 'Aguardando recebimento definitivo',
  aguardando_pagamento: 'Aguardando pagamento',
  paga: 'Paga',
};

function DialogoOrdem({ oferta, uasg, quantidade, processoId, aoFechar }: { oferta: OfertaVitrineSicx; uasg: string; quantidade: number; processoId: string | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const reservas = useReservasSicx(uasg);
  const emitir = useEmitirOrdemSicx();
  const [reservaId, definirReserva] = useState('');
  const [justificativa, definirJustificativa] = useState('');
  const melhor = oferta.posicao === 1;
  return (
    <Dialogo
      aberto
      aoFechar={aoFechar}
      titulo="Emitir ordem de compra no Sicx"
      largura="media"
      rodape={
        <>
          <Botao variante="terciario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="primario"
            icone={ShoppingCart}
            carregando={emitir.isPending}
            disabled={(!processoId && !reservaId) || (!melhor && justificativa.trim().length < 30)}
            onClick={() =>
              emitir.mutate(
                { ofertaId: oferta.id, quantidade, uasg, processoId, reservaId: processoId ? null : reservaId, justificativaSelecao: melhor ? null : justificativa },
                {
                  onSuccess: (c) => {
                    avisar({ tipo: 'sucesso', titulo: `Ordem de compra ${c.numero} emitida`, mensagem: 'Outro agente confirma e conclui a compra, salvo autorização prévia no ETP abrangente.' });
                    aoFechar();
                  },
                },
              )
            }
          >
            Emitir ordem de compra
          </Botao>
        </>
      }
    >
      <div className="pilha">
        <p>
          {oferta.posicao}ª oferta: <strong>{oferta.fornecedor.nome}</strong> — {quantidade} × {formatarMoeda(oferta.precoNaQuantidade)} ={' '}
          <strong className="numero">{formatarMoeda(oferta.valorTotal)}</strong>. Entrega em {oferta.prazoEntregaDias} dias; pagamento em até {oferta.prazoPagamentoDias} dias do recebimento.
        </p>
        {processoId ? (
          <Alerta tipo="info" compacto titulo="Compra do processo na rota Sicx (ETP específico)" />
        ) : (
          <Selecao
            rotulo="Reserva de limite do ETP abrangente"
            obrigatorio
            opcaoVazia="Selecione…"
            value={reservaId}
            onChange={(e) => definirReserva(e.target.value)}
            opcoes={(reservas.data ?? []).map((r) => ({
              valor: r.id,
              rotulo: `${r.etpReferencia} — saldo ${formatarMoeda(r.saldo)}${r.autorizacaoPrevia ? ' (com autorização prévia)' : ''}`,
            }))}
          />
        )}
        {!melhor ? (
          <AreaTexto
            rotulo="Justificativa para não escolher a melhor oferta"
            ajuda="Obrigatória fora da 1ª posição, com pelo menos 30 caracteres (Decreto 13.106/2026, art. 19)."
            value={justificativa}
            onChange={(e) => definirJustificativa(e.target.value)}
            rows={3}
            obrigatorio
          />
        ) : null}
        <ErroOperacao erro={emitir.error} titulo="A ordem de compra não foi emitida" />
      </div>
    </Dialogo>
  );
}

function AcoesCompra({ compra }: { compra: CompraSicx }) {
  const { temPermissao } = useSessao();
  const acao = useAcaoCompraSicx();
  const { avisar } = useAvisos();
  const hoje = hojeISO(new Date());
  const executar = (nome: 'conclusao' | 'entrega' | 'recebimento' | 'pagamento', corpo: unknown, mensagem: string) =>
    acao.mutate({ id: compra.id, acao: nome, corpo }, { onSuccess: (c) => avisar({ tipo: 'sucesso', titulo: mensagem, mensagem: `Compra ${c.numero}.` }), onError: () => undefined });
  const situacao = compra.prazos?.situacao;
  return (
    <div className="pilha pilha--compacta">
      {compra.situacao === 'ordem_emitida' && temPermissao('jornada:editar') ? (
        <Botao tamanho="compacto" icone={CheckCheck} onClick={() => executar('conclusao', {}, `Compra ${compra.numero} concluída`)} carregando={acao.isPending}>
          Concluir compra
        </Botao>
      ) : null}
      {situacao === 'aguardando_entrega' && temPermissao('jornada:editar') ? (
        <Botao tamanho="compacto" icone={PackageCheck} onClick={() => executar('entrega', { data: hoje }, 'Entrega registrada')}>
          Registrar entrega
        </Botao>
      ) : null}
      {situacao === 'aguardando_recebimento_provisorio' && temPermissao(['pagamentos:atestar', 'jornada:editar']) ? (
        <Botao tamanho="compacto" onClick={() => executar('recebimento', { tipo: 'provisorio', data: hoje }, 'Recebimento provisório registrado')}>
          Receber provisoriamente
        </Botao>
      ) : null}
      {situacao === 'aguardando_recebimento_definitivo' && temPermissao(['pagamentos:atestar', 'jornada:editar']) ? (
        <Botao tamanho="compacto" onClick={() => executar('recebimento', { tipo: 'definitivo', data: hoje }, 'Recebimento definitivo registrado')}>
          Receber definitivamente
        </Botao>
      ) : null}
      {situacao === 'aguardando_pagamento' && temPermissao('pagamentos:registrar') ? (
        <Botao tamanho="compacto" icone={Wallet} onClick={() => executar('pagamento', { data: hoje }, 'Pagamento registrado')}>
          Registrar pagamento
        </Botao>
      ) : null}
      <ErroOperacao erro={acao.error} />
    </div>
  );
}

export default function VitrineSicx() {
  const [params] = useSearchParams();
  const { usuario } = useSessao();
  const processoId = params.get('processo');
  const [uasg, definirUasg] = useState(params.get('uasg') ?? usuario?.uasgs[0] ?? '910001');
  const [busca, definirBusca] = useState('');
  const [quantidadeTexto, definirQuantidade] = useState('10');
  const quantidade = Math.max(1, Number.parseInt(quantidadeTexto, 10) || 1);
  const vitrine = useVitrineSicx(uasg, busca, quantidade);
  const compras = useComprasSicx(uasg);
  const [escolhida, definirEscolhida] = useState<OfertaVitrineSicx | null>(null);

  return (
    <Pagina
      titulo="Vitrine do Sicx"
      tela="sicx"
      subtitulo="Comércio eletrônico de bens e serviços comuns padronizados (art. 79, IV, Lei 14.133/2021; Decreto 13.106/2026)"
      trilha={[{ rotulo: 'Início', para: '/' }]}
    >
      {vitrine.data?.modo === 'offline' ? (
        <Alerta tipo="info" compacto titulo="Vitrine simulada">
          <p>Integrações em modo offline: ofertas sintéticas. A integração com a plataforma do governo depende das normas complementares do órgão central.</p>
        </Alerta>
      ) : null}
      {processoId ? <Alerta tipo="info" compacto titulo="Compra vinculada ao processo na rota Sicx (etapa 6)" /> : null}
      <Secao titulo="Buscar na vitrine">
        <div className="grade grade--3">
          <CampoTexto rotulo="UASG compradora" value={uasg} onChange={(e) => definirUasg(e.target.value.trim())} inputMode="numeric" maxLength={6} disabled={processoId !== null} />
          <CampoBusca rotulo="Item" valor={busca} aoMudar={definirBusca} placeholder="Ex.: papel, toner" />
          <CampoTexto rotulo="Quantidade" type="number" min={1} inputMode="numeric" value={quantidadeTexto} onChange={(e) => definirQuantidade(e.target.value)} />
        </div>
        {vitrine.data ? <p className="texto-pequeno texto-secundario">UF da UASG: {vitrine.data.uf}. Ranqueamento automático (Decreto 13.106/2026, art. 17).</p> : null}
      </Secao>
      {vitrine.isError ? <FalhaConsulta consulta={vitrine} titulo="Não foi possível carregar a vitrine" /> : null}
      {(vitrine.data?.itens ?? []).map((item) => (
        <Secao key={item.codigo} titulo={item.descricao} descricao={`${item.codigo} · ${item.categoria} · unidade: ${item.unidade}`}>
          <Tabela
            id={`sicx-${item.codigo}`}
            legenda={`Ofertas de ${item.descricao}`}
            semFerramentas
            linhas={item.ofertas}
            chave={(o) => o.id}
            destaque={(o) => (o.posicao === null ? 'erro' : o.posicao === 1 ? 'sucesso' : undefined)}
            colunas={[
              { id: 'posicao', cabecalho: 'Posição', celula: (o) => (o.posicao ? `${o.posicao}º` : 'Inapta'), prioritaria: true },
              { id: 'fornecedor', cabecalho: 'Fornecedor', celula: (o) => o.fornecedor.nome, identificadora: true, prioritaria: true },
              { id: 'preco', cabecalho: 'Preço na quantidade', celula: (o) => <span className="numero">{formatarMoeda(o.precoNaQuantidade)}</span>, alinhamento: 'fim' },
              { id: 'total', cabecalho: 'Total', celula: (o) => <span className="numero">{formatarMoeda(o.valorTotal)}</span>, alinhamento: 'fim', prioritaria: true },
              { id: 'entrega', cabecalho: 'Entrega', celula: (o) => `${o.prazoEntregaDias} dias` },
              { id: 'pagamento', cabecalho: 'Pagamento', celula: (o) => `até ${o.prazoPagamentoDias} dias` },
              { id: 'reputacao', cabecalho: 'Reputação', celula: (o) => o.reputacao.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
              {
                id: 'situacao',
                cabecalho: 'Situação',
                celula: (o) =>
                  o.posicao === null ? (
                    <span>{o.motivoInaptidao}</span>
                  ) : o.desempate !== 'nenhum' ? (
                    <Etiqueta tom="neutro" compacta>
                      {o.desempate === 'sorteio' ? 'Empate resolvido por sorteio' : 'Empate resolvido pela reputação'}
                    </Etiqueta>
                  ) : (
                    'Apta'
                  ),
              },
            ]}
            acoes={{
              cabecalho: 'Comprar',
              celula: (o) =>
                o.posicao !== null ? (
                  <Botao tamanho="compacto" icone={ShoppingCart} onClick={() => definirEscolhida(o)} aria-label={`Selecionar oferta ${o.posicao}º de ${o.fornecedor.nome}`}>
                    Selecionar
                  </Botao>
                ) : null,
            }}
          />
        </Secao>
      ))}
      {vitrine.data && vitrine.data.itens.length === 0 ? <Alerta tipo="info" titulo="Nenhum item encontrado na vitrine." /> : null}

      <Secao titulo="Compras da UASG" descricao="A conclusão é a contratação; recebimento provisório em 2 dias úteis da entrega, definitivo em 10 dias, pagamento em até 30 dias do recebimento.">
        <Tabela
          id="sicx-compras"
          legenda="Compras no Sicx"
          semFerramentas
          linhas={compras.data}
          carregando={compras.isLoading}
          chave={(c) => c.id}
          vazio="Nenhuma compra registrada para esta UASG."
          colunas={[
            { id: 'numero', cabecalho: 'Compra', celula: (c) => <span className="mono">{c.numero}</span>, identificadora: true, prioritaria: true },
            { id: 'item', cabecalho: 'Item', celula: (c) => `${c.item.descricao} × ${c.quantidade}`, prioritaria: true },
            { id: 'fornecedor', cabecalho: 'Fornecedor', celula: (c) => c.fornecedor.nome },
            { id: 'total', cabecalho: 'Total', celula: (c) => <span className="numero">{formatarMoeda(c.valorTotal)}</span>, alinhamento: 'fim' },
            { id: 'ordem', cabecalho: 'Ordem', celula: (c) => `${c.ordemPor.nome}${c.conclusaoPor ? ` · concluída por ${c.conclusaoPor.nome}` : ''}` },
            {
              id: 'situacao',
              cabecalho: 'Situação',
              prioritaria: true,
              celula: (c) =>
                c.situacao === 'ordem_emitida' ? (
                  <Etiqueta tom="aviso">Ordem emitida</Etiqueta>
                ) : (
                  <span>
                    <Etiqueta tom={c.prazos?.situacao === 'paga' ? 'sucesso' : c.prazos?.pagamentoVencido ? 'erro' : 'info'}>{c.prazos ? SITUACOES[c.prazos.situacao] : 'Concluída'}</Etiqueta>
                    {c.prazos?.limitePagamento && c.prazos.situacao !== 'paga' ? <span className="texto-pequeno"> pagar até {formatarData(c.prazos.limitePagamento)}</span> : null}
                  </span>
                ),
            },
          ]}
          acoes={{ cabecalho: 'Ações', celula: (c) => <AcoesCompra compra={c} /> }}
        />
      </Secao>
      {escolhida ? <DialogoOrdem oferta={escolhida} uasg={uasg} quantidade={quantidade} processoId={processoId} aoFechar={() => definirEscolhida(null)} /> : null}
    </Pagina>
  );
}
