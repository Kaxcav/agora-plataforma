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
  'documentos:ler': 'Consultar documentos do processo',
  'documentos:enviar': 'Enviar documentos do processo',
  'documentos:analisar': 'Ler atestados com apoio da IA',
};

export const TODAS_PERMISSOES = Object.keys(NOMES_PERMISSOES).filter((p): p is Permissao => p in NOMES_PERMISSOES);
export const TODOS_PERFIS = Object.keys(NOMES_PERFIS).filter((p): p is CodigoPerfil => p in NOMES_PERFIS);
