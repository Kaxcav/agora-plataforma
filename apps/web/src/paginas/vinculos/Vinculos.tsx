import { useState } from 'react';
import { Link } from 'react-router';
import { CircleCheck, Link2 } from 'lucide-react';
import type { EmpenhoSemContrato, EmpenhoSemItem, SugestaoVinculoContratoAta } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import {
  useContratosSemAta,
  useDesvincularContratoAta,
  useDesvincularEmpenhoContrato,
  useEmpenhosSemContrato,
  useEmpenhosSemItem,
  useVincularContratoAta,
  useVincularEmpenhoContrato,
  useVincularEmpenhoItem,
} from '../../api/vinculos';
import {
  Abas,
  Botao,
  ConfirmarAcao,
  DadoPessoal,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  Pagina,
  Selecao,
  Tabela,
  TextoLongo,
  useAvisos,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';

const CONFIANCA: Record<'alta' | 'media' | 'baixa', { rotulo: string; tom: TomEtiqueta }> = {
  alta: { rotulo: 'Confiança alta', tom: 'sucesso' },
  media: { rotulo: 'Confiança média', tom: 'aviso' },
  baixa: { rotulo: 'Confiança baixa', tom: 'neutro' },
};

function EtiquetaConfianca({ valor }: { valor: SugestaoVinculoContratoAta['confianca'] }) {
  if (valor === null) {
    return (
      <Etiqueta tom="neutro" compacta>
        Sem sugestão
      </Etiqueta>
    );
  }
  const def = CONFIANCA[valor];
  return (
    <Etiqueta tom={def.tom} compacta>
      {def.rotulo}
    </Etiqueta>
  );
}

// ───────────────────────── Contratos sem ata ─────────────────────────

function AbaContratosSemAta() {
  const consulta = useContratosSemAta();
  const { temPermissao } = useSessao();
  const podeEditar = temPermissao('vinculos:editar');
  const vincular = useVincularContratoAta();
  const desvincular = useDesvincularContratoAta();
  const { avisar } = useAvisos();
  const [alvo, definirAlvo] = useState<SugestaoVinculoContratoAta | null>(null);

  if (consulta.isError && consulta.data === undefined) return <FalhaConsulta consulta={consulta} />;

  const confirmar = () => {
    if (!alvo || !alvo.ataSugerida) return;
    const contrato = alvo.contrato;
    const ata = alvo.ataSugerida;
    vincular.mutate(
      { contratoId: contrato.id, ataId: ata.id },
      {
        onSuccess: () => {
          definirAlvo(null);
          avisar({
            tipo: 'sucesso',
            mensagem: `Contrato ${contrato.numero} vinculado à ata ${ata.numero}.`,
            acao: {
              rotulo: 'Desfazer',
              executar: async () => {
                await desvincular.mutateAsync(contrato.id);
                avisar({ tipo: 'info', mensagem: 'Vínculo desfeito.' });
              },
            },
          });
        },
      },
    );
  };

  const colunas: ColunaTabela<SugestaoVinculoContratoAta>[] = [
    {
      id: 'contrato',
      cabecalho: 'Contrato',
      identificadora: true,
      fixa: true,
      ordenavel: true,
      valorOrdenacao: (s) => s.contrato.numero,
      celula: (s) => <Link to={`/contratos/${s.contrato.id}`}>Contrato {s.contrato.numero}</Link>,
    },
    {
      id: 'objeto',
      cabecalho: 'Objeto',
      prioritaria: true,
      larguraMinima: '16rem',
      celula: (s) => <TextoLongo texto={s.contrato.objeto} />,
    },
    {
      id: 'fornecedor',
      cabecalho: 'Fornecedor',
      ordenavel: true,
      valorOrdenacao: (s) => s.contrato.fornecedor,
      celula: (s) => s.contrato.fornecedor,
    },
    {
      id: 'ata',
      cabecalho: 'Ata sugerida',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (s) => s.ataSugerida?.numero ?? null,
      celula: (s) =>
        s.ataSugerida ? (
          <span className="pilha pilha--compacta">
            <Link to={`/atas/${s.ataSugerida.id}`}>Ata {s.ataSugerida.numero}</Link>
            <span className="texto-pequeno texto-secundario">{s.ataSugerida.objeto}</span>
          </span>
        ) : (
          <span className="texto-secundario">Nenhuma ata compatível</span>
        ),
    },
    {
      id: 'confianca',
      cabecalho: 'Confiança',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (s) => (s.confianca === 'alta' ? 3 : s.confianca === 'media' ? 2 : s.confianca === 'baixa' ? 1 : 0),
      celula: (s) => <EtiquetaConfianca valor={s.confianca} />,
    },
    {
      id: 'motivo',
      cabecalho: 'Motivo da sugestão',
      larguraMinima: '14rem',
      celula: (s) => <TextoLongo texto={s.motivo} />,
    },
  ];

  return (
    <div className="pilha">
      <p className="texto-secundario">
        Contratos firmados sem ata de registro de preços associada. Quando há uma ata compatível (mesmo fornecedor, objeto e UASG), a Ágora
        sugere o vínculo com o grau de confiança e o motivo. O vínculo só é gravado após sua confirmação.
      </p>
      <Tabela
        id="vinculos-contratos-sem-ata"
        legenda="Contratos sem ata vinculada"
        colunas={colunas}
        linhas={consulta.data}
        chave={(s) => s.contrato.id}
        atualizando={consulta.isFetching && consulta.data !== undefined}
        ordenacaoInicial={{ por: 'confianca', ordem: 'desc' }}
        acoes={
          podeEditar
            ? {
                cabecalho: 'Ações',
                celula: (s) =>
                  s.ataSugerida ? (
                    <Botao
                      variante="secundario"
                      tamanho="compacto"
                      icone={Link2}
                      onClick={() => {
                        vincular.reset();
                        definirAlvo(s);
                      }}
                      aria-label={`Vincular à ata sugerida ${s.ataSugerida.numero} — contrato ${s.contrato.numero}`}
                    >
                      Vincular à ata sugerida
                    </Botao>
                  ) : (
                    <span className="texto-pequeno texto-secundario">Sem ata para vincular</span>
                  ),
              }
            : undefined
        }
        vazio={
          <EstadoVazio
            icone={CircleCheck}
            titulo="Nenhum contrato sem ata — tudo vinculado"
            descricao="Todos os contratos oriundos de registro de preços estão ligados às suas atas."
          />
        }
      />
      <ConfirmarAcao
        aberto={alvo !== null}
        aoFechar={() => definirAlvo(null)}
        titulo="Vincular contrato à ata"
        descricao={
          alvo?.ataSugerida ? (
            <p>
              Vincular o <strong>contrato {alvo.contrato.numero}</strong> à <strong>ata {alvo.ataSugerida.numero}</strong>? O consumo da ata e
              o saldo contratável serão recalculados. A operação fica na trilha de auditoria e pode ser desfeita no aviso que aparecerá em
              seguida.
            </p>
          ) : null
        }
        rotuloConfirmar="Vincular"
        aoConfirmar={confirmar}
        processando={vincular.isPending}
        erro={vincular.error}
      />
    </div>
  );
}

// ───────────────────────── Empenhos sem contrato ─────────────────────────

function AbaEmpenhosSemContrato() {
  const consulta = useEmpenhosSemContrato();
  const { temPermissao } = useSessao();
  const podeEditar = temPermissao('vinculos:editar');
  const vincular = useVincularEmpenhoContrato();
  const desvincular = useDesvincularEmpenhoContrato();
  const { avisar } = useAvisos();
  const [alvo, definirAlvo] = useState<EmpenhoSemContrato | null>(null);

  if (consulta.isError && consulta.data === undefined) return <FalhaConsulta consulta={consulta} />;

  const confirmar = () => {
    if (!alvo || !alvo.contratoSugerido) return;
    const empenho = alvo.empenho;
    const contrato = alvo.contratoSugerido;
    vincular.mutate(
      { empenhoId: empenho.id, contratoId: contrato.id },
      {
        onSuccess: () => {
          definirAlvo(null);
          avisar({
            tipo: 'sucesso',
            mensagem: `Empenho ${empenho.numero} vinculado ao contrato ${contrato.numero}.`,
            acao: {
              rotulo: 'Desfazer',
              executar: async () => {
                await desvincular.mutateAsync(empenho.id);
                avisar({ tipo: 'info', mensagem: 'Vínculo desfeito.' });
              },
            },
          });
        },
      },
    );
  };

  const colunas: ColunaTabela<EmpenhoSemContrato>[] = [
    {
      id: 'numero',
      cabecalho: 'Empenho',
      identificadora: true,
      fixa: true,
      ordenavel: true,
      valorOrdenacao: (e) => e.empenho.numero,
      celula: (e) => <span className="mono">{e.empenho.numero}</span>,
    },
    {
      id: 'credor',
      cabecalho: 'Credor',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (e) => e.empenho.credor.nome,
      celula: (e) => (
        <span className="pilha pilha--compacta">
          <span>{e.empenho.credor.nome}</span>
          <span className="texto-pequeno">
            <DadoPessoal
              valor={e.empenho.credor.documento}
              recurso="credor_empenho"
              id={e.empenho.id}
              campo="documento"
              descricao={`documento do credor do empenho ${e.empenho.numero}`}
            />
          </span>
        </span>
      ),
    },
    {
      id: 'emissao',
      cabecalho: 'Emissão',
      ordenavel: true,
      valorOrdenacao: (e) => e.empenho.emissaoEm,
      celula: (e) => <span className="numero">{formatarData(e.empenho.emissaoEm)}</span>,
    },
    {
      id: 'uasg',
      cabecalho: 'UASG',
      ocultaPorPadrao: true,
      celula: (e) => <span className="numero">{e.empenho.uasg}</span>,
    },
    {
      id: 'valor',
      cabecalho: 'Valor empenhado',
      alinhamento: 'fim',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (e) => e.empenho.valorEmpenhado,
      celula: (e) => <span className="numero">{formatarMoeda(e.empenho.valorEmpenhado)}</span>,
    },
    {
      id: 'contrato',
      cabecalho: 'Contrato sugerido',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (e) => e.contratoSugerido?.numero ?? null,
      celula: (e) =>
        e.contratoSugerido ? (
          <Link to={`/contratos/${e.contratoSugerido.id}`}>Contrato {e.contratoSugerido.numero}</Link>
        ) : (
          <span className="texto-secundario">Sem sugestão</span>
        ),
    },
    {
      id: 'motivo',
      cabecalho: 'Motivo',
      larguraMinima: '14rem',
      celula: (e) => <TextoLongo texto={e.motivo} />,
    },
  ];

  return (
    <div className="pilha">
      <p className="texto-secundario">
        Notas de empenho (fonte: SIAFI) que ainda não estão ligadas a um contrato da carteira. Sem o vínculo, a execução financeira do
        contrato fica subestimada.
      </p>
      <Tabela
        id="vinculos-empenhos-sem-contrato"
        legenda="Empenhos sem contrato vinculado"
        colunas={colunas}
        linhas={consulta.data}
        chave={(e) => e.empenho.id}
        atualizando={consulta.isFetching && consulta.data !== undefined}
        ordenacaoInicial={{ por: 'valor', ordem: 'desc' }}
        acoes={
          podeEditar
            ? {
                cabecalho: 'Ações',
                celula: (e) =>
                  e.contratoSugerido ? (
                    <Botao
                      variante="secundario"
                      tamanho="compacto"
                      icone={Link2}
                      onClick={() => {
                        vincular.reset();
                        definirAlvo(e);
                      }}
                      aria-label={`Vincular ao contrato sugerido ${e.contratoSugerido.numero} — empenho ${e.empenho.numero}`}
                    >
                      Vincular ao contrato sugerido
                    </Botao>
                  ) : (
                    <span className="texto-pequeno texto-secundario">Sem contrato para vincular</span>
                  ),
              }
            : undefined
        }
        vazio={
          <EstadoVazio
            icone={CircleCheck}
            titulo="Nenhum empenho sem contrato — tudo vinculado"
            descricao="Todas as notas de empenho estão associadas a contratos da carteira."
          />
        }
      />
      <ConfirmarAcao
        aberto={alvo !== null}
        aoFechar={() => definirAlvo(null)}
        titulo="Vincular empenho ao contrato"
        descricao={
          alvo?.contratoSugerido ? (
            <p>
              Vincular o <strong>empenho {alvo.empenho.numero}</strong> ({formatarMoeda(alvo.empenho.valorEmpenhado)}) ao{' '}
              <strong>contrato {alvo.contratoSugerido.numero}</strong>? A execução financeira do contrato será atualizada. A operação fica na
              trilha de auditoria e pode ser desfeita no aviso que aparecerá em seguida.
            </p>
          ) : null
        }
        rotuloConfirmar="Vincular"
        aoConfirmar={confirmar}
        processando={vincular.isPending}
        erro={vincular.error}
      />
    </div>
  );
}

// ───────────────────────── Empenhos sem item ─────────────────────────

function AbaEmpenhosSemItem() {
  const consulta = useEmpenhosSemItem();
  const { temPermissao } = useSessao();
  const podeEditar = temPermissao('vinculos:editar');
  const vincular = useVincularEmpenhoItem();
  const { avisar } = useAvisos();
  const [alvo, definirAlvo] = useState<EmpenhoSemItem | null>(null);
  const [itemId, definirItemId] = useState('');
  const [tentou, definirTentou] = useState(false);

  if (consulta.isError && consulta.data === undefined) return <FalhaConsulta consulta={consulta} />;

  const abrir = (e: EmpenhoSemItem) => {
    vincular.reset();
    definirItemId(e.itensCandidatos.length === 1 ? (e.itensCandidatos[0]?.id ?? '') : '');
    definirTentou(false);
    definirAlvo(e);
  };

  const confirmar = () => {
    definirTentou(true);
    if (!alvo || itemId === '') return;
    const item = alvo.itensCandidatos.find((i) => i.id === itemId);
    const numeroEmpenho = alvo.empenho.numero;
    vincular.mutate(
      { empenhoId: alvo.empenho.id, itemContratoId: itemId },
      {
        onSuccess: () => {
          definirAlvo(null);
          avisar({
            tipo: 'sucesso',
            mensagem: `Empenho ${numeroEmpenho} vinculado ${item ? `ao item ${item.numero}` : 'ao item selecionado'} do contrato.`,
          });
        },
      },
    );
  };

  const colunas: ColunaTabela<EmpenhoSemItem>[] = [
    {
      id: 'numero',
      cabecalho: 'Empenho',
      identificadora: true,
      fixa: true,
      ordenavel: true,
      valorOrdenacao: (e) => e.empenho.numero,
      celula: (e) => <span className="mono">{e.empenho.numero}</span>,
    },
    {
      id: 'contrato',
      cabecalho: 'Contrato',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (e) => e.contrato.numero,
      celula: (e) => <Link to={`/contratos/${e.contrato.id}`}>Contrato {e.contrato.numero}</Link>,
    },
    {
      id: 'naturezaDespesa',
      cabecalho: 'Natureza da despesa',
      ocultaPorPadrao: true,
      celula: (e) => <span className="mono">{e.empenho.naturezaDespesa}</span>,
    },
    {
      id: 'valor',
      cabecalho: 'Valor empenhado',
      alinhamento: 'fim',
      prioritaria: true,
      ordenavel: true,
      valorOrdenacao: (e) => e.empenho.valorEmpenhado,
      celula: (e) => <span className="numero">{formatarMoeda(e.empenho.valorEmpenhado)}</span>,
    },
    {
      id: 'candidatos',
      cabecalho: 'Itens candidatos',
      alinhamento: 'fim',
      ordenavel: true,
      valorOrdenacao: (e) => e.itensCandidatos.length,
      celula: (e) => <span className="numero">{e.itensCandidatos.length}</span>,
    },
  ];

  const erroItem = tentou && itemId === '' ? 'Selecione o item do contrato.' : null;

  return (
    <div className="pilha">
      <p className="texto-secundario">
        Empenhos já ligados a um contrato, mas sem indicação do item que custeiam. O vínculo por item permite acompanhar o saldo empenhado de
        cada item contratado.
      </p>
      <Tabela
        id="vinculos-empenhos-sem-item"
        legenda="Empenhos sem item de contrato vinculado"
        colunas={colunas}
        linhas={consulta.data}
        chave={(e) => e.empenho.id}
        atualizando={consulta.isFetching && consulta.data !== undefined}
        ordenacaoInicial={{ por: 'valor', ordem: 'desc' }}
        acoes={
          podeEditar
            ? {
                cabecalho: 'Ações',
                celula: (e) =>
                  e.itensCandidatos.length > 0 ? (
                    <Botao
                      variante="secundario"
                      tamanho="compacto"
                      icone={Link2}
                      onClick={() => abrir(e)}
                      aria-label={`Vincular a item — empenho ${e.empenho.numero}, contrato ${e.contrato.numero}`}
                    >
                      Vincular a item
                    </Botao>
                  ) : (
                    <span className="texto-pequeno texto-secundario">Sem itens candidatos</span>
                  ),
              }
            : undefined
        }
        vazio={
          <EstadoVazio
            icone={CircleCheck}
            titulo="Nenhum empenho sem item — tudo vinculado"
            descricao="Todos os empenhos de contratos indicam o item custeado."
          />
        }
      />
      <ConfirmarAcao
        aberto={alvo !== null}
        aoFechar={() => definirAlvo(null)}
        titulo="Vincular empenho a item do contrato"
        largura="media"
        descricao={
          alvo ? (
            <p>
              Escolha o item do <strong>contrato {alvo.contrato.numero}</strong> custeado pelo <strong>empenho {alvo.empenho.numero}</strong> (
              {formatarMoeda(alvo.empenho.valorEmpenhado)}). Atenção: este vínculo <strong>não tem desfazer automático</strong> (a API não
              oferece a operação inversa); uma correção posterior exige novo ajuste pela equipe de gestão.
            </p>
          ) : null
        }
        rotuloConfirmar="Vincular ao item"
        aoConfirmar={confirmar}
        processando={vincular.isPending}
        erro={vincular.error}
      >
        {alvo ? (
          <Selecao
            rotulo="Item do contrato"
            obrigatorio
            opcaoVazia="Selecione…"
            opcoes={alvo.itensCandidatos.map((i) => ({ valor: i.id, rotulo: `Item ${i.numero} — ${i.descricao}` }))}
            value={itemId}
            onChange={(e) => definirItemId(e.target.value)}
            erro={erroItem}
            data-foco-inicial
          />
        ) : null}
      </ConfirmarAcao>
    </div>
  );
}

export default function Vinculos() {
  const contratosSemAta = useContratosSemAta();
  const empenhosSemContrato = useEmpenhosSemContrato();
  const empenhosSemItem = useEmpenhosSemItem();

  return (
    <Pagina
      titulo="Vínculos"
      subtitulo="Ligações pendentes entre atas, contratos, empenhos e itens. Cada vínculo é confirmado por você e registrado na trilha de auditoria."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="vinculos"
    >
      <Abas
        rotulo="Tipos de vínculo pendente"
        abas={[
          {
            id: 'contratos-sem-ata',
            rotulo: 'Contratos sem ata',
            contador: contratosSemAta.data?.length ?? null,
            conteudo: () => <AbaContratosSemAta />,
          },
          {
            id: 'empenhos-sem-contrato',
            rotulo: 'Empenhos sem contrato',
            contador: empenhosSemContrato.data?.length ?? null,
            conteudo: () => <AbaEmpenhosSemContrato />,
          },
          {
            id: 'empenhos-sem-item',
            rotulo: 'Empenhos sem item',
            contador: empenhosSemItem.data?.length ?? null,
            conteudo: () => <AbaEmpenhosSemItem />,
          },
        ]}
      />
    </Pagina>
  );
}
