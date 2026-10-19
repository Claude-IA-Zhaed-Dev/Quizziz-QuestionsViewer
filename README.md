# Wayground Export (Quizizz) – copiar perguntas e alternativas

Script para o **console do navegador**. Lê a página do quiz, rola sozinho para carregar tudo e mostra um
painel com **somente as perguntas e as alternativas, na ordem**, prontas para copiar.

- Não instala nada, não baixa nada, não envia nada para a internet (só lê o texto da página).
- Não exporta respostas corretas, explicações, pontos, tempo, nem nomes de jogadores.

## 1) Preparar o repositório (uma vez só)

1. No GitHub, crie um repositório **público** (ex.: `wayground-export`).
2. Envie o arquivo `wayground-export.js` para a raiz (branch `main`).
3. Sua URL será:
   `https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/wayground-export.js`

## 2) Usar

1. Entre no Wayground **logado** e abra a página do quiz que **lista todas as perguntas**
   (a página do recurso, com "N questions"). Sem login a página mostra só parte das perguntas.
2. Deixe as respostas **ocultas** (padrão, sem clicar em "Show all answers").
3. Abra o console: `F12` (ou `Ctrl+Shift+J`) → aba **Console**.
4. Cole e dê Enter (troque `SEU_USUARIO/SEU_REPO`):

```js
fetch('https://raw.githubusercontent.com/SEU_USUARIO/SEU_REPO/main/wayground-export.js').then(r=>r.text()).then(t=>(0,eval)(t))
```

> Chrome/Edge: na primeira vez o console pede para digitar `allow pasting` (em português, `permitir colar`). Digite e cole de novo.

5. Aparece um painel no canto da tela. Ao terminar ele já tenta copiar sozinho; se não conseguir, clique em
   **Copiar tudo** (ou **Baixar .txt**).

### Formato da saída

```
1. Qual é a capital da França?
A) Paris
B) Londres
C) Roma
D) Madri

2. Quanto é 2 + 2?
A) 3
...
```

## Se o carregamento pelo GitHub for bloqueado

Alguns sites bloqueiam `fetch`/`eval` por política de segurança (CSP). Alternativas, nesta ordem:

```js
// Alternativa 1 – via jsDelivr (tag <script>)
var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/gh/SEU_USUARIO/SEU_REPO@main/wayground-export.js';document.head.appendChild(s)
```

**Alternativa 2 (sempre funciona):** abra `wayground-export.js`, copie o conteúdo inteiro e cole no console.
O console não é afetado pela CSP.

> O GitHub (raw) guarda cache por ~5 minutos. Depois de atualizar o arquivo, aguarde um pouco.

## Avisos do painel

| Aviso | O que fazer |
|---|---|
| "A página indica N perguntas, mas só X foram capturadas" | Entre na conta (sem login a página corta perguntas) e rode de novo |
| "números faltando" | Rode de novo; se persistir, veja o diagnóstico abaixo |
| "Sem alternativas detectadas nas perguntas: …" | Normal para pergunta aberta/desenho; senão veja o diagnóstico |

## Diagnóstico e ajuste manual

O Wayground muda o layout de vez em quando. O script não depende de nomes de classe (usa o texto
`30 sec • 1 pt`, a numeração e a estrutura da página), mas se algo sair errado:

```js
WGExport.debug()      // imprime a estrutura HTML e os blocos de texto de 2 perguntas
```

Copie a saída do console: com ela dá para ajustar o script. Também é possível indicar os seletores à mão:

```js
WGExport.CFG.selectors = { card: '.CLASSE_DA_PERGUNTA', question: '.CLASSE_DO_ENUNCIADO', option: '.CLASSE_DA_ALTERNATIVA' };
WGExport.run();
```

Outros comandos: `WGExport.text` (texto final), `copy(WGExport.text)` (copia pelo console),
`WGExport.CFG.letters = false` (usa "- alternativa" em vez de "A) alternativa").

## O que o script faz com imagens e fórmulas

- Imagem na pergunta/alternativa vira `[imagem]`.
- Fórmulas (KaTeX/MathJax) viram LaTeX entre `$...$`.
- Textos escondidos (leitores de tela, `display:none`) são ignorados.

## Limitações

- Funciona na página que **lista** as perguntas. Não captura durante o jogo (uma pergunta por vez).
- Tipos especiais (categorizar, arrastar, "texto e perguntas") saem como texto simples dos itens.
