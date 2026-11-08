/**
 * `/trocar-senha` — troca da própria senha. Obrigatória quando a senha é temporária (`deveTrocarSenha`):
 * nesse caso as demais telas ficam bloqueadas e só "Sair" continua disponível.
 */
import { useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CircleCheck, CircleDashed, Eye, EyeOff, KeyRound, LogOut } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '../../api/cliente';
import { useTrocarSenha } from '../../api/sessao';
import { Alerta, Botao, Campo, LinkBotao, Pagina, useAvisos } from '../../componentes';
import { caminhoRetornoSeguro, useSessao } from '../../sessao/ContextoSessao';

const MINIMO = 12;

type CampoSenhaId = 'senhaAtual' | 'novaSenha' | 'confirmacao';
type Erros = Partial<Record<CampoSenhaId, string>>;

interface PropsCampoSenha {
  rotulo: string;
  valor: string;
  aoMudar: (valor: string) => void;
  autoComplete: 'current-password' | 'new-password';
  erro?: string;
  ajuda?: string;
  referencia: RefObject<HTMLInputElement | null>;
}

function CampoSenha({ rotulo, valor, aoMudar, autoComplete, erro, ajuda, referencia }: PropsCampoSenha) {
  const id = useId();
  const [visivel, definirVisivel] = useState(false);
  return (
    <Campo id={id} rotulo={rotulo} obrigatorio erro={erro} ajuda={ajuda}>
      {(atributos) => (
        <div className="campo__grupo">
          <input
            {...atributos}
            ref={referencia}
            className="campo__controle campo__controle--senha"
            type={visivel ? 'text' : 'password'}
            autoComplete={autoComplete}
            autoCapitalize="none"
            spellCheck={false}
            value={valor}
            onChange={(e) => aoMudar(e.target.value)}
          />
          <button
            type="button"
            className="campo__limpar"
            aria-pressed={visivel}
            aria-label={visivel ? `Ocultar ${rotulo.toLowerCase()}` : `Mostrar ${rotulo.toLowerCase()}`}
            title={visivel ? 'Ocultar' : 'Mostrar'}
            onClick={() => definirVisivel((v) => !v)}
          >
            {visivel ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
          </button>
        </div>
      )}
    </Campo>
  );
}

export default function TrocarSenha() {
  const { usuario, sair, saindo } = useSessao();
  const trocar = useTrocarSenha();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const { avisar } = useAvisos();
  const [senhaAtual, definirSenhaAtual] = useState('');
  const [novaSenha, definirNovaSenha] = useState('');
  const [confirmacao, definirConfirmacao] = useState('');
  const [erros, definirErros] = useState<Erros>({});
  const [erroEnvio, definirErroEnvio] = useState<unknown>(null);
  const referencias: Record<CampoSenhaId, RefObject<HTMLInputElement | null>> = {
    senhaAtual: useRef<HTMLInputElement>(null),
    novaSenha: useRef<HTMLInputElement>(null),
    confirmacao: useRef<HTMLInputElement>(null),
  };

  const obrigatoria = usuario?.deveTrocarSenha === true;
  const retorno = caminhoRetornoSeguro(params.get('retorno'));

  const requisitos = [
    { id: 'tamanho', rotulo: `Pelo menos ${MINIMO} caracteres`, ok: novaSenha.length >= MINIMO },
    { id: 'diferente', rotulo: 'Diferente da senha atual', ok: novaSenha !== '' && novaSenha !== senhaAtual },
    { id: 'confirmacao', rotulo: 'Confirmação igual à nova senha', ok: confirmacao !== '' && confirmacao === novaSenha },
  ];
  const pendentes = requisitos.filter((r) => !r.ok).length;

  const focar = (campo: CampoSenhaId) => referencias[campo].current?.focus();

  const enviar = async (evento: FormEvent) => {
    evento.preventDefault();
    definirErroEnvio(null);
    const novos: Erros = {};
    if (senhaAtual === '') novos.senhaAtual = 'Informe a senha atual.';
    if (novaSenha.length < MINIMO) novos.novaSenha = `A nova senha precisa ter pelo menos ${MINIMO} caracteres.`;
    else if (novaSenha === senhaAtual) novos.novaSenha = 'A nova senha deve ser diferente da senha atual.';
    if (confirmacao !== novaSenha) novos.confirmacao = 'A confirmação não confere com a nova senha.';
    definirErros(novos);
    const primeiro = (['senhaAtual', 'novaSenha', 'confirmacao'] as const).find((c) => novos[c]);
    if (primeiro) {
      focar(primeiro);
      return;
    }
    try {
      await trocar.mutateAsync({ senhaAtual, novaSenha });
      definirSenhaAtual('');
      definirNovaSenha('');
      definirConfirmacao('');
      avisar({ tipo: 'sucesso', titulo: 'Senha alterada', mensagem: 'Use a nova senha nos próximos acessos.' });
      void navegar(retorno, { replace: true });
    } catch (erro) {
      if (erro instanceof ErroApi && erro.status === 401) {
        definirErros({ senhaAtual: 'A senha atual não confere.' });
        definirSenhaAtual('');
        focar('senhaAtual');
        return;
      }
      const detalheNova = erro instanceof ErroApi ? erro.detalhes.find((d) => d.campo === 'novaSenha') : undefined;
      if (detalheNova) {
        definirErros({ novaSenha: detalheNova.mensagem });
        focar('novaSenha');
        return;
      }
      definirErroEnvio(erro);
    }
  };

  const encerrar = async () => {
    let mensagem = 'Você saiu da Ágora. Sua sessão foi encerrada.';
    try {
      await sair();
    } catch (erro) {
      mensagem = `A sessão foi encerrada neste navegador. ${mensagemDeErro(erro)}`;
    }
    void navegar('/entrar', { replace: true });
    avisar({ tipo: 'info', mensagem });
  };

  return (
    <Pagina titulo="Trocar senha" trilha={obrigatoria ? undefined : [{ rotulo: 'Início', para: '/' }]} estreita>
      <div className="trocar-senha pilha pilha--ampla">
        {obrigatoria ? (
          <Alerta tipo="aviso" titulo="Troca de senha obrigatória">
            <p>
              Você entrou com uma senha temporária. Defina uma senha pessoal para continuar; até lá, as demais telas da Ágora ficam
              bloqueadas.
            </p>
          </Alerta>
        ) : null}
        <form className="formulario cartao" onSubmit={(e) => void enviar(e)} noValidate>
          {usuario ? (
            <>
              <p className="texto-secundario">
                Conta: <strong className="texto-forte">{usuario.email}</strong>
              </p>
              <input type="email" name="username" autoComplete="username" value={usuario.email} readOnly className="sr-only" tabIndex={-1} aria-hidden="true" />
            </>
          ) : null}
          <CampoSenha
            rotulo="Senha atual"
            valor={senhaAtual}
            aoMudar={definirSenhaAtual}
            autoComplete="current-password"
            erro={erros.senhaAtual}
            ajuda={obrigatoria ? 'A senha temporária recebida do administrador.' : undefined}
            referencia={referencias.senhaAtual}
          />
          <CampoSenha
            rotulo="Nova senha"
            valor={novaSenha}
            aoMudar={definirNovaSenha}
            autoComplete="new-password"
            erro={erros.novaSenha}
            ajuda={`Mínimo de ${MINIMO} caracteres, diferente da senha atual. Prefira uma frase longa e fácil de lembrar.`}
            referencia={referencias.novaSenha}
          />
          <CampoSenha
            rotulo="Confirmar nova senha"
            valor={confirmacao}
            aoMudar={definirConfirmacao}
            autoComplete="new-password"
            erro={erros.confirmacao}
            referencia={referencias.confirmacao}
          />
          <div>
            <p className="sr-only" aria-live="polite">
              {pendentes === 0 ? 'Todos os requisitos da nova senha foram atendidos.' : `${pendentes} requisito(s) da nova senha pendente(s).`}
            </p>
            <ul className="lista-simples pilha pilha--compacta" aria-label="Requisitos da nova senha">
              {requisitos.map((r) => (
                <li key={r.id} className="linha texto-pequeno">
                  {r.ok ? <CircleCheck size={16} aria-hidden="true" className="trocar-senha__ok" /> : <CircleDashed size={16} aria-hidden="true" />}
                  <span>
                    <span className="sr-only">{r.ok ? 'Atendido: ' : 'Pendente: '}</span>
                    {r.rotulo}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {erroEnvio ? (
            <Alerta tipo="erro" anunciar titulo="Não foi possível trocar a senha">
              <p>{mensagemDeErro(erroEnvio)}</p>
              {erroEnvio instanceof ErroApi && erroEnvio.idRequisicao ? (
                <p className="texto-pequeno">
                  Código para o suporte: <code className="selecionavel">{erroEnvio.idRequisicao}</code>
                </p>
              ) : null}
            </Alerta>
          ) : null}
          <div className="linha linha--entre">
            {obrigatoria ? (
              <Botao variante="terciario" icone={LogOut} carregando={saindo} onClick={() => void encerrar()}>
                Sair
              </Botao>
            ) : (
              <LinkBotao to={retorno} variante="terciario">
                Cancelar
              </LinkBotao>
            )}
            <Botao type="submit" variante="primario" icone={KeyRound} carregando={trocar.isPending}>
              Trocar senha
            </Botao>
          </div>
        </form>
      </div>
    </Pagina>
  );
}
