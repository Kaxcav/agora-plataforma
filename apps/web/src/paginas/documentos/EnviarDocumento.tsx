/**
 * Envio de documento do processo ou de habilitação (RF-21). O navegador só confere o tamanho para avisar cedo;
 * tipo pelo conteúdo, código ativo, SHA-256 e antivírus são verificados no servidor.
 */
import { useId, useState, type ChangeEvent } from 'react';
import { Upload } from 'lucide-react';
import type { CategoriaArquivoProcesso, TipoArquivoProcesso } from '@agora/contratos';
import { useEnviarArquivo } from '../../api/documentos';
import { Alerta, Botao, CaixaSelecao, Campo, CampoTexto, Dialogo, GrupoOpcoes, Selecao, useAvisos } from '../../componentes';
import { ErroOperacao } from '../jornada/comum';
import { formatarTamanho, TIPOS_ARQUIVO, TIPOS_POR_CATEGORIA } from './rotulos';

interface PropsEnviarDocumento {
  processoId: string;
  aberto: boolean;
  aoFechar: () => void;
  licitantes: readonly { id: string; nome: string }[];
  tamanhoMaximoBytes: number;
}

function tituloDoNome(nome: string): string {
  return nome.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 200);
}

export function EnviarDocumento({ processoId, aberto, aoFechar, licitantes, tamanhoMaximoBytes }: PropsEnviarDocumento) {
  const base = useId();
  const { avisar } = useAvisos();
  const enviar = useEnviarArquivo(processoId);
  const [arquivo, definirArquivo] = useState<File | null>(null);
  const [categoria, definirCategoria] = useState<CategoriaArquivoProcesso>(licitantes.length > 0 ? 'habilitacao' : 'processo');
  const [tipo, definirTipo] = useState<TipoArquivoProcesso>(licitantes.length > 0 ? 'atestado_capacidade_tecnica' : 'documento_processo');
  const [fornecedorId, definirFornecedorId] = useState('');
  const [titulo, definirTitulo] = useState('');
  const [dadoPessoal, definirDadoPessoal] = useState(false);
  const [exercicio, definirExercicio] = useState('');
  const [constituicao, definirConstituicao] = useState('');
  const [tentou, definirTentou] = useState(false);

  const erroArquivo = arquivo === null ? 'Escolha o arquivo.' : arquivo.size > tamanhoMaximoBytes ? `O arquivo tem ${formatarTamanho(arquivo.size)}; o limite é ${formatarTamanho(tamanhoMaximoBytes)}.` : null;
  const erroTitulo = titulo.trim().length < 3 ? 'Informe um título com pelo menos 3 caracteres.' : null;
  const erroLicitante = categoria === 'habilitacao' && fornecedorId === '' ? 'Indique o licitante que apresentou o documento.' : null;
  const anoExercicio = Number(exercicio);
  const erroExercicio = tipo === 'balanco_patrimonial' && !(Number.isInteger(anoExercicio) && anoExercicio >= 1900 && anoExercicio <= 2200) ? 'Informe o ano do exercício social (ex.: 2025).' : null;
  const valido = erroArquivo === null && erroTitulo === null && erroLicitante === null && erroExercicio === null;

  const fechar = () => {
    definirArquivo(null);
    definirTitulo('');
    definirFornecedorId('');
    definirDadoPessoal(false);
    definirExercicio('');
    definirConstituicao('');
    definirTentou(false);
    enviar.reset();
    aoFechar();
  };

  const mudarCategoria = (nova: CategoriaArquivoProcesso) => {
    definirCategoria(nova);
    definirTipo(TIPOS_POR_CATEGORIA[nova][0] ?? 'outro');
    if (nova === 'processo') definirFornecedorId('');
  };

  const escolherArquivo = (evento: ChangeEvent<HTMLInputElement>) => {
    const escolhido = evento.target.files?.[0] ?? null;
    definirArquivo(escolhido);
    if (escolhido && titulo.trim() === '') definirTitulo(tituloDoNome(escolhido.name));
  };

  const confirmar = () => {
    definirTentou(true);
    if (!valido || arquivo === null) return;
    enviar.mutate(
      {
        arquivo,
        categoria,
        tipo,
        titulo: titulo.trim(),
        fornecedorId: categoria === 'habilitacao' ? fornecedorId : null,
        contemDadoPessoal: dadoPessoal,
        exercicio: tipo === 'balanco_patrimonial' ? anoExercicio : null,
        dataConstituicao: tipo === 'balanco_patrimonial' && constituicao !== '' ? constituicao : null,
      },
      {
        onSuccess: (recebido) => {
          avisar({
            tipo: 'sucesso',
            titulo: 'Documento recebido',
            mensagem: `${recebido.titulo}: ${recebido.formato.toUpperCase()} conferido pelo conteúdo, SHA-256 registrado${recebido.antivirus === 'limpo' ? ' e verificado pelo antivírus' : ''}.`,
          });
          fechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      largura="media"
      titulo="Enviar documento"
      descricao={`PDF, PNG ou JPEG de até ${formatarTamanho(tamanhoMaximoBytes)}. O servidor confere o tipo pelo conteúdo do arquivo, registra o SHA-256 e guarda o documento no armazenamento da Ágora.`}
      rodape={
        <>
          <Botao variante="terciario" onClick={fechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone={Upload} carregando={enviar.isPending} onClick={confirmar}>
            Enviar documento
          </Botao>
        </>
      }
    >
      <Campo id={`${base}-arquivo`} rotulo="Arquivo" obrigatorio erro={tentou ? erroArquivo : null} ajuda="Atestados digitalizados (só imagem) são lidos pelo serviço de OCR do órgão.">
        {(atributos) => <input {...atributos} className="campo__controle" type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={escolherArquivo} />}
      </Campo>
      <GrupoOpcoes
        legenda="Este documento é"
        nome={`${base}-categoria`}
        valor={categoria}
        aoMudar={mudarCategoria}
        opcoes={[
          { valor: 'habilitacao', rotulo: 'De habilitação, apresentado por um licitante' },
          { valor: 'processo', rotulo: 'Do processo (instrução, parecer, nota técnica...)' },
        ]}
      />
      <Selecao
        rotulo="Tipo de documento"
        obrigatorio
        value={tipo}
        onChange={(e) => definirTipo(e.target.value as TipoArquivoProcesso)}
        opcoes={TIPOS_POR_CATEGORIA[categoria].map((t) => ({ valor: t, rotulo: TIPOS_ARQUIVO[t] }))}
      />
      {categoria === 'habilitacao' ? (
        licitantes.length > 0 ? (
          <Selecao
            rotulo="Licitante"
            obrigatorio
            value={fornecedorId}
            onChange={(e) => definirFornecedorId(e.target.value)}
            opcaoVazia="Selecione o licitante"
            opcoes={licitantes.map((l) => ({ valor: l.id, rotulo: l.nome }))}
            erro={tentou ? erroLicitante : null}
          />
        ) : (
          <Alerta tipo="aviso" compacto titulo="Nenhum licitante registrado">
            <p>Os documentos de habilitação são vinculados aos licitantes da disputa (etapa 6). Registre a disputa antes.</p>
          </Alerta>
        )
      ) : null}
      <CampoTexto rotulo="Título" obrigatorio maxLength={200} value={titulo} onChange={(e) => definirTitulo(e.target.value)} erro={tentou ? erroTitulo : null} ajuda="Ex.: Atestado emitido pela Secretaria de Segurança do Estado X." />
      {tipo === 'balanco_patrimonial' ? (
        <div className="grade grade--2">
          <CampoTexto rotulo="Exercício social" obrigatorio inputMode="numeric" maxLength={4} value={exercicio} onChange={(e) => definirExercicio(e.target.value.replace(/\D/g, ''))} erro={tentou ? erroExercicio : null} />
          <CampoTexto
            rotulo="Data de constituição da empresa"
            type="date"
            value={constituicao}
            onChange={(e) => definirConstituicao(e.target.value)}
            ajuda="Empresa com menos de 2 anos apresenta só o último exercício (art. 69, § 6º)."
          />
        </div>
      ) : null}
      <CaixaSelecao
        rotulo="O documento contém dado pessoal (CPF, e-mail, telefone, assinatura de pessoa física)"
        ajuda="Quem baixar o documento terá de informar a finalidade, e o acesso fica registrado (LGPD, art. 37)."
        checked={dadoPessoal}
        onChange={(e) => definirDadoPessoal(e.target.checked)}
      />
      <ErroOperacao erro={enviar.error} titulo="O documento não foi recebido" />
    </Dialogo>
  );
}
