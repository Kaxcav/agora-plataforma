/**
 * Diálogos da tela de sigilo: classificar (ou reclassificar, ou enviar anexo sigiloso ao cofre), informar motivo
 * (PDF marcado, download do cofre, desclassificação, revogação) e credenciar. As regras são conferidas no servidor
 * (RN-40); aqui só os campos obrigatórios básicos, para orientar o preenchimento.
 */
import { useState } from 'react';
import { Lock, ShieldCheck } from 'lucide-react';
import type { AlvoSigilo, ClassificacaoSigilo, EntradaClassificacaoSigilo, GrauSigilo, HipoteseSigiloLai, NivelAutoridadeClassificadora, SigiloProcesso, TipoSigilo } from '@agora/contratos';
import { hojeISO } from '@agora/dominio';
import { useClassificarSigilo, useCredenciarSigilo, useEnviarAnexoSigiloso } from '../../api/sigilo';
import { AreaTexto, Botao, CaixaSelecao, Campo, CampoTexto, Dialogo, GrupoOpcoes, Selecao, useAvisos } from '../../componentes';
import { ErroOperacao } from '../jornada/comum';
import { GRAUS, HIPOTESES, NIVEIS } from './rotulos';

export interface AlvoDialogo {
  alvo: AlvoSigilo;
  documentoTipo?: EntradaClassificacaoSigilo['documentoTipo'];
  arquivoId?: string;
  titulo: string;
  /** Classificação vigente (reclassificação). */
  atual: ClassificacaoSigilo | null;
  /** Envio de anexo novo direto ao cofre. */
  novoAnexo?: boolean;
}

const RAZOES_MINIMO = 30;

export function DialogoClassificar({ processoId, alvo, aoFechar }: { processoId: string; alvo: AlvoDialogo; aoFechar: () => void }) {
  const classificar = useClassificarSigilo(processoId);
  const enviar = useEnviarAnexoSigiloso(processoId);
  const { avisar } = useAvisos();
  const atual = alvo.atual;
  const permiteOrcamento = alvo.alvo === 'documento' || alvo.alvo === 'anexo';
  const [tipo, definirTipo] = useState<TipoSigilo>(atual?.tipo ?? 'lai');
  const [grau, definirGrau] = useState<GrauSigilo | null>(atual?.grau ?? 'reservada');
  const [hipotese, definirHipotese] = useState<HipoteseSigiloLai | ''>(atual?.hipotese ?? '');
  const [razoes, definirRazoes] = useState('');
  const [dataProducao, definirDataProducao] = useState(atual?.dataProducao ?? hojeISO(new Date()));
  const [termo, definirTermo] = useState<'data' | 'evento'>(atual?.eventoFim && atual.tipo === 'lai' ? 'evento' : 'data');
  const [prazoFim, definirPrazoFim] = useState(atual?.prazoFim ?? '');
  const [eventoFim, definirEventoFim] = useState(atual?.tipo === 'lai' ? (atual.eventoFim ?? '') : '');
  const [nome, definirNome] = useState(atual?.autoridade?.nome ?? '');
  const [cargo, definirCargo] = useState(atual?.autoridade?.cargo ?? '');
  const [nivel, definirNivel] = useState<NivelAutoridadeClassificadora | ''>(atual?.autoridade?.nivel ?? '');
  const [ato, definirAto] = useState(atual?.autoridade?.atoDelegacao ?? '');
  const [motivo, definirMotivo] = useState('');
  const [arquivo, definirArquivo] = useState<File | null>(null);
  const [tituloAnexo, definirTituloAnexo] = useState('');
  const [dadoPessoal, definirDadoPessoal] = useState(false);
  const [tentou, definirTentou] = useState(false);

  const lai = tipo === 'lai';
  const erros = {
    razoes: razoes.trim().length < RAZOES_MINIMO ? `Registre as razões com pelo menos ${RAZOES_MINIMO} caracteres.` : null,
    hipotese: lai && hipotese === '' ? 'Escolha a hipótese do art. 23 da LAI.' : null,
    prazoFim: lai && termo === 'data' && prazoFim === '' ? 'Informe a data final do sigilo.' : null,
    eventoFim: lai && termo === 'evento' && eventoFim.trim().length < 10 ? 'Descreva o evento com pelo menos 10 caracteres.' : null,
    autoridade: lai && (nome.trim().length < 3 || cargo.trim().length < 3 || nivel === '') ? 'Informe o nome, o cargo e o nível da autoridade classificadora.' : null,
    ato: lai && nivel === 'delegacao' && ato.trim().length < 5 ? 'Informe o ato de delegação.' : null,
    motivo: atual && motivo.trim().length < 10 ? 'Informe o motivo da reclassificação (mínimo de 10 caracteres).' : null,
    arquivo: alvo.novoAnexo && arquivo === null ? 'Escolha o arquivo (PDF, PNG ou JPEG).' : null,
    tituloAnexo: alvo.novoAnexo && tituloAnexo.trim().length < 3 ? 'Dê um título ao anexo.' : null,
  };
  const invalido = Object.values(erros).some((e) => e !== null);
  const mostrar = (e: string | null) => (tentou ? e : null);

  const entrada = (): EntradaClassificacaoSigilo => ({
    alvo: alvo.alvo,
    ...(alvo.documentoTipo ? { documentoTipo: alvo.documentoTipo } : {}),
    ...(alvo.arquivoId ? { arquivoId: alvo.arquivoId } : {}),
    tipo,
    grau: lai ? grau : null,
    hipotese: lai && hipotese !== '' ? hipotese : null,
    razoes: razoes.trim(),
    dataProducao,
    prazoFim: lai && termo === 'data' ? prazoFim : null,
    eventoFim: lai && termo === 'evento' ? eventoFim.trim() : null,
    autoridade: lai || (nome.trim() !== '' && nivel !== '') ? { nome: nome.trim(), cargo: cargo.trim(), nivel: nivel === '' ? 'direcao_das_101_5' : nivel, atoDelegacao: nivel === 'delegacao' ? ato.trim() : null } : null,
    ...(atual ? { motivoReclassificacao: motivo.trim() } : {}),
  });

  const confirmar = () => {
    definirTentou(true);
    if (invalido) return;
    const aoConcluir = () => {
      avisar({
        tipo: 'sucesso',
        titulo: alvo.novoAnexo ? 'Anexo guardado no cofre' : atual ? 'Classificação atualizada' : 'Classificação registrada',
        mensagem: `${alvo.novoAnexo ? tituloAnexo.trim() : alvo.titulo}: ${lai ? `informação ${grau ?? ''}` : 'orçamento sigiloso'}. O registro está na trilha de auditoria.`,
      });
      aoFechar();
    };
    if (alvo.novoAnexo && arquivo) {
      const e = entrada();
      const classificacao = { tipo: e.tipo, grau: e.grau, hipotese: e.hipotese, razoes: e.razoes, dataProducao: e.dataProducao, prazoFim: e.prazoFim, eventoFim: e.eventoFim, autoridade: e.autoridade };
      enviar.mutate({ arquivo, titulo: tituloAnexo.trim(), contemDadoPessoal: dadoPessoal, classificacao }, { onSuccess: aoConcluir });
      return;
    }
    classificar.mutate(entrada(), { onSuccess: aoConcluir });
  };

  const tituloDialogo = alvo.novoAnexo ? 'Enviar anexo sigiloso ao cofre' : atual ? `Reclassificar: ${alvo.titulo}` : `Classificar: ${alvo.titulo}`;
  return (
    <Dialogo
      aberto
      aoFechar={aoFechar}
      largura="ampla"
      titulo={tituloDialogo}
      descricao="A classificação restringe o acesso a quem tem credencial no processo; os órgãos de controle mantêm acesso irrestrito. Documento classificado não aparece na transparência nem vai ao PNCP."
      rodape={
        <>
          <Botao variante="terciario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone={Lock} carregando={classificar.isPending || enviar.isPending} onClick={confirmar}>
            {alvo.novoAnexo ? 'Cifrar e guardar' : atual ? 'Reclassificar' : 'Classificar'}
          </Botao>
        </>
      }
    >
      <div className="pilha">
        {alvo.novoAnexo ? (
          <>
            <Campo id="sigilo-arquivo" rotulo="Arquivo" obrigatorio erro={mostrar(erros.arquivo)} ajuda="PDF, PNG ou JPEG. O arquivo é cifrado no servidor antes de ser gravado (AES-256-GCM).">
              {(atributos) => (
                <input {...atributos} className="campo__controle" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => definirArquivo(e.target.files?.[0] ?? null)} />
              )}
            </Campo>
            <CampoTexto rotulo="Título do anexo" obrigatorio value={tituloAnexo} maxLength={200} onChange={(e) => definirTituloAnexo(e.target.value)} erro={mostrar(erros.tituloAnexo)} />
            <CaixaSelecao rotulo="Contém dado pessoal (CPF, e-mail, telefone ou assinatura de pessoa física)" checked={dadoPessoal} onChange={(e) => definirDadoPessoal(e.target.checked)} />
          </>
        ) : null}
        {permiteOrcamento ? (
          <GrupoOpcoes<TipoSigilo>
            legenda="Tipo de sigilo"
            nome="tipo-sigilo"
            valor={tipo}
            aoMudar={definirTipo}
            opcoes={[
              { valor: 'lai', rotulo: 'Informação classificada (Lei 12.527/2011)', ajuda: 'Segurança da sociedade e do Estado (Lei 14.133/2021, art. 13)' },
              { valor: 'orcamento', rotulo: 'Orçamento sigiloso (art. 24)', ajuda: 'Memória de cálculo e preços: públicos depois da fase de lances ou do julgamento' },
            ]}
          />
        ) : null}
        {lai ? (
          <>
            <GrupoOpcoes<GrauSigilo>
              legenda="Grau de sigilo"
              nome="grau-sigilo"
              horizontal
              valor={grau}
              aoMudar={definirGrau}
              opcoes={GRAUS.map((g) => ({ valor: g.valor, rotulo: g.rotulo, ajuda: g.ajuda }))}
            />
            <Selecao
              rotulo="Hipótese de sigilo (Lei 12.527/2011, art. 23)"
              obrigatorio
              opcaoVazia="Selecione…"
              opcoes={HIPOTESES}
              value={hipotese}
              onChange={(e) => definirHipotese(e.target.value as HipoteseSigiloLai | '')}
              erro={mostrar(erros.hipotese)}
            />
          </>
        ) : null}
        <AreaTexto
          rotulo={lai ? 'Razões da classificação' : 'Motivo do sigilo do orçamento'}
          obrigatorio
          rows={3}
          maxLength={2000}
          contador
          value={razoes}
          onChange={(e) => definirRazoes(e.target.value)}
          erro={mostrar(erros.razoes)}
          ajuda="As razões integram o termo de classificação e têm o mesmo sigilo: a trilha guarda só o hash do texto."
        />
        <CampoTexto rotulo="Data de produção da informação" type="date" obrigatorio value={dataProducao} onChange={(e) => definirDataProducao(e.target.value)} ajuda="O prazo máximo conta desta data (LAI, art. 24, § 1º)." />
        {lai ? (
          <>
            <GrupoOpcoes<'data' | 'evento'>
              legenda="Termo final do sigilo"
              nome="termo-sigilo"
              horizontal
              valor={termo}
              aoMudar={definirTermo}
              opcoes={[
                { valor: 'data', rotulo: 'Data' },
                { valor: 'evento', rotulo: 'Evento' },
              ]}
            />
            {termo === 'data' ? (
              <CampoTexto rotulo="Sigiloso até" type="date" obrigatorio value={prazoFim} onChange={(e) => definirPrazoFim(e.target.value)} erro={mostrar(erros.prazoFim)} />
            ) : (
              <CampoTexto
                rotulo="Evento que encerra o sigilo"
                obrigatorio
                maxLength={500}
                value={eventoFim}
                onChange={(e) => definirEventoFim(e.target.value)}
                erro={mostrar(erros.eventoFim)}
                ajuda="Se o evento não ocorrer, a informação fica pública no fim do prazo máximo do grau."
              />
            )}
          </>
        ) : (
          <p className="texto-pequeno texto-secundario">Termo final: conclusão da fase de lances ou do julgamento (art. 18, § 1º, VI, e art. 24).</p>
        )}
        <fieldset className="pilha pilha--compacta">
          <legend>Autoridade classificadora{lai ? '' : ' (opcional)'}</legend>
          <CampoTexto rotulo="Nome da autoridade" obrigatorio={lai} maxLength={200} value={nome} onChange={(e) => definirNome(e.target.value)} />
          <CampoTexto rotulo="Cargo" obrigatorio={lai} maxLength={200} value={cargo} onChange={(e) => definirCargo(e.target.value)} />
          <Selecao
            rotulo="Competência (Lei 12.527/2011, art. 27)"
            obrigatorio={lai}
            opcaoVazia="Selecione…"
            opcoes={NIVEIS}
            value={nivel}
            onChange={(e) => definirNivel(e.target.value as NivelAutoridadeClassificadora | '')}
            erro={mostrar(erros.autoridade)}
          />
          {nivel === 'delegacao' ? <CampoTexto rotulo="Ato de delegação" obrigatorio maxLength={200} value={ato} onChange={(e) => definirAto(e.target.value)} erro={mostrar(erros.ato)} /> : null}
        </fieldset>
        {atual ? (
          <AreaTexto rotulo="Motivo da reclassificação" obrigatorio rows={2} maxLength={500} contador value={motivo} onChange={(e) => definirMotivo(e.target.value)} erro={mostrar(erros.motivo)} />
        ) : null}
        <ErroOperacao erro={classificar.error ?? enviar.error} titulo="A classificação não foi registrada" />
      </div>
    </Dialogo>
  );
}

export interface PedidoMotivo {
  titulo: string;
  descricao: string;
  rotulo: string;
  botao: string;
  minimo: number;
  maximo: number;
  ajuda?: string;
  executar: (motivo: string) => Promise<unknown>;
}

/** Motivo do acesso ou do ato (registrado na trilha e no registro de acessos). */
export function DialogoMotivo({ pedido, aoFechar }: { pedido: PedidoMotivo; aoFechar: () => void }) {
  const [motivo, definirMotivo] = useState('');
  const [tentou, definirTentou] = useState(false);
  const [enviando, definirEnviando] = useState(false);
  const [erro, definirErro] = useState<unknown>(null);
  const curto = motivo.trim().length < pedido.minimo ? `Informe pelo menos ${pedido.minimo} caracteres.` : null;
  const confirmar = () => {
    definirTentou(true);
    if (curto) return;
    definirEnviando(true);
    definirErro(null);
    pedido
      .executar(motivo.trim())
      .then(() => aoFechar())
      .catch((e: unknown) => definirErro(e))
      .finally(() => definirEnviando(false));
  };
  return (
    <Dialogo
      aberto
      aoFechar={aoFechar}
      titulo={pedido.titulo}
      descricao={pedido.descricao}
      rodape={
        <>
          <Botao variante="terciario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={enviando} onClick={confirmar}>
            {pedido.botao}
          </Botao>
        </>
      }
    >
      <AreaTexto
        rotulo={pedido.rotulo}
        obrigatorio
        rows={3}
        maxLength={pedido.maximo}
        contador
        value={motivo}
        onChange={(e) => definirMotivo(e.target.value)}
        erro={tentou ? curto : null}
        ajuda={pedido.ajuda}
      />
      <ErroOperacao erro={erro} titulo="Não foi possível concluir" />
    </Dialogo>
  );
}

export function DialogoCredencial({ processoId, sigilo, aoFechar }: { processoId: string; sigilo: SigiloProcesso; aoFechar: () => void }) {
  const credenciar = useCredenciarSigilo(processoId);
  const { avisar } = useAvisos();
  const [usuarioId, definirUsuarioId] = useState('');
  const [grau, definirGrau] = useState<GrauSigilo | null>('reservada');
  const [fundamento, definirFundamento] = useState<'credencial_seguranca' | 'tcms' | null>('credencial_seguranca');
  const [necessidade, definirNecessidade] = useState('');
  const [validaAte, definirValidaAte] = useState('');
  const [tentou, definirTentou] = useState(false);
  const erros = {
    usuario: usuarioId === '' ? 'Escolha a pessoa.' : null,
    necessidade: necessidade.trim().length < 20 ? 'Descreva a necessidade de conhecer com pelo menos 20 caracteres.' : null,
  };
  const confirmar = () => {
    definirTentou(true);
    if (erros.usuario || erros.necessidade || grau === null || fundamento === null) return;
    credenciar.mutate(
      { usuarioId, grauMaximo: grau, fundamento, necessidade: necessidade.trim(), validaAte: validaAte === '' ? null : validaAte },
      {
        onSuccess: () => {
          avisar({ tipo: 'sucesso', titulo: 'Credencial registrada', mensagem: `${sigilo.credenciaveis.find((u) => u.id === usuarioId)?.nome ?? 'A pessoa'} passa a acessar o processo até o grau ${grau}.` });
          aoFechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto
      aoFechar={aoFechar}
      largura="media"
      titulo="Credenciar acesso ao processo"
      descricao="Registre quem tem credencial de segurança, ou assinou o termo de compromisso de manutenção de sigilo, e precisa conhecer a informação (Decreto 7.845/2012, art. 18)."
      rodape={
        <>
          <Botao variante="terciario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone={ShieldCheck} carregando={credenciar.isPending} onClick={confirmar}>
            Credenciar
          </Botao>
        </>
      }
    >
      <div className="pilha">
        <Selecao
          rotulo="Pessoa"
          obrigatorio
          opcaoVazia="Selecione…"
          opcoes={sigilo.credenciaveis.map((u) => ({ valor: u.id, rotulo: u.nome }))}
          value={usuarioId}
          onChange={(e) => definirUsuarioId(e.target.value)}
          erro={tentou ? erros.usuario : null}
        />
        <GrupoOpcoes<GrauSigilo> legenda="Grau máximo" nome="grau-credencial" horizontal valor={grau} aoMudar={definirGrau} opcoes={GRAUS.map((g) => ({ valor: g.valor, rotulo: g.rotulo }))} />
        <GrupoOpcoes<'credencial_seguranca' | 'tcms'>
          legenda="Fundamento"
          nome="fundamento-credencial"
          valor={fundamento}
          aoMudar={definirFundamento}
          opcoes={[
            { valor: 'credencial_seguranca', rotulo: 'Credencial de segurança', ajuda: 'Concedida pelo órgão de registro (Decreto 7.845/2012, art. 12)' },
            { valor: 'tcms', rotulo: 'Termo de compromisso de manutenção de sigilo', ajuda: 'Acesso excepcional (art. 18, parágrafo único)' },
          ]}
        />
        <AreaTexto
          rotulo="Necessidade de conhecer"
          obrigatorio
          rows={3}
          maxLength={500}
          contador
          value={necessidade}
          onChange={(e) => definirNecessidade(e.target.value)}
          erro={tentou ? erros.necessidade : null}
        />
        <CampoTexto rotulo="Válida até" type="date" value={validaAte} onChange={(e) => definirValidaAte(e.target.value)} ajuda="Deixe em branco para valer até a revogação." />
        <ErroOperacao erro={credenciar.error} titulo="A credencial não foi registrada" />
      </div>
    </Dialogo>
  );
}
