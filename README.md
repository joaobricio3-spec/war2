# War2

Motor open source de conquista territorial, cliente web **sem cap de FPS** (`requestAnimationFrame` / PixiJS) e salas entre amigos. Feito para aprender a programar em público.

Isto **não** é o produto War da Grow, nem um cliente raspado do GrowGames. As regras implementadas são as regras públicas do tabuleiro clássico de conquista (42 territórios, objetivos secretos, cartas, combate com dados). Mapa, arte, nomes de pacote e UI são originais deste repositório.

## Rodar

Precisa de [Node.js](https://nodejs.org/) 20+ (`.nvmrc`) e [pnpm](https://pnpm.io/) 9 via Corepack:

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm test
pnpm typecheck
pnpm dev
```

O client usa PixiJS; o workspace tem `.npmrc` com `shamefully-hoist=true` para as dependências internas do Pixi resolverem no Vite.

- Cliente: [http://localhost:5173](http://localhost:5173) — hotseat local (2–6 no mesmo PC) ou entrar numa sala.
- Servidor de salas: `ws://localhost:8787`.

Hotseat não precisa do servidor. Salas entre amigos: um sobe `pnpm --filter @war2/server dev`, os outros apontam o cliente para esse host.

## Pacotes

| Pacote | Função |
| --- | --- |
| `@war2/engine` | Regras. Zero DOM. Fonte da verdade. |
| `@war2/shared` | Protocolo WebSocket (tipos). |
| `@war2/client` | PixiJS 8, rAF sem teto de FPS, UI HTML. |
| `@war2/server` | Salas com código de 6 caracteres, autoridade no reducer. |

Regras **não** vivem no React/Pixi. O client só despacha `{ type, payload }` e interpola o snapshot. O server importa o mesmo `reduce`.

## Repo público

Este workspace ainda não tem remote. Com [GitHub CLI](https://cli.github.com/) autenticado:

```bash
git add .
git commit -m "feat: motor clássico, cliente Pixi e salas entre amigos"
gh repo create war2 --public --source=. --remote=origin --push
```

## Contribuir

Leia [CONTRIBUTING.md](CONTRIBUTING.md) e [AGENTS.md](AGENTS.md). Issues fatiadas: templates em `.github/ISSUE_TEMPLATE/`.

## Licença

[MIT](LICENSE).
