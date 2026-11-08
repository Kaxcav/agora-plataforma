import type { CodigoPerfil, Permissao, UsuarioSessao } from '@agora/contratos';

/** Uma permissão ou uma lista em que basta ter qualquer uma. */
export type RequisitoPermissao = Permissao | readonly Permissao[];

/**
 * O cliente só ESCONDE o que o servidor já negaria: a autorização real é decidida na API (RBAC + UASG).
 */
export function possuiPermissao(usuario: UsuarioSessao | null | undefined, requisito: RequisitoPermissao | undefined): boolean {
  if (requisito === undefined) return true;
  if (!usuario) return false;
  const lista: readonly Permissao[] = typeof requisito === 'string' ? [requisito] : requisito;
  return lista.some((p) => usuario.permissoes.includes(p));
}

export const NOMES_PERFIS: Record<CodigoPerfil, string> = {
  administrador: 'Administrador',
  gestor_contratos: 'Gestor de contratos',
  fiscal: 'Fiscal de contrato',
  financeiro: 'Financeiro',
  planejamento: 'Planejamento',
  agente_contratacao: 'Agente de contratação',
  juridico: 'Jurídico',
  auditor: 'Auditor',
  consulta: 'Consulta',
  controle_interno: 'Controle interno',
};

export const NOMES_PERMISSOES: Record<Permissao, string> = {
  'painel:ler': 'Ver o painel',
  'pendencias:resolver': 'Resolver pendências',
  'atas:ler': 'Consultar atas',
  'atas:editar': 'Editar atas',
  'contratos:ler': 'Consultar contratos',
  'contratos:editar': 'Editar contratos',
  'itens:ler': 'Consultar itens',
  'empenhos:ler': 'Consultar empenhos',
  'pagamentos:ler': 'Consultar pagamentos',
  'pagamentos:atestar': 'Atestar pagamentos',
  'vinculos:editar': 'Editar vínculos',
  'tarefas:editar': 'Atualizar tarefas do plano de gestão',
  'ajustes:editar': 'Editar ajustes',
  'fornecedores:ler': 'Consultar fornecedores',
  'sancoes:ler': 'Consultar sanções',
  'sancoes:instruir': 'Instruir processos sancionatórios',
  'jornada:ler': 'Consultar a jornada da contratação',
  'jornada:editar': 'Editar processos da jornada',
  'jornada:aprovar_juridico': 'Emitir parecer jurídico',
  'jornada:publicar': 'Publicar no PNCP e DOU',
  'integracoes:executar': 'Executar sincronizações',
  'admin:usuarios': 'Administrar usuários',
  'auditoria:ler': 'Consultar a trilha de auditoria',
  'lgpd:revelar': 'Revelar dado pessoal (com finalidade)',
  'lgpd:relatorio': 'Relatório de acessos a dados pessoais',
  'notificacoes:ler': 'Consultar a central de notificações',
  'notificacoes:enviar': 'Disparar e reenviar notificações',
  'notificacoes:administrar': 'Executar a varredura de notificações',
  'disputa:conduzir': 'Conduzir a sala de disputa',
  'controle:primeira_linha': 'Painel da 1ª linha de defesa',
  'controle:segunda_linha': 'Painel da 2ª linha de defesa',
  'controle:terceira_linha': 'Painel da 3ª linha de defesa e relatório de auditoria',
  'controle_externo:ler': 'Consultar medidas do controle externo',
  'controle_externo:registrar': 'Registrar medidas do controle externo e respostas',
  'riscos:revisar': 'Revisar a matriz de riscos dos contratos',
  'jornada:homologar': 'Decidir recursos, adjudicar e homologar (autoridade competente designada)',
  'certidoes:registrar': 'Registrar certidões de regularidade',
  'regularidade:consultar': 'Consultar o CEIS e o CNEP',
  'documentos:ler': 'Consultar documentos do processo',
  'documentos:enviar': 'Enviar documentos do processo',
  'documentos:analisar': 'Ler atestados com apoio da IA',
  'impedimentos:ler': 'Consultar vínculos, impedimentos e extensões de sanção',
  'impedimentos:registrar': 'Registrar vínculos com evidência e consultar o quadro societário',
  'impedimentos:parecer': 'Emitir a análise jurídica da extensão de sanção',
  'impedimentos:decidir': 'Decidir a extensão de sanção (autoridade competente)',
  'agentes:declarar': 'Assinar a própria declaração de inexistência de impedimento',
  'imr:configurar': 'Configurar o IMR dos contratos (indicadores, metas e faixas de glosa)',
  'imr:medir': 'Registrar as medições do IMR, com evidência',
  'pagamentos:conferir': 'Conferir a nota fiscal e justificar divergências',
};

export const TODAS_PERMISSOES = Object.keys(NOMES_PERMISSOES).filter((p): p is Permissao => p in NOMES_PERMISSOES);
export const TODOS_PERFIS = Object.keys(NOMES_PERFIS).filter((p): p is CodigoPerfil => p in NOMES_PERFIS);
