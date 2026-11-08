/**
 * Catálogos 100% sintéticos da carga de demonstração: unidades, empresas, pessoas e objetos inventados,
 * com preços de referência plausíveis para contratações de segurança pública. Nenhum dado real.
 */

export interface UasgSintetica {
  codigo: string;
  nome: string;
  sigla: string;
  uf: string;
  orgao: string;
}

export const UASGS: readonly UasgSintetica[] = [
  { codigo: '910001', nome: 'Polícia Federal — Diretoria de Administração e Logística (demonstração)', sigla: 'DLOG/PF', uf: 'DF', orgao: 'Polícia Federal (demonstração)' },
  { codigo: '920001', nome: 'Polícia Rodoviária Federal — Coordenação-Geral de Administração (demonstração)', sigla: 'CGA/PRF', uf: 'DF', orgao: 'Polícia Rodoviária Federal (demonstração)' },
  { codigo: '910002', nome: 'Polícia Federal — Superintendência Regional no Amazonas (demonstração)', sigla: 'SR/PF/AM', uf: 'AM', orgao: 'Polícia Federal (demonstração)' },
  { codigo: '910003', nome: 'Polícia Federal — Instituto Nacional de Criminalística (demonstração)', sigla: 'INC/PF', uf: 'DF', orgao: 'Polícia Federal (demonstração)' },
  { codigo: '920002', nome: 'Polícia Rodoviária Federal — Superintendência no Paraná (demonstração)', sigla: 'SPRF/PR', uf: 'PR', orgao: 'Polícia Rodoviária Federal (demonstração)' },
  { codigo: '920003', nome: 'Polícia Rodoviária Federal — Superintendência no Pará (demonstração)', sigla: 'SPRF/PA', uf: 'PA', orgao: 'Polícia Rodoviária Federal (demonstração)' },
  { codigo: '930001', nome: 'Secretaria Nacional de Segurança Pública — Diretoria de Gestão (demonstração)', sigla: 'DG/SENASP', uf: 'DF', orgao: 'Secretaria Nacional de Segurança Pública (demonstração)' },
  { codigo: '930002', nome: 'Força Nacional de Segurança Pública — Coordenação de Logística (demonstração)', sigla: 'CLOG/FNSP', uf: 'DF', orgao: 'Secretaria Nacional de Segurança Pública (demonstração)' },
  { codigo: '940001', nome: 'Secretaria Nacional de Políticas Penais — Diretoria do Sistema Penitenciário Federal (demonstração)', sigla: 'DISPF', uf: 'DF', orgao: 'Secretaria Nacional de Políticas Penais (demonstração)' },
  { codigo: '940002', nome: 'Penitenciária Federal em Porto Velho (demonstração)', sigla: 'PFPV', uf: 'RO', orgao: 'Secretaria Nacional de Políticas Penais (demonstração)' },
  { codigo: '950001', nome: 'Ministério da Justiça e Segurança Pública — Coordenação-Geral de Logística (demonstração)', sigla: 'CGL/MJSP', uf: 'DF', orgao: 'Ministério da Justiça e Segurança Pública (demonstração)' },
  { codigo: '950002', nome: 'Ministério da Justiça e Segurança Pública — Diretoria de Tecnologia da Informação (demonstração)', sigla: 'DTI/MJSP', uf: 'DF', orgao: 'Ministério da Justiça e Segurança Pública (demonstração)' },
];

export const UNIDADES_INTERNAS: readonly { sigla: string; nome: string }[] = [
  { sigla: 'CGLIC', nome: 'Coordenação-Geral de Licitações e Contratos' },
  { sigla: 'COGEC', nome: 'Coordenação de Gestão de Contratos' },
  { sigla: 'COFIN', nome: 'Coordenação de Execução Orçamentária e Financeira' },
  { sigla: 'COPLAN', nome: 'Coordenação de Planejamento das Contratações' },
  { sigla: 'ASJUR', nome: 'Assessoria Jurídica' },
  { sigla: 'CGTI', nome: 'Coordenação-Geral de Tecnologia da Informação' },
  { sigla: 'COCIN', nome: 'Coordenação de Controle Interno' },
  { sigla: 'DIPAT', nome: 'Divisão de Logística e Patrimônio' },
];

export const GRUPOS_UASG: readonly { nome: string; uasgs: readonly string[]; confirmado: boolean }[] = [
  { nome: 'Compras compartilhadas PF/PRF — Sede (demonstração)', uasgs: ['910001', '920001', '910003'], confirmado: true },
  { nome: 'Sistema Penitenciário Federal (demonstração)', uasgs: ['940001', '940002'], confirmado: true },
  { nome: 'GTI Segurança Pública — Região Norte (demonstração)', uasgs: ['910002', '920003', '940002'], confirmado: false },
  { nome: 'GTI Segurança Pública — Região Sul e Centro (demonstração)', uasgs: ['920002', '930001', '930002'], confirmado: false },
];

export interface EmpresaSintetica {
  chave: string;
  razaoSocial: string;
  porte: 'ME' | 'EPP' | 'DEMAIS';
  uf: string;
  dominio: string;
}

export const EMPRESAS: readonly EmpresaSintetica[] = [
  { chave: 'escudo', razaoSocial: 'Escudo Forte Equipamentos de Proteção Ltda.', porte: 'DEMAIS', uf: 'SP', dominio: 'escudoforte.example' },
  { chave: 'vigilant', razaoSocial: 'Vigilant Comunicações Táticas S.A.', porte: 'DEMAIS', uf: 'SP', dominio: 'vigilant.example' },
  { chave: 'rota', razaoSocial: 'Rota Segura Veículos Especiais Ltda.', porte: 'DEMAIS', uf: 'MG', dominio: 'rotasegura.example' },
  { chave: 'lumen', razaoSocial: 'Lumen Forense Tecnologia Ltda.', porte: 'EPP', uf: 'DF', dominio: 'lumenforense.example' },
  { chave: 'aerovista', razaoSocial: 'Aerovista Drones e Sensores Ltda.', porte: 'EPP', uf: 'SC', dominio: 'aerovista.example' },
  { chave: 'guardiao', razaoSocial: 'Guardião Uniformes e Equipamentos Ltda.', porte: 'DEMAIS', uf: 'GO', dominio: 'guardiaouniformes.example' },
  { chave: 'calibre', razaoSocial: 'Calibre Sul Materiais de Treinamento Ltda.', porte: 'EPP', uf: 'RS', dominio: 'calibresul.example' },
  { chave: 'nortecom', razaoSocial: 'Nortecom Radiocomunicação Ltda.', porte: 'EPP', uf: 'PA', dominio: 'nortecom.example' },
  { chave: 'metropolitana', razaoSocial: 'Metropolitana Pneus e Peças Automotivas Ltda.', porte: 'DEMAIS', uf: 'PR', dominio: 'metropolitanapneus.example' },
  { chave: 'precisao', razaoSocial: 'Precisão Óptica Equipamentos Ltda.', porte: 'ME', uf: 'RJ', dominio: 'precisaooptica.example' },
  { chave: 'atlas', razaoSocial: 'Atlas Informática Robusta Ltda.', porte: 'DEMAIS', uf: 'SP', dominio: 'atlasrobusta.example' },
  { chave: 'sentinela', razaoSocial: 'Sentinela Câmeras Corporais S.A.', porte: 'DEMAIS', uf: 'SP', dominio: 'sentinelacam.example' },
  { chave: 'horizonte', razaoSocial: 'Horizonte Manutenção Veicular Ltda.', porte: 'EPP', uf: 'DF', dominio: 'horizontemanutencao.example' },
  { chave: 'planalto', razaoSocial: 'Planalto EPI e Segurança do Trabalho Ltda.', porte: 'ME', uf: 'DF', dominio: 'planaltoepi.example' },
  { chave: 'boreal', razaoSocial: 'Boreal Equipamentos Táticos Ltda.', porte: 'EPP', uf: 'SC', dominio: 'borealtatico.example' },
  { chave: 'cerrado', razaoSocial: 'Cerrado Soluções em Software Ltda.', porte: 'EPP', uf: 'GO', dominio: 'cerradosoftware.example' },
  { chave: 'delta', razaoSocial: 'Delta Perícia Laboratorial Ltda.', porte: 'ME', uf: 'MG', dominio: 'deltapericia.example' },
  { chave: 'fortaleza', razaoSocial: 'Fortaleza Blindagens Ltda.', porte: 'DEMAIS', uf: 'CE', dominio: 'fortalezablindagens.example' },
  { chave: 'ipe', razaoSocial: 'Ipê Mobiliário Corporativo Ltda.', porte: 'ME', uf: 'DF', dominio: 'ipemobiliario.example' },
  { chave: 'aria', razaoSocial: 'Ária Telecomunicações Ltda.', porte: 'DEMAIS', uf: 'RJ', dominio: 'ariatelecom.example' },
  { chave: 'baluarte', razaoSocial: 'Baluarte Cofres e Armários de Aço Ltda.', porte: 'EPP', uf: 'SP', dominio: 'baluartecofres.example' },
  { chave: 'mirante', razaoSocial: 'Mirante Sistemas de Videomonitoramento Ltda.', porte: 'EPP', uf: 'PR', dominio: 'mirantesistemas.example' },
  { chave: 'pampa', razaoSocial: 'Pampa Combustíveis e Lubrificantes Ltda.', porte: 'DEMAIS', uf: 'RS', dominio: 'pampacombustiveis.example' },
  { chave: 'amazonia', razaoSocial: 'Amazônia Logística Fluvial Ltda.', porte: 'ME', uf: 'AM', dominio: 'amazonialogistica.example' },
  { chave: 'tupa', razaoSocial: 'Tupã Kits de Atendimento Pré-Hospitalar Ltda.', porte: 'ME', uf: 'BA', dominio: 'tupakits.example' },
];

/** Pessoas físicas fornecedoras (nomes inventados). */
export const PESSOAS_FORNECEDORAS: readonly { chave: string; nome: string; uf: string }[] = [
  { chave: 'pf_instrutor', nome: 'Renato Siqueira Amaral', uf: 'DF' },
  { chave: 'pf_tradutora', nome: 'Luciana Prates Monteiro', uf: 'RJ' },
  { chave: 'pf_tecnico', nome: 'Sérgio Bastos Nogueira', uf: 'GO' },
  { chave: 'pf_consultora', nome: 'Patrícia Valente Rocha', uf: 'MG' },
  { chave: 'pf_piloto', nome: 'André Lemos Carvalho', uf: 'SC' },
];

export const PRENOMES: readonly string[] = [
  'Ana', 'Bruno', 'Carla', 'Daniel', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'Jorge',
  'Karina', 'Leonardo', 'Mariana', 'Nelson', 'Olívia', 'Pedro', 'Renata', 'Sandro', 'Tatiana', 'Vinícius',
];

export const SOBRENOMES: readonly string[] = [
  'Almeida', 'Barros', 'Cardoso', 'Duarte', 'Esteves', 'Freitas', 'Gusmão', 'Holanda', 'Lacerda', 'Macedo',
  'Nogueira', 'Pacheco', 'Queiroz', 'Rezende', 'Sampaio', 'Teixeira', 'Valadares', 'Xavier', 'Moreira', 'Fontana',
];

export interface ItemModelo {
  descricao: string;
  catmat: string | null;
  unidade: string;
  /** Preço unitário de referência em reais [mínimo, máximo]. */
  preco: readonly [number, number];
  /** Quantidade registrada [mínimo, máximo]. */
  quantidade: readonly [number, number];
  variantes?: readonly string[];
}

export interface ObjetoAta {
  objeto: string;
  natureza: string;
  fornecedores: readonly string[];
  itens: readonly ItemModelo[];
}

/** Objetos de atas de registro de preços (segurança pública). */
export const OBJETOS_ATA: readonly ObjetoAta[] = [
  {
    objeto: 'Registro de preços para aquisição de coletes balísticos nível III-A e capacetes balísticos',
    natureza: '449052',
    fornecedores: ['escudo', 'fortaleza', 'boreal'],
    itens: [
      { descricao: 'Colete balístico nível III-A, modelo masculino', catmat: '466421', unidade: 'unidade', preco: [2900, 3600], quantidade: [200, 800], variantes: ['tamanho P', 'tamanho M', 'tamanho G', 'tamanho GG'] },
      { descricao: 'Colete balístico nível III-A, modelo feminino', catmat: '466422', unidade: 'unidade', preco: [3000, 3800], quantidade: [80, 300], variantes: ['tamanho P', 'tamanho M', 'tamanho G'] },
      { descricao: 'Capacete balístico nível III-A com trilhos laterais', catmat: '466430', unidade: 'unidade', preco: [4200, 6800], quantidade: [50, 300] },
      { descricao: 'Placa balística nível III avulsa', catmat: '466431', unidade: 'unidade', preco: [1800, 2600], quantidade: [100, 400] },
      { descricao: 'Capa externa para colete balístico, cor preta', catmat: '466435', unidade: 'unidade', preco: [350, 520], quantidade: [200, 900] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de viaturas caracterizadas tipo SUV 4x4 e sedã',
    natureza: '449052',
    fornecedores: ['rota', 'fortaleza'],
    itens: [
      { descricao: 'Viatura SUV 4x4 caracterizada, motor diesel, com kit de segurança pública', catmat: '150820', unidade: 'unidade', preco: [320000, 420000], quantidade: [5, 40], variantes: ['lote Centro-Oeste', 'lote Norte', 'lote Sul'] },
      { descricao: 'Viatura sedã caracterizada para patrulhamento', catmat: '150821', unidade: 'unidade', preco: [180000, 240000], quantidade: [5, 30] },
      { descricao: 'Kit de sinalização visual e acústica (giroflex e sirene)', catmat: '150830', unidade: 'kit', preco: [8000, 14000], quantidade: [10, 60] },
      { descricao: 'Compartimento de presos em fibra para viatura', catmat: '150831', unidade: 'unidade', preco: [9000, 15000], quantidade: [10, 50] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de rádios transceptores digitais portáteis e móveis',
    natureza: '449052',
    fornecedores: ['vigilant', 'nortecom', 'aria'],
    itens: [
      { descricao: 'Rádio transceptor portátil digital padrão P25', catmat: '411220', unidade: 'unidade', preco: [9500, 17000], quantidade: [50, 400], variantes: ['faixa VHF', 'faixa UHF'] },
      { descricao: 'Rádio transceptor móvel veicular digital', catmat: '411221', unidade: 'unidade', preco: [12000, 21000], quantidade: [20, 150] },
      { descricao: 'Bateria de íons de lítio para rádio portátil', catmat: '411230', unidade: 'unidade', preco: [650, 980], quantidade: [100, 800] },
      { descricao: 'Carregador rápido multiposição para rádios', catmat: '411231', unidade: 'unidade', preco: [2100, 3400], quantidade: [20, 120] },
      { descricao: 'Microfone de lapela com PTT', catmat: '411232', unidade: 'unidade', preco: [480, 790], quantidade: [50, 400] },
    ],
  },
  {
    objeto: 'Registro de preços para licenças de software de extração e análise forense de dispositivos móveis',
    natureza: '339040',
    fornecedores: ['lumen', 'cerrado'],
    itens: [
      { descricao: 'Licença anual de software de extração forense de dispositivos móveis', catmat: null, unidade: 'licença', preco: [180000, 420000], quantidade: [2, 12] },
      { descricao: 'Licença anual de software de análise de dados extraídos', catmat: null, unidade: 'licença', preco: [90000, 210000], quantidade: [2, 15] },
      { descricao: 'Kit de cabos e adaptadores para extração forense', catmat: '420110', unidade: 'kit', preco: [12000, 24000], quantidade: [2, 20] },
      { descricao: 'Treinamento certificado em extração forense', catmat: null, unidade: 'participante', preco: [14000, 22000], quantidade: [5, 40] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de equipamentos de proteção individual para operações',
    natureza: '339030',
    fornecedores: ['guardiao', 'planalto', 'tupa'],
    itens: [
      { descricao: 'Luva tática com proteção de nós dos dedos', catmat: '257301', unidade: 'par', preco: [120, 210], quantidade: [1000, 5000], variantes: ['tamanho M', 'tamanho G'] },
      { descricao: 'Óculos de proteção balística', catmat: '257310', unidade: 'unidade', preco: [180, 340], quantidade: [500, 3000] },
      { descricao: 'Máscara de proteção respiratória com filtro', catmat: '257320', unidade: 'unidade', preco: [240, 480], quantidade: [300, 2000] },
      { descricao: 'Joelheira e cotoveleira táticas', catmat: '257330', unidade: 'par', preco: [150, 260], quantidade: [300, 2000] },
      { descricao: 'Protetor auricular eletrônico', catmat: '257340', unidade: 'unidade', preco: [690, 1250], quantidade: [100, 800] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de munição de treinamento e insumos para estande de tiro',
    natureza: '339030',
    fornecedores: ['calibre', 'boreal'],
    itens: [
      { descricao: 'Munição de treinamento calibre 9 mm, caixa com 50 unidades', catmat: '313101', unidade: 'caixa', preco: [240, 380], quantidade: [2000, 12000] },
      { descricao: 'Munição de treinamento calibre .40, caixa com 50 unidades', catmat: '313102', unidade: 'caixa', preco: [290, 430], quantidade: [1000, 8000] },
      { descricao: 'Alvo de papel para tiro, pacote com 100 unidades', catmat: '313120', unidade: 'pacote', preco: [90, 160], quantidade: [200, 1500] },
      { descricao: 'Protetor auricular tipo concha para estande', catmat: '313130', unidade: 'unidade', preco: [85, 150], quantidade: [200, 1000] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de drones multirrotores com câmera térmica',
    natureza: '449052',
    fornecedores: ['aerovista', 'pf_piloto'],
    itens: [
      { descricao: 'Aeronave remotamente pilotada multirrotor com câmera térmica radiométrica', catmat: '481901', unidade: 'unidade', preco: [68000, 145000], quantidade: [3, 20], variantes: ['autonomia de 40 min', 'autonomia de 55 min'] },
      { descricao: 'Bateria inteligente sobressalente para drone', catmat: '481910', unidade: 'unidade', preco: [2800, 4900], quantidade: [10, 80] },
      { descricao: 'Estação de controle em solo com tela de alto brilho', catmat: '481920', unidade: 'unidade', preco: [14000, 26000], quantidade: [3, 20] },
      { descricao: 'Curso de pilotagem remota de aeronaves', catmat: null, unidade: 'participante', preco: [3200, 5400], quantidade: [10, 60] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de câmeras corporais e armazenamento de evidências digitais',
    natureza: '449052',
    fornecedores: ['sentinela', 'mirante'],
    itens: [
      { descricao: 'Câmera corporal com gravação contínua e GPS', catmat: '470301', unidade: 'unidade', preco: [3900, 6900], quantidade: [100, 1500] },
      { descricao: 'Estação de acoplamento e carga para 8 câmeras', catmat: '470310', unidade: 'unidade', preco: [7800, 12400], quantidade: [10, 120] },
      { descricao: 'Serviço de armazenamento de evidências digitais por câmera', catmat: null, unidade: 'câmera/mês', preco: [90, 160], quantidade: [1200, 18000] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de notebooks e tablets robustos para uso em campo',
    natureza: '449052',
    fornecedores: ['atlas'],
    itens: [
      { descricao: 'Notebook robusto (rugged) com tela de 14 polegadas', catmat: '451101', unidade: 'unidade', preco: [19000, 31000], quantidade: [20, 200] },
      { descricao: 'Tablet robusto com leitor biométrico', catmat: '451110', unidade: 'unidade', preco: [8900, 14500], quantidade: [20, 300] },
      { descricao: 'Base veicular para notebook robusto', catmat: '451120', unidade: 'unidade', preco: [3900, 6800], quantidade: [20, 200] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de uniformes operacionais',
    natureza: '339030',
    fornecedores: ['guardiao', 'planalto'],
    itens: [
      { descricao: 'Conjunto de uniforme operacional rip-stop (calça e gandola)', catmat: '230501', unidade: 'conjunto', preco: [380, 690], quantidade: [1000, 8000], variantes: ['tamanho P', 'tamanho M', 'tamanho G', 'tamanho GG'] },
      { descricao: 'Coturno tático cano alto', catmat: '230510', unidade: 'par', preco: [390, 720], quantidade: [500, 4000], variantes: ['numeração 38 a 41', 'numeração 42 a 45'] },
      { descricao: 'Boné operacional bordado', catmat: '230520', unidade: 'unidade', preco: [45, 90], quantidade: [1000, 6000] },
      { descricao: 'Cinto de guarnição em nylon', catmat: '230530', unidade: 'unidade', preco: [110, 210], quantidade: [500, 4000] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de pneus para viaturas',
    natureza: '339030',
    fornecedores: ['metropolitana'],
    itens: [
      { descricao: 'Pneu 265/65 R17 para viatura SUV', catmat: '150401', unidade: 'unidade', preco: [1150, 1750], quantidade: [200, 1200] },
      { descricao: 'Pneu 205/55 R16 para viatura sedã', catmat: '150402', unidade: 'unidade', preco: [520, 890], quantidade: [200, 1200] },
      { descricao: 'Pneu para motocicleta 110/80 R19', catmat: '150403', unidade: 'unidade', preco: [480, 760], quantidade: [50, 400] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de algemas, coldres e equipamentos táticos',
    natureza: '339030',
    fornecedores: ['boreal', 'escudo'],
    itens: [
      { descricao: 'Algema de aço inoxidável com trava dupla', catmat: '466501', unidade: 'unidade', preco: [160, 340], quantidade: [300, 2500] },
      { descricao: 'Coldre de cintura com retenção nível III', catmat: '466510', unidade: 'unidade', preco: [420, 780], quantidade: [200, 2000], variantes: ['destro', 'canhoto'] },
      { descricao: 'Lanterna tática recarregável de 1.000 lúmens', catmat: '466520', unidade: 'unidade', preco: [290, 620], quantidade: [300, 2500] },
      { descricao: 'Bastão tubular retrátil', catmat: '466530', unidade: 'unidade', preco: [190, 360], quantidade: [200, 1500] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de equipamentos de visão noturna e observação',
    natureza: '449052',
    fornecedores: ['precisao'],
    itens: [
      { descricao: 'Monóculo de visão noturna geração III', catmat: '470901', unidade: 'unidade', preco: [28000, 46000], quantidade: [10, 60] },
      { descricao: 'Binóculo com telêmetro laser', catmat: '470910', unidade: 'unidade', preco: [6800, 12900], quantidade: [10, 80] },
    ],
  },
  {
    objeto: 'Registro de preços para aquisição de kits de atendimento pré-hospitalar tático',
    natureza: '339030',
    fornecedores: ['tupa', 'planalto'],
    itens: [
      { descricao: 'Kit individual de primeiros socorros (IFAK)', catmat: '268801', unidade: 'kit', preco: [420, 780], quantidade: [300, 2500] },
      { descricao: 'Torniquete tático', catmat: '268810', unidade: 'unidade', preco: [120, 230], quantidade: [500, 4000] },
      { descricao: 'Bandagem israelense de 6 polegadas', catmat: '268820', unidade: 'unidade', preco: [35, 70], quantidade: [1000, 8000] },
      { descricao: 'Maca dobrável tática', catmat: '268830', unidade: 'unidade', preco: [1400, 2600], quantidade: [20, 200] },
    ],
  },
];

export interface ObjetoContratoDireto {
  objeto: string;
  natureza: string;
  fornecedor: string;
  origem: 'licitacao' | 'contratacao_direta';
  modalidade: string;
  servico: boolean;
  itens: readonly ItemModelo[];
}

/** Contratos sem ata: serviços continuados, contratações diretas e licitações próprias. */
export const OBJETOS_CONTRATO: readonly ObjetoContratoDireto[] = [
  {
    objeto: 'Prestação de serviços de manutenção preventiva e corretiva da frota de viaturas',
    natureza: '339039', fornecedor: 'horizonte', origem: 'licitacao', modalidade: 'Pregão eletrônico', servico: true,
    itens: [
      { descricao: 'Hora de serviço de mecânica, elétrica e funilaria', catmat: null, unidade: 'hora', preco: [140, 240], quantidade: [2000, 8000] },
      { descricao: 'Fornecimento de peças com desconto sobre tabela do fabricante', catmat: null, unidade: 'mês', preco: [18000, 42000], quantidade: [12, 24] },
    ],
  },
  {
    objeto: 'Fornecimento de combustível com gerenciamento por cartão magnético',
    natureza: '339030', fornecedor: 'pampa', origem: 'licitacao', modalidade: 'Pregão eletrônico', servico: true,
    itens: [
      { descricao: 'Óleo diesel S10', catmat: '410101', unidade: 'litro', preco: [5.6, 6.4], quantidade: [80000, 300000] },
      { descricao: 'Gasolina comum', catmat: '410102', unidade: 'litro', preco: [5.8, 6.6], quantidade: [40000, 200000] },
    ],
  },
  {
    objeto: 'Prestação de serviço de comunicação satelital para unidades remotas',
    natureza: '339040', fornecedor: 'aria', origem: 'licitacao', modalidade: 'Pregão eletrônico', servico: true,
    itens: [{ descricao: 'Link satelital de 20 Mbps com antena e instalação', catmat: null, unidade: 'ponto/mês', preco: [2800, 4600], quantidade: [120, 600] }],
  },
  {
    objeto: 'Curso de capacitação em tiro defensivo para servidores',
    natureza: '339036', fornecedor: 'pf_instrutor', origem: 'contratacao_direta', modalidade: 'Inexigibilidade (art. 74, III)', servico: true,
    itens: [{ descricao: 'Turma de 20 alunos com 40 horas-aula', catmat: null, unidade: 'turma', preco: [9800, 14800], quantidade: [2, 6] }],
  },
  {
    objeto: 'Tradução juramentada de documentos de cooperação internacional',
    natureza: '339036', fornecedor: 'pf_tradutora', origem: 'contratacao_direta', modalidade: 'Dispensa por valor (art. 75, II)', servico: true,
    itens: [{ descricao: 'Lauda traduzida (inglês e espanhol)', catmat: null, unidade: 'lauda', preco: [70, 110], quantidade: [200, 500] }],
  },
  {
    objeto: 'Manutenção corretiva de equipamentos de inspeção por raios X',
    natureza: '339036', fornecedor: 'pf_tecnico', origem: 'contratacao_direta', modalidade: 'Dispensa por valor (art. 75, II)', servico: true,
    itens: [{ descricao: 'Visita técnica com diagnóstico e reparo', catmat: null, unidade: 'visita', preco: [1800, 3200], quantidade: [6, 15] }],
  },
  {
    objeto: 'Consultoria para validação de métodos de laboratório de perícia criminal',
    natureza: '339036', fornecedor: 'pf_consultora', origem: 'contratacao_direta', modalidade: 'Inexigibilidade (art. 74, III)', servico: true,
    itens: [{ descricao: 'Relatório de validação de método analítico', catmat: null, unidade: 'relatório', preco: [6500, 9800], quantidade: [3, 8] }],
  },
  {
    objeto: 'Locação de mobiliário para unidade descentralizada',
    natureza: '339039', fornecedor: 'ipe', origem: 'contratacao_direta', modalidade: 'Dispensa por valor (art. 75, II)', servico: true,
    itens: [{ descricao: 'Estação de trabalho com cadeira ergonômica', catmat: null, unidade: 'posto/mês', preco: [180, 290], quantidade: [120, 300] }],
  },
  {
    objeto: 'Aquisição de cofres e armários de aço para guarda de armamento',
    natureza: '449052', fornecedor: 'baluarte', origem: 'licitacao', modalidade: 'Pregão eletrônico', servico: false,
    itens: [
      { descricao: 'Armário de aço para 20 armas longas com fechadura eletrônica', catmat: '255101', unidade: 'unidade', preco: [9800, 16500], quantidade: [10, 60] },
      { descricao: 'Cofre de aço classe B para munição', catmat: '255110', unidade: 'unidade', preco: [6200, 11800], quantidade: [10, 40] },
    ],
  },
  {
    objeto: 'Transporte fluvial de equipes em operações na Região Norte',
    natureza: '339039', fornecedor: 'amazonia', origem: 'licitacao', modalidade: 'Pregão eletrônico', servico: true,
    itens: [{ descricao: 'Diária de embarcação com tripulação para 12 passageiros', catmat: null, unidade: 'diária', preco: [3800, 6400], quantidade: [60, 240] }],
  },
  {
    objeto: 'Aquisição de reagentes e kits para laboratório de perícia criminal',
    natureza: '339030', fornecedor: 'delta', origem: 'licitacao', modalidade: 'Pregão eletrônico', servico: false,
    itens: [
      { descricao: 'Kit de quantificação de DNA humano', catmat: '432101', unidade: 'kit', preco: [7200, 12800], quantidade: [10, 60] },
      { descricao: 'Reagente para identificação de drogas sintéticas', catmat: '432110', unidade: 'frasco', preco: [380, 720], quantidade: [50, 300] },
    ],
  },
  {
    objeto: 'Instalação de sistema de videomonitoramento em postos de fiscalização',
    natureza: '449052', fornecedor: 'mirante', origem: 'licitacao', modalidade: 'Concorrência eletrônica', servico: false,
    itens: [
      { descricao: 'Câmera IP com leitura automática de placas', catmat: '470501', unidade: 'unidade', preco: [14500, 23800], quantidade: [10, 60] },
      { descricao: 'Servidor de gravação com 64 TB', catmat: '470510', unidade: 'unidade', preco: [68000, 112000], quantidade: [1, 6] },
    ],
  },
];

export interface ModeloGestaoSintetico {
  tipo: 'ata' | 'contrato';
  nome: string;
  evento: 'assinatura' | 'inicio_vigencia' | 'mensal' | 'reajuste' | 'fim_vigencia';
  ativo: boolean;
  tarefas: readonly { titulo: string; macrotarefa: string; diasRelativos: number; papel: 'gestor' | 'fiscal' | 'financeiro' }[];
}

export const MODELOS_GESTAO: readonly ModeloGestaoSintetico[] = [
  {
    tipo: 'contrato', nome: 'Plano de gestão — assinatura do contrato', evento: 'assinatura', ativo: true,
    tarefas: [
      { titulo: 'Publicar o extrato e divulgar o contrato no PNCP (art. 94)', macrotarefa: 'Assinatura', diasRelativos: 5, papel: 'gestor' },
      { titulo: 'Emitir portaria de designação do gestor e dos fiscais', macrotarefa: 'Assinatura', diasRelativos: 3, papel: 'gestor' },
      { titulo: 'Conferir a garantia contratual apresentada (art. 96)', macrotarefa: 'Assinatura', diasRelativos: 10, papel: 'gestor' },
      { titulo: 'Realizar reunião inicial com o preposto do fornecedor', macrotarefa: 'Assinatura', diasRelativos: 15, papel: 'fiscal' },
    ],
  },
  {
    tipo: 'contrato', nome: 'Fiscalização mensal da execução', evento: 'mensal', ativo: true,
    tarefas: [
      { titulo: 'Registrar o relatório mensal de fiscalização', macrotarefa: 'Fiscalização mensal', diasRelativos: 5, papel: 'fiscal' },
      { titulo: 'Conferir a nota fiscal e a regularidade fiscal antes do atesto', macrotarefa: 'Fiscalização mensal', diasRelativos: 8, papel: 'financeiro' },
    ],
  },
  {
    tipo: 'contrato', nome: 'Encerramento ou prorrogação', evento: 'fim_vigencia', ativo: true,
    tarefas: [
      { titulo: 'Avaliar a vantajosidade da prorrogação', macrotarefa: 'Fim de vigência', diasRelativos: -120, papel: 'gestor' },
      { titulo: 'Consultar a regularidade do fornecedor e o CEIS/CNEP (art. 91, § 4º)', macrotarefa: 'Fim de vigência', diasRelativos: -90, papel: 'gestor' },
      { titulo: 'Emitir o termo de recebimento definitivo', macrotarefa: 'Fim de vigência', diasRelativos: 10, papel: 'fiscal' },
    ],
  },
  {
    tipo: 'contrato', nome: 'Reajuste anual por índice', evento: 'reajuste', ativo: false,
    tarefas: [{ titulo: 'Calcular o reajuste pelo índice contratual e apostilar', macrotarefa: 'Reajuste', diasRelativos: 0, papel: 'gestor' }],
  },
  {
    tipo: 'ata', nome: 'Plano de gestão — assinatura da ata', evento: 'assinatura', ativo: true,
    tarefas: [
      { titulo: 'Divulgar a ata no PNCP e no sítio oficial', macrotarefa: 'Assinatura', diasRelativos: 5, papel: 'gestor' },
      { titulo: 'Comunicar os órgãos participantes sobre os quantitativos', macrotarefa: 'Assinatura', diasRelativos: 10, papel: 'gestor' },
    ],
  },
  {
    tipo: 'ata', nome: 'Acompanhamento da vigência da ata', evento: 'fim_vigencia', ativo: true,
    tarefas: [
      { titulo: 'Avaliar a prorrogação da ata por igual período (art. 84)', macrotarefa: 'Fim de vigência', diasRelativos: -90, papel: 'gestor' },
      { titulo: 'Planejar a nova licitação para itens com saldo esgotado', macrotarefa: 'Fim de vigência', diasRelativos: -60, papel: 'gestor' },
    ],
  },
];
