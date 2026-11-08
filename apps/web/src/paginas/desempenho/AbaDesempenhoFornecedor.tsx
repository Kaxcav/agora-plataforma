/**
 * Aba "Desempenho registrado" do fornecedor (RN-37, RF-30): nota do registro cadastral de desempenho (avaliações
 * definitivas), histórico das avaliações e incentivo ao bom desempenho (art. 88, § 4º) — certificado de desempenho e
 * declaração para uso em licitações, emitidos por critério objetivo conferido no servidor.
 */
import { Award, ClipboardList, FileBadge, FileText } from 'lucide-react';
import { Link } from 'react-router';
import type { AvaliacaoDesempenhoResumo, CertificadoDesempenho, ElegibilidadeIncentivo, RegistroDesempenhoFornecedor, TipoDocumentoIncentivo } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { urlDocumentoAvaliacao, urlDocumentoCertificado, useEmitirCertificado, useRegistroDesempenho } from '../../api/desempenho';
import { Alerta, Botao, ConteudoConsulta, EstadoVazio, Etiqueta, LinkExterno, ListaDefinicoes, Secao, Tabela, type TomEtiqueta, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { FAIXAS_IDC } from '../compartilhado/rotulos';
import { formatarNotaIdc } from '../fornecedores/idc';
import { ErroOperacao } from '../jornada/comum';

const SITUACOES: Record<AvaliacaoDesempenhoResumo['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  em_manifestacao: { rotulo: 'Em prazo de manifestação', tom: 'aviso' },
  manifestada: { rotulo: 'Manifestação a analisar', tom: 'alerta' },
  definitiva: { rotulo: 'Definitiva', tom: 'sucesso' },
};
const SITUACOES_CERTIFICADO: Record<CertificadoDesempenho['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  valido: { rotulo: 'Válido', tom: 'sucesso' },
  registro_atualizado: { rotulo: 'Registro atualizado: renove', tom: 'aviso' },
  vencido: { rotulo: 'Vencido', tom: 'neutro' },
};
const NOMES: Record<TipoDocumentoIncentivo, string> = { certificado: 'Certificado de desempenho', declaracao: 'Declaração de desempenho registrado' };

function Incentivo({ fornecedorId, tipo, elegibilidade }: { fornecedorId: string; tipo: TipoDocumentoIncentivo; elegibilidade: ElegibilidadeIncentivo }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const emitir = useEmitirCertificado(fornecedorId);
  return (
    <div className="pilha pilha--compacta jornada-referencia">
      <p className="linha">
        <strong>{NOMES[tipo]}</strong>
        <Etiqueta tom={elegibilidade.elegivel ? 'sucesso' : 'neutro'} compacta>
          {elegibilidade.elegivel ? 'Critério atendido' : 'Critério não atendido'}
        </Etiqueta>
      </p>
      <p className="texto-pequeno">Critério: {elegibilidade.criterio}</p>
      {elegibilidade.motivos.length > 0 ? (
        <ul className="texto-pequeno">
          {elegibilidade.motivos.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {temPermissao('desempenho:certificar') && elegibilidade.elegivel ? (
        <div className="linha">
          <Botao
            tamanho="compacto"
            variante="primario"
            icone={tipo === 'certificado' ? Award : FileBadge}
            carregando={emitir.isPending}
            onClick={() =>
              emitir.mutate({ tipo }, { onSuccess: (c) => avisar({ tipo: 'sucesso', titulo: `${NOMES[tipo]} emitido`, mensagem: `Código de verificação ${c.codigo}.` }) })
            }
          >
            Emitir {tipo === 'certificado' ? 'certificado' : 'declaração'}
          </Botao>
        </div>
      ) : null}
      <ErroOperacao erro={emitir.error} titulo="O documento não foi emitido" />
    </div>
  );
}

function ConteudoRegistro({ registro }: { registro: RegistroDesempenhoFornecedor }) {
  const faixa = FAIXAS_IDC[registro.faixa];
  return (
    <div className="pilha">
      <Secao titulo="Nota do registro cadastral de desempenho" simples nivel={3}>
        <p className="linha">
          <span className="texto-forte numero">{registro.nota === null ? 'Sem avaliação definitiva' : `Nota do registro: ${formatarNotaIdc(registro.nota)} / 100`}</span>
          <Etiqueta tom={faixa.tom} compacta>
            {faixa.rotulo}
          </Etiqueta>
          <span className="texto-pequeno texto-secundario">
            {registro.contratosConsiderados} contrato(s) considerado(s) · versão do registro <span className="mono">{registro.versaoRegistro}</span>
          </span>
        </p>
        <p className="texto-pequeno">{registro.metodologia}</p>
        <p className="texto-pequeno texto-secundario">
          Fundamento: {registro.fundamento}. É esta nota que entra no desempate do art. 60, II, e, quando o edital adota, na pontuação técnica (art. 37, III).
        </p>
      </Secao>
      <Tabela<AvaliacaoDesempenhoResumo>
        id="fornecedor-avaliacoes-desempenho"
        legenda="Histórico de avaliações de desempenho"
        semFerramentas
        linhas={registro.avaliacoes}
        chave={(a) => a.id}
        colunas={[
          { id: 'protocolo', cabecalho: 'Protocolo', identificadora: true, fixa: true, celula: (a) => <span className="mono">{a.protocolo}</span> },
          { id: 'contrato', cabecalho: 'Contrato', prioritaria: true, celula: (a) => <Link to={`/contratos/${a.contrato.id}`}>{a.contrato.numero}</Link> },
          { id: 'periodo', cabecalho: 'Período', celula: (a) => `${formatarData(a.periodoInicio)} a ${formatarData(a.periodoFim)} (${a.tipo === 'final' ? 'final' : 'parcial'})` },
          { id: 'nota', cabecalho: 'Nota', alinhamento: 'fim', prioritaria: true, celula: (a) => <span className="numero">{formatarNotaIdc(a.nota)}</span> },
          {
            id: 'situacao',
            cabecalho: 'Situação',
            prioritaria: true,
            celula: (a) => (
              <span className="linha">
                <Etiqueta tom={SITUACOES[a.situacao].tom} compacta>
                  {SITUACOES[a.situacao].rotulo}
                </Etiqueta>
                {a.consideradaNoRegistro ? (
                  <Etiqueta tom="info" compacta>
                    Na nota do registro
                  </Etiqueta>
                ) : null}
              </span>
            ),
          },
        ]}
        acoes={{ cabecalho: 'Documento', celula: (a) => <LinkExterno href={urlDocumentoAvaliacao(a.id)}>PDF {a.protocolo}</LinkExterno> }}
        vazio={<EstadoVazio icone={ClipboardList} titulo="Nenhuma avaliação de desempenho" descricao="A ausência de avaliação não penaliza o fornecedor." />}
      />
      <Secao titulo="Incentivo ao bom desempenho (art. 88, § 4º)" simples nivel={3}>
        <div className="grade grade--2">
          <Incentivo fornecedorId={registro.fornecedor.id} tipo="certificado" elegibilidade={registro.incentivo.certificado} />
          <Incentivo fornecedorId={registro.fornecedor.id} tipo="declaracao" elegibilidade={registro.incentivo.declaracao} />
        </div>
        {registro.certificados.length > 0 ? (
          <ul className="pilha pilha--compacta">
            {registro.certificados.map((c) => (
              <li key={c.id} className="linha">
                <LinkExterno href={urlDocumentoCertificado(c.id)}>
                  <FileText size={16} aria-hidden="true" /> {NOMES[c.tipo]} {c.codigo} (PDF)
                </LinkExterno>
                <Etiqueta tom={SITUACOES_CERTIFICADO[c.situacao].tom} compacta>
                  {SITUACOES_CERTIFICADO[c.situacao].rotulo}
                </Etiqueta>
                <span className="texto-pequeno texto-secundario">
                  emitido em {formatarInstante(c.emitidoEm)}
                  {c.emitidoPor ? ` por ${c.emitidoPor.nome}` : ''} · válido até {formatarData(c.validoAte)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="texto-secundario">Nenhum certificado ou declaração emitido.</p>
        )}
        <Alerta tipo="info" compacto titulo="Cadastro de atesto do PNCP">
          <p>
            O registro fica na Ágora com protocolo. O envio ao cadastro de atesto de cumprimento de obrigações do PNCP depende da implantação e da
            regulamentação desse cadastro (art. 88, § 4º).
          </p>
        </Alerta>
      </Secao>
      <ListaDefinicoes itens={[{ termo: 'Fornecedor', valor: `${registro.fornecedor.razaoSocial} (${registro.fornecedor.documento})`, largo: true }]} />
    </div>
  );
}

export function AbaDesempenhoFornecedor({ fornecedorId }: { fornecedorId: string }) {
  const consulta = useRegistroDesempenho(fornecedorId);
  return (
    <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando o registro de desempenho">
      {(registro) => <ConteudoRegistro registro={registro} />}
    </ConteudoConsulta>
  );
}
