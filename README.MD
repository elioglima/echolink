# EchoLink

Middleware de áudio com **tradução de voz em tempo real** (PT ↔ EN). O produto-alvo é o **EchoLink Box** (interface USB inteligente); o repositório organiza o **core de processamento** e as **applications** (serviço local + UI).

## Resumo

- **Core independente do hardware:** pipeline (áudio → STT → tradução → TTS → áudio) não deve acoplar ALSA, USB Gadget ou detalhes de placa.
- **Hardware = adapter:** no Raspberry, áudio/USB entram como implementações; em desenvolvimento usam-se adapters **locais** e **mock** de USB.
- **Dev-first:** tudo deve rodar no Mac/Windows/Linux **sem Raspberry** — mic/speaker reais, simulação do fluxo USB, logs e gravação de sessão.

## Pontos importantes

| Tema | Diretriz |
|------|-----------|
| Modos | **dev** (local + mock USB) vs **hardware** (RPI + ALSA/PipeWire + Gadget) |
| Abstração de áudio | Entrada/saída via interfaces (`read_chunk` / `write_chunk`), não chamadas diretas ao driver |
| Abstração de USB | Mock em dev; Gadget real em produção no RPi |
| Config | `MODE`, drivers de áudio/USB e provedores STT/TTS via ambiente (ver `mds/resume.md`) |
| Anti-patterns | Não misturar pipeline com ALSA; não depender de Gadget no core |

## Estrutura do repositório

- `applications/echoLinkService` — serviço Python (API local, pipeline em evolução).
- `applications/echolinkApp` — interface Next.js + Electron.
- `mds/` — documentação detalhada (visão de arquitetura, roadmap, convenções).

## Instalação e execução no macOS (pyenv + nvm)

### Ferramentas no Mac

1. **Xcode Command Line Tools** (necessário para compilar Python com pyenv):

   ```bash
   xcode-select --install
   ```

2. **Homebrew** (se ainda não tiver): [https://brew.sh](https://brew.sh)

3. **pyenv**:

   ```bash
   brew install pyenv
   ```

   No `~/.zprofile` ou `~/.zshrc` (shell padrão do macOS é o **zsh**):

   ```bash
   eval "$(pyenv init -)"
   ```

   Abra um terminal novo ou `source` o ficheiro.

4. **nvm** (instalação oficial via script):

   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
   ```

   Reinicie o terminal ou `source ~/.nvm/nvm.sh`.

### Serviço Python (`echoLinkService`)

O interpretador está fixo em `applications/echoLinkService/.python-version` (**3.12**). O `pyproject.toml` exige **Python ≥ 3.11**.

```bash
cd applications/echoLinkService

pyenv install -s 3.12
pyenv local 3.12

python -m venv .venv
source .venv/bin/activate

pip install -U pip
pip install -e .

# API em http://127.0.0.1:8765 (WebSocket em /ws/mic)
python main.py
```

Variável opcional: `ECHO_LINK_RELOAD=0` desativa o reload automático do Uvicorn.

### App Next.js (`echolinkApp`)

A versão do Node está em `applications/echolinkApp/.nvmrc` (**22**).

```bash
cd applications/echolinkApp

nvm install
nvm use

npm install
npm run dev
```

A UI fica em **http://127.0.0.1:3000** e espera o serviço Python na porta **8765**; inicie o `echoLinkService` antes ou em paralelo ao `npm run dev`.

**Desktop (Electron + Next):** `npm run dev:desktop`.

### Dois terminais (recomendado)

| Terminal | Pasta | Comando |
|----------|--------|---------|
| 1 | `applications/echoLinkService` | `source .venv/bin/activate` → `python main.py` |
| 2 | `applications/echolinkApp` | `nvm use` → `npm run dev` |

## Documentação

Detalhes de camadas, pastas sugeridas do `core`, roadmap e filosofia **“se roda no dev, roda no hardware”**: `mds/resume.md`.
