# Manual Digital de Defeitos

Aplicação web inicial funcional para cadastro e consulta de defeitos por módulo, com autenticação, papéis de usuário, busca/filtros, fotos, histórico de revisões e trilha de auditoria.

## Requisitos
- Node.js 20 ou superior e npm.
- Para disponibilizar na rede/Internet: servidor com armazenamento persistente, HTTPS e configuração de segurança operacional.

## Instalação local
1. Descompacte o projeto.
2. Abra um terminal nesta pasta.
3. Instale dependências: `npm install`
4. Configure variáveis de ambiente antes do primeiro início:
   - Linux/macOS:
     ```bash
     export ADMIN_USER=admin
     export ADMIN_PASSWORD='uma-senha-forte-com-mais-de-10-caracteres'
     export SESSION_SECRET="$(openssl rand -hex 32)"
     export DATA_DIR="$PWD/data"
     ```
   - PowerShell:
     ```powershell
     $env:ADMIN_USER="admin"
     $env:ADMIN_PASSWORD="uma-senha-forte-com-mais-de-10-caracteres"
     $env:SESSION_SECRET="substitua-por-segredo-aleatorio-longo"
     $env:DATA_DIR="$PWD\data"
     ```
5. Inicie: `npm start`
6. Acesse `http://localhost:3000`. Entre com a conta indicada em `ADMIN_USER` e `ADMIN_PASSWORD`.
7. Crie as demais contas pela aba **Usuários**. O sistema não cria contas públicas nem permite autorregistro.

## Publicação online
1. Use um host Node.js que suporte processos persistentes e disco persistente. Configure as variáveis de ambiente no painel do host; nunca envie senhas/segredos ao Git.
2. Configure `DATA_DIR` para um volume persistente com acesso restrito e espaço dimensionado para banco e fotos.
3. Coloque a aplicação atrás de um proxy reverso com TLS/HTTPS. Em produção, configure corretamente o proxy e `NODE_ENV=production`, para que o cookie de sessão seja `Secure`.
4. Troque as credenciais de exemplo por valores fortes. O primeiro usuário administrador só é criado se `ADMIN_USER` ainda não existir no banco.
5. Faça backup periódico de todo o diretório de dados (`manual.db`, arquivos WAL quando houver e `uploads/`) usando procedimento consistente com SQLite. Teste a restauração.
6. Restrinja acesso de rede, aplique atualizações, monitore logs e defina política de retenção e recuperação de desastre.
7. Para equipes maiores ou alta disponibilidade, migre SQLite e sessões em memória para PostgreSQL e armazenamento de objetos/serviço de sessões. A sessão padrão em memória é apropriada apenas para instalação pequena/teste e reinicia ao reiniciar o processo.

## Papéis
- **Administrador**: cadastrar/editar/publicar/arquivar defeitos, gerir usuários, consultar auditoria.
- **Editor**: cadastrar e editar defeitos e anexar fotos; não pode alterar papéis ou gerir contas.
- **Visualizador**: consultar e pesquisar registros.

## Módulos iniciais
SMT, AOI, Manual de aceitação, Soldagem, Repair Center.

## Funcionalidades
- Busca em código, título, descrição e texto de critério.
- Filtros por módulo, classificação e estado.
- Upload de até 8 imagens por requisição, cada uma até 5 MB; JPG, PNG, WEBP e GIF.
- Revisão numerada e snapshot dos dados a cada criação/edição.
- Auditoria das ações mais relevantes; consulta dos últimos 300 eventos pelo administrador.
- Registros novos iniciam como rascunho. Publicação é decisão explícita do usuário autorizado.
- Interface em português, responsiva.

## Critérios técnicos e normativos
O banco inicia vazio. Não há defeitos, classificações técnicas nem critérios de aceitação normativos pré-carregados. A aplicação não determina se uma solda, componente ou placa está conforme. A equipe autorizada deve inserir os critérios aprovados, sua fonte documental, revisão e seção; recomenda-se validação/aprovação formal fora do sistema antes da publicação. O campo “Critério aprovado / referência” é texto livre e não constitui assinatura eletrônica nem workflow formal de aprovação.

## Limites e pontos a reforçar antes de produção
- **Armazenamento**: o banco SQLite cresce conforme registros/revisões/auditoria; as imagens ocupam até 40 MB por requisição de upload (8 × 5 MB), sem cota global por usuário. O limite prático é o disco do servidor. Monitore e defina cotas/retensão.
- **Fotos**: validação de MIME e extensão é básica; antes de uso crítico, adicione inspeção real do conteúdo, antivírus, limites globais e política de remoção.
- **Usuários/permissões**: autenticação local e papéis básicos; sem SSO/LDAP/AD, MFA, recuperação de senha ou integração com RH.
- **Sessões**: o armazenamento padrão é em memória; reinícios encerram sessões e múltiplas instâncias não compartilham sessões. Use store persistente/Redis em produção escalável.
- **Banco**: SQLite atende protótipo/equipe pequena em uma instância. Não é ideal para múltiplas instâncias ou alta concorrência; considere PostgreSQL para escalar.
- **Integrações**: não há integração pronta com ERP, MES, PLM, QMS, SharePoint, e-mail ou sistemas de chão de fábrica. Seriam necessários contratos de API, mapeamento de dados, autenticação e homologação.
- **Auditoria**: trilha básica de eventos, limitada aos últimos 300 eventos exibidos na interface; sem exportação, assinatura digital ou garantia de imutabilidade. Proteja backups e logs.
- **Revisão/aprovação**: histórico é registrado, mas não há workflow de revisão por pares, aprovação em duas etapas, assinatura eletrônica ou bloqueio por revisão documental.
- **Segurança**: antes de publicar na Internet, faça avaliação de segurança, CSRF hardening conforme arquitetura, rate limiting, política de senha, rotação de segredo, monitoramento, backups e teste de restauração. Não exponha o serviço diretamente sem HTTPS/proxy.
- **Acessibilidade/idiomas**: interface básica em português; requer teste formal de acessibilidade e eventual internacionalização.
- **Escopo**: é um ponto de partida executável, não uma solução certificada nem substituto de procedimento de qualidade, engenharia ou norma aplicável.

## API principal
- `POST /api/login`, `POST /api/logout`, `GET /api/me`
- `GET /api/defects` com parâmetros opcionais `q`, `module`, `classification`, `status`
- `GET /api/defects/:id`, `POST /api/defects`, `PUT /api/defects/:id`
- `POST /api/defects/:id/photos`, `DELETE /api/photos/:id`
- `GET /api/defects/:id/revisions/:revision`
- `GET/POST /api/users`, `PATCH /api/users/:id` (admin)
- `GET /api/audit` (admin)

## Banco de dados
Na primeira inicialização, o sistema cria `data/manual.db` e `data/uploads/`. Mantenha esse diretório persistente e restrito. Não apague o banco para “atualizar” a aplicação.
