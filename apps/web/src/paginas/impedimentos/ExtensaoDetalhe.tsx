/**
 * Procedimento de extensão de sanção (RN-27, art. 160): proposta, contraditório e ampla defesa, análise jurídica
 * prévia e decisão da autoridade competente. Cada passo aparece só para quem tem a permissão; o servidor decide.
 */
import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Archive, Gavel, Scale, ShieldCheck } from 'lucide-react';
import type { ExtensaoSancao, SituacaoExtensaoSancao } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { usePassoExtensao, useExtensao } from '../../api/impedimentos';
import {
  Alerta,
  AreaTexto,
  Botao,
  ConfirmarAcao,
  ConteudoConsulta,
  Dialogo,
  EsqueletoDetalhe,
  GrupoOpcoes,
  LinkBotao,
  ListaDefinicoes,
  Pagina,
  Secao,
  useAvisos,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { TIPOS_SANCAO } from '../compartilhado/rotulos';
import { ALVOS_EXTENSAO, EtiquetaSituacaoExtensao } from './comum';

const PASSOS: readonly { situacao: SituacaoExtensaoSancao; nome: string; descricao: string }[] = [
  { situacao: 'contraditorio', nome: '1. Contraditório', descricao: 'Intimação e prazo de defesa de 15 dias úteis.' },
  { situacao: 'analise_juridica', nome: '2. Análise jurídica prévia', descricao: 'Parecer de quem não propôs a extensão.' },
  { situacao: 'decisao', nome: '3. Decisão', descricao: 'Autoridade competente, que não propôs nem deu parecer.' },
];
const ORDEM: readonly SituacaoExtensaoSancao[] = ['contraditorio', 'analise_juridica', 'decisao'];

function Rito({ situacao }: { situacao: SituacaoExtensaoSancao }) {
  const atual = ORDEM.indexOf(situacao);
  return (
    <ol className="rito-extensao" aria-label="Passos do procedimento">
      {PASSOS.map((p, i) => {
        const feito = atual === -1 ? situacao !== 'arquivada' : i < atual;
        const corrente = i === atual;
        return (
          <li
            key={p.situacao}
            className={['rito-extensao__passo', feito ? 'rito-extensao__passo--feito' : '', corrente ? 'rito-extensao__passo--atual' : ''].filter(Boolean).join(' ')}
            aria-current={corrente ? 'step' : undefined}
          >
            <p className="rito-extensao__nome">{p.nome}</p>
            <p className="texto-pequeno">{p.descricao}</p>
            <p className="texto-pequeno texto-secundario">{feito ? 'Concluído' : corrente ? 'Em andamento' : 'A seguir'}</p>
          </li>
        );
      })}
    </ol>
  );
}

function FormularioDefesa({ extensao }: { extensao: ExtensaoSancao }) {
  const { avisar } = useAvisos();
  const passo = usePassoExtensao(extensao.id);
  const [apresentada, definirApresentada] = useState<'sim' | 'nao' | null>(null);
  const [resumo, definirResumo] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (apresentada === null) return definirErro('Informe se a defesa foi apresentada.');
    if (apresentada === 'sim' && resumo.trim().length < 20) return definirErro('Resuma a defesa com pelo menos 20 caracteres.');
    definirErro(null);
    passo.mutate(
      { passo: 'defesa', corpo: { apresentada: apresentada === 'sim', resumo: resumo.trim() || null } },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Defesa registrada', mensagem: 'O procedimento seguiu para a análise jurídica prévia.' }) },
    );
  };
  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      <GrupoOpcoes
        legenda="Defesa do interessado"
        nome="defesa-apresentada"
        obrigatorio
        opcoes={[
          { valor: 'sim', rotulo: 'Defesa apresentada' },
          { valor: 'nao', rotulo: 'Prazo encerrado sem defesa', ajuda: `Só depois de ${formatarData(extensao.prazoDefesa)}.` },
        ]}
        valor={apresentada}
        aoMudar={definirApresentada}
      />
      <AreaTexto rotulo="Resumo da defesa" rows={4} maxLength={5000} value={resumo} onChange={(e) => definirResumo(e.target.value)} ajuda="Argumentos e provas apresentados, com o número do documento SEI." />
      {erro ? (
        <Alerta tipo="erro" anunciar compacto>
          <p>{erro}</p>
        </Alerta>
      ) : null}
      {passo.isError ? (
        <Alerta tipo="erro" anunciar titulo="Não foi possível registrar">
          <p>{passo.error.message}</p>
        </Alerta>
      ) : null}
      <div className="linha">
        <Botao type="submit" variante="primario" icone={ShieldCheck} carregando={passo.isPending}>
          Registrar defesa
        </Botao>
      </div>
    </form>
  );
}

function FormularioParecer({ extensao }: { extensao: ExtensaoSancao }) {
  const { avisar } = useAvisos();
  const passo = usePassoExtensao(extensao.id);
  const [conclusao, definirConclusao] = useState<'favoravel' | 'desfavoravel' | null>(null);
  const [texto, definirTexto] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (conclusao === null) return definirErro('Informe a conclusão do parecer.');
    if (texto.trim().length < 30) return definirErro('Fundamente o parecer com pelo menos 30 caracteres.');
    definirErro(null);
    passo.mutate(
      { passo: 'parecer', corpo: { conclusao, texto: texto.trim() } },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Parecer registrado', mensagem: 'O procedimento aguarda a decisão da autoridade competente.' }) },
    );
  };
  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      <GrupoOpcoes
        legenda="Conclusão da análise jurídica"
        nome="parecer-conclusao"
        obrigatorio
        horizontal
        opcoes={[
          { valor: 'favoravel', rotulo: 'Favorável à extensão' },
          { valor: 'desfavoravel', rotulo: 'Desfavorável à extensão' },
        ]}
        valor={conclusao}
        aoMudar={definirConclusao}
      />
      <AreaTexto rotulo="Parecer" obrigatorio rows={5} maxLength={10_000} value={texto} onChange={(e) => definirTexto(e.target.value)} />
      {erro ? (
        <Alerta tipo="erro" anunciar compacto>
          <p>{erro}</p>
        </Alerta>
      ) : null}
      {passo.isError ? (
        <Alerta tipo="erro" anunciar titulo="Não foi possível registrar">
          <p>{passo.error.message}</p>
        </Alerta>
      ) : null}
      <div className="linha">
        <Botao type="submit" variante="primario" icone={Scale} carregando={passo.isPending}>
          Registrar parecer
        </Botao>
      </div>
    </form>
  );
}

function FormularioDecisao({ extensao }: { extensao: ExtensaoSancao }) {
  const { avisar } = useAvisos();
  const passo = usePassoExtensao(extensao.id);
  const [resultado, definirResultado] = useState<'estender' | 'nao_estender' | null>(null);
  const [motivacao, definirMotivacao] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const [confirmando, definirConfirmando] = useState(false);
  const revisar = (evento: FormEvent) => {
    evento.preventDefault();
    if (resultado === null) return definirErro('Informe a decisão.');
    if (motivacao.trim().length < 30) return definirErro('Motive a decisão com pelo menos 30 caracteres.');
    definirErro(null);
    passo.reset();
    definirConfirmando(true);
  };
  const confirmar = () => {
    if (resultado === null) return;
    passo.mutate(
      { passo: 'decisao', corpo: { resultado, motivacao: motivacao.trim() } },
      {
        onSuccess: (e) => {
          definirConfirmando(false);
          avisar({
            tipo: 'sucesso',
            titulo: 'Decisão registrada',
            mensagem: e.situacao === 'estendida' ? 'A sanção foi registrada para o alcançado no módulo de sanções.' : 'Os efeitos da sanção não foram estendidos.',
          });
        },
      },
    );
  };
  return (
    <>
      <form className="formulario" onSubmit={revisar} noValidate>
        {extensao.parecer?.conclusao === 'desfavoravel' ? (
          <Alerta tipo="aviso" compacto>
            <p>O parecer jurídico foi desfavorável: decidir de forma diferente exige motivação expressa.</p>
          </Alerta>
        ) : null}
        <GrupoOpcoes
          legenda="Decisão da autoridade competente"
          nome="decisao-resultado"
          obrigatorio
          horizontal
          opcoes={[
            { valor: 'estender', rotulo: 'Estender os efeitos da sanção' },
            { valor: 'nao_estender', rotulo: 'Não estender' },
          ]}
          valor={resultado}
          aoMudar={definirResultado}
        />
        <AreaTexto rotulo="Motivação" obrigatorio rows={5} maxLength={10_000} value={motivacao} onChange={(e) => definirMotivacao(e.target.value)} />
        {erro ? (
          <Alerta tipo="erro" anunciar compacto>
            <p>{erro}</p>
          </Alerta>
        ) : null}
        <div className="linha">
          <Botao type="submit" variante="primario" icone={Gavel}>
            Registrar decisão
          </Botao>
        </div>
      </form>
      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => definirConfirmando(false)}
        titulo="Confirmar a decisão"
        descricao={
          <p>
            {resultado === 'estender'
              ? 'Estender os efeitos da sanção registra a sanção para o alcançado, com a vigência restante da sanção de origem. A decisão fica na trilha de auditoria.'
              : 'Não estender encerra o procedimento sem registrar sanção. A decisão fica na trilha de auditoria.'}
          </p>
        }
        rotuloConfirmar="Confirmar decisão"
        variante={resultado === 'estender' ? 'perigo' : 'primario'}
        aoConfirmar={confirmar}
        processando={passo.isPending}
        erro={passo.error}
      />
    </>
  );
}

function Arquivar({ extensao }: { extensao: ExtensaoSancao }) {
  const { avisar } = useAvisos();
  const passo = usePassoExtensao(extensao.id);
  const [aberto, definirAberto] = useState(false);
  const [motivo, definirMotivo] = useState('');
  const fechar = () => {
    definirAberto(false);
    definirMotivo('');
    passo.reset();
  };
  return (
    <>
      <Botao variante="terciario" icone={Archive} onClick={() => definirAberto(true)}>
        Arquivar procedimento
      </Botao>
      <Dialogo
        aberto={aberto}
        aoFechar={fechar}
        titulo="Arquivar procedimento de extensão"
        rodape={
          <>
            <Botao variante="secundario" onClick={fechar}>
              Cancelar
            </Botao>
            <Botao
              variante="perigo"
              carregando={passo.isPending}
              disabled={motivo.trim().length < 20}
              onClick={() =>
                passo.mutate(
                  { passo: 'arquivar', corpo: { motivo: motivo.trim() } },
                  {
                    onSuccess: () => {
                      fechar();
                      avisar({ tipo: 'sucesso', titulo: 'Procedimento arquivado', mensagem: 'O motivo ficou registrado na trilha de auditoria.' });
                    },
                  },
                )
              }
            >
              Arquivar
            </Botao>
          </>
        }
      >
        <AreaTexto rotulo="Motivo do arquivamento" obrigatorio rows={3} maxLength={5000} value={motivo} onChange={(e) => definirMotivo(e.target.value)} ajuda="Pelo menos 20 caracteres." />
        {passo.isError ? (
          <Alerta tipo="erro" anunciar>
            <p>{passo.error.message}</p>
          </Alerta>
        ) : null}
      </Dialogo>
    </>
  );
}

function AcaoAtual({ extensao }: { extensao: ExtensaoSancao }) {
  const { temPermissao, usuario } = useSessao();
  const meuId = usuario?.id ?? '';
  const propus = extensao.propostoPor.id === meuId;
  switch (extensao.situacao) {
    case 'contraditorio':
      return temPermissao('sancoes:instruir') ? <FormularioDefesa extensao={extensao} /> : <p className="texto-secundario">Aguardando a defesa ou o fim do prazo.</p>;
    case 'analise_juridica':
      if (!temPermissao('impedimentos:parecer')) return <p className="texto-secundario">Aguardando a análise jurídica prévia.</p>;
      return propus ? <p className="texto-secundario">Você propôs esta extensão: o parecer cabe a outra pessoa da assessoria jurídica.</p> : <FormularioParecer extensao={extensao} />;
    case 'decisao':
      if (!temPermissao('impedimentos:decidir')) return <p className="texto-secundario">Aguardando a decisão da autoridade competente.</p>;
      if (propus || extensao.parecer?.parecerista.id === meuId) {
        return <p className="texto-secundario">Você propôs esta extensão ou emitiu o parecer: a decisão cabe a outra autoridade (segregação de funções).</p>;
      }
      return <FormularioDecisao extensao={extensao} />;
    default:
      return null;
  }
}

function Conteudo({ extensao }: { extensao: ExtensaoSancao }) {
  const { temPermissao } = useSessao();
  const aberta = ORDEM.includes(extensao.situacao);
  const alcancado = extensao.alvo.fornecedor
    ? `${extensao.alvo.fornecedor.nome} (${extensao.alvo.fornecedor.documento})`
    : extensao.alvo.pessoa
      ? `${extensao.alvo.pessoa.nome} (CPF ${extensao.alvo.pessoa.documento})`
      : '—';
  return (
    <>
      <Secao titulo="Andamento" id="andamento">
        <Rito situacao={extensao.situacao} />
        {extensao.situacao === 'estendida' ? (
          <Alerta tipo="aviso" titulo="Sanção estendida por decisão da autoridade competente">
            <p>
              A sanção foi registrada para {alcancado} no módulo de sanções, até {extensao.sancaoOrigem.fimVigencia ? formatarData(extensao.sancaoOrigem.fimVigencia) : 'o fim da sanção de origem'}.
            </p>
            <LinkBotao to="/sancoes?situacao=aplicada" variante="secundario" tamanho="compacto">
              Ver no módulo de sanções
            </LinkBotao>
          </Alerta>
        ) : null}
        {extensao.situacao === 'nao_estendida' ? <Alerta tipo="info">Os efeitos da sanção não foram estendidos.</Alerta> : null}
        {extensao.situacao === 'arquivada' ? <Alerta tipo="info">Procedimento arquivado: {extensao.arquivamento?.motivo}</Alerta> : null}
      </Secao>
      <Secao titulo="Dados do procedimento" id="dados">
        <ListaDefinicoes
          colunas={3}
          itens={[
            { termo: 'Sanção de origem', valor: `${TIPOS_SANCAO[extensao.sancaoOrigem.tipo]} — ${extensao.sancaoOrigem.fornecedor.nome}` },
            { termo: 'Alcançado', valor: `${ALVOS_EXTENSAO[extensao.alvo.tipo]}: ${alcancado}` },
            { termo: 'Fim da sanção de origem', valor: extensao.sancaoOrigem.fimVigencia ? formatarData(extensao.sancaoOrigem.fimVigencia) : 'Sem termo final' },
            { termo: 'Intimação', valor: formatarData(extensao.intimacaoEm) },
            { termo: 'Prazo de defesa', valor: formatarData(extensao.prazoDefesa) },
            { termo: 'Proposta', valor: `${extensao.propostoPor.nome}, ${formatarInstante(extensao.propostaEm)}` },
            { termo: 'Fundamentação', valor: extensao.fundamentacao, largo: true },
            ...(extensao.sinal ? [{ termo: 'Sinal de origem (requer revisão humana)', valor: extensao.sinal, largo: true }] : []),
          ]}
        />
      </Secao>
      {extensao.defesa || extensao.parecer || extensao.decisao ? (
        <Secao titulo="Registros" id="registros">
          <ListaDefinicoes
            colunas={2}
            itens={[
              ...(extensao.defesa
                ? [{ termo: 'Defesa', valor: extensao.defesa.apresentada ? (extensao.defesa.resumo ?? 'Apresentada') : 'Prazo encerrado sem defesa', largo: true }]
                : []),
              ...(extensao.parecer
                ? [
                    {
                      termo: `Análise jurídica (${extensao.parecer.conclusao === 'favoravel' ? 'favorável' : 'desfavorável'}) — ${extensao.parecer.parecerista.nome}`,
                      valor: extensao.parecer.texto,
                      largo: true,
                    },
                  ]
                : []),
              ...(extensao.decisao
                ? [
                    {
                      termo: `Decisão (${extensao.decisao.resultado === 'estender' ? 'estender' : 'não estender'}) — ${extensao.decisao.autoridade.nome}`,
                      valor: extensao.decisao.motivacao,
                      largo: true,
                    },
                  ]
                : []),
            ]}
          />
        </Secao>
      ) : null}
      {aberta ? (
        <Secao titulo="Próximo passo" id="proximo-passo" acoes={temPermissao('sancoes:instruir') ? <Arquivar extensao={extensao} /> : null}>
          <AcaoAtual extensao={extensao} />
        </Secao>
      ) : null}
    </>
  );
}

export default function ExtensaoDetalhe() {
  const { id = '' } = useParams();
  const consulta = useExtensao(id);
  return (
    <Pagina
      titulo="Extensão de sanção"
      subtitulo="Desconsideração da personalidade jurídica (Lei 14.133/2021, art. 160)."
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Vínculos e impedimentos', para: '/impedimentos' },
      ]}
      tela="impedimentos.extensao"
      marcadores={consulta.data ? <EtiquetaSituacaoExtensao situacao={consulta.data.situacao} /> : null}
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando o procedimento"
        naoEncontrado={{ titulo: 'Procedimento não encontrado', acao: <LinkBotao to="/impedimentos">Voltar para vínculos e impedimentos</LinkBotao> }}
      >
        {(dados) => <Conteudo extensao={dados} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
