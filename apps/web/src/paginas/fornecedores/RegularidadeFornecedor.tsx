import { useState, type FormEvent } from 'react';
import { FilePlus2, FileText, RefreshCw } from 'lucide-react';
import type { CertidaoRegistrada, FornecedorDetalhe, ResultadoCertidao, TipoCertidao } from '@agora/contratos';
import { CERTIDOES_REGULARIDADE, ErroDominio, formatarData, hojeISO, validarCertidao, validarDataISO } from '@agora/dominio';
import { ErroApi, mensagemDeErro } from '../../api/cliente';
import { useCertidoes, useConsultarRegularidade, useRegistrarCertidao, useRegularidadeFornecedor } from '../../api/regularidade';
import {
  Alerta,
  AreaTexto,
  Botao,
  CaixaSelecao,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  GrupoOpcoes,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ChecklistRegularidade } from '../regularidade/ChecklistRegularidade';

/** Aba "Regularidade e certidões" do fornecedor (RF-20): checklist, consulta ao CEIS/CNEP e registro das certidões. */

const SITUACOES_CERTIDAO: Record<CertidaoRegistrada['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  valida: { rotulo: 'Válida', tom: 'sucesso' },
  a_vencer: { rotulo: 'A vencer', tom: 'aviso' },
  vencida: { rotulo: 'Vencida', tom: 'erro' },
  positiva: { rotulo: 'Positiva', tom: 'erro' },
};

const RESULTADOS: readonly { valor: ResultadoCertidao; rotulo: string; ajuda: string }[] = [
  { valor: 'negativa', rotulo: 'Negativa', ajuda: 'Nada consta: comprova a regularidade.' },
  { valor: 'positiva_com_efeitos_de_negativa', rotulo: 'Positiva com efeitos de negativa', ajuda: 'Débitos com exigibilidade suspensa: comprova a regularidade.' },
  { valor: 'positiva', rotulo: 'Positiva', ajuda: 'Há débitos: não comprova a regularidade e bloqueia a assinatura e a prorrogação.' },
];

const SIGLA: Record<TipoCertidao, string> = Object.fromEntries(CERTIDOES_REGULARIDADE.map((c) => [c.tipo, c.sigla])) as Record<TipoCertidao, string>;

const COLUNAS_CERTIDOES: ColunaTabela<CertidaoRegistrada>[] = [
  { id: 'tipo', cabecalho: 'Certidão', identificadora: true, fixa: true, celula: (c) => SIGLA[c.tipo] },
  { id: 'numero', cabecalho: 'Número', prioritaria: true, celula: (c) => <span className="mono">{c.numero}</span> },
  { id: 'emissor', cabecalho: 'Emissor', celula: (c) => c.emissor },
  { id: 'emitidaEm', cabecalho: 'Emissão', celula: (c) => <span className="numero">{formatarData(c.emitidaEm)}</span> },
  { id: 'validaAte', cabecalho: 'Validade', prioritaria: true, celula: (c) => <span className="numero">{formatarData(c.validaAte)}</span> },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    celula: (c) => (
      <Etiqueta tom={SITUACOES_CERTIDAO[c.situacao].tom} compacta>
        {SITUACOES_CERTIDAO[c.situacao].rotulo}
      </Etiqueta>
    ),
  },
  {
    id: 'conferida',
    cabecalho: 'Conferida por',
    celula: (c) => (
      <span className="texto-pequeno">
        {c.conferidaPor?.nome ?? 'Carga de dados'} em {formatarInstante(c.conferidaEm)}
      </span>
    ),
  },
];

interface ErrosCertidao {
  tipo?: string;
  numero?: string;
  emissor?: string;
  emitidaEm?: string;
  validaAte?: string;
  resultado?: string;
  conferida?: string;
  geral?: string;
}

function DialogoCertidao({ fornecedor, aberto, aoFechar }: { fornecedor: FornecedorDetalhe; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarCertidao(fornecedor.id);
  const [tipo, definirTipo] = useState<TipoCertidao | ''>('');
  const [numero, definirNumero] = useState('');
  const [emissor, definirEmissor] = useState('');
  const [emitidaEm, definirEmitidaEm] = useState('');
  const [validaAte, definirValidaAte] = useState('');
  const [resultado, definirResultado] = useState<ResultadoCertidao | null>(null);
  const [observacao, definirObservacao] = useState('');
  const [conferida, definirConferida] = useState(false);
  const [erros, definirErros] = useState<ErrosCertidao>({});
  const definicao = CERTIDOES_REGULARIDADE.find((c) => c.tipo === tipo) ?? null;
  const idFormulario = 'formulario-registrar-certidao';

  const fechar = () => {
    definirTipo('');
    definirNumero('');
    definirEmissor('');
    definirEmitidaEm('');
    definirValidaAte('');
    definirResultado(null);
    definirObservacao('');
    definirConferida(false);
    definirErros({});
    registrar.reset();
    aoFechar();
  };

  const validar = (): boolean => {
    const novos: ErrosCertidao = {};
    if (tipo === '') novos.tipo = 'Selecione a certidão.';
    if (numero.trim().length < 3) novos.numero = 'Informe o número ou o código de controle.';
    if (emissor.trim().length < 3) novos.emissor = 'Informe o emissor.';
    if (!validarDataISO(emitidaEm)) novos.emitidaEm = 'Informe a data de emissão.';
    if (!validarDataISO(validaAte)) novos.validaAte = 'Informe a data de validade.';
    if (!resultado) novos.resultado = 'Selecione o resultado da certidão.';
    if (!conferida) novos.conferida = 'Confirme que conferiu a certidão no sítio do emissor.';
    if (Object.keys(novos).length === 0 && tipo !== '' && resultado) {
      try {
        validarCertidao({ tipo, numero, emitidaEm, validaAte, resultado }, hojeISO(new Date()));
      } catch (erro) {
        if (erro instanceof ErroDominio) novos.geral = erro.message;
      }
    }
    definirErros(novos);
    return Object.keys(novos).length === 0;
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!validar() || tipo === '' || !resultado) return;
    registrar.mutate(
      { tipo, numero: numero.trim(), emissor: emissor.trim(), emitidaEm, validaAte, resultado, observacao: observacao.trim() || null, conferida: true },
      {
        onSuccess: (certidao) => {
          avisar({ tipo: 'sucesso', titulo: 'Certidão registrada', mensagem: `${SIGLA[certidao.tipo]} válida até ${formatarData(certidao.validaAte)}.` });
          fechar();
        },
      },
    );
  };

  const erroApi = registrar.error;
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={registrar.isPending ? () => undefined : fechar}
      titulo="Registrar certidão"
      largura="ampla"
      descricao={
        <p>
          As certidões fiscal federal, do FGTS e trabalhista não têm API aberta: emita a certidão no sítio do emissor, confira a
          autenticidade e registre os dados. A Ágora controla a validade e avisa antes do vencimento (art. 91, § 4º).
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar certidão
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <Selecao
          rotulo="Certidão"
          obrigatorio
          opcaoVazia="Selecione…"
          opcoes={CERTIDOES_REGULARIDADE.map((c) => ({ valor: c.tipo, rotulo: `${c.sigla} — ${c.nome}` }))}
          value={tipo}
          erro={erros.tipo}
          onChange={(e) => {
            const escolhida = CERTIDOES_REGULARIDADE.find((c) => c.tipo === e.target.value);
            definirTipo(escolhida?.tipo ?? '');
            if (escolhida && (emissor === '' || CERTIDOES_REGULARIDADE.some((c) => c.emissor === emissor))) definirEmissor(escolhida.emissor);
          }}
        />
        <div className="formulario__linha">
          <CampoTexto rotulo="Número ou código de controle" obrigatorio value={numero} maxLength={80} onChange={(e) => definirNumero(e.target.value)} erro={erros.numero} />
          <CampoTexto rotulo="Emissor" obrigatorio value={emissor} maxLength={200} onChange={(e) => definirEmissor(e.target.value)} erro={erros.emissor} />
        </div>
        <div className="formulario__linha">
          <CampoTexto rotulo="Data de emissão" type="date" obrigatorio value={emitidaEm} onChange={(e) => definirEmitidaEm(e.target.value)} erro={erros.emitidaEm} />
          <CampoTexto
            rotulo="Válida até"
            type="date"
            obrigatorio
            value={validaAte}
            onChange={(e) => definirValidaAte(e.target.value)}
            erro={erros.validaAte}
            ajuda={definicao ? `A ${definicao.sigla} vale por até ${definicao.validadeMaximaDias} dias.` : 'Copie a data impressa na certidão.'}
          />
        </div>
        <GrupoOpcoes legenda="Resultado" nome="resultado-certidao" obrigatorio opcoes={RESULTADOS} valor={resultado} aoMudar={definirResultado} erro={erros.resultado} />
        <AreaTexto rotulo="Observação" rows={2} maxLength={1000} value={observacao} onChange={(e) => definirObservacao(e.target.value)} />
        <CaixaSelecao
          rotulo="Conferi a autenticidade da certidão no sítio do emissor"
          checked={conferida}
          onChange={(e) => definirConferida(e.target.checked)}
          ajuda="O registro fica na trilha de auditoria com o seu nome."
        />
        {erros.conferida ? (
          <p className="campo__erro" role="alert">
            {erros.conferida}
          </p>
        ) : null}
        {erros.geral ? (
          <Alerta tipo="erro" anunciar titulo="Confira os dados da certidão">
            <p>{erros.geral}</p>
          </Alerta>
        ) : null}
        {erroApi ? (
          <Alerta tipo="erro" anunciar titulo="A certidão não foi registrada">
            <p>{mensagemDeErro(erroApi)}</p>
            {erroApi instanceof ErroApi && erroApi.detalhes.length > 0 ? (
              <ul>
                {erroApi.detalhes.map((d, i) => (
                  <li key={i}>{d.mensagem}</li>
                ))}
              </ul>
            ) : null}
          </Alerta>
        ) : null}
      </form>
    </Dialogo>
  );
}

export function RegularidadeFornecedor({ fornecedor }: { fornecedor: FornecedorDetalhe }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const checklist = useRegularidadeFornecedor(fornecedor.id, 'assinatura');
  const certidoes = useCertidoes(fornecedor.id);
  const consultar = useConsultarRegularidade(fornecedor.id);
  const [registrando, definirRegistrando] = useState(false);
  const podeConsultar = temPermissao('regularidade:consultar');
  const podeRegistrar = temPermissao('certidoes:registrar');

  return (
    <div className="pilha pilha--ampla">
      <p className="texto-secundario">
        Verificação exigida antes de assinar ou prorrogar contratos (RN-09) e repetida antes do atesto e do pagamento (RN-23). O CEIS e o
        CNEP são consultados pelo servidor da Ágora na API de dados do Portal da Transparência; as certidões são conferidas e registradas
        pelo agente.
      </p>
      {podeConsultar || podeRegistrar ? (
        <div className="regularidade__acoes">
          {podeConsultar ? (
            <Botao
              variante="secundario"
              icone={RefreshCw}
              carregando={consultar.isPending}
              onClick={() =>
                consultar.mutate(undefined, {
                  onSuccess: (v) =>
                    avisar({
                      tipo: v.regular ? 'sucesso' : 'aviso',
                      titulo: 'Consulta ao CEIS e ao CNEP registrada',
                      mensagem: v.regular ? 'Nenhuma restrição encontrada.' : `${v.motivos.length} restrição(ões) apontada(s).`,
                    }),
                })
              }
            >
              Consultar CEIS e CNEP agora
            </Botao>
          ) : null}
          {podeRegistrar ? (
            <Botao variante="secundario" icone={FilePlus2} onClick={() => definirRegistrando(true)}>
              Registrar certidão
            </Botao>
          ) : null}
        </div>
      ) : null}
      {consultar.error ? (
        <Alerta tipo="erro" anunciar titulo="Não foi possível consultar">
          <p>{mensagemDeErro(consultar.error)}</p>
        </Alerta>
      ) : null}
      {consultar.data ? (
        <ChecklistRegularidade checklist={consultar.data} titulo="Resultado da consulta registrada" idTitulo="regularidade-consulta-titulo" />
      ) : (
        <ConteudoConsulta consulta={checklist} carregando={<EsqueletoTabela linhas={5} />} rotuloCarregando="Carregando a regularidade">
          {(dados) => <ChecklistRegularidade checklist={dados} titulo="Checklist de regularidade" idTitulo="regularidade-checklist-titulo" />}
        </ConteudoConsulta>
      )}
      <ConteudoConsulta consulta={certidoes} carregando={<EsqueletoTabela linhas={3} />} rotuloCarregando="Carregando as certidões">
        {(lista) => (
          <Tabela
            id="fornecedor-certidoes"
            legenda={`Certidões registradas de ${fornecedor.razaoSocial}`}
            colunas={COLUNAS_CERTIDOES}
            linhas={lista}
            chave={(c) => c.id}
            semFerramentas
            destaque={(c) => (c.situacao === 'vencida' || c.situacao === 'positiva' ? 'erro' : c.situacao === 'a_vencer' ? 'aviso' : undefined)}
            vazio={<EstadoVazio icone={FileText} titulo="Nenhuma certidão registrada" descricao="Registre a CND federal, o CRF do FGTS e a CNDT conferidos." />}
          />
        )}
      </ConteudoConsulta>
      {podeRegistrar ? <DialogoCertidao fornecedor={fornecedor} aberto={registrando} aoFechar={() => definirRegistrando(false)} /> : null}
    </div>
  );
}
