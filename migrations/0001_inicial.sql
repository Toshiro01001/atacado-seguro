-- Atacado Seguro: esquema. Dados fictícios. Nenhum segredo neste arquivo.
CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  papel TEXT NOT NULL CHECK (papel IN ('cliente','gestor')),
  salt TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  iteracoes INTEGER NOT NULL,
  com_pimenta INTEGER NOT NULL DEFAULT 0,
  documento_cifrado TEXT,
  telefone_cifrado TEXT,
  demo INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE sessoes (
  token_hash TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expira_em INTEGER NOT NULL
);
CREATE INDEX idx_sessoes_expira ON sessoes(expira_em);
CREATE TABLE produtos (
  id INTEGER PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  unidade TEXT NOT NULL,
  preco_centavos INTEGER NOT NULL CHECK (preco_centavos > 0),
  estoque INTEGER NOT NULL CHECK (estoque >= 0),
  estoque_inicial INTEGER NOT NULL
);
CREATE TABLE pedidos (
  id INTEGER PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  total_centavos INTEGER NOT NULL,
  situacao TEXT NOT NULL DEFAULT 'recebido' CHECK (situacao IN ('recebido','separando','enviado','cancelado')),
  criado_em INTEGER NOT NULL
);
CREATE INDEX idx_pedidos_usuario ON pedidos(usuario_id);
CREATE TABLE itens_pedido (
  pedido_id INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  produto_id INTEGER NOT NULL REFERENCES produtos(id),
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  preco_centavos INTEGER NOT NULL,
  PRIMARY KEY (pedido_id, produto_id)
);
CREATE TABLE registro_acesso (
  id INTEGER PRIMARY KEY,
  quando INTEGER NOT NULL,
  usuario_id INTEGER,
  acao TEXT NOT NULL,
  resultado TEXT NOT NULL,
  alvo TEXT,
  origem_hash TEXT
);
CREATE INDEX idx_registro_quando ON registro_acesso(quando);
CREATE INDEX idx_registro_origem ON registro_acesso(origem_hash, acao, quando);

INSERT INTO produtos (codigo, nome, unidade, preco_centavos, estoque, estoque_inicial) VALUES
 ('ALI-001','Arroz branco tipo 1','fardo 30 kg',16490,200,200),
 ('ALI-002','Feijão carioca','fardo 30 kg',21800,120,120),
 ('ALI-003','Óleo de soja','caixa 20 un',15290,90,90),
 ('LIM-001','Detergente neutro','caixa 24 un',4190,300,300),
 ('LIM-002','Água sanitária','caixa 12 un',3650,150,150),
 ('ESC-001','Papel sulfite A4','caixa 10 resmas',27900,60,60),
 ('ELE-001','Fio elétrico 2,5 mm','rolo 100 m',18990,40,40),
 ('ELE-002','Lâmpada LED 9 W','caixa 50 un',22450,5,5);
