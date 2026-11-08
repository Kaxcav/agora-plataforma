import { useId, useRef, useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, Pencil, Power, PowerOff, UserPlus, Users } from 'lucide-react';
import type { CodigoPerfil, EntradaUsuario, UsuarioAdmin } from '@agora/contratos';
import { formatarCpf, somenteDigitos, validarCpf } from '@agora/dominio';
import { useAtualizarUsuario, useCriarUsuario, useGerarSenhaTemporaria, useUsuarios, type AlteracaoUsuario } from '../../api/admin';
import { useUnidadesInternas } from '../../api/ajustes';
import {
  Alerta,
  BarraFiltros,
  Botao,
  CaixaSelecao,
  CampoBusca,
  CampoTexto,
  ConfirmarAcao,
  DadoPessoal,
  Dialogo,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  Pagina,
  Paginacao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { NOMES_PERFIS, TODOS_PERFIS } from '../../sessao/permissoes';
import { formatarInstante } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { ErroFormulario, focarPrimeiroInvalido, ResumoErros } from '../ajustes/ErroFormulario';

const FILTROS = ['busca'] as const;
const PERFIS_TODAS_UASGS: readonly CodigoPerfil[] = ['administrador', 'auditor'];
const PADRAO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function textoUasgs(u: UsuarioAdmin): string {
  if (u.uasgs.length > 0) return u.uasgs.join(', ');
  return u.perfis.some((p) => PERFIS_TODAS_UASGS.includes(p)) ? 'Todas' : 'Nenhuma';
}

function lerUasgs(texto: string): string[] {
  return texto
    .split(/[\s,;]+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

function mesmaLista(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const ordenadaA = [...a].sort();
  const ordenadaB = [...b].sort();
  return ordenadaA.every((v, i) => v === ordenadaB[i]);
}

const COLUNAS: ColunaTabela<UsuarioAdmin>[] = [
  { id: 'nome', cabecalho: 'Nome', identificadora: true, fixa: true, celula: (u) => u.nome },
  {
    id: 'email',
    cabecalho: 'E-mail',
    prioritaria: true,
    celula: (u) => <DadoPessoal valor={u.email} recurso="usuario" id={u.id} campo="email" descricao="e-mail do usuário" />,
  },
  { id: 'cpf', cabecalho: 'CPF', celula: (u) => <span className="mono">{u.cpf}</span> },
  {
    id: 'perfis',
    cabecalho: 'Perfis',
    prioritaria: true,
    celula: (u) => (
      <ul className="lista-chips" aria-label={`Perfis de ${u.nome}`}>
        {u.perfis.map((p) => (
          <li key={p}>{NOMES_PERFIS[p]}</li>
        ))}
      </ul>
    ),
  },
  { id: 'uasgs', cabecalho: 'UASGs', celula: (u) => <span className="numero">{textoUasgs(u)}</span> },
  { id: 'unidade', cabecalho: 'Unidade interna', celula: (u) => u.unidadeInterna?.sigla ?? <span className="texto-secundario">—</span> },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    celula: (u) =>
      u.ativo ? (
        <Etiqueta tom="sucesso" compacta>
          Ativo
        </Etiqueta>
      ) : (
        <Etiqueta tom="neutro" compacta>
          Inativo
        </Etiqueta>
      ),
  },
  {
    id: 'ultimoAcesso',
    cabecalho: 'Último acesso',
    celula: (u) =>
      u.ultimoAcessoEm ? (
        <time dateTime={u.ultimoAcessoEm} className="numero">
          {formatarInstante(u.ultimoAcessoEm)}
        </time>
      ) : (
        <span className="texto-secundario">Nunca acessou</span>
      ),
  },
];

interface ErrosUsuario {
  nome?: string;
  email?: string;
  cpf?: string;
  perfis?: string;
  uasgs?: string;
}

function FormularioUsuario({ aberto, usuario, aoFechar }: { aberto: boolean; usuario: UsuarioAdmin | null; aoFechar: () => void }) {
  const criar = useCriarUsuario();
  const atualizar = useAtualizarUsuario();
  const unidades = useUnidadesInternas(aberto);
  const { avisar } = useAvisos();
  const idFormulario = useId();
  const idPerfis = useId();
  const formulario = useRef<HTMLFormElement>(null);

  const [nome, definirNome] = useState(usuario?.nome ?? '');
  const [email, definirEmail] = useState('');
  const [cpf, definirCpf] = useState('');
  const [perfis, definirPerfis] = useState<CodigoPerfil[]>(usuario?.perfis ?? []);
  const [uasgsTexto, definirUasgsTexto] = useState(usuario?.uasgs.join(', ') ?? '');
  const [unidadeId, definirUnidadeId] = useState(usuario?.unidadeInterna?.id ?? '');
  const [erros, definirErros] = useState<ErrosUsuario>({});
  const [semAlteracoes, definirSemAlteracoes] = useState(false);

  const pendente = criar.isPending || atualizar.isPending;
  const erroApi = usuario ? atualizar.error : criar.error;

  const alternarPerfil = (perfil: CodigoPerfil, marcado: boolean) =>
    definirPerfis((atuais) => (marcado ? [...atuais.filter((p) => p !== perfil), perfil] : atuais.filter((p) => p !== perfil)));

  const validar = (): ErrosUsuario => {
    const e: ErrosUsuario = {};
    if (nome.trim().length < 3) e.nome = 'Informe o nome completo.';
    const emailLimpo = email.trim();
    if (!usuario && !emailLimpo) e.email = 'Informe o e-mail institucional.';
    else if (emailLimpo && !PADRAO_EMAIL.test(emailLimpo)) e.email = 'Informe um e-mail válido, como nome@orgao.gov.br.';
    if (!usuario) {
      if (!cpf.trim()) e.cpf = 'Informe o CPF.';
      else if (!validarCpf(cpf)) e.cpf = 'CPF inválido: confira os dígitos verificadores.';
    }
    if (perfis.length === 0) e.perfis = 'Selecione ao menos um perfil.';
    const invalidas = lerUasgs(uasgsTexto).filter((c) => !/^\d{6}$/.test(c));
    if (invalidas.length > 0) e.uasgs = `Códigos de UASG têm 6 dígitos. Corrija: ${invalidas.join(', ')}.`;
    return e;
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirSemAlteracoes(false);
    const encontrados = validar();
    definirErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      focarPrimeiroInvalido(formulario.current);
      return;
    }
    const uasgs = lerUasgs(uasgsTexto);
    const unidadeInternaId = unidadeId === '' ? null : unidadeId;

    if (!usuario) {
      const entrada: EntradaUsuario = {
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        cpf: somenteDigitos(cpf),
        perfis,
        uasgs,
        unidadeInternaId,
      };
      criar.mutate(entrada, {
        onSuccess: (criado) => {
          aoFechar();
          avisar({ tipo: 'sucesso', mensagem: `Usuário ${criado.nome} cadastrado.` });
        },
      });
      return;
    }

    const alteracao: AlteracaoUsuario = {};
    if (nome.trim() !== usuario.nome) alteracao.nome = nome.trim();
    if (email.trim()) alteracao.email = email.trim().toLowerCase();
    if (!mesmaLista(perfis, usuario.perfis)) alteracao.perfis = perfis;
    if (!mesmaLista(uasgs, usuario.uasgs)) alteracao.uasgs = uasgs;
    if (unidadeInternaId !== (usuario.unidadeInterna?.id ?? null)) alteracao.unidadeInternaId = unidadeInternaId;
    if (Object.keys(alteracao).length === 0) {
      definirSemAlteracoes(true);
      return;
    }
    atualizar.mutate(
      { id: usuario.id, alteracao },
      {
        onSuccess: (salvo) => {
          aoFechar();
          avisar({ tipo: 'sucesso', mensagem: `Dados de ${salvo.nome} atualizados.` });
        },
      },
    );
  };

  const quantidadeErros = Object.values(erros).filter(Boolean).length;

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={pendente ? () => undefined : aoFechar}
      titulo={usuario ? `Editar usuário ${usuario.nome}` : 'Novo usuário'}
      largura="media"
      descricao={
        <p>Perfis e UASGs definem o que a pessoa vê e faz; a autorização é sempre verificada no servidor. Toda alteração é auditada.</p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={pendente}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={pendente}>
            {usuario ? 'Salvar alterações' : 'Cadastrar usuário'}
          </Botao>
        </>
      }
    >
      <form id={idFormulario} ref={formulario} onSubmit={enviar} noValidate className="formulario">
        <ResumoErros quantidade={quantidadeErros} />
        <CampoTexto rotulo="Nome completo" obrigatorio maxLength={160} autoComplete="off" value={nome} onChange={(e) => definirNome(e.target.value)} erro={erros.nome} />
        <CampoTexto
          rotulo="E-mail institucional"
          obrigatorio={!usuario}
          type="email"
          autoComplete="off"
          maxLength={200}
          value={email}
          onChange={(e) => definirEmail(e.target.value)}
          erro={erros.email}
          ajuda={usuario ? `Deixe em branco para manter o e-mail atual (${usuario.email}).` : undefined}
        />
        {usuario ? (
          <p className="campo__ajuda">
            CPF: <span className="mono">{usuario.cpf}</span> (não pode ser alterado).
          </p>
        ) : (
          <CampoTexto
            rotulo="CPF"
            obrigatorio
            inputMode="numeric"
            autoComplete="off"
            maxLength={14}
            value={cpf}
            onChange={(e) => definirCpf(e.target.value)}
            onBlur={() => {
              if (validarCpf(cpf)) definirCpf(formatarCpf(cpf));
            }}
            erro={erros.cpf}
            ajuda="Somente números ou no formato 000.000.000-00. O CPF fica mascarado nas listagens (LGPD)."
          />
        )}
        <fieldset className={['grupo-campos', erros.perfis ? 'campo--erro' : ''].filter(Boolean).join(' ')} aria-describedby={erros.perfis ? `${idPerfis}-erro` : undefined}>
          <legend>
            Perfis <span className="campo__obrigatorio">(obrigatório)</span>
          </legend>
          <div className="grade-perfis">
            {TODOS_PERFIS.map((p) => (
              <CaixaSelecao key={p} rotulo={NOMES_PERFIS[p]} checked={perfis.includes(p)} onChange={(e) => alternarPerfil(p, e.target.checked)} aria-invalid={erros.perfis ? true : undefined} />
            ))}
          </div>
          {erros.perfis ? (
            <p id={`${idPerfis}-erro`} className="campo__erro">
              {erros.perfis}
            </p>
          ) : null}
        </fieldset>
        <CampoTexto
          rotulo="UASGs do escopo"
          autoComplete="off"
          value={uasgsTexto}
          onChange={(e) => definirUasgsTexto(e.target.value)}
          erro={erros.uasgs}
          ajuda="Códigos de 6 dígitos separados por vírgula. Deixe em branco para perfis com acesso a todas as UASGs (administrador e auditor)."
        />
        <Selecao
          rotulo="Unidade interna"
          opcaoVazia="Nenhuma"
          opcoes={(unidades.data ?? []).filter((u) => u.ativa || u.id === unidadeId).map((u) => ({ valor: u.id, rotulo: `${u.sigla} — ${u.nome}` }))}
          value={unidadeId}
          onChange={(e) => definirUnidadeId(e.target.value)}
          disabled={unidades.isPending}
          ajuda={unidades.isPending ? 'Carregando unidades internas…' : unidades.isError ? 'Não foi possível carregar as unidades internas.' : undefined}
        />
        {usuario ? null : (
          <Alerta tipo="info" compacto>
            <p>
              Depois de criar a conta, use “Gerar senha temporária” na lista para entregar a credencial inicial: ela é exibida uma única vez,
              expira em 72 horas e obriga a troca de senha no primeiro acesso.
            </p>
          </Alerta>
        )}
        {semAlteracoes ? (
          <Alerta tipo="info" anunciar compacto>
            <p>Nenhuma alteração para salvar.</p>
          </Alerta>
        ) : null}
        <ErroFormulario erro={erroApi} />
      </form>
    </Dialogo>
  );
}

interface SenhaGerada {
  nome: string;
  senha: string;
  expiraEm: string;
}

/** Copia a senha sem repeti-la em avisos ou leitores de tela. */
function CopiarSenha({ senha }: { senha: string }) {
  const [situacao, definirSituacao] = useState<'pendente' | 'copiada' | 'falhou'>('pendente');
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(senha);
      definirSituacao('copiada');
    } catch {
      definirSituacao('falhou');
    }
  };
  return (
    <>
      <Botao icone={situacao === 'copiada' ? Check : Copy} onClick={() => void copiar()}>
        {situacao === 'copiada' ? 'Copiada' : 'Copiar senha'}
      </Botao>
      <p className="texto-pequeno" role="status">
        {situacao === 'copiada'
          ? 'Senha copiada para a área de transferência.'
          : situacao === 'falhou'
            ? 'Não foi possível copiar automaticamente: selecione a senha e copie manualmente.'
            : ''}
      </p>
    </>
  );
}

/** Exibe a senha temporária uma única vez; ao fechar, ela é descartada da memória da página. */
function DialogoSenhaGerada({ gerada, aoFechar }: { gerada: SenhaGerada | null; aoFechar: () => void }) {
  return (
    <Dialogo
      aberto={gerada !== null}
      aoFechar={aoFechar}
      titulo="Senha temporária gerada"
      descricao={gerada ? <p>Credencial inicial de {gerada.nome}.</p> : null}
      rodape={
        <Botao variante="primario" onClick={aoFechar} data-foco-inicial>
          Concluído
        </Botao>
      }
    >
      {gerada ? (
        <div className="pilha">
          <Alerta tipo="aviso" compacto titulo="Exibida uma única vez">
            <p>Entregue a senha à pessoa por canal seguro. Ela não poderá ser consultada depois; se for perdida, gere outra.</p>
          </Alerta>
          <div className="senha-temporaria">
            <span className="sr-only">Senha temporária: </span>
            <code className="selecionavel">{gerada.senha}</code>
            <CopiarSenha senha={gerada.senha} />
          </div>
          <p>
            Válida até <strong className="numero">{formatarInstante(gerada.expiraEm)}</strong>. No primeiro acesso, a troca de senha é obrigatória.
          </p>
        </div>
      ) : null}
    </Dialogo>
  );
}

export default function Usuarios() {
  const p = useParametrosUrl();
  const parametros = { busca: p.texto('busca'), pagina: p.pagina, tamanhoPagina: p.tamanhoPagina };
  const consulta = useUsuarios(parametros);
  const { temPermissao, usuario: usuarioSessao } = useSessao();
  const podeEditar = temPermissao('admin:usuarios');
  const alternar = useAtualizarUsuario();
  const { avisar } = useAvisos();
  const [alvo, definirAlvo] = useState<UsuarioAdmin | null>(null);
  const gerarSenha = useGerarSenhaTemporaria();
  const [alvoSenha, definirAlvoSenha] = useState<UsuarioAdmin | null>(null);
  const [senhaGerada, definirSenhaGerada] = useState<SenhaGerada | null>(null);
  const [formulario, definirFormulario] = useState<{ chave: number; usuario: UsuarioAdmin | null; aberto: boolean }>({
    chave: 0,
    usuario: null,
    aberto: false,
  });
  const filtrosAtivos = p.algumAtivo(FILTROS);

  const abrir = (usuario: UsuarioAdmin | null) => definirFormulario((f) => ({ chave: f.chave + 1, usuario, aberto: true }));
  const fechar = () => definirFormulario((f) => ({ ...f, aberto: false }));

  const confirmarAlternancia = () => {
    if (!alvo) return;
    const id = alvo.id;
    const nome = alvo.nome;
    const anterior = alvo.ativo;
    alternar.mutate(
      { id, alteracao: { ativo: !anterior } },
      {
        onSuccess: () => {
          definirAlvo(null);
          avisar({
            tipo: 'sucesso',
            mensagem: anterior ? `Acesso de ${nome} desativado.` : `Acesso de ${nome} reativado.`,
            acao: {
              rotulo: 'Desfazer',
              executar: async () => {
                await alternar.mutateAsync({ id, alteracao: { ativo: anterior } });
                avisar({ tipo: 'info', mensagem: 'Alteração desfeita.' });
              },
            },
          });
        },
      },
    );
  };

  const desativando = alvo?.ativo ?? false;

  return (
    <Pagina
      titulo="Usuários"
      subtitulo="Contas de acesso, perfis (RBAC) e escopo de UASGs de cada pessoa."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Administração' }]}
      tela="admin"
      acoes={
        podeEditar ? (
          <Botao variante="primario" icone={UserPlus} onClick={() => abrir(null)}>
            Novo usuário
          </Botao>
        ) : null
      }
    >
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <div className="pilha">
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['usuário', 'usuários']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={() => p.limpar(FILTROS)}
            rotulo="Filtros de usuários"
          >
            <CampoBusca rotulo="Buscar" placeholder="Nome, e-mail ou unidade" valor={parametros.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
          </BarraFiltros>
          <Tabela
            id="admin-usuarios"
            legenda="Usuários da Ágora"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(u) => u.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            destaque={(u) => (u.ativo ? undefined : 'aviso')}
            acoes={
              podeEditar
                ? {
                    celula: (u) => (
                      <>
                        <Botao variante="terciario" tamanho="compacto" icone={Pencil} onClick={() => abrir(u)} aria-label={`Editar usuário ${u.nome}`}>
                          Editar
                        </Botao>
                        {u.id === usuarioSessao?.id ? null : (
                          <Botao
                            variante="terciario"
                            tamanho="compacto"
                            icone={u.ativo ? PowerOff : Power}
                            onClick={() => {
                              alternar.reset();
                              definirAlvo(u);
                            }}
                            aria-label={u.ativo ? `Desativar usuário ${u.nome}` : `Reativar usuário ${u.nome}`}
                          >
                            {u.ativo ? 'Desativar' : 'Reativar'}
                          </Botao>
                        )}
                        {u.id === usuarioSessao?.id || !u.ativo ? null : (
                          <Botao
                            variante="terciario"
                            tamanho="compacto"
                            icone={KeyRound}
                            onClick={() => {
                              gerarSenha.reset();
                              definirAlvoSenha(u);
                            }}
                            aria-label={`Gerar senha temporária para ${u.nome}`}
                          >
                            Gerar senha temporária
                          </Botao>
                        )}
                      </>
                    ),
                  }
                : undefined
            }
            vazio={
              <EstadoVazio
                icone={Users}
                titulo={filtrosAtivos ? 'Nenhum usuário atende à busca' : 'Nenhum usuário cadastrado'}
                descricao={filtrosAtivos ? 'Revise o termo buscado ou limpe os filtros.' : 'Cadastre as pessoas que vão operar a Ágora.'}
                acao={
                  filtrosAtivos ? (
                    <Botao variante="secundario" onClick={() => p.limpar(FILTROS)}>
                      Limpar filtros
                    </Botao>
                  ) : null
                }
              />
            }
            rodape={
              consulta.data && consulta.data.total > 0 ? (
                <Paginacao
                  pagina={parametros.pagina}
                  tamanhoPagina={parametros.tamanhoPagina}
                  total={consulta.data.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação de usuários"
                />
              ) : null
            }
          />
        </div>
      )}
      {podeEditar ? (
        <>
          <FormularioUsuario key={formulario.chave} aberto={formulario.aberto} usuario={formulario.usuario} aoFechar={fechar} />
          <ConfirmarAcao
            aberto={alvo !== null}
            aoFechar={() => definirAlvo(null)}
            titulo={desativando ? 'Desativar usuário' : 'Reativar usuário'}
            variante={desativando ? 'perigo' : 'primario'}
            descricao={
              <>
                <p>
                  {desativando ? 'Desativar o acesso de' : 'Reativar o acesso de'} <strong>{alvo?.nome}</strong>?
                  {desativando ? ' A pessoa deixa de conseguir entrar na Ágora; o histórico e a trilha de auditoria são preservados.' : ''}
                </p>
                <p>A alteração pode ser desfeita no aviso que aparecerá em seguida.</p>
              </>
            }
            rotuloConfirmar={desativando ? 'Desativar usuário' : 'Reativar usuário'}
            aoConfirmar={confirmarAlternancia}
            processando={alternar.isPending}
            erro={alternar.error}
          />
          <ConfirmarAcao
            aberto={alvoSenha !== null}
            aoFechar={() => definirAlvoSenha(null)}
            titulo="Gerar senha temporária"
            largura="media"
            descricao={
              <>
                <p>
                  Gera uma senha temporária para <strong>{alvoSenha?.nome}</strong>. Ao confirmar:
                </p>
                <ul>
                  <li>todas as sessões abertas dessa pessoa são encerradas;</li>
                  <li>a senha é exibida uma única vez, nesta tela, e expira em 72 horas;</li>
                  <li>no primeiro acesso, a troca de senha é obrigatória.</li>
                </ul>
              </>
            }
            rotuloConfirmar="Gerar senha temporária"
            aoConfirmar={() => {
              if (!alvoSenha) return;
              const nome = alvoSenha.nome;
              gerarSenha.mutate(alvoSenha.id, {
                onSuccess: (resposta) => {
                  definirAlvoSenha(null);
                  definirSenhaGerada({ nome, senha: resposta.senhaTemporaria, expiraEm: resposta.expiraEm });
                  gerarSenha.reset();
                },
              });
            }}
            processando={gerarSenha.isPending}
            erro={gerarSenha.error}
          />
          <DialogoSenhaGerada gerada={senhaGerada} aoFechar={() => definirSenhaGerada(null)} />
        </>
      ) : null}
    </Pagina>
  );
}
