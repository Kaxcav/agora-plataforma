import { useId, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Power, PowerOff, Workflow } from 'lucide-react';
import type { UnidadeInterna } from '@agora/contratos';
import { useAtualizarUnidadeInterna, useCriarUnidadeInterna, useUnidadesInternas } from '../../api/ajustes';
import {
  Alternador,
  Botao,
  CampoTexto,
  ConfirmarAcao,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  Pagina,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar, formatarNumero } from '../../utilitarios/formatacao';
import { AvisoSomenteLeitura, ErroFormulario, focarPrimeiroInvalido, ResumoErros } from './ErroFormulario';

const COLUNAS: ColunaTabela<UnidadeInterna>[] = [
  { id: 'sigla', cabecalho: 'Sigla', identificadora: true, fixa: true, ordenavel: true, valorOrdenacao: (u) => u.sigla, celula: (u) => u.sigla },
  { id: 'nome', cabecalho: 'Nome', prioritaria: true, ordenavel: true, valorOrdenacao: (u) => u.nome, celula: (u) => u.nome },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    ordenavel: true,
    valorOrdenacao: (u) => (u.ativa ? 0 : 1),
    celula: (u) =>
      u.ativa ? (
        <Etiqueta tom="sucesso" compacta>
          Ativa
        </Etiqueta>
      ) : (
        <Etiqueta tom="neutro" compacta>
          Inativa
        </Etiqueta>
      ),
  },
  {
    id: 'usuarios',
    cabecalho: 'Usuários',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (u) => u.usuarios,
    celula: (u) => <span className="numero">{formatarNumero(u.usuarios)}</span>,
  },
];

function FormularioUnidade({ aberto, unidade, aoFechar }: { aberto: boolean; unidade: UnidadeInterna | null; aoFechar: () => void }) {
  const criar = useCriarUnidadeInterna();
  const atualizar = useAtualizarUnidadeInterna();
  const { avisar } = useAvisos();
  const idFormulario = useId();
  const formulario = useRef<HTMLFormElement>(null);
  const [sigla, definirSigla] = useState(unidade?.sigla ?? '');
  const [nome, definirNome] = useState(unidade?.nome ?? '');
  const [ativa, definirAtiva] = useState(unidade?.ativa ?? true);
  const [erros, definirErros] = useState<{ sigla?: string; nome?: string }>({});

  const pendente = criar.isPending || atualizar.isPending;
  const erroApi = unidade ? atualizar.error : criar.error;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const encontrados: { sigla?: string; nome?: string } = {};
    if (!sigla.trim()) encontrados.sigla = 'Informe a sigla da unidade.';
    if (nome.trim().length < 3) encontrados.nome = 'Informe o nome da unidade (mínimo de 3 caracteres).';
    definirErros(encontrados);
    if (encontrados.sigla || encontrados.nome) {
      focarPrimeiroInvalido(formulario.current);
      return;
    }
    const dados = { sigla: sigla.trim().toUpperCase(), nome: nome.trim() };
    if (unidade) {
      atualizar.mutate(
        { id: unidade.id, entrada: { ...dados, ativa } },
        {
          onSuccess: (salva) => {
            aoFechar();
            avisar({ tipo: 'sucesso', mensagem: `Unidade ${salva.sigla} atualizada.` });
          },
        },
      );
    } else {
      criar.mutate(dados, {
        onSuccess: (salva) => {
          aoFechar();
          avisar({ tipo: 'sucesso', mensagem: `Unidade ${salva.sigla} cadastrada.` });
        },
      });
    }
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={pendente ? () => undefined : aoFechar}
      titulo={unidade ? `Editar unidade ${unidade.sigla}` : 'Nova unidade interna'}
      largura="estreita"
      descricao={<p>O cadastro e as alterações ficam registrados na trilha de auditoria.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={pendente}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={pendente}>
            {unidade ? 'Salvar alterações' : 'Cadastrar unidade'}
          </Botao>
        </>
      }
    >
      <form id={idFormulario} ref={formulario} onSubmit={enviar} noValidate className="formulario">
        <ResumoErros quantidade={Object.keys(erros).filter((k) => k === 'sigla' || k === 'nome').length} />
        <CampoTexto
          rotulo="Sigla"
          obrigatorio
          maxLength={20}
          autoComplete="off"
          value={sigla}
          onChange={(e) => definirSigla(e.target.value)}
          erro={erros.sigla}
          ajuda="Até 20 caracteres, ex.: CGLOG."
        />
        <CampoTexto
          rotulo="Nome"
          obrigatorio
          maxLength={160}
          value={nome}
          onChange={(e) => definirNome(e.target.value)}
          erro={erros.nome}
          ajuda="Ex.: Coordenação-Geral de Logística."
        />
        {unidade ? <Alternador rotulo="Unidade ativa" ligado={ativa} aoMudar={definirAtiva} /> : null}
        <ErroFormulario erro={erroApi} />
      </form>
    </Dialogo>
  );
}

export default function UnidadesInternas() {
  const consulta = useUnidadesInternas();
  const { temPermissao } = useSessao();
  const podeEditar = temPermissao('ajustes:editar');
  const alternar = useAtualizarUnidadeInterna();
  const { avisar } = useAvisos();
  const [alvo, definirAlvo] = useState<UnidadeInterna | null>(null);
  const [formulario, definirFormulario] = useState<{ chave: number; unidade: UnidadeInterna | null; aberto: boolean }>({
    chave: 0,
    unidade: null,
    aberto: false,
  });

  const abrir = (unidade: UnidadeInterna | null) => definirFormulario((f) => ({ chave: f.chave + 1, unidade, aberto: true }));
  const fechar = () => definirFormulario((f) => ({ ...f, aberto: false }));

  const confirmarAlternancia = () => {
    if (!alvo) return;
    const anterior = alvo.ativa;
    const id = alvo.id;
    const dados = { sigla: alvo.sigla, nome: alvo.nome };
    alternar.mutate(
      { id, entrada: { ...dados, ativa: !anterior } },
      {
        onSuccess: () => {
          definirAlvo(null);
          avisar({
            tipo: 'sucesso',
            mensagem: anterior ? `Unidade ${dados.sigla} desativada.` : `Unidade ${dados.sigla} reativada.`,
            acao: {
              rotulo: 'Desfazer',
              executar: async () => {
                await alternar.mutateAsync({ id, entrada: { ...dados, ativa: anterior } });
                avisar({ tipo: 'info', mensagem: 'Alteração desfeita.' });
              },
            },
          });
        },
      },
    );
  };

  const desativando = alvo?.ativa ?? false;

  return (
    <Pagina
      titulo="Unidades internas"
      subtitulo="Setores do órgão aos quais os usuários são vinculados (gestão, fiscalização, financeiro)."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Ajustes' }]}
      tela="ajustes"
      acoes={
        podeEditar ? (
          <Botao variante="primario" icone={Plus} onClick={() => abrir(null)}>
            Nova unidade
          </Botao>
        ) : null
      }
    >
      {podeEditar ? null : <AvisoSomenteLeitura />}
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela colunas={4} />} rotuloCarregando="Carregando unidades internas">
        {(unidades) => (
          <div className="pilha">
            <p className="texto-secundario" aria-live="polite">
              {contar(unidades.length, 'unidade cadastrada', 'unidades cadastradas')}
              {unidades.length > 0 ? `, ${contar(unidades.filter((u) => u.ativa).length, 'ativa', 'ativas')}` : ''}.
            </p>
            <Tabela
              id="unidades-internas"
              legenda="Unidades internas"
              colunas={COLUNAS}
              linhas={unidades}
              chave={(u) => u.id}
              ordenacaoInicial={{ por: 'sigla', ordem: 'asc' }}
              atualizando={consulta.isFetching}
              acoes={
                podeEditar
                  ? {
                      celula: (u) => (
                        <>
                          <Botao variante="terciario" tamanho="compacto" icone={Pencil} onClick={() => abrir(u)} aria-label={`Editar unidade ${u.sigla}`}>
                            Editar
                          </Botao>
                          <Botao
                            variante="terciario"
                            tamanho="compacto"
                            icone={u.ativa ? PowerOff : Power}
                            onClick={() => {
                              alternar.reset();
                              definirAlvo(u);
                            }}
                            aria-label={u.ativa ? `Desativar unidade ${u.sigla}` : `Reativar unidade ${u.sigla}`}
                          >
                            {u.ativa ? 'Desativar' : 'Reativar'}
                          </Botao>
                        </>
                      ),
                    }
                  : undefined
              }
              vazio={
                <EstadoVazio
                  icone={Workflow}
                  titulo="Nenhuma unidade interna cadastrada"
                  descricao="Cadastre os setores do órgão para organizar usuários e responsabilidades."
                  acao={
                    podeEditar ? (
                      <Botao variante="primario" icone={Plus} onClick={() => abrir(null)}>
                        Nova unidade
                      </Botao>
                    ) : null
                  }
                />
              }
            />
          </div>
        )}
      </ConteudoConsulta>
      {podeEditar ? (
        <>
          <FormularioUnidade key={formulario.chave} aberto={formulario.aberto} unidade={formulario.unidade} aoFechar={fechar} />
          <ConfirmarAcao
            aberto={alvo !== null}
            aoFechar={() => definirAlvo(null)}
            titulo={desativando ? 'Desativar unidade' : 'Reativar unidade'}
            variante={desativando ? 'perigo' : 'primario'}
            descricao={
              <>
                <p>
                  {desativando ? 'Desativar' : 'Reativar'} a unidade <strong>{alvo ? `${alvo.sigla} — ${alvo.nome}` : ''}</strong>?
                  {alvo && alvo.usuarios > 0 ? ` Há ${contar(alvo.usuarios, 'usuário vinculado', 'usuários vinculados')} a ela.` : ''}
                </p>
                <p>A alteração fica registrada na trilha de auditoria e pode ser desfeita no aviso que aparecerá em seguida.</p>
              </>
            }
            rotuloConfirmar={desativando ? 'Desativar unidade' : 'Reativar unidade'}
            aoConfirmar={confirmarAlternancia}
            processando={alternar.isPending}
            erro={alternar.error}
          />
        </>
      ) : null}
    </Pagina>
  );
}
