import { useId, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Eye, EyeOff, Gavel, LogIn, ScrollText, ShieldCheck, Workflow } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '../../api/cliente';
import { useConfiguracaoPublica } from '../../api/sessao';
import { Alerta, Botao, Campo, CampoTexto, Esqueleto, Pagina } from '../../componentes';
import { caminhoRetornoSeguro, useSessao } from '../../sessao/ContextoSessao';
import { NOMES_PERFIS } from '../../sessao/permissoes';

const SENHA_DEMONSTRACAO = 'Agora@Demo2026';

/** Cidadão (perfil sem acesso interno) sem destino pedido vai para as próprias manifestações, não para o painel. */
function destinoAposEntrar(perfis: readonly string[], retorno: string): string {
  return retorno === '/' && perfis.length === 1 && perfis[0] === 'cidadao' ? '/sociedade/minhas-manifestacoes' : retorno;
}
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ErrosCampos {
  email?: string;
  senha?: string;
}

function MensagemErroEnvio({ erro }: { erro: unknown }) {
  const limite = erro instanceof ErroApi && erro.status === 429;
  return (
    <Alerta tipo="erro" anunciar titulo={limite ? 'Muitas tentativas' : 'Não foi possível entrar'}>
      <p>{mensagemDeErro(erro)}</p>
      {limite ? <p>Por segurança, novas tentativas para este e-mail ficam bloqueadas por alguns minutos.</p> : null}
      {erro instanceof ErroApi && erro.idRequisicao && erro.status >= 500 ? (
        <p className="texto-pequeno">
          Código para o suporte: <code>{erro.idRequisicao}</code>
        </p>
      ) : null}
    </Alerta>
  );
}

export default function Entrar() {
  const configuracao = useConfiguracaoPublica();
  const { sessao, entrar, entrando } = useSessao();
  const [params] = useSearchParams();
  const navegar = useNavigate();
  const idSenha = useId();
  const referenciaEmail = useRef<HTMLInputElement>(null);
  const referenciaSenha = useRef<HTMLInputElement>(null);
  const [email, definirEmail] = useState('');
  const [senha, definirSenha] = useState('');
  const [mostrarSenha, definirMostrarSenha] = useState(false);
  const [erros, definirErros] = useState<ErrosCampos>({});
  const [erroEnvio, definirErroEnvio] = useState<unknown>(null);

  const retorno = caminhoRetornoSeguro(params.get('retorno'));
  const sessaoExpirada = params.get('motivo') === 'expirada';
  const erroGovbr = params.get('erro') === 'govbr';
  const config = configuracao.data;
  const contasDemo = config?.ambiente === 'demonstracao' ? (config.usuariosDemonstracao ?? []) : [];

  if (sessao) return <Navigate to={destinoAposEntrar(sessao.usuario.perfis, retorno)} replace />;

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    definirErroEnvio(null);
    const novos: ErrosCampos = {};
    if (!email.trim()) novos.email = 'Informe o e-mail institucional.';
    else if (!FORMATO_EMAIL.test(email.trim())) novos.email = 'Informe um e-mail válido, como nome@orgao.gov.br.';
    if (!senha) novos.senha = 'Informe a senha.';
    definirErros(novos);
    if (novos.email) {
      referenciaEmail.current?.focus();
      return;
    }
    if (novos.senha) {
      referenciaSenha.current?.focus();
      return;
    }
    try {
      const nova = await entrar({ email: email.trim(), senha });
      void navegar(destinoAposEntrar(nova.usuario.perfis, retorno), { replace: true });
    } catch (erro) {
      definirErroEnvio(erro);
      definirSenha('');
      referenciaSenha.current?.focus();
    }
  };

  const usarConta = (endereco: string) => {
    definirEmail(endereco);
    definirErros({});
    definirErroEnvio(null);
    referenciaSenha.current?.focus();
  };

  return (
    <Pagina titulo="Entrar na Ágora" tituloDocumento="Entrar">
      <div className="entrar">
        <div className="entrar__formulario cartao">
          {sessaoExpirada ? (
            <Alerta tipo="aviso" titulo="Sua sessão terminou">
              Por segurança, a sessão expira após um período sem uso. Entre novamente para continuar de onde parou.
            </Alerta>
          ) : null}
          {erroGovbr ? (
            <Alerta tipo="erro" titulo="Não foi possível entrar com gov.br">
              A conta gov.br não está vinculada a um usuário ativo da Ágora ou a autorização foi cancelada. Procure o administrador do seu órgão.
            </Alerta>
          ) : null}

          <form className="formulario" onSubmit={(e) => void enviar(e)} noValidate aria-describedby={erroEnvio ? 'erro-entrar' : undefined}>
            <CampoTexto
              ref={referenciaEmail}
              rotulo="E-mail institucional"
              type="email"
              autoComplete="username"
              inputMode="email"
              obrigatorio
              value={email}
              onChange={(e) => definirEmail(e.target.value)}
              erro={erros.email}
              spellCheck={false}
            />
            <Campo id={idSenha} rotulo="Senha" obrigatorio erro={erros.senha}>
              {(atributos) => (
                <div className="campo__grupo">
                  <input
                    {...atributos}
                    ref={referenciaSenha}
                    className="campo__controle campo__controle--senha"
                    type={mostrarSenha ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => definirSenha(e.target.value)}
                  />
                  <button
                    type="button"
                    className="campo__limpar"
                    aria-pressed={mostrarSenha}
                    aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    title={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                    onClick={() => definirMostrarSenha((v) => !v)}
                  >
                    {mostrarSenha ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
              )}
            </Campo>
            {erroEnvio ? (
              <div id="erro-entrar">
                <MensagemErroEnvio erro={erroEnvio} />
              </div>
            ) : null}
            <Botao type="submit" variante="primario" icone={LogIn} carregando={entrando} className="entrar__enviar">
              Entrar
            </Botao>
          </form>

          {config?.govbrHabilitado ? (
            <>
              <p className="entrar__ou">ou</p>
              <a className="botao botao--govbr" href="/api/v1/sessao/govbr/iniciar">
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Entrar com gov.br</span>
              </a>
            </>
          ) : null}

          {configuracao.isPending ? <Esqueleto largura="100%" altura="4rem" /> : null}

          {contasDemo.length > 0 ? (
            <section aria-labelledby="titulo-contas-demo" className="pilha pilha--compacta">
              <Alerta tipo="info" titulo="Ambiente de demonstração">
                <p>
                  Todos os dados são fictícios. Escolha um perfil para preencher o e-mail; a senha das contas de demonstração é{' '}
                  <code className="selecionavel">{SENHA_DEMONSTRACAO}</code>.
                </p>
              </Alerta>
              <h2 id="titulo-contas-demo" className="secao__titulo">
                Contas de demonstração
              </h2>
              <ul className="contas-demo">
                {contasDemo.map((conta) => (
                  <li key={conta.email}>
                    <button
                      type="button"
                      className="contas-demo__botao"
                      aria-pressed={email === conta.email}
                      onClick={() => usarConta(conta.email)}
                    >
                      <span className="contas-demo__perfil">{NOMES_PERFIS[conta.perfil]}</span>
                      <span className="contas-demo__email">{conta.email}</span>
                      <span className="contas-demo__descricao">{conta.descricao}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="entrar__apresentacao">
          <h2>Contratações públicas do planejamento à gestão, em um só lugar.</h2>
          <p>
            A Ágora acompanha atas, contratos, empenhos e pagamentos com os prazos e limites da Lei 14.133/2021 aplicados automaticamente — e
            deixa cada decisão com quem tem competência para tomá-la.
          </p>
          <ul className="entrar__destaques">
            <li>
              <ScrollText size={18} aria-hidden="true" />
              <span>Carteira de atas e contratos com semáforo de vigência, saldo e divulgação no PNCP.</span>
            </li>
            <li>
              <Workflow size={18} aria-hidden="true" />
              <span>Regras de negócio rastreáveis: cada alerta mostra o fundamento legal.</span>
            </li>
            <li>
              <Gavel size={18} aria-hidden="true" />
              <span>Sinais e simulações de apoio; sanções e habilitações são sempre decisão humana.</span>
            </li>
            <li>
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Implantada na infraestrutura do órgão, com trilha de auditoria e proteção de dados pessoais (LGPD).</span>
            </li>
          </ul>
        </div>
      </div>
    </Pagina>
  );
}
