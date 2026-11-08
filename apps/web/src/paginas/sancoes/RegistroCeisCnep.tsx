import { useState, type FormEvent } from 'react';
import { Send, ShieldCheck } from 'lucide-react';
import type { RegistroSancaoCeisCnep } from '@agora/contratos';
import { formatarData, hojeISO, validarDataISO } from '@agora/dominio';
import { ErroApi, mensagemDeErro } from '../../api/cliente';
import { useRegistrarEnvioCeisCnep, useRegistrosCeisCnep } from '../../api/regularidade';
import {
  Alerta,
  AreaTexto,
  Botao,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  GrupoOpcoes,
  ListaDefinicoes,
  Secao,
  Tabela,
  useAvisos,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { TIPOS_SANCAO } from '../compartilhado/rotulos';

/**
 * Registro das sanções aplicadas no CEIS/CNEP (RN-24, art. 161). Não há API pública de escrita nesses cadastros:
 * a Ágora controla o prazo de 15 dias úteis, alerta e registra o protocolo do envio feito no sistema da CGU.
 */

const SITUACOES: Record<RegistroSancaoCeisCnep['situacao'], { rotulo: string; tom: TomEtiqueta }> = {
  pendente_vencida: { rotulo: 'Pendente, prazo vencido', tom: 'erro' },
  pendente_no_prazo: { rotulo: 'Pendente, no prazo', tom: 'aviso' },
  registrada_fora_do_prazo: { rotulo: 'Registrada fora do prazo', tom: 'alerta' },
  registrada_no_prazo: { rotulo: 'Registrada no prazo', tom: 'sucesso' },
};

const CADASTROS: readonly { valor: 'CEIS' | 'CNEP'; rotulo: string; ajuda: string }[] = [
  { valor: 'CEIS', rotulo: 'CEIS', ajuda: 'Cadastro Nacional de Empresas Inidôneas e Suspensas (impedimento e inidoneidade).' },
  { valor: 'CNEP', rotulo: 'CNEP', ajuda: 'Cadastro Nacional de Empresas Punidas (multas e demais sanções).' },
];

function DialogoEnvio({ registro, aoFechar }: { registro: RegistroSancaoCeisCnep | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarEnvioCeisCnep();
  const [cadastro, definirCadastro] = useState<'CEIS' | 'CNEP' | null>(null);
  const [protocolo, definirProtocolo] = useState('');
  const [enviadoEm, definirEnviadoEm] = useState('');
  const [observacao, definirObservacao] = useState('');
  const [erros, definirErros] = useState<{ cadastro?: string; protocolo?: string; enviadoEm?: string }>({});
  const idFormulario = 'formulario-envio-ceis-cnep';

  const fechar = () => {
    definirCadastro(null);
    definirProtocolo('');
    definirEnviadoEm('');
    definirObservacao('');
    definirErros({});
    registrar.reset();
    aoFechar();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!registro) return;
    const novos: typeof erros = {};
    if (!cadastro) novos.cadastro = 'Selecione o cadastro.';
    if (protocolo.trim().length < 3) novos.protocolo = 'Informe o protocolo do envio.';
    if (!validarDataISO(enviadoEm)) novos.enviadoEm = 'Informe a data do envio.';
    else if (enviadoEm < registro.sancao.aplicadaEm) novos.enviadoEm = 'O envio não pode ser anterior à aplicação da sanção.';
    else if (enviadoEm > hojeISO(new Date())) novos.enviadoEm = 'A data do envio não pode ser futura.';
    definirErros(novos);
    if (Object.keys(novos).length > 0 || !cadastro) return;
    registrar.mutate(
      { sancaoId: registro.sancao.id, entrada: { cadastro, protocolo: protocolo.trim(), enviadoEm, observacao: observacao.trim() || null } },
      {
        onSuccess: (r) => {
          avisar({ tipo: 'sucesso', titulo: 'Envio registrado', mensagem: `${r.fornecedor.razaoSocial}: ${r.mensagem}` });
          fechar();
        },
      },
    );
  };

  const erro = registrar.error;
  return (
    <Dialogo
      aberto={registro !== null}
      aoFechar={registrar.isPending ? () => undefined : fechar}
      titulo="Registrar envio ao CEIS/CNEP"
      largura="media"
      descricao={
        <p>
          O CEIS e o CNEP não têm API pública de escrita: informe a sanção no sistema da CGU e registre aqui o protocolo e a data do envio. A
          Ágora guarda quem informou e quando, na trilha de auditoria (Lei 14.133/2021, art. 161).
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar envio
          </Botao>
        </>
      }
    >
      {registro ? (
        <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
          <ListaDefinicoes
            colunas={2}
            itens={[
              { termo: 'Fornecedor', valor: registro.fornecedor.razaoSocial, largo: true },
              { termo: 'Sanção', valor: `${TIPOS_SANCAO[registro.sancao.tipo]} (art. 155, ${registro.sancao.incisoInfracao})` },
              { termo: 'Prazo de registro', valor: formatarData(registro.prazo) },
            ]}
          />
          <GrupoOpcoes legenda="Cadastro" nome="cadastro-ceis-cnep" obrigatorio opcoes={CADASTROS} valor={cadastro} aoMudar={definirCadastro} erro={erros.cadastro} horizontal />
          <div className="formulario__linha">
            <CampoTexto rotulo="Protocolo do envio" obrigatorio maxLength={120} value={protocolo} onChange={(e) => definirProtocolo(e.target.value)} erro={erros.protocolo} />
            <CampoTexto rotulo="Data do envio" type="date" obrigatorio value={enviadoEm} onChange={(e) => definirEnviadoEm(e.target.value)} erro={erros.enviadoEm} />
          </div>
          <AreaTexto rotulo="Observação" rows={2} maxLength={1000} value={observacao} onChange={(e) => definirObservacao(e.target.value)} />
          {erro ? (
            <Alerta tipo="erro" anunciar titulo="O envio não foi registrado">
              <p>{mensagemDeErro(erro)}</p>
              {erro instanceof ErroApi && erro.detalhes.length > 0 ? (
                <ul>
                  {erro.detalhes.map((d, i) => (
                    <li key={i}>{d.mensagem}</li>
                  ))}
                </ul>
              ) : null}
            </Alerta>
          ) : null}
        </form>
      ) : null}
    </Dialogo>
  );
}

export function RegistroCeisCnep() {
  const { temPermissao } = useSessao();
  const consulta = useRegistrosCeisCnep();
  const [alvo, definirAlvo] = useState<RegistroSancaoCeisCnep | null>(null);
  const podeRegistrar = temPermissao('sancoes:instruir');

  const colunas: ColunaTabela<RegistroSancaoCeisCnep>[] = [
    {
      id: 'fornecedor',
      cabecalho: 'Fornecedor',
      identificadora: true,
      fixa: true,
      celula: (r) => (
        <span className="pilha pilha--compacta">
          <span>{r.fornecedor.razaoSocial}</span>
          <span className="texto-pequeno texto-secundario mono">{r.fornecedor.documento}</span>
        </span>
      ),
    },
    {
      id: 'sancao',
      cabecalho: 'Sanção',
      prioritaria: true,
      celula: (r) => (
        <span className="pilha pilha--compacta">
          <span>{TIPOS_SANCAO[r.sancao.tipo]}</span>
          <span className="texto-pequeno texto-secundario">
            aplicada em {formatarData(r.sancao.aplicadaEm)}
            {r.sancao.contrato ? ` · contrato ${r.sancao.contrato.numero}` : ''}
          </span>
        </span>
      ),
    },
    { id: 'prazo', cabecalho: 'Prazo (15 dias úteis)', prioritaria: true, celula: (r) => <span className="numero">{formatarData(r.prazo)}</span> },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      prioritaria: true,
      celula: (r) => (
        <span className="pilha pilha--compacta">
          <Etiqueta tom={SITUACOES[r.situacao].tom} compacta>
            {SITUACOES[r.situacao].rotulo}
          </Etiqueta>
          <span className="texto-pequeno texto-secundario">{r.mensagem}</span>
        </span>
      ),
    },
    {
      id: 'envio',
      cabecalho: 'Envio',
      celula: (r) =>
        r.envio ? (
          <span className="pilha pilha--compacta texto-pequeno">
            <span>
              {r.envio.cadastro} · protocolo <span className="mono">{r.envio.protocolo}</span>
            </span>
            <span className="texto-secundario">
              {formatarData(r.envio.enviadoEm)}
              {r.envio.responsavel ? ` · informado por ${r.envio.responsavel.nome} em ${formatarInstante(r.envio.registradoEm)}` : ''}
            </span>
          </span>
        ) : r.situacao.startsWith('pendente') && podeRegistrar ? (
          <Botao
            variante="secundario"
            tamanho="compacto"
            icone={Send}
            aria-label={`Registrar envio ao CEIS/CNEP da sanção de ${r.fornecedor.razaoSocial}`}
            onClick={() => definirAlvo(r)}
          >
            Registrar envio
          </Botao>
        ) : (
          <span className="texto-pequeno texto-secundario">{r.situacao.startsWith('pendente') ? 'Aguardando envio' : 'Sem protocolo na Ágora'}</span>
        ),
    },
  ];

  return (
    <Secao
      titulo="Registro no CEIS/CNEP (art. 161)"
      id="registro-ceis-cnep"
      descricao={
        <p>
          Cada sanção aplicada deve ser informada ao CEIS e ao CNEP em até 15 dias úteis da aplicação. A Ágora calcula o prazo, alerta a
          partir de 5 dias úteis do vencimento e guarda o protocolo do envio feito no sistema da CGU (RN-24).
        </p>
      }
    >
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={3} />} rotuloCarregando="Carregando os registros no CEIS/CNEP">
        {(registros) => {
          const pendentes = registros.filter((r) => r.situacao.startsWith('pendente'));
          const vencidas = pendentes.filter((r) => r.situacao === 'pendente_vencida').length;
          const emAlerta = pendentes.filter((r) => r.alerta).length;
          return (
            <div className="pilha">
              {pendentes.length > 0 ? (
                <Alerta tipo={vencidas > 0 ? 'erro' : emAlerta > 0 ? 'aviso' : 'info'} titulo={`${pendentes.length} sanção(ões) aguardando registro no CEIS/CNEP`}>
                  <p>
                    {vencidas > 0 ? `${vencidas} com o prazo vencido. ` : ''}
                    Informe a sanção no sistema da CGU e registre o protocolo do envio.
                  </p>
                </Alerta>
              ) : null}
              <Tabela
                id="registro-ceis-cnep"
                legenda="Sanções aplicadas e o registro no CEIS/CNEP"
                colunas={colunas}
                linhas={registros}
                chave={(r) => r.sancao.id}
                semFerramentas
                destaque={(r) => (r.situacao === 'pendente_vencida' ? 'erro' : r.alerta ? 'aviso' : undefined)}
                vazio={<EstadoVazio icone={ShieldCheck} titulo="Nenhuma sanção aplicada" descricao="As sanções aplicadas aparecerão aqui com o prazo de registro no CEIS/CNEP." />}
              />
            </div>
          );
        }}
      </ConteudoConsulta>
      {podeRegistrar ? <DialogoEnvio registro={alvo} aoFechar={() => definirAlvo(null)} /> : null}
    </Secao>
  );
}
