# Olho Laser 👁️🔴

App web que liga a câmera frontal do iPhone, mostra a imagem na tela e, quando você
fica com **um olho aberto e o outro fechado**, dispara um raio laser vermelho do olho
aberto — com física: faíscas, fumaça, marcas de queimado e som.

Roda direto no Safari, sem instalar nada (dá para "Adicionar à Tela de Início").

## Como usar no iPhone

A câmera só funciona em **HTTPS** (abrir o `index.html` direto pelo app Arquivos não
funciona). O jeito mais simples é o GitHub Pages, que é grátis para repositórios
**públicos** (em repositório privado exige plano pago):

1. **Settings › General › Danger Zone › Change visibility › Public**.
2. **Settings › Pages › Build and deployment**: Source **Deploy from a branch**,
   branch `claude/eye-detection-laser-effect-q7ts36` (ou `main`, depois do merge), pasta `/ (root)` › **Save**.
3. Espere 1–2 minutos e abra `https://levelkage.github.io/v11/` no **Safari** do iPhone.
4. Toque em **Ligar câmera** e permita o acesso.

Para testar no computador: `npx http-server .` e abra `http://localhost:8080`
(`localhost` é permitido sem HTTPS).

## Como funciona

| Arquivo | O que faz |
|---|---|
| `js/tracker.js` | MediaPipe Face Landmarker: 478 pontos do rosto + blendshapes, em tempo real. |
| `js/eyes.js` | Mede o fechamento de cada olho (Eye Aspect Ratio adaptativo + blendshapes `eyeBlink*`), decide qual olho está aberto com histerese (piscadas normais não disparam) e calcula para onde a cabeça aponta. |
| `js/laser.js` | Simulação e renderização do laser. |
| `js/filters.js` | Filtro One Euro (tira o tremor) e mola amortecida. |
| `js/audio.js` | Som sintetizado com Web Audio (zumbido + chiado da queima). |

### A física do efeito

- **Mira 3D real**: a profundidade do olho é estimada pela distância entre as pupilas
  (~63 mm) e pelo modelo pinhole da câmera. O raio sai da íris na direção do rosto
  (+ desvio do olhar) e é intersectado com o plano do aparelho — ele queima a tela
  **no ponto para onde você mira**. Vire a cabeça para "desenhar".
- **Perspectiva**: a largura do feixe varia com 1/z, do olho até o vidro.
- **Inércia**: a direção do feixe segue o rosto por uma mola amortecida; a potência
  carrega e descarrega com outra mola. Cintilação por ruído.
- **Faíscas**: gravidade, arrasto quadrático do ar, quique no chão (borda inferior),
  resfriamento radiativo com cor de corpo negro (branco → amarelo → laranja → vermelho)
  e rastro de movimento.
- **Fumaça**: empuxo (ar quente sobe), turbulência e expansão.
- **Queimado**: o ponto atingido fica incandescente e esfria; a fuligem some devagar
  (botão 🧽 limpa).
- **Luz**: brilho no olho, streak anamórfico e "fantasmas" de lente, poeira no ar que
  só aparece ao cruzar o feixe (efeito Tyndall), luz vermelha no rosto e tremor sutil.

### Botões

🔊 som · 📊 diagnóstico (abertura de cada olho e FPS) · 🧽 limpar marcas

### Ajustes

- Sensibilidade da mira: `AIM_GAIN` em `js/laser.js`.
- Limiares da piscadela: `CLOSED_MIN`, `OPEN_MAX`, `DIFF_MIN` em `js/eyes.js`.
