# Wayground Export (Quizizz) – copiar perguntas e alternativas

Script para o **console do navegador**. Lê a página do quiz, rola sozinho para carregar tudo e mostra um
painel com **somente as perguntas e as alternativas, na ordem**, prontas para copiar.

- Não instala nada, não baixa nada, não envia nada para a internet (só lê o texto da página).
- Não exporta respostas corretas, explicações, pontos, tempo, nem nomes de jogadores.


## Limitações

- Funciona na página que **lista** as perguntas. Não captura durante o jogo (uma pergunta por vez).
- Tipos especiais (categorizar, arrastar, "texto e perguntas") saem como texto simples dos itens.


## 2) Usar
Entre no Wayground logado e abra a página do quiz que lista todas as perguntas
(a página do recurso, com "N questions"). 
Sem login a página mostra só parte das perguntas.
Deixe as respostas ocultas (padrão, sem clicar em "Show all answers").
Abra o console: `F12` (ou `Ctrl+Shift+J`) → aba Console.
Cole e dê Enter:
```js
fetch('https://github.com/Claude-IA-Zhaed-Dev/Quizziz-QuestionsViewer/blob/main/wayground-export.js').then(r=>r.text()).then(t=>(0,eval)(t))
```
> Chrome/Edge: na primeira vez o console pede para digitar `allow pasting` (em português, `permitir colar`).
> Digite e cole de novo.
Aparece um painel no canto da tela. Ao terminar ele já tenta copiar sozinho; se não conseguir, clique em
Copiar tudo (ou Baixar .txt).
