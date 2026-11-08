import type { CodigoPerfil } from '@agora/contratos';

/** Senha única dos usuários de demonstração (só existem no ambiente 'demonstracao'). */
export const SENHA_DEMONSTRACAO = 'Agora@Demo2026';

export interface UsuarioDemonstracao {
  email: string;
  nome: string;
  perfil: CodigoPerfil;
  descricao: string;
  /** 'todas' ou quantidade de UASGs no escopo (as primeiras da lista sintética). */
  escopo: 'todas' | number;
}

/** Usuários de demonstração (ARQUITETURA §5). Nomes inventados. */
export const USUARIOS_DEMONSTRACAO: readonly UsuarioDemonstracao[] = [
  { email: 'admin@agora.demo', nome: 'Helena Prado Matos', perfil: 'administrador', descricao: 'Administra usuários, perfis, ajustes e integrações', escopo: 'todas' },
  { email: 'gestor@agora.demo', nome: 'Rafael Antunes Veloso', perfil: 'gestor_contratos', descricao: 'Gestor de contratos: pendências, vínculos e sanções', escopo: 'todas' },
  { email: 'fiscal@agora.demo', nome: 'Juliana Paiva Barreto', perfil: 'fiscal', descricao: 'Fiscal: tarefas do plano de gestão e atesto de notas', escopo: 6 },
  { email: 'financeiro@agora.demo', nome: 'Marcos Teles Coutinho', perfil: 'financeiro', descricao: 'Financeiro: empenhos, pagamentos e sincronizações', escopo: 'todas' },
  { email: 'planejamento@agora.demo', nome: 'Beatriz Lacerda Fontes', perfil: 'planejamento', descricao: 'Planejamento: DFD, ETP, riscos e pesquisa de preços', escopo: 'todas' },
  { email: 'agente@agora.demo', nome: 'Diego Moraes Albuquerque', perfil: 'agente_contratacao', descricao: 'Agente de contratação: seleção do fornecedor e publicação', escopo: 'todas' },
  { email: 'juridico@agora.demo', nome: 'Camila Rezende Toledo', perfil: 'juridico', descricao: 'Assessoria jurídica: controle prévio de legalidade', escopo: 'todas' },
  { email: 'auditor@agora.demo', nome: 'Paulo Henrique Siqueira', perfil: 'auditor', descricao: 'Auditor: trilha de auditoria e acessos a dados pessoais', escopo: 'todas' },
  { email: 'consulta@agora.demo', nome: 'Larissa Campos Ventura', perfil: 'consulta', descricao: 'Consulta somente leitura, restrita a 2 UASGs', escopo: 2 },
];

/**
 * Usuários de demonstração acrescentados depois da carga base. Cada etapa da carga cria os seus, com PRNG próprio,
 * para não alterar a sequência determinística dos dados já existentes. Aparecem na tela de entrada como os demais.
 */
export const USUARIOS_DEMONSTRACAO_ADICIONAIS: readonly UsuarioDemonstracao[] = [
  { email: 'controle@agora.demo', nome: 'Renata Quintela Duarte', perfil: 'controle_interno', descricao: 'Controle interno: linhas de defesa, TCU/CGU e matriz de riscos', escopo: 'todas' },
  { email: 'auditoria.externa@agora.demo', nome: 'Otávio Brandão Lessa', perfil: 'auditor', descricao: 'Auditor do controle externo (CGU/TCU): 3ª linha de defesa e relatório', escopo: 'todas' },
  { email: 'fiscal.tecnico@agora.demo', nome: 'Tiago Rangel Assunção', perfil: 'fiscal', descricao: 'Fiscal técnico: medições do IMR, conferência da nota fiscal e atesto', escopo: 'todas' },
  { email: 'cidadao@agora.demo', nome: 'Antônia Ribeiro Carvalho', perfil: 'cidadao', descricao: 'Cidadã identificada (gov.br, sem acesso interno): manifestações sobre contratos', escopo: 0 },
  { email: 'fiscal.obras@agora.demo', nome: 'Gilberto Nunes Farias', perfil: 'fiscal', descricao: 'Fiscal de obras e serviços: fotos e vídeos da execução para a sociedade', escopo: 'todas' },
];
