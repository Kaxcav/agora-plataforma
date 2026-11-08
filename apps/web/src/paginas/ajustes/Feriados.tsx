import { useId, useRef, useState, type FormEvent } from 'react';
import { CalendarDays, CalendarPlus } from 'lucide-react';
import type { Feriado } from '@agora/contratos';
import { formatarData, hojeISO } from '@agora/dominio';
import { useCriarFeriado, useFeriados } from '../../api/ajustes';
import {
  Alerta,
  Botao,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  Pagina,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { AvisoSomenteLeitura, ErroFormulario, focarPrimeiroInvalido, ResumoErros } from './ErroFormulario';

const TIPOS_FERIADO: Record<Feriado['tipo'], { rotulo: string; tom: TomEtiqueta }> = {
  feriado: { rotulo: 'Feriado nacional', tom: 'info' },
  ponto_facultativo: { rotulo: 'Ponto facultativo', tom: 'neutro' },
  local: { rotulo: 'Feriado local', tom: 'alerta' },
};

const formatoDiaSemana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' });

function diaDaSemana(data: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  if (!partes) return '';
  const instante = new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
  const nome = formatoDiaSemana.format(instante);
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

const COLUNAS: ColunaTabela<Feriado>[] = [
  {
    id: 'data',
    cabecalho: 'Data',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (f) => f.data,
    celula: (f) => (
      <time dateTime={f.data} className="numero">
        {formatarData(f.data)}
      </time>
    ),
  },
  { id: 'diaSemana', cabecalho: 'Dia da semana', celula: (f) => diaDaSemana(f.data) },
  { id: 'nome', cabecalho: 'Nome', prioritaria: true, ordenavel: true, valorOrdenacao: (f) => f.nome, celula: (f) => f.nome },
  {
    id: 'tipo',
    cabecalho: 'Tipo',
    prioritaria: true,
    ordenavel: true,
    valorOrdenacao: (f) => TIPOS_FERIADO[f.tipo].rotulo,
    celula: (f) => (
      <Etiqueta tom={TIPOS_FERIADO[f.tipo].tom} compacta>
        {TIPOS_FERIADO[f.tipo].rotulo}
      </Etiqueta>
    ),
  },
];

function FormularioFeriado({ aberto, ano, aoFechar }: { aberto: boolean; ano: number; aoFechar: () => void }) {
  const criar = useCriarFeriado();
  const { avisar } = useAvisos();
  const idFormulario = useId();
  const formulario = useRef<HTMLFormElement>(null);
  const [data, definirData] = useState('');
  const [nome, definirNome] = useState('');
  const [erros, definirErros] = useState<{ data?: string; nome?: string }>({});

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const encontrados: { data?: string; nome?: string } = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) encontrados.data = 'Informe a data do feriado.';
    if (nome.trim().length < 3) encontrados.nome = 'Informe o nome do feriado (mínimo de 3 caracteres).';
    definirErros(encontrados);
    if (encontrados.data || encontrados.nome) {
      focarPrimeiroInvalido(formulario.current);
      return;
    }
    criar.mutate(
      { data, nome: nome.trim() },
      {
        onSuccess: (salvo) => {
          aoFechar();
          const outroAno = !salvo.data.startsWith(String(ano));
          avisar({
            tipo: 'sucesso',
            mensagem: `Feriado “${salvo.nome}” cadastrado para ${formatarData(salvo.data)}.${outroAno ? ' Selecione o ano correspondente para vê-lo na lista.' : ''}`,
          });
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={criar.isPending ? () => undefined : aoFechar}
      titulo="Cadastrar feriado local"
      largura="estreita"
      descricao={
        <p>
          Feriados municipais ou estaduais e pontos facultativos declarados por portaria do órgão. Passam a valer na contagem de prazos em dias
          úteis (Lei 14.133/2021, art. 183). O cadastro fica registrado na trilha de auditoria.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={criar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={criar.isPending}>
            Cadastrar feriado
          </Botao>
        </>
      }
    >
      <form id={idFormulario} ref={formulario} onSubmit={enviar} noValidate className="formulario">
        <ResumoErros quantidade={(erros.data ? 1 : 0) + (erros.nome ? 1 : 0)} />
        <CampoTexto rotulo="Data" obrigatorio type="date" value={data} onChange={(e) => definirData(e.target.value)} erro={erros.data} />
        <CampoTexto
          rotulo="Nome"
          obrigatorio
          maxLength={120}
          value={nome}
          onChange={(e) => definirNome(e.target.value)}
          erro={erros.nome}
          ajuda="Ex.: Aniversário de Brasília."
        />
        <ErroFormulario erro={criar.error} titulo="Não foi possível cadastrar o feriado" />
      </form>
    </Dialogo>
  );
}

export default function Feriados() {
  const p = useParametrosUrl();
  const anoAtual = Number(hojeISO(new Date()).slice(0, 4));
  const anos = [anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2];
  const anoUrl = p.numero('ano');
  const ano = anos.find((a) => a === anoUrl) ?? anoAtual;
  const consulta = useFeriados(ano);
  const { temPermissao } = useSessao();
  const podeEditar = temPermissao('ajustes:editar');
  const [formulario, definirFormulario] = useState({ chave: 0, aberto: false });

  return (
    <Pagina
      titulo="Feriados"
      subtitulo="Calendário usado na contagem de prazos em dias úteis: feriados nacionais calculados, pontos facultativos e feriados locais."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Ajustes' }]}
      tela="ajustes"
      acoes={
        podeEditar ? (
          <Botao variante="primario" icone={CalendarPlus} onClick={() => definirFormulario((f) => ({ chave: f.chave + 1, aberto: true }))}>
            Cadastrar feriado local
          </Botao>
        ) : null
      }
    >
      {podeEditar ? null : <AvisoSomenteLeitura />}
      <Alerta tipo="info" compacto>
        <p>
          Na contagem de prazos exclui-se o dia do começo e inclui-se o do vencimento; se o vencimento cair em dia sem expediente, o prazo é
          prorrogado para o primeiro dia útil seguinte (Lei 14.133/2021, art. 183).
        </p>
      </Alerta>
      <div className="barra-filtros">
        <div className="barra-filtros__campos">
          <Selecao
            rotulo="Ano"
            opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))}
            value={String(ano)}
            onChange={(e) => p.atualizar({ ano: Number(e.target.value) === anoAtual ? undefined : e.target.value })}
          />
        </div>
      </div>
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela colunas={4} />} rotuloCarregando="Carregando feriados">
        {(feriados) => {
          const porTipo = (tipo: Feriado['tipo']) => feriados.filter((f) => f.tipo === tipo).length;
          return (
            <div className="pilha">
              <p className="texto-secundario" aria-live="polite">
                Em {ano}: {contar(porTipo('feriado'), 'feriado nacional', 'feriados nacionais')},{' '}
                {contar(porTipo('ponto_facultativo'), 'ponto facultativo', 'pontos facultativos')} e{' '}
                {contar(porTipo('local'), 'feriado local', 'feriados locais')}.
              </p>
              <Tabela
                id="feriados"
                legenda={`Feriados e pontos facultativos de ${ano}`}
                colunas={COLUNAS}
                linhas={feriados}
                chave={(f) => `${f.data}-${f.nome}`}
                ordenacaoInicial={{ por: 'data', ordem: 'asc' }}
                atualizando={consulta.isFetching}
                vazio={<EstadoVazio icone={CalendarDays} titulo={`Nenhum feriado registrado para ${ano}`} />}
              />
            </div>
          );
        }}
      </ConteudoConsulta>
      {podeEditar ? (
        <FormularioFeriado
          key={formulario.chave}
          aberto={formulario.aberto}
          ano={ano}
          aoFechar={() => definirFormulario((f) => ({ ...f, aberto: false }))}
        />
      ) : null}
    </Pagina>
  );
}
