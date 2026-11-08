/**
 * `/cartao-pagamento` — compras por dispensa de valor pagas com o cartão de pagamento e extrato mensal divulgado no
 * PNCP (art. 75, § 4º). Cada compra entra no controle de fracionamento do mesmo ramo (art. 75, § 1º).
 */
import { useState, type FormEvent } from 'react';
import { CreditCard, Send } from 'lucide-react';
import type { FracionamentoRota } from '@agora/contratos';
import { formatarData, formatarMoeda, hojeISO, type Centavos } from '@agora/dominio';
import { useComprasCartao, useExtratosCartao, usePublicarExtratoCartao, useRegistrarCompraCartao } from '../../api/rotas-contratacao';
import { Alerta, Botao, CampoMoeda, CampoTexto, Etiqueta, GrupoOpcoes, Pagina, Secao, Tabela, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import { SeletorFornecedor } from './componentes';

export default function CartaoPagamento() {
  const { temPermissao, usuario } = useSessao();
  const { avisar } = useAvisos();
  const podeRegistrar = temPermissao('pagamentos:registrar');
  const [uasg, definirUasg] = useState(usuario?.uasgs[0] ?? '930001');
  const [competencia, definirCompetencia] = useState(hojeISO(new Date()).slice(0, 7));
  const compras = useComprasCartao({ uasg: /^\d{6}$/.test(uasg) ? uasg : undefined, competencia: /^\d{4}-\d{2}$/.test(competencia) ? competencia : undefined });
  const extratos = useExtratosCartao();
  const registrar = useRegistrarCompraCartao();
  const publicar = usePublicarExtratoCartao();
  const [data, definirData] = useState(hojeISO(new Date()));
  const [fornecedorId, definirFornecedor] = useState('');
  const [valor, definirValor] = useState<Centavos | null>(null);
  const [objeto, definirObjeto] = useState('');
  const [natureza, definirNatureza] = useState('');
  const [tipo, definirTipo] = useState<'demais' | 'obras_servicos_engenharia'>('demais');
  const [ultimoSinal, definirUltimoSinal] = useState<FracionamentoRota | null>(null);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (valor === null) return;
    registrar.mutate(
      { uasg, data, fornecedorId, valor, objeto, natureza, tipoObjeto: tipo },
      {
        onSuccess: (r) => {
          definirUltimoSinal(r.fracionamento);
          definirValor(null);
          definirObjeto('');
          avisar({ tipo: r.fracionamento.sinal === 'sem_risco' ? 'sucesso' : 'aviso', titulo: 'Compra com cartão registrada', mensagem: r.fracionamento.sinal === 'sem_risco' ? 'A soma do ramo no exercício está abaixo de 80% do limite.' : 'Veja o sinal de fracionamento do ramo.' });
        },
      },
    );
  };

  return (
    <Pagina titulo="Cartão de pagamento" tela="cartao-pagamento" subtitulo="Compras por dispensa de valor pagas com cartão e extrato no PNCP (art. 75, § 4º)" trilha={[{ rotulo: 'Início', para: '/' }]}>
      <Secao titulo="Filtro">
        <div className="grade grade--2">
          <CampoTexto rotulo="UASG" value={uasg} onChange={(e) => definirUasg(e.target.value.trim())} inputMode="numeric" maxLength={6} />
          <CampoTexto rotulo="Competência" type="month" value={competencia} onChange={(e) => definirCompetencia(e.target.value)} />
        </div>
      </Secao>

      {podeRegistrar ? (
        <Secao titulo="Registrar compra com cartão" descricao="Só para contratações por valor (art. 75, I e II), dentro do limite vigente. O ramo de atividade entra na soma do fracionamento.">
          <form className="formulario pilha" onSubmit={enviar}>
            <div className="grade grade--2">
              <CampoTexto rotulo="Data da compra" type="date" value={data} onChange={(e) => definirData(e.target.value)} obrigatorio />
              <CampoMoeda rotulo="Valor" valor={valor} aoMudar={definirValor} obrigatorio />
            </div>
            <SeletorFornecedor valor={fornecedorId} aoMudar={definirFornecedor} obrigatorio />
            <CampoTexto rotulo="Objeto" value={objeto} onChange={(e) => definirObjeto(e.target.value)} obrigatorio />
            <CampoTexto rotulo="Ramo de atividade" ajuda="Ex.: material de expediente." value={natureza} onChange={(e) => definirNatureza(e.target.value)} obrigatorio />
            <GrupoOpcoes
              legenda="Tipo do objeto"
              nome="cartao-tipo"
              horizontal
              valor={tipo}
              aoMudar={definirTipo}
              opcoes={[
                { valor: 'demais', rotulo: 'Compras e demais serviços (art. 75, II)' },
                { valor: 'obras_servicos_engenharia', rotulo: 'Obras e serviços de engenharia (art. 75, I)' },
              ]}
            />
            <div className="jornada-barra-acoes">
              <span />
              <Botao type="submit" variante="primario" icone={CreditCard} carregando={registrar.isPending} disabled={!fornecedorId || valor === null || objeto.trim().length < 5 || natureza.trim().length < 2}>
                Registrar compra
              </Botao>
            </div>
            <ErroOperacao erro={registrar.error} titulo="A compra não foi registrada" />
          </form>
          {ultimoSinal ? (
            <Alerta tipo={ultimoSinal.sinal === 'risco' ? 'erro' : ultimoSinal.sinal === 'atencao' ? 'aviso' : 'info'} titulo={`Fracionamento no ramo "${ultimoSinal.natureza}" (RIA-01)`} anunciar>
              <p>{ultimoSinal.explicacao}</p>
            </Alerta>
          ) : null}
        </Secao>
      ) : null}

      <Secao titulo="Compras da competência">
        <Tabela
          id="cartao-compras"
          legenda="Compras com cartão de pagamento"
          semFerramentas
          linhas={compras.data}
          carregando={compras.isLoading}
          chave={(c) => c.id}
          vazio="Nenhuma compra com cartão nesta competência."
          colunas={[
            { id: 'data', cabecalho: 'Data', celula: (c) => formatarData(c.data), prioritaria: true },
            { id: 'objeto', cabecalho: 'Objeto', celula: (c) => c.objeto, identificadora: true, prioritaria: true },
            { id: 'fornecedor', cabecalho: 'Favorecido', celula: (c) => `${c.fornecedor.nome} (${c.fornecedor.documento})` },
            { id: 'natureza', cabecalho: 'Ramo', celula: (c) => c.natureza },
            { id: 'valor', cabecalho: 'Valor', celula: (c) => <span className="numero">{formatarMoeda(c.valor)}</span>, alinhamento: 'fim', prioritaria: true },
            { id: 'extrato', cabecalho: 'Extrato', celula: (c) => (c.extratoId ? 'No extrato' : 'Pendente') },
          ]}
        />
        {podeRegistrar ? (
          <div className="jornada-barra-acoes">
            <span className="texto-pequeno texto-secundario">O extrato vai ao PNCP pela fila de integrações do servidor.</span>
            <Botao
              icone={Send}
              carregando={publicar.isPending}
              onClick={() => publicar.mutate({ uasg, competencia }, { onSuccess: (e) => avisar({ tipo: e.situacao === 'publicado' ? 'sucesso' : 'aviso', titulo: e.situacao === 'publicado' ? 'Extrato divulgado no PNCP' : 'Extrato na fila', mensagem: `Competência ${e.competencia}: ${e.quantidade} compra(s).` }) })}
            >
              Divulgar extrato da competência no PNCP
            </Botao>
          </div>
        ) : null}
        <ErroOperacao erro={publicar.error} titulo="O extrato não foi divulgado" />
      </Secao>

      <Secao titulo="Extratos divulgados">
        <Tabela
          id="cartao-extratos"
          legenda="Extratos do cartão de pagamento"
          semFerramentas
          linhas={extratos.data}
          carregando={extratos.isLoading}
          chave={(e) => e.id}
          vazio="Nenhum extrato divulgado."
          colunas={[
            { id: 'competencia', cabecalho: 'Competência', celula: (e) => e.competencia, identificadora: true, prioritaria: true },
            { id: 'uasg', cabecalho: 'UASG', celula: (e) => e.uasg },
            { id: 'total', cabecalho: 'Total', celula: (e) => <span className="numero">{`${formatarMoeda(e.total)} (${e.quantidade})`}</span>, alinhamento: 'fim' },
            {
              id: 'situacao',
              cabecalho: 'PNCP',
              prioritaria: true,
              celula: (e) => (
                <Etiqueta tom={e.situacao === 'publicado' ? 'sucesso' : e.situacao === 'erro' ? 'erro' : 'aviso'}>
                  {e.situacao === 'publicado' ? `Divulgado${e.modo === 'offline' ? ' (simulação)' : ''}` : e.situacao === 'erro' ? 'Na fila de erro' : 'Na fila'}
                </Etiqueta>
              ),
            },
            { id: 'protocolo', cabecalho: 'Protocolo', celula: (e) => (e.protocolo ? <span className="mono">{e.protocolo}</span> : (e.ultimoErro ?? '—')) },
            { id: 'quando', cabecalho: 'Divulgado em', celula: (e) => (e.publicadoEm ? formatarInstante(e.publicadoEm) : '—') },
          ]}
        />
      </Secao>
    </Pagina>
  );
}
